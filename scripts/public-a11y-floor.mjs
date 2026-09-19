#!/usr/bin/env node
/**
 * Public-route 14px accessibility floor, verified in a real browser.
 *
 * The product's rule is "Nothing informational under 14px." The desk enforces
 * that by remapping `.text-xs` / `.text-[11px]` / `.text-[12px]` to 14px --
 * but the remap was scoped to `.desk-ltr` only, so public routes kept the raw
 * 11px/12px utilities. A static grep cannot prove what a browser actually
 * computes (specificity, order, and cascade all matter), so this test loads
 * each public route in Chromium and reads `getComputedStyle(...).fontSize`.
 *
 * Fails when any *informational* text is below 14px. Decorative / non-text
 * nodes are ignored; the check targets elements that render visible text.
 *
 *   PUBLIC_A11Y_BASE_URL=http://127.0.0.1:3200 node scripts/public-a11y-floor.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(
  process.env.PUBLIC_A11Y_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const FLOOR_PX = 14;
// Routes with informational text. The article + error routes need ids resolved
// at runtime; the caller supplies them or they are discovered from the page.
const routes = [
  ["/", "home"],
  ["/login", "login"],
  ["/about", "about"],
  ["/corrections", "corrections"],
  ["/definitely-not-a-real-route-a11y", "error"],
  ["/get-the-code", "get-the-code"],
  ["/evidence/2251", "evidence"],
];
const extra = process.env.PUBLIC_A11Y_ARTICLE_PATH;
if (extra) routes.push([extra, "article"]);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const violations = [];
const perRoute = [];

for (const [path, name] of routes) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);
  const found = await page.evaluate((floor) => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || "").trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const px = parseFloat(style.fontSize);
      if (!Number.isFinite(px)) continue;
      if (px < floor) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 80)) || "",
          px,
          sample: text.slice(0, 60),
        });
      }
    }
    return out;
  }, FLOOR_PX);
  perRoute.push({ route: path, name, violations: found.length });
  for (const v of found) violations.push({ route: path, ...v });
}

await browser.close();

if (violations.length) {
  console.error(JSON.stringify({
    ok: false,
    floorPx: FLOOR_PX,
    perRoute,
    violations: violations.slice(0, 40),
    totalViolations: violations.length,
  }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, floorPx: FLOOR_PX, perRoute }, null, 2));