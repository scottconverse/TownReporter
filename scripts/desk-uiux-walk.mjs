#!/usr/bin/env node
/**
 * The desk UI/UX walk (item 5 of 0.6.61).
 *
 * Measures what an editor actually encounters rather than inspecting CSS. For each
 * desk surface it records the smallest computed font size, how many interactive
 * controls exist and how many carry an accessible name, whether the surface names
 * itself in a level-1 heading, and how many navigation links are reachable.
 *
 * It changes nothing. It is a measurement, so the UI pass starts from facts.
 *
 *   UIWALK_BASE_URL=http://127.0.0.1:3491 node scripts/desk-uiux-walk.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.UIWALK_BASE_URL || "http://127.0.0.1:3491").replace(/\/$/, "");
const email = process.env.UIWALK_EMAIL || "staging@townreporter.test";
const password = process.env.UIWALK_PASSWORD || "staging-walk-2026";
const outDir = resolve(process.env.UIWALK_ARTIFACT_DIR || "../desk-uiux-walk");
mkdirSync(outDir, { recursive: true });

const SURFACES = [
  { path: "/desk", name: "Desk" },
  { path: "/desk/queue", name: "Queue" },
  { path: "/desk/scan", name: "Scan" },
  { path: "/desk/sources", name: "Sources" },
  { path: "/desk/published", name: "Published" },
  { path: "/desk/opinion", name: "Opinion" },
  { path: "/desk/dark", name: "Dark Desk" },
  { path: "/desk/ops", name: "Server" },
  { path: "/desk/stats", name: "Stats" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password", { exact: true }).fill(password);
await page.getByRole("button", { name: "Sign in with email" }).click();
await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

const NAV_SELECTOR = 'nav a, aside a, [aria-label*="navigation"] a';

const report = [];
for (const surface of SURFACES) {
  const resp = await page.goto(base + surface.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(700);
  const measured = await page.evaluate((navSelector) => {
    const all = [...document.querySelectorAll("body *")];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    });
    let minPx = Infinity, minSel = "";
    for (const el of visible) {
      if (!el.textContent || !el.textContent.trim()) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px && px < minPx) {
        minPx = px;
        minSel = el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "");
      }
    }
    const controls = [...document.querySelectorAll("a[href], button, input, select, textarea")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const named = controls.filter((el) => {
      const t = (el.textContent || "").trim();
      return t.length > 0 || el.getAttribute("aria-label") || el.getAttribute("title") || (el.labels && el.labels.length > 0);
    });
    return {
      minPx: Number.isFinite(minPx) ? minPx : null,
      minSel,
      controls: controls.length,
      unnamed: controls.length - named.length,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      navLinks: document.querySelectorAll(navSelector).length,
    };
  }, NAV_SELECTOR);
  const file = surface.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() + ".png";
  await page.screenshot({ path: join(outDir, file), fullPage: true });
  report.push({ surface: surface.name, path: surface.path, status: resp?.status() ?? null, ...measured });
  const line = "  " + surface.name.padEnd(11) + String(resp?.status()).padEnd(5) +
    "min " + String(measured.minPx).padEnd(6) + "px  controls " + String(measured.controls).padEnd(5) +
    "unnamed " + String(measured.unnamed).padEnd(5) + "h1 " + (measured.h1 ? JSON.stringify(measured.h1.slice(0, 44)) : "NONE");
  console.log(line);
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log("  report: " + join(outDir, "report.json"));
process.exit(0);
