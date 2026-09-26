#!/usr/bin/env node
/**
 * Paste one story I already have, in a browser: one paste, one Add to Queue,
 * then edit it, confirm its section and publish it like any other story -- the
 * confirmation being the press on a button that names the section (0.6.67).
 *
 * The owner's need, in his own words (2026-09-24): "the same function in opinion
 * that just lets me paste in an already written story, just one, to dump in the
 * queue, as a regular non-opinion story for massaging later via the queue."
 *
 * This walk drives that whole path on the built server, in this process, on its
 * own port and its own in-memory PGlite (never Postgres: DATABASE_URL is
 * cleared below). No model is ever started: the paste is not read at all, it is
 * filed as it stands.
 *
 * What it proves, in order:
 *
 *   - the Desk offers the one-story paste beside "Import finished stories", in
 *     the owner's own words, with the section left unchosen and the disclosure
 *     defaulting to a person;
 *   - a section left unchosen is asked for again, in the review screen's own
 *     words, and nothing is filed -- a draft has no "no section" state;
 *   - one paste and one click files a draft -- the confirmation says nothing is
 *     published, and the paper does not carry it;
 *   - the Queue row is marked Imported: it is the same import path, not a
 *     second one;
 *   - the draft holds the paste word for word with the first line as its
 *     headline and not repeated as the body's first line (step G), and the
 *     sentence the editor edits is the sentence the reader gets;
 *   - a pasted story arrives with its section UNCONFIRMED, the desk names the
 *     section on the Publish button and says the press is what confirms it,
 *     and the server refuses the same publish when no section is carried at
 *     all -- so a paste cannot print under a section nobody confirmed;
 *   - a pasted story with a cited page prints it under Sources beneath FOLLOW
 *     THE EVIDENCE; a pasted story with none prints no such heading and says in
 *     words that there are no source records (coordinator review of the Unit X
 *     screenshots, 2026-09-24: an empty heading under a published story);
 *   - the second paste warns that it looks like the printed one, as a link on
 *     the confirmation, after the add.
 *
 *   node scripts/paste-one-story-e2e.mjs
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { fromCrossJSON, toJSONAsync } from "seroval";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_PASTE_ONE_STORY = 3315;

const REPO = process.cwd();
const SHOTS = "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/scratch/X2";
const base = checkedUrl(`http://127.0.0.1:${PORT_PASTE_ONE_STORY}`);

/**
 * The story the editor pastes, written the way a person writes one: a headline
 * line, paragraphs, and the page it leans on left in the sentence.
 */
const STORY = [
  "Longmont council revives the hospitality licence question",
  "",
  "The council voted 5-2 on Tuesday to bring the rules back for a second reading.",
  "",
  "Staff said the packet would follow before the next vote. [The council packet](https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1)",
].join("\n");
/** The paste's first line, which is the headline when none is typed. */
const FIRST_LINE = "Longmont council revives the hospitality licence question";
/**
 * The text the draft holds: the paste with the line that became the headline
 * taken off the top (step G). Every other line is byte for byte as pasted.
 */
const BODY = STORY.split("\n").slice(2).join("\n");
/** One sentence in the middle of the paste, which the editor rewrites. */
const BEFORE_EDIT =
  "The council voted 5-2 on Tuesday to bring the rules back for a second reading.";
const AFTER_EDIT =
  "The council voted 6-1 on Tuesday to bring the rules back for a second reading.";
/** The page the pasted story cites, which must be a working link under Sources. */
const CITED =
  "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=16823&compileOutputType=1";

/**
 * The second paste: no links at all, and a headline close enough to the first
 * story's that the desk warns -- which is what the editor sees before retitling.
 */
/** The second paste's first line, which is what the desk warns the editor about. */
const SECOND_LINE = "Longmont council takes the hospitality licence rules up again";
const SECOND = [
  SECOND_LINE,
  "",
  "The second reading is set for the council's next regular meeting.",
  "",
  "Two members asked for the sales figures first, and staff said they would come with the packet.",
].join("\n");
/** The second draft's text: its paste with its own headline line taken off. */
const SECOND_BODY = SECOND.split("\n").slice(2).join("\n");
/** What the editor retitles the second story to, after the duplicate warning. */
const SECOND_TITLE = "Hospitality licence rules come back for a second reading";

/** The line the panel defaults to, and the line a reader must see on the paper. */
const PERSON_LINE = "A person wrote this from public records; an editor reviewed it.";
/** The desk's own AI line, which would be a lie over a story no model touched. */
const DESK_AI_LINE = "AI tools helped find records and write the first draft";
/** What the page says when a story carries no separate source records. */
const NO_RECORDS = "No separate public source records are attached to this story.";
/** The heading that must not print above an empty section. */
const EVIDENCE_HEADING = "follow the evidence";

const stamp = Date.now();
const email = `paste-one-${stamp}@townreporter.test`;
const password = "paste-one-story-e2e-pass";

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
  process.env.PORT = String(PORT_PASTE_ONE_STORY);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "paste-one-story-e2e-secret";
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
  await page.getByLabel("Name").fill("Paste Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/** Every option of a select, so the walk never hardcodes a newsroom's sections. */
function optionsOf(select) {
  return select
    .locator("option")
    .evaluateAll((els) => els.map((el) => ({ value: el.value, name: (el.textContent ?? "").trim() })));
}

function pastePanel() {
  return page.locator("#paste-one-story");
}

/** Wait for a control to stop being disabled, so the click lands on a live one. */
async function waitForEnabled(locator, timeout = 30_000) {
  const handle = await locator.elementHandle();
  await page.waitForFunction((el) => el && !el.disabled, handle, { timeout });
}

/** The Desk offers one-story paste beside the import, in the owner's words. */
async function theDeskOffersTheOneStoryPaste() {
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  const panel = pastePanel();
  await panel.waitFor({ timeout: 45_000 });
  await panel.getByRole("heading", { name: "Paste a story I already have", exact: true }).waitFor();
  // Beside, not instead of: the report import is still the other way in.
  await page
    .locator("#import-story")
    .getByRole("heading", { name: "Import finished stories", exact: true })
    .waitFor();

  // textContent, not innerText: the eyebrows are uppercased by the stylesheet,
  // and it is the source wording this walk is checking.
  const said = (await panel.evaluate((el) => el.textContent)) ?? "";
  must(
    said.includes("One finished story. It goes to the Queue as a draft for you to work on there."),
    "the panel does not say what one paste does",
  );
  must(
    /no AI reads it/i.test(said),
    "the panel does not promise that no model reads the paste",
  );
  must(
    !!said.match(/never opinion|non-opinion|news draft/i),
    "the panel does not say the pasted story is a regular news story",
  );

  const section = page.locator("#paste-one-section");
  must(
    (await section.inputValue()) === "",
    "the section select does not start unchosen, so a paste would be filed under a guess",
  );
  const firstOption = ((await section.locator("option").first().textContent()) ?? "").trim();
  must(
    firstOption === "Section not chosen — pick one",
    `the unchosen option reads "${firstOption}"`,
  );
  must(
    (await page.locator("#paste-one-disclosure").inputValue()) === "person",
    "the disclosure does not default to the honest line for a story a person wrote",
  );
  must(
    said.includes(PERSON_LINE),
    "the panel does not show the line that will print under the story",
  );
  const button = panel.getByRole("button", { name: "Add to Queue", exact: true });
  must((await button.count()) === 1, "there is no single Add to Queue button");
  must(await button.isDisabled(), "Add to Queue is live with nothing pasted into the box");
  step("the Desk offers the one-story paste beside the import, section unchosen");
}

/**
 * One paste, one click. The story is added to the Queue as a draft; nothing is
 * published; the box is emptied for the next one.
 */
async function pasteOneStoryAndAddIt(sectionChoice) {
  const panel = pastePanel();
  await page.locator("#paste-one-text").fill(STORY);
  if (sectionChoice) await page.locator("#paste-one-section").selectOption(sectionChoice.value);
  const button = panel.getByRole("button", { name: "Add to Queue", exact: true });
  await waitForEnabled(button, 30_000);
  await button.click();

  const said = panel.locator('[role="status"]').filter({ hasText: "Added to the Queue" });
  await said.first().waitFor({ timeout: 45_000 });
  const text = (await said.first().innerText()).replace(/\s+/g, " ").trim();
  must(
    text.includes("Added to the Queue as a draft. Nothing is published."),
    `the confirmation does not say nothing was published: "${text}"`,
  );
  const open = panel.getByRole("link", { name: "Open it", exact: true });
  must((await open.count()) === 1, "the confirmation has no link to open the draft");
  const href = (await open.getAttribute("href")) ?? "";
  must(/^\/desk\/story\/\d+$/.test(href), `the confirmation link goes to "${href}"`);
  must(
    (await page.locator("#paste-one-text").inputValue()) === "",
    "the paste box was not emptied after the add",
  );
  step(`one paste, one click: the story is a draft in the Queue (${href})`);
  return { href, text };
}

/** Nothing is published by a paste. The paper does not have this story. */
async function nothingPrinted() {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const paper = await page.locator("body").innerText();
  must(
    !paper.includes(FIRST_LINE),
    "a pasted story is on the public paper before any editor published it",
  );
  step("nothing is published: the paper does not carry the pasted story");
}

/** The Queue marks it Imported, and the draft holds the paste word for word (headline line off). */
async function theDraftHoldsThePasteWordForWord(sectionChoice, expectedTitle = FIRST_LINE) {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  const row = page.locator(".lead-row", { hasText: expectedTitle });
  await row.waitFor({ timeout: 45_000 });
  must(
    (await row.locator(".chip.imported").count()) === 1,
    "the pasted story is on the Queue without the Imported mark, so it is not the import path",
  );
  await row.getByRole("link", { name: expectedTitle, exact: true }).click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });

  const headline = page.locator(".astra-headline");
  await headline.waitFor({ timeout: 45_000 });
  must(
    (await headline.inputValue()).trim() === expectedTitle,
    "the first line of the paste did not become the headline",
  );

  const body = page.locator(".astra-story-body");
  await body.waitFor({ timeout: 30_000 });
  const held = await body.inputValue();
  /*
    Step G: the draft holds the paste with the line that became the headline
    taken off the top, and nothing else moved.
  */
  const expectedBody = expectedTitle === FIRST_LINE ? BODY : SECOND_BODY;
  must(
    held === expectedBody,
    `the draft does not hold the paste minus its headline line, word for word: ` +
      `${held.length} characters against ${expectedBody.length} expected (first difference at ` +
      `${[...held].findIndex((c, i) => c !== expectedBody[i])})`,
  );
  must(
    !held.startsWith(expectedTitle),
    "the headline line is repeated as the draft body's first line",
  );

  const topic = page.locator("#story-topic select");
  const topicValue = await topic.inputValue();
  if (sectionChoice) {
    must(
      topicValue === sectionChoice.value,
      `the section chosen on the Desk did not reach the story: "${topicValue}"`,
    );
  } else {
    must(
      topicValue === "",
      `a paste whose section was left unchosen arrived filed under "${topicValue}"`,
    );
  }
  step(
    `the Queue row is Imported and the draft is the paste, word for word, headline line off` +
      (sectionChoice ? `, filed under "${sectionChoice.name}"` : `, with no section chosen`),
  );
  return { headline, body };
}

/** The editor rewrites one sentence and saves it, as desk work. */
async function theEditorEditsASentence(bodyField) {
  await bodyField.fill(BODY.replace(BEFORE_EDIT, AFTER_EDIT));
  await page
    .locator(".astra-save-state")
    .filter({ hasText: "Unsaved changes" })
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Save edits", exact: true }).click();
  await page
    .locator(".astra-save-state")
    .filter({ hasText: "Saved draft" })
    .waitFor({ timeout: 45_000 });
  must(
    (await bodyField.inputValue()).includes(AFTER_EDIT),
    "the edit did not stay in the editor after saving",
  );
  step("the editor edits one sentence and saves the draft");
}

/** The lead the story page is showing, read off its own URL. */
function leadIdOnScreen() {
  const found = /\/desk\/story\/(\d+)/.exec(page.url());
  must(found, `the story page is not a story page: ${page.url()}`);
  return Number(found[1]);
}

/**
 * Ask the server to publish without a section, and read back its refusal.
 *
 * This is the caller shape an older desk sent -- the bare leadId, before
 * 0.6.67 taught the request to carry the section (`cleanPublishRequest`:
 * "an absent topic means 'unconfirmed', never 'confirmed blank'"). It is the
 * only way to put the paste's central question to the server itself rather
 * than to a disabled button.
 */
async function theServerRefusesAPublishWithNoSection(publishUrl, leadId) {
  const body = JSON.stringify(await toJSONAsync({ data: { leadId } }));
  const answer = await page.evaluate(
    async ({ url, payload }) => {
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-tsr-serverFn": "true",
        },
        body: payload,
      });
      return {
        status: res.status,
        serialized: res.headers.has("x-tss-serialized"),
        body: await res.json(),
      };
    },
    { url: publishUrl, payload: body },
  );
  must(answer.status === 200, `the publish server function answered HTTP ${answer.status}`);
  const decoded = answer.serialized ? fromCrossJSON(answer.body, {}) : answer.body;
  const result = decoded?.result ?? decoded;
  must(
    result?.ok === false,
    `the server printed a story with no confirmed section: ${JSON.stringify(result)}`,
  );
  must(
    /no editor has confirmed that for the version being printed/.test(String(result.error)),
    `the server refused, but not for the unconfirmed section: "${result.error}"`,
  );
  step("the server refuses to print the pasted story with no section confirmed");
  return result.error;
}

/**
 * The section is confirmed by the press that names it, and by nothing else.
 *
 * 0.6.67 removed the separate "Confirm this section" button. The Publish
 * button now reads "Publish in <section>" and the request carries that
 * section, which the server records for the version it prints (desk.ts,
 * performPublish). A pasted story is no exception: it arrives with no
 * confirmation of its own, and this proves that in the two places it can be
 * proved -- the desk names the section on the button and says the press is
 * what confirms it, and the server refuses the same publish when no section is
 * carried at all.
 */
async function publishIt() {
  const publishButton = page.getByRole("button", { name: /^Publish in / });
  await publishButton.waitFor({ timeout: 45_000 });
  must(
    (await page.getByRole("button", { name: "Confirm this section", exact: true }).count()) === 0,
    "a second Confirm step is back on the story page, so this walk proves nothing about the new one",
  );
  must(
    (await page.getByText(/Section confirmed for this saved draft/).count()) === 0,
    "the pasted story arrived with its section already confirmed, so nothing was confirmed here",
  );
  const said = ((await page.locator("#story-topic").innerText()) ?? "").replace(/\s+/g, " ");
  must(
    said.includes("The Publish button names") &&
      said.includes("confirms the section for the version being printed"),
    `the desk does not say the press is what confirms the section: "${said}"`,
  );
  must(
    await publishButton.isEnabled(),
    "the desk is holding Publish down for a story nothing is blocking",
  );
  const named = (await publishButton.innerText()).replace(/\s+/g, " ").trim();
  step(`the pasted story arrives unconfirmed, with "${named}" as the way to confirm it`);

  /*
    The desk's own publish request is taken and thrown away before it leaves:
    the story must still be a draft when the server is asked the unconfirmed
    question below, and the request's address is the only way to ask it. The
    draft save the same press fires is let through -- it carries the headline
    and the body, which is how the publish request is told apart from it.
  */
  const leadId = leadIdOnScreen();
  let publishUrl = null;
  const taken = [];
  const holdThePublish = async (route) => {
    const request = route.request();
    const payload = request.postData() ?? "";
    if (request.method() === "POST" && request.headers()["x-tsr-serverfn"] === "true") {
      taken.push(payload);
      if (payload.includes("leadId") && !payload.includes("headline")) publishUrl = request.url();
      if (publishUrl && request.url() === publishUrl) {
        await route.abort();
        return;
      }
    }
    await route.continue();
  };
  await page.route("**/*", holdThePublish);
  await publishButton.click();
  await page.getByRole("button", { name: /^Yes, print it in / }).click();
  for (let i = 0; i < 60 && !publishUrl; i += 1) await new Promise((r) => setTimeout(r, 500));
  await page.unroute("**/*", holdThePublish);
  must(
    Boolean(publishUrl),
    `the desk never sent a publish request this walk could refuse: ${JSON.stringify(taken.slice(0, 4))}`,
  );

  await theServerRefusesAPublishWithNoSection(publishUrl, leadId);

  // Nothing printed: a refused publish leaves the story a draft.
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  await page.locator(".lead-row", { hasText: FIRST_LINE }).first().waitFor({ timeout: 45_000 });
  step("the refused publish printed nothing: the story is still a draft in the Queue");

  // Now the press that names the section, which is the confirmation itself.
  await page.goto(`${base}/desk/story/${leadId}`, { waitUntil: "networkidle" });
  const button = page.getByRole("button", { name: /^Publish in / });
  await button.waitFor({ timeout: 45_000 });
  await button.click();
  // The desk asks once more before it goes out, and names the section again.
  await page.getByRole("button", { name: /^Yes, print it in / }).click();
  const read = page.getByRole("link", { name: "Read it on the paper", exact: true });
  await read.waitFor({ timeout: 60_000 });
  const href = (await read.getAttribute("href")) ?? "";
  must(/^\/articles\//.test(href), `the published story links to "${href}"`);
  step("the press that names the section is the confirmation, and it publishes the story");
  return href;
}

/** The reader gets the edited sentence, the cited page, and the honest line. */
async function theReaderGetsTheStory(printed, sectionChoice) {
  await page.goto(new URL(printed, base).href, { waitUntil: "networkidle" });
  await page.locator(".articlehead h1").waitFor({ timeout: 45_000 });
  must(
    (await page.locator(".articlehead h1").innerText()).trim() === FIRST_LINE,
    "the published headline is not the paste's first line",
  );
  must(
    (await page.locator(".articlehead .tag").innerText()).trim().toLowerCase() ===
      sectionChoice.name.toLowerCase(),
    "the section the editor chose is not the section the paper files the story under",
  );

  const body = await page.locator("#story-body").innerText();
  must(body.includes(AFTER_EDIT), "the edited sentence is not on the published page");
  must(!body.includes("voted 5-2"), "the sentence the editor replaced was published as well");
  must(!body.includes("]("), "the raw markdown of the paste's link was printed to the reader");

  // The link the paste carried is a working link in the sentence that named it,
  // and the same page is listed under Sources.
  const inBody = await page
    .locator("#story-body a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  must(inBody.includes(CITED), `the link the story leaned on is not a link in the story: ${inBody}`);
  const sources = await page
    .locator("#sources a")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  must(sources.includes(CITED), "the cited page is not a working link under Sources");

  const sourcesText = (await page.locator("#sources").innerText()).toLowerCase();
  must(
    sourcesText.includes(EVIDENCE_HEADING),
    "a story with a source record does not print the heading over it",
  );
  const printedPage = await page.locator("body").innerText();
  must(printedPage.includes(PERSON_LINE), "the disclosure line the desk showed did not print");
  must(!printedPage.includes(DESK_AI_LINE), "the desk's own AI line printed over a pasted story");
  step("the reader gets the story as pasted, its cited page and the honest line");
}

/**
 * The second paste: a plain story with no links. Its section is left unchosen
 * first, which is refused, and then chosen -- and the desk warns that it looks
 * like the story already printed.
 *
 * The refusal is here because the first version of this panel let an unchosen
 * section through, and the database refused the draft underneath it: no draft
 * can be filed without a section, so the question is asked again instead.
 */
async function theSecondPasteAsksForASectionThenWarns(sectionChoice) {
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  const panel = pastePanel();
  await panel.waitFor({ timeout: 45_000 });
  await page.locator("#paste-one-text").fill(SECOND);
  const button = panel.getByRole("button", { name: "Add to Queue", exact: true });
  await waitForEnabled(button, 30_000);

  // Left unchosen: the story is not added, and the desk says why, in the words
  // the import review screen uses for the same problem.
  await button.click();
  const refused = panel.locator('[role="status"]').filter({ hasText: "Section not chosen" });
  await refused.first().waitFor({ timeout: 30_000 });
  must(
    (await refused.first().innerText()).includes("Section not chosen — pick one"),
    "the refusal does not ask for the section in the review screen's own words",
  );
  must(
    (await page.locator("#paste-one-text").inputValue()) === SECOND,
    "the refused paste was thrown away instead of being kept for the editor",
  );
  must(
    (await panel.locator('[role="status"]').filter({ hasText: "Added to the Queue" }).count()) === 0,
    "the story was added even though its section was left unchosen",
  );
  step("a paste with no section is refused, in the review screen's words, and kept");

  // Chosen, and the same click now files it.
  await page.locator("#paste-one-section").selectOption(sectionChoice.value);
  await waitForEnabled(button, 30_000);
  await button.click();

  const said = panel.locator('[role="status"]').filter({ hasText: "Added to the Queue" });
  await said.first().waitFor({ timeout: 45_000 });
  const text = (await said.first().innerText()).replace(/\s+/g, " ").trim();
  must(
    text.includes("already published as") && text.includes(FIRST_LINE),
    `the confirmation does not warn that it looks like the printed story: "${text}"`,
  );
  const printedLink = panel.getByRole("link", { name: "Read the printed one", exact: true });
  must(
    (await printedLink.count()) === 1,
    "the duplicate warning carries no link to the story it says this looks like",
  );
  must(
    /^\/articles\//.test((await printedLink.getAttribute("href")) ?? ""),
    "the duplicate warning's link does not go to the printed story",
  );
  // The warning is after the add, never instead of it: the story is in the Queue.
  const open = panel.getByRole("link", { name: "Open it", exact: true });
  must((await open.count()) === 1, "the duplicate warning replaced the Open it link");
  facts.push(await screenshot("paste-one-added-1280-light.png", 1280, 900, '#paste-one-story [role="status"]'));
  step("the second paste is added, and the warning about the printed story follows it");
}

/** A story with no source records prints no heading over an empty section. */
async function aStoryWithNoRecordsPrintsNoHeading(printed, sectionChoice) {
  await page.goto(new URL(printed, base).href, { waitUntil: "networkidle" });
  await page.locator(".articlehead h1").waitFor({ timeout: 45_000 });
  const sources = page.locator("#sources");
  await sources.waitFor({ timeout: 30_000 });
  const text = await sources.innerText();
  must(
    !text.toLowerCase().includes(EVIDENCE_HEADING),
    "the published page prints FOLLOW THE EVIDENCE with nothing under it",
  );
  must(
    text.includes(NO_RECORDS),
    "the page neither shows evidence nor says there is none, so the reader is left with a blank",
  );
  must(
    (await page.locator(".articlehead h1").innerText()).trim() === SECOND_TITLE,
    "the retitled story did not print under the headline the editor gave it",
  );
  // The section moved in the story editor is the section the paper files it
  // under: a pasted story is editable and re-sectionable like any other.
  must(
    (await page.locator(".articlehead .tag").innerText()).trim().toLowerCase() ===
      sectionChoice.name.toLowerCase(),
    `the story printed under a section nobody chose for it (wanted "${sectionChoice.name}")`,
  );
  facts.push(await screenshot("paste-one-no-sources-1280-light.png", 1280, 900, "#sources"));
  step("a story with no source records prints the honest sentence, not an empty heading");
}

/**
 * No sideways scroll, and the type an editor has to read is not shrunk below
 * 14px. The size check runs over the paste panel's own labels and paragraphs --
 * the desk chrome around it is older than this unit and is measured, not gated.
 */
async function fitsAt375(note, enforceType = false) {
  const measured = await page.evaluate((enforce) => {
    const size = (el) => Number.parseFloat(getComputedStyle(el).fontSize);
    const own = enforce
      ? [...document.querySelectorAll("#paste-one-story label, #paste-one-story p")]
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
      `${measured.under} labels or paragraphs in the paste panel are under 14px ` +
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

async function thePictures(sectionChoice) {
  // The panel as the editor meets it, empty and beside the import box.
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  await pastePanel().waitFor({ timeout: 45_000 });
  facts.push(await screenshot("paste-one-story-desk-1280-light.png", 1280, 900, "#paste-one-story-title"));
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForTimeout(400);
  facts.push(await screenshot("paste-one-story-desk-1280-dark.png", 1280, 900, "#paste-one-story-title"));
  await page.getByRole("button", { name: "Switch to light appearance" }).click();
  await page.waitForTimeout(400);
  facts.push(await fitsAt375("the one-story paste panel", true));
  facts.push(await screenshot("paste-one-story-desk-375-light.png", 375, 720, "#paste-one-story-title"));

  // The published story, and the section under it: the cited page beneath the
  // heading that is there because there is something to follow.
  await page.goto(`${base}/desk/published`, { waitUntil: "networkidle" });
  const printedRow = page.locator("li, .pub-row, article").filter({ hasText: FIRST_LINE }).first();
  await printedRow.waitFor({ timeout: 45_000 });
  const readOnPaper = printedRow.getByRole("link", { name: "Read on the paper", exact: true });
  const printed = await readOnPaper.getAttribute("href");
  must(Boolean(printed), "the published story has no link to the paper");
  await page.goto(new URL(printed, base).href, { waitUntil: "networkidle" });
  await page.locator(".articlehead h1").waitFor({ timeout: 45_000 });
  facts.push(await screenshot("paste-one-published-1280-light.png", 1280, 900, ".articlehead h1"));
  facts.push(await screenshot("paste-one-published-sources-1280-light.png", 1280, 900, "#sources"));
  facts.push(await fitsAt375("the published pasted story"));
  facts.push(await screenshot("paste-one-published-375-light.png", 375, 720, ".articlehead h1"));
  return sectionChoice;
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
    await theDeskOffersTheOneStoryPaste();

    // Story one: the section chosen on the Desk, so it reaches the Queue with it.
    const choices = await optionsOf(page.locator("#paste-one-section"));
    const sectionOne = choices.find((o) => o.value === "council") ?? choices[1];
    must(Boolean(sectionOne?.value), `the desk offered no section to choose: ${JSON.stringify(choices)}`);
    await pasteOneStoryAndAddIt(sectionOne);
    await nothingPrinted();
    const { body } = await theDraftHoldsThePasteWordForWord(sectionOne);
    await theEditorEditsASentence(body);
    // The draft the paste made, in the editor an editor works in, while it is
    // still a draft: once it prints it is not in the Queue any more.
    facts.push(await screenshot("paste-one-draft-1280-light.png", 1280, 900, ".astra-story-body"));
    const printed = await publishIt();
    await theReaderGetsTheStory(printed, sectionOne);

    // Story two: no links at all, its section left unchosen first and then
    // chosen, and a headline close enough to the printed story's to be warned
    // about. It is then retitled and moved to another section in the editor.
    const sectionTwo = choices[2] ?? choices[1];
    must(Boolean(sectionTwo?.value), `the desk offered no section to choose: ${JSON.stringify(choices)}`);
    await theSecondPasteAsksForASectionThenWarns(sectionTwo);
    // Once, not twice: the refusal above filed nothing.
    await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
    await page.locator(".lead-row", { hasText: SECOND_LINE }).first().waitFor({ timeout: 45_000 });
    must(
      (await page.locator(".lead-row", { hasText: SECOND_LINE }).count()) === 1,
      "the refused paste was filed after all, so the Queue holds it twice",
    );
    const { body: secondBody } = await theDraftHoldsThePasteWordForWord(sectionTwo, SECOND_LINE);
    await page.locator(".astra-headline").fill(SECOND_TITLE);
    const topics = await optionsOf(page.locator("#story-topic select"));
    const movedTo = topics.find((o) => o.value && o.value !== sectionTwo.value && o.value !== "opinion");
    must(Boolean(movedTo?.value), `the story editor offered no other section: ${JSON.stringify(topics)}`);
    await page.locator("#story-topic select").selectOption(movedTo.value);
    await page.getByRole("button", { name: "Save edits", exact: true }).click();
    await page
      .locator(".astra-save-state")
      .filter({ hasText: "Saved draft" })
      .waitFor({ timeout: 45_000 });
    must(
      (await secondBody.inputValue()) === SECOND_BODY,
      "the second story's text did not survive being retitled and re-sectioned",
    );
    const printedTwo = await publishIt();
    await aStoryWithNoRecordsPrintsNoHeading(printedTwo, movedTo);

    await thePictures(sectionOne);
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
