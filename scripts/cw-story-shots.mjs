#!/usr/bin/env node
/**
 * Captures for unit CW -- the drawn story workbench (0.6.81).
 *
 * The brief judges this unit by pictures, so this file produces the pictures
 * and the evidence that goes with them:
 *
 *   1. the drawing (`docs/design/handoff-2026-09-26/design/Desk Story.dc.html`)
 *      at 1440, 1024 and 390 wide, light and dark;
 *   2. the real screen (`/desk/story/<leadId>`) at those three widths crossed
 *      with light/dark and Standard/Large desk text;
 *   3. a side-by-side of the two for every shape, so the regions can be read
 *      against each other without opening two files;
 *   4. the region order read off both pages and asserted to be the same one;
 *   5. every button on the seeded screen pressed once, with what happened.
 *
 * The desk this runs against is a dev server on 127.0.0.1:8090 with PGlite in
 * memory -- started and stopped by whoever runs this file, by PID. This file
 * only visits. It calls no model and fetches nothing off the machine.
 *
 *   CW_SHOTS_BASE_URL=http://127.0.0.1:8090 \
 *   CW_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/reports/CW-evidence \
 *   node scripts/cw-story-shots.mjs
 *
 * The fixture the real captures need (a lead, a draft with a dek, claims in
 * every judgment state, a name the check could not settle) is written by
 * scripts/cw-story-seed-route.ts, copied to src/routes/api/dev-seed.ts for the
 * run -- see the header of that file for why it has to be a route on the same
 * process rather than a script.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const PORT_CW_SHOTS = 8090;

const base = checkedUrl(
  process.env.CW_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_CW_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.CW_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/reports/CW-evidence",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(resolve(outDir, "drawing"), { recursive: true });
mkdirSync(resolve(outDir, "real"), { recursive: true });
mkdirSync(resolve(outDir, "side-by-side"), { recursive: true });

const SEED_PATH = "/api/dev-seed";
const DRAWING = pathToFileURL(
  resolve("docs/design/handoff-2026-09-26/design/Desk Story.dc.html"),
).href;

/*
  A fixed address, for the same reason the sibling shots files use one: the
  server holds PGlite in memory, so the desk lives exactly as long as the
  process, and a re-run against a server that already has an owner has to sign
  in rather than try to create the first account again.
*/
const email = process.env.CW_SHOTS_EMAIL || "cw-probe@townreporter.test";
const password = process.env.CW_SHOTS_PASSWORD || "cw-probe-pass";

const WIDTHS = [
  { width: 1440, height: 1100 },
  { width: 1024, height: 1100 },
  { width: 390, height: 844 },
];

/*
  Light and dark, Standard and Large desk text. `large` is the desk's own
  accessibility size, which the drawing has no switch for -- it is captured
  beside the same drawing, because what the brief asks is whether the drawn
  regions survive the desk's real text sizes.
*/
const MODES = [
  { tag: "light-standard", mode: "light", size: "normal", appearance: "light", deskSize: null },
  { tag: "dark-standard", mode: "dark", size: "normal", appearance: "desk-dark", deskSize: null },
  { tag: "light-large", mode: "light", size: "large", appearance: "light", deskSize: "large" },
  { tag: "dark-large", mode: "dark", size: "large", appearance: "desk-dark", deskSize: "large" },
];

/**
 * The regions the drawing draws, in the order it draws them, as the words on
 * the page. Both pages are read the same way -- every visible element with text
 * of its own, in document order -- so a hit here means the words are on the
 * screen at that position, not that a class happens to exist.
 */
const REGIONS = [
  { key: "evidence-check", re: /^Evidence check$/i },
  { key: "writer", re: /^Writer$/i },
  { key: "headline", re: /headline\s*[·.]\s*yours/i },
  { key: "summary", re: /^Summary$/i },
  { key: "story", re: /^Story$/i },
  { key: "action-row", re: /^Check draft against evidence$/i },
  { key: "publish-bar", re: /^Publish in /i },
];

/*
  Sticky chrome, hidden for the length of a full-page capture: a full-page shot
  reaches past the viewport and `position: sticky` / `fixed` elements paint at
  whatever offset the capture reached from, so the publish bar and the topbar
  land across the middle of the image.
*/
const PINNED_CHROME_HIDDEN = ".astra-topbar,.astra-skip,.astra-publish-bar{visibility:hidden !important}";

/** Every visible element's own text, in document order. */
async function visibleLines(p) {
  return p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || s.display === "none" || s.visibility === "hidden") continue;
      if (Number(s.opacity) <= 0.05) continue;
      let own = "";
      for (const node of el.childNodes) {
        if (node.nodeType === 3) own += node.nodeValue ?? "";
      }
      const t = own.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    return out;
  });
}

/** The drawn regions present on a page, in the order they appear. */
function regionOrder(lines) {
  const hits = [];
  for (const region of REGIONS) {
    const index = lines.findIndex((line) => region.re.test(line));
    if (index >= 0) hits.push({ key: region.key, index, line: lines[index] });
  }
  return hits;
}

/** The three floors the sibling shots files measure, read from the live DOM. */
async function measure(p) {
  return p.evaluate(() => {
    const doc = document.documentElement;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 1 &&
        r.height > 1 &&
        s.visibility !== "hidden" &&
        s.display !== "none" &&
        Number(s.opacity) > 0.05
      );
    };
    let minFont = Infinity;
    let minFontText = "";
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      let own = "";
      for (const node of el.childNodes) {
        if (node.nodeType === 3) own += node.nodeValue ?? "";
      }
      if (!own.trim()) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(px) && px < minFont) {
        minFont = px;
        minFontText = own.trim().slice(0, 60);
      }
    }
    let minBtn = Infinity;
    let minBtnText = "";
    for (const el of document.querySelectorAll('button, .btn, a[role="button"]')) {
      if (!visible(el)) continue;
      const h = el.getBoundingClientRect().height;
      if (h < minBtn) {
        minBtn = h;
        minBtnText = (el.textContent || "").trim().slice(0, 40);
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowPx: doc.scrollWidth - doc.clientWidth,
      minFontPx: Number.isFinite(minFont) ? Math.round(minFont * 10) / 10 : null,
      minFontText,
      minButtonPx: Number.isFinite(minBtn) ? Math.round(minBtn * 10) / 10 : null,
      minButtonText: minBtnText,
      docHeight: doc.scrollHeight,
      appearance: doc.dataset.appearance ?? "",
      deskSize: doc.dataset.deskSize ?? "",
    };
  });
}

const report = {
  base,
  outDir,
  drawing: [],
  real: [],
  sideBySide: [],
  regions: { drawing: {}, real: {}, verdict: [] },
};

/*
  A session cached in the OS temp directory, if an earlier run left one. The
  desk rate-limits `/sign-in/email` to 10 in five minutes (`src/lib/auth/server.ts`),
  and a full run spends one, so without the cache a second run inside the same
  window is refused by the desk's own defence rather than by anything about the
  screen. The cookie is worthless to anything else: the desk it names lives in
  this dev server's memory and nowhere else.
*/
const statePath = resolve(tmpdir(), "cw-shots-session.json");
const cachedState = existsSync(statePath) ? statePath : undefined;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  ...(cachedState ? { storageState: cachedState } : {}),
});
const page = await context.newPage();
const art = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

/** The real screen, at one shape, with the two storage keys set before it paints. */
async function shotReal(path, shape) {
  await page.setViewportSize({ width: shape.width, height: shape.height });
  const resp = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  if (resp && !resp.ok()) throw new Error(`${path} answered ${resp.status()}`);
  await page.waitForTimeout(1800);
  const measured = await measure(page);
  if (measured.appearance !== shape.appearance) {
    throw new Error(
      `${path} at ${shape.width}: asked for data-appearance="${shape.appearance}", page says "${measured.appearance}"`,
    );
  }
  if (shape.deskSize && measured.deskSize !== shape.deskSize) {
    throw new Error(
      `${path} at ${shape.width}: asked for data-desk-size="${shape.deskSize}", page says "${measured.deskSize}"`,
    );
  }
  const style = await page.addStyleTag({ content: PINNED_CHROME_HIDDEN });
  await page.screenshot({ path: shape.file, fullPage: true, animations: "disabled" });
  await style.evaluate((el) => el.remove());
  return measured;
}

/**
 * One side-by-side sheet: the drawing on the left, the real screen on the
 * right, both at their own native width, top-aligned, each labelled with what
 * it is. Nothing is scaled or cropped -- the two panes are the two captures.
 */
async function compose(composer, sheet) {
  const files = new Map([
    ["drawing.png", readFileSync(sheet.drawingFile)],
    ["real.png", readFileSync(sheet.realFile)],
  ]);
  await composer.route("**/cw-cap/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    const body = files.get(name);
    if (!body) return route.fulfill({ status: 404, body: "no" });
    await route.fulfill({ status: 200, contentType: "image/png", body });
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#f4f4f5;font:13px/1.35 system-ui,sans-serif}
    #sheet{display:flex;align-items:flex-start;gap:10px;padding:10px;width:max-content}
    .pane{background:#fff;border:1px solid #d4d4d8;border-radius:6px;overflow:hidden}
    .pane h1{margin:0;padding:8px 10px;font-size:13px;font-weight:600;
             background:#18181b;color:#fff;letter-spacing:.01em}
    .pane img{display:block}
  </style><div id="sheet">
    <div class="pane"><h1>${sheet.drawingLabel}</h1><img src="http://cw-cap.local/cw-cap/drawing.png"></div>
    <div class="pane"><h1>${sheet.realLabel}</h1><img src="http://cw-cap.local/cw-cap/real.png"></div>
  </div>`;
  await composer.setContent(html, { waitUntil: "load" });
  await composer.waitForTimeout(600);
  const size = await composer.evaluate(() => {
    const s = document.getElementById("sheet");
    return { w: Math.ceil(s.getBoundingClientRect().width), h: Math.ceil(s.getBoundingClientRect().height) };
  });
  if (size.h > 20000) throw new Error(`sheet is ${size.h}px tall; refusing`);
  await composer.setViewportSize({ width: Math.min(size.w + 20, 3000), height: Math.min(size.h + 20, 1200) });
  await composer.locator("#sheet").screenshot({ path: sheet.file, animations: "disabled" });
  await composer.unroute("**/cw-cap/**");
  return size;
}

try {
  /* ── the desk ─────────────────────────────────────────────────────────── */
  /*
    Reuse the cached session when the dev server still knows it, and sign in
    only when it does not. Landing anywhere other than `/login` is the desk
    answering, which is a stronger check than the cookie being present.
  */
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  /*
    Which screen answered, asked of the screen and not of the URL: a stale
    cookie from a server whose in-memory desk has since gone still leaves the
    address reading `/desk` for a moment before the redirect lands. Waiting for
    one of the two real controls is the question that has an answer either way.
  */
  const atDesk = async () => {
    const queue = page.getByRole("link", { name: "Queue", exact: true });
    const heading = page.getByRole("heading", { name: /Create the desk|Editor sign-in/ });
    for (let i = 0; i < 40; i += 1) {
      if (await queue.isVisible().catch(() => false)) return "desk";
      if (await heading.isVisible().catch(() => false)) return "login";
      await page.waitForTimeout(500);
    }
    return "unknown";
  };
  if ((await atDesk()) === "desk") {
    console.log(`  ok    reused the cached session${cachedState ? ` at ${statePath}` : ""}`);
  } else {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({
      timeout: 45_000,
    });
    const createAccount = page.getByRole("button", { name: "Create editor account" });
    if (await createAccount.count()) {
      await page.getByLabel("Name").fill("CW Story Owner");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await createAccount.click();
      await page.waitForTimeout(5000);
      await completeFirstRunSetup(page, base);
      console.log("  ok    the first account owns the desk");
    } else {
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in with email" }).click();
      /* Loud: a sign-in that silently did not take would file 12 captures of the
         login page under the story screen's name. */
      await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
      console.log("  ok    signed in to an existing desk");
    }
    await page.context().storageState({ path: statePath });
  }
  /*
    First run: a claimed desk publishes nothing until `/desk/setup` is done.
    Asked of the setup page's own field rather than of any wording on `/desk` --
    the rail's "Queue" link renders on every `/desk*` route including the setup
    wizard, so it proves nothing about which of the two answered.
  */
  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  const setupWanted = await page
    .getByLabel("Paper name", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (setupWanted) await completeFirstRunSetup(page, base);

  const seedResp = await page.request.post(`${base}${SEED_PATH}`);
  const seedBody = await seedResp.text();
  if (!seedResp.ok()) {
    throw new Error(`${SEED_PATH} answered ${seedResp.status()}: ${seedBody.slice(0, 400)}`);
  }
  const seed = JSON.parse(seedBody);
  const storyPath = `/desk/story/${seed.leadId}`;
  console.log(`  ok    seeded ${storyPath} (draft ${seed.draftId}): ${JSON.stringify(seed.rows)}`);
  writeFileSync(resolve(outDir, "seed.json"), JSON.stringify(seed, null, 2));

  /* ── the drawing, at each width and theme ─────────────────────────────── */
  for (const { width, height } of WIDTHS) {
    for (const theme of ["light", "dark"]) {
      const tag = `${width}-${theme}`;
      const file = resolve(outDir, "drawing", `drawing-${tag}.png`);
      await art.setViewportSize({ width, height });
      await art.goto(`${DRAWING}?theme=${theme}`, { waitUntil: "load" });
      await art.waitForTimeout(1800);
      await art.screenshot({ path: file, fullPage: true, animations: "disabled" });
      const order = regionOrder(await visibleLines(art));
      report.drawing.push({ tag, width, theme, file, regions: order });
      report.regions.drawing[tag] = order.map((r) => r.key);
      console.log(`  art   drawing-${tag}  regions=${order.map((r) => r.key).join(" > ")}`);
    }
  }

  /* ── the real screen, at every shape ──────────────────────────────────── */
  for (const { width, height } of WIDTHS) {
    for (const mode of MODES) {
      const tag = `${width}-${mode.tag}`;
      await page.setViewportSize({ width, height });
      /* The two keys the head script paints from -- set before the navigation
         that renders the screen, or the capture is of the previous shape. */
      await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([m, s]) => {
          localStorage.setItem("townreporter.desk.mode", m);
          localStorage.setItem("townreporter.desk.textsize", s);
        },
        [mode.mode, mode.size],
      );
      const file = resolve(outDir, "real", `story-${tag}.png`);
      const measured = await shotReal(storyPath, { ...mode, width, height, file });
      const lines = await visibleLines(page);
      const order = regionOrder(lines);
      /* `...mode` carries its own `tag`, so the full one is stated after it. */
      report.real.push({ ...mode, tag, width, file, regions: order, ...measured });
      report.regions.real[tag] = order.map((r) => r.key);
      const body = (await page.locator("body").innerText()).trim();
      if (body.length < 400) throw new Error(`${storyPath} rendered almost nothing at ${tag}`);
      console.log(
        `  real  story-${tag}  overflow=${measured.overflowPx}px  minFont=${measured.minFontPx}px` +
          `  minButton=${measured.minButtonPx}px  ${measured.docHeight}px tall`,
      );
      console.log(`        regions=${order.map((r) => r.key).join(" > ")}`);
    }
  }

  /* ── the same regions in the same order ───────────────────────────────── */
  const drawnAt = (width, theme) => report.regions.drawing[`${width}-${theme}`] ?? [];
  for (const entry of report.real) {
    const expected = drawnAt(entry.width, entry.mode);
    const actual = report.regions.real[entry.tag];
    const missing = expected.filter((k) => !actual.includes(k));
    const position = expected.every(
      (k, i) => i === 0 || actual.indexOf(k) > actual.indexOf(expected[i - 1]),
    );
    const ok = missing.length === 0 && position;
    report.regions.verdict.push({ tag: entry.tag, drawing: expected, real: actual, missing, position, ok });
    if (!ok) {
      throw new Error(
        `${entry.tag}: the real screen does not show the drawing's regions in the drawing's order.` +
          ` drawing=${expected.join(">")} real=${actual.join(">")} missing=${missing.join(",")}`,
      );
    }
  }
  console.log(`  ok    all ${report.regions.verdict.length} shapes show the drawn regions in the drawn order`);

  /* ── side by side ─────────────────────────────────────────────────────── */
  const composer = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (const entry of report.real) {
    const drawingFile = resolve(outDir, "drawing", `drawing-${entry.width}-${entry.mode}.png`);
    const file = resolve(outDir, "side-by-side", `story-${entry.tag}.png`);
    const size = await compose(composer, {
      drawingFile,
      realFile: entry.file,
      drawingLabel: `Drawing — Desk Story.dc.html (${entry.width}px, ${entry.mode})`,
      realLabel: `Real — ${storyPath} (${entry.width}px, ${entry.mode}, ${entry.size} text)`,
      file,
    });
    report.sideBySide.push({ tag: entry.tag, file, ...size });
    console.log(`  pair  story-${entry.tag}  ${size.w}x${size.h}`);
  }
  await composer.close();

  /* ── every button, pressed once ───────────────────────────────────────── */
  /*
    Last, because some of these presses change the desk: the outlet override
    clears a publish blocker, "Confirm the claim" clears the other one, and
    "Kill this lead" retires the lead outright. Re-seeded first, so the pass
    starts from the state the captures were taken in.

    The lead id is re-read from that seed: the fixture wipes and re-inserts, so
    the id moves on every POST, and pressing a screen for a lead that no longer
    exists would have recorded ten chrome buttons and called it the page.
  */
  const pressSeed = JSON.parse(await (await page.request.post(`${base}${SEED_PATH}`)).text());
  const pressLead = pressSeed.leadId;
  const pressPath = `/desk/story/${pressLead}`;
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("townreporter.desk.mode", "light");
    localStorage.setItem("townreporter.desk.textsize", "normal");
  });
  await page.goto(`${base}${pressPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  /* A press that opens a window must not leave it open across the next press. */
  const popups = [];
  page.context().on("page", (p) => {
    popups.push(p);
    p.close().catch(() => {});
  });

  const mutations = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") mutations.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });

  /*
    The story screen's own controls, plus the desk chrome at the end. `main#desk`
    is DeskShell's content column: the rail and the topbar sit outside it, so
    this reads "the page" as the story page rather than the whole application.

    A control is identified by its own words plus which one of that name it is
    (`Save judgment#3`), counted in document order over every control the
    selector matches, shown or not. Identity is deliberately not a marker
    attribute written onto the element: React drops an attribute written from
    outside on the next render of that node, so a marked control looks new
    again and the pass presses it forever -- which is exactly what the first
    draft of this did, 250 times, until the guard stopped it.
  */
  const STORY_SEL = 'main#desk button, main#desk a[role="button"], main#desk .btn';
  const CHROME_SEL = '.astra-topbar button, a.astra-skip';
  const presses = [];

  /*
    Order inside a pass. Four ranks, and why each:
      0  the drawn order -- everything on the screen, top to bottom;
      1  a tab-strip button -- pressing one hides the panel whose controls have
         not been pressed yet, so a tab is opened only after the screen above it
         is done, and then the panel it opened is pressed in its turn;
      2  "Check draft against evidence" -- pressed after everything else that is
         not terminal, because pressing it puts the desk into its running state
         and that state disables the two presses beside it in the drawn action
         row (`waiting || reconcileActive`, `desk.story.$leadId.tsx:2824` for
         "+ Add to story", `:2843` for "Redraft…"). Deferring this one press is
         what lets those two be pressed while the desk is settled, so their row
         records what they do rather than a refusal this press caused;
      3  a control that ends the screen it sits on ("Kill this lead" retires the
         lead; "Sign out" ends the session) -- pressed last of all, so every
         press before it was made against the screen the seed created.
  */
  const CHECKS_THE_DRAFT = /^(check draft against evidence|checking evidence…)$/i;
  const ENDS_THE_SCREEN = /^(kill this lead|delete\b|remove\b|sign out)/i;

  async function nextTarget(sel, done) {
    return page.evaluate(
      ([selector, handled, endRe, checkRe]) => {
        const ends = new RegExp(endRe, "i");
        const checking = new RegExp(checkRe, "i");
        const seen = new Set(handled);
        const all = [...document.querySelectorAll(selector)];
        const show = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && st.display !== "none" && st.visibility !== "hidden";
        };
        const counts = new Map();
        let pick = null;
        let pickRank = 4;
        let pickIndex = -1;
        let pickId = "";
        for (let i = 0; i < all.length; i += 1) {
          const el = all[i];
          /*
            A control's identity is its own words. An icon-only press has none,
            so it is named by what it is (`button.astra-icon-theme`) rather
            than by "(no text)", which would leave two rows of the table
            pointing at nothing.
          */
          const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2);
          const label = (
            el.innerText ||
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            `${el.tagName.toLowerCase()}${cls.length ? `.${cls.join(".")}` : ""}`
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 70);
          const n = (counts.get(label) ?? 0) + 1;
          counts.set(label, n);
          const id = `${label}#${n}`;
          if (seen.has(id)) continue;
          if (!show(el)) continue;
          const rank = ends.test(label)
            ? 3
            : checking.test(label)
              ? 2
              : el.closest('[role="tablist"]')
                ? 1
                : 0;
          if (rank < pickRank) {
            pickRank = rank;
            pick = el;
            pickIndex = i;
            pickId = id;
          }
        }
        if (!pick) return null;
        return {
          id: pickId,
          index: pickIndex,
          label: pickId.slice(0, pickId.lastIndexOf("#")),
          disabled: pick.disabled === true || pick.getAttribute("aria-disabled") === "true",
        };
      },
      [sel, [...done], ENDS_THE_SCREEN.source, CHECKS_THE_DRAFT.source],
    );
  }

  async function pressPass(sel, passName) {
    const done = new Set();
    let pressed = 0;
    /*
      Every press may reveal controls (a tab, a dialog) and every control gets
      one press, so the bound has to be generous; it is a bound on runaway
      growth, not the expected length -- the pass ends when nothing is left.
    */
    for (let guard = 0; guard < 600; guard += 1) {
      const target = await nextTarget(sel, done);
      if (!target) break;
      done.add(target.id);
      const row = { pass: passName, id: target.id, label: target.label };
      if (target.disabled) {
        presses.push({ ...row, state: "off", result: "the desk refuses it here — nothing sent" });
        continue;
      }
      /*
        Addressed by its position in the current list, read in the same pass
        that chose it: nothing has been pressed in between, so nothing has
        moved. The index is not carried across presses, where it would not
        survive a panel opening.
      */
      const loc = page.locator(sel).nth(target.index);
      const beforeUrl = page.url();
      const beforeBody = (await page.locator("body").innerText()).length;
      const beforeMutations = mutations.length;
      let result = "";
      /*
        A press that Playwright will not make -- a skip link that is only on
        screen once focused, a control an overlay covers -- is made with
        `force` instead of being dropped, so the row records what the control
        does rather than a timeout; the row says it had to be forced.
      */
      let forced = false;
      try {
        await loc.click({ timeout: 8000 });
      } catch {
        forced = true;
        try {
          await loc.click({ force: true, timeout: 4000 });
        } catch (err) {
          presses.push({
            ...row,
            state: "pressed",
            result: `could not be pressed at all: ${
              err instanceof Error ? err.message.split("\n")[0] : String(err)
            }`,
          });
          continue;
        }
      }
      try {
        await page.waitForTimeout(1100);
        const afterUrl = page.url();
        const dialog = await page
          .locator('[role="dialog"], dialog[open], .astra-confirm')
          .first()
          .isVisible()
          .catch(() => false);
        const afterBody = (await page.locator("body").innerText()).length;
        const fired = mutations.slice(beforeMutations);
        const bits = [];
        if (afterUrl !== beforeUrl) bits.push(`went to ${new URL(afterUrl).pathname}`);
        if (dialog) bits.push("opened a confirm");
        if (popups.length) bits.push(`opened a window (${popups.length})`);
        if (fired.length) bits.push(`sent ${[...new Set(fired)].join(", ")}`);
        if (!bits.length && afterBody !== beforeBody) {
          bits.push(
            `page text ${afterBody > beforeBody ? "grew" : "shrank"} by ` +
              `${Math.abs(afterBody - beforeBody)} chars`,
          );
        }
        if (!bits.length) bits.push("no visible change");
        if (forced) bits.push("had to be forced");
        result = bits.join("; ");
        if (dialog) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
        }
      } catch (err) {
        result = `click failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
      }
      presses.push({ ...row, state: "pressed", result });
      pressed += 1;
      if (page.url() !== beforeUrl) {
        await page.goto(`${base}${pressPath}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
      }
    }
    const off = presses.filter((r) => r.pass === passName && r.state === "off").length;
    console.log(
      `  press ${passName}: ${pressed} pressed` + (off ? `, ${off} off and left off` : ""),
    );
  }

  await pressPass(STORY_SEL, "story page");
  await pressPass(CHROME_SEL, "desk chrome");

  report.presses = presses;
  writeFileSync(resolve(outDir, "buttons.json"), JSON.stringify(presses, null, 2));
  const cell = (s) => String(s).replace(/\|/g, "/");
  const table = presses.map(
    (r, i) => `| ${i + 1} | ${cell(r.label)} | ${r.pass} | ${r.state} | ${cell(r.result)} |`,
  );
  writeFileSync(
    resolve(outDir, "buttons.md"),
    [
      `# Every press on the seeded story screen (${pressPath})`,
      "",
      "Read from the rendered page at 1440 wide, light, Standard desk text, on a",
      `fresh seed (lead ${pressLead}, draft ${pressSeed.draftId}). Every control`,
      "that is on the rendered screen is pressed once. The order is document",
      "order with three deliberate exceptions: a tab strip is pressed only after",
      "the screen above it is done, which is what opens the panel under it, so the",
      "panel's own controls are pressed in their turn rather than recorded unseen;",
      "\"Check draft against evidence\" is held back until everything else but",
      "\"Kill this lead\" has been pressed, because pressing it puts the desk into",
      "its running state and that state disables the two presses beside it in the",
      "action row; and \"Kill this lead\", which retires the lead, is last of all.",
      "A press that turns a confirm on is answered with Escape so the next press",
      "is a real one. A control the desk refuses is recorded as `off` and not",
      "forced — the reason it is off is the finding. `buttons.json` also carries",
      "each control's identity (its words plus which of that name it is). The",
      "desk chrome is the last pass.",
      "",
      "| # | press | where | state | what happened |",
      "| --- | --- | --- | --- | --- |",
      ...table,
      "",
    ].join("\n"),
  );
  const counts = presses.reduce((acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }), {});
  console.log(`  press ${presses.length} controls: ${JSON.stringify(counts)}`);
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err), text: text.slice(0, 1200) },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();
writeFileSync(resolve(outDir, "measurements.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ok: true,
      outDir,
      drawing: report.drawing.length,
      real: report.real.length,
      sideBySide: report.sideBySide.length,
      presses: report.presses.length,
    },
    null,
    2,
  ),
);
