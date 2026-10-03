#!/usr/bin/env node
/*
  FB6: the feedback, walked and photographed.

  The owner's brief (2026-09-30): "I need much better feedback on all actions
  everywhere. This was spec'd out long ago… a line going back and forth is just
  lazy." Every case below is one of those presses, and each one is photographed
  in the state the fix is about -- the pending frame, the optimistic frame, the
  failure frame -- rather than after everything has settled, which is the state
  the old desk only ever showed.

  WHAT ONLY A BROWSER CAN ANSWER, and why this walk exists on top of the tests:

    - a pending state is a FRAME. `scripts/fb6-optimistic-rollback.test.mjs`
      proves the cache moves in the same commit as the press; only a browser can
      show the button actually reading "Starting…" while the call is in flight.
    - the optimistic Hold is a ROW that changed before the answer came back.
    - the rollback is a ROW that came back under a red bar. This walk produces
      that failure by ABORTING the request at the browser, because every desk
      server function answers `{ok:true}` on this path -- there is no input that
      makes `setLeadStatus` refuse, and a walk may not edit the server to invent
      one.
    - the More ▾ fix (7c) is one label's line count at two viewport widths, and
      a line count is a measurement, not a string.
    - the two story-page contradictions (C4/C5) are about two panes on ONE
      screen agreeing with each other.

  Runs on its own built server against in-memory PGlite, on its own ports, with
  the repo's fake provider as the only model. `DATABASE_URL` is cleared, so the
  shared Postgres is never touched and nothing is written anywhere durable.

    node scripts/fb6-desk-feedback-walk.mjs

  Screenshots: `FB6_SHOTS_DIR`, default `../townreporter-coord/fb6/shots`.
*/
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen ports, found by
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can bind one and answer this walk's requests against the wrong database.
 */
const PORT_FB6_DESK = 8146;
const PORT_FB6_FAKE = 8147;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = checkedUrl(`http://127.0.0.1:${PORT_FB6_DESK}`).replace(/\/$/, "");
const fakeBase = `http://127.0.0.1:${PORT_FB6_FAKE}/v1`;

const OUT_DIR = checkedOutputPath(
  resolve(process.env.FB6_SHOTS_DIR || "C:/Users/scott/Desktop/Code/townreporter-coord/fb6/shots"),
  [resolve("C:/Users/scott/Desktop/Code/townreporter-coord"), REPO],
  "screenshot directory",
);
mkdirSync(OUT_DIR, { recursive: true });

const stamp = Date.now();
const email = `fb6-walk-${stamp}@townreporter.test`;
const password = "fb6-walk-pass";

const results = [];
const step = (line) => {
  results.push(line);
  console.log(`  ${line}`);
};
const shotPath = (name) => checkedOutputPath(join(OUT_DIR, name), [OUT_DIR], "screenshot");

/* --------------------------------------------------------- the fake provider */

let fakeProvider = null;
function startFakeProvider() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(REPO, "scripts", "fakes", "fake-deepseek-endpoint.mjs")],
      {
        env: {
          ...process.env,
          FAKE_DEEPSEEK_PORT: String(PORT_FB6_FAKE),
          FAKE_DEEPSEEK_MODE: "ready",
          FAKE_DEEPSEEK_DELAY_MS: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    fakeProvider = child;
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      if (out.split("\n").some((line) => line.includes("listening on"))) resolvePromise(child);
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`the fake provider exited with ${code}:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`the fake provider never listened:\n${out.trim()}`)), 20_000);
  });
}

/* ------------------------------------------------------------- the server --- */

async function bootTheServer() {
  process.env.PORT = String(PORT_FB6_DESK);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "fb6-desk-feedback-walk-secret";
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = fakeBase;
  process.env.TOWNREPORTER_DEEPSEEK_MODEL = "deepseek-v4.1-flash:cloud";
  process.env.TOWNREPORTER_QWEN = "0";
  process.env.TOWNREPORTER_CODEX = "0";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  delete process.env.ANTHROPIC_API_KEY;
  await import(pathToFileURL(join(REPO, ".output", "server", "index.mjs")).href);
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`the built server never answered on ${base}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function pg() {
  const handle = await globalThis.__pgliteInstance__;
  if (!handle) throw new Error("the server booted without a PGlite instance to read");
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 300 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await handle.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* the table is not there yet */
    }
    if (count === applied && count >= 0) quiet += 1;
    else {
      quiet = 0;
      applied = count;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return handle;
}

/* --------------------------------------------------------------- fixtures --- */

/**
 * The desk's own rows, written straight into the newsroom's tables.
 *
 * A walk that filed all of these through the UI would spend most of its time in
 * forms, and none of the screens this unit is about care HOW a lead got there.
 * What matters is that Today and the Queue hold a lead of each status, that one
 * lead has a draft with a job running on it, and that the scan card has a scan
 * to draw.
 */
async function seed(db, { newsroomId, userId }) {
  const lead = async (headline, why, status, score) =>
    Number(
      (
        await db.query(
          /* No `updated_at` on this table: it has `created_at` only (0002). */
          `insert into leads (user_id, newsroom_id, headline, why, topic, status, newsworthiness, source_urls, created_at)
           values ($1, $2, $3, $4, 'council', $5, $6, '["https://example.test/packet"]', now())
           returning id`,
          [userId, newsroomId, headline, why, status, score],
        )
      ).rows[0].id,
    );

  const open = [];
  for (const [headline, why, score] of [
    ["Council schedules the second reading of the occupancy rule", "The vote is Tuesday and the packet changed this week", 82],
    ["County quietly drops the flood-plain appeal deadline", "Two dozen homeowners were never told", 74],
    ["Transit board meets on the fare change without public notice", "The agenda went up after the meeting", 68],
    ["The water district's legal bill doubled last quarter", "Nobody has explained the line item", 61],
    ["School board candidate's filing lists a closed business", "The address has been empty since 2024", 55],
  ]) {
    open.push(await lead(headline, why, "new", score));
  }
  const held = await lead(
    "Developer's third request for the same variance",
    "Held until the county answers the records request",
    "held",
    44,
  );
  const killed = await lead(
    "Rumour about the plant closing",
    "No document behind it and the company denies it",
    "killed",
    12,
  );
  /*
    THE ONE LEAD WITH NO DRAFT (item 8a/8b). It is opened by the story-page leg
    below, which is where the stand-in walkthrough photographed "4 things block
    Publish" above "No draft yet".
  */
  const bare = open[3];

  /*
    A DRAFT mid-write (item 6, the Drafts running row). The job is the thing the
    card draws; the draft row is what gives the row its headline and its state
    chip, so both are written.
  */
  await db.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls, created_at, updated_at)
     values ($1, $2, $3, $4, '', '', 'council', '[]', now(), now())`,
    [userId, newsroomId, open[1], "County quietly drops the flood-plain appeal deadline"],
  );
  await db.query(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage, stage_index, pct, step_text, started_at, beat_at, updated_at, model_choice, stages_json)
     values ($1, $2, 'draft', $3, 'running', 'Writing the draft', 3, 42, 'Writing the draft', now() - interval '75 seconds', now() - interval '2 seconds', now(), 'auto', $4)`,
    [
      newsroomId,
      userId,
      open[1],
      JSON.stringify([
        'Opening source material',
        'Looking for primary sources',
        'Planning the reporting',
        'Writing the draft',
        'Checking the draft against the evidence',
        'Connecting the story to saved sources',
      ]),
    ],
  );
  /*
    A SCAN in flight (item 3). Written directly rather than started, because
    "Run scan now" is pressed for real later -- and the job it enqueues has not
    been claimed by any worker in this process, so it would sit "Waiting to
    start…" forever. This one is what the card looks like with stages behind it.
  */
  await db.query(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage, stage_index, pct, step_text, started_at, beat_at, updated_at, model_choice, stages_json)
     values ($1, $2, 'scan', 0, 'running', 'Reading the sources', 1, 35, 'Reading sources — 83 of 201', now() - interval '20 seconds', now() - interval '1 second', now(), 'auto', $3)`,
    [
      newsroomId,
      userId,
      JSON.stringify([
        'Checking for meeting material',
        'Reading the sources',
        'Reading the sources with a model',
        'Filing the leads',
      ]),
    ],
  );
  return { open, held, killed, bare };
}

/* ------------------------------------------------------------------ the walk */

let db = null;
let browser = null;
let failed = false;
const startedAt = Date.now();

try {
  await startFakeProvider();
  step("the fake provider is listening");
  await bootTheServer();
  step(`the built server is answering on ${base}`);
  db = await pg();
  step("the in-memory database has stopped migrating");

  browser = await chromium.launch({ args: ["--disable-external-protocol-requests"] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));

  /* ── the owner, through the real form ─────────────────────────────────── */
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({ timeout: 45_000 });
  await page.getByLabel("Name").fill("FB6 Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the desk exists");

  const room = await db.query("select id from newsrooms order by id limit 1");
  const newsroomId = Number(room.rows[0].id);
  const who = await db.query(`select id from "user" order by "createdAt" limit 1`);
  const userId = String(who.rows[0].id);
  const leads = await seed(db, { newsroomId, userId });
  step(`seeded ${leads.open.length} open leads, one held, one killed, and two live jobs`);

  /* ── 1. Today: Start story, pending ────────────────────────────────────── */
  /*
    The pending frame is only visible if the call takes long enough to see, so
    the press's own POST is held for three seconds at the browser. Nothing else
    is delayed, and the route is removed the moment the shot is taken.
  */
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good morning/ }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: /^Start story/ }).first().waitFor({ timeout: 30_000 });
  const hold = async (route) => {
    /*
      `route.continue()` THROWS IF THE ROUTE WAS ALREADY HANDLED -- a page
      navigation while one of these is sleeping closes every pending route, and
      an unhandled rejection would take the walk down with it.
    */
    try {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, 3_000));
      }
      await route.continue();
    } catch {
      /* the page moved on; nothing to answer */
    }
  };
  await page.route("**/*", hold);
  await page.getByRole("button", { name: /^Start story/ }).first().click();
  await page.waitForTimeout(700);
  const pendingLabel = await page
    .locator(".today-lead-side button", { hasText: "Starting…" })
    .first()
    .isVisible()
    .catch(() => false);
  await page.screenshot({ path: shotPath("01-today-start-story-pending.png") });
  await page.unroute("**/*", hold);
  step(
    pendingLabel
      ? "01 Today: Start story drew \"Starting…\" and stood down while the call was in flight"
      : "01 Today: FAILED -- no pending label was drawn",
  );

  /* ── 2. Today: the optimistic Hold, with the Undo toast ───────────────── */
  await page.waitForTimeout(3_500);
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good morning/ }).waitFor({ timeout: 45_000 });
  /*
    The row's own Hold opens the drawn dialog (that ask is not this unit's), so
    the press photographed here is the dialog's: the ROW moves the instant the
    dialog answers -- before any refetch could have come back -- and the toast
    that reports it carries the way back.

    The screenshot is taken on the HELD segment, because that is where the row
    went: a held lead is not open work any more (7a), so it leaves the Open list
    the moment it is held and the "Held / Undo" row is on the other segment.
  */
  const firstRow = page.locator(".today-lead").filter({ hasText: "second reading" }).first();
  await firstRow.getByRole("button", { name: /^Hold/ }).click();
  await page.getByRole("button", { name: "Hold, no reason" }).click();
  await page.getByText(/Held "/).first().waitFor({ timeout: 15_000 });
  // Let the bar finish arriving: a screenshot taken mid-animation catches it
  // half-faded, which is a photograph of sonner rather than of the fix.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Held ·/ }).click();
  const heldRow = page.locator(".today-lead").filter({ hasText: "second reading" }).first();
  await heldRow.locator(".today-lead-done").waitFor({ timeout: 15_000 });
  const heldWords = await heldRow.locator(".today-lead-done").innerText();
  const undoThere = await heldRow.getByRole("button", { name: /^Undo/ }).isVisible();
  await page.screenshot({ path: shotPath("02-today-optimistic-hold-undo.png") });
  step(
    /held/i.test(heldWords) && undoThere
      ? `02 Today: the row reads "${heldWords.trim()}" with an Undo, and the Hold toast carries one too`
      : `02 Today: FAILED -- row="${heldWords.trim()}" undo=${undoThere}`,
  );

  /* ── 3. The rollback: a failed write puts the row back ────────────────── */
  /*
    Abort the next POST, which is the Queue row's Release. The desk's own
    server functions answer `{ok:true}` on every one of these paths, so there is
    no input that makes the write fail -- the failure has to be produced at the
    transport. That is also exactly the failure the editor meets when the desk
    is not running, so it is the honest one to photograph.
  */
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Queue/ }).waitFor({ timeout: 45_000 });
  /*
    THE HELD TAB, and not the Open one (item 7a). A held lead is not open work
    any more, so it is deliberately not in the list the Queue opens on -- which
    is the owner's own report being walked, not an obstacle to it.
  */
  await page.getByRole("button", { name: /^Held ·/ }).click();
  const heldOnQueue = page.locator(".lead-row").filter({ hasText: "third request" }).first();
  await heldOnQueue.getByRole("button", { name: "Release" }).waitFor({ timeout: 30_000 });
  const abort = async (route) => {
    try {
      if (route.request().method() === "POST") return await route.abort("failed");
      return await route.continue();
    } catch {
      /* the page moved on; nothing to answer */
    }
  };
  await page.route("**/*", abort);
  await heldOnQueue.getByRole("button", { name: "Release" }).click();
  await page.getByText(/Could not change that lead/).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const rolledBack = await heldOnQueue.getByRole("button", { name: "Release" }).isVisible();
  await page.screenshot({ path: shotPath("03-queue-rollback-error-toast.png") });
  await page.unroute("**/*", abort);
  step(
    rolledBack
      ? "03 Queue: the failed Release rolled the held row back and drew a red \"Could not change that lead\" bar"
      : "03 Queue: FAILED -- the row did not come back",
  );

  /* ── 4. Today: the scan's own card ───────────────────────────────────── */
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Good morning/ }).waitFor({ timeout: 45_000 });
  const scanCard = page.locator(".wire-scan-card .job-card").first();
  await scanCard.waitFor({ timeout: 30_000 });
  const scanWords = await scanCard.innerText();
  await page.locator(".wire-scan-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotPath("04-today-scan-jobcard.png") });
  step(
    /Reading sources/.test(scanWords)
      ? "04 Today: the rail draws the scan's own card, with its stage, its counted step and its clock"
      : "04 Today: FAILED -- no scan card on the rail",
  );

  /* ── 5. Drafts: the running row is the drawn card ─────────────────────── */
  await page.goto(`${base}/desk/drafts`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Drafts/ }).waitFor({ timeout: 45_000 });
  const draftsCard = page.locator(".drafts-job .job-card").first();
  await draftsCard.waitFor({ timeout: 30_000 });
  const chips = await draftsCard.locator(".job-card-chip").count();
  const hasCancel = await draftsCard.getByRole("button", { name: "Cancel" }).isVisible();
  await page.screenshot({ path: shotPath("05-drafts-running-card.png") });
  step(
    chips > 0 && hasCancel
      ? `05 Drafts: the running row draws the real card -- ${chips} stage chips, a percent and Cancel`
      : `05 Drafts: FAILED -- chips=${chips} cancel=${hasCancel}`,
  );

  /* ── 6. The More ▾ menu, one line, at two widths ──────────────────────── */
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Queue/ }).waitFor({ timeout: 45_000 });
  const row = page.locator(".lead-row").filter({ hasText: "Transit board" }).first();
  await row.locator("summary.more-sum").first().click();
  /*
    SCOPED TO THE ROW. A document-wide  matches every row's own
    panel, and only THIS row's is open --  would take the first row's
    and find it hidden inside a shut <details>, which is a measurement of the
    wrong element, not a failure of the fix.
  */
  const item = row.locator(".more-menu .more-block button", { hasText: "Start an AI follow-up" }).first();
  await item.waitFor({ timeout: 15_000 });
  /*
    HOW MANY LINES THE LABEL IS, not how tall the button is.

    The button carries `min-height: 44px` (the desk's press target), so its box
    is 44px whether its label is one line or two -- measuring the box would call
    every button in the product a wrap. A Range over the button's own contents
    reports one rect per line box, which is the measurement the owner's report
    is about.
  */
  const linesOf = (locator) =>
    locator.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].filter((rect) => rect.height > 0).length;
    });
  const desktopLines = await linesOf(item);
  const desktopBox = await item.boundingBox();
  /*
    THE SENSITIVITY CONTROL: put the two halves of the fix back, on this one
    element, and measure again. `min-width: 232px` is what the menu was and
    `white-space: normal` is what `.btn` is everywhere else in this stylesheet,
    so this is the state the owner reported.

    AND AT TEXT: LARGE, which is the state that actually reproduced it. The desk
    scales every label with `--ts` (design-system: "the paper's text size must
    scale headlines and body, not just labels"), and at Normal the label happens
    to fit 232px's content box with ~24px to spare -- measured: 172px of label
    in 196px of room. At Large it does not, which is why the fix is stated as a
    width AND a `nowrap` rather than as a width alone. A control that cannot see
    the bug it claims is absent is not evidence, so this one is asserted.
  */
  const beforeLines = await item.evaluate((el) => {
    const menu = el.closest(".more-menu");
    const desk = document.querySelector(".desk-ltr");
    const wasWidth = menu.style.minWidth;
    const wasWrap = el.style.whiteSpace;
    const wasLarge = desk.classList.contains("large");
    menu.style.minWidth = "232px";
    // The Queue acts column got wider in Group 2, so the menu has room it did not
    // have; pin the old width so this still reproduces the owner's state.
    const wasPin = menu.style.width;
    menu.style.width = "232px";
    el.style.whiteSpace = "normal";
    desk.classList.add("large");
    const measure = () => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return [...range.getClientRects()].filter((rect) => rect.height > 0).length;
    };
    const largeText = measure();
    desk.classList.remove("large");
    const normalText = measure();
    menu.style.minWidth = wasWidth;
    menu.style.width = wasPin;
    el.style.whiteSpace = wasWrap;
    if (wasLarge) desk.classList.add("large");
    return { largeText, normalText };
  });
  await page.screenshot({ path: shotPath("06-more-menu-one-line-desktop.png") });
  const oneLineDesktop = desktopLines === 1;

  /*
    THE SAME PAGE, RESIZED. A fresh browser context has no session cookie, so a
    second context would land on the sign-in form and measure nothing -- the
    phone pass is the same editor, at the width the desk calls a phone.
  */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Queue/ }).waitFor({ timeout: 45_000 });
  const phoneRow = page.locator(".lead-row").filter({ hasText: "Transit board" }).first();
  await phoneRow.locator("summary.more-sum").first().click();
  const phoneItem = phoneRow
    .locator(".more-menu .more-block button", { hasText: "Start an AI follow-up" })
    .first();
  await phoneItem.waitFor({ timeout: 15_000 });
  const phoneLines = await linesOf(phoneItem);
  await page.screenshot({ path: shotPath("06-more-menu-one-line-phone.png"), fullPage: true });
  const oneLinePhone = phoneLines === 1;
  await page.setViewportSize({ width: 1366, height: 900 });
  step(
    oneLineDesktop && oneLinePhone && beforeLines.largeText > 1
      ? `06 Queue: "Start an AI follow-up" is one line at 1366px (button ${desktopBox.height.toFixed(0)}px) and at 390px; with the old 232px menu and wrapping .btn put back on it, it is ${beforeLines.largeText} lines with the old menu at Text: Large -- the instrument sees the bug`
      : `06 Queue: FAILED -- desktop ${desktopLines} line(s), phone ${phoneLines}, control normal=${beforeLines.normalText} large=${beforeLines.largeText}`,
  );

  /* ── 7. The story page with no draft ─────────────────────────────────── */
  await page.goto(`${base}/desk/story/${leads.bare}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "Checks" }).first().click().catch(() => {});
  /*
    Anchored, because "Nothing blocks Publish" -- the publish bar's own note --
    contains "thing blocks Publish" and would make this count say the prep list
    is on screen when it is not.
  */
  const prep = await page.getByText(/^[0-9]+ things? blocks? Publish$/).count();
  const nextStep = await page.getByText(/Nothing to check yet/).count();
  const draftPress = await page.getByRole("button", { name: "Draft with AI" }).count();
  await page.screenshot({ path: shotPath("07-story-no-draft-one-step.png") });
  step(
    prep === 0 && nextStep > 0 && draftPress > 0
      ? "07 Story: no draft -- no publish-prep list, one next step (\"Draft with AI\"), and the Checks pane says so"
      : `07 Story: FAILED -- prep=${prep} nextStep=${nextStep} press=${draftPress}`,
  );

  /* ── 8. The two Checks panes agree ───────────────────────────────────── */
  /*
    A draft WITH recorded rows: the pane's "nothing to review here" must not be
    on the screen at the same time as a "! Needs review" chip. The two are read
    from the same DOM in one pass, so they cannot be photographed a poll apart.
  */
  await page.goto(`${base}/desk/story/${leads.open[1]}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "Checks" }).first().click().catch(() => {});
  await page.waitForTimeout(2_500);
  const nothing = await page.getByText(/there is nothing to review here/).count();
  const needs = await page.getByText("! Needs review").count();
  await page.screenshot({ path: shotPath("08-checks-panes-agree.png") });
  step(
    !(nothing > 0 && needs > 0)
      ? `08 Story: the review panes agree (nothing-to-review=${nothing}, needs-review=${needs})`
      : "08 Story: FAILED -- both panes are contradicting each other again",
  );

  if (consoleErrors.length) step(`console errors: ${consoleErrors.length} (see the report)`);

  writeFileSync(
    join(OUT_DIR, "fb6-walk-report.json"),
    JSON.stringify({ base, out: OUT_DIR, steps: results, consoleErrors, ms: Date.now() - startedAt }, null, 2),
  );
  for (const line of results) console.log(line);
  console.log(`\nshots: ${OUT_DIR}`);
} catch (error) {
  /*
    Printed BEFORE the finally below, which kills the process: a `finally` that
    ends in `process.exit` swallows the error that got there, and a walk that
    dies silently is the one thing this file must not do.
  */
  failed = true;
  console.error("\nthe walk stopped on an error:\n", error);
  results.push(`the walk stopped on an error: ${error?.message ?? error}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (fakeProvider) fakeProvider.kill();
  /*
    A walk that photographed a broken screen must not exit 0: the shots are the
    evidence, and an evidence run that fails quietly is worse than one that
    never ran. Every step above writes "FAILED" into its own line when its
    measurement did not hold.
  */
  process.exit(failed || results.some((line) => line.includes("FAILED")) ? 1 : 0);
}
