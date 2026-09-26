#!/usr/bin/env node
/**
 * Browser acceptance for the three editor controls 0.6.67 exists to ship
 * (Unit AH), walked end to end on the built server and the real desk UI.
 *
 * WHAT WAS WRONG, in the order an editor hit it.
 *
 * 1. LONG MACHINE TO-DOS BLOCKED SAVE AND PUBLISH. The running checklist a
 *    machine pass writes into (`notes.ts`) accepted lines up to 400 characters;
 *    the wire (`request-input.ts`) refused anything over `LIMITS.listItem`,
 *    200. The desk sends a lead's stored to-do list back WHOLE on every save,
 *    publish and redraft, so ONE line the machine had written longer than 200
 *    characters made the whole request invalid -- on a finished story both
 *    Save edits and Publish were dead, and the editor was shown the raw zod
 *    array (`too_big`, `maximum 200`, path `todos,0,t`). Lead 240's stored line
 *    was 227 characters, which is the line this walk stores.
 *
 * 2. THE HEADLINE LOOKED PRINTED, NOT EDITABLE, and a redraft silently
 *    replaced it. The headline carried the same treatment as the dek and the
 *    body -- no border, no background -- so an editor read it as a caption. And
 *    a redraft INSERTs a new draft row, so the model's headline replaced the
 *    editor's without anything noticing.
 *
 * 3. THE SECTION WAS CONFIRMED BY A SECOND BUTTON. Publish printed whatever
 *    the select said unless a person had pressed a separate Confirm first, and
 *    the model's section was the classifier's word. Publish now carries the
 *    section the editor is looking at and the server records that as this
 *    draft version's confirmation inside the transaction that prints it, so
 *    the button reads "Publish in Council" and one press confirms what it
 *    says.
 *
 * WHAT THIS WALK PROVES, end to end, on the built server and the real desk UI:
 *
 *   1. A drafted lead whose stored to-do is the 227-character line renders it
 *      in the reporting notes, and **Save edits** saves -- "Saved.", not a
 *      schema dump. Under 0.6.65 this press was the one that died.
 *   2. The editor's headline survives **Redraft**. The walk types an editor
 *      headline, saves, redrafts against the stub model, and asserts the row
 *      the redraft wrote keeps the editor's words with the model's attempt
 *      filed beside them (`model_headline`) and `headline_source = 'editor'`.
 *   3. **Use the lead's headline** puts the scan's own line back in the box,
 *      one press, from the lead the desk read.
 *   4. The Publish button READS the section it will file under -- "Publish in
 *      Council" -- and pressing it, then "Yes, print it in Council", prints the
 *      story. No separate Confirm button exists to press first.
 *   5. The published headline is editable on the Published page, the new words
 *      appear on the row, the article's own headline changed, the old words are
 *      on the record (`article_headline_history`), and **the public page shows
 *      the new headline at the same URL** -- the slug never moves, so nothing
 *      that points at the story breaks.
 *
 * Zero console errors, asserted at the end: every one of these presses is
 * something an editor does, and a desk that reaches any of them through a
 * thrown error is a desk that shows the editor a schema dump.
 *
 * HOW THE MODELS ARE FAKED. ONE instance of
 * scripts/fakes/fake-deepseek-endpoint.mjs answers every call this walk needs,
 * reached as the operator's configured gateway (`LLM_BASE_URL` + `LLM_MODEL`,
 * which Automatic resolves BEFORE its ladder runs -- ai.ts:693) so the redraft,
 * the research pass and "Suggest headlines" all land on the stub and on no real
 * endpoint. Its `ready` mode answers the writing pass with a headline the walk
 * asserts on by name, which is what makes "the redraft did not take the
 * editor's headline" a fact rather than a hope.
 *
 * The unattended CLI rungs are made unreachable on purpose -- a CLI path that
 * is not there answers "not ready" without running a real CLI or needing a
 * subscription -- and ANTHROPIC_API_KEY is cleared. Nothing is reached,
 * downloaded, or called off this computer, and no credential is needed
 * anywhere.
 *
 * The server under test must be BUILT (`npm run build`); this walk imports
 * `.output/server/index.mjs` itself.
 *
 *   node scripts/editor-controls-0667-walk.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_EDITOR_CONTROLS_0667 = 3521;
/** The stub model, on a port of this walk's own; nothing else may bind it. */
const PORT_FAKE_DEEPSEEK = 3522;

const FAKE_BASE = `http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/v1`;
const FAKE_MODEL = "deepseek-v4.1-flash:cloud";
/** READY_WRITE.headline in scripts/fakes/fake-deepseek-endpoint.mjs. */
const MODEL_HEADLINE = "DeepSeek v4.1 Flash drafted this on the new Automatic ladder";

const base = checkedUrl(`http://127.0.0.1:${PORT_EDITOR_CONTROLS_0667}`);

const stamp = Date.now();
const email = `editor-controls-0667-${stamp}@townreporter.test`;
const password = "editor-controls-0667-pass";

/**
 * The lead-240 line, at its real length: 227 characters.
 *
 * 227 is the point. It is over the 200 the wire used to refuse and well inside
 * the writer's 400, so a run that saves it proves the two read ONE bound --
 * and the walk asserts the length rather than trusting the paragraph above.
 */
const REPORTED_LINE =
  "Claim of absence: the city has published no notice of a public hearing on the annexation " +
  "of the Olson property, and nothing in the packet or the minutes of either meeting addresses " +
  "it, nor in the staff report sent to the clerk.";

/** The scan's headline, what the desk read on the lead. */
const LEAD_HEADLINE = "Council takes up the Olson annexation";
/** What the editor types, and what a redraft must not replace. */
const EDITOR_HEADLINE = "Council adopts the annexation, 5-2";
/** What the editor puts on the paper from the Published page. */
const PUBLISHED_HEADLINE = "Annexation adopted 5-2 after two hours of testimony";
/**
 * The section the desk files under. `resolve_story_section` (migration 0045)
 * seeds `newsroom_sections` with `initcap(key)`, so the key `council` reads
 * "Council" in the select and on the Publish button.
 */
const SECTION_KEY = "council";
const SECTION_NAME = "Council";

/**
 * The draft body. It names no outlet from `NAMED_OUTLETS` (outlet-credit.ts:47)
 * -- nor the word "leader", which is one of the aliases -- so nothing here
 * trips the named-outlet refusal and blocks the print.
 */
const DRAFT_BODY =
  "The council took up the annexation of the Olson property Monday night.\n\n" +
  "The item returns for a second reading next month.";

let page;
const done = [];
const facts = [];
const fakes = [];

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
  killFakes();
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Start a fake and wait for its own "listening on" line, so no probe races its bind. */
function startFake(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO, script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (line) resolve(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`${script} exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(
      () => reject(new Error(`${script} never reported listening:\n${out.trim()}`)),
      15_000,
    );
  });
}

function killFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 500));
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

/**
 * The address the stub answers on, checked before booting anything.
 *
 * A walk that starts its own fake on a port something else already holds binds
 * nothing and then talks to the stranger -- so an address that DOES answer is a
 * refusal, not a surprise later.
 */
async function preconditions() {
  const problems = [];
  let stranger = false;
  try {
    const res = await fetch(`${FAKE_BASE}/models`, { signal: AbortSignal.timeout(2_000) });
    stranger = res.ok || res.status < 500;
  } catch {
    /* nothing there, which is what this walk needs */
  }
  if (stranger) {
    problems.push(
      `something is already answering on ${FAKE_BASE}; this walk starts its own stub there and ` +
        `will not share the port.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: a rung below the fake could answer the writing pass with a real " +
        "model, which is a call off this computer and a headline this walk did not choose.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the BUILT server here, in this process, on this walk's own port and
 * in-memory PGlite (never the shared Postgres: DATABASE_URL is cleared below).
 *
 * The environment makes the stub the ONLY model the desk can reach: it is the
 * saved gateway, which Automatic resolves before its ladder runs, and both CLI
 * rungs are pointed at files that do not exist.
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_EDITOR_CONTROLS_0667);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "editor-controls-0667-secret";
  process.env.LLM_BASE_URL = FAKE_BASE;
  process.env.LLM_MODEL = FAKE_MODEL;
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
  await page.getByLabel("Name").fill("Editor Controls Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

/**
 * A drafted lead carrying the reported 227-character to-do.
 *
 * Seeded straight into the in-memory database rather than driven through the
 * scan: what this walk is about is the desk's behaviour on a lead that ALREADY
 * carries the line, and the scan cannot be made to write one at a chosen
 * length. The lead's own section resolves through the real
 * `resolve_story_section` trigger, so "Council" on the Publish button is the
 * product's answer and not this fixture's.
 */
async function seedTheDraftedLead() {
  const pg = await db();
  const owner = await pg.query(`select id from "user" limit 1`);
  const userId = owner.rows[0]?.id;
  must(userId, "the first-run account exists in the database");
  ownerId = userId;

  const notes = JSON.stringify({
    todo: [{ t: REPORTED_LINE, done: false, src: "machine" }],
    found: [],
    verify: [],
    opened: [],
    scratch: "Fixture for the 0.6.67 editor controls walk.",
  });
  const lead = await pg.query(
    `insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, notes_json)
     values ($1, 1, $2, $3, $4, 'drafted', '[]', $5, 11, $6) returning id`,
    [
      userId,
      LEAD_HEADLINE,
      "Fixture: a drafted lead with a machine to-do longer than the wire used to accept.",
      SECTION_KEY,
      "The council packet describes the annexation.",
      notes,
    ],
  );
  const leadId = Number(lead.rows[0].id);
  must(Number.isFinite(leadId), "the seeded lead has an id");

  const draft = await pg.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
       provenance_json, found_note, unanswered, research_json, model_headline, model_topic, headline_source)
     values ($1, 1, $2, $3, $4, $5, $6, '[]', '[]', '', '[]', '{}', $3, $6, 'model') returning id`,
    [userId, leadId, LEAD_HEADLINE, "A fixture dek.", DRAFT_BODY, SECTION_KEY],
  );
  const draftId = Number(draft.rows[0].id);
  must(Number.isFinite(draftId), "the seeded draft has an id");

  const stored = await pg.query(`select notes_json from leads where id = $1`, [leadId]);
  const todo = JSON.parse(stored.rows[0].notes_json).todo?.[0]?.t ?? "";
  must(
    todo.length === 227,
    `the fixture's stored to-do is the reported length, not ${todo.length}`,
  );
  assert.equal(REPORTED_LINE.length, 227);
  facts.push({ storedTodoLength: todo.length, leadId, draftId });
  step(`a drafted lead carries a ${todo.length}-character machine to-do`);
  return { leadId, draftId };
}

/** The box the desk shows a headline in. */
function headlineBox() {
  return page.locator("textarea.astra-headline");
}

async function openTheStory(leadId) {
  await page.goto(`${base}/desk/story/${leadId}`, { waitUntil: "domcontentloaded" });
  await headlineBox().waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "Save edits" }).waitFor({ timeout: 45_000 });
  step("the story page opens on the drafted lead");
}

/** 1. The long stored line, on the page, in the reporting notes. */
async function theStoredLongTodoIsOnThePage() {
  await page.locator("#inspector-tab-reporting").click();
  const todo = page.locator(".todo-t").first();
  await todo.waitFor({ timeout: 45_000 });
  const shown = (await todo.innerText()).trim();
  assert.equal(shown, REPORTED_LINE, "the desk shows the stored line as it was stored");
  assert.equal(shown.length, 227);
  step("the 227-character to-do is in the reporting notes");
}

/**
 * 2. Save edits works on that lead. The press that used to end at the raw zod
 * array (`too_big`, `maximum 200`, path `todos,0,t`) now saves the story and
 * the checklist whole.
 */
async function savingTheEditsWorks() {
  await page.getByRole("button", { name: "Save edits" }).click();
  const notice = page.locator(".notice").first();
  await waitForTruth("the save to be acknowledged", async () =>
    (await page.locator("body").innerText()).includes("Saved.") ? true : null,
    60_000,
  );
  const text = (await page.locator("body").innerText()).slice(0, 4000);
  assert.doesNotMatch(text, /too_big|maximum|todos,0,t/, "no schema dump reaches the editor");
  assert.ok(notice !== null);
  step("Save edits saves the lead with the long to-do, with no schema dump");
}

/** 3. The editor's headline, typed into a box that now looks editable. */
async function theEditorEditsTheHeadline() {
  const hint = page.locator(".astra-headline-hint");
  await hint.waitFor({ timeout: 15_000 });
  /*
    `innerText` is what the editor's eye gets, so it carries the stylesheet's
    `text-transform: uppercase` -- the word arrives as EDIT. What the hint has
    to say is "Edit"; the case is the stylesheet's, not the label's.
  */
  assert.equal((await hint.innerText()).trim().toLowerCase(), "edit");
  await headlineBox().fill(EDITOR_HEADLINE);
  await page.getByRole("button", { name: "Save edits" }).click();
  await waitForTruth("the headline save", async () => {
    const pg = await db();
    const row = await pg.query(
      `select headline, headline_source from drafts where lead_id = $1 order by id desc limit 1`,
      [currentLeadId],
    );
    return row.rows[0]?.headline === EDITOR_HEADLINE ? row.rows[0] : null;
  });
  const pg = await db();
  const row = await pg.query(
    `select headline, headline_source from drafts where lead_id = $1 order by id desc limit 1`,
    [currentLeadId],
  );
  assert.equal(row.rows[0].headline_source, "editor", "the save stamps whose headline this is");
  step("the editor's headline is saved and stamped as the editor's");
}

/**
 * 4. A redraft keeps it. This is the whole of item 2's second half: a redraft
 * INSERTs a new row, and before 0.6.67 that row's headline was the model's.
 */
async function aRedraftKeepsTheEditorsHeadline(seededDraftId) {
  await page.getByRole("button", { name: "Redraft", exact: true }).click();
  const landed = await waitForTruth("the redraft to land", async () => {
    const pg = await db();
    const job = await pg.query(
      `select status, error from desk_jobs where subject_id = $1 order by id desc limit 1`,
      [currentLeadId],
    );
    if (job.rows[0]?.status === "failed") {
      throw new Error(`the redraft failed: ${job.rows[0].error ?? "no reason recorded"}`);
    }
    const draft = await pg.query(
      `select id, headline, model_headline, headline_source from drafts
       where lead_id = $1 order by id desc limit 1`,
      [currentLeadId],
    );
    const row = draft.rows[0];
    if (row && Number(row.id) > seededDraftId && job.rows[0]?.status === "completed") return row;
    return null;
  }, 180_000);
  /*
    A redraft writes two rows -- the writer's checkpoint and the finished one --
    and both are revisions. When this fails, the rows are the evidence: which
    one the desk read back and what it recorded as the model's own words.
  */
  const history = (
    await (await db()).query(
      `select id, headline, model_headline, headline_source from drafts where lead_id = $1 order by id`,
      [currentLeadId],
    )
  ).rows;
  assert.equal(
    landed.headline,
    EDITOR_HEADLINE,
    `the redraft kept the editor's words -- drafts: ${JSON.stringify(history)}`,
  );
  assert.equal(landed.headline_source, "editor");
  assert.equal(landed.model_headline, MODEL_HEADLINE, "the model's own attempt is filed beside it");
  facts.push({
    redraftDraftId: Number(landed.id),
    keptHeadline: landed.headline,
    modelHeadline: landed.model_headline,
  });
  step("Redraft rewrote the story and kept the editor's headline");

  // And the desk shows the editor the same words after the new row loads.
  await page.reload({ waitUntil: "domcontentloaded" });
  await headlineBox().waitFor({ timeout: 45_000 });
  await page.waitForFunction(
    (expected) => document.querySelector("textarea.astra-headline")?.value === expected,
    EDITOR_HEADLINE,
    { timeout: 45_000 },
  );
  step("the desk shows the editor's headline back after the redraft");
}

/** 5. The scan's own headline, one press away. */
async function theLeadsHeadlineIsOnePressAway() {
  await page.getByRole("button", { name: "Use the lead's headline" }).click();
  assert.equal(await headlineBox().inputValue(), LEAD_HEADLINE);
  await page.getByRole("button", { name: "Save edits" }).click();
  await waitForTruth("the lead's headline to be saved", async () => {
    const pg = await db();
    const row = await pg.query(
      `select headline from drafts where lead_id = $1 order by id desc limit 1`,
      [currentLeadId],
    );
    return row.rows[0]?.headline === LEAD_HEADLINE ? row.rows[0] : null;
  });
  step("Use the lead's headline put the scan's line back in the box");
}

/** 6. The Publish button names the section, and pressing it is the confirmation. */
async function thePublishButtonNamesTheSection() {
  const button = page.getByRole("button", { name: `Publish in ${SECTION_NAME}`, exact: true });
  await button.waitFor({ timeout: 45_000 });
  assert.equal(await button.isEnabled(), true, "the button is live with the section on it");
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, /Confirm the section|Confirm this section/i, "no second Confirm step");
  step(`the Publish button reads "Publish in ${SECTION_NAME}"`);
  return button;
}

/** 7. Pressing it, then the inline consequence line, prints the story. */
async function publishing(button) {
  await button.click();
  const yes = page.getByRole("button", { name: `Yes, print it in ${SECTION_NAME}`, exact: true });
  await yes.waitFor({ timeout: 20_000 });
  await yes.click();
  await waitForTruth("the story to reach the paper", async () => {
    const pg = await db();
    const article = await pg.query(`select id, slug, headline from articles where lead_id = $1`, [
      currentLeadId,
    ]);
    return article.rows[0] ?? null;
  }, 90_000);
  const pg = await db();
  const article = await pg.query(`select id, slug, headline from articles where lead_id = $1`, [
    currentLeadId,
  ]);
  const row = article.rows[0];
  assert.equal(row.headline, LEAD_HEADLINE, "the paper prints the headline the desk held");
  facts.push({ slug: row.slug, publishedHeadline: row.headline });
  step(`the story published under its own section, at /articles/${row.slug}`);
  return row;
}

/**
 * 8. The published headline is an editor's field on /desk/published, and the
 * record keeps the words it replaced.
 */
async function thePublishedPageEditsTheHeadline(article) {
  await page.goto(`${base}/desk/published`, { waitUntil: "domcontentloaded" });
  /*
    The row is found by its LINK, not by its headline. The whole point of this
    step is that the headline changes, and a locator filtered on the old words
    would stop matching the moment the save lands -- which is exactly when the
    walk needs to look at it again. The story's slug is the one thing about this
    row that must not move.
  */
  const row = page.locator(".pub-row").filter({
    has: page.locator(`a[href="/articles/${article.slug}"]`),
  });
  await row.waitFor({ timeout: 45_000 });
  await row.getByRole("button", { name: "Edit headline" }).click();
  const box = page.locator(`#pub-head-${article.slug}`);
  await box.waitFor({ timeout: 20_000 });
  assert.equal(await box.inputValue(), LEAD_HEADLINE, "the box starts from the words on the paper");
  await box.fill(PUBLISHED_HEADLINE);
  await row.getByRole("button", { name: "Save the new headline" }).click();
  await waitForTruth("the published row to show the new headline", async () => {
    const pg = await db();
    const found = await pg.query(`select headline from articles where id = $1`, [article.id]);
    return found.rows[0]?.headline === PUBLISHED_HEADLINE ? found.rows[0] : null;
  });
  await row.getByRole("heading", { name: PUBLISHED_HEADLINE, exact: true }).waitFor({
    timeout: 45_000,
  });
  const pg = await db();
  const history = await pg.query(
    `select old_headline, new_headline, changed_by from article_headline_history where article_id = $1`,
    [article.id],
  );
  assert.equal(history.rows.length, 1, "the change is on the record");
  assert.equal(history.rows[0].old_headline, LEAD_HEADLINE);
  assert.equal(history.rows[0].new_headline, PUBLISHED_HEADLINE);
  assert.equal(history.rows[0].changed_by, ownerId, "and the record names who changed it");
  facts.push({ headlineHistory: history.rows[0] });
  step("the Published page changed the headline and wrote down what it replaced");
}

/** 9. The public page shows the new words at the SAME URL. */
async function thePublicPageShowsIt(article) {
  const url = `${base}/articles/${article.slug}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: PUBLISHED_HEADLINE, exact: true }).waitFor({
    timeout: 45_000,
  });
  assert.equal(page.url(), url, "the story's link did not move");
  const body = await page.locator("body").innerText();
  assert.ok(body.includes(PUBLISHED_HEADLINE), "the reader sees the new headline");
  assert.ok(!body.includes(LEAD_HEADLINE), "and not the words it replaced");
  step(`the public page shows the new headline at the same URL (${url})`);
}

let currentLeadId = 0;
/** The first-run account's own id: what an audit row or `changed_by` records. */
let ownerId = "";

async function main() {
  await preconditions();
  const fake = await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
    FAKE_DEEPSEEK_PORT: String(PORT_FAKE_DEEPSEEK),
    FAKE_DEEPSEEK_MODEL: FAKE_MODEL,
    FAKE_DEEPSEEK_MODE: "ready",
  });
  console.log(`  fake  ${fake}`);
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
    const { leadId, draftId } = await seedTheDraftedLead();
    currentLeadId = leadId;
    await openTheStory(leadId);
    await theStoredLongTodoIsOnThePage();
    await savingTheEditsWorks();
    await theEditorEditsTheHeadline();
    await aRedraftKeepsTheEditorsHeadline(draftId);
    await theLeadsHeadlineIsOnePressAway();
    const publishButton = await thePublishButtonNamesTheSection();
    const article = await publishing(publishButton);
    await thePublishedPageEditsTheHeadline(article);
    await thePublicPageShowsIt(article);
    assert.deepEqual(consoleErrors, [], "the desk reached all of this without a console error");
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  killFakes();
  console.log(
    JSON.stringify(
      { ok: true, steps: done.length, facts, consoleErrors: consoleErrors.slice(0, 10) },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
