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
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

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
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/**
 * The row for a given source URL, wherever it currently sits (On watch/
 * Suggested/Rejected). The middle tab was renamed in 0.6.70 and the last tab
 * again in the redesign (Redesign p2c).
 *
 * The row markup moved with the redesign too: On watch is drawn as
 * `div.astra-row.src` rows now, while Suggested and Rejected are still the
 * `tr.lead-tr` table, so the lookup names both. It is matched by the row's own
 * link rather than by its text, because the drawn row prints the URL's host
 * ("example-town-council.test") where the table printed the whole URL.
 */
function rowFor(url) {
  return page
    .locator("tr.lead-tr, .astra-row.src")
    .filter({ has: page.locator(`a[href="${url}"]`) });
}

/**
 * Switch the list to one group and wait for THAT group's page, not the last
 * one's.
 *
 * The list keeps the tab that was on screen while the next tab's page loads
 * (`placeholderData: keepPreviousData`, CZ-long-lists part 1d), and only one
 * group is drawn at a time -- so an instant after the press the PREVIOUS tab's
 * rows are on screen under the NEW tab's heading; clicking "Rejected" shows the
 * On-watch row for a moment. A row assertion made then passes against a row
 * that is not in that group at all, which is exactly how this walk used to
 * report a Remove that never happened.
 *
 * The group's own count is the thing that only arrives with the new page, so
 * the count the press is expected to produce is what this waits for.
 */
async function openGroup(label, count) {
  await page.getByRole("button", { name: new RegExp(`^${label} · `) }).click();
  await page
    .getByRole("button", { name: `${label} · ${count}`, exact: true })
    .waitFor({ timeout: 30_000 });
}

async function theScreenRenders() {
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { level: 1, name: "Sources & scan", exact: true })
    .waitFor({ timeout: 30_000 });
  step("the Sources page renders its own heading");

  // BJ3 item 3: the header's "+ Add a source" opens phase 4's
  // `AddSourcesDialog` -- one control and one dialog, which is what the drawing
  // draws. Its four tabs are the behaviors BJ2's temporary panel held; the walk
  // drives the first ("One link"), whose fields are Link / Name / What to watch
  // for and whose primary press is "Add & run first check".
  await page.getByRole("button", { name: "+ Add a source", exact: true }).click();
  await page
    .getByRole("heading", { name: "Add sources to watch", exact: true })
    .waitFor({ timeout: 30_000 });
  await page.getByLabel("Link", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Name", { exact: true }).waitFor({ timeout: 30_000 });
  await page
    .getByRole("button", { name: "Add & run first check", exact: true })
    .waitFor({ timeout: 30_000 });
  step("+ Add a source opens the dialog with Link, Name and its primary press");

  await page.getByText("Nothing on watch yet — add a URL above.").waitFor({ timeout: 30_000 });
  step("a fresh desk shows the on-watch zero state");
}

async function addingASourcePersists() {
  // The dialog is still open from the step above.
  await page.getByLabel("Link", { exact: true }).fill(sourceUrl);
  await page.getByLabel("Name", { exact: true }).fill(sourceTitle);
  await page.getByRole("button", { name: "Add & run first check", exact: true }).click();

  // The dialog reports what it did in its own sentence, and it says it twice:
  // once into the desk's always-mounted `#desk-announcer` live region, which is
  // sr-only, and once into this page's notice bar through `onDone`. A bare text
  // match resolves to both and fails strict mode, so the walk reads the notice
  // an editor can actually see. (`p.note` is the notice bar; the page's other
  // `p.note` elements carry different text and are filtered out here.)
  await page
    .locator("p.note")
    .filter({ hasText: /Added .+ to the watch list\. The desk checks it at the next daily scan\./ })
    .waitFor({ timeout: 30_000 });
  step("adding a source shows the dialog's own confirmation on the page");

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
  // The drawn active row keeps two buttons on its single line (BJ3 item 1), so
  // Remove sits one click deeper, under "More ▾" -- the same `row-more`
  // disclosure the other desks use. (A paused row draws Resume + Remove
  // directly; the table rows Suggested and Rejected use say "Drop".)
  await row.locator("details.row-more > summary").click();
  const remove = row.locator(".row-more-panel");

  /*
    FB7, item 1 took Remove off one press and gave it a confirm, so the first
    press only arms it. `Keep` is the arm's own way out and it is asserted
    here, because a confirm whose Cancel still removes the source would be a
    confirm in name only.
  */
  await remove.getByRole("button", { name: "Remove", exact: true }).click();
  await remove
    .getByRole("button", { name: "Yes, remove", exact: true })
    .waitFor({ timeout: 30_000 });
  await remove.getByRole("button", { name: "Keep", exact: true }).click();
  await remove.getByRole("button", { name: "Remove", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "On watch · 1", exact: true }).waitFor({ timeout: 30_000 });
  await rowFor(sourceUrl).waitFor({ timeout: 30_000 });
  step("Remove arms, Keep leaves the source where it was, and only the second press removes");

  await remove.getByRole("button", { name: "Remove", exact: true }).click();
  await remove.getByRole("button", { name: "Yes, remove", exact: true }).click();
  // FB7, item 1 also put the way back on the done toast, which is this press's
  // own undo and lasts as long as the toast does.
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor({ timeout: 30_000 });
  step("removing offers an Undo on the toast that says it removed");

  // Rejecting moves the row out of On watch and into Rejected.
  await openGroup("Rejected", 1);
  await page.getByRole("heading", { name: "Rejected", exact: true }).waitFor({ timeout: 30_000 });
  const rejectedSection = page.locator("section.src-sec", { hasText: "Rejected" });
  await rejectedSection
    .locator("tr.lead-tr, .astra-row.src", { hasText: sourceUrl })
    .waitFor({ timeout: 30_000 });
  step("Remove takes the source off On watch and files it under Rejected");

  await page.reload({ waitUntil: "networkidle" });
  await openGroup("Rejected", 1);
  const stillRejected = page
    .locator("section.src-sec", { hasText: "Rejected" })
    .locator("tr.lead-tr, .astra-row.src", { hasText: sourceUrl });
  await stillRejected.waitFor({ timeout: 30_000 });
  step("the rejected state survives a reload too");

  await stillRejected.getByRole("button", { name: "Accept" }).click();
  await openGroup("On watch", 1);
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
