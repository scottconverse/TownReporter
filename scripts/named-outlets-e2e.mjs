#!/usr/bin/env node
/**
 * The owner's named-outlet list, edited on Server (0.6.63, Unit W).
 *
 * The sections panel got this walk because a settings screen that half-applies
 * is the failure mode (scripts/sections-source-add-e2e.mjs). This one is the
 * same shape and a sharper stake: the list decides which published stories the
 * paper refuses to print while the reader is not shown the source, so taking an
 * outlet off it stops a check that is already running against stories that are
 * already on the paper.
 *
 * That is why the walk publishes a story the gate would have blocked first, by
 * overriding the outlet on the draft -- the desk's own override path, not a
 * database poke. Only then can the removal preview have a real story to name,
 * and the assertion is on the sentence the owner reads, with the headline and
 * the link beside it. A preview that agreed with itself but not with the gate
 * would pass a lighter walk and still be the bug this unit exists to prevent.
 *
 * Everything else is the three stored states staying distinct and visible: the
 * built-in list, a list of the owner's own, and "this paper checks no outlet
 * names" -- each read back after a reload, because a state that only exists in
 * React state is a state the next session will not see.
 *
 *   NAMED_OUTLETS_BASE_URL=http://127.0.0.1:3493 \
 *   node scripts/named-outlets-e2e.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { confirmSectionAndWaitForPublishable } from "./confirm-section-step.mjs";

/**
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 */
const PORT_NAMED_OUTLETS = 3493;

const base = checkedUrl(
  process.env.NAMED_OUTLETS_BASE_URL || `http://127.0.0.1:${PORT_NAMED_OUTLETS}`,
).replace(/\/$/, "");

const stamp = Date.now();
const email = `named-outlets-${stamp}@townreporter.test`;
const password = "named-outlets-e2e-pass";
/** A story that names an outlet and does not show the reader the source. */
const headline = `Water plant money is on the way ${stamp}`;
const why = "The state budget line posted this morning.";
const body =
  `Testerville set aside the water plant money in this year's budget, the Denver Post reported. ` +
  `The line item is in the packet on the city site.`;
const addedName = `Testerville Gazette ${stamp}`;
const addedDomain = "testervillegazette.test";

/**
 * Where the walk's screenshots go. Outside the repo, like every other artefact
 * this walk produces: a screenshot is not source.
 */
const outDir = checkedOutputPath(
  resolve(
    process.env.NAMED_OUTLETS_OUT_DIR || "../townreporter-deepseek-oversight/scratch/W",
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

const panel = () => page.locator('section[aria-label="Named outlets"]');
const bar = () => page.locator('[aria-label="Named outlet changes not saved"]');
/** One editable outlet row, by the name in its legend. */
const group = (name) => page.getByRole("group", { name: new RegExp(`^${name}`) });
/** The read-only list's rows, while the paper is on the built-in list. */
const builtInRows = () => panel().locator("li");
const queueLink = () => page.locator('a[href="/desk/queue"]:visible').first();

/** The review button inside the panel: the bar carries a second copy. */
const reviewButton = () =>
  panel().getByRole("button", { name: "Review changes", exact: true });
const applyButton = () =>
  panel().getByRole("button", { name: "Confirm and apply", exact: true });

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Named Outlets Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/**
 * A published story whose outlet credit the paper is checking right now.
 *
 * The gate refuses to print a draft that names an outlet its Sources do not
 * show, so this story only exists because an editor overrode the outlet for it
 * -- which is the desk's recorded decision and the only honest way to reach the
 * state the removal preview is about. Nothing here writes to the database.
 */
async function aStoryCreditingAnOutletIsOnThePaper() {
  await queueLink().click();
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Why now").fill(why);
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 45_000 });

  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Dek").fill(why);
  await page.getByLabel("Body").fill(body);
  // The section still has to be confirmed -- the override records against a
  // saved draft -- but the Publish button is down on purpose from here.
  await confirmSectionAndWaitForPublishable(page, { publishable: false });
  step("the draft is written and its section is confirmed");

  // The gate holds the button down and says why. The sentence is the desk's,
  // not this walk's: it is the same report the server refuses on.
  const outlets = page.locator("#story-outlets");
  await outlets.getByText(/The body names Denver Post and the Sources do not show it/).waitFor({
    timeout: 45_000,
  });
  const print = page.getByRole("button", { name: "Publish to the paper" });
  assert.equal(await print.isDisabled(), true, "the gate must hold printing down");
  await page.getByText("Deal with the named outlet first").waitFor();
  step("printing is held down, in words, while Denver Post is named and uncovered");

  await outlets.getByRole("button", { name: "Override Denver Post" }).click();
  await outlets.getByText(/Overrides recorded for this draft/).waitFor({ timeout: 45_000 });
  await print.waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Publish to the paper" && !button.disabled,
      ),
    null,
    { timeout: 45_000 },
  );
  step("the override is recorded and printing opens again");

  await print.click();
  await page.getByRole("button", { name: "Yes, print it" }).click();
  await page.getByText("On the paper").waitFor({ timeout: 45_000 });
  step(`"${headline}" is on the paper, crediting Denver Post`);
}

async function openOutlets() {
  await page.goto(`${base}/desk/ops#outlets`, { waitUntil: "networkidle" });
  await panel().getByRole("heading", { name: "Named outlets" }).waitFor({ timeout: 45_000 });
}

/** The count the label claims, checked against the rows it is claiming it for. */
async function builtInState() {
  await openOutlets();
  const label = panel().getByText(/Using the built-in list \(\d+ outlets?\)/);
  await label.waitFor({ timeout: 45_000 });
  const text = await label.innerText();
  const count = Number(/\((\d+) outlets?\)/.exec(text)?.[1]);
  assert.ok(count > 0, `the built-in label must name a count (${text})`);
  assert.equal(
    await builtInRows().count(),
    count,
    "the built-in label's count must match the rows under it",
  );
  await panel().getByText("Denver Post", { exact: true }).waitFor();
  step(`with nothing stored the panel says "${text.split("\n")[0]}"`);

  // Nothing stored is a statement about the paper, not a form: the names are
  // read-only and the only move is Customize.
  assert.equal(await panel().locator("input").count(), 0, "the built-in list is not editable");
  await panel().getByRole("button", { name: "Customize" }).waitFor();
  assert.equal(await bar().count(), 0, "no draft, so no unsaved bar");
  await shot("built-in-1280");
  step("the built-in list is read-only and offers Customize");
}

async function customizeSeedsTheDraftFromTheShippedList() {
  const before = await builtInRows().count();
  await panel().getByRole("button", { name: "Customize" }).click();
  await page.getByLabel("Outlet name").first().waitFor({ timeout: 30_000 });
  assert.equal(
    await page.getByLabel("Outlet name").count(),
    before,
    "Customize must seed one row per shipped outlet",
  );
  assert.equal(
    await page.getByLabel("Outlet name").first().inputValue(),
    "Longmont Times-Call",
    "the first row must be the first shipped outlet",
  );
  await bar().getByText("You have unsaved outlet list changes").waitFor({ timeout: 30_000 });
  step("Customize seeds the draft from the shipped rows and raises the unsaved bar");
}

async function theProblemsAreVisibleWhileTyping() {
  const first = page.getByLabel("Outlet name").first();
  await first.fill("");
  await panel().getByText("Give this outlet a name.").waitFor({ timeout: 15_000 });
  assert.equal(
    await reviewButton().isDisabled(),
    true,
    "a list with an unnamed outlet must not be reviewable",
  );
  await first.fill("Longmont Times-Call");
  await panel().getByText("Give this outlet a name.").waitFor({ state: "detached", timeout: 15_000 });
  assert.equal(await reviewButton().isDisabled(), false, "fixing the name must clear the refusal");
  step("an empty name is refused in the row, and the refusal clears");

  /*
    The fold the gate matches with is the fold that judges duplicates, so a
    name and an alias that differ only in case or hyphens are one claim. Row
    order decides which row is refused -- the first row that spells it keeps it
    (named-outlet-rules.ts) -- so typing "DENVER POST" into the first row puts
    the refusal in the Denver Post row further down, which is the row the owner
    would have to change.
  */
  await first.fill("DENVER POST");
  // Twice in that row, and both are true: the row's name collides with the
  // first row's, and its "Denver Post" alias collides with the same claim. One
  // message per field, each beside the field it is about.
  const duplicate = group("Denver Post").getByText(
    /Another outlet already uses "Denver Post"\. Remove it here, or change the other outlet\./,
  );
  await duplicate.first().waitFor({ timeout: 15_000 });
  assert.equal(await duplicate.count() >= 1, true);
  assert.equal(
    await reviewButton().isDisabled(),
    true,
    "a list with two rows the fold cannot tell apart must not be reviewable",
  );
  await first.fill("Longmont Times-Call");
  await panel().getByText(/Another outlet already uses/).first().waitFor({
    state: "detached",
    timeout: 15_000,
  });
  step("a duplicate of a listed name is refused, case-aware");

  const domain = page.getByLabel("Domain").first();
  await domain.fill("https://www.example.test/news");
  await panel().getByText(/Write the domain alone, without https:\/\/ or a path/).waitFor({
    timeout: 15_000,
  });
  await domain.fill("timescall.com");
  await panel()
    .getByText(/Write the domain alone, without https:\/\/ or a path/)
    .waitFor({ state: "detached", timeout: 15_000 });
  step("a domain that is really a URL is refused in the row, and the refusal clears");
}

/**
 * The sentence this unit exists for.
 *
 * The published story names Denver Post and shows the reader nothing, so the
 * paper is checking that credit today. Removing the outlet stops the check, and
 * the owner has to read which stories that costs before they press apply --
 * headline and link, from the gate's own matcher.
 */
async function removingAnOutletNamesTheStoriesItCosts() {
  await group("Denver Post")
    .getByRole("button", { name: /^Remove outlet/ })
    .click();
  await group("Denver Post").waitFor({ state: "detached", timeout: 15_000 });
  await reviewButton().click();

  await panel()
    .getByText("1 published story credits Denver Post. After this change the paper will no longer check that credit.")
    .waitFor({ timeout: 45_000 });
  const link = panel().getByRole("link", { name: headline });
  await link.waitFor({ timeout: 15_000 });
  assert.match(
    await link.getAttribute("href"),
    /^\/articles\/water-plant-money/,
    "the preview must link the story it is talking about",
  );
  // The bar carries the same two steps, and it moves to apply once the
  // preview is on screen -- so a reader who scrolled past the panel can still
  // finish from the bottom of the page.
  await bar()
    .getByRole("button", { name: "Confirm and apply, from the unsaved changes bar" })
    .waitFor();
  await shot("impact-1280");
  step("removing Denver Post names the one published story that credit costs");

  await applyButton().click();
  await panel().getByText(/Outlets saved\. The paper now checks this list\./).waitFor({
    timeout: 45_000,
  });
  assert.equal(await bar().count(), 0, "the bar must go when the list is saved");
  step("Confirm and apply saves the list and clears the bar");

  await page.reload({ waitUntil: "networkidle" });
  const label = panel().getByText(/This paper checks \d+ outlets?/);
  await label.waitFor({ timeout: 45_000 });
  assert.match(await label.innerText(), /This paper checks 6 outlets/);
  await panel().getByText("Denver Post", { exact: true }).waitFor({ state: "detached" });
  step("after a reload the paper checks 6 outlets and Denver Post is gone");
}

async function addingAnOutletIsSavedToo() {
  await openOutlets();
  await panel().getByRole("button", { name: "Add outlet" }).click();
  const rows = page.getByRole("group", { name: /^New outlet/ });
  await rows.last().waitFor({ timeout: 15_000 });
  await page.getByLabel("Outlet name").last().fill(addedName);
  await page.getByLabel("Aliases").last().fill("the Gazette");
  await page.getByLabel("Domain").last().fill(addedDomain);
  await reviewButton().click();

  const added = panel().locator("section", { hasText: `${addedName} · added` });
  await added.waitFor({ timeout: 45_000 });
  await panel().getByText("No published story credits a name this change stops checking.").waitFor();
  await applyButton().click();
  await panel().getByText(/Outlets saved\. The paper now checks this list\./).waitFor({
    timeout: 45_000,
  });
  step("a new outlet reviews as added, with no story impact, and applies");

  await page.reload({ waitUntil: "networkidle" });
  await panel().getByText(/This paper checks 7 outlets/).waitFor({ timeout: 45_000 });
  await panel().getByText(addedName).first().waitFor();
  step("after a reload the paper checks the owner's 7 outlets, the new one among them");
}

/** The third state: a decision, said plainly, with the warning beside it. */
async function checkingNothingIsSaidAndWarns() {
  await openOutlets();
  await panel().getByRole("button", { name: "Check no outlet names" }).click();
  await reviewButton().click();
  await panel()
    .getByText("No published story credits a name this change stops checking.")
    .waitFor({ timeout: 45_000 });
  await applyButton().click();
  await panel().getByText(/Outlets saved\. The paper now checks this list\./).waitFor({
    timeout: 45_000,
  });

  await page.reload({ waitUntil: "networkidle" });
  await panel().getByText("This paper checks no outlet names").waitFor({ timeout: 45_000 });
  await panel()
    .getByText(/Printing no longer stops when a story names another newsroom's work/)
    .waitFor();
  await shot("none-375");
  step("an empty list reads as a decision about the paper, with the warning beside it");

  // And back: the built-in list is one click away, and the reload proves it.
  await panel().getByRole("button", { name: "Use the built-in list" }).click();
  await reviewButton().click();
  await applyButton().click();
  await panel().getByText(/Outlets saved\. The paper now checks this list\./).waitFor({
    timeout: 45_000,
  });
  await page.reload({ waitUntil: "networkidle" });
  await panel().getByText(/Using the built-in list \(\d+ outlets?\)/).waitFor({ timeout: 45_000 });
  step("Use the built-in list restores it, read back after a reload");
}

/**
 * The same guard the Sections panel uses, driven through this panel's words.
 *
 * It is one component (unsaved-changes-guard.tsx), so what this proves is that
 * the Named outlets panel really renders it with its own labels -- a copy would
 * pass a check of the component and still leave this screen's draft unguarded.
 */
async function theDraftIsGuardedOnTheWayOut() {
  const clean = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(clean, false, "nothing to lose, so no unload prompt");

  await panel().getByRole("button", { name: "Customize" }).click();
  await page.getByLabel("Outlet name").first().waitFor({ timeout: 30_000 });
  await page.getByLabel("Outlet name").first().fill("Longmont Times Call");
  await bar().getByText("You have unsaved outlet list changes").waitFor({ timeout: 30_000 });

  const dirty = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(dirty, true, "an unsaved outlet draft must ask before the page unloads");
  step("closing the tab with a draft asks; with no draft it does not");

  await queueLink().click();
  const dialog = page.getByRole("alertdialog", { name: "Leave with unsaved outlet changes?" });
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /\/desk\/ops/, "Stay must leave the draft alone");
  step("navigating away with a draft asks, and Stay keeps the page and the draft");

  await bar().getByRole("button", { name: /Cancel changes/ }).click();
  await panel().getByText(/Unapplied changes discarded/).waitFor({ timeout: 15_000 });
  assert.equal(await bar().count(), 0, "the bar must go when the draft is discarded");
  step("Cancel changes drops the draft and removes the bar");
}

/** 375px: the impact sentence and its links have to fit, and stay legible. */
async function thePanelWorksAtPhoneWidth() {
  await page.setViewportSize({ width: 375, height: 780 });
  await openOutlets();
  await panel().getByRole("button", { name: "Customize" }).click();
  await page.getByLabel("Outlet name").first().waitFor({ timeout: 30_000 });
  await group("Denver Post")
    .getByRole("button", { name: /^Remove outlet/ })
    .click();
  await reviewButton().click();
  await panel()
    .getByText(/1 published story credits Denver Post\./)
    .waitFor({ timeout: 45_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `the page must not scroll sideways at 375px (overflow ${overflow}px)`);

  const sizes = await page.evaluate(() => {
    const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const panelEl = document.querySelector('section[aria-label="Named outlets"]');
    const impact = [...panelEl.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("published story credits"),
    );
    return {
      impact: size(impact),
      label: size(panelEl.querySelector("label")),
      heading: size(panelEl.querySelector("h3")),
    };
  });
  assert.ok(sizes.impact >= 14, `the impact sentence is ${sizes.impact}px, under 14px`);
  assert.ok(sizes.label >= 14, `a field label is ${sizes.label}px, under 14px`);
  assert.ok(sizes.heading >= 14, `the panel heading is ${sizes.heading}px, under 14px`);
  await shot("impact-375");
  step(
    `at 375 the impact sentence, a label and the heading all stay at 14px or more ` +
      `(${sizes.impact}/${sizes.label}/${sizes.heading})`,
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await bar().getByRole("button", { name: /Cancel changes/ }).click();
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

  console.log(`named outlets: ${base}`);
  await ownTheDesk();
  await aStoryCreditingAnOutletIsOnThePaper();
  await builtInState();
  await customizeSeedsTheDraftFromTheShippedList();
  await theProblemsAreVisibleWhileTyping();
  await removingAnOutletNamesTheStoriesItCosts();
  await addingAnOutletIsSavedToo();
  await checkingNothingIsSaidAndWarns();
  await theDraftIsGuardedOnTheWayOut();
  await thePanelWorksAtPhoneWidth();

  await browser.close();
  if (consoleErrors.length) {
    console.error(JSON.stringify({ ok: false, consoleErrors, completed: done }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, headline, completed: done, outDir, shots }, null, 2));
}

main().catch(dump);
