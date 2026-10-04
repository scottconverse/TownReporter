#!/usr/bin/env node
/**
 * Screenshots of the Meeting ledger panel (WR1 phase 2), light and dark.
 *
 * Boots the BUILT server in this process on its own port and its own in-memory
 * PGlite (DATABASE_URL is cleared, so this never touches the shared Postgres),
 * creates the desk's owner account, seeds one meeting story whose draft carries
 * a whole-meeting ledger -- an unread window, a lead item, roundup items, an
 * excluded one with a reason, two claims (one flagged, one checked), the run's
 * own notes and its cost -- and then photographs the panel the story page
 * draws beside the reporting notes: once in the light appearance and once in
 * the dark one chosen through the desk's own toggle.
 *
 * WHY A REAL BUILD AND NOT A HARNESS. The panel is a `.tsx` component that
 * reaches the router (`Link`), React Query (`useQuery`/`useMutation`) and a
 * server function, so the honest way to draw it is the app that ships. The
 * fixture is seeded straight into the tables WR1's pipeline writes, because a
 * seeded ledger is the only way to get one without spending a model call --
 * and no model call is spent anywhere in this walk.
 *
 * It also measures the smallest rendered font size inside the panel in each
 * appearance, because "no text under 14px" is a rule this panel has to keep and
 * a screenshot cannot be read for it. The two are evidence, not a check:
 * nothing fails on the numbers, but the numbers are printed.
 *
 *   node scripts/wr1-ledger-panel-shots.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

/** This walk's own port. Above the range the e2e walks register, and neither
 *  3000 nor 3100, which the work order reserves. */
const PORT = 8096;

const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT}`);
const OUT = checkedOutputPath(
  resolve(REPO, "..", "townreporter-deepseek-oversight", "quality", "wr1-panel"),
  [resolve(REPO, "..")],
  "output directory",
);

const EMAIL = "wr1-panel-shots@example.com";
const PASSWORD = "wr1-panel-shots-owner-password";

const HEADLINE = "Council takes up airport noise policy and the 2027 budget";
const MEETING_NOTES = [
  "LEDGER: 6 item(s); 1 lead, 3 roundup, 1 excluded, 1 unread.",
  "",
  "CHECKS: 3 claim(s) checked; 2 found, 1 flagged.",
  "",
  "COLD CHECK: the body states no figure the record does not hold.",
  "  · item 3 — 'the council also set aside $9,999,999' — not in the tape or packet.",
].join("\n");

const claims = [];
const shots = [];
function shot(name) {
  shots.push(name);
  console.log(`  shot  ${name}`);
}

function fail(message) {
  throw new Error(message);
}

/** Boot the built server here, in this process, on its own port and database. */
async function bootTheServer() {
  process.env.PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = "";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "wr1-panel-shots-secret";
  await import(pathToFileURL(join(REPO, ".output", "server", "index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`the built server never answered on ${base}`);
}

/**
 * The meeting story and the ledger its draft carries.
 *
 * Every row is one WR1's own pipeline writes, in the shape 0120/0121 give it.
 * The ledger mix is deliberate: a warning row the editor must see first, one
 * item per editorial status, and a timestamp and a packet page on each so the
 * meta line is populated. The claims carry a flagged row (which the list leads
 * with) and a row already ticked, so both states of the mark are on screen.
 */
async function seedTheMeetingStory() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) fail("the server booted without a PGlite instance to seed");

  // Wait for the server's own migrations to settle before writing into them.
  let applied = -1;
  let quiet = 0;
  for (let i = 0; i < 240 && quiet < 3; i += 1) {
    let count = -1;
    try {
      count = Number((await pg.query("select count(*)::int as n from _migrations")).rows[0]?.n);
    } catch {
      /* the migrations table is not there yet */
    }
    if (count === applied && count >= 0) quiet += 1;
    else {
      quiet = 0;
      applied = count;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  await pg.query(
    `insert into paper_settings (newsroom_id, onboarded) values (1, true)
     on conflict (newsroom_id) do update set onboarded = true`,
  );

  const lead = await pg.query(
    `insert into leads (user_id, newsroom_id, headline, why, topic, source_urls)
     values ('wr1-panel-shots', 1, $1, 'the tape covers it', 'council', '[]') returning id`,
    [HEADLINE],
  );
  const leadId = Number(lead.rows[0].id);

  const draft = await pg.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, meeting_notes, run_stats)
     values ('wr1-panel-shots', 1, $1, $2, 'One line.', $3, 'council', $4, $5::jsonb) returning id`,
    [
      leadId,
      HEADLINE,
      "The council set a noise policy.\n\nALSO AT THE MEETING\n\nAirport fund budget: The 2027 airport fund budget totals $733,170.",
      MEETING_NOTES,
      JSON.stringify({ wallMs: 720_000, modelCalls: 57, inputTokens: 410_000, outputTokens: 38_000 }),
    ],
  );
  const draftId = Number(draft.rows[0].id);

  const ledger = [
    [1, "unread-window", "Window 2 could not be inventoried — nothing was read from 0:41:00 to 0:52:00.", 2460, null, "unread", ""],
    [2, "vote", "Airport noise policy carries unanimously", 14, 57, "lead", "the meeting's main decision"],
    [3, "staff-report", "Proposed 2027 airport fund budget totals $733,170", 372, 57, "roundup", "a budget detail"],
    [4, "proclamation", "Proclamation names September as Library Card Sign-up Month", 1505, 63, "roundup", "a short item"],
    [5, "motion", "Motion to direct staff on the staffing capacity plan", 2680, 71, "excluded", "covered in a separate story"],
    [6, "presentation", "NextLight budget summary: $24,907,816 in expenses", 3120, 57, "roundup", "a budget detail"],
  ];
  for (const [itemNo, kind, text, startSeconds, packetPage, status, reason] of ledger) {
    await pg.query(
      `insert into meeting_ledger_items
         (newsroom_id, draft_id, lead_id, item_no, kind, text, start_seconds, packet_page, status, reason, source_excerpt)
       values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [draftId, leadId, itemNo, kind, text, startSeconds, packetPage, status, reason, `verbatim tape text for item ${itemNo}`],
    );
  }

  // A transcript link, so the ledger's timestamps draw as links into the
  // transcript view rather than as plain clock text.
  const artifact = await pg.query(
    `insert into meeting_transcript_artifacts
       (newsroom_id, video_id, artifact_type, storage_path, format, sha256, source_method, retention_mode)
     values (1, 'wr1-fixture-video', 'transcript', 'fixtures/wr1.json', 'json', 'wr1fixturesha', 'manual', 'transcript-only')
     returning id`,
  );
  const artifactId = Number(artifact.rows[0].id);
  await pg.query(
    `insert into meeting_transcript_segments
       (artifact_id, segment_index, start_seconds, end_seconds, item, excerpt, caption_sha256)
     values ($1, 0, 14, 20, 'Airport noise policy', 'And that carries unanimously.', 'seg0sha')`,
    [artifactId],
  );
  await pg.query(
    `insert into meeting_draft_transcript_links
       (newsroom_id, draft_id, artifact_id, citation_snapshot, is_current)
     values (1, $1, $2, $3, true)`,
    [draftId, artifactId, JSON.stringify([{ artifactId, segmentIndex: 0, captionSha256: "seg0sha" }])],
  );

  const claimRows = [
    ["$9,999,999", "primary", "no source holds this figure", "flagged", "checked in code", null],
    ["$733,170", "primary", "packet p57", "found", "checked in code", null],
    ["$24,907,816", "primary", "packet p57", "found", "checked in code", "2026-09-30T15:04:00.000Z"],
  ];
  for (const [claim, kind, ref, status, note, reviewedAt] of claimRows) {
    await pg.query(
      `insert into draft_claims (newsroom_id, draft_id, claim, source_kind, source_ref, check_status, note, reviewed_at)
       values (1, $1, $2, $3, $4, $5, $6, $7)`,
      [draftId, claim, kind, ref, status, note, reviewedAt],
    );
    claims.push(claim);
  }

  console.log(`  ok    seeded the meeting story (lead ${leadId}, draft ${draftId}) with 6 ledger items and 3 claims`);
  return leadId;
}

async function signIn(page) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Create the desk|Editor sign-in/ })
    .waitFor({ timeout: 45_000 });
  /*
    A pause for hydration, from the same failure `first-run-setup-step.mjs`
    documents: this is a controlled React form, and a fill (or a submit) that
    lands before hydration writes into dead HTML -- the DOM value goes in, then
    hydration resets it, and the click does nothing. Waiting for the heading
    proves the DOM is there, not that React owns it yet.
  */
  await page.waitForTimeout(3000);
  const fresh = (await page.getByLabel("Name", { exact: true }).count()) > 0;
  const submit = page.getByRole("button", {
    name: fresh ? "Create editor account" : "Sign in with email",
  });
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  if (fresh) {
    await page.getByLabel("Name").fill("WR1 Panel Shots Owner");
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await fillPendingSetupCodeIfPresent(page);
  }
  /*
    Submit, and retry once. A click into pre-hydration HTML does nothing, and
    the account is created at most once either way -- a second submit on an
    address that now exists is read as "sign this address in", which is exactly
    the outcome wanted.

    Success is read as the URL leaving the login route, not as some one link in
    the desk chrome: the desk draws its own nav client-side, and a wait on a
    single link turns "hydration is slow" into a false failure. Leaving `/login`
    is the fact that matters, and it holds however the chrome renders.
  */
  await submit.click();
  const leftLogin = await page
    .waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  if (!leftLogin) {
    await submit.click();
    await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 45_000 });
  }

  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.getByLabel("Paper name", { exact: true }).count()) {
    await completeFirstRunSetup(page, base, { name: "TownReporter", city: "Testerville", state: "Wyoming" });
    console.log("  ok    the desk has a paper name and a town");
  }
}

/** Open the story, switch to the inspector's Reporting tab, and wait for the panel. */
async function openPanel(page, leadId) {
  await page.goto(`${base}/desk/story/${leadId}`, { waitUntil: "domcontentloaded" });
  /*
    The ledger panel sits inside the Reporting tab of the story inspector, and
    the inspector opens on Checks -- so the panel is in the DOM but hidden
    behind an unselected tab. Selecting the tab is the click the editor makes
    to reach it, and it is what makes the panel visible to photograph.
  */
  await page.getByRole("tab", { name: "Reporting", exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole("tab", { name: "Reporting", exact: true }).click();
  /*
    The inspector column is `position: sticky` with its own scrollbar at desk
    width, so a panel taller than the column is only partly on screen and an
    element screenshot of it lands on whatever else the column is scrolled to.
    Un-sticking the column for the shot puts the whole panel in normal flow;
    nothing about the panel itself -- its type, colours or controls -- changes,
    which is what the shot is evidence of.
  */
  await page.addStyleTag({
    content:
      ".desk-ltr.astra .story-side," +
      ".desk-ltr.astra .astra-inspector-tabs," +
      ".desk-ltr.astra .astra-publish-bar" +
      "{position:static !important;top:auto !important;bottom:auto !important;max-height:none !important;overflow:visible !important}",
  });
  await page.locator(".meeting-ledger-panel").waitFor({ timeout: 45_000 });
  // The collapsible is open by default; make sure its body is drawn.
  await page.locator(".ledger-item").first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(500);
}

/** The smallest rendered font size inside the panel, measured, not eyeballed. */
async function measure(page, label) {
  const smallest = await page.evaluate(() => {
    const root = document.querySelector(".meeting-ledger-panel");
    if (!root) return null;
    let smallest = null;
    for (const el of root.querySelectorAll("*")) {
      const text = el.textContent?.trim() ?? "";
      if (!text) continue;
      if ([...el.children].some((c) => (c.textContent?.trim() ?? "").length > 0)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(px)) continue;
      if (smallest === null || px < smallest.px)
        smallest = { px, what: `${el.className || el.tagName}: ${text.slice(0, 40)}` };
    }
    return smallest;
  });
  console.log(`  ok    ${label}: smallest text in the panel is ${smallest ? `${smallest.px}px (${smallest.what})` : "not found"}`);
  return smallest;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await bootTheServer();
  const leadId = await seedTheMeetingStory();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  try {
    await signIn(page);

    /*
      The desk's appearance is a localStorage preference with a DARK default, so
      "light" is not the absence of a choice -- it is a choice that has to be
      written. Both shots set the store the desk's own footer toggle writes and
      reload, which is what makes the <head> script restamp `data-appearance`
      before the first paint. The toggle button itself is in the nav footer and
      the nav is not on screen at this width, so the store is the honest handle;
      the assertion after each reload is what proves the surface really moved.
    */
    const setAppearance = async (mode) => {
      await page.evaluate((m) => localStorage.setItem("townreporter.desk.mode", m), mode);
      await openPanel(page, leadId);
      await page.waitForFunction(
        (want) => document.documentElement.getAttribute("data-appearance") === want,
        mode === "dark" ? "desk-dark" : "light",
        { timeout: 15_000 },
      );
    };

    // --- light ------------------------------------------------------------
    await setAppearance("light");
    await measure(page, "light");
    const lightPath = join(OUT, "wr1-ledger-panel-light.png");
    await page.locator(".meeting-ledger-panel").screenshot({ path: lightPath, animations: "disabled" });
    shot(lightPath);

    // --- dark -------------------------------------------------------------
    await setAppearance("dark");
    await measure(page, "dark");
    const darkPath = join(OUT, "wr1-ledger-panel-dark.png");
    await page.locator(".meeting-ledger-panel").screenshot({ path: darkPath, animations: "disabled" });
    shot(darkPath);

    if (errors.length) fail(`the screen logged ${errors.length} error(s): ${errors.join(" | ")}`);
    console.log("  ok    no console errors on the panel in either shot");
  } finally {
    await context.close();
    await browser.close();
  }

  const report = { ok: true, shots, port: PORT, base, leadId };
  writeFileSync(join(OUT, "wr1-ledger-panel-shots.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

try {
  await main();
} catch (err) {
  console.error(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2),
  );
  process.exit(1);
}
