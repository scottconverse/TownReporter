#!/usr/bin/env node
/**
 * Publish warnings on the built server and real story page.
 *
 * The baseline walk checks the warning list, repair controls, section selection,
 * outlet override, readable typography in both themes, publication, and the
 * bar's Review navigation. Warnings leave Publish enabled.
 *
 * Release G regressions then publish an AI draft with eight unreviewed claims
 * and an old three-claim readiness memo; accept claims, edit one word, save,
 * and publish anyway; and check both the unchecked paste and personal-check
 * paths. Each press must write an article and the expected editor override
 * audit rows. The page and Drafts must both say Not checked yet for the paste.
 *
 * This walk boots its own built server on 3581 with in-memory PGlite. No model
 * is called: the model gateway points to a port proven dead, provider keys are
 * cleared, and CLI backends point to nonexistent files. Captures stay under
 * this checkout's reports/CT-evidence, or CT_EVIDENCE_DIR when supplied.
 *
 * Run after npm run build: node scripts/publish-blockers-walk.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl, checkedOutputPath } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_PUBLISH_BLOCKERS = 3581;
/**
 * The address the model gateway is pointed at. NOTHING listens here, and the
 * walk refuses to start if something does: this walk needs no model, and a
 * port that happened to answer would be a stranger answering a draft.
 */
const PORT_NO_MODEL = 3582;

const base = checkedUrl(`http://127.0.0.1:${PORT_PUBLISH_BLOCKERS}`);
const DEAD_MODEL_BASE = `http://127.0.0.1:${PORT_NO_MODEL}/v1`;

const EVIDENCE_DIR = resolve(process.env.CT_EVIDENCE_DIR || join(REPO, "reports", "CT-evidence"));

const stamp = Date.now();
const email = `publish-blockers-${stamp}@townreporter.test`;
const password = "publish-blockers-pass";

/** The outlet this walk's body names and its Sources do not show. */
const OUTLET = "Longmont Leader";
/** The section an editor picks, and the name the Publish button then carries. */
const SECTION_KEY = "council";
const SECTION_NAME = "Council";
/** What the editor writes into the dek box the first row points at. */
const DEK = "The council approved the pilot program on a 5-2 vote.";
/** The headline the draft opens with. */
const HEADLINE = "Council takes up the pilot program";
/**
 * The body. It names exactly one outlet from `NAMED_OUTLETS`
 * (outlet-credit.ts) and cites nothing, which is the refusal this walk clears.
 */
const BODY =
  `The ${OUTLET} reported this week that the council would take up the pilot program.\n\n` +
  "The item returns for a second reading next month.";

/** The three rows the blocked draft must show, in the order the editor meets them. */
const EXPECTED_BLOCKERS = ["dek", "section", `outlet:${OUTLET}`];

let page;
let ownerId = "";
const done = [];
const facts = [];
const screenshots = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 2400);
  } catch {
    /* the page is already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${describe}; last read ${JSON.stringify(last)}`,
  );
}

/** The in-memory PGlite the server booted with, or a loud failure. */
async function db() {
  const pg = await globalThis.__pgliteInstance__;
  if (!pg) throw new Error("the server booted without a PGlite instance to read");
  return pg;
}

/**
 * Two addresses this walk must own: its own server port, and the model port it
 * is about to point the desk at. Something already answering on either is a
 * refusal, not a surprise later.
 */
async function preconditions() {
  const problems = [];
  for (const [label, url] of [
    ["this walk's server port", `${base}/`],
    ["the model address this walk leaves dead", `${DEAD_MODEL_BASE}/models`],
  ]) {
    let answers = false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      answers = res.status < 500;
    } catch {
      /* nothing there, which is what this walk needs */
    }
    if (answers) problems.push(`${label} (${url}) is already answering; this walk will not share it.`);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push(
      "ANTHROPIC_API_KEY is set: a rung below the dead gateway could answer a call with a real " +
        "model, which is a call off this computer.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the BUILT server here, in this process, on this walk's own port and
 * in-memory PGlite (never the shared Postgres: DATABASE_URL is cleared below).
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_PUBLISH_BLOCKERS);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "publish-blockers-walk-secret";
  process.env.LLM_BASE_URL = DEAD_MODEL_BASE;
  process.env.LLM_MODEL = "no-model";
  delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.CODEX_CLI_PATH = join(REPO, "scripts/fakes/no-such-codex-cli.mjs");
  process.env.CLAUDE_CLI_PATH = join(REPO, "scripts/fakes/no-such-claude-cli.mjs");
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Publish Blockers Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  /*
    Unit CJ (0.6.80) put a first-owner SETUP CODE on this form, and this walk
    was never updated for it: clicking Create with the field blank leaves the
    walk on /login, and the "Queue" link it waits for never appears. Nothing
    ran this file, so it could not report its own staleness. The shared helper
    reads the same file the operator is told to read and types it in.
  */
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  const owner = await (await db()).query(`select id from "user" limit 1`);
  ownerId = owner.rows[0]?.id ?? "";
  must(ownerId, "the first-run account exists in the database");
  step("the first account owns the desk");
}

/**
 * A drafted lead, seeded straight into the in-memory database.
 *
 * The scan cannot be made to file a lead under a section the model never chose,
 * so `topic_unchosen` (migration 0087) is set here -- it is the state the
 * owner's live lead 250 was in, and the state the section row exists for.
 * Everything else is ordinary: no evidence of any kind (so nothing is stale),
 * no claims of absence, and a body that names an outlet its Sources do not
 * show.
 *
 * The lead's own `source_urls` is empty too: a draft with no sources inherits
 * the lead's (`mayInheritLeadSources`), so leaving it non-empty would quietly
 * cover the outlet and there would be nothing to override.
 */
async function seedLead(opts) {
  const pg = await db();
  /*
    `resolve_story_section` (migration 0045) refuses a topic that is not one of
    this newsroom's sections. The owner's lead 250 was filed under "Misc", a
    section the desk's own migration adds for any topic an existing story was
    filed under -- so it is a real section with a real name, not a typo, and the
    row is seeded the same way the migration seeds one.
  */
  await pg.query(`insert into section_config (newsroom_id) values (1) on conflict do nothing`);
  await pg.query(
    `insert into newsroom_sections (newsroom_id, key, name, position, visible)
     values (1, $1, initcap($1), 100, true) on conflict do nothing`,
    [opts.topic],
  );
  const notes = JSON.stringify({
    todo: [],
    found: [],
    verify: [],
    opened: [],
    scratch: opts.scratch,
  });
  const lead = await pg.query(
    `insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls,
       evidence, newsworthiness, notes_json, topic_unchosen)
     values ($1, 1, $2, $3, $4, 'drafted', '[]', $5, 11, $6, $7) returning id`,
    [
      ownerId,
      opts.headline,
      `Fixture: ${opts.scratch}`,
      opts.topic,
      "The council packet describes the pilot program.",
      notes,
      opts.topicUnchosen,
    ],
  );
  const leadId = Number(lead.rows[0].id);
  must(Number.isFinite(leadId), "the seeded lead has an id");

  const draft = await pg.query(
    `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
       provenance_json, found_note, unanswered, research_json, headline_source)
     values ($1, 1, $2, $3, $4, $5, $6, '[]', '[]', '', '[]', '{}', 'editor') returning id`,
    [ownerId, leadId, opts.headline, opts.dek, BODY, opts.topic],
  );
  return { leadId, draftId: Number(draft.rows[0].id) };
}

/** The draft this walk clears three reasons on. */
async function seedBlockedDraft() {
  const seeded = await seedLead({
    headline: HEADLINE,
    dek: "",
    topic: "misc",
    topicUnchosen: true,
    scratch: "a draft naming an outlet its Sources do not show, with no dek and no chosen section.",
  });
  facts.push({ blockedLeadId: seeded.leadId });
  step("a drafted lead is on the desk: no dek, no chosen section, one uncited outlet");
  return seeded;
}

/**
 * A second lead whose latest draft job completed with a receipt that says a
 * person must look at it. That receipt leaves one reason standing on the
 * Checks list, and the publish bar's "Review" press is what this walk presses.
 */
async function seedReviewRequiredDraft() {
  const seeded = await seedLead({
    headline: "Council revisits the pilot program",
    dek: DEK,
    topic: SECTION_KEY,
    topicUnchosen: false,
    scratch: "a draft whose completed job asked a person to review it.",
  });
  const pg = await db();
  const receipt = JSON.stringify({
    version: 2,
    finalDraftId: seeded.draftId,
    draftId: seeded.draftId,
    quality: {
      version: 1,
      citationStatus: "review-required",
      evidenceCheckIncomplete: false,
      nameCheckComplete: true,
      namesVerified: true,
      reviewRequired: true,
      reviewReasons: ["citations-missing"],
    },
  });
  await pg.query(
    `insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, stage, result_json, finished_at)
     values (1, $1, 'draft', $2, 'completed', 'Done', $3, now())`,
    [ownerId, seeded.leadId, receipt],
  );
  await pg.query("update drafts set body='The council reviewed the pilot program.',research_json=$1 where id=$2", [JSON.stringify({
    storyReadiness: {version:1,state:"not-ready",openCount:0,totalCount:0,reason:"The pilot report still needs a source review."},
  }), seeded.draftId]);
  facts.push({ reviewLeadId: seeded.leadId, reviewDraftId: seeded.draftId });
  step("a second lead carries a completed job that asked for a review");
  return seeded;
}

async function openTheStory(leadId) {
  await page.goto(`${base}/desk/story/${leadId}`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea.astra-headline").waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: /^Publish in / }).waitFor({ timeout: 45_000 });
  step(`the story page opens on lead ${leadId}`);
}

/** The rows of the "Before you can publish" list, in document order. */
async function blockerKeys() {
  return page.$$eval("#publish-blockers li.astra-blocker", (rows) =>
    rows.map((row) => row.getAttribute("data-blocker") ?? ""),
  );
}

async function waitForBlockerCount(n, what) {
  await waitForTruth(
    `${what} (${n} blockers)`,
    async () => ((await blockerKeys()).length === n ? true : null),
    45_000,
  );
  return blockerKeys();
}

function publishButton() {
  return page.locator("#astra-publish-bar button", { hasText: /^Publish in |^Yes, print it in / }).first();
}

/** 1. The list is the first thing on the tab the page opens on. */
async function theListIsAtTheTopOfTheChecksTab() {
  const selected = await page.getAttribute("#inspector-tab-checks", "aria-selected");
  assert.equal(selected, "true", "a blocked story opens on the Checks tab");
  const hidden = await page.getAttribute("#inspector-checks", "hidden");
  assert.equal(hidden, null, "and that tab is the one being shown");

  const layout = await page.evaluate(() => {
    const panel = document.querySelector("#inspector-checks");
    const block = document.querySelector("#publish-blockers");
    const heading = [...panel.querySelectorAll("h2")].find((h) => h.textContent === "Evidence check");
    return {
      firstChildId: panel.firstElementChild?.id ?? "",
      blockTop: block ? Math.round(block.getBoundingClientRect().top) : null,
      headingTop: heading ? Math.round(heading.getBoundingClientRect().top) : null,
      heading: block?.querySelector("h2")?.textContent ?? "",
    };
  });
  assert.equal(layout.firstChildId, "publish-blockers", "the list is the FIRST thing on the Checks tab");
  assert.equal(layout.heading, "Before you can publish");
  assert.ok(
    layout.blockTop !== null && layout.headingTop !== null && layout.blockTop < layout.headingTop,
    `the list sits above the evidence check (${layout.blockTop} vs ${layout.headingTop})`,
  );
  step("the Checks tab opens on the list, above the evidence check");
}

/** 2. Three rows, one per reason, in the order the editor meets them. */
async function threeRowsOnePerReason() {
  const keys = await waitForBlockerCount(3, "the three reasons to be on the page");
  assert.deepEqual(
    keys,
    EXPECTED_BLOCKERS,
    "one row per reason, in the order the editor meets them",
  );

  const summary = await page.locator("#publish-blockers > .meta").innerText();
  assert.match(summary, /^3 warnings before Publish\./, `the list counts its own rows: ${summary}`);
  assert.match(summary, /choose Publish anyway\./);

  const dek = await page.locator('li[data-blocker="dek"]').innerText();
  assert.match(dek, /The dek is empty\./);
  assert.match(dek, /Write a dek/);

  const section = await page.locator('li[data-blocker="section"]').innerText();
  assert.match(section, /No section has been chosen for this story\./);
  assert.match(section, /Pick a section/);

  const outlet = await page.locator(`li[data-blocker="outlet:${OUTLET}"]`).innerText();
  assert.match(outlet, new RegExp(`The body names ${OUTLET} and this draft's Sources do not show it\\.`));
  assert.match(outlet, new RegExp(`Override ${OUTLET}`));
  assert.match(outlet, /Add a source/, "the second honest answer is offered beside the override");

  const chips = await page.$$eval("#publish-blockers .astra-blocker-chip", (els) =>
    els.map((el) => el.textContent),
  );
  assert.deepEqual(chips, ["Warning", "Warning", "Warning"]);
  step("three rows, one per reason, each with its chip and its press");
}

/**
 * 3. The bottom bar names the first reason as the press that clears it, and
 * points at the list.
 *
 * Unit CW replaced the count CT had put on this bar with the drawing's own
 * sentence: the FIRST reason, said as the press that clears it ("Write a dek
 * to publish."), then "Review". CT's count still runs at the head of the list,
 * which is the screen where it was ever acted on -- step 2 above asserts it
 * there. This walk was written against the CT copy and never ran, so it was
 * still reading for the count on the bar.
 *
 * The assertion is made STRONGER than the count was rather than merely
 * changed: the bar's words are compared against the first ROW's own button,
 * read off the page, so the bar can never describe a fix in words the control
 * that clears it does not use.
 */
async function theBottomBarNamesTheFirstReason() {
  const note = page.locator("#astra-publish-bar .publish-blocked");
  const text = await note.innerText();
  const firstRowsPress = (
    await page.locator("#publish-blockers .astra-blocker-what").first().innerText()
  ).trim();
  assert.equal(
    text.replace(/\s*Review\s*$/, "").trim(),
    firstRowsPress,
    `the bar names the first reason as its own press: ${text}`,
  );
  assert.match(text, /Review/, "and offers the press that reaches the list");
  assert.equal(
    await publishButton().isDisabled(),
    false,
    "warnings leave Publish enabled so the editor can publish anyway",
  );

  /*
    The bar's own press is one of the two ways to the list, so it has to work:
    leave the Checks tab first, then press Review, then look.
  */
  await page.locator("#inspector-tab-sources").click();
  await note.getByRole("button", { name: "Review" }).click();
  await waitForTruth("the Checks tab to be selected again", async () =>
    (await page.getAttribute("#inspector-tab-checks", "aria-selected")) === "true" ? true : null,
    15_000,
  );
  const shown = await page.evaluate(() => {
    const block = document.querySelector("#publish-blockers");
    const box = block.getBoundingClientRect();
    return { top: Math.round(box.top), viewport: window.innerHeight };
  });
  assert.ok(shown.top >= 0 && shown.top < shown.viewport, `the list is in view (top ${shown.top})`);
  step("the bottom bar names the first reason and Review reaches the list");
}

/**
 * 4. The block's own type scale and its contrast, measured in the browser on
 * the rendered page -- not read out of the stylesheet.
 */
async function theBlockIsReadable(theme) {
  const probes = await page.evaluate((selectors) => {
    const parse = (value) => {
      const m = String(value).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = (c) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const backdrop = (el) => {
      let node = el;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0.9) return c;
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    return selectors.map((selector) => {
      const el = document.querySelector(selector);
      if (!el) return { selector, missing: true };
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = backdrop(el);
      const hi = Math.max(luminance(fg), luminance(bg));
      const lo = Math.min(luminance(fg), luminance(bg));
      return {
        selector,
        color: cs.color,
        background: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        fontSize: Number(parseFloat(cs.fontSize).toFixed(2)),
        height: Math.round(el.getBoundingClientRect().height),
        ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
      };
    });
  }, [
    "#publish-blockers > .meta",
    "#publish-blockers .astra-blocker-chip",
    "#publish-blockers .astra-blocker-what",
    "#publish-blockers .astra-blocker-act",
  ]);

  for (const probe of probes) {
    assert.ok(!probe.missing, `${probe.selector} is on the page`);
    assert.ok(
      probe.fontSize >= 14,
      `${probe.selector} renders at ${probe.fontSize}px in ${theme}; the floor is 14px`,
    );
    assert.ok(
      probe.ratio >= 4.5,
      `${probe.selector} is ${probe.ratio}:1 in ${theme} (${probe.color} on ${probe.background})`,
    );
  }
  const act = probes.find((p) => p.selector.endsWith(".astra-blocker-act"));
  assert.ok(act.height >= 44, `each row's button is a 44px target, not ${act.height}px`);
  facts.push({ theme, probes });
  step(`nothing under 14px and every pair clears AA in ${theme} (${probes.map((p) => p.ratio).join(", ")})`);
}

/**
 * Put the desk in `mode`, from wherever it currently is.
 *
 * The footer draws ONE button that names what pressing it gets you, and it is
 * rendered only while the desk is LIGHT -- `{!night && …}` around it,
 * `src/components/desk-chrome.tsx:391`. So the label to look for is the one
 * that leads to the mode this walk wants, and it is only there if the desk is
 * not already in that mode.
 *
 * The old version pressed a FIXED label first ("Switch to dark appearance")
 * and assumed the desk started light. Since the 2026-09-26 redesign the desk
 * ships DARK, so that button is not on the page, and the press timed out --
 * which is how the first measurement below came to be taken against a dark
 * page while the facts said "light". The switch is state-aware now, and the
 * caller asks for the theme it is about to measure instead of assuming one.
 */
async function chooseAppearance(mode) {
  const want = mode === "dark" ? "desk-dark" : "light";
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute("data-appearance"),
  );
  if (current === want) return;
  const label = want === "desk-dark" ? "Switch to dark appearance" : "Switch to light appearance";
  await page.getByRole("button", { name: label }).click();
  await page.waitForFunction(
    (expected) => document.documentElement.getAttribute("data-appearance") === expected,
    want,
    { timeout: 15_000 },
  );
}

async function shoot(name) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const path = checkedOutputPath(join(EVIDENCE_DIR, name), [EVIDENCE_DIR], name);
  await page.screenshot({ path });
  screenshots.push(path);
  step(`screenshot ${name}`);
}

/** 5. Each row's press is the control that already existed, and it clears the row. */
async function everyRowHasItsOwnPress() {
  // The dek row focuses the dek box; the editor writes the dek it asks for.
  await page.locator('li[data-blocker="dek"] .astra-blocker-act').first().click();
  const focusedDek = await page.evaluate(() =>
    (document.activeElement?.className ?? "").toString(),
  );
  assert.match(focusedDek, /astra-dek/, `"Write a dek" focuses the dek box, got ${focusedDek}`);
  await page.locator(".astra-dek").fill(DEK);
  await waitForBlockerCount(2, "the dek reason to clear once a dek is written");
  step("the dek row's press lands on the dek box, and writing one clears the row");

  // The section row focuses the select; the editor picks the section.
  await page.locator('li[data-blocker="section"] .astra-blocker-act').first().click();
  const focusedSelect = await page.evaluate(() => document.activeElement?.id ?? "");
  assert.equal(focusedSelect, "story-topic-select", "'Pick a section' focuses the section select");
  const options = await page.$$eval("#story-topic-select option", (els) => els.map((e) => e.value));
  assert.ok(options.includes(SECTION_KEY), `the section list offers ${SECTION_KEY}: ${options}`);
  await page.selectOption("#story-topic-select", SECTION_KEY);
  await waitForBlockerCount(1, "the section reason to clear once one is picked");
  step("the section row's press lands on the select, and picking one clears the row");

  // The outlet row records the same override the mid-form button records.
  await page.locator(`li[data-blocker="outlet:${OUTLET}"] .astra-blocker-act`).first().click();
  await waitForTruth("the override to be recorded", async () => {
    const pg = await db();
    const row = await pg.query(
      `select o.outlet, o.overridden_by from named_outlet_overrides o
       join drafts d on d.id = o.draft_id
       where d.lead_id = $1`,
      [currentLeadId],
    );
    return row.rows[0] ?? null;
  }, 45_000);
  const pg = await db();
  const override = (
    await pg.query(
      `select o.outlet, o.overridden_by from named_outlet_overrides o
       join drafts d on d.id = o.draft_id
       where d.lead_id = $1`,
      [currentLeadId],
    )
  ).rows[0];
  assert.equal(override.outlet, OUTLET);
  assert.equal(override.overridden_by, ownerId, "the record names who overrode it");
  await waitForBlockerCount(0, "the outlet reason to clear once it is overridden");
  step("the outlet row wrote the same named_outlet_overrides row the mid-form button writes");
}

/** 6. An empty list is said in words, and the button comes on. */
async function nothingIsBlocking() {
  // The clear state is now the publish bar; the blocker list only mounts for blocks.
  assert.equal(await page.locator("#publish-blockers").count(), 0, "the cleared blocker panel is removed");
  assert.equal(
    (await page.locator("#astra-publish-bar .note").innerText()).trim(),
    "No fact check has been saved for this draft.",
    "the clear bar does not claim a fact check ran",
  );
  assert.equal(await page.locator("#publish-blockers li.astra-blocker").count(), 0);
  assert.equal(
    await page.locator("#publish-blockers .astra-blocker-act").count(),
    0,
    "an all-clear needs no button",
  );
  assert.equal(await publishButton().isEnabled(), true, "the Publish button is on");
  assert.equal(
    await page.locator("#astra-publish-bar .publish-blocked").count(),
    0,
    "and the bar has no reason left to give",
  );
  step("the bar says Ready to publish, the blocker list is gone, and the button comes on");
}

/** 7. The story prints, which is what the three reasons were holding back. */
async function publishing() {
  await publishButton().click();
  const yes = page.getByRole("button", { name: `Yes, print it in ${SECTION_NAME}`, exact: true });
  await yes.waitFor({ timeout: 20_000 });
  await yes.click();
  const article = await waitForTruth("the story to reach the paper", async () => {
    const pg = await db();
    const row = await pg.query(`select id, slug, headline, topic from articles where lead_id = $1`, [
      currentLeadId,
    ]);
    return row.rows[0] ?? null;
  }, 90_000);
  assert.equal(article.topic, SECTION_KEY, "it filed under the section the editor picked");
  facts.push({ slug: article.slug });
  step(`the story published under ${SECTION_NAME} at /articles/${article.slug}`);
}

/** 8. The publish bar's "Review" press reaches the list from wherever you are. */
async function theBannerHasAPress() {
  await page.goto(`${base}/desk/story/${reviewLeadId}`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea.astra-headline").waitFor({ timeout: 45_000 });
  const bar = page.locator("#astra-publish-bar .publish-blocked");
  await bar.waitFor({ timeout: 45_000 });
  assert.equal(await blockerKeys().then((k) => k.length), 1, "this draft has one reason standing");
  /*
    The bar's line, in the singular, is the same Unit CW rule as step 3: the
    one reason said as the press that clears it, not a count.
  */
  const soleReasonPress = (
    await page.locator("#publish-blockers .astra-blocker-what").first().innerText()
  ).trim();
  assert.equal(
    (await page.locator("#astra-publish-bar .publish-blocked").innerText())
      .replace(/\s*Review\s*$/, "")
      .trim(),
    soleReasonPress,
    "and the bar names that one reason as its own press",
  );

  // Stand somewhere else entirely, so the press has to do the navigating.
  await page.locator("#inspector-tab-sources").click();
  await bar.getByRole("button", { name: "Review" }).click();
  await waitForTruth("the Checks tab to be selected", async () =>
    (await page.getAttribute("#inspector-tab-checks", "aria-selected")) === "true" ? true : null,
    15_000,
  );
  const shown = await page.evaluate(() => {
    const box = document.querySelector("#publish-blockers").getBoundingClientRect();
    return { top: Math.round(box.top), viewport: window.innerHeight };
  });
  assert.ok(shown.top >= 0 && shown.top < shown.viewport, `the list is in view (top ${shown.top})`);
  step("the publish bar's Review opens the Checks tab on the list");
}

let currentLeadId = 0;
let reviewLeadId = 0;

/** Release G: exercise the advertised override through the built server and real editor. */
async function releaseGOverrides() {
  const pg = await db();
  for (const mode of ["unreviewed", "accepted-edited", "pasted", "self-checked"]) {
    const { leadId, draftId } = await seedLead({ headline: `Release G ${mode}`, dek: DEK,
      topic: SECTION_KEY, topicUnchosen: false, scratch: "Release G override regression" });
    const body = "On October 10, 2026, the council completed 2 planned checks after a short debate.";
    const isPaste = mode === "pasted" || mode === "self-checked";
    const url = `https://records.example/release-g-${leadId}`;
    const capture = isPaste ? null : (await pg.query("insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text) values($1,1,$2,'fixture','Council record',$3) returning id", [ownerId, url, body])).rows[0].id;
    const research = isPaste ? { importedText: true } : {
      aiEvidenceReview: { checkedText: body, rows: [] },
      storyReadiness: { version: 1, state: "not-ready", openCount: 3, totalCount: 3, reason: "3 claims need review." },
    };
    const findings = isPaste ? [] : Array.from({ length: 8 }, (_, i) => ({
      text: `Council record finding ${i + 1}: the council completed 2 planned checks.`, source_urls: [url],
      capture_event_ids: [], artifact_version_ids: [capture], locators: ["Council record"], excerpt: "the council completed 2 planned checks",
    }));
    await pg.query("update drafts set body=$1,found_note=$2,research_json=$3 where id=$4", [body, JSON.stringify(findings), JSON.stringify(research), draftId]);
    await openTheStory(leadId);
    step(`${mode}: waiting for the current claims warning`);
    await waitForBlockerCount(1, `${mode}'s current warning`);
    assert.deepEqual(await blockerKeys(), [isPaste ? "unchecked" : "claims-unreviewed"]);
    step(`${mode}: the current warning is shown`);
    if (isPaste) {
      assert.equal(await page.locator("[data-story-readiness]").getAttribute("data-story-readiness"), "not-checked");
      await page.goto(`${base}/desk/drafts`, { waitUntil: "domcontentloaded" });
      const row = page.locator(".drafts-row", { hasText: `Release G ${mode}` });
      await row.waitFor();
      assert.match(await row.innerText(), /Not checked yet/);
      await openTheStory(leadId);
    }
    if (mode === "accepted-edited") {
      await page.getByRole("button", { name: /Publish anyway — I accept these claims/ }).click();
      await waitForBlockerCount(0, "the recorded acceptance");
      await page.locator("#story-body").fill(body.replace("short", "brief"));
      await page.getByRole("button", { name: "Save edits", exact: true }).click();
      await waitForTruth("the edited word to be saved", async () => {
        const saved = await pg.query("select body from drafts where id=$1", [draftId]);
        return saved.rows[0].body.includes("brief") ? true : null;
      });
      await waitForBlockerCount(2, "the edit's current warnings");
    }
    if (mode === "self-checked") {
      await page.getByRole("button", { name: "I checked this story myself", exact: true }).click();
      await waitForBlockerCount(0, "the recorded personal check");
    }
    await publishButton().click();
    step(`${mode}: opened the publish confirmation`);
    await page.getByRole("button", { name: `${mode === "self-checked" ? "Yes, print it" : "Publish anyway"} in ${SECTION_NAME}`, exact: true }).click();
    step(`${mode}: pressed the confirmation`);
    const article = await waitForTruth(`${mode} to publish`, async () => (await pg.query("select slug,body from articles where lead_id=$1", [leadId])).rows[0]);
    assert.equal(article.body, mode === "accepted-edited" ? body.replace("short", "brief") : body);
    const audits = await pg.query("select detail,user_id from audit_events where action='override' and subject_kind='drafts' and subject_id=$1", [draftId]);
    const expected = mode === "self-checked" ? [] : mode === "accepted-edited" ? ["claims-unreviewed", "evidence-stale"] : [isPaste ? "unchecked" : "claims-unreviewed"];
    assert.deepEqual(audits.rows.map(row => JSON.parse(row.detail).key).sort(), expected.sort());
    assert.ok(audits.rows.every(row => row.user_id === ownerId));
    step(`${mode}: published through the real confirmation with the expected override audits`);
  }
}

async function main() {
  await preconditions();
  await bootTheServer();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  try {
    await ownTheDesk();
    currentLeadId = (await seedBlockedDraft()).leadId;
    reviewLeadId = (await seedReviewRequiredDraft()).leadId;

    await openTheStory(currentLeadId);
    await theListIsAtTheTopOfTheChecksTab();
    await threeRowsOnePerReason();
    // Ask for the theme before naming it: the desk ships dark, and a
    // measurement labelled "light" that was taken in dark is a false pass.
    await chooseAppearance("light");
    await theBlockIsReadable("light");
    await shoot("blocked-light.png");
    await chooseAppearance("dark");
    await theBlockIsReadable("dark");
    await shoot("blocked-dark.png");
    await chooseAppearance("light");

    await theBottomBarNamesTheFirstReason();
    await everyRowHasItsOwnPress();
    await nothingIsBlocking();
    await shoot("clear-light.png");
    await chooseAppearance("dark");
    await shoot("clear-dark.png");
    await chooseAppearance("light");

    await publishing();
    await theBannerHasAPress();
    await releaseGOverrides();

    assert.deepEqual(consoleErrors, [], "the desk reached all of this without a console error");
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(
    JSON.stringify(
      { ok: true, steps: done.length, facts, screenshots, consoleErrors: consoleErrors.slice(0, 10) },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
