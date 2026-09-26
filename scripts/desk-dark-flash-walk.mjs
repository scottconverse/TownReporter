#!/usr/bin/env node
/**
 * No light frame in dark mode, proved by sampling what the browser paints
 * (0.6.64, Unit AE).
 *
 * The owner's report, 2026-09-25: "when I change screens and I'm in dark mode
 * ... the screen flashes BRIGHT WHITE, announces where it's going like
 * 'opening desk' then switches back to dark mode ... late at night, in a dark
 * room, it's a shock."
 *
 * The cause was that every appearance preference was read in a `useEffect`,
 * i.e. after the first paint, and that the pending/error screens render
 * outside the desk shell (where the palette lives) altogether. The fix is an
 * inline <head> script that stamps `data-appearance` on <html> before the
 * first paint and CSS keyed on that attribute -- see src/lib/appearance.ts.
 *
 * This walk is the proof, and it is a measurement rather than an inspection:
 * a probe installed before any page script runs samples, on every animation
 * frame, the colour that frame is about to paint (the body's computed
 * background over the html's -- `getComputedStyle` at a rAF callback is
 * resolved before the paint for that very frame). It records a sample whenever
 * anything about the surface changes, so the log is the sequence of surfaces
 * actually painted, not a poll that could step over the bad frame: animation
 * callbacks run at every rendering opportunity that paints, and the probe
 * always asks for the next one, so no painted frame can slip between two
 * samples unnoticed.
 *
 * On a hard reload that is not quite enough on its own -- the log starts when
 * the probe first runs, and "every frame I saw was dark" says nothing about
 * frames that painted before I looked. So each hard reload also compares the
 * first sample's timestamp with the browser's own `first-paint` entry
 * (see `firstPaintedFrameIsSampled`): if the probe's first look came after the
 * browser's first paint, the one frame the owner sees first was never
 * measured and the check fails rather than passing quietly.
 *
 *   dark pass   every sampled frame on a desk route must be the desk's dark
 *               and on the public paper the reader's dark -- since the redesign
 *               both are the same warm black (#1b1916), the one dark ground the
 *               design system names (tokens/README)
 *   light pass  every sampled frame must be the light canvas (#fffdf7)
 *
 * The light pass is not decoration: it is the sensitivity control for the
 * dark one. Both passes run the SAME probe, so if the probe were blind or
 * stuck on one value, one of them would fail. On top of that each pass ends
 * with a deliberate break -- the attribute is removed in the dark pass and
 * forced to `desk-dark` in the light one -- and the walk asserts the probe
 * RECORDS the other colour. That is the direct check that this instrument can
 * see the bug it is claiming is absent.
 *
 * Walked in one browser, twice, on a real reload for every screen and on a
 * real client-side click for every step between them, in the owner's own
 * order: Desk -> Queue -> a story -> Published -> Server -> Scan -> back, then
 * out to the public paper and back with the browser's own Back button.
 *
 *   node scripts/desk-dark-flash-walk.mjs
 *
 * The built server is booted in this process on its own port (3474) against
 * in-memory PGlite. DATABASE_URL is cleared below, so the shared Postgres is
 * never touched.
 */
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen ports, found by
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can bind one and answer this walk's requests against the wrong database.
 */
const PORT_DESK_DARK_FLASH = 3474;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = checkedUrl(`http://127.0.0.1:${PORT_DESK_DARK_FLASH}`).replace(/\/$/, "");

/** The three surfaces, as the stylesheets paint them (src/styles.css).
    The desk's night and the reader's night are the same warm black now; the
    light canvas is the warm off-white (tokens/README, `--bg` in both themes). */
const DESK_DARK = { hex: "#1b1916", ...rgb(27, 25, 22) };
const READER_DARK = { hex: "#1b1916", ...rgb(27, 25, 22) };
const LIGHT = { hex: "#fffdf7", ...rgb(255, 253, 247) };

/**
 * The reader's own store is per paper (`readerStorageKey`): the first-run
 * setup below creates "Testerville Ledger" in "Testerville", so this is the
 * key the public paper reads. Seeded for both passes, so the paper half of the
 * walk is about the same two surfaces as the desk half.
 */
const READER_KEY = "townreporter:reader:Testerville%20Ledger:Testerville";

const stamp = Date.now();
const email = `desk-dark-flash-${stamp}@townreporter.test`;
const password = "desk-dark-flash-e2e-pass";
const HEADLINE = "Longmont council schedules a second reading of the occupancy rule";
const WHY = "The vote is Tuesday and the packet changed this week";

/**
 * The probe. Installed before any page script, per document.
 *
 * `getComputedStyle` inside a rAF callback is resolved for the frame that is
 * about to be painted, and the body's background wins over the html's because
 * that is what covers the canvas (a fully transparent body does not). A sample
 * is kept only when the surface changes, so the log reads as the list of
 * surfaces painted; nothing is sampled by a timer that could step over a
 * frame.
 */
const SAMPLER = `
window.__flash = [];
(function sample() {
  requestAnimationFrame(sample);
  try {
    var html = document.documentElement;
    if (!html) return;
    var body = document.body;
    var at = html.getAttribute("data-appearance");
    var htmlBg = getComputedStyle(html).backgroundColor;
    var bodyBg = body ? getComputedStyle(body).backgroundColor : null;
    var url = location.pathname + location.hash;
    var last = window.__flash[window.__flash.length - 1];
    if (!last || last.at !== at || last.htmlBg !== htmlBg || last.bodyBg !== bodyBg || last.url !== url) {
      window.__flash.push({
        t: Math.round(performance.now()),
        at: at,
        htmlBg: htmlBg,
        bodyBg: bodyBg,
        url: url,
      });
    }
  } catch (e) { /* a document mid-teardown */ }
})();
`;

function rgb(r, g, b) {
  return { r, g, b };
}

/** `rgb(24, 32, 36)` / `rgba(0, 0, 0, 0)` -> components, or null. */
function parseColour(css) {
  const match = /rgba?\(([^)]+)\)/.exec(css || "");
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** What that frame actually painted: the body over the html. */
function painted(entry) {
  const body = parseColour(entry.bodyBg);
  if (body && body.a > 0) return body;
  return parseColour(entry.htmlBg);
}

function isColour(actual, expected) {
  return !!actual && actual.r === expected.r && actual.g === expected.g && actual.b === expected.b;
}

function describe(entry) {
  return JSON.stringify({
    t: entry.t,
    at: entry.at,
    html: entry.htmlBg,
    body: entry.bodyBg,
    url: entry.url,
  });
}

let page;
const done = [];
const facts = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/** Every sample in `entries` must have painted `expected` and stamped `attr`. */
function expectEveryFrame(label, entries, expected, attr) {
  must(
    entries.length > 0,
    `${label}: the probe recorded no frame at all. Silence is not a pass -- if the sampler ` +
      `never ran, nothing was measured, and this walk would report a clean result for a page ` +
      `nothing had looked at.`,
  );
  const wrongColour = entries.filter((entry) => !isColour(painted(entry), expected));
  const wrongAttr = entries.filter((entry) => entry.at !== attr);
  must(
    wrongColour.length === 0 && wrongAttr.length === 0,
    `${label}: ${wrongColour.length + wrongAttr.length} of ${entries.length} sampled frames ` +
      `were not ${expected.hex} / data-appearance="${attr}" -- the page painted:\n  ` +
      [...wrongColour, ...wrongAttr].slice(0, 6).map(describe).join("\n  "),
  );
  facts.push({
    label,
    frames: entries.length,
    colour: expected.hex,
    attr,
    first: describe(entries[0]),
  });
}

/** Wait for `count` frames to have been painted, so a sample exists. */
async function frames(count = 2) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const tick = () => (left-- <= 0 ? resolve(undefined) : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/** The samples recorded since `from`, in order. */
async function samplesFrom(from) {
  return page.evaluate((index) => window.__flash.slice(index), from);
}

async function sampleCount() {
  return page.evaluate(() => window.__flash.length);
}

async function pathIs(path) {
  await page.waitForFunction((want) => location.pathname === want, path, { timeout: 30_000 });
}

/**
 * The probe's first look must have come before the browser's first paint, or
 * the frame the owner actually sees first went unmeasured.
 *
 * This is the one hole a rAF sampler has on a fresh document: the log starts
 * when the probe runs, so a white frame painted before that would leave no
 * trace and the check would pass on a walk that never looked at it. The
 * browser timestamps its own first paint, so comparing the two turns that
 * hole into a failure. One frame of slack (16ms) absorbs rounding.
 */
async function firstPaintedFrameIsSampled(label, entries) {
  const firstPaint = await page.evaluate(() => {
    const paint = performance.getEntriesByType("paint").find((e) => e.name === "first-paint");
    return paint ? paint.startTime : null;
  });
  must(
    firstPaint !== null,
    `${label}: this browser reported no first-paint timing, so "the first frame was already ` +
      `dark" cannot be checked here -- nothing in this run says what was painted first.`,
  );
  const first = entries[0];
  must(
    typeof first.t === "number" && first.t <= firstPaint + 16,
    `${label}: the probe first looked at ${first.t}ms but the browser had already painted at ` +
      `${Math.round(firstPaint)}ms, so the first painted frame was never sampled.`,
  );
  return Math.round(firstPaint);
}

/**
 * One hard reload: a fresh document, so the probe's log starts empty and its
 * first entry is the first frame painted.
 */
async function hardLoad(label, path, expected, attr) {
  await page.goto(base + path, { waitUntil: "load", timeout: 45_000 });
  await frames(2);
  const entries = await samplesFrom(0);
  const firstPaint = await firstPaintedFrameIsSampled(`${label} (hard reload)`, entries);
  expectEveryFrame(`${label} (hard reload)`, entries, expected, attr);
  facts[facts.length - 1].firstPaint = firstPaint;
  step(`${label} paints ${expected.hex} from its first frame on a hard reload`);
}

/** One client-side navigation, clicked like an editor clicks it. */
async function clickThrough(label, click, path, expected, attr) {
  const from = await sampleCount();
  await click();
  await pathIs(path);
  await frames(3);
  const entries = await samplesFrom(from);
  expectEveryFrame(`${label} (client-side)`, entries, expected, attr);
  step(`${label} paints ${expected.hex} on every frame of a client-side navigation`);
}

/** Boot the built server here, in this process, on in-memory PGlite. */
async function bootTheServer() {
  process.env.PORT = String(PORT_DESK_DARK_FLASH);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "desk-dark-flash-e2e-secret";
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

/**
 * The first pass creates the first account (the first person in owns the
 * desk) and finishes first-run setup; the second pass signs the SAME account
 * in, because both passes share this process's one database and the login page
 * decides which form to show by asking whether an account exists yet.
 */
async function ownTheDesk(pass) {
  const create = pass === "dark";
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: create ? "Create the desk" : "Editor sign-in" }).waitFor({
    timeout: 45_000,
  });
  if (create) await page.getByLabel("Name").fill("Dark Flash Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (create) {
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  if (create) await completeFirstRunSetup(page, base);
  step(create ? "the desk exists" : "the same desk is signed in again");
}

/** A real lead, filed the way an editor files one, so /desk/story/<id> is real. */
async function fileTheLead() {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  await page.getByText("File a lead yourself", { exact: true }).click();
  await page.getByLabel("Headline").fill(HEADLINE);
  await page.getByLabel("Why now").fill(WHY);
  await page.getByRole("button", { name: "File lead" }).click();
  // Filing navigates straight to the new lead's workspace; read the id off the
  // URL rather than inventing one, so the walk opens a story that exists.
  await page.waitForFunction(() => /^\/desk\/story\/\d+$/.test(location.pathname), undefined, {
    timeout: 45_000,
  });
  const id = Number(page.url().split("/").pop());
  must(Number.isInteger(id) && id > 0, `the filed lead's URL carried no usable id: ${page.url()}`);
  step(`a lead was filed, so the story workspace is /desk/story/${id}`);
  return id;
}

/** The id of the lead the dark pass filed, read off the Queue's own row. */
async function openTheFiledLead() {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  const href = await page
    .locator('a[href^="/desk/story/"]')
    .first()
    .getAttribute("href", { timeout: 45_000 });
  const id = Number((href || "").split("/").pop());
  must(Number.isInteger(id) && id > 0, `no lead on the Queue to open: the row link read ${href}`);
  step(`the Queue holds the filed lead, /desk/story/${id}`);
  return id;
}

/** Set the desk to dark through its own control, and prove the choice stuck. */
async function chooseDark() {
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-appearance") === "desk-dark",
    undefined,
    { timeout: 15_000 },
  );
  const stored = await page.evaluate(() => {
    try {
      return localStorage.getItem("townreporter.desk.mode");
    } catch {
      return "(storage blocked)";
    }
  });
  must(stored === "dark", `the toggle did not persist the choice: localStorage holds ${stored}`);
  step("dark is chosen through the desk's own toggle and survives");
}

/**
 * The deliberate break: strip the attribute the fix is built on and require
 * the probe to SEE the light canvas. Without this the dark half could pass on
 * an instrument that cannot report a light frame at all.
 */
async function proveTheProbeCanSee(label, breakIt, expected) {
  const control = await page.evaluate(breakIt);
  await frames(2);
  const seen = await page.evaluate(() => window.__flash.slice(-8));
  must(
    isColour(parseColour(control.after.bg), expected) || seen.some((e) => isColour(painted(e), expected)),
    `${label}: the probe did not report ${expected.hex} after the surface was deliberately ` +
      `broken (attribute now ${JSON.stringify(control.after.at)}, html background ` +
      `${control.after.bg}); this instrument cannot see the bug it is claiming is absent.`,
  );
  step(`${label}: with the attribute broken the same probe reports ${expected.hex}`);
  // Put the document back: the next phase reloads anyway, but leaving a broken
  // attribute behind would make a later failure read as something else.
  await page.reload({ waitUntil: "load" });
}

/** The desk's own nav links, in the owner's order. */
const DESK_ROUTES = [
  { label: "Desk", path: "/desk", link: "Desk" },
  { label: "Queue", path: "/desk/queue", link: "Queue" },
  { label: "Published", path: "/desk/published", link: "Published" },
  { label: "Server", path: "/desk/ops", link: "Server" },
  { label: "Scan", path: "/desk/scan", link: "Scan" },
];

/** One full pass, dark or light. Returns when every frame has been checked. */
async function theWalk(pass) {
  const dark = pass === "dark";
  const deskSurface = dark ? DESK_DARK : LIGHT;
  const paperSurface = dark ? READER_DARK : LIGHT;
  const deskAttr = dark ? "desk-dark" : "light";
  const paperAttr = dark ? "reader-dark" : "light";

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: SAMPLER });
  await context.addInitScript(
    ({ key, mode }) => {
      try {
        localStorage.setItem(key, JSON.stringify({ dark: mode === "dark", size: 18, saved: [] }));
      } catch {
        /* blocked storage: the pass then runs on the light default */
      }
    },
    { key: READER_KEY, mode: pass },
  );
  page = await context.newPage();

  console.log(`\n${pass.toUpperCase()} PASS`);
  await ownTheDesk(pass);
  // The dark pass files the lead; the light pass opens the same one off the
  // Queue, which is what an editor does on any later visit -- and keeps the
  // second pass from filing a duplicate of the first pass's headline.
  const leadId = dark ? await fileTheLead() : await openTheFiledLead();
  if (dark) await chooseDark();

  const story = { label: "Story", path: `/desk/story/${leadId}`, link: null };

  // 1. Out of a hard reload into the desk, then straight through the owner's
  //    order, every step a real client-side navigation.
  await hardLoad("Desk", "/desk", deskSurface, deskAttr);
  for (const route of [DESK_ROUTES[1], story, ...DESK_ROUTES.slice(2), DESK_ROUTES[0]]) {
    const path = route.path;
    const link = route.link;
    await clickThrough(
      route.label,
      () => (link ? deskLink(link) : storyLink(leadId)),
      path,
      deskSurface,
      deskAttr,
    );
  }

  // 2. Out to the public paper -- the reader's own dark, a different colour --
  //    and back with the browser's Back button, which is a client-side
  //    navigation too.
  await clickThrough(
    "Public paper",
    () => page.getByRole("link", { name: "Public news page" }).first().click(),
    "/",
    paperSurface,
    paperAttr,
  );
  const from = await sampleCount();
  await page.goBack();
  await pathIs("/desk");
  await frames(3);
  expectEveryFrame(
    "Back into the desk (client-side)",
    await samplesFrom(from),
    deskSurface,
    deskAttr,
  );
  step(`the desk paints ${deskSurface.hex} when the browser's Back returns to it`);

  // 3. A hard reload on every screen, including the paper.
  for (const route of [...DESK_ROUTES, { label: "Story", path: `/desk/story/${leadId}` }]) {
    await hardLoad(route.label, route.path, deskSurface, deskAttr);
  }
  await hardLoad(
    "Public paper",
    "/",
    paperSurface,
    paperAttr,
  );

  // 4. The sensitivity control, run last so it cannot help an earlier phase.
  await hardLoad("Desk", "/desk", deskSurface, deskAttr);
  if (dark) {
    await proveTheProbeCanSee(
      "dark pass",
      () => {
        const html = document.documentElement;
        html.removeAttribute("data-appearance");
        html.removeAttribute("data-desk-size");
        return {
          after: { at: html.getAttribute("data-appearance"), bg: getComputedStyle(html).backgroundColor },
        };
      },
      LIGHT,
    );
  } else {
    await proveTheProbeCanSee(
      "light pass",
      () => {
        const html = document.documentElement;
        html.setAttribute("data-appearance", "desk-dark");
        return {
          after: { at: html.getAttribute("data-appearance"), bg: getComputedStyle(html).backgroundColor },
        };
      },
      DESK_DARK,
    );
  }

  await context.close();
}

/** Click a desk nav link by its visible name. */
async function deskLink(name) {
  await page.getByRole("link", { name, exact: true }).first().click();
}

async function storyLink() {
  // The Queue row links the filed lead's own headline. Reached from the desk
  // command center, so go through the nav the way an editor would.
  await deskLink("Queue");
  await pathIs("/desk/queue");
  await page.locator('a[href^="/desk/story/"]').first().click();
}

let browser;
try {
  console.log(`booting the built server on ${base} (in-memory PGlite)`);
  await bootTheServer();
  step("the built server answers on its own port");
  browser = await chromium.launch();
  for (const pass of ["dark", "light"]) {
    await theWalk(pass);
  }
  console.log(`\n${done.length} checks passed`);
  console.log(
    JSON.stringify({ ok: true, port: PORT_DESK_DARK_FLASH, checks: done, facts }, null, 2),
  );
  await browser.close();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* the page is already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  try {
    await browser?.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
}
