#!/usr/bin/env node
/**
 * The Sources desk, in a browser (TES-01).
 *
 * Sources is the watch list an editor curates — the scanner only ever
 * fetches what is accepted here — and until this walk it had zero CI-gated
 * browser coverage. This adds, then accepts-back-out and rejects, a real
 * source through the real form, and asserts on the real DOM at every step:
 * nothing here is "the page loaded," it is "the row an editor would see."
 *
 * Deliberately model-free: adding/editing a source never calls a writing
 * model, so no fake CLI is even required, but the fixture still runs with
 * one set up (FAKE_CLAUDE_SIGNED_IN=1) to match this repo's other desk
 * walks and keep the Server page's provider status quiet in the console.
 *
 *   SOURCES_DESK_BASE_URL=http://127.0.0.1:3421 node scripts/sources-desk-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_SOURCES_DESK = 3421;

const base = checkedUrl(
  process.env.SOURCES_DESK_BASE_URL || `http://127.0.0.1:${PORT_SOURCES_DESK}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `sourcesdesk-${stamp}@townreporter.test`;
const password = "sources-desk-e2e-pass";
const sourceUrl = `https://www.example-town-council.test/packets-${stamp}`;
const sourceTitle = `Town Council packets ${stamp}`;

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
  await page.getByLabel("Name").fill("Sources Desk Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/** The row for a given source URL, wherever it currently sits (On watch/Proposed/Rejected). */
function rowFor(url) {
  return page.locator("tr.lead-tr", { hasText: url });
}

async function theScreenRenders() {
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Sources", exact: true }).waitFor({ timeout: 30_000 });
  step("the Sources page renders its own heading");

  await page.getByLabel("URL", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Name", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Add source" }).waitFor({ timeout: 30_000 });
  step("the add-a-source form renders URL, Name, and Add source");

  await page.getByText("Nothing on watch yet — add a URL above.").waitFor({ timeout: 30_000 });
  step("a fresh desk shows the on-watch zero state");
}

async function addingASourcePersists() {
  await page.getByLabel("URL", { exact: true }).fill(sourceUrl);
  await page.getByLabel("Name", { exact: true }).fill(sourceTitle);
  await page.getByRole("button", { name: "Add source" }).click();

  await page.getByText(`On watch: ${sourceTitle}`).waitFor({ timeout: 30_000 });
  step("adding a source shows the on-watch confirmation");

  await page.getByRole("heading", { name: "On watch", exact: true }).waitFor({ timeout: 30_000 });
  await rowFor(sourceUrl).waitFor({ timeout: 30_000 });
  step("the new source appears in the On watch list");

  // The real check: reload, so the row can only have come from the database.
  await page.reload({ waitUntil: "networkidle" });
  await rowFor(sourceUrl).waitFor({ timeout: 30_000 });
  const link = rowFor(sourceUrl).locator(`a[href="${sourceUrl}"]`);
  await link.waitFor({ timeout: 30_000 });
  step("the source survives a reload, so it is stored, not remembered in React state");
}

async function droppingThenRestoringUpdatesTheList() {
  const row = rowFor(sourceUrl);
  await row.getByRole("button", { name: "Drop" }).click();

  // Dropped moves the row out of On watch and into Rejected.
  await page.getByRole("heading", { name: "Rejected", exact: true }).waitFor({ timeout: 30_000 });
  const rejectedSection = page.locator("section.src-sec", { hasText: "Rejected" });
  await rejectedSection.locator("tr.lead-tr", { hasText: sourceUrl }).waitFor({ timeout: 30_000 });
  step("Drop removes the source from On watch and files it under Rejected");

  await page.reload({ waitUntil: "networkidle" });
  const stillRejected = page
    .locator("section.src-sec", { hasText: "Rejected" })
    .locator("tr.lead-tr", { hasText: sourceUrl });
  await stillRejected.waitFor({ timeout: 30_000 });
  step("the rejected state survives a reload too");

  await stillRejected.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("heading", { name: "On watch", exact: true }).waitFor({ timeout: 30_000 });
  await rowFor(sourceUrl).waitFor({ timeout: 30_000 });
  step("Accept moves the source back onto the watch list");

  await page.reload({ waitUntil: "networkidle" });
  await rowFor(sourceUrl).waitFor({ timeout: 30_000 });
  step("the restored on-watch state survives a reload");
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

  console.log(`sources desk: ${base}`);
  await ownTheDesk();
  await theScreenRenders();
  await addingASourcePersists();
  await droppingThenRestoringUpdatesTheList();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
