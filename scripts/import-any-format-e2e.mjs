/**
 * Unit X3, step F: the Claude report, end to end through the desk.
 *
 * scripts/import-stories-e2e.mjs walks the Codex report -- seven stories, three
 * sections that are not, every lead written as a story. This walks the report
 * the owner ran with the civic-scanner skill in Claude instead of Codex
 * (civic-scanner-claude-longmont-2026-09-24.md), which is a different shape in
 * three ways the unit exists for:
 *
 * 1. Its headings carry the scanner's own noise -- "LEAD 12: ... (9/20: I3 Im1
 *    C3 N2)" -- so a headline has to come out clean.
 * 2. Most of its leads are not written stories: 22 leads, only 10 with a story
 *    under them. The rest are descriptions, and a description is a story idea,
 *    not a drafted story with nothing in it.
 * 3. Three leads are triaged Demote and must open unticked, as ideas, with the
 *    Hold flag visible.
 *
 * Everything below is read off the running screen: the review cards as an
 * editor sees them, then the Queue after importing three as stories and two as
 * ideas. Both pictures are taken at 1280 and 375 and opened afterwards.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 *
 * This was 3321 until the two 0.6.63 lanes merged. Y2's
 * scripts/story-quota-failover-e2e.mjs already binds 3321 for its fake
 * DeepSeek endpoint, and that port check caught the collision at merge time --
 * exactly the "one server answering two scripts" failure the check exists for.
 * This walk is the newer claim, so it is the one that moves.
 */
const PORT_IMPORT_ANY_FORMAT = 3322;

const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/scratch/X3";
const base = checkedUrl(`http://127.0.0.1:${PORT_IMPORT_ANY_FORMAT}`);

/** The owner's own report, the one Claude wrote, read from the repo's copy. */
const FIXTURE = readFileSync(
  join(REPO, "src/lib/news/fixtures/civic-scanner-claude-longmont-2026-09-24.md"),
  "utf8",
);

/** What the screen says it read, in its own words. */
const READ_LINE = "Read 10 stories and 12 story ideas out of the paste.";

/** The counts the reader produces from this report. */
const CARDS = 38;
const TICKED = 19;
const TICKED_STORIES = 10;
const TICKED_IDEAS = 9;
/** Cards that are a section of the report rather than one of its leads. */
const SECTIONS = 16;
/** Cards wearing the Hold flag: a Hold section, eight held leads, three demoted. */
const HOLDS = 12;

/** Three headlines as the report wrote them (heading number and all). */
const NOISY = [
  "### **LEAD 1: Council votes 4-3 to bring back marijuana hospitality, limited to venues that also sell**",
  "### **LEAD 12: Hangar lease assignment passes 5-2 ahead of airport vision session (9/20: I3 Im1 C3 N2)**",
  "* **LEAD 20** (6/20): Water Board, Sept 21,",
];
/** The same three as the review screen must show them. */
const CLEAN = [
  "Council votes 4-3 to bring back marijuana hospitality, limited to venues that also sell",
  "Hangar lease assignment passes 5-2 ahead of airport vision session",
  'Water Board, Sept 21, "Action Required" conveyance plats for 701 S. Main, FRCC, and Longmont Transit Center Filing No. 1 (1st and Main parcels)',
];
/** The three the report triaged Demote: ideas, unticked, on Hold. */
const DEMOTED = [
  'Water Board, Sept 21, "Action Required" conveyance plats for 701 S. Main, FRCC, and Longmont Transit Center Filing No. 1 (1st and Main parcels)',
  "P&Z, Sept 23, public hearing on a vehicle sales and rental conditional use at 206 S. Main (Avis)",
  "Neighborhood meeting Sept 17 on annexing 0.88 acres at 8979 Nelson Road (Connection Church Longmont; Norris Design)",
];

/** The first lead's text sources: three documents the report named and did not link. */
const FIRST_CITATIONS = [
  "Sept 22 council recording 0:23:37 to 0:36:25 (transcript-based)",
  "Sept 22 packet p. 819 (Tier A)",
  "2027 Budget Message, Sept 1 (Tier A, CONTEXT)",
];

/** The opening of the first lead's body, as the report wrote it. */
const FIRST_SENTENCE =
  "Under future agenda items on September 22 (0:23:37 to 0:36:25), Council Member Jake Marsing moved";
/** The line the report put under the first lead's headline. */
const FIRST_DEK = "This revives a policy that failed in 2025 on a 3-3 vote";

/** Three stories and two ideas, ticked by hand out of the nineteen. */
const AS_STORY = [
  "Council votes 4-3 to bring back marijuana hospitality, limited to venues that also sell",
  "Dry Creek annexation passes first reading with four council-added conditions",
  "2027 budget: utilities and streets face fund-balance draws and deferred maintenance",
];
/** One the reader called an idea; one the editor overrules to an idea on the card. */
const AS_IDEA = [
  "21st Avenue rail crossing closes Sept 28 for quiet zone work",
  "Council runs out of time; action-plan priorities and board changes deferred again",
];
/** The idea whose lead page is opened: its description is the lead's why. */
const IDEA_TO_OPEN = AS_IDEA[0];
const IDEA_WHY = "Drivers and walkers near 21st Avenue lose the crossing for most of October and November.";

const stamp = Date.now();
const email = `any-format-${stamp}@townreporter.test`;
const password = "import-any-format-e2e-pass";

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
  process.env.PORT = String(PORT_IMPORT_ANY_FORMAT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "import-any-format-e2e-secret";
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
  await page.getByLabel("Name").fill("Any Format Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/**
 * The one card whose headline is this one, ticked or not.
 *
 * Matched on the tick label's headline span and NOT on the whole card: this
 * report carries a "SCORE SUMMARY" section whose pasted text is a markdown
 * table with every headline in the report as a row, so `filter({hasText})`
 * over the card matched that section before it matched the lead the headline
 * belongs to, and the sources check below then read the wrong card.
 */
function cardFor(headline) {
  return page
    .locator('li:has(> div > input[id^="tick-"])')
    .filter({ has: page.locator('label[for^="tick-"] > span.block', { hasText: headline }) })
    .first();
}

/**
 * One read of every card's own state, the same shape the X walk reads: the
 * kind off the tick label's first span, the headline off its second, the Hold
 * flag off the uppercased span.
 */
async function cardFacts() {
  return page.evaluate(() => {
    const norm = (text) => (text ?? "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('input[id^="tick-"]')].map((input) => {
      const li = input.closest("li");
      const label = document.querySelector(`label[for="${input.id}"]`);
      const kind = norm(label?.querySelector("span")?.textContent);
      const headline = norm(label?.querySelector("span.block")?.textContent).replace(
        /^(Story idea|Not a story): /,
        "",
      );
      return {
        key: input.id.replace(/^tick-/, ""),
        checked: input.checked,
        kind,
        headline,
        holdFlag: [...li.querySelectorAll("span")].some(
          (s) => /(^|\s)uppercase(\s|$)/.test(s.className) && (s.textContent ?? "").trim() === "Hold",
        ),
        text: norm(li.textContent),
        section: li.querySelector("select")?.value ?? "",
      };
    });
  });
}

/* ---------------------------------------------------------------- the walk */

/** Paste the Claude report and read it. */
async function theReportIsRead() {
  await page.goto(`${base}/desk/import`, { waitUntil: "networkidle" });
  await page.getByLabel("Paste the report or the story").fill(FIXTURE);
  await page.getByRole("button", { name: "Read the stories", exact: true }).click();
  await page
    .getByRole("heading", { name: "Check every story", exact: true })
    .waitFor({ timeout: 60_000 });
  const said = await page.locator("body").innerText();
  must(said.includes(READ_LINE), `the screen did not say what it read: looking for "${READ_LINE}"`);
  step(`the Claude report is read: "${READ_LINE}"`);
}

/** Clean headlines, and the counts the reader produces. */
async function theHeadlinesAreClean() {
  const read = await cardFacts();
  must(read.length === CARDS, `expected ${CARDS} cards, found ${read.length}`);
  const ticked = read.filter((c) => c.checked);
  must(ticked.length === TICKED, `expected ${TICKED} ticked cards, found ${ticked.length}`);
  must(
    ticked.filter((c) => c.kind === "Import this story").length === TICKED_STORIES,
    `${ticked.filter((c) => c.kind === "Import this story").length} cards are stories, ${TICKED_STORIES} expected`,
  );
  must(
    ticked.filter((c) => c.kind === "Import this idea").length === TICKED_IDEAS,
    `${ticked.filter((c) => c.kind === "Import this idea").length} cards are ideas, ${TICKED_IDEAS} expected`,
  );
  must(
    read.filter((c) => c.kind === "Not a story — import it anyway?").length === SECTIONS,
    "the report's own sections are not read as sections",
  );

  /*
    The fixture really does carry the noise this step is about, counted first
    so a clean screen cannot pass by there being nothing to strip.
  */
  const leadHeadings = FIXTURE.match(/^### \*\*LEAD \d+:/gm) ?? [];
  must(leadHeadings.length === 19, `the fixture should carry 19 lead headings, found ${leadHeadings.length}`);
  must(FIXTURE.includes("(9/20: I3 Im1 C3 N2)"), "the fixture no longer carries a score code to strip");
  for (const noisy of NOISY) {
    must(FIXTURE.includes(noisy), `the fixture no longer writes "${noisy.slice(0, 40)}…"`);
  }

  must(!read.some((c) => c.headline.includes("**")), "a headline still carries a markdown marker");
  must(
    !read.some((c) => /\(\d+\/20[:)]/.test(c.headline)),
    "a headline still carries the scanner's score code",
  );
  for (const [index, headline] of CLEAN.entries()) {
    must(
      read.some((c) => c.headline === headline),
      `no card for "${headline}", the clean reading of ${(NOISY[index] ?? "").slice(0, 30)}…`,
    );
  }
  /*
    A card's arrival has two honest shapes now that the two 0.6.63 lanes are
    merged, and this step holds both: the section the chooser read out of the
    text, or the review screen's own "Section not chosen — pick one" marker
    (value "", from `suggestedSectionFromText`, import-stories.ts:686).

    This step used to demand a section on every card, because the chooser this
    branch forked always named something. That is the silent guess lane 1's
    Unit P removed from the write box, and the import is the third caller of
    that same one chooser, so demanding a section here would be demanding the
    guess back. The claim is not weakened, it is corrected and made narrower:
    no card may arrive with a value that is neither a section this screen
    offers nor the marker, and the chooser must still place the report's own
    leads -- measured on this fixture, 33 of the 38 cards arrive with a named
    section across 9 different sections, so a chooser that had given up on
    everything would fail the two checks below rather than pass them.
  */
  const sectionKeys = await page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll("li select option")].map((o) => o.value).filter(Boolean),
      ),
    ],
  );
  must(
    sectionKeys.length >= 8,
    `the section select offers only ${sectionKeys.length} sections: ${sectionKeys.join(", ")}`,
  );
  const offered = new Set(sectionKeys);
  const cards = read.filter((c) => c.kind !== "Not a story — import it anyway?");
  for (const card of cards) {
    must(
      card.section === "" || offered.has(card.section),
      `"${card.headline}" arrived with "${card.section}", which is neither a section this screen offers nor the not-chosen marker`,
    );
  }
  const placed = cards.filter((c) => offered.has(c.section));
  must(
    placed.length >= 20,
    `only ${placed.length} of ${cards.length} cards arrived with a section the chooser named`,
  );
  must(
    new Set(placed.map((c) => c.section)).size >= 3,
    "the chooser put every card it placed under one section",
  );
  step(
    `thirty-eight cards: ${TICKED} leads ticked, ${SECTIONS} sections not, every headline clean, ${placed.length} cards placed by the chooser and ${cards.length - placed.length} left to the editor`,
  );
}

/** The Hold flags, and the three demoted leads opening as unticked ideas. */
async function theHoldsAreVisible() {
  const read = await cardFacts();
  const held = read.filter((c) => c.holdFlag);
  must(held.length === HOLDS, `${held.length} cards wear the Hold flag, ${HOLDS} expected`);

  for (const headline of DEMOTED) {
    const card = read.find((c) => c.headline === headline);
    must(Boolean(card), `no card for the demoted lead "${headline.slice(0, 40)}…"`);
    must(card.kind === "Import this idea", "a demoted lead is not offered as a story idea");
    must(!card.checked, "a demoted lead arrived ticked, as if the report had not dropped it");
    must(card.holdFlag, "a demoted lead arrived without its Hold flag");
    must(/Triage: Demote/.test(card.text), "the report's own Demote triage was not carried onto the card");
  }
  const heldTicked = read.filter((c) => c.holdFlag && c.checked);
  must(
    heldTicked.length === HOLDS - DEMOTED.length - 1,
    "the held leads and the held section are not the ticked cards wearing the flag",
  );
  step(`twelve Hold flags; the three demoted leads open unticked, as ideas, with Hold on`);
}

/** The documents the report cited with no page to open, listed on the card. */
async function theTextSourcesAreListed() {
  const card = cardFor(CLEAN[0]);
  await card.waitFor({ timeout: 30_000 });
  const text = ((await card.evaluate((el) => el.textContent)) ?? "").replace(/\s+/g, " ");
  must(
    text.includes(`Named, not linked — ${FIRST_CITATIONS.length} the report cited`),
    `the card's text sources are not listed as names; it reads: ${text.slice(0, 400)}`,
  );
  for (const citation of FIRST_CITATIONS) {
    must(text.includes(citation.replace(/\s+/g, " ")), `the card is missing the cited document "${citation}"`);
  }
  step("the first lead lists the three documents the report named and did not link");
}

/** Tick three stories and two ideas, and nothing else. */
async function theEditorPicksFive() {
  const keep = new Set([...AS_STORY, ...AS_IDEA]);
  const read = await cardFacts();
  for (const card of read) {
    if (card.checked && !keep.has(card.headline)) {
      await page.locator(`#tick-${card.key}`).uncheck();
    }
  }
  // The second idea is the editor's own call: a 10/20 lead with a paragraph
  // under it, offered as a story, switched on its card to a story idea.
  const card = cardFor(AS_IDEA[1]);
  await card.locator('input[name^="kind-"]').nth(1).check();
  must(
    (await card.locator('input[name^="kind-"]').nth(1).isChecked()),
    "the card did not take the Story idea the editor chose for it",
  );

  const after = await cardFacts();
  const ticked = after.filter((c) => c.checked);
  must(ticked.length === 5, `${ticked.length} cards are ticked, 5 expected`);
  must(
    ticked.filter((c) => c.kind === "Import this idea").length === 2,
    "the two ideas are not both offered as ideas",
  );
  await page
    .getByText("5 ticked · 5 ready to import", { exact: false })
    .first()
    .waitFor({ timeout: 30_000 });
  step("three stories and two ideas are ticked; the rest are left behind");
}

/** Import, and the five land on the Queue: three drafted, two waiting. */
async function theFiveLandOnTheQueue() {
  const button = page.getByRole("button", { name: /^Import 3 stories and 2 story ideas to the Queue$/ });
  await button.waitFor({ timeout: 30_000 });
  await button.click();
  await page.getByRole("heading", { name: "In the Queue", exact: true }).waitFor({ timeout: 60_000 });

  const panel = page.locator("section", {
    has: page.getByRole("heading", { name: "In the Queue", exact: true }),
  });
  const listed = await panel.innerText();
  for (const headline of [...AS_STORY, ...AS_IDEA]) {
    must(listed.includes(headline), `"${headline.slice(0, 40)}…" is missing from the import result panel`);
  }
  must(
    (listed.match(/— a story idea, on the Queue to write/g) ?? []).length === 2,
    "the result panel does not mark exactly two of the five as story ideas to write",
  );
  await page
    .locator('[role="status"]')
    .filter({ hasText: "3 stories and 2 story ideas in the Queue, marked Imported. Nothing is published." })
    .first()
    .waitFor({ timeout: 15_000 });
  step("three stories and two ideas import; the desk says what each of them is");

  await panel.getByRole("link", { name: "Open the Queue", exact: true }).click();
  await page.waitForURL(/\/desk\/queue/, { timeout: 30_000 });
  await page.locator(".chip.imported").first().waitFor({ timeout: 45_000 });
  const imported = await page.locator(".chip.imported").count();
  must(imported === 5, `the Queue shows ${imported} Imported leads, expected 5`);

  for (const headline of AS_STORY) {
    const row = page.locator(".lead-row", { hasText: headline });
    must((await row.count()) === 1, `the imported story "${headline.slice(0, 40)}…" is not on the Queue`);
    /*
      The desk's own word for all five is "new", drafted among them or not: an
      import is text the desk read out of a report, not a draft its own writer
      produced, so nothing here carries `drafted` (the X walk measured the same
      thing on the Codex report: six imported, `drafted 0`). What tells a
      finished story from a story idea is the draft underneath it, which the
      next two steps open and read.
    */
    must(
      (await row.locator(".chip.st-new").count()) === 1,
      "an imported story is on the Queue without the desk's own status chip",
    );
    must(
      (await row.locator(".chip.st-drafted").count()) === 0,
      "an imported story is on the Queue wearing the drafted status",
    );
  }
  for (const headline of AS_IDEA) {
    const row = page.locator(".lead-row", { hasText: headline });
    must((await row.count()) === 1, `the imported idea "${headline.slice(0, 40)}…" is not on the Queue`);
    // An idea stops at the lead: new, waiting for someone to write it.
    must(
      (await row.locator(".chip.st-new").count()) === 1,
      "an imported idea is not on the Queue as a new lead",
    );
    must(
      (await row.locator(".chip.st-drafted").count()) === 0,
      "an imported idea arrived drafted, as if a story had been written for it",
    );
  }
  /*
    Taken here, while all five are on the Queue: the picture is supposed to show
    the three with the report's text under them and the two waiting, and a
    later visit would show only what is still there.
  */
  facts.push(await screenshot("queue-1280-light.png", 1280, 900, ".chip.imported"));
  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the Queue after the import"));
  facts.push(await screenshot("queue-375-light.png", 375, 720, ".chip.imported"));
  await page.setViewportSize({ width: 1280, height: 900 });
  step("the Queue shows five Imported leads, three of them with a story behind them");
}

/**
 * A lead's own page, with its inspector on Reporting -- where the lead's own
 * description sits. The inspector opens on Checks, so `.side-why` is in the
 * page but `hidden` until that tab is chosen; a hidden element has no inner
 * text to read.
 */
async function openTheLead(headline) {
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const row = page.locator(".lead-row", { hasText: headline });
  await row.first().waitFor({ timeout: 45_000 });
  await row.getByRole("link", { name: headline, exact: true }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });
  await page.locator("#inspector-tab-reporting").click();
  const why = page.locator(".side-why");
  await why.waitFor({ timeout: 45_000 });
  return why;
}

/** A finished story opens with the report's own text already in the draft. */
async function theStoryIsFiledWithItsDraft() {
  const row = page.locator(".lead-row", { hasText: AS_STORY[0] });
  await row.getByRole("link", { name: AS_STORY[0], exact: true }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });
  const body = page.getByLabel("Body");
  await body.waitFor({ timeout: 45_000 });
  const text = await body.inputValue();
  must(
    text.includes(FIRST_SENTENCE),
    `the imported story's draft does not hold the report's own text; it reads: ${text.slice(0, 200)}`,
  );
  /*
    The report's own dek came across with the text. The Sources line did not,
    and must not: the reader lifts it into the lead's sources as names, so the
    body is the report's prose and nothing else.
  */
  const dek = await page.getByLabel("Dek").inputValue();
  must(
    dek.includes(FIRST_DEK),
    `the imported story's dek is not the report's own line under the headline; it reads: ${dek.slice(0, 160)}`,
  );
  must(
    !text.includes(FIRST_CITATIONS[0]),
    "the imported story's draft still carries the report's Sources line in its body",
  );
  const said = await page.locator("body").innerText();
  must(!said.includes("No draft yet."), "the imported story's lead still says it has no draft");
  step("the imported story opens with the report's own text already in the draft");
}

/** An idea's lead page carries the report's own description and no draft. */
async function theIdeaIsALeadToWrite() {
  const why = await openTheLead(IDEA_TO_OPEN);
  must(
    (await why.innerText()).trim().includes(IDEA_WHY),
    `the idea's lead does not carry the report's own description as its why: "${IDEA_WHY}"`,
  );
  const said = await page.locator("body").innerText();
  must(
    said.includes("No draft yet."),
    "the idea's lead page does not offer to draft it — it is a lead waiting to be written",
  );
  step("the idea opens as a lead: the report's description as its why, and no draft yet");
}

/** Nothing is published by an import. */
async function nothingPrinted() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const paper = await page.locator("body").innerText();
  for (const headline of [...AS_STORY, ...AS_IDEA]) {
    must(
      !paper.includes(headline),
      `"${headline.slice(0, 40)}…" is on the public paper before any editor published it`,
    );
  }
  step("nothing is published: the paper does not carry the imported leads");
}

/** No sideways scroll, and the type an editor has to read is not shrunk below 14px. */
async function fitsAt375(note, enforceType = false) {
  const measured = await page.evaluate((enforce) => {
    const size = (el) => Number.parseFloat(getComputedStyle(el).fontSize);
    const own = enforce
      ? [
          ...document.querySelectorAll(
            'ul:has(> li > div > input[id^="tick-"]) label, ul:has(> li > div > input[id^="tick-"]) p',
          ),
        ]
      : [];
    const limit = window.innerWidth + 1;
    return {
      over: document.documentElement.scrollWidth - window.innerWidth,
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
      `${measured.under} labels or paragraphs on the review screen are under 14px ` +
        `(smallest ${measured.smallest}px)`,
    );
  }
  step(`${note} fits 375px${enforceType ? `, its labels and paragraphs at ${measured.smallest}px` : ""}`);
  return measured;
}

/** One screenshot of a finished page, its colours measured and printed. */
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
  const cardHeadline = 'label[for^="tick-"] > span.block';

  // The review screen, with a demoted lead's card framed: the card the whole
  // read is judged on -- an idea, unticked, wearing the Hold flag.
  await page.goto(`${base}/desk/import`, { waitUntil: "networkidle" });
  await page.getByLabel("Paste the report or the story").fill(FIXTURE);
  await page.getByRole("button", { name: "Read the stories", exact: true }).click();
  await page
    .getByRole("heading", { name: "Check every story", exact: true })
    .waitFor({ timeout: 60_000 });
  const demotedIndex = await page.locator(cardHeadline).evaluateAll((els) =>
    els.findIndex((el) => /^Story idea: Water Board, Sept 21/.test((el.textContent ?? "").trim())),
  );
  must(demotedIndex >= 0, "no card on the review screen for the first demoted lead");

  facts.push(await screenshot("review-1280-light.png", 1280, 900, cardHeadline, demotedIndex));
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForTimeout(400);
  facts.push(await screenshot("review-1280-dark.png", 1280, 900, cardHeadline, demotedIndex));
  await page.getByRole("button", { name: "Switch to light appearance" }).click();
  await page.waitForTimeout(400);

  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the import review screen", true));
  facts.push(await screenshot("review-375-light.png", 375, 720, cardHeadline, demotedIndex));

  // One idea's lead page: the description as its why, and no draft on it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTheLead(IDEA_TO_OPEN);
  facts.push(await screenshot("idea-lead-1280-light.png", 1280, 900, ".side-why"));
  await page.setViewportSize({ width: 375, height: 720 });
  facts.push(await fitsAt375("the idea's lead page"));
  facts.push(await screenshot("idea-lead-375-light.png", 375, 720, ".side-why"));
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
    await theReportIsRead();
    await theHeadlinesAreClean();
    await theHoldsAreVisible();
    await theTextSourcesAreListed();
    await theEditorPicksFive();
    await theFiveLandOnTheQueue();
    await theStoryIsFiledWithItsDraft();
    await theIdeaIsALeadToWrite();
    await nothingPrinted();
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
