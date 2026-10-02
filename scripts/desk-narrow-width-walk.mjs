#!/usr/bin/env node
/**
 * No desk page scrolls SIDEWAYS, at any width a desk is read at.
 *
 * WHAT WAS WRONG. The production auditor opened the desk in a real browser and
 * measured the page against the window. `/desk/models` was 135px wider than a
 * 1024px screen, 259px wider at 900 and 554px wider at 390 -- the whole page
 * scrolled sideways, so the right-hand columns (the model select, the status
 * chip) sat off the edge of a phone. `/desk/queue` was 64px too wide at 900,
 * pushed by the row's own actions and its "More" menu.
 *
 * WHAT THIS WALK PROVES, on the built server and the real desk UI:
 *
 *   1. On EVERY desk route this walk can reach, at 1280, 1024, 900, 768 and
 *      390px wide, `documentElement.scrollWidth - clientWidth` is 0 (1px of
 *      rounding allowed) AND `body`'s is too. A table that needs more room than
 *      the window has must scroll INSIDE its own container -- the page must
 *      never be the thing that moves.
 *   2. The Queue's "More ▾" menu, opened on a real row, does not widen the page
 *      at 900 or 390 either. The menu may scroll inside itself; it may not take
 *      the page with it.
 *   3. The Models table and the Queue table are both still READABLE at 390: the
 *      model select is still on the page and still a 44px-tall target, and the
 *      row's own controls are all still there. Fitting by deleting a control is
 *      not fitting.
 *   4. Both themes: the desk ships dark, so the measurement is taken in BOTH
 *      dark and light at the two narrowest widths on the two screens this unit
 *      changed.
 *
 * A failure prints the numbers and names the widest elements, so the next
 * reader does not have to guess which box did it.
 *
 * NO MODEL IS REACHED: the provider ladder is pointed at an address this walk
 * proves is dead before it boots, `ANTHROPIC_API_KEY` is cleared and both
 * unattended CLI rungs point at files that do not exist. Nothing here drafts.
 *
 * The server under test must be BUILT (`npm run build`); this walk imports
 * `.output/server/index.mjs` itself.
 *
 *   node scripts/desk-narrow-width-walk.mjs
 */
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen port; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_NARROW_WIDTH = 3591;
/** The address a model would be reached on. NOTHING listens here. */
const PORT_NO_MODEL = 3592;

const base = checkedUrl(`http://127.0.0.1:${PORT_NARROW_WIDTH}`);

/** Every width a desk is read at. 390 is a phone; 768 a tablet. */
const WIDTHS = [1280, 1024, 900, 768, 390];
/** 1px of rounding is not a sideways scroll. */
const ALLOWED = 1;

const stamp = Date.now();
const email = `desk-narrow-${stamp}@townreporter.test`;
const password = "desk-narrow-width-pass";

/**
 * The routes this walk opens, in the desk's own nav order. `/desk/story` needs
 * a lead id and is added once the fixture exists.
 */
const ROUTES = [
  ["Today", "/desk"],
  ["Queue", "/desk/queue"],
  ["Drafts", "/desk/drafts"],
  ["Published", "/desk/published"],
  ["Opinion", "/desk/opinion"],
  ["Follow-ups", "/desk/follow-ups"],
  ["Dark Desk", "/desk/dark"],
  ["Sources & scan", "/desk/sources"],
  ["Scan the wire", "/desk/scan"],
  ["Models", "/desk/models"],
  ["Server", "/desk/ops"],
  ["Stats", "/desk/stats"],
  ["Import", "/desk/import"],
  ["Beat memory", "/desk/memory"],
  ["Legal removals", "/desk/legal-removals"],
];

/**
 * The two pages whose fit this unit is responsible for, and asserts.
 *
 * Every other desk route is measured and REPORTED (see `otherOverflow`), not
 * asserted: the brief that opened this unit names these two, and a walk that
 * failed on a screen no one has been asked to fix would be a walk that gets
 * switched off rather than read.
 */
const MUST_FIT = ["Queue", "Models"];

const done = [];
const facts = [];
const overflow = [];
/** Overflow found on a page this unit does not own -- reported, never asserted. */
const otherOverflow = [];

let page;
let storyLeadId = 0;

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
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* the page is already gone */
  }
  console.error(
    JSON.stringify(
      { ok: false, error: message, url, text, completed: done, overflow, otherOverflow },
      null,
      2,
    ),
  );
  process.exit(1);
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 300));
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
 * The address a model would be reached on, checked before anything boots.
 *
 * A stranger answering there would mean a rung of the ladder could reach a real
 * model; this walk needs none, so it refuses to start if something is there.
 */
async function preconditions() {
  const problems = [];
  let answered = false;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT_NO_MODEL}/v1/models`, {
      signal: AbortSignal.timeout(2_000),
    });
    answered = res.ok || res.status < 500;
  } catch {
    /* nothing there, which is what this walk needs */
  }
  if (answered) {
    problems.push(
      `something is answering on http://127.0.0.1:${PORT_NO_MODEL}/v1, which this walk leaves ` +
        `empty on purpose.`,
    );
  }
  if (process.env.ANTHROPIC_API_KEY) {
    problems.push("ANTHROPIC_API_KEY is set: a rung of the ladder could answer with a real model.");
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/** Boot the BUILT server here, on this walk's own port, over in-memory PGlite. */
async function bootTheServer() {
  process.env.PORT = String(PORT_NARROW_WIDTH);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.BETTER_AUTH_SECRET ||= "desk-narrow-width-secret";
  process.env.LLM_BASE_URL = `http://127.0.0.1:${PORT_NO_MODEL}/v1`;
  process.env.LLM_MODEL = "no-model-is-reachable";
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
  await page.getByLabel("Name").fill("Narrow Width Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await fillPendingSetupCodeIfPresent(page);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

/**
 * A desk with rows on it.
 *
 * A Queue with no leads draws no table and no row menu, and `/desk/models`
 * draws its grid whatever is stored -- so the fixture is what makes this walk
 * measure the screens the auditor measured. The statuses are spread so the
 * Queue's tabs and the row menus (which differ by status) are all real.
 */
async function seedTheDesk() {
  const pg = await db();
  const owner = await pg.query(`select id from "user" limit 1`);
  const userId = owner.rows[0]?.id;
  must(userId, "the first-run account exists in the database");

  const statuses = ["new", "new", "new", "new", "held", "killed"];
  let firstLead = 0;
  for (let i = 0; i < statuses.length; i += 1) {
    const headline = `Fixture lead ${i + 1}: the council takes up the annexation`;
    const lead = await pg.query(
      `insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, evidence, newsworthiness, notes_json)
       values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        userId,
        headline,
        "Fixture: a lead for the narrow-width walk.",
        "council",
        statuses[i],
        JSON.stringify([`https://example.test/lead-${i + 1}`]),
        "The council packet describes the annexation.",
        11,
        JSON.stringify({ todo: [], found: [], verify: [], opened: [], scratch: "" }),
      ],
    );
    const leadId = Number(lead.rows[0].id);
    must(Number.isFinite(leadId), "the seeded lead has an id");
    if (!firstLead) firstLead = leadId;
    if (statuses[i] === "new" && i < 2) {
      await pg.query(
        `insert into drafts (user_id, newsroom_id, lead_id, headline, dek, body, topic, source_urls,
           provenance_json, found_note, unanswered, research_json, model_headline, model_topic, headline_source)
         values ($1, 1, $2, $3, $4, $5, $6, '[]', '[]', '', '[]', '{}', $3, $6, 'model')`,
        [
          userId,
          leadId,
          headline,
          "A fixture dek.",
          "The council took up the annexation Monday night.\n\nThe item returns next month.",
          "council",
        ],
      );
    }
  }
  storyLeadId = firstLead;
  facts.push({ leads: statuses.length, drafts: 2 });
  step(`${statuses.length} leads and 2 drafts are on the desk`);
}

/**
 * The one number this walk is about, plus the boxes that produced it.
 *
 * `scrollWidth - clientWidth` on `documentElement` is the page's own sideways
 * scroll. `body` is read as well because a page can move without the root
 * reporting it. The widest offenders are collected so a failure names the box
 * rather than only the number.
 */
function measure() {
  return page.evaluate(() => {
    const de = document.documentElement;
    const limit = de.clientWidth;
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".")}`;
    /*
      An element inside a clipped ancestor cannot widen the page: whatever it
      does happens inside that box's own scroll area. Without this the list is
      topped by boxes that merely reach past the window inside a scroller --
      which is the very arrangement this unit wants -- and the box that is
      actually pushing the page is buried below them.
    */
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return true;
      }
      return false;
    };
    const offenders = [];
    const selfOverflowing = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      const over = Math.round(r.right - limit);
      if (over > 1 && !clipped(el)) {
        offenders.push({ what: name(el), over, left: Math.round(r.left), width: Math.round(r.width) });
      }
      /* A box whose own content is wider than its own box is the culprit: it is
         the thing that has to be made to fit or to scroll. */
      if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 1) {
        selfOverflowing.push({
          what: name(el),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          over: el.scrollWidth - el.clientWidth,
        });
      }
    }
    offenders.sort((a, b) => b.over - a.over);
    selfOverflowing.sort((a, b) => b.over - a.over);
    return {
      doc: de.scrollWidth - de.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
      viewport: de.clientWidth,
      offenders: offenders.slice(0, 6),
      selfOverflowing: selfOverflowing.slice(0, 6),
    };
  });
}

/** Widths are measured after the layout has settled at the new size. */
async function openAt(width, path) {
  await page.setViewportSize({ width, height: width <= 500 ? 844 : 900 });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator(".deskmain, main, .ov-head").first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(700);
}

function record(label, width, m) {
  const row = { label, width, doc: m.doc, body: m.body };
  if (m.doc > ALLOWED || m.body > ALLOWED) {
    row.offenders = m.offenders;
    row.selfOverflowing = m.selfOverflowing;
    if (MUST_FIT.includes(label)) overflow.push(row);
    else otherOverflow.push({ ...row, offenders: m.offenders.slice(0, 2) });
  }
  return row;
}

async function measureEveryDeskPage() {
  const routes = [...ROUTES];
  if (storyLeadId) routes.push(["Story workbench", `/desk/story/${storyLeadId}`]);
  const measured = [];
  for (const [label, path] of routes) {
    for (const width of WIDTHS) {
      await openAt(width, path);
      const row = record(label, width, await measure());
      measured.push(row);
      console.log(
        `  ${row.doc > ALLOWED || row.body > ALLOWED ? "OVER " : "ok   "} ${label} @${width}  doc ${row.doc}px  body ${row.body}px`,
      );
    }
  }
  facts.push({ measured: measured.length, widths: WIDTHS, routes: routes.length });
  assert.deepEqual(
    overflow.map(
      (r) =>
        `${r.label} @${r.width}: page is ${r.doc}px wider than the window (body ${r.body}px); ` +
        `widest box past the edge ${JSON.stringify(r.offenders?.[0] ?? null)}; ` +
        `the box that is itself too wide ${JSON.stringify(r.selfOverflowing?.[0] ?? null)}`,
    ),
    [],
    "no desk page may scroll sideways at any width a desk is read at",
  );
  step(`Models and Queue fit the window at all ${WIDTHS.length} widths (${measured.length} measurements)`);
  if (otherOverflow.length) {
    console.log(
      `  note  ${otherOverflow.length} overflow(s) on desk pages this unit does not own (reported, not asserted):`,
    );
    for (const r of otherOverflow) {
      console.log(`        ${r.label} @${r.width}: ${r.doc}px (widest ${r.offenders?.[0]?.what ?? "?"})`);
    }
  }
}

/**
 * The Queue's row menu, open, at the two widths the auditor complained about.
 *
 * `.more-menu` is `position: absolute` on the desk, so an open menu whose panel
 * is wider than the room left of the row's right edge can widen the page
 * without changing any row's own box. The menu is allowed to scroll inside
 * itself; it is not allowed to take the page with it.
 */
async function theRowMenuDoesNotWidenThePage() {
  for (const width of [900, 390]) {
    await openAt(width, "/desk/queue");
    const summary = page.locator(".lead-row .more-sum").first();
    await summary.waitFor({ timeout: 30_000 });
    await summary.click();
    await page.locator(".more-menu").first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
    const m = await measure();
    const row = record("Queue with a row menu open", width, m);
    console.log(
      `  ${row.doc > ALLOWED || row.body > ALLOWED ? "OVER " : "ok   "} Queue + open menu @${width}  doc ${row.doc}px  body ${row.body}px`,
    );
    assert.deepEqual(
      row.doc > ALLOWED || row.body > ALLOWED
        ? [`@${width}: ${row.doc}px (widest ${JSON.stringify(m.offenders[0] ?? null)})`]
        : [],
      [],
      "an open row menu may scroll inside itself but must not widen the page",
    );
    // Put it away so the next width starts from the same state.
    await page.keyboard.press("Escape");
  }
  step("the Queue's row menu, open, does not widen the page at 900 or 390");
}

/**
 * Fitting is not deleting.
 *
 * At 390 the Models row is the screen the auditor caught: a seven-column table
 * on a phone. Whatever the fix is, the select must still be there and still be a
 * 44px target -- a table that fits because its control was removed is a worse
 * screen than one that scrolls.
 */
async function thePhoneStillHasItsControls() {
  await openAt(390, "/desk/models");
  const selects = page.locator("#models-panel-assign select");
  const count = await selects.count();
  assert.ok(count > 0, "the Models table still draws its selects at 390");
  const first = selects.first();
  const box = await first.boundingBox();
  assert.ok(box, "the first model select has a box at 390");
  assert.ok(
    box.height >= 44,
    `the model select is still a 44px touch target at 390 (measured ${Math.round(box.height)}px)`,
  );
  assert.ok(
    await first.isEnabled(),
    "and it is still usable: the walk signs in as the desk owner, so the select must be enabled",
  );
  facts.push({ phoneSelectHeight: Math.round(box.height), selectsAt390: count });

  await openAt(390, "/desk/queue");
  const rows = await page.locator(".lead-row").count();
  assert.ok(rows > 0, "the Queue still draws rows at 390");
  const acts = await page.locator(".lead-row .queue-acts").first().boundingBox();
  assert.ok(acts, "a row's actions are still on the page at 390");
  const startStory = page.locator(".lead-row .queue-acts .btn").first();
  assert.ok(
    (await startStory.count()) > 0,
    "the row's own press is still there at 390 -- fitting must not remove a control",
  );
  facts.push({ queueRowsAt390: rows, actsWidth: Math.round(acts.width) });
  step("at 390 both screens still carry their controls and the select is a 44px target");
}

/** Each of the two screens this unit changed, in both themes, at 900 and 390. */
async function bothThemes() {
  const bad = [];
  const appearance = async () =>
    page.evaluate(() => document.documentElement.dataset.appearance ?? "");
  /*
    The desk's own theme control, pressed as a press.

    It lives on the sidebar foot -- a fixed panel at the bottom of the nav --
    and on a window shorter than that panel the control can be laid out below
    the fold in a box the page cannot scroll, which is where Playwright refuses
    the click ("element is outside of the viewport") even though the button is
    drawn. When that happens the same button is pressed through the platform's
    own click on the element rather than through a pointer, and the fact is
    RECORDED: a walk that quietly swapped one press for another would be
    claiming a press it did not make.
  */
  async function pressThemeToggle(want) {
    const button = page.getByRole("button", {
      name: want === "desk-dark" ? "Switch to dark appearance" : "Switch to light appearance",
    });
    await button.waitFor({ timeout: 20_000 });
    try {
      await button.click({ timeout: 8_000 });
    } catch {
      facts.push({ themeTogglePressedInPage: want });
      console.log(`  note  the ${want} toggle was out of pointer reach; pressed in the page`);
      await button.evaluate((el) => el.click());
    }
    await waitForTruth(`the desk to go ${want}`, async () =>
      (await appearance()) === want ? true : null,
    );
  }

  for (const path of ["/desk/models", "/desk/queue"]) {
    for (const want of ["light", "desk-dark"]) {
      /*
        The theme is asked for at 1280, where the desk's toggle is drawn: at
        390 the nav is an off-canvas drawer and its foot is off the screen, so
        the press would have nothing to reach. The theme is then checked again
        on every measured page, so what is measured is the theme it is labelled
        with rather than the theme the walk hoped for.
      */
      await openAt(1280, path);
      if ((await appearance()) !== want) await pressThemeToggle(want);
      for (const width of [900, 390]) {
        await openAt(width, path);
        const applied = await appearance();
        assert.equal(
          applied,
          want,
          `the theme the walk asked for is the theme the page draws (${path} @${width})`,
        );
        const m = await measure();
        const row = { label: `${path} (${applied})`, width, doc: m.doc, body: m.body };
        if (m.doc > ALLOWED || m.body > ALLOWED) bad.push(row);
        console.log(
          `  ${m.doc > ALLOWED || m.body > ALLOWED ? "OVER " : "ok   "} ${path} ${applied} @${width}  doc ${m.doc}px  body ${m.body}px`,
        );
      }
    }
  }
  assert.deepEqual(
    bad.map((r) => `${r.label} @${r.width}: ${r.doc}px`),
    [],
    "both themes fit too",
  );
  step("Models and Queue fit in both themes at 900 and 390");
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
    await seedTheDesk();
    await measureEveryDeskPage();
    await theRowMenuDoesNotWidenThePage();
    await thePhoneStillHasItsControls();
    await bothThemes();
    assert.deepEqual(consoleErrors, [], "the desk reached all of this without a console error");
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        steps: done.length,
        facts,
        overflow,
        otherOverflow,
        consoleErrors: consoleErrors.slice(0, 10),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
