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

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const consoleErrors = [];
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  console.log(`scan desk: ${base}`);
  await ownTheDesk();
  await theScreenRenders();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
