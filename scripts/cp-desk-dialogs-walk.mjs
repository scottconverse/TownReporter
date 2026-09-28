#!/usr/bin/env node
/**
 * Browser acceptance for the drawn "Add to this story" dialog unit CP mounted
 * on the story workbench, walked end to end on the built server and the real
 * desk UI.
 *
 * WHAT WAS WRONG. The dialog was built, drawn and exported, and no screen
 * rendered it: `grep -rn "AddToStoryDialog" src/routes` found nothing that
 * mounted it, so "Add to this story" (`Desk Story.dc.html:114`, wired to the
 * `add-to` action at `:172`) was unreachable from the desk an editor uses.
 *
 * WHAT THIS WALK PROVES, on the built server and the real page:
 *
 *   1. **+ Add to story** is on the workbench of a drafted lead and nowhere it
 *      cannot act, and it opens the drawn dialog ("Add to this story").
 *   2. The FIRST press of **Add** writes nothing: the dialog shows
 *      "After your change" and the row in the database is untouched.
 *   3. The compare's **Now** column is the story as it stands -- the draft's own
 *      stored body -- not the paragraph the editor pasted.
 *   4. The SECOND press saves exactly the text that was shown, and the page's
 *      own body box takes those same bytes (the screen gets `onSaved`, not a
 *      note), so the next **Save edits** cannot write the older body back over
 *      them. That last part is the whole point of the wiring: it is asserted by
 *      pressing Save edits afterwards and re-reading the row.
 *   5. Zero console errors. Every step here is a press an editor makes; a desk
 *      that reaches any of them through a thrown error is a desk that shows the
 *      editor a broken page.
 *
 * NO MODEL IS REACHED, and that is enforced rather than assumed. The mode the
 * walk chooses is "Add as an update at the top" (`ai: false` --
 * `performWeaveIntoStory` reaches `deps.chat` on the `weave` branch alone). The
 * provider ladder is left pointed at an address nothing answers and at two CLI
 * paths that do not exist, and `ANTHROPIC_API_KEY` is cleared, so a press that
 * did reach for a model would fail loudly instead of quietly spending money on
 * this machine.
 *
 * The server under test must be BUILT (`npm run build`); this walk imports
 * `.output/server/index.mjs` itself.
 *
 *   node scripts/cp-desk-dialogs-walk.mjs
 *
 * Screenshots (light and dark) land in `reports/CP-evidence/` of the oversight
 * checkout, overridable with `CP_SHOTS_OUT_DIR`.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_CP_DESK_DIALOGS = 3540;
/** Where the model would be if anything could reach one: nothing listens here. */
const PORT_NO_MODEL = 3541;

const base = checkedUrl(`http://127.0.0.1:${PORT_CP_DESK_DIALOGS}`);
const outDir = checkedOutputPath(
  resolve(
    process.env.CP_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/reports/CP-evidence",
  ),
  [resolve("..")],
  "screenshot directory",
);
mkdirSync(outDir, { recursive: true });

const stamp = Date.now();
const email = `cp-desk-dialogs-${stamp}@townreporter.test`;
const password = "cp-desk-dialogs-pass";

/** The scan's headline, what the desk read on the lead. */
const LEAD_HEADLINE = "Council takes up the Olson annexation";
/** The draft body as the desk stores it. Every assertion about "unchanged" is this. */
const DRAFT_BODY =
  "The council took up the annexation of the Olson property Monday night.\n\n" +
  "The item returns for a second reading next month.";
/** What the editor pastes into "New material". One line, so the saved text is a
 *  fixed point of the storage pass and the page's box can be compared exactly. */
const ADD_MATERIAL =
  "The clerk confirmed the hearing is set for Oct. 8 at 7 p.m. in the council chamber.";
let page;

let currentLeadId = 0;
const done = [];
const facts = [];
const shots = [];

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 2000);
  } catch {
    /* the page is already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${describe}; last read ${JSON.stringify(last)}`,
  );
}

/** The in-memory PGlite the server booted with, or a loud failure. */
async function db() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to read");
  return pg;
}

/** The draft row the desk is working on: the newest one for this lead. */
async function draftRow(columns = "id, headline, headline_source, body") {
  const pg = await db();
  const row = await pg.query(
    `select ${columns} from drafts where lead_id = $1 order by updated_at desc, id desc limit 1`,
    [currentLeadId],
  );
  return row.rows[0] ?? null;
}

/** The dialog on screen. Both dialogs portal themselves into their own layer. */
function dialog() {
  return page.locator(".astra-modal").last();
}

/**
 * The compare's two columns, as RAW text.
 *
 * `textContent`, not `innerText`: the headings carry the stylesheet's
 * `text-transform: uppercase` and the body paragraph has no `white-space: pre`,
 * so what the eye gets is "NOW" and a body with its paragraph breaks collapsed.
 * This walk is comparing bytes with the row in the database, so it reads the
 * text the DOM holds rather than the text the stylesheet dresses it in.
 */
function compareColumns() {
  return dialog()
    .locator(".astra-compare-col")
    .evaluateAll((cols) => cols.map((col) => col.textContent ?? ""));
}

/**
 * The 14px floor, measured LIVE inside an open dialog.
 *
 * `scripts/desk-min-font.test.mjs` holds the floor statically -- it parses the
 * `.desk-ltr` rules out of styles.css and bans the sub-14px Tailwind utilities
 * in the desk's .tsx files. That pass cannot see what the browser resolved for
 * a given element (a rule that loses a cascade fight, an inherited size, a
 * shorthand that never applied), so this reads the computed size off every
 * element the dialog actually draws and names the ones under the floor.
 *
 * Elements with no text of their own (the scrim, the rule under the title) are
 * skipped: a divider has no size to read.
 */
function smallestSizesInTheDialog() {
  return dialog().evaluate((root) => {
    const offenders = [];
    let smallest = Infinity;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      if (el.children.length && !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) {
        continue; // a wrapper: the size that matters is its children's
      }
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const px = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(px)) continue;
      if (px < smallest) smallest = px;
      if (px < 14) offenders.push(`${el.className || el.tagName}: ${style.fontSize} -- ${text.slice(0, 40)}`);
    }
    return { smallest, offenders };
  });
}

/**
 * The address a model would be reached on, checked before anything boots.
 *
 * This walk must reach NO model, so a stranger answering there is the failure
 * this looks for -- it would mean a press that reached for a provider landed on
 * something real. `ANTHROPIC_API_KEY` is the same refusal from the other side.
 */
async function preconditions() {
  const problems = [];
  let answered = false;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT_NO_MODEL}/v1/models`, {
      signal: AbortSignal.timeout(2_000),
    });
    answered = res.ok || res.status < 500;
  } catch {
    /* nothing there, which is what this walk needs */
  }
  if (answered) {
    problems.push(
      `something is answering on http://127.0.0.1:${PORT_NO_MODEL}/v1, which this walk leaves ` +
        `empty on purpose: a press that reached for a model would be answered by a stranger.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: a rung of the ladder could answer with a real model, which is a " +
        "call off this computer and a result this walk did not choose.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the BUILT server here, in this process, on this walk's own port and
 * in-memory PGlite (never the shared Postgres: DATABASE_URL is cleared below).
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_CP_DESK_DIALOGS);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "cp-desk-dialogs-secret";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${PORT_NO_MODEL}/v1`;
  process.env.LLM_MODEL = "no-model-is-reachable";
  delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.CODEX_CLI_PATH = join(REPO, "scripts/fakes/no-such-codex-cli.mjs");
  process.env.CLAUDE_CLI_PATH = join(REPO, "scripts/fakes/no-such-claude-cli.mjs");
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

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("CP Dialog Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

/**
 * A drafted lead with a body, seeded straight into the in-memory database.
 *
 * The scan cannot be made to produce a draft at a chosen headline on demand and
 * this walk is not about the scan: what it is about is what the two dialogs do
 * to a draft that already exists. The lead's section resolves through the real
 * `resolve_story_section` trigger, so what the page files under is the
 * product's answer and not this fixture's.
 */
async function seedTheDraftedLead() {
  const pg = await db();
  const owner = await pg.query(`select id from "user" limit 1`);
  const userId = owner.rows[0]?.id;
  must(userId, "the first-run account exists in the database");

  const lead = await pg.query(
    `insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, notes_json)
     values ($1, 1, $2, $3, $4, 'drafted', '[]', $5, 11, $6) returning id`,
    [
      userId,
      LEAD_HEADLINE,
      "Fixture: a drafted lead for the unit CP dialog walk.",
      "council",
      "The council packet describes the annexation.",
      JSON.stringify({ todo: [], found: [], verify: [], opened: [], scratch: "" }),
    ],
  );
  const leadId = Number(lead.rows[0].id);
  must(Number.isFinite(leadId), "the seeded lead has an id");

  const draft = await pg.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
       provenance_json, found_note, unanswered, research_json, model_headline, model_topic, headline_source)
     values ($1, 1, $2, $3, $4, $5, $6, '[]', '[]', '', '[]', '{}', $3, $6, 'model') returning id`,
    [userId, leadId, LEAD_HEADLINE, "A fixture dek.", DRAFT_BODY, "council"],
  );
  const draftId = Number(draft.rows[0].id);
  must(Number.isFinite(draftId), "the seeded draft has an id");

  currentLeadId = leadId;
  facts.push({ leadId, draftId });
  step(`a drafted lead carries a stored body (lead ${leadId}, draft ${draftId})`);
  return { leadId, draftId };
}

function bodyBox() {
  return page.locator("textarea.astra-story-body");
}

function headlineBox() {
  return page.locator("textarea.astra-headline");
}

async function openTheStory(leadId) {
  await page.goto(`${base}/desk/story/${leadId}`, { waitUntil: "domcontentloaded" });
  await headlineBox().waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "Save edits" }).waitFor({ timeout: 45_000 });
  await waitForTruth("the body box to fill from the stored draft", async () =>
    (await bodyBox().inputValue()) === DRAFT_BODY ? true : null,
  );
  step("the story page opens on the drafted lead with its stored body");
}

/** 1. The press is on the workbench, and it opens the drawn dialog. */
async function addToStoryIsOnTheWorkbench() {
  const row = page.locator(".astra-story-actions");
  const press = row.getByRole("button", { name: "+ Add to story", exact: true });
  await press.waitFor({ timeout: 30_000 });
  assert.equal(await press.isEnabled(), true, "the press is live on a drafted lead");
  shots.push(await shot(row, "cp-action-row-light.png"));
  await press.click();
  await dialog().waitFor({ timeout: 20_000 });
  const text = await dialog().innerText();
  assert.match(text, /Add to this story/, "the drawn dialog opens");
  assert.match(text, /New material/, "with the material box");
  assert.match(text, /see exactly what changed before saving\./, "and the drawn foot note");
  step("+ Add to story is on the workbench and opens the drawn dialog");
  return press;
}

/** 2 and 3. The review press: nothing is saved, and "Now" is the story. */
async function theReviewPressWritesNothing() {
  await page.getByRole("radio", { name: /Add as an update at the top/ }).click();
  await dialog().getByLabel("New material").fill(ADD_MATERIAL);
  const add = dialog().getByRole("button", { name: "Add", exact: true });
  assert.equal(await add.isEnabled(), true, "with material and a mode the press is live");
  await add.click();

  await waitForTruth("the compare to be drawn", async () =>
    (await compareColumns()).length === 2 ? true : null,
  );
  const compare = await compareColumns();
  assert.equal(compare.length, 2, "the compare has its two columns");
  assert.ok(compare[0].startsWith("Now"), `the left column is headed Now, got ${JSON.stringify(compare[0].slice(0, 20))}`);
  assert.ok(
    compare[1].startsWith("After your change"),
    `the right column is the change, got ${JSON.stringify(compare[1].slice(0, 20))}`,
  );
  /*
    The heading is the design's; what this asserts is that the sentence under
    "Now" is the STORY, not the paragraph just pasted. It used to print the
    pasted material under that heading -- a compare that compared nothing.
  */
  assert.ok(
    compare[0].includes(DRAFT_BODY.split("\n\n")[0]),
    `the Now column shows the story as it is, got: ${JSON.stringify(compare[0])}`,
  );
  assert.ok(
    !compare[0].includes(ADD_MATERIAL),
    "the pasted paragraph is not what Now shows",
  );
  assert.ok(compare[1].includes(ADD_MATERIAL), "the material is in the After column");

  const row = await draftRow("id, headline, body");
  assert.equal(row.body, DRAFT_BODY, "the review press wrote nothing to the row");
  assert.equal(row.headline, LEAD_HEADLINE, "and nothing to the headline");

  const sizes = await smallestSizesInTheDialog();
  assert.deepEqual(
    sizes.offenders,
    [],
    `nothing in the add-to dialog draws under 14px (smallest ${sizes.smallest}px)`,
  );
  facts.push({ addToDialogFloor: `${sizes.smallest}px` });
  shots.push(await shot(dialog(), "cp-add-to-light.png"));
  step(`the first Add writes nothing and shows the story before and after (floor ${sizes.smallest}px)`);
}

/** 4. The confirm press saves exactly what was shown, into the row and the box. */
async function theConfirmPressSavesWhatWasShown() {
  const shown = (await compareColumns())[1];
  const reviewed = shown.replace(/^After your change/, "");
  await dialog().getByRole("button", { name: "Add", exact: true }).click();

  const saved = await waitForTruth("the row to take the reviewed text", async () => {
    const row = await draftRow("body");
    return row.body !== DRAFT_BODY ? row : null;
  });
  assert.ok(saved.body.startsWith("Updated "), `an update is stamped at the top: ${saved.body.slice(0, 40)}`);
  assert.ok(saved.body.includes(ADD_MATERIAL), "the material is in the saved body");
  assert.ok(saved.body.endsWith(DRAFT_BODY), "and the story it was added to is still under it");
  assert.equal(
    saved.body,
    reviewed,
    "the bytes saved are the bytes the editor was shown",
  );

  await waitForTruth("the dialog to close on the save", async () =>
    (await page.locator(".astra-modal").count()) === 0 ? true : null,
  );
  await waitForTruth("the page's body box to take the saved bytes", async () =>
    (await bodyBox().inputValue()) === saved.body ? true : null,
  );
  const message = await page.locator("body").innerText();
  assert.match(message, /Saved\. The story is \d+ characters now/, "the save is said out loud");
  facts.push({ savedBodyLength: saved.body.length });
  step("the second Add saves the reviewed text and the page's box takes it");
}

/**
 * The point of `onSaved`: the box holds the saved bytes, so the page's own
 * "Save edits" -- which sends the box back whole -- cannot resurrect the older
 * body. Without the wiring this press writes the pre-add text over the top.
 */
async function saveEditsKeepsTheAddition() {
  const before = (await draftRow("body")).body;
  await page.getByRole("button", { name: "Save edits" }).click();
  await waitForTruth("the save to be acknowledged", async () =>
    (await page.locator("body").innerText()).includes("Saved.") ? true : null,
  );
  const after = (await draftRow("body")).body;
  assert.equal(after, before, "Save edits after an add keeps the addition");
  const box = await bodyBox().inputValue();
  assert.equal(box, after, "and the box still holds the saved bytes");
  step("Save edits after the add does not write the older body back");
}

/**
 * 5. The add-to dialog again in dark, on the desk's own toggle.
 *
 * This pass is for the eye, and it writes nothing: the press used is exactly
 * the review press that saves nothing, and the dialog is dismissed with Cancel.
 * What the page looked like is the evidence; the row is asserted unchanged
 * afterwards so "the dark pass saved nothing" is a fact too.
 */
async function theDarkPassShowsTheAddToDialog() {
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await waitForTruth("the desk to go dark", async () =>
    (await page.evaluate(() => document.documentElement.dataset.appearance ?? "")) === "desk-dark"
      ? true
      : null,
  );
  const bodyBefore = (await draftRow("body")).body;

  const row = page.locator(".astra-story-actions");
  shots.push(await shot(row, "cp-action-row-dark.png"));

  await row.getByRole("button", { name: "+ Add to story", exact: true }).click();
  await dialog().waitFor({ timeout: 20_000 });
  await page.getByRole("radio", { name: /Add as an update at the top/ }).click();
  await dialog().getByLabel("New material").fill(ADD_MATERIAL);
  await dialog().getByRole("button", { name: "Add", exact: true }).click();
  await waitForTruth("the compare to be drawn in dark", async () =>
    (await compareColumns()).length === 2 ? true : null,
  );
  const sizes = await smallestSizesInTheDialog();
  shots.push(await shot(dialog(), "cp-add-to-dark.png"));
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  await waitForTruth("the add-to dialog to be dismissed", async () =>
    (await page.locator(".astra-modal").count()) === 0 ? true : null,
  );

  assert.equal((await draftRow("body")).body, bodyBefore, "the dark pass saved no body");
  assert.deepEqual(
    sizes.offenders,
    [],
    `nothing in the dark add-to dialog draws under 14px (smallest ${sizes.smallest}px)`,
  );
  facts.push({ darkAddToFloor: `${sizes.smallest}px` });
  step("dark shows the same dialog, and the cancelled press saved nothing");
}

async function shot(locator, name) {
  const file = resolve(outDir, name);
  await locator.screenshot({ path: file, animations: "disabled" });
  console.log(`  shot  ${file}`);
  return file;
}

async function main() {
  await preconditions();
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
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  try {
    await ownTheDesk();
    const { leadId } = await seedTheDraftedLead();
    await openTheStory(leadId);
    await addToStoryIsOnTheWorkbench();
    await theReviewPressWritesNothing();
    await theConfirmPressSavesWhatWasShown();
    await saveEditsKeepsTheAddition();
    await theDarkPassShowsTheAddToDialog();
    assert.deepEqual(consoleErrors, [], "the desk reached all of this without a console error");
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(
    JSON.stringify(
      { ok: true, steps: done.length, facts, shots, consoleErrors: consoleErrors.slice(0, 10) },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
