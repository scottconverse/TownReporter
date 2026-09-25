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
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
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

/**
 * Where the two geometry steps put their evidence images. Outside the repo,
 * like every other artefact this walk produces: a screenshot is not source.
 */
const outDir = checkedOutputPath(
  resolve(
    process.env.SECTIONS_SOURCE_ADD_OUT_DIR ||
      "../townreporter-deepseek-oversight/scratch/S2",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

let page;
const done = [];
const shots = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function shot(name, target) {
  const file = resolve(outDir, `${name}.png`);
  await (target ?? page).screenshot({ path: file, animations: "disabled" });
  shots.push(file);
  console.log(`  shot  ${file}`);
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
  // The label is deliberately left blank on this re-add. The field is labelled
  // optional, and it used to be the quiet way to lose a source's name: the
  // shared add path substituted the URL's host for the empty label, so
  // "City Council packets <stamp>" came back as "www.example-city-council.test"
  // because the editor declined to type a label they were told they need not
  // type. The URL is already on watch, so the blank label has to leave the
  // row's title exactly as it found it.
  await business.getByLabel("Label (optional)").fill("");
  await business.getByRole("button", { name: "Add and tick for this section" }).click();
  // The message must not claim a new source for a URL that was already on
  // watch, and it names the row by the title the row still has.
  await business
    .getByText(`Already on watch — ticked for Business: ${sourceTitle}`)
    .waitFor({ timeout: 45_000 });
  step("re-adding with the label left blank ticks the row and keeps its name");

  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  const rows = page.locator("tr.lead-tr", { hasText: sourceUrl });
  await rows.first().waitFor({ timeout: 45_000 });
  assert.equal(await rows.count(), 1, "a duplicate URL must not create a second source row");
  const name = await rows.first().locator(".src-t").innerText();
  assert.equal(name, sourceTitle, `a blank label renamed the row to "${name}"`);
  step(`the watch list holds one row for that URL, still named "${name}"`);
}

async function theBarReviewsAndApplies() {
  await openSections();
  const business = group("Business");
  await business.getByLabel("New source URL").fill(sourceUrl);
  // A label IS typed here, and that is on purpose: a label that was given still
  // renames the row -- that is today's Sources-page behaviour and this unit
  // must not change it. The blank-label case is the step above; this one keeps
  // the two branches apart.
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

/** The bar, its column and the nav beside it, in viewport pixels. */
async function barGeometry(width) {
  await page.setViewportSize({ width, height: width === 375 ? 780 : 900 });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const barEl = document.querySelector('[aria-label="Section changes not saved"]');
    if (!barEl) return { missing: true };
    const sidebar = document.querySelector(".astra-sidebar");
    const msg = barEl.querySelector('p[role="status"]');
    const range = document.createRange();
    range.setStart(msg.firstChild, 0);
    range.setEnd(msg.firstChild, 1);
    const ch = range.getBoundingClientRect();
    const hit = document.elementFromPoint(ch.left + 1, ch.top + ch.height / 2);
    const b = barEl.getBoundingClientRect();
    const s = sidebar.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      insideAstra: Boolean(barEl.closest(".desk-ltr.astra")),
      bar: { left: Math.round(b.left), right: Math.round(b.right) },
      sidebar: {
        right: Math.round(s.right),
        position: getComputedStyle(sidebar).position,
        offCanvas: getComputedStyle(sidebar).left === "-255px",
      },
      firstChar: { left: Math.round(ch.left), text: (msg.textContent || "").slice(0, 8) },
      hitIsMessage: hit === msg || Boolean(hit && msg.contains(hit)),
      hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || "").split(" ")[0]}` : null,
    };
  });
}

/**
 * The bar belongs to the content column, not to the viewport.
 *
 * It used to be `fixed inset-x-0` -- pinned to both viewport edges -- while its
 * message sat in an `mx-auto max-w-4xl` column of its own. The desk's nav is
 * drawn at the left of the viewport at a higher z-index, so at 1280 the bar's
 * own left edge and the first characters of its message were behind the nav:
 * the bar read "…ave unsaved section changes" and "Review changes" was partly
 * unreachable. Measured at three widths because the column it has to follow is
 * three different things -- 232px above 1200, 206px at 1000, and off-canvas at
 * 375, where there is no nav to sit beside and the bar takes the whole width.
 */
async function theBarStaysInsideTheContentColumn() {
  const wide = await barGeometry(1280);
  console.log(`  meas  1280 ${JSON.stringify(wide)}`);
  assert.equal(wide.missing, undefined, "no unsaved bar to measure at 1280");
  assert.equal(wide.insideAstra, true, "the bar must live inside the desk shell whose width it follows");
  assert.equal(wide.sidebar.position, "sticky", `at 1280 the nav is beside the content (${wide.sidebar.position})`);
  assert.ok(
    wide.bar.left >= wide.sidebar.right,
    `at 1280 the bar starts at ${wide.bar.left}px, behind a nav ending at ${wide.sidebar.right}px`,
  );
  assert.equal(
    wide.hitIsMessage,
    true,
    `the message's first character at ${wide.firstChar.left}px is covered by <${wide.hit}> at 1280`,
  );
  step(`at 1280 the bar starts at ${wide.bar.left}px, right of the nav's ${wide.sidebar.right}px edge`);

  const mid = await barGeometry(1000);
  console.log(`  meas  1000 ${JSON.stringify(mid)}`);
  assert.equal(mid.sidebar.position, "sticky", `at 1000 the nav is still beside the content (${mid.sidebar.position})`);
  assert.ok(
    mid.bar.left >= mid.sidebar.right,
    `at 1000 the bar starts at ${mid.bar.left}px, behind a nav ending at ${mid.sidebar.right}px`,
  );
  assert.equal(mid.hitIsMessage, true, `the message is covered by <${mid.hit}> at 1000`);
  step(`at 1000 the narrower nav (${mid.sidebar.right}px) still clears the bar at ${mid.bar.left}px`);

  const phone = await barGeometry(375);
  console.log(`  meas  375 ${JSON.stringify(phone)}`);
  assert.equal(phone.sidebar.offCanvas, true, "at 375 the nav is off-canvas, not beside the content");
  assert.ok(
    phone.bar.left <= 1 && phone.bar.right >= phone.viewportWidth - 1,
    `at 375 the bar must span the width (${phone.bar.left}..${phone.bar.right} of ${phone.viewportWidth})`,
  );
  assert.equal(phone.hitIsMessage, true, `the message is covered by <${phone.hit}> at 375`);
  step(`at 375 the bar spans the whole width (${phone.bar.left}..${phone.bar.right})`);

  await page.setViewportSize({ width: 1280, height: 900 });
}

/**
 * The desk's pinned chrome is in the picture, so measure where it really is.
 *
 * The portrait shot of the Business fieldset (297x1168) showed "Public news
 * page", the search box, the theme toggle and "Skip to desk" drawn across the
 * middle of the fieldset. Both are pinned to the viewport: the desk header is
 * `position: sticky; top: 0` and the skip link is `position: fixed; top: -100px`
 * until it takes focus. A capture that has to reach past the viewport to
 * assemble a tall image paints them at their viewport offsets for whatever
 * scroll position it was on, which lands them mid-image. The 1280 shot of the
 * same element in the same state is clean, and the only difference is that at
 * 1280 the fieldset fits the viewport and no reach-past is needed.
 *
 * So this measures the live page instead of the capture: with the fieldset in
 * view and nothing focused, the header is at the viewport's top edge, the skip
 * link is off-screen, and a hit test inside the fieldset returns the fieldset.
 * It writes both a viewport shot and the element shot it is disproving.
 */
async function theDeskChromeDoesNotCoverTheSection() {
  // Run while Business is still empty, because that is the state the artefact
  // was photographed in: the open source list and the add box make the fieldset
  // 1168px tall against a 780px viewport, which is what forces the capture to
  // reach past the screen in the first place.
  await page.setViewportSize({ width: 375, height: 780 });
  const business = group("Business");
  await business.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(250);
  await shot("chrome-375-viewport");

  const probe = await page.evaluate(() => {
    const topbar = document.querySelector(".astra-topbar");
    const skip = document.querySelector(".astra-skip");
    // The panel holds one fieldset per section, so the Business one has to be
    // picked by its legend -- the first fieldset on the page is Council.
    const field = [
      ...document.querySelectorAll('section[aria-label="Newspaper sections"] fieldset'),
    ].find((f) => (f.querySelector("legend")?.textContent || "").trim().startsWith("Business"));
    const t = topbar?.getBoundingClientRect();
    const k = skip?.getBoundingClientRect();
    const f = field?.getBoundingClientRect();
    const y = f ? (Math.max(f.top, 0) + Math.min(f.bottom, window.innerHeight)) / 2 : 0;
    const hit = f ? document.elementFromPoint(f.left + f.width / 2, y) : null;
    const round = (n) => Math.round(n);
    return {
      focused: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
      topbar: t ? { top: round(t.top), bottom: round(t.bottom) } : null,
      skip: k ? { top: round(k.top), bottom: round(k.bottom) } : null,
      field: f ? { top: round(f.top), bottom: round(f.bottom), height: round(f.height) } : null,
      midIsInsideField: Boolean(hit && field.contains(hit)),
      mid: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || "").split(" ")[0]}` : null,
    };
  });
  console.log(`  meas  chrome375 ${JSON.stringify(probe)}`);

  assert.equal(probe.focused, "body", `a screenshot run focuses nothing (activeElement ${probe.focused})`);
  assert.ok(
    probe.skip && probe.skip.bottom <= 0,
    `the skip link is off-screen until focused (${JSON.stringify(probe.skip)})`,
  );
  assert.ok(
    probe.topbar && Math.abs(probe.topbar.top) <= 1,
    `the desk header is pinned to the viewport's top edge (${JSON.stringify(probe.topbar)})`,
  );
  assert.equal(
    probe.midIsInsideField,
    true,
    `something is painted over the middle of the fieldset (hit ${probe.mid})`,
  );
  step("with nothing focused the header is at the top edge, the skip link off-screen");

  // The same capture the portrait screenshot made, taken here to keep the
  // disproved artefact beside the measurement that disproves it.
  await shot("chrome-375-element", business);
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
  await theDeskChromeDoesNotCoverTheSection();
  await addingFromInsideTheSectionTicksItButDoesNotSaveIt();
  await aDuplicateUrlIsTickedRatherThanDuplicated();
  await theBarReviewsAndApplies();
  await theBarCanCancel();
  await beforeUnloadIsGuardedOnlyWhileDirty();
  await leavingInAppIsBlocked();
  await theSourcesPageCanAssignWithoutASecondTrip();
  await keyboardAndPhoneWidth();
  await theBarStaysInsideTheContentColumn();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, completed: done, outDir, shots }, null, 2));
}

main().catch(dump);
