#!/usr/bin/env node
/**
 * Unit CQ: measure the /desk/dark screen in both desk themes (0.6.81).
 *
 * The question this file exists to answer is narrow and mechanical: which
 * regions of /desk/dark paint the same colors whether the desk is in light
 * mode or dark mode? A region that ignores the light theme shows identical
 * computed `color` / effective background in both passes, so the measurement
 * is the diff between two passes over the same DOM -- not an inspection of the
 * stylesheets, which is what the brief's step 1 asks for ("list every region
 * that ignores the light theme").
 *
 * Seeding follows scripts/bj-redesign-p2c-shots.mjs, the existing dark-desk
 * capture walk: it posts to the dev-only `/api/dev-seed` route (copied into
 * `src/routes/api/dev-seed.ts` from `scripts/dev-seed-route.ts`) and, for the
 * dark desk, clicks the first rail row so the open file is on screen -- which
 * is the state the drawing is of. The theme is set the same way that walk sets
 * it: `localStorage["townreporter.desk.mode"]` before the navigation that
 * renders the screen, because the pre-paint head script paints from that key.
 *
 *   CQ_SHOTS_BASE_URL=http://127.0.0.1:8093 \
 *   CQ_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/reports/CQ-evidence \
 *   node scripts/cq-dark-desk-shots.mjs
 *
 * The server is started and stopped by whoever runs this. This file only
 * visits. It is named `-shots.mjs` on purpose: that keeps it out of
 * scripts/integration-ports-are-unique.test.mjs's 3xxx port scan, like the BJ
 * shots file, because it binds no port of its own.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const PORT_CQ_SHOTS = 8093;

const base = checkedUrl(
  process.env.CQ_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_CQ_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(process.env.CQ_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/reports/CQ-evidence"),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const SEED_PATH = "/api/dev-seed";
const email = process.env.CQ_SHOTS_EMAIL || "cq-dark-desk@townreporter.test";
const password = process.env.CQ_SHOTS_PASSWORD || "cq-dark-desk-pass";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/**
 * The desk's pinned chrome, hidden for a full-page capture -- same repair, same
 * reason, as scripts/bj-redesign-p2c-shots.mjs: `position: sticky` paints at
 * whatever offset the capture reached from.
 */
const PINNED_CHROME_HIDDEN = ".astra-topbar,.astra-skip{visibility:hidden !important}";

/**
 * Every visible element in the page, with the color it paints and the color
 * behind it.
 *
 * `effectiveBg` walks ancestors until it finds one that is not transparent, so
 * a `<span>` with no background of its own is measured against what is
 * actually behind it rather than against `rgba(0, 0, 0, 0)`.
 *
 * The key is a path built from the element's own classes -- stable across the
 * two passes because the two passes render the same tree, which is exactly
 * what makes the diff meaningful.
 */
async function survey(p) {
  return p.evaluate(() => {
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
    const pathOf = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 3) {
        const cls = (node.getAttribute("class") || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join(".");
        parts.unshift(node.tagName.toLowerCase() + (cls ? "." + cls : ""));
        node = node.parentElement;
      }
      return parts.join(" > ");
    };
    const effectiveBg = (el) => {
      let node = el;
      while (node && node.nodeType === 1) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !/^rgba?\(0, 0, 0, 0\)$/.test(bg) && !/^transparent$/.test(bg)) return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    const rows = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      let own = "";
      for (const node of el.childNodes) if (node.nodeType === 3) own += node.nodeValue ?? "";
      rows.push({
        path: pathOf(el),
        tag: el.tagName.toLowerCase(),
        cls: el.getAttribute("class") || "",
        text: own.trim().slice(0, 70),
        color: s.color,
        bg: effectiveBg(el),
        fontPx: Math.round(parseFloat(s.fontSize) * 10) / 10,
        fontWeight: s.fontWeight,
      });
    }
    return {
      appearance: document.documentElement.dataset.appearance ?? "",
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      rows,
    };
  });
}

const report = { base, outDir, shots: [], themes: {} };

async function capture(theme, tag) {
  /*
    The desk's mode is a storage key the pre-paint head script reads, so it has
    to be written before the navigation that renders the screen -- otherwise
    the capture is the previous theme's paint (the BJ2 finding, and the reason
    that walk asserts `data-appearance` rather than trusting the file name).
  */
  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (mode) => localStorage.setItem("townreporter.desk.mode", mode),
    theme,
  );
  const resp = await page.goto(`${base}/desk/dark`, { waitUntil: "domcontentloaded" });
  if (resp && !resp.ok()) throw new Error(`/desk/dark answered ${resp.status()}`);
  await page.waitForTimeout(1200);
  const row = page.locator(".astra-piles .astra-file-open").first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1200);
  }
  const style = await page.addStyleTag({ content: PINNED_CHROME_HIDDEN });
  const expected = theme === "dark" ? "desk-dark" : "light";
  const state = await survey(page);
  if (state.appearance !== expected) {
    throw new Error(
      `${tag}: asked for data-appearance="${expected}", page says "${state.appearance}"`,
    );
  }
  report.themes[tag] = state;
  const file = resolve(outDir, `dark-desk-${tag}.png`);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full <= 940) {
    await page.screenshot({ path: file, animations: "disabled" });
  } else {
    await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  }
  await style.evaluate((el) => el.remove());
  report.shots.push(file);
  const minFont = Math.min(...state.rows.map((r) => r.fontPx));
  console.log(
    `  shot  dark-desk-${tag}  html=${state.htmlBg}  body=${state.bodyBg}` +
      `  minFont=${minFont}px  rows=${state.rows.length}`,
  );
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({
    timeout: 60_000,
  });
  const createAccount = page.getByRole("button", { name: "Create editor account" });
  if (await createAccount.count()) {
    await page.getByLabel("Name").fill("CQ Dark Desk Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await createAccount.click();
    await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 60_000 });
    await completeFirstRunSetup(page, base);
    console.log("  ok    the first account owns the desk");
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 60_000 });
    console.log("  ok    signed in to an existing desk");
  }

  const seedResp = await page.request.post(`${base}${SEED_PATH}`);
  const seedBody = await seedResp.text();
  if (!seedResp.ok()) {
    throw new Error(`${SEED_PATH} answered ${seedResp.status()}: ${seedBody.slice(0, 400)}`);
  }
  console.log(`  ok    seeded the dev desk: ${seedBody.trim().slice(0, 200)}`);

  await capture("light", "light");
  await capture("dark", "dark");
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: text.slice(0, 1500),
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();
writeFileSync(resolve(outDir, "survey.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, outDir, shots: report.shots }, null, 2));
