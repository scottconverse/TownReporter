#!/usr/bin/env node
/**
 * Mistyping the setup code must not lock the new owner out of their own install.
 *
 * The setup code (Unit CJ, 0.6.80) gates the first account on a fresh install.
 * The account is created first and the claim happens after, in the same submit
 * -- so a wrong code reaches this state: an authenticated session exists, the
 * desk is still unclaimed, and the server has just refused with "Wrong setup
 * code." What the owner is looking at in that moment is the whole feature. The
 * only thing they can do is retype the code.
 *
 * Before Unit CR (0.6.81) they could not. `Login` redirects any signed-in
 * visitor to /desk -- that guard ran the moment the session landed, so the
 * error, the setup field, and the typed email were all unmounted in the same
 * render that showed them. /desk then refuses an unclaimed owner and sends the
 * browser back to /login, which redirects again: a loop with no exit and no
 * screen on which to type the right code. The review's P1 finding.
 *
 * This walk asserts the whole recovery, in a real browser:
 *
 *   1. create the account with a deliberately WRONG code
 *   2. the refusal is shown AND the form is still there, still on /login
 *   3. retype the real code (the file installer/Install.ps1 tells a human to
 *      read) and submit again -- no re-signup, the session already exists
 *   4. claim succeeds, /desk/setup completes, and the desk opens
 *
 * Step 2 is the failing-first assertion: on the 0.6.80 code the page is gone
 * before it can be read.
 *
 * Wants an UNCLAIMED desk with a PENDING setup code -- a fresh install, which
 * is also the only install where the field renders at all.
 *
 *   FIRST_OWNER_BASE_URL=http://127.0.0.1:3541 node scripts/first-owner-setup-code-walk.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, pendingSetupCodePath } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.FIRST_OWNER_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const stamp = Date.now();
const email = process.env.FIRST_OWNER_EMAIL ?? `first-owner-${stamp}@townreporter.test`;
const password = process.env.FIRST_OWNER_PASSWORD ?? "first-owner-e2e-pass";

// Well-formed shape (4-4-4-4, Crockford), wrong code: the refusal this walk
// depends on has to come from the comparison, not from a format check.
const WRONG_CODE = "ZZZZ-ZZZZ-ZZZZ-ZZZZ";

const done = [];
const step = (name) => {
  done.push(name);
  console.log(`  ok    ${name}`);
};

let page;

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e).slice(0, 200)));

  console.log(`first-owner setup code: ${base}`);

  const codePath = pendingSetupCodePath();
  let realCode = "";
  try {
    realCode = readFileSync(codePath, "utf8").trim();
  } catch (err) {
    throw new Error(`no pending setup code at ${codePath}: ${err}`);
  }
  if (!realCode) throw new Error(`the setup code file ${codePath} is empty`);

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk/ }).waitFor();

  const codeField = page.getByLabel("Setup code", { exact: true });
  // The gate is the premise of this walk: on an install that already has an
  // owner there is no field, and every assertion below would be about nothing.
  await codeField.waitFor({ timeout: 20_000 });
  step("a fresh install shows the setup code field");

  await page.getByLabel("Name").fill("First Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await codeField.fill(WRONG_CODE);
  await page.getByRole("button", { name: "Create editor account" }).click();

  /*
    THE assertion this walk exists for. The account was just created, so a
    session now exists; the desk is still unclaimed. The owner must still be
    standing on the setup form, reading why, with the field in front of them.
  */
  await page.getByText("Wrong setup code.", { exact: true }).waitFor({ timeout: 30_000 });
  step("the refusal is shown");

  if (new URL(page.url()).pathname !== "/login") {
    throw new Error(`the refusal was shown but the page left /login: ${page.url()}`);
  }
  if ((await codeField.count()) === 0) {
    throw new Error("the setup code field was unmounted with the error -- nothing to retype into");
  }
  step("the form and its setup field survive the refusal, still on /login");

  // Retype the real code. The account already exists and the session is live,
  // so this submit is a claim retry, not a signup: the walk deliberately does
  // NOT re-run signup (which would fail with "account exists" and land on the
  // sign-in path, an entirely different code path from the one under test).
  await codeField.fill(realCode);
  await page.getByRole("button", { name: "Create editor account" }).click();

  await page.waitForURL(/\/desk\/setup/, { timeout: 60_000 });
  step("the right code claims the desk and lands on the first-run setup");

  await completeFirstRunSetup(page, base);
  step("the desk opens");

  if (errors.length) throw new Error(`console errors: ${errors.slice(0, 3).join(" | ")}`);
  step("no page errors");

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
}

main().catch(async (err) => {
  let text = "";
  let url = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 900);
  } catch {
    /* gone */
  }
  console.error(
    JSON.stringify(
      { ok: false, error: String(err?.message ?? err), url, text, completed: done },
      null,
      2,
    ),
  );
  process.exit(1);
});
