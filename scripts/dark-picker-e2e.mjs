#!/usr/bin/env node
/**
 * Dark Desk's model picker, and the Server page's time budgets, in a browser.
 *
 * The two operator rules this release answers are both screen behaviour, and
 * neither is provable from a unit test:
 *
 *   "Anywhere an AI does something, the editor must be able to pick the
 *    model."  Dark Desk was the one surface with no picker at all -- a round
 *    ran on whatever the machine happened to prefer, while the desk's own
 *    documentation said the editor decides. This walk opens the Dark Desk
 *    page, opens a file, and proves the picker is there with the same four
 *    options the Story picker has.
 *
 *   "Timeouts are likely too short for local models -- give the editor the
 *    option to make them longer or shorter in the interface."  This walk types
 *    a new number into the Server page's Time per call field, saves it, and
 *    reloads to prove the number came back from the database rather than from
 *    React state.
 *
 * Deliberately model-free: no round is ever started, so nothing here spends
 * money or calls a provider. Run it with CLAUDE_CLI_PATH pointing at
 * scripts/fakes/fake-claude-cli.mjs and no DATABASE_URL (PGLite).
 *
 *   DARK_PICKER_BASE_URL=http://127.0.0.1:3316 node scripts/dark-picker-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs (which discovers every
 * `-e2e.mjs` file's `const PORT... = <number>`) so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_DARK_PICKER = 3316;

const base = checkedUrl(
  process.env.DARK_PICKER_BASE_URL || `http://127.0.0.1:${PORT_DARK_PICKER}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `darkpick-${stamp}@townreporter.test`;
const password = "dark-picker-e2e-pass";

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
  await page.getByLabel("Name").fill("Dark Picker Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/**
 * The picker on the Dark Desk page, without starting a round.
 *
 * Deliberately never presses Start digging: a round is a real, paid,
 * multi-minute dig that would make live outbound requests. The picker beside
 * Start digging is the same component, bound to the same state, as the one
 * beside Keep digging on an open file -- see `modelChoice` in
 * src/routes/desk.dark.tsx -- so what an editor chooses here is what the
 * first round runs on.
 */
async function thePickerIsThere() {
  await page.goto(`${base}/desk/dark`, { waitUntil: "networkidle" });
  const actions = page.locator("#dark-start-actions");
  await actions.waitFor({ timeout: 30_000 });
  const picker = actions.locator("select");
  await picker.waitFor({ timeout: 30_000 });

  const labels = await picker.locator("option").allInnerTexts();
  const names = labels.map((line) => line.split("—")[0].trim());
  const expected = ["Automatic", "Codex Terra", "Codex Sol", "Claude Opus"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      `Dark Desk picker offers ${JSON.stringify(names)}, expected ${JSON.stringify(expected)}`,
    );
  }
  step("the Dark Desk picker offers the same four options Story has");

  // Its label says digging, not writing: the model there digs.
  const labelText = await actions.locator(".model-picker-label").innerText();
  if (!/Digging model/i.test(labelText)) {
    throw new Error(`picker label reads "${labelText}", expected "Digging model"`);
  }
  step("the picker is labelled for what it does on this page");

  // Choosing a model rewrites the help line to the no-fallback promise.
  await picker.selectOption("codex-frontier");
  await actions
    .getByText("Uses only Codex Sol for this run; no fallback.")
    .waitFor({ timeout: 10_000 });
  step("an explicit choice says out loud that it will not fall back");

  await picker.selectOption("auto");
  await actions.getByText(/otherwise tries Claude Opus, then Codex Terra/).waitFor();
  await actions.getByText(/the round moves to the next/).waitFor();
  step("Automatic names the ladder in the order it is actually tried");
}

async function theTimeoutFieldSaves() {
  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Writing models", exact: true }).waitFor();

  const field = page.locator('[data-provider-time="claude-frontier"]');
  await field.waitFor({ timeout: 30_000 });
  const input = field.locator('input[type="number"]');

  const shipped = await input.inputValue();
  if (!/^\d+$/.test(shipped)) throw new Error(`time field shows "${shipped}", expected seconds`);
  if (!/default \d+ s/.test(await field.innerText())) {
    throw new Error("the field does not state the shipped default next to the value");
  }
  step(`the Server page shows a per-call time budget in seconds (${shipped} s)`);

  const wanted = String(Number(shipped) + 90);
  await input.fill(wanted);
  await field.getByRole("button", { name: "Save" }).click();
  await field.getByRole("button", { name: "Reset" }).waitFor({ timeout: 30_000 });
  step("saving a new number offers a Reset that was not there before");

  // The real check: reload, so the value can only have come from the database.
  await page.reload({ waitUntil: "networkidle" });
  const after = page.locator('[data-provider-time="claude-frontier"] input[type="number"]');
  await after.waitFor({ timeout: 30_000 });
  const reloaded = await after.inputValue();
  if (reloaded !== wanted) {
    throw new Error(`after a reload the field shows ${reloaded}, expected the saved ${wanted}`);
  }
  step("the saved time budget survives a reload, so it is stored, not remembered");

  const row = page.locator('[data-provider-time="claude-frontier"]');
  await row.getByRole("button", { name: "Reset" }).click();
  /*
    Wait for the Reset button to go before reloading. It is rendered only
    while this paper has a stored number, so its disappearance is the signal
    that the write actually landed -- reloading straight after the click
    raced the mutation and read the old value back.
  */
  await row.getByRole("button", { name: "Reset" }).waitFor({ state: "detached", timeout: 30_000 });
  await page.reload({ waitUntil: "networkidle" });
  const restored = await page
    .locator('[data-provider-time="claude-frontier"] input[type="number"]')
    .inputValue();
  if (restored !== shipped) {
    throw new Error(`Reset left ${restored}, expected the shipped ${shipped}`);
  }
  step("Reset puts the shipped default back, rather than storing today's number");
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

  console.log(`dark desk picker + time budgets: ${base}`);
  await ownTheDesk();
  await thePickerIsThere();
  await theTimeoutFieldSaves();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
