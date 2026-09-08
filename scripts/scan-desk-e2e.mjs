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
 * Deliberately model-free, same trick as provider-signin/dark-picker: the
 * CLI is scripts/fakes/fake-claude-cli.mjs, signed in via
 * FAKE_CLAUDE_SIGNED_IN=1, and this walk never clicks Run scan — a real scan
 * fetches every accepted source and spends a real model call, which is
 * exactly what this file must not do. It asserts the screen renders: the
 * previous-scans list state (empty, on a fresh desk) and the Run-scan
 * button's own state (present, enabled, not mid-scan).
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
const dailySettings = process.env.DAILY_SCAN_E2E === "1";
const evidenceDir = resolve(process.env.DAILY_SCAN_E2E_ARTIFACT_DIR || "../daily-scan-evidence");

let page;
const done = [];

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

async function dailySettingsJourney(context, observePage) {
  const initialPage = page;
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
  page = initialPage;
  step("cleanup leaves the future schedule disabled, so no automatic scan can become due");
}

async function routineNoticePermissionsJourney(context, observePage) {
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

  await panel.getByRole("checkbox", { name: "Daily settings source — Library notices" }).check();
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
      .getByRole("checkbox", { name: "Daily settings source — Library notices" })
      .isChecked())
  ) {
    throw new Error("saved routine permission did not survive reload");
  }
  await reloaded
    .getByText(/Revision 1/)
    .first()
    .waitFor();
  step("a source-format permission saves and survives a real reload without enabling publication");

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
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
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

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
