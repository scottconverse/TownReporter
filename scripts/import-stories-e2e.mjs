#!/usr/bin/env node
/**
 * Import finished stories, in a browser: paste a report, check every story,
 * import the ticked ones, publish one.
 *
 * The owner's need, in his own words (2026-09-24): "I should be able to just
 * dump something like that into the desk somewhere and it should be smart
 * enough to read it all, parse out the stories, headline them and paste the
 * body of the story and the claims/sources links in the right place in the
 * story and put it in the queue. I DO NOT want to run AI's multiple times to
 * find stories."
 *
 * This walk drives that whole path on the built server, in this process, on
 * its own port and its own in-memory PGlite (never Postgres: DATABASE_URL is
 * cleared below), with the owner's own fixture -- a real civic-scanner report
 * of ten sections, seven of them stories. No model is ever started: the
 * report's own headings are enough, and a walk that needed a model to read it
 * would be proving the wrong thing.
 *
 * What it proves, in order:
 *
 *   - the Desk offers the second choice in the owner's own words, and hands the
 *     paste to the import screen character for character;
 *   - the report is read into ten cards -- seven stories with their heading
 *     numbers stripped, three sections that are not stories, unticked;
 *   - the editor re-files one story's section by hand and takes a second story
 *     out, and only the ticked six import;
 *   - the Queue shows six Imported leads with the held one flagged, and the
 *     story the editor removed is not there;
 *   - nothing printed: the imported headline is not on the public paper yet;
 *   - a story opens, its section is confirmed and it publishes on the normal
 *     button -- with the body word for word as pasted, its cited pages as
 *     working links, the section the editor chose, and the disclosure line for
 *     an outside AI tool instead of the desk's own AI line.
 *
 *   node scripts/import-stories-e2e.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { confirmSectionAndWaitForPublishable } from "./confirm-section-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_IMPORT_STORIES = 3314;

const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/scratch/X";
const base = checkedUrl(`http://127.0.0.1:${PORT_IMPORT_STORIES}`);

/** The owner's own report, read from the repo's copy of it. */
const FIXTURE = readFileSync(
  join(REPO, "src/lib/news/fixtures/civic-scanner-longmont-2026-09-24.md"),
  "utf8",
);

/** The seven stories in the report, in its own order, heading numbers stripped. */
const STORIES = [
  "Council votes to bring marijuana hospitality rules back for consideration",
  "Four Longmont measures are set for the November ballot",
  "Council creates technology policy advisory board as city pauses fixed ALPR replacements",
  "Council authorizes purchase of the YMCA property at 950 Lashley Street",
  "21st Avenue rail crossing is scheduled for two closure periods",
  "Proposed 2027 budget includes Ride Longmont expansion and sanitation service changes",
  "St. Vrain board packet presents assessment results and bond work",
];
/** The three sections of the report that are not stories. */
const NOT_STORIES = [
  "Beat context and source access",
  "Signals and watch list",
  "Upcoming dates to monitor",
];

/** The story the editor re-files by hand, and the one taken out of the import. */
const REFILED = STORIES[0];
const TAKEN_OUT = STORIES[1];
/** The story the report triaged Hold -- it imports with the Hold flag on. */
const HELD = STORIES[6];

/** A sentence from the middle of the re-filed story, quoted, not summarised. */
const MARKS =
  "The auto-generated transcript identifies three members in opposition: Diane Crist, Matthew Popkin and Crystal Prieto.";
/** Two of that story's cited pages, exactly as the report wrote them. */
const CITED = [
  "https://www.youtube.com/watch?v=jhsFsEz0P5A&t=1444s",
  "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1",
];
/** The line the review screen puts over a detected civic-scanner report. */
const OUTSIDE_AI_LINE =
  "An outside AI research tool wrote this from public records; an editor reviewed it.";
/** The desk's own line, which would be a lie over an outside tool's report. */
const DESK_AI_LINE = "AI tools helped find records and write the first draft";

const stamp = Date.now();
const email = `import-${stamp}@townreporter.test`;
const password = "import-stories-e2e-pass";

let page;
const done = [];
const shot = [];
const facts = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1800);
  } catch {
    /* the page is already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT_IMPORT_STORIES);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "import-stories-e2e-secret";
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

/** The first account owns the desk and finishes setup, as a person would. */
async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Import Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/** Every card on the review screen, ticked or not. */
function cards() {
  return page.locator('li:has(> div > input[id^="tick-"])');
}

function cardFor(headline) {
  return cards().filter({ hasText: headline }).first();
}

/** Wait for a control to stop being disabled, so the click lands on a live one. */
async function waitForEnabled(locator, timeout = 30_000) {
  const handle = await locator.elementHandle();
  await page.waitForFunction((el) => el && !el.disabled, handle, { timeout });
}

/**
 * One read of every card's own state. `textContent`, not `innerText`: the
 * editor notes sit inside a closed `<details>`, so a card's score and triage
 * are on its record but not on the screen until an editor opens it.
 */
async function cardFacts() {
  return page.evaluate(() => {
    const norm = (text) => (text ?? "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('input[id^="tick-"]')].map((input) => {
      const li = input.closest("li");
      const label = document.querySelector(`label[for="${input.id}"]`);
      // The tick label holds two spans with no whitespace between them in the
      // source, so they are read apart rather than off the concatenation.
      const kind = norm(label?.querySelector("span")?.textContent);
      // The screen labels each card "Story: <headline>" or "Not a story:
      // <heading>", so the prefix comes off to compare against the report.
      const shown = norm(label?.querySelector("span.block")?.textContent);
      const headline = shown.replace(/^(Story|Not a story): /, "");
      return {
        key: input.id.replace(/^tick-/, ""),
        checked: input.checked,
        kind,
        headline,
        label: shown,
        // The flag is a span the stylesheet uppercases; the notes below it in a
        // closed <details> carry the report's own "Triage: Hold" as well.
        holdFlag: [...li.querySelectorAll("span")].some(
          (s) => /(^|\s)uppercase(\s|$)/.test(s.className) && (s.textContent ?? "").trim() === "Hold",
        ),
        text: norm(li.textContent),
        section: li.querySelector("select")?.value ?? "",
        verbatim: (li.querySelector("pre")?.textContent ?? "").replace(/\r\n/g, "\n").trim(),
      };
    });
  });
}

/* ---------------------------------------------------------------- the walk */

/**
 * The Desk's second choice: "Import finished stories", carrying the owner's
 * own promise, and handing the paste to the import screen untouched.
 */
async function theDeskOffersTheSecondChoice() {
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  const panel = page.locator("#import-story");
  await panel.waitFor({ timeout: 45_000 });
  await panel.getByRole("heading", { name: "Import finished stories", exact: true }).waitFor();
  // textContent, not innerText: the eyebrow over the heading is uppercased by
  // the stylesheet, and it is the source wording this walk is checking.
  const said = (await panel.evaluate((el) => el.textContent)) ?? "";
  must(
    said.includes("Paste one story or a whole report. The text is kept exactly as written."),
    "the Desk's second choice does not carry the owner's promise in the owner's words",
  );
  must(
    /or bring one already written/i.test(said),
    "the import box is not marked out as the other way in",
  );

  await panel.getByLabel("The story, or the whole report").fill(FIXTURE);
  const read = panel.getByRole("button", { name: "Read the stories", exact: true });
  await waitForEnabled(read);
  await read.click();

  await page.waitForURL(/\/desk\/import/, { timeout: 30_000 });
  const carried = page.getByLabel("Paste the report or the story");
  await carried.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (want) => [...document.querySelectorAll("textarea")].some((t) => t.value.length === want),
    FIXTURE.length,
    { timeout: 30_000 },
  );
  must(
    (await carried.inputValue()) === FIXTURE,
    "the paste did not survive the hand-off from the Desk to the import screen",
  );
  step("the Desk hands the paste to the import screen, character for character");
}

/** The report read into cards: seven stories, three sections that are not. */
async function theReportIsReadIntoReviewableCards() {
  await page.getByRole("button", { name: "Read the stories", exact: true }).click();
  await page
    .getByText("7 stories, 3 sections that are not stories", { exact: false })
    .first()
    .waitFor({ timeout: 60_000 });

  const summary = await page.getByText(/^Read as:/).first().innerText();
  must(
    summary.includes("Civic Source Scanner"),
    `the screen did not record that an outside tool wrote the report: ${summary}`,
  );

  const read = await cardFacts();
  must(read.length === 10, `expected 10 cards, found ${read.length}`);
  must(
    read.filter((c) => c.kind === "Import this story").length === 7,
    "the seven stories were not read as stories",
  );
  must(read.filter((c) => c.checked).length === 7, "the seven stories did not arrive ticked");

  const seen = read.map((c) => `${c.kind} | ${c.headline}`).join("\n  ");
  for (const headline of STORIES) {
    const card = read.find((c) => c.kind === "Import this story" && c.headline === headline);
    must(Boolean(card), `no card for the story "${headline}". The cards read:\n  ${seen}`);
    must(card.checked, `the story "${headline}" should arrive ticked`);
    must(card.section.length > 0, `"${headline}" arrived with no section at all`);
  }
  for (const name of NOT_STORIES) {
    const card = read.find(
      (c) => c.kind !== "Import this story" && c.headline === name,
    );
    must(Boolean(card), `no card for the report's section "${name}"`);
    must(!card.checked, `"${name}" is not a story and must arrive unticked`);
  }
  /*
    The heading number comes off. Checked against the shape the parser strips
    ("7. "), not against a bare leading digit: "21st Avenue rail crossing" is a
    headline of this report and starts with one. The fixture is counted first so
    the check cannot pass by there being no numbers to strip.
  */
  const numbered = FIXTURE.match(/^###\s+(?:\d+|[ivxlc]+)[.)]\s+\S/gm) ?? [];
  must(numbered.length === 7, `the fixture should carry 7 numbered headings, found ${numbered.length}`);
  must(
    !read.some((c) => /^(?:\d+|[ivxlc]+)[.)]\s/i.test(c.headline)),
    "a heading number is still stuck on a headline",
  );
  must(
    (await page.locator('[role="status"]').count()) >= 1,
    "the screen has no live status region for a screen reader",
  );
  step("ten cards: seven stories with their numbers stripped, three sections that are not");
}

/** The editor re-files one story's section by hand. Nothing is imported yet. */
async function theEditorRefilesOneStoryByHand() {
  const card = cardFor(REFILED);
  await card.waitFor({ timeout: 30_000 });
  const select = card.locator("select");
  const before = await select.inputValue();
  const options = await select
    .locator("option")
    .evaluateAll((els) =>
      els.map((el) => ({ value: el.value, name: (el.textContent ?? "").trim() })),
    );
  const chosen = options.find((o) => o.value && o.value !== before);
  must(Boolean(chosen), `the desk offered no second section to choose (it had "${before}")`);
  await select.selectOption(chosen.value);
  must((await select.inputValue()) === chosen.value, "the section change did not take");
  step(`the editor re-files one story from "${before}" to "${chosen.name}" by hand`);
  return chosen;
}

/** The Hold is visible on its card, and one story comes out of the import. */
async function theHoldIsVisibleAndOneStoryComesOut() {
  const held = (await cardFacts()).find((c) => c.headline === HELD);
  must(Boolean(held), "no card for the story the report triaged Hold");
  must(held.holdFlag, "the Hold triage is not shown as a flag on its card");
  must(/Triage: Hold/.test(held.text), "the report's own Triage value was not carried onto the card");
  must(/Score: 9\/20/.test(held.text), "the report's own Score was not carried onto the card");

  await cardFor(TAKEN_OUT).locator('input[id^="tick-"]').uncheck();
  const after = await cardFacts();
  must(after.filter((c) => c.checked).length === 6, "six stories should still be ticked");
  must(
    after.filter((c) => c.kind !== "Import this story" && c.checked).length === 0,
    "unticking a story changed the sections that are not stories",
  );
  await page
    .getByText("6 ticked · 6 ready to import", { exact: false })
    .first()
    .waitFor({ timeout: 30_000 });
  step("the Hold is on its card, and one story is taken out by hand; six are ready");
}

/** Import, and the six land in the Queue marked Imported. Nothing prints. */
async function theTickedStoriesLandInTheQueue() {
  const button = page.getByRole("button", { name: /^Import 6 stories to the Queue$/ });
  await waitForEnabled(button, 45_000);
  await button.click();
  await page
    .getByRole("heading", { name: "In the Queue", exact: true })
    .waitFor({ timeout: 60_000 });

  const panel = page.locator("section", {
    has: page.getByRole("heading", { name: "In the Queue", exact: true }),
  });
  const listed = await panel.innerText();
  for (const headline of STORIES.filter((h) => h !== TAKEN_OUT)) {
    must(listed.includes(headline), `"${headline}" is missing from the import result panel`);
  }
  must(!listed.includes(TAKEN_OUT), "the story the editor took out was imported anyway");
  await page
    .locator('[role="status"]')
    .filter({ hasText: "6 stories in the Queue, marked Imported. 1 held. Nothing is published." })
    .first()
    .waitFor({ timeout: 15_000 });
  step("six stories import, the taken-out one does not, and the desk says one is held");

  await panel.getByRole("link", { name: "Open the Queue", exact: true }).click();
  await page.waitForURL(/\/desk\/queue/, { timeout: 30_000 });
  await page.locator(".chip.imported").first().waitFor({ timeout: 45_000 });
  const imported = await page.locator(".chip.imported").count();
  must(imported === 6, `the Queue shows ${imported} Imported leads, expected 6`);
  must(
    (await page.locator(".lead-row", { hasText: TAKEN_OUT }).count()) === 0,
    "the story the editor took out is on the Queue",
  );
  const heldRow = page.locator(".lead-row", { hasText: HELD });
  await heldRow.waitFor({ timeout: 30_000 });
  must(
    (await heldRow.locator(".chip.st-held").count()) === 1,
    "the held story is on the Queue with no Hold flag",
  );
  // Taken here, while all six are still on the Queue: the phase that publishes
  // one happens later, and a picture of five would not match the claim.
  facts.push(await screenshot("import-queue-1280-light.png", 1280, 900, ".chip.imported"));
  step("the Queue shows six Imported leads, the held one flagged");
}

/** Nothing is published by an import. The paper does not have these stories. */
async function nothingPrinted() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const paper = await page.locator("body").innerText();
  must(
    !paper.includes(REFILED),
    "an imported story is on the public paper before any editor published it",
  );
  step("nothing is published: the paper does not carry the imported stories");
}

/** Open one, confirm its section, publish on the normal button. */
async function oneImportedStoryPublishes(chosen) {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  const row = page.locator(".lead-row", { hasText: REFILED });
  await row.waitFor({ timeout: 45_000 });
  await row.getByRole("link", { name: REFILED, exact: true }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });

  const topic = page.locator("#story-topic");
  await topic.waitFor({ timeout: 45_000 });
  must(
    (await topic.locator("select").inputValue()) === chosen.value,
    "the section the editor chose on the review screen did not reach the story",
  );
  await page.getByText(MARKS, { exact: false }).first().waitFor({ timeout: 30_000 });

  await confirmSectionAndWaitForPublishable(page);
  await page.getByRole("button", { name: "Publish to the paper", exact: true }).click();
  // The desk asks once more before it goes out, as it does for every story.
  await page.getByRole("button", { name: "Yes, print it", exact: true }).click();

  const read = page.getByRole("link", { name: "Read it on the paper", exact: true });
  await read.waitFor({ timeout: 60_000 });
  step("an imported story confirms its section and publishes on the normal button");
  await read.click();
  await page.waitForURL(/\/articles\//, { timeout: 30_000 });
}

/** The reader gets the text as pasted, the sources, and the honest line. */
async function theReaderGetsTheTextAsWritten(chosen) {
  await page.locator(".articlehead h1").waitFor({ timeout: 45_000 });
  must(
    (await page.locator(".articlehead h1").innerText()).trim() === REFILED,
    "the published headline is not the one the report wrote",
  );
  must(
    (await page.locator(".articlehead .tag").innerText()).trim().toLowerCase() ===
      chosen.name.toLowerCase(),
    "the section the editor chose is not the section the paper files the story under",
  );
  const body = await page.locator("#story-body").innerText();
  must(body.includes(MARKS), "the published body does not carry the report's own sentence");
  must(/\*\*/.test(body) === false, "raw markdown markers were printed in the story");
  must(!/Reporter next step|Triage:/i.test(body), "a private note was published inside the story");

  const hrefs = await page
    .locator("#sources a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  for (const url of CITED) {
    must(hrefs.includes(url), `the cited page ${url} is not a working link under Sources`);
  }
  const printed = await page.locator("body").innerText();
  must(
    printed.includes(OUTSIDE_AI_LINE),
    "the disclosure line the editor chose is not on the published page",
  );
  must(
    !printed.includes(DESK_AI_LINE),
    "the desk's own AI line printed over a story this paper's AI did not write",
  );
  step("the published story carries the report's own words, its cited pages and the honest line");
}

/**
 * No sideways scroll, and the type an editor has to read is not shrunk below
 * 14px. The size check runs over the import screen's own markup -- the desk
 * chrome around it is older than this unit and is measured, not gated.
 */
async function fitsAt375(note, enforceType = false) {
  const measured = await page.evaluate((enforce) => {
    const size = (el) => Number.parseFloat(getComputedStyle(el).fontSize);
    const own = enforce
      ? [...document.querySelectorAll('ul:has(> li > div > input[id^="tick-"]) label, ul:has(> li > div > input[id^="tick-"]) p')]
      : [];
    const limit = window.innerWidth + 1;
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
      // What is actually sticking out, so a failure names the element rather
      // than only the number of pixels.
      wide: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > limit)
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
        .map(
          (el) =>
            `${el.tagName}.${el.className || "-"} right=${Math.round(el.getBoundingClientRect().right)} ` +
            `"${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"`,
        )
        .slice(0, 6),
      smallest: own.length ? Math.min(...own.map(size)) : null,
      under: own.filter((el) => size(el) < 14).length,
      tiny: [...document.querySelectorAll("p, li, label, span, a")]
        .filter((el) => el.textContent?.trim() && size(el) < 14)
        .map((el) => `${el.tagName}.${el.className || "-"} ${size(el)}px`)
        .slice(0, 6),
    };
  }, enforceType);
  must(
    measured.over <= 1,
    `${note} scrolls sideways by ${measured.over}px at 375px` +
      (measured.wide.length ? `. Widest:\n  ${measured.wide.join("\n  ")}` : ""),
  );
  if (enforceType) {
    must(
      measured.under === 0,
      `${measured.under} labels or paragraphs on the import screen are under 14px ` +
        `(smallest ${measured.smallest}px)`,
    );
  }
  step(
    `${note} fits 375px${enforceType ? `, its labels and paragraphs at ${measured.smallest}px` : ""}`,
  );
  return measured;
}

/**
 * One screenshot, every animation on the page finished first, and the colours
 * the shutter actually caught measured and printed -- so what the report says
 * about the picture can be checked against the picture.
 *
 * The anchor is scrolled to the middle of the viewport before the shutter: the
 * picture is supposed to show the thing being talked about, and the first
 * attempt framed the paste box at the top of the screen instead of the cards.
 * `index` picks among several matches, because the first card of a report can
 * be a section that is not a story.
 */
async function screenshot(name, width, height, anchor, index = 0) {
  await page.setViewportSize({ width, height });
  const measured = await page.evaluate(
    ({ selector, at }) => {
      const running = document.getAnimations();
      const names = running
        .map((a) => a.transitionProperty || a.animationName || "?")
        .filter(Boolean);
      running.forEach((a) => {
        try {
          a.finish();
        } catch {
          /* an infinite animation will not finish, and it is not a fade */
        }
      });
      const el = document.querySelectorAll(selector)[at];
      el?.scrollIntoView({ block: "center", behavior: "instant" });
      let background = "rgba(0, 0, 0, 0)";
      let up = el;
      while (up && (background === "rgba(0, 0, 0, 0)" || background === "transparent")) {
        background = getComputedStyle(up).backgroundColor;
        up = up.parentElement;
      }
      return {
        text: (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
        color: el ? getComputedStyle(el).color : "",
        background,
        finishedAnimations: names,
      };
    },
    { selector: anchor, at: index },
  );
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, name);
  await page.screenshot({ path: file, fullPage: false });
  shot.push(file);
  step(
    `shot ${name} (${width}x${height}): "${measured.text}" ${measured.color} on ` +
      `${measured.background}; animations still running: ${measured.finishedAnimations.join(", ") || "none"}`,
  );
  return { file, width, height, ...measured };
}

async function thePictures() {
  // The first card of this report is a section that is not a story, so the
  // pictures frame the second one: the first story.
  const cardHeadline = 'label[for^="tick-"] > span.block';
  const firstStory = 1;

  // The review screen, as the editor leaves it just before importing.
  await page.goto(`${base}/desk/import`, { waitUntil: "networkidle" });
  await page.getByLabel("Paste the report or the story").fill(FIXTURE);
  await page.getByRole("button", { name: "Read the stories", exact: true }).click();
  await page
    .getByRole("heading", { name: "Check every story", exact: true })
    .waitFor({ timeout: 60_000 });

  facts.push(
    await screenshot("import-review-1280-light.png", 1280, 900, cardHeadline, firstStory),
  );
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForTimeout(400);
  facts.push(await screenshot("import-review-1280-dark.png", 1280, 900, cardHeadline, firstStory));
  await page.getByRole("button", { name: "Switch to light appearance" }).click();
  await page.waitForTimeout(400);

  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the import review screen", true));
  facts.push(await screenshot("import-review-375-light.png", 375, 720, cardHeadline, firstStory));

  // The Queue picture is taken in the import phase, while all six are on it.

  /*
    The published story, as a reader sees it. Read from the Published page: the
    story has already been printed by the phase above, so it has left the Queue
    and only the record keeps it.
  */
  await page.goto(`${base}/desk/published`, { waitUntil: "networkidle" });
  const printedRow = page.locator("li, .pub-row, article").filter({ hasText: REFILED }).first();
  await printedRow.waitFor({ timeout: 45_000 });
  const readOnPaper = printedRow.getByRole("link", { name: "Read on the paper", exact: true });
  const printed = await readOnPaper.getAttribute("href");
  must(Boolean(printed), "the published story has no link to the paper");
  await page.goto(new URL(printed, base).href, { waitUntil: "networkidle" });
  await page.locator(".articlehead h1").waitFor({ timeout: 45_000 });
  facts.push(await screenshot("import-published-1280-light.png", 1280, 900, ".articlehead h1"));
  // The line readers see, and the cited pages under it: below the fold of the
  // picture above, so framed on its own.
  facts.push(
    await screenshot("import-published-sources-1280-light.png", 1280, 900, ".ai-disclosure"),
  );
  facts.push(await fitsAt375("the published imported story"));
  facts.push(await screenshot("import-published-375-light.png", 375, 720, ".articlehead h1"));
}

async function main() {
  await bootTheServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  try {
    await ownTheDesk();
    await theDeskOffersTheSecondChoice();
    await theReportIsReadIntoReviewableCards();
    const chosen = await theEditorRefilesOneStoryByHand();
    await theHoldIsVisibleAndOneStoryComesOut();
    await theTickedStoriesLandInTheQueue();
    await nothingPrinted();
    await oneImportedStoryPublishes(chosen);
    await theReaderGetsTheTextAsWritten(chosen);
    await thePictures();
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        steps: done.length,
        screenshots: shot,
        measured: facts,
        consoleErrors: consoleErrors.slice(0, 10),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
