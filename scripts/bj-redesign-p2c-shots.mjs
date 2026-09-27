#!/usr/bin/env node
/**
 * Captures for the BJ redesign pass over the five restyled desk screens plus
 * Server (0.6.64).
 *
 * Measurement-light on purpose: it renders each screen at the three shapes the
 * brief asks for (1280 light, 1280 dark, 390 light), keeps the PNGs, and
 * prints the three numbers the brief sets a floor on -- horizontal overflow,
 * smallest computed font size, smallest button height. Those three are read
 * from the live DOM rather than inferred from the stylesheets, because the
 * question is what an editor gets, not what the CSS says.
 *
 *   BJ_SHOTS_BASE_URL=http://127.0.0.1:8090 \
 *   BJ_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/evidence/BJ \
 *   node scripts/bj-redesign-p2c-shots.mjs
 *
 * The server is started and stopped by whoever runs this (see the brief: bind
 * 8090, stop by PID). This file only visits.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * 8090 is the port PROJECT-BRIEF.md reserves for this work. The walk files
 * under scripts/ declare 3xxx ports checked for uniqueness by
 * scripts/integration-ports-are-unique.test.mjs; this file is named
 * `-shots.mjs`, so that scan -- which reads `-e2e.mjs` and `-walk.mjs` -- does
 * not collect it, and 8090 is free in either case.
 */
const PORT_BJ_SHOTS = 8090;

const base = checkedUrl(
  process.env.BJ_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_BJ_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.BJ_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/evidence/BJ",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const screens = [
  { slug: "opinion", path: "/desk/opinion", name: "Opinion" },
  { slug: "dark", path: "/desk/dark", name: "Dark Desk" },
  { slug: "sources", path: "/desk/sources", name: "Sources" },
  { slug: "scan", path: "/desk/scan", name: "Scan" },
  { slug: "published", path: "/desk/published", name: "Published" },
  { slug: "ops", path: "/desk/ops", name: "Server" },
];

const shapes = [
  { tag: "1280-light", width: 1280, height: 900, dark: false },
  { tag: "1280-dark", width: 1280, height: 900, dark: true },
  { tag: "390-light", width: 390, height: 844, dark: false },
];

/*
  A fixed address, not a timestamped one. The server this runs against is a
  built one with PGlite in memory, so the desk survives only as long as that
  process -- and a walk that re-runs against a server already holding an owner
  has to sign in to it rather than try to create the first account again.
  Deterministic here, so both branches below are reachable.
*/
const email = process.env.BJ_SHOTS_EMAIL || "bj-redesign-shots@townreporter.test";
const password = process.env.BJ_SHOTS_PASSWORD || "bj-redesign-shots-pass";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/**
 * The desk's pinned chrome, hidden for the duration of a full-page capture.
 *
 * A full-page shot reaches past the viewport, and `position: sticky` /
 * `position: fixed` elements paint at whatever offset the capture reached
 * from -- the topbar lands across the middle of the image. Same repair, and
 * same reason, as scripts/sections-sources-ux-shots.mjs.
 */
const PINNED_CHROME_HIDDEN = ".astra-topbar,.astra-skip{visibility:hidden !important}";

/**
 * The three floors the brief names, measured on the rendered page.
 *
 * Overflow is `documentElement.scrollWidth` against `clientWidth`, so a single
 * wide child anywhere in the tree shows up. The font floor reads computed
 * `font-size` on every element that actually has visible text of its own (a
 * wrapper with no direct text can be 0px and mean nothing). The button floor
 * reads every visible `button, .btn, a[role="button"]`.
 */
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
    };
  });
}

const report = { base, outDir, shots: [], measurements: [] };

async function shot(screen, shape) {
  const name = `${screen.slug}-${shape.tag}`;
  await page.setViewportSize({ width: shape.width, height: shape.height });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  const style = await page.addStyleTag({ content: PINNED_CHROME_HIDDEN });
  const file = resolve(outDir, `${name}.png`);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full <= shape.height + 40) {
    // Short enough to fit: a viewport shot is the honest one, and it keeps the
    // image the same shape as the design captures it is read against.
    await page.screenshot({ path: file, animations: "disabled" });
  } else {
    await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  }
  await style.evaluate((el) => el.remove());
  const measured = await measure(page);
  report.shots.push(file);
  report.measurements.push({ screen: screen.slug, shape: shape.tag, file, ...measured });
  console.log(
    `  shot  ${name}  overflow=${measured.overflowPx}px  minFont=${measured.minFontPx}px` +
      `  minButton=${measured.minButtonPx}px`,
  );
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({
    timeout: 45_000,
  });
  const createAccount = page.getByRole("button", { name: "Create editor account" });
  if (await createAccount.count()) {
    await page.getByLabel("Name").fill("BJ Redesign Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await createAccount.click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 60_000 });
    await completeFirstRunSetup(page, base);
    console.log("  ok    the first account owns the desk");
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 60_000 });
    console.log("  ok    signed in to an existing desk");
  }

  for (const screen of screens) {
    for (const shape of shapes) {
      // The desk's dark mode is a storage key the head script paints from, so
      // it has to be set before the navigation that renders the screen.
      await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        (mode) => localStorage.setItem("townreporter.desk.mode", mode),
        shape.dark ? "dark" : "light",
      );
      const resp = await page.goto(`${base}${screen.path}`, { waitUntil: "domcontentloaded" });
      if (resp && !resp.ok()) throw new Error(`${screen.path} answered ${resp.status()}`);
      await page.waitForTimeout(900);
      await shot(screen, shape);
      const body = await page.locator("body").innerText();
      if (body.trim().length < 40) {
        throw new Error(`${screen.path} rendered almost nothing: ${JSON.stringify(body.slice(0, 200))}`);
      }
    }
  }
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err), text: text.slice(0, 1500) },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();
writeFileSync(resolve(outDir, "measurements.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, outDir, measurements: report.measurements }, null, 2));
