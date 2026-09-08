#!/usr/bin/env node
/**
 * The Scan desk, in a browser (TES-01).
 *
 * Scan drives the lead queue everything downstream depends on, and until
 * this walk it had zero CI-gated browser coverage — the only scripts that
 * ever touched /desk/scan were the nightly, opt-in, real-money proof job and
 * two one-off audit scratch files wired into neither `npm test` nor
 * `ci.yml`. A regression here (a broken button, a silently-dropped state, a
 * stalled-run race) had no CI signal until the following morning at the
 * earliest.
 *
 * The scan portion is deliberately model-free: this walk never clicks Run
 * scan, which would fetch accepted sources. Its batch-draft portion uses
 * only scripts/fakes/fake-claude-cli.mjs, signed in via
 * FAKE_CLAUDE_SIGNED_IN=1. It asserts the screen renders: the previous-scans
 * list state (empty, on a fresh desk), the Run-scan button's own state
 * (present, enabled, not mid-scan), and the explicit batch-draft control
 * through its per-lead terminal results.
 *
 *   SCAN_DESK_BASE_URL=http://127.0.0.1:3420 node scripts/scan-desk-e2e.mjs
 */
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_SCAN_DESK = 3420;

const base = checkedUrl(
  process.env.SCAN_DESK_BASE_URL || `http://127.0.0.1:${PORT_SCAN_DESK}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `scandesk-${stamp}@townreporter.test`;
const password = "scan-desk-e2e-pass";
const routineNoticeFixtureUrl = `https://example.com/townreporter-routine-fixture-${stamp}`;
const dailySettings = process.env.DAILY_SCAN_E2E === "1";
const evidenceDir = resolve(process.env.DAILY_SCAN_E2E_ARTIFACT_DIR || "../daily-scan-evidence");

let page;
const done = [];
let expectedFixtureTimeoutErrors = 0;

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1500);
  } catch {
    /* page already gone */
  }
  if (dailySettings) {
    try {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "daily-scan-failure-dom.txt"), text);
      await page?.screenshot({ path: join(evidenceDir, "daily-scan-failure.png"), fullPage: true });
    } catch {
      /* Preserve the original test failure even if evidence capture fails. */
    }
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Scan Desk Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/**
 * Everything this walk proves, without ever pressing Run scan.
 *
 * A real scan fetches every accepted source and makes one real model call —
 * this walk stays model-free by never clicking the button it asserts on.
 */
async function theScreenRenders() {
  await page.goto(`${base}/desk/scan`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Scan", exact: true }).waitFor({ timeout: 30_000 });
  step("the Scan page renders its own heading");

  const runButton = page.getByRole("button", { name: "Run scan" });
  await runButton.waitFor({ timeout: 30_000 });
  if (await runButton.isDisabled()) {
    throw new Error("Run scan is disabled on a fresh desk with nothing running");
  }
  step("Run scan is present and enabled, and is never clicked by this walk");

  // The model picker beside Run scan is the same component Story/Dark Desk
  // use; proving it renders here is proving Scan is wired into the
  // "every AI call site gets the picker" rule, without starting a round.
  const picker = page.locator(".scan-bar select");
  await picker.waitFor({ timeout: 30_000 });
  const optionCount = await picker.locator("option").count();
  if (optionCount < 2) {
    throw new Error(`Scan's model picker only offers ${optionCount} option(s)`);
  }
  step("the Scan page shows a model picker beside Run scan");

  await page.getByRole("heading", { name: "Previous scans", exact: true }).waitFor({ timeout: 30_000 });
  step('the "Previous scans" section renders');

  // A fresh desk has run zero scans: the zero-state copy, not a skeleton or
  // an error, and the section's own count reads 0.
  await page
    .getByText("No scans yet. Click Run scan when you want a new pass — not on a loop.")
    .waitFor({ timeout: 30_000 });
  step("a fresh desk shows the previous-scans zero state, not a skeleton or an error");

  const count = await page.locator(".sechead:has-text('Previous scans') .sec-count").innerText();
  if (count.trim() !== "0") {
    throw new Error(`Previous scans count reads "${count}", expected 0 on a fresh desk`);
  }
  step("the previous-scans count reads 0 before any scan has run");
}

function futureDenverTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Denver",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(Date.now() + 6 * 60 * 60 * 1000));
}

async function addAcceptedSource() {
  const sourceUrl = `https://daily-settings-${stamp}.example.test/agenda`;
  await page.goto(`${base}/desk/sources`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("URL", { exact: true }).fill(sourceUrl);
  await page.getByLabel("Name", { exact: true }).fill("Daily settings source");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByText("On watch: Daily settings source").waitFor();
  step("an accepted source is available without fetching it");
}

async function addRoutineNoticeFixtureSource() {
  await page.goto(`${base}/desk/sources`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("URL", { exact: true }).fill(routineNoticeFixtureUrl);
  await page.getByLabel("Name", { exact: true }).fill("Routine notice fixture source");
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByText("On watch: Routine notice fixture source").waitFor();
  step("a resolvable routine-check fixture source is accepted without fetching it");
}

async function dailySettingsJourney(context, observePage) {
  const originalPage = page;
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Daily scan", exact: true }) });
  await panel.getByRole("heading", { name: "Daily scan", exact: true }).waitFor();
  const enabled = panel.getByRole("checkbox", { name: /Run once each day/ });
  if (await enabled.isChecked()) throw new Error("daily scan must start disabled");
  await panel.getByText("Timezone: America/Denver").waitFor();
  const runtime = panel.getByLabel("Runtime");
  const labels = await runtime.locator("option").allTextContents();
  const expected = ["Local model", "Claude Code subscription", "Codex Terra subscription", "Codex Sol subscription"];
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`daily runtime labels differ: ${JSON.stringify(labels)}`);
  }
  const historyHref = await panel.getByRole("link", { name: "Open scan history" }).getAttribute("href");
  if (!historyHref?.includes("/desk/scan")) {
    throw new Error("daily scan history link is missing");
  }
  const queueHref = await panel.getByRole("link", { name: "Open the queue" }).getAttribute("href");
  if (!queueHref?.includes("/desk/queue")) {
    throw new Error("daily queue link is missing");
  }
  await panel.getByText(/Accepted community sources \(0\)/).waitFor();
  step("owner sees disabled daily settings, timezone, exact runtimes, and queue/history links");
  for (const [name, href] of [["history", historyHref], ["queue", queueHref]]) {
    const linked = await context.newPage();
    observePage(linked, `daily-${name}-link`);
    await linked.goto(`${base}${href}`, { waitUntil: "domcontentloaded" });
    const originalPage = page;
    page = linked;
    await linked
      .getByRole("heading", { level: 1, name: name === "history" ? "Scan" : "The queue", exact: true })
      .waitFor();
    page = originalPage;
    await linked.close();
  }
  step("daily settings history and queue links open their real desk routes");

  await addAcceptedSource();
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  const freshPanel = page.locator("section", { has: page.getByRole("heading", { name: "Daily scan", exact: true }) });
  await freshPanel.getByText(/Accepted community sources \(1\)/).waitFor();
  await freshPanel.getByRole("checkbox", { name: /Daily settings source/ }).check();
  const cap = freshPanel.getByLabel("Daily source limit");
  await cap.fill("13");
  if (!(await freshPanel.getByRole("button", { name: "Save daily scan" }).isDisabled())) {
    throw new Error("source cap above 12 did not disable Save");
  }
  await freshPanel.getByText(/selected \/ 13 daily limit/).waitFor();
  step("source count and over-cap validation are visible without silently dropping a source");

  await cap.fill("1");
  const time = freshPanel.getByLabel("Local time");
  await time.fill("");
  await freshPanel.getByRole("button", { name: "Save daily scan" }).click();
  await freshPanel.getByText("Choose a valid time, runtime, and source limit from 1 to 12.").waitFor();
  step("an invalid local time returns actionable server feedback");

  const future = futureDenverTime();
  await time.fill(future);
  await runtime.selectOption("claude-cli");
  await freshPanel.getByRole("button", { name: "Save daily scan" }).click();
  await freshPanel.getByText("Daily scan settings saved.").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  const persistedPanel = page.locator("section", { has: page.getByRole("heading", { name: "Daily scan", exact: true }) });
  if ((await persistedPanel.getByLabel("Local time").inputValue()) !== future) throw new Error("saved local time did not persist");
  if ((await persistedPanel.getByLabel("Runtime").inputValue()) !== "claude-cli") throw new Error("saved runtime did not persist");
  if (!(await persistedPanel.getByRole("checkbox", { name: /Daily settings source/ }).isChecked())) throw new Error("saved source selection did not persist");
  step("disabled future schedule saves and survives a real reload");

  const other = await context.newPage();
  observePage(other, "daily-second-tab");
  other.setDefaultTimeout(45_000);
  await other.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  const otherPanel = other.locator("section", { has: other.getByRole("heading", { name: "Daily scan", exact: true }) });
  await otherPanel.getByRole("heading", { name: "Daily scan", exact: true }).waitFor();
  await otherPanel.getByLabel("Daily source limit").fill("3");
  await persistedPanel.getByLabel("Daily source limit").fill("2");
  await persistedPanel.getByRole("button", { name: "Save daily scan" }).click();
  await persistedPanel.getByText("Daily scan settings saved.").waitFor();
  page = other;
  await otherPanel.getByRole("button", { name: "Save daily scan" }).click();
  await otherPanel.getByText("The schedule changed in another window. Refresh and try again.").waitFor();
  await otherPanel.getByRole("button", { name: "Reload latest settings" }).click();
  await otherPanel.getByText("Latest settings reloaded.").waitFor();
  await expect.poll(() => otherPanel.getByLabel("Daily source limit").inputValue(), { timeout: 10_000 }).toBe("2");
  step("a stale second tab gets an explicit conflict and reload path");

  await otherPanel.getByLabel("Daily source limit").fill("13");
  await otherPanel.getByRole("button", { name: "Pause daily scan" }).click();
  await otherPanel.getByText("Daily scan paused. Unsaved edits retained.").waitFor();
  if ((await otherPanel.getByLabel("Daily source limit").inputValue()) !== "13") throw new Error("pause discarded dirty edits");
  step("pause works with invalid dirty edits and retains them");

  mkdirSync(evidenceDir, { recursive: true });
  await otherPanel.screenshot({ path: join(evidenceDir, "daily-scan-settings-desktop.png") });
  await other.setViewportSize({ width: 390, height: 844 });
  if (!(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error("daily scan panel has horizontal overflow at 390px");
  }
  await otherPanel.screenshot({ path: join(evidenceDir, "daily-scan-settings-mobile.png") });
  await other.getByRole("button", { name: "Dark", exact: true }).click();
  await other.getByRole("button", { name: "Large", exact: true }).click();
  if (!(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error("daily scan panel has horizontal overflow at 390px in dark large-text mode");
  }
  await otherPanel.screenshot({ path: join(evidenceDir, "daily-scan-settings-mobile-dark-large.png") });
  await other.reload({ waitUntil: "domcontentloaded" });
  const cleanupPanel = other.locator("section", { has: other.getByRole("heading", { name: "Daily scan", exact: true }) });
  await cleanupPanel.getByRole("button", { name: "Resume daily scan" }).click();
  await cleanupPanel.getByText("Daily scan resumed.").waitFor();
  if (await cleanupPanel.getByRole("checkbox", { name: /Run once each day/ }).isChecked()) {
    throw new Error("cleanup unexpectedly enabled the daily schedule");
  }
  await other.close();
  page = originalPage;
  step("cleanup leaves the future schedule disabled, so no automatic scan can become due");
}

async function fileQueueLead(headline, why) {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  const form = page.locator("details.file-form");
  await form.locator("summary").click();
  await form.getByLabel("Headline").fill(headline);
  await form.getByLabel("Why now").fill(why);
  await form.getByRole("button", { name: "File lead" }).click();
  await page.getByRole("heading", { name: headline, exact: true }).waitFor();
}

async function persistSuppliedScope(headline, why) {
  await fileQueueLead(headline, why);

  // Draft performs the real saveReportingNotes call first. Hold only its
  // second, model-bearing draftLead request and abort it: the stored scope is
  // now supplied-only while the lead remains New, and no model call, fetch,
  // or fabricated application response reached the worker.
  await page.getByLabel("Drafting scope").selectOption("supplied");
  await page.getByLabel("Writing model").selectOption("claude-frontier");
  let heldDraftRoute;
  let markDraftHeld;
  const draftHeld = new Promise((resolve) => {
    markDraftHeld = resolve;
  });
  const holdDraftLead = async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.headers()["x-tsr-serverfn"] === "true" &&
      request.postData()?.includes("modelChoice")
    ) {
      heldDraftRoute = route;
      markDraftHeld();
      return;
    }
    await route.continue();
  };
  await page.route("**/*", holdDraftLead);
  await page.getByRole("button", { name: "Draft with AI", exact: true }).click();
  await draftHeld;
  if (!heldDraftRoute)
    throw new Error("supplied-scope setup did not hold the model-bearing draft request");
  expectedFixtureTimeoutErrors += 1;
  await heldDraftRoute.abort("timedout");
  await page.unroute("**/*", holdDraftLead);
}

/**
 * Batch drafting uses two locally filed supplied-material leads. Their scopes
 * are persisted through real notes requests while the model calls are held,
 * so the actual batch worker can complete against the signed-in fake Claude
 * CLI without source search or network traffic.
 */
async function draftBatchJourney() {
  const first = `Library storytime registration ${stamp}`;
  const second = `Recreation center fall league deadline ${stamp}`;
  const extras = [
    `Library board agenda ${stamp}`,
    `Parks trail cleanup ${stamp}`,
    `Community concert schedule ${stamp}`,
    `Recycling pickup reminder ${stamp}`,
  ];
  await persistSuppliedScope(first, "Registration opens for the library program.");
  await persistSuppliedScope(second, "Residents need the recreation deadline.");
  for (const headline of extras) {
    await fileQueueLead(headline, "A locally filed lead used only to verify the selection cap.");
  }

  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  const batch = page.locator("#draft-batch");
  await batch.getByRole("heading", { name: "Draft selected leads", exact: true }).waitFor();

  await page.getByRole("checkbox", { name: `Select ${first} for batch drafting` }).check();
  await page.getByRole("checkbox", { name: `Select ${second} for batch drafting` }).check();
  for (const headline of extras.slice(0, 3)) {
    await page.getByRole("checkbox", { name: `Select ${headline} for batch drafting` }).check();
  }
  await batch.getByText("5 of 5 selected").waitFor();
  await expect(
    page.getByRole("checkbox", { name: `Select ${extras[3]} for batch drafting` }),
  ).toBeDisabled();
  for (const headline of extras.slice(0, 3)) {
    await page.getByRole("checkbox", { name: `Select ${headline} for batch drafting` }).uncheck();
  }
  await batch.getByText("2 of 5 selected").waitFor();

  const runtime = batch.getByLabel("Batch runtime");
  const labels = await runtime.locator("option").allTextContents();
  const expected = ["Local model", "Claude Code", "Codex Terra", "Codex Sol"];
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error(`batch runtime labels differ: ${JSON.stringify(labels)}`);
  }
  await runtime.selectOption("claude-cli");
  await batch.getByRole("button", { name: "Draft selected" }).click();
  await batch.getByText("Draft batch started with Claude Code.").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await batch.getByText(/Batch #\d+ · Claude Code/).waitFor();
  await batch.getByRole("link", { name: `Open ${first}` }).waitFor();
  await batch.getByRole("link", { name: `Open ${second}` }).waitFor();

  // The offline fake returns valid draft JSON. Polling must stop only after
  // both durable terminal results render, then the queue count must refresh
  // from New to Drafted instead of retaining stale pre-batch rows.
  await expect
    .poll(
      async () => {
        const states = await batch.locator("[data-draft-batch-status]").allTextContents();
        return states.length === 2 && states.every((state) => state.trim() === "Completed");
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  await expect
    .poll(
      () => page.getByRole("button", { name: "drafted 2", exact: true }).count(),
      { timeout: 10_000 },
    )
    .toBe(1);
  step("two selected leads use one explicit runtime, complete, and refresh the Drafted queue count");
}

async function routineNoticePermissionsJourney(context, observePage) {
  await addRoutineNoticeFixtureSource();
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  const panel = page.locator("#routine-notice-permissions");
  await panel.getByRole("heading", { name: "Routine notice permissions", exact: true }).waitFor();
  await panel
    .getByText(
      "Automatic publication is not available in this version; no items will publish from these settings.",
    )
    .waitFor();
  await panel.getByText("No source-and-format permissions are saved.").waitFor();
  const sourcesHref = await panel.getByRole("link", { name: "Open Sources" }).getAttribute("href");
  if (!sourcesHref?.includes("/desk/sources"))
    throw new Error("routine permissions source link is missing");
  const linked = await context.newPage();
  observePage(linked, "routine-sources-link");
  await linked.goto(`${base}${sourcesHref}`, { waitUntil: "domcontentloaded" });
  await linked.getByRole("heading", { level: 1, name: "Sources", exact: true }).waitFor();
  await linked.close();
  step("owner sees empty routine permissions, no publication capability, and the source link");

  await panel
    .getByRole("checkbox", { name: "Routine notice fixture source — Library notices" })
    .check();
  await panel
    .getByRole("checkbox", { name: "Routine notice fixture source — Waste and recycling schedules" })
    .check();
  await panel.getByRole("button", { name: "Save routine permissions" }).click();
  await panel
    .getByText(
      "Permissions saved. Automatic publication is not available in this version; no items will publish from these settings.",
    )
    .waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  const reloaded = page.locator("#routine-notice-permissions");
  if (
    !(await reloaded
      .getByRole("checkbox", { name: "Routine notice fixture source — Library notices" })
      .isChecked())
  ) {
    throw new Error("saved routine permission did not survive reload");
  }
  if (
    !(await reloaded
      .getByRole("checkbox", { name: "Routine notice fixture source — Waste and recycling schedules" })
      .isChecked())
  ) {
    throw new Error("saved unsupported routine permission did not survive reload");
  }
  await reloaded
    .getByText(/Revision 1/)
    .first()
    .waitFor();
  step("a source-format permission saves and survives a real reload without enabling publication");

  const checks = reloaded.locator("#routine-notice-checks");
  await checks.getByRole("heading", { name: "Manual notice checks", exact: true }).waitFor();
  await checks
    .getByText(
      "Manual structural check only. It creates no lead, draft, article, scheduled work, or publication.",
    )
    .waitFor();
  const libraryCheck = checks.locator("li", { hasText: "Library notices" });
  const unavailableCheck = checks.locator("li", { hasText: "Waste and recycling schedules" });
  await libraryCheck.getByRole("button", { name: "Check captured notices" }).waitFor();
  await unavailableCheck.getByRole("button", { name: "Check captured notices" }).waitFor();
  step("a saved source-format pair offers a manual structural check with no publication capability");

  let releaseUnavailableCheck;
  const unavailableCheckReleased = new Promise((resolve) => {
    releaseUnavailableCheck = resolve;
  });
  let markUnavailableCheckEntered;
  const unavailableCheckEntered = new Promise((resolve) => {
    markUnavailableCheckEntered = resolve;
  });
  let holdUnavailableCheck = true;
  const holdUnavailableRoutineCheck = async (route) => {
    const request = route.request();
    const payload = request.postData() ?? "";
    if (
      holdUnavailableCheck &&
      request.method() === "POST" &&
      request.headers()["x-tsr-serverfn"] === "true" &&
      payload.includes("waste-recycling-schedule")
    ) {
      holdUnavailableCheck = false;
      markUnavailableCheckEntered();
      await unavailableCheckReleased;
    }
    await route.continue();
  };
  await page.route("**/*", holdUnavailableRoutineCheck);
  const unavailableButton = unavailableCheck.locator("button").first();
  await unavailableButton.click();
  await unavailableCheckEntered;
  if (!(await unavailableButton.isDisabled())) {
    throw new Error("the pending unavailable check left its own row editable");
  }
  if (await libraryCheck.getByRole("button", { name: "Check captured notices" }).isDisabled()) {
    throw new Error("the pending unavailable check froze a different approved pair");
  }
  releaseUnavailableCheck();
  await unavailableCheck
    .getByText("This approved format does not have a captured-data adapter yet.")
    .waitFor();
  await page.unroute("**/*", holdUnavailableRoutineCheck);
  if (new URL(page.url()).pathname !== "/desk/ops") {
    throw new Error("an unavailable routine adapter navigated away from Server permissions");
  }
  step("an unavailable approved format reports its adapter boundary without starting publication work");

  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error("manual notice checks have horizontal overflow at 390px");
  }
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error("manual notice checks have horizontal overflow at 390px in dark large-text mode");
  }
  step("manual notice checks remain readable at a narrow width in dark large-text mode");

  const other = await context.newPage();
  observePage(other, "routine-second-tab");
  other.setDefaultTimeout(45_000);
  await other.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  const otherPanel = other.locator("#routine-notice-permissions");
  await otherPanel
    .getByRole("heading", { name: "Routine notice permissions", exact: true })
    .waitFor();
  await otherPanel
    .getByRole("checkbox", { name: "Daily settings source — Community and arts event logistics" })
    .check();
  await reloaded
    .getByRole("checkbox", { name: "Daily settings source — Parks and recreation notices" })
    .check();
  await reloaded.getByRole("button", { name: "Save routine permissions" }).click();
  await reloaded.getByText(/Permissions saved\. Automatic publication/).waitFor();
  await otherPanel.getByRole("button", { name: "Save routine permissions" }).click();
  await otherPanel.getByText("Routine notice settings changed. Reload before saving.").waitFor();
  await otherPanel.getByRole("button", { name: "Reload latest settings" }).click();
  await otherPanel.getByText("Latest routine permissions reloaded.").waitFor();
  step("a stale routine-permissions tab gets an explicit conflict and reload path");

  await other.goto(`${base}/desk/sources`, { waitUntil: "domcontentloaded" });
  const sourceRow = other.locator("tr", { hasText: "Daily settings source" });
  await sourceRow.getByRole("button", { name: "Drop", exact: true }).click();
  await other.getByRole("heading", { name: "Rejected", exact: true }).waitFor();
  await other.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  await other.reload({ waitUntil: "domcontentloaded" });
  await otherPanel.getByText("Saved permissions need attention").waitFor();
  await otherPanel
    .getByText(/Saved address: https:\/\/daily-settings-/)
    .first()
    .waitFor();
  await otherPanel.getByRole("checkbox", { name: "Pause routine notice permissions" }).check();
  let releaseDelayedRoutineSave;
  const delayedRoutineSave = new Promise((resolve) => {
    releaseDelayedRoutineSave = resolve;
  });
  let enteredDelayedRoutineSave;
  const routineSaveEntered = new Promise((resolve) => {
    enteredDelayedRoutineSave = resolve;
  });
  let holdRoutineSave = true;
  await other.route("**/*", async (route) => {
    const request = route.request();
    if (
      holdRoutineSave &&
      request.method() === "POST" &&
      request.postData()?.includes('"approvals"')
    ) {
      holdRoutineSave = false;
      enteredDelayedRoutineSave();
      await delayedRoutineSave;
    }
    await route.continue();
  });
  await otherPanel.getByRole("button", { name: "Save routine permissions" }).click();
  await routineSaveEntered;
  const pauseControl = otherPanel.getByRole("checkbox", {
    name: "Pause routine notice permissions",
  });
  if (!(await pauseControl.isDisabled()))
    throw new Error("pause stayed editable while its save was pending");
  const revokeControls = otherPanel.getByRole("button", {
    name: "Revoke saved permission",
    exact: true,
  });
  if (!(await revokeControls.first().isDisabled())) {
    throw new Error("revoke stayed editable while its save was pending");
  }
  releaseDelayedRoutineSave();
  await otherPanel.getByText(/Permissions saved\. Automatic publication/).waitFor();
  await other.unroute("**/*");
  await otherPanel.getByText("Paused", { exact: true }).waitFor();
  await otherPanel
    .getByText(/Saved address: https:\/\/daily-settings-/)
    .first()
    .waitFor();
  step("pausing retains an invalid recorded permission until the owner explicitly revokes it");

  while (
    await otherPanel.getByRole("button", { name: "Revoke saved permission", exact: true }).count()
  ) {
    await otherPanel
      .getByRole("button", { name: "Revoke saved permission", exact: true })
      .first()
      .click();
  }
  await otherPanel.getByRole("button", { name: "Save routine permissions" }).click();
  await otherPanel
    .getByText(/Revoked/)
    .first()
    .waitFor();
  if (await otherPanel.getByText("Saved permissions need attention").isVisible()) {
    throw new Error("explicit revocation left an invalid routine permission behind");
  }
  mkdirSync(evidenceDir, { recursive: true });
  await otherPanel.screenshot({
    path: join(evidenceDir, "routine-notice-permissions-desktop.png"),
  });
  await other.setViewportSize({ width: 390, height: 844 });
  if (!(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error("routine notice permissions have horizontal overflow at 390px");
  }
  await otherPanel.screenshot({ path: join(evidenceDir, "routine-notice-permissions-mobile.png") });
  await other.getByRole("button", { name: "Dark", exact: true }).click();
  await other.getByRole("button", { name: "Large", exact: true }).click();
  if (!(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
    throw new Error(
      "routine notice permissions have horizontal overflow at 390px in dark large-text mode",
    );
  }
  await otherPanel.screenshot({
    path: join(evidenceDir, "routine-notice-permissions-mobile-dark-large.png"),
  });
  await other.close();
  step("routine permissions can pause and revoke without creating a publication");
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const consoleErrors = [];
  const note = (text) => {
    if (expectedFixtureTimeoutErrors > 0 && /net::ERR_TIMED_OUT/.test(text)) {
      expectedFixtureTimeoutErrors -= 1;
      return;
    }
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  };
  const observePage = (target, label) => {
    target.on("pageerror", (e) => note(`${label}: ${String(e.message ?? e).slice(0, 200)}`));
    target.on("console", (m) => {
      if (m.type() === "error") note(`${label}: ${m.text().slice(0, 200)}`);
    });
  };
  observePage(page, "daily-first-tab");

  console.log(`scan desk: ${base}`);
  if (dailySettings) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "daily-scan-test-owner.json"), JSON.stringify({ email }, null, 2));
    console.log(`daily settings test owner: ${email}`);
  }
  await ownTheDesk();
  await theScreenRenders();
  if (dailySettings) await dailySettingsJourney(context, observePage);
  if (dailySettings) await routineNoticePermissionsJourney(context, observePage);
  await draftBatchJourney();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
