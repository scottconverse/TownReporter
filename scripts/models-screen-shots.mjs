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
 *   2. Console errors. A screen that renders and logs an error is not a screen
 *      that works, and a screenshot cannot show the difference.
 *
 * What it does NOT do: press any Test button, or any button that would send
 * anything to a model. The per-card Test is the editor's explicit act, and this
 * walk is not the editor. Nothing here loads a model either.
 *
 *   MODELS_SHOTS_BASE_URL=http://127.0.0.1:8097 \
 *   MODELS_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/evidence/BG \
 *   node scripts/models-screen-shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** A port of its own, in the 8090+ range the unit was told to use. */
const PORT_MODELS_SHOTS = 8097;

const base = checkedUrl(
  process.env.MODELS_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_MODELS_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(process.env.MODELS_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/evidence/BG"),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

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

async function shot(name) {
  const file = resolve(outDir, `${name}.png`);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, animations: "disabled" });
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
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
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
  await shot("models-assign-1280-dark");
  await page.screenshot({
    path: resolve(outDir, "models-assign-1280-dark-full.png"),
    fullPage: true,
    animations: "disabled",
  });
  shots.push(resolve(outDir, "models-assign-1280-dark-full.png"));

  console.log("  ok    dark is chosen through the desk's own toggle and survives");
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
const result = {
  ok: consoleErrors.length === 0 && tooSmall.length === 0,
  outDir,
  shots,
  measurements,
  consoleErrorCount: consoleErrors.length,
  consoleErrors: consoleErrors.slice(0, 20),
};
writeFileSync(resolve(outDir, "models-screen-measurements.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
