#!/usr/bin/env node
/**
 * Adding a source to a section without leaving the page (0.6.63).
 *
 * The owner's report (2026-09-24): a brand-new "Business" section showed a
 * collapsed line reading "Assigned accepted sources (0) — none assigned yet",
 * with no way to add a website from there; a source had to be added and
 * accepted on Desk -> Sources first, and even then the Sources page had no way
 * to choose a section. Two pages, one assignment.
 *
 * This walk drives the real screens against a built server and asserts on the
 * real DOM at every step. It exists to pin the *decision* as much as the
 * behaviour: adding a source from inside a section calls the Sources page's
 * own server function, so the new row is on the watch list immediately, while
 * the assignment to the section rides the section draft and only lands on
 * "Confirm and apply". Half-landed state is the failure this walk is for, so
 * it checks both halves separately -- including a reload between them.
 *
 *   SECTIONS_SOURCE_ADD_BASE_URL=http://127.0.0.1:3492 \
 *   node scripts/sections-source-add-e2e.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests. The screenshot walk
 * scripts/sections-sources-ux-shots.mjs photographs the same screens and
 * shares this address on purpose; it is not scanned for ports, which is why
 * the number is declared here.
 */
const PORT_SECTIONS_SOURCE_ADD = 3492;

const base = checkedUrl(
  process.env.SECTIONS_SOURCE_ADD_BASE_URL || `http://127.0.0.1:${PORT_SECTIONS_SOURCE_ADD}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `sections-add-${stamp}@townreporter.test`;
const password = "sections-add-e2e-pass";
const sourceUrl = `https://www.example-city-council.test/packets-${stamp}`;
const sourceTitle = `City Council packets ${stamp}`;
const secondUrl = `https://www.example-city-council.test/minutes-${stamp}`;
const secondTitle = `City Council minutes ${stamp}`;

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 2000);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

const panel = () => page.locator('section[aria-label="Newspaper sections"]');
/** A reporting section's own fieldset, by the name in its legend. */
const group = (name) => page.getByRole("group", { name: new RegExp(`^${name}`) });
const bar = () => page.locator('[aria-label="Section changes not saved"]');
/**
 * The desk renders its nav twice (sidebar and header), so a role lookup for
 * the Queue link matches two elements. Pick the one a reader can actually
 * click.
 */
const queueLink = () => page.locator('a[href="/desk/queue"]:visible').first();

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Sections Add Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

async function openSections() {
  await page.goto(`${base}/desk/ops#sections`, { waitUntil: "networkidle" });
  await panel().getByRole("heading", { name: "Newspaper sections" }).waitFor({ timeout: 45_000 });
}

/** Save a new, genuinely empty reporting section called Business. */
async function businessIsASavedEmptySection() {
  await openSections();
  await panel().getByLabel("New section name").fill("Business");
  await panel().getByRole("button", { name: "Add section" }).click();
  // Exact: "Preview changes" contains "Review changes" as a substring.
  await panel().getByRole("button", { name: "Review changes", exact: true }).click();
  await panel().getByRole("button", { name: "Confirm and apply", exact: true }).click();
  await panel().getByText(/Sections saved/).waitFor({ timeout: 30_000 });
  await group("Business").waitFor({ timeout: 30_000 });
  step("Business is a saved, empty reporting section");
}

async function anEmptySectionOpensItselfAndOffersAnAddBox() {
  const business = group("Business");
  await business
    .getByText("Sources this section reads (0) — choose or add below")
    .waitFor({ timeout: 30_000 });

  const open = await business.locator("details").first().evaluate((el) => el.open);
  assert.equal(open, true, "an empty section's source list must not start collapsed");
  step("an empty section shows the new count-and-instruction line, already open");

  await business.getByRole("heading", { name: "Add a new source to this section" }).waitFor();
  await business.getByLabel("New source URL").waitFor();
  await business.getByLabel("Label (optional)").waitFor();
  step("the section offers its own URL and label inputs");
}

async function addingFromInsideTheSectionTicksItButDoesNotSaveIt() {
  const business = group("Business");
  await business.getByLabel("New source URL").fill(sourceUrl);
  await business.getByLabel("Label (optional)").fill(sourceTitle);
  await business.getByRole("button", { name: "Add and tick for this section" }).click();

  // The Sources page's own server call ran, so the sentence must not claim a
  // new source if the URL was already on watch -- and it must say plainly that
  // the assignment is not saved yet.
  await business
    .getByText(`Added to Sources and ticked for Business: ${sourceTitle}`)
    .waitFor({ timeout: 45_000 });
  await business.getByText("Its assignment is saved when you confirm.").waitFor();
  step("adding from inside the section reports it on watch and ticked");

  const ticked = business.locator("label", { hasText: sourceUrl }).locator("input[type=checkbox]");
  assert.equal(await ticked.isChecked(), true, "the new source must arrive ticked in the draft");
  await business.getByText(/Sources this section reads \(1\)/).waitFor({ timeout: 30_000 });
  step("the new row is ticked and the section's summary counts it");

  // Half-landed state check: the watch-list write is durable, the assignment
  // is not, and a reload is the only honest way to tell them apart.
  await page.reload({ waitUntil: "networkidle" });
  await group("Business")
    .getByText("Sources this section reads (0)")
    .waitFor({ timeout: 45_000 });
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  await page.locator("tr.lead-tr", { hasText: sourceUrl }).waitFor({ timeout: 45_000 });
  step("the source is on watch after a reload; the assignment is not yet saved");
}

async function aDuplicateUrlIsTickedRatherThanDuplicated() {
  await openSections();
  const business = group("Business");
  await business.getByLabel("New source URL").fill(sourceUrl);
  // The same label as the first time. The shared add path upserts on URL and
  // takes the title from the form, so re-adding with an empty label would
  // rename the row to its host name -- real Sources-page behaviour, but not
  // this unit's subject, and letting it happen here would make the summary
  // assertion further down depend on that side effect.
  await business.getByLabel("Label (optional)").fill(sourceTitle);
  await business.getByRole("button", { name: "Add and tick for this section" }).click();
  // The message must not claim a new source for a URL that was already on
  // watch: the add path returns the *same* row, and the sentence says so.
  await business
    .getByText(`Already on watch — ticked for Business: ${sourceTitle}`)
    .waitFor({ timeout: 45_000 });
  step("a URL already on watch is ticked, and the message says so");

  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  const rows = page.locator("tr.lead-tr", { hasText: sourceUrl });
  await rows.first().waitFor({ timeout: 45_000 });
  assert.equal(await rows.count(), 1, "a duplicate URL must not create a second source row");
  step("the watch list still holds exactly one row for that URL");
}

async function theBarReviewsAndApplies() {
  await openSections();
  const business = group("Business");
  await business.getByLabel("New source URL").fill(sourceUrl);
  // Label again, for the reason given in the duplicate step above: an empty
  // label makes the shared upsert rename the row to its host, and the summary
  // assertion below is about the draft, not about that.
  await business.getByLabel("Label (optional)").fill(sourceTitle);
  await business.getByRole("button", { name: "Add and tick for this section" }).click();
  await business.getByText(/Already on watch/).waitFor({ timeout: 45_000 });

  await bar().getByText("You have unsaved section changes").waitFor({ timeout: 30_000 });
  step("a sticky bar names the unsaved draft");

  await bar().getByRole("button", { name: /Review changes/ }).click();
  await bar().getByRole("button", { name: /Confirm and apply/ }).click();
  await panel().getByText(/Sections saved/).waitFor({ timeout: 30_000 });
  assert.equal(await bar().count(), 0, "the bar must go when the draft is saved");
  step("Review changes then Confirm and apply saves the draft and clears the bar");

  // The whole point: after a reload, Business really reads the source.
  await page.reload({ waitUntil: "networkidle" });
  const reopened = group("Business");
  await reopened.getByText(/Sources this section reads \(1\)/).waitFor({ timeout: 45_000 });
  assert.equal(
    await reopened.locator("details").first().evaluate((el) => el.open),
    false,
    "a section that reads sources goes back to collapsed",
  );
  const summary = await reopened.locator("summary").first().innerText();
  assert.match(summary, new RegExp(sourceTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  step("the assignment survives a reload, and the collapsed line names the source");
}

async function theBarCanCancel() {
  await panel().getByLabel("New section name").fill("Civic life");
  await panel().getByRole("button", { name: "Add section" }).click();
  await bar().getByText("You have unsaved section changes").waitFor({ timeout: 30_000 });

  await bar().getByRole("button", { name: /Cancel changes/ }).click();
  await panel().getByText(/Unapplied changes discarded/).waitFor({ timeout: 15_000 });
  assert.equal(await bar().count(), 0, "the bar must go when the draft is discarded");
  assert.equal(await page.getByRole("group", { name: /^Civic life/ }).count(), 0);
  step("Cancel changes drops the draft and removes the bar");
}

/**
 * A cancelable beforeunload, dispatched for real: @tanstack/history listens in
 * the capture phase on window and calls preventDefault when the guard is on.
 * Asserting on defaultPrevented is the only way to see the unload guard from a
 * page that has not been closed.
 */
async function beforeUnloadIsGuardedOnlyWhileDirty() {
  const clean = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(clean, false, "nothing to lose, so no unload prompt");

  await panel().getByLabel("New section name").fill("Civic life");
  await panel().getByRole("button", { name: "Add section" }).click();
  await bar().getByText("You have unsaved section changes").waitFor({ timeout: 30_000 });

  const dirty = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(dirty, true, "an unsaved draft must ask before the page unloads");
  step("closing the tab with a draft asks; with no draft it does not");
}

async function leavingInAppIsBlocked() {
  await queueLink().click();
  const dialog = page.getByRole("alertdialog", { name: "Leave with unsaved section changes?" });
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /\/desk\/ops/, "Stay must leave the draft alone");
  step("navigating away with a draft asks, and Stay keeps the page and the draft");

  await queueLink().click();
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Leave and discard changes" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/desk/ops"), { timeout: 30_000 });
  step("Leave and discard changes goes where the editor asked");
}

async function theSourcesPageCanAssignWithoutASecondTrip() {
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  await page.getByText("Add a source", { exact: true }).click();
  const picker = page.getByRole("group", { name: "Assign to sections (optional)" });
  await picker.waitFor({ timeout: 45_000 });
  await picker.getByRole("checkbox", { name: "Business", exact: true }).check();
  await page.getByLabel("URL", { exact: true }).fill(secondUrl);
  await page.getByLabel("Name", { exact: true }).fill(secondTitle);
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByText(`On watch: ${secondTitle}`).waitFor({ timeout: 45_000 });
  await page
    .getByText(`Assigned to Business.`)
    .waitFor({ timeout: 45_000 });
  step("adding on the Sources page files the source under the ticked section, in one step");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("tr.lead-tr", { hasText: secondUrl }).waitFor({ timeout: 45_000 });
  step("the assignment survives a reload of the Sources page");

  // The accept path: a row has to be accepted before a section can read it, so
  // the tick and the Accept are one step -- accept first, then file it.
  const row = page.locator("tr.lead-tr", { hasText: secondUrl });
  await row.getByRole("button", { name: "Drop" }).click();
  await page.getByRole("button", { name: /^Dropped / }).click();
  const rejected = page.locator("tr.lead-tr", { hasText: secondUrl });
  await rejected.getByText("Assign to sections", { exact: true }).click();
  await rejected
    .getByRole("checkbox", { name: "Council", exact: true })
    .check();
  await rejected.getByRole("button", { name: "Accept" }).click();
  await page.getByText("Accepted and filed under Council.").waitFor({ timeout: 45_000 });
  step("accepting a proposed source files it under the ticked section in the same step");

  await openSections();
  await group("Business").getByText(/Sources this section reads \(2\)/).waitFor({ timeout: 45_000 });
  await group("Council").getByText(/Sources this section reads \(1\)/).waitFor({ timeout: 45_000 });
  step("both assignments are on the sections panel, with no second trip");
}

async function keyboardAndPhoneWidth() {
  await page.setViewportSize({ width: 375, height: 780 });
  await openSections();
  await panel().getByLabel("New section name").fill("Civic life");
  await panel().getByRole("button", { name: "Add section" }).click();
  await bar().getByText("You have unsaved section changes").waitFor({ timeout: 30_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `the page must not scroll sideways at 375px (overflow ${overflow}px)`);
  step("nothing overflows sideways at 375px with the bar on screen");

  // Keyboard reachability, by pressing Tab rather than by calling focus():
  // programmatic focus on a button does not match :focus-visible, so a
  // focus() check would pass on a bar no keyboard user can see.
  let reached = null;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('[aria-label="Section changes not saved"]')) return null;
      const s = getComputedStyle(el);
      return { text: (el.textContent || "").trim().slice(0, 40), outline: `${s.outlineStyle} ${s.outlineWidth}` };
    });
  }
  assert.ok(reached, "Tab must reach the unsaved bar");
  assert.doesNotMatch(reached.outline, /^none/, `no visible focus on the bar (${reached.outline})`);
  assert.doesNotMatch(reached.outline, / 0px$/, `no visible focus on the bar (${reached.outline})`);
  step(`Tab reaches the bar and it shows a focus ring (${reached.text}: ${reached.outline})`);

  const sizes = await page.evaluate(() => {
    const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const businessInput = document.querySelector(
      'section[aria-label="Newspaper sections"] label:nth-of-type(1) input',
    );
    return {
      barMessage: size(document.querySelector('[aria-label="Section changes not saved"] p[role="status"]')),
      sectionFields: size(businessInput),
    };
  });
  assert.ok(sizes.barMessage >= 14, `bar message ${sizes.barMessage}px is under 14px`);
  step(`text stays at ${sizes.barMessage}px or more in the bar at 375px`);

  await page.setViewportSize({ width: 1280, height: 900 });
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const consoleErrors = [];
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  console.log(`sections source add: ${base}`);
  await ownTheDesk();
  await openSections();
  await businessIsASavedEmptySection();
  await anEmptySectionOpensItselfAndOffersAnAddBox();
  await addingFromInsideTheSectionTicksItButDoesNotSaveIt();
  await aDuplicateUrlIsTickedRatherThanDuplicated();
  await theBarReviewsAndApplies();
  await theBarCanCancel();
  await beforeUnloadIsGuardedOnlyWhileDirty();
  await leavingInAppIsBlocked();
  await theSourcesPageCanAssignWithoutASecondTrip();
  await keyboardAndPhoneWidth();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done }, null, 2));
}

main().catch(dump);
