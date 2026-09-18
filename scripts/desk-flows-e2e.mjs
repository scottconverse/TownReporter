#!/usr/bin/env node
/**
 * The 0.5.1 desk flows, driven in a browser.
 *
 * `lifecycle-e2e.mjs` covers file → draft → publish → correct, and stops
 * there. Everything shipped in 0.5.1 had no browser coverage at all: the
 * Opinion desk, delete, Undo, the trash and its restore, the Server page, and
 * the Dark Desk dials. An audit filed that as TE-04, and it is the reason a
 * locator leak and an unreachable editorial both reached the paper — the
 * screens were verified by an agent looking at them once, not by anything that
 * runs again.
 *
 * Deliberately model-free: nothing here starts a scan, a dig, or an editorial.
 * Those cost money and time and are covered by the opt-in live evaluation.
 * What this proves is that the wiring is real — buttons reach the server, the
 * server changes the database, and the change shows up on the screen.
 *
 * Wants an UNCLAIMED desk: it creates its own throwaway owner, like the
 * lifecycle script.
 *
 *   DESK_FLOWS_BASE_URL=http://127.0.0.1:3200 node scripts/desk-flows-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(
  process.env.DESK_FLOWS_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const stamp = Date.now();
const email = `flows-${stamp}@townreporter.test`;
const password = "desk-flows-e2e-pass";
const leadHeadline = `Planning board meets on the Kimbark parcel ${stamp}`;
const expectedModelNames = [
  "Automatic",
  "Codex Astra",
  "Codex Sol",
  "Codex Terra",
  "Codex Luna",
  "Claude Fable",
  "Claude Opus",
  "Claude Sonnet",
  "Claude Haiku",
  "Grok (SuperGrok)",
  "Local model",
];

async function assertSharedModelPicker(picker, expectedValue, surface) {
  const names = (await picker.locator("option").allInnerTexts()).map((line) =>
    line.split("—")[0].trim(),
  );
  if (JSON.stringify(names) !== JSON.stringify(expectedModelNames)) {
    throw new Error(`${surface} model picker choices differ: ${JSON.stringify(names)}`);
  }
  if ((await picker.inputValue()) !== expectedValue) {
    throw new Error(`${surface} model picker default is not ${expectedValue}`);
  }
}

async function assertDeskRoute(label) {
  // The editor desk is server-rendered behind an auth/query gate. Wait for the
  // landmark to exist before reading the whole page, so a legitimately slow
  // route transition is not misreported as the public home still being mounted.
  await page.getByRole("heading", { name: "A clear desk. A good story.", exact: true }).waitFor({ timeout: 20_000 });
  const visible = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const problems = [];
  if (page.url().replace(/\/$/, "") !== `${base}/desk`) {
    problems.push(`URL is ${page.url()}, expected ${base}/desk`);
  }
  if (!visible.includes("A clear desk. A good story.")) {
    problems.push("editor desk home landmark missing");
  }
  if (/Independent\.\s*Local\.\s*Accountable\./.test(visible)) {
    problems.push("public homepage hero rendered under /desk");
  }
  if (problems.length) throw new Error(`${label}: ${problems.join("; ")}`);
}

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  /*
    Record WHERE each error happened, not just that one did.

    The first run of this walk reported a React error at the end and named the
    last page visited, which sent me bisecting the wrong change for half an
    hour. An error collector that does not say which step it fired on is a
    puzzle rather than a diagnosis.
  */
  const consoleErrors = [];
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  console.log(`desk flows: ${base}`);

  // ── Own the desk ──────────────────────────────────────────────────────────
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Flows Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk with no setup token");

  // ── Opinion desk renders and refuses honestly without a voice ─────────────
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Opinion", exact: true }).waitFor();
  step("Opinion desk renders");

  // Opinion uses the shared native provider registry, with Sol selected by default.
  const opinionModel = page.getByLabel("Writing model");
  await assertSharedModelPicker(opinionModel, "codex-frontier", "Opinion");
  step("Opinion exposes every named Codex and Claude model plus Local model");

  // UIUX-03: a live region has to exist before its content changes, or the
  // announcement is frequently never made.
  if ((await page.locator("#desk-announcer").count()) !== 1) {
    throw new Error("the persistent live region is missing from the desk shell");
  }
  step("the desk carries a persistent live region");

  // UIUX-04: subsections such as the shared uploader may use h3 after h2.
  // Reject actual skipped levels instead of prohibiting nested headings.
  const headingLevels = await page.locator("main h1, main h2, main h3, main h4, main h5, main h6")
    .evaluateAll((headings) => headings.map((heading) => Number(heading.tagName.slice(1))));
  if (headingLevels[0] !== 1 || headingLevels.some((level, index) => index > 0 && level > headingLevels[index - 1] + 1)) {
    throw new Error(`Opinion heading levels skip a level: ${headingLevels.join(", ")}`);
  }
  step("page and subsection headings have no skipped level");

  // UIUX-05: the dependency is visible before anything is typed.
  const notReady = await page.getByText(/This desk cannot write yet/i).count();
  const writeBtn = page.getByRole("button", { name: /Write an editorial/ });
  if (notReady > 0) {
    if (!(await writeBtn.isDisabled())) {
      throw new Error("Opinion says it cannot write but the button is still enabled");
    }
    step("Opinion states the missing dependency before anything is typed");
  } else {
    step("Opinion is ready to write (dependency present)");
  }

  await page
    .getByPlaceholder(/rail district wants a second tax/i)
    .fill("The city has not posted council minutes for any 2026 session.");
  if (await writeBtn.isEnabled()) {
    await writeBtn.click();
    // Scoped to the notice region beside the button (role="alert" +
    // aria-live="assertive"), not a page-wide text search: the model picker's
    // collapsed "Set up a writing model" details also carries a hidden
    // "Claude Code installation guide" link, and a loose substring search
    // matches that hidden link (and matches on the very common word "not")
    // well before it ever reaches the visible refusal text, so `.first()`
    // resolved to something that can never become visible.
    await page
      .locator('[role="alert"][aria-live="assertive"]')
      .filter({ hasText: /voice|Claude Code|not|cannot/i })
      .first()
      .waitFor({ timeout: 20_000 });
    step("Opinion refuses clearly when asked to write and it cannot");
  } else {
    step("Opinion refused up front, so nothing was submitted");
  }

  // ── /desk routing: hard load and public-home click both reach the editor ──
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  await assertDeskRoute("hard load of /desk");
  step("hard load of /desk renders the editor desk, not the public hero");

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Editor[’']s desk/i }).first().click();
  await page.waitForURL(`${base}/desk`, { timeout: 20_000 });
  await assertDeskRoute("Editor's desk click from the public home");
  step("Editor's desk click from the public home renders the editor desk");

  // ── Desk landing page: Write a story files a lead from a link + an idea ────
  const writeStoryHeadline = `The planning board moved the Kimbark hearing to Oct. 2 ${stamp}`;
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Write a story", exact: true }).waitFor();
  step("Write a story renders on the desk landing page");

  await page.getByRole("button", { name: "Add documents", exact: true }).waitFor();
  await page.getByLabel("Links or source text", { exact: true })
    .fill(`https://example.org/agenda-${stamp} ${writeStoryHeadline}`);
  const writeStoryBtn = page.getByRole("button", { name: "Write draft", exact: true });
  await writeStoryBtn.click();
  await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 30_000 });
  step("Write a story lands on the saved story page even when drafting cannot continue");

  // ── Queue: the Write a story lead landed, with the full paste kept ────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const writeStoryRow = page.locator(".lead-row", { hasText: writeStoryHeadline }).first();
  await writeStoryRow.waitFor({ timeout: 20_000 });
  await writeStoryRow.getByText("Filed from the Write a story box.").waitFor({ timeout: 10_000 });
  step("the Write a story lead is filed and listed in the Queue");

  // ── Queue: file a lead, then delete it, then undo ─────────────────────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(leadHeadline);
  await page.getByLabel("Why now").fill("The packet posted with a hearing date.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });
  step("a lead can be filed by hand");

  await page.getByRole("button", { name: /Model & research/ }).click();
  const storyModel = page.getByLabel("Writing model");
  await assertSharedModelPicker(storyModel, "auto", "Story");
  step("Story exposes every named Codex and Claude model plus Local model with Automatic selected");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const row = page.locator(".lead-row", { hasText: leadHeadline }).first();
  await row.waitFor();

  const queueModel = row.getByLabel("Writing model");
  await row.locator("summary").filter({ hasText: /^Model:.*change$/ }).click();
  await assertSharedModelPicker(queueModel, "auto", "Queue row");
  // This walk uses the fake Codex CLI so opening the desk and saving source
  // material never depends on a developer's installed providers. Verify that
  // the row preserves the editor's exact explicit selection; the dedicated
  // preflight suite covers missing-provider guidance.
  await queueModel.selectOption("codex-balanced");
  if ((await queueModel.inputValue()) !== "codex-balanced") {
    throw new Error("Queue row did not retain the explicit Codex Terra selection");
  }
  if ((await row.locator("[aria-describedby]").getAttribute("aria-describedby")) === "model-picker-help") {
    throw new Error("Queue model picker still uses the old shared description id");
  }
  step("Queue row retains its own explicit model selection");

  // The actions must be visible without hovering.
  const acts = row.locator(".row-acts");
  const opacity = await acts.evaluate((el) => getComputedStyle(el).opacity);
  if (opacity !== "1") throw new Error(`row actions are hidden (opacity ${opacity})`);
  step("row actions are visible without hovering");

  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: /Yes, delete/ }).click();
  await page.getByText(/Deleted, and kept for 30 days/).waitFor({ timeout: 20_000 });
  step("delete asks once and says the copy is kept");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.locator(".lead-row", { hasText: leadHeadline }).first().waitFor({ timeout: 20_000 });
  step("Undo puts the lead back on the queue");

  // ── Delete again, then restore from the trash on the Server page ──────────
  const row2 = page.locator(".lead-row", { hasText: leadHeadline }).first();
  await row2.getByRole("button", { name: "Delete", exact: true }).click();
  await row2.getByRole("button", { name: /Yes, delete/ }).click();
  await page.getByText(/Deleted, and kept for 30 days/).waitFor({ timeout: 20_000 });

  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Server & newsroom", exact: true }).waitFor();
  step("Server page renders");

  await page.getByRole("navigation", { name: "Server settings" }).getByRole("button", { name: "Recently deleted", exact: true }).click();
  await page.getByRole("heading", { name: "Recently deleted" }).waitFor({ timeout: 20_000 });
  const trashRow = page.locator("li", { hasText: leadHeadline }).first();
  await trashRow.waitFor({ timeout: 20_000 });
  step("the deleted lead is listed in Recently deleted");

  await trashRow.getByRole("button", { name: "Restore" }).click();
  await page.getByText(/Back on the desk/).waitFor({ timeout: 20_000 });
  step("Restore from the trash reports success");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.locator(".lead-row", { hasText: leadHeadline }).first().waitFor({ timeout: 20_000 });
  step("the restored lead is back on the queue");

  // ── Dark Desk dials open and describe themselves ──────────────────────────
  await page.goto(`${base}/desk/dark`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Dark Desk", exact: true }).waitFor();
  step("Dark Desk renders");

  await page.getByText("How hard to dig").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Change", exact: true }).first().click();
  await page.getByText(/Dig — how far it chases/).waitFor({ timeout: 10_000 });
  await page.getByText(/Nerve — how speculative/).waitFor({ timeout: 10_000 });
  step("the dials open and label themselves in plain words");

  if (consoleErrors.length > 0) {
    throw new Error(`console errors during the walk: ${consoleErrors.slice(0, 5).join(" | ")}`);
  }
  step("no console errors across every screen walked");

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length, email }, null, 2));
}

main().catch(dump);
