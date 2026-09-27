#!/usr/bin/env node
/**
 * Screenshots and measurements for the Models screen (unit BG, redesign phase 5).
 *
 * It walks the owner's path -- create the desk, open /desk/models, look at both
 * tabs in both appearances -- and it MEASURES two things the brief asks for
 * rather than eyeballing them off a PNG:
 *
 *   1. The smallest rendered font size on the screen. Nothing under 14px is
 *      allowed on a desk surface; the check reads `getComputedStyle` on every
 *      element that has text of its own, in both appearances.
 *   2. Whether any `<select>` truncates the option it is showing -- and whether
 *      it could truncate ANY option it offers. A native `<select>` does not
 *      scroll and does not wrap: `scrollWidth` is clamped to `clientWidth` by
 *      the browser, so the literal comparison the brief asks for is true by
 *      construction and measures nothing. The probe therefore measures each
 *      option's text with the select's own computed font (a canvas
 *      `measureText`) and compares it against the width the browser actually
 *      paints in. That width is not the content box: measured on this build by
 *      cloning a control into the live page at fourteen widths with and without
 *      `appearance` and finding the rightmost column of ink, the dropdown arrow
 *      Chromium draws inside the control costs 15px of the row, so the paint
 *      stops at `clientWidth - padding - border - 15`. Both the shown option and
 *      the longest option are checked against that, with the literal
 *      `scrollWidth <= clientWidth` reported beside them, so the stronger claim
 *      and the weaker one are both on the record.
 *   3. Console errors. A screen that renders and logs an error is not a screen
 *      that works, and a screenshot cannot show the difference.
 *
 * It also writes `models-side-by-side.png`: the design's own capture of each
 * tab above this build's, so the differences are visible without opening four
 * files. That image is evidence, not a check -- nothing fails on it.
 *
 * What it does NOT do: press any Test button, or any button that would send
 * anything to a model. The per-card Test is the editor's explicit act, and this
 * walk is not the editor. Nothing here loads a model either.
 *
 *   MODELS_SHOTS_BASE_URL=http://127.0.0.1:8097 \
 *   MODELS_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/evidence/BG2 \
 *   node scripts/models-screen-shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** A port of its own, in the 8090+ range the unit was told to use. */
const PORT_MODELS_SHOTS = 8097;

const base = checkedUrl(
  process.env.MODELS_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_MODELS_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(process.env.MODELS_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/evidence/BG2"),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

/** The design's own captures, for the side-by-side. Read, never written. */
const designDir = resolve(
  process.env.MODELS_SHOTS_DESIGN_DIR || "docs/design/handoff-2026-09-26/screen-captures",
);

/**
 * One fixed owner, not a per-run one.
 *
 * The dev server's PGLite database lives in the server process, so a second run
 * against the same server finds a desk that already has an editor and cannot
 * create another. A walk that only knows how to sign up would fail on its own
 * leftovers. So the credentials are fixed and the login step does whichever of
 * the two the desk needs.
 */
const email = "models-shots@townreporter.test";
const password = "models-shots-pass";

const consoleErrors = [];
const measurements = [];
const selectRows = [];
const shots = [];

/**
 * Every element on the page that paints text of its own, and what size it
 * paints it at. `document.createTreeWalker` over text nodes and then the
 * parent, so an element counted here is one whose own text is what is on
 * screen -- not a container whose children happen to be small.
 */
const MIN_FONT_PROBE = `(() => {
  const seen = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
    const key = size + '|' + el.tagName + '|' + el.className;
    if (seen.has(key)) continue;
    seen.set(key, {
      px: size,
      tag: el.tagName.toLowerCase(),
      className: String(el.className || '').slice(0, 80),
      sample: text.slice(0, 40),
    });
  }
  return [...seen.values()].sort((a, b) => a.px - b.px);
})()`;

async function measure(label) {
  const rows = await page.evaluate(MIN_FONT_PROBE);
  const min = rows.length ? rows[0].px : null;
  const under = rows.filter((row) => row.px < 14);
  measurements.push({ label, min, underCount: under.length, under: under.slice(0, 10) });
  console.log(`  size  ${label}: smallest ${min}px, ${under.length} under 14px`);
  return under;
}

/**
 * The width a native `<select>` actually paints its option's text in.
 *
 * Not the content box: Chromium draws its dropdown arrow inside the control and
 * keeps this much of the row back from the text. Measured on this build -- the
 * clone-at-fourteen-widths probe described in the header -- at 15px/700 with
 * the model row's own padding: a select whose shown option is 166.7px wide
 * paints the whole word at a 200px border box and loses its last 9px at 195px.
 */
const SELECT_ARROW_RESERVE = 15;

/**
 * Every visible `<select>` on the screen: the option it is showing, how wide
 * that option's text actually is at the select's own font, and the width it has
 * to paint in. See the header for why the text is measured rather than read off
 * `scrollWidth`.
 *
 * The canvas font shorthand is assembled from the computed longhands rather
 * than `style.font`, which is empty in Chromium for an element that inherits
 * its font-family.
 *
 * `longest` is the longest option BY PAINTED WIDTH, not by character count:
 * "gpt-oss 120B · Ollama" is longer than "Claude Sonnet · sign-in" and narrower.
 */
const SELECT_PROBE = `(() => {
  const out = [];
  const ctx = document.createElement('canvas').getContext('2d');
  const reserve = ${SELECT_ARROW_RESERVE};
  for (const el of document.querySelectorAll('select')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const shown = el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
    ctx.font = style.fontStyle + ' ' + style.fontVariant + ' ' + style.fontWeight + ' ' +
      style.fontSize + ' ' + style.fontFamily;
    let longest = '';
    let longestTextWidth = -1;
    for (const option of el.options) {
      const width = ctx.measureText(option.text).width;
      if (width > longestTextWidth) {
        longest = option.text;
        longestTextWidth = width;
      }
    }
    const left = parseFloat(style.paddingLeft) || 0;
    const right = parseFloat(style.paddingRight) || 0;
    const border = parseFloat(style.borderLeftWidth) || 0;
    const round = (n) => Math.round(n * 10) / 10;
    const paintWidth = round(el.clientWidth - left - right - reserve);
    out.push({
      label: el.getAttribute('aria-label') || el.id || el.name || el.className.slice(0, 40),
      shown,
      shownTextWidth: round(ctx.measureText(shown).width),
      longest,
      longestTextWidth: round(longestTextWidth),
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      paddingLeft: left,
      paddingRight: right,
      borderWidth: border,
      contentWidth: round(el.clientWidth - left - right),
      paintWidth,
      /* What the box would need, border box, to paint the longest option whole. */
      neededWidth: round(longestTextWidth + left + right + 2 * border + reserve),
      fontSize: style.fontSize,
    });
  }
  return out;
})()`;

async function measureSelects(label) {
  const rows = (await page.evaluate(SELECT_PROBE)).map((row) => ({ tab: label, ...row }));
  /*
    Truncation is the shown option's text over the width the browser paints in,
    with a tenth of a pixel of slack for the rounding in the canvas measurement.
    `longestOver` is the same test against the widest option the control OFFERS,
    so a select that happens to be showing "None" is still checked for whether
    picking a model would clip. The literal `scrollWidth <= clientWidth` is
    recorded beside them and is expected to hold always -- that is the point of
    measuring the text instead.
  */
  const clipped = rows.filter((row) => row.shownTextWidth > row.paintWidth + 0.1);
  const longestOver = rows.filter((row) => row.longestTextWidth > row.paintWidth + 0.1);
  const clamped = rows.filter((row) => row.scrollWidth > row.clientWidth);
  selectRows.push(...rows);
  console.log(
    `  sel   ${label}: ${rows.length} selects, ${clipped.length} truncating the shown option, ` +
      `${longestOver.length} too narrow for their longest option, ` +
      `${clamped.length} with scrollWidth > clientWidth`,
  );
  for (const row of clipped) {
    console.log(`        CLIPPED "${row.shown}" ${row.shownTextWidth}px in ${row.paintWidth}px`);
  }
  for (const row of longestOver) {
    console.log(
      `        NARROW "${row.longest}" needs ${row.neededWidth}px, ${row.label} is ${row.clientWidth + 2 * row.borderWidth}px`,
    );
  }
  return { clipped, longestOver };
}

async function shot(name) {
  const file = resolve(outDir, `${name}.png`);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, animations: "disabled" });
  shots.push(file);
  console.log(`  shot  ${file}`);
}

/**
 * The design's capture of a tab above this build's, one row per tab.
 *
 * Built by laying the four PNGs out in a page and screenshotting that page,
 * because there is no image library here and there does not need to be. Both
 * sides are scaled to the same width, so the comparison is of layout rather
 * than of camera distance. The build's side is the FULL-PAGE shot: the design
 * captures are full pages, and a 900px viewport against a 1255px design would
 * compare two different things.
 */
const SIDE_BY_SIDE = [
  {
    row: "Who does what",
    design: "desk-24-models-assign-light.png",
    built: "models-assign-1280-light-full.png",
  },
  {
    row: "Connections",
    design: "desk-27-models-connections-dark.png",
    built: "models-connections-1280-dark-full.png",
  },
];

function dataUrl(file) {
  const bytes = readFileSync(file);
  const type = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${type};base64,${bytes.toString("base64")}`;
}

async function sideBySide() {
  const file = resolve(outDir, "models-side-by-side.png");
  const rows = SIDE_BY_SIDE.map((row) => {
    const design = resolve(designDir, row.design);
    const built = resolve(outDir, row.built);
    return `<section><h2>${row.row}</h2><div class="pair">
      <figure><figcaption>design · ${row.design}</figcaption><img src="${dataUrl(design)}"></figure>
      <figure><figcaption>built · ${row.built}</figcaption><img src="${dataUrl(built)}"></figure>
    </div></section>`;
  }).join("");
  const page2 = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page2.setContent(
    `<!doctype html><meta charset="utf-8"><style>
      body { margin: 0; padding: 16px; background: #fff; color: #111;
             font: 700 15px/1.4 system-ui, sans-serif; }
      h2 { font-size: 20px; margin: 0 0 8px; }
      section { margin-bottom: 20px; }
      .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      figure { margin: 0; }
      figcaption { font-size: 14px; margin-bottom: 4px; }
      img { display: block; width: 100%; height: auto; border: 1px solid #999; }
    </style>${rows}`,
  );
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: file, fullPage: true });
  await page2.close();
  shots.push(file);
  console.log(`  shot  ${file}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(`console: ${msg.text().slice(0, 300)}`);
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Create the desk|Editor sign-in/ })
    .waitFor({ timeout: 45_000 });
  const fresh = (await page.getByLabel("Name", { exact: true }).count()) > 0;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (fresh) {
    await page.getByLabel("Name").fill("Models Shots Owner");
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: /^Queue/ }).waitFor({ timeout: 45_000 });
  console.log(`  ok    ${fresh ? "the first account owns the desk" : "signed in to the desk"}`);

  // The desk may or may not be set up: on a fresh server it is not, and
  // /desk/setup is where the walk has to go. On a second run it already is, and
  // the form is not there to fill.
  await page.goto(`${base}/desk/setup`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  if (await page.getByLabel("Paper name", { exact: true }).count()) {
    await completeFirstRunSetup(page, base);
    console.log("  ok    the desk has a paper name and a town");
  }

  await page.goto(`${base}/desk/models`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Models", exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole("tab", { name: "Who does what" }).waitFor({ timeout: 45_000 });
  await page.getByText("Story drafting", { exact: true }).waitFor({ timeout: 45_000 });
  console.log("  ok    Who does what is up with all ten jobs");

  // --- light -------------------------------------------------------------
  await measure("assign light");
  await measureSelects("assign light");
  await shot("models-assign-1280-light");
  await page.screenshot({
    path: resolve(outDir, "models-assign-1280-light-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  shots.push(resolve(outDir, "models-assign-1280-light-full.png"));

  await page.getByRole("tab", { name: /^Connections/ }).click();
  await page.getByText("Frontier · API key", { exact: false }).waitFor({ timeout: 45_000 });
  await page.getByText("Subscription sign-ins (OAuth)", { exact: false }).waitFor({ timeout: 45_000 });
  await page.getByText("Local & self-hosted", { exact: false }).waitFor({ timeout: 45_000 });
  await measure("connections light");
  await measureSelects("connections light");
  await shot("models-connections-1280-light");
  await page.screenshot({
    path: resolve(outDir, "models-connections-1280-light-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  shots.push(resolve(outDir, "models-connections-1280-light-full.png"));

  // --- dark, through the desk's own toggle -------------------------------
  await page.getByRole("button", { name: "Switch to dark appearance" }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute("data-appearance") === "desk-dark",
    undefined,
    { timeout: 15_000 },
  );
  const stored = await page.evaluate(() => localStorage.getItem("townreporter.desk.mode"));
  if (stored !== "dark") throw new Error(`the toggle did not persist dark: ${stored}`);
  await measure("connections dark");
  await shot("models-connections-1280-dark");
  await page.screenshot({
    path: resolve(outDir, "models-connections-1280-dark-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  shots.push(resolve(outDir, "models-connections-1280-dark-full.png"));

  await page.getByRole("tab", { name: "Who does what" }).click();
  await page.getByText("Story drafting", { exact: true }).waitFor({ timeout: 45_000 });
  await measure("assign dark");
  await measureSelects("assign dark");
  await shot("models-assign-1280-dark");
  await page.screenshot({
    path: resolve(outDir, "models-assign-1280-dark-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  shots.push(resolve(outDir, "models-assign-1280-dark-full.png"));

  console.log("  ok    dark is chosen through the desk's own toggle and survives");

  await sideBySide();
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: text.slice(0, 1200),
        consoleErrors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();

const tooSmall = measurements.filter((row) => row.underCount > 0);
const clippedSelects = selectRows.filter((row) => row.shownTextWidth > row.paintWidth + 0.1);
const narrowSelects = selectRows.filter((row) => row.longestTextWidth > row.paintWidth + 0.1);
const clampedSelects = selectRows.filter((row) => row.scrollWidth > row.clientWidth);
const result = {
  ok:
    consoleErrors.length === 0 &&
    tooSmall.length === 0 &&
    clippedSelects.length === 0 &&
    narrowSelects.length === 0,
  outDir,
  shots,
  measurements,
  selects: selectRows,
  clippedSelectCount: clippedSelects.length,
  narrowSelectCount: narrowSelects.length,
  clampedSelectCount: clampedSelects.length,
  consoleErrorCount: consoleErrors.length,
  consoleErrors: consoleErrors.slice(0, 20),
};
writeFileSync(resolve(outDir, "models-screen-measurements.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
