#!/usr/bin/env node
/**
 * The Writing models panel, driven in a browser.
 *
 * The feature this covers is the one an operator reaches on the worst day: a
 * writing-model login has lapsed, every draft is failing, and the fix used to
 * be a terminal. Everything about it is screen behaviour — a row that says the
 * right words, a link that renders as a real anchor, a row that flips to
 * "Signed in" on its own — and none of that is provable from a unit test.
 *
 * Deliberately model-free: the CLI it drives is scripts/fakes/fake-claude-cli.mjs,
 * so nothing here spends money, opens a browser tab at Anthropic, or touches
 * the operator's real credentials.
 *
 * Two phases, because the thing being switched is server-side environment and
 * a running server cannot be told to change its mind:
 *
 *   PROVIDER_SIGNIN_PHASE=missing  — no CLI on the machine at all
 *   PROVIDER_SIGNIN_PHASE=fake     — CLAUDE_CLI_PATH points at the fake
 *
 * Each phase wants its own server and its own unclaimed desk (it creates a
 * throwaway owner, like the other walks).
 *
 *   PROVIDER_SIGNIN_BASE_URL=http://127.0.0.1:3312 \
 *   PROVIDER_SIGNIN_PHASE=fake node scripts/provider-signin-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_PROVIDER_SIGNIN = 3312;

const base = checkedUrl(
  process.env.PROVIDER_SIGNIN_BASE_URL || `http://127.0.0.1:${PORT_PROVIDER_SIGNIN}`,
).replace(/\/$/, "");
const phase = process.env.PROVIDER_SIGNIN_PHASE || "fake";

const stamp = Date.now();
const email = `signin-${stamp}@townreporter.test`;
const password = "provider-signin-e2e-pass";

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
  console.error(
    JSON.stringify({ ok: false, phase, error: message, url, text, completed: done }, null, 2),
  );
  process.exit(1);
}

const row = (provider) => page.locator(`li[data-provider="${provider}"]`);

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Sign-in Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

async function openThePanel() {
  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Writing models", exact: true }).waitFor();
  await row("claude").waitFor();
  await row("codex").waitFor();
  step("the Writing models panel renders a row for each provider");

  const note = await page
    .getByText(
      /Being signed in to claude\.ai in your browser or the Claude desktop app is a separate login/,
    )
    .count();
  if (note !== 1) {
    throw new Error("the claude.ai-is-a-different-login sentence is missing from the panel");
  }
  step("the panel says plainly that claude.ai is a different login");
}

async function phaseMissing() {
  await openThePanel();
  for (const provider of ["claude", "codex"]) {
    const text = await row(provider).innerText();
    if (!/Not installed/.test(text)) {
      throw new Error(`${provider} row does not say "Not installed": ${text}`);
    }
    if (await row(provider).getByRole("button", { name: /^Sign in to / }).count()) {
      throw new Error(`${provider} offers a Sign in button with nothing to sign in to`);
    }
  }
  step("with no CLI installed, both rows say so and offer no button that cannot work");
}

async function phaseFake() {
  await openThePanel();

  const claude = row("claude");
  const before = await claude.innerText();
  if (!/Not signed in/.test(before)) {
    throw new Error(`Claude row should read "Not signed in", got: ${before}`);
  }
  step("an installed but signed-out CLI reads Not signed in");

  await claude.getByRole("button", { name: "Sign in to Claude Code" }).click();

  // A real anchor, opening in a new tab. A link the operator cannot open is
  // the whole failure this feature exists to end.
  const link = claude.locator('a[href^="https://claude.com/cai/oauth/authorize"]');
  await link.waitFor({ timeout: 30_000 });
  if ((await link.getAttribute("target")) !== "_blank") {
    throw new Error("the authorize link does not open in a new tab");
  }
  step("clicking Sign in renders the CLI's own authorize link");

  if (!/runs out in \d+:\d\d/.test(await claude.innerText())) {
    throw new Error("no countdown next to the link");
  }
  if (!(await claude.getByRole("button", { name: "Cancel" }).count())) {
    throw new Error("no way to cancel a sign-in in progress");
  }
  step("the waiting state shows a countdown and a Cancel");

  // The fake finishes on its own timer; the row must notice without a reload.
  await claude.getByText(/Signed in as editor@example\.org/).waitFor({ timeout: 60_000 });
  step("the row flips to Signed in on its own when the CLI completes");

  /*
    Scoped to the panel, not the page: the desk chrome has its own "Sign out"
    for the editor's own account, which is a different thing entirely. What
    must not exist is a way to sign the PAPER out of a writing model.
  */
  const panel = page.locator("#writing-models");
  if (await panel.getByRole("button", { name: /Sign out/i }).count()) {
    throw new Error("a provider Sign out button exists; it must not (see CHANGELOG 0.6.0)");
  }
  step("the panel offers no way to sign the paper out of a writing model");
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

  console.log(`provider sign-in (${phase}): ${base}`);
  await ownTheDesk();
  if (phase === "missing") await phaseMissing();
  else await phaseFake();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, phase, completed: done }, null, 2));
}

main().catch(dump);
