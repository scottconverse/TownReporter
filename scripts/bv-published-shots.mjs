#!/usr/bin/env node
/**
 * Captures of /desk/published for unit BV, next to the design it is read
 * against: docs/design/handoff-2026-09-26/screen-captures/desk-19-published-dark.png
 * and desk-20-published-light.png.
 *
 * Four shapes, the two the brief names at the two appearances: a 1000px desk
 * and a 1440px desk, dark and light. "Desk width" is the viewport width -- the
 * number Scott was looking at when he saw the row 800px tall.
 *
 * It measures as well as captures, because the finding is about geometry that a
 * PNG alone makes you guess at: the width the Story track actually got, how tall
 * the row came out, how many lines the headline took, and whether the three acts
 * are on one line. Those come off the live DOM, not the stylesheet.
 *
 *   BV_SHOTS_BASE_URL=http://127.0.0.1:8090 \
 *   BV_SHOTS_OUT_DIR=../townreporter-deepseek-oversight/evidence/BV \
 *   node scripts/bv-published-shots.mjs
 *
 * The server is started and stopped by whoever runs this. This file only visits.
 * It needs the dev-only seed route (`scripts/dev-seed-route.ts`, copied to
 * src/routes/api/dev-seed.ts) or every capture is the empty desk.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/** 8090 is the port PROJECT-BRIEF.md reserves for this work. */
const PORT_BV_SHOTS = 8090;

const base = checkedUrl(
  process.env.BV_SHOTS_BASE_URL || `http://127.0.0.1:${PORT_BV_SHOTS}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(process.env.BV_SHOTS_OUT_DIR || "../townreporter-deepseek-oversight/evidence/BV"),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const SEED_PATH = "/api/dev-seed";

const shapes = [
  { tag: "1000-light", width: 1000, height: 1000, dark: false, appearance: "light" },
  { tag: "1000-dark", width: 1000, height: 1000, dark: true, appearance: "desk-dark" },
  { tag: "1440-light", width: 1440, height: 1088, dark: false, appearance: "light" },
  { tag: "1440-dark", width: 1440, height: 1088, dark: true, appearance: "desk-dark" },
];

const email = process.env.BV_SHOTS_EMAIL || "bv-published-shots@townreporter.test";
const password = process.env.BV_SHOTS_PASSWORD || "bv-published-shots-pass";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });

/**
 * The desk's pinned chrome, hidden for the duration of a full-page capture:
 * `position: sticky/fixed` elements paint at whatever offset the capture
 * reached from. Same repair, and same reason, as the BJ and sections shots.
 */
const PINNED_CHROME_HIDDEN = ".astra-topbar,.astra-skip{visibility:hidden !important}";

/**
 * What the brief is about: the row's shape. Read every visible `.astra-row.pub`
 * on the screen and report, per row, the width the Story cell got, the row's own
 * height, how many lines its headline took, and how many distinct rows of
 * buttons the actions strip laid out on.
 */
async function measureRows(p) {
  return p.evaluate(() => {
    /**
     * How far a cell's own children reach past the cell's right edge. A cell
     * overflowing its track is invisible to document.scrollWidth (the row's
     * grid absorbs it) but it is exactly what puts a chip or a button on top of
     * its neighbour -- which is what the 1000px capture showed.
     */
    const spill = (cell) => {
      if (!cell) return null;
      const right = cell.getBoundingClientRect().right;
      let worst = 0;
      for (const child of cell.children) {
        worst = Math.max(worst, child.getBoundingClientRect().right - right);
      }
      return Math.round(worst);
    };
    const rows = [];
    for (const row of document.querySelectorAll(".astra-row.pub")) {
      const cells = row.querySelectorAll(":scope > .astra-cell");
      const story = cells[1];
      const h = row.querySelector(".pub-h");
      const acts = row.querySelector(".astra-row-acts");
      const heads = h ? parseFloat(getComputedStyle(h).lineHeight) : 0;
      const buttonTops = new Set();
      if (acts) {
        for (const child of acts.children) {
          const r = child.getBoundingClientRect();
          if (r.height > 1) buttonTops.add(Math.round(r.top));
        }
      }
      rows.push({
        headline: (h?.textContent ?? "").trim().slice(0, 48),
        rowHeightPx: Math.round(row.getBoundingClientRect().height),
        storyWidthPx: story ? Math.round(story.getBoundingClientRect().width) : null,
        headlineLines: h && heads ? Math.round(h.getBoundingClientRect().height / heads) : null,
        actionLines: buttonTops.size,
        actsContentPx: acts
          ? Math.round(
              Math.max(...[...acts.children].map((c) => c.getBoundingClientRect().right)) -
                acts.getBoundingClientRect().left,
            )
          : null,
        storySpillPx: spill(story),
        correctionsSpillPx: spill(cells[3]),
        // The acts strip is `.astra-row-acts`, not an `.astra-cell`: it is the
        // last child of the row and is built as its own div. Indexing cells[4]
        // returns null on every row, which reads as "nothing spilled" -- a
        // measurement that cannot fail. Query it by name.
        actsSpillPx: spill(row.querySelector(".astra-row-acts")),
        hasDek: !!row.querySelector(".pub-dek"),
        hasScore: /scored \d+\/20/.test(row.textContent ?? ""),
      });
    }
    return rows;
  });
}

async function measure(p) {
  return p.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowPx: doc.scrollWidth - doc.clientWidth,
      docHeight: doc.scrollHeight,
    };
  });
}

const report = { base, outDir, shots: [], rows: [], measurements: [] };

async function shot(shape) {
  const name = `published-${shape.tag}`;
  await page.setViewportSize({ width: shape.width, height: shape.height });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(300);
  // The mode is a storage key the pre-paint script stamps on <html>; asserting
  // the attribute is what makes the file name true.
  const appearance = await page.evaluate(
    () => document.documentElement.dataset.appearance ?? "",
  );
  if (appearance !== shape.appearance) {
    throw new Error(
      `${name}: asked for data-appearance="${shape.appearance}", page says "${appearance}"`,
    );
  }
  const style = await page.addStyleTag({ content: PINNED_CHROME_HIDDEN });
  const file = resolve(outDir, `${name}.png`);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  if (full <= shape.height + 40) {
    await page.screenshot({ path: file, animations: "disabled" });
  } else {
    await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  }
  await style.evaluate((el) => el.remove());
  const measured = await measure(page);
  const rows = await measureRows(page);
  report.shots.push(file);
  report.measurements.push({ shape: shape.tag, file, ...measured });
  report.rows.push({ shape: shape.tag, rows });
  console.log(`  shot  ${name}  overflow=${measured.overflowPx}px  height=${measured.docHeight}px`);
  for (const r of rows) {
    console.log(
      `        row ${r.rowHeightPx}px  story=${r.storyWidthPx}px  headline=${r.headlineLines} lines` +
        `  actions=${r.actionLines} line(s)  acts=${r.actsContentPx}px  spill story/corr/acts=` +
        `${r.storySpillPx}/${r.correctionsSpillPx}/${r.actsSpillPx}px  dek=${r.hasDek}  score=${r.hasScore}`,
    );
  }
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor({
    timeout: 45_000,
  });
  const createAccount = page.getByRole("button", { name: "Create editor account" });
  if (await createAccount.count()) {
    await page.getByLabel("Name").fill("BV Published Owner");
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

  const seedResp = await page.request.post(`${base}${SEED_PATH}`);
  const seedBody = await seedResp.text();
  if (!seedResp.ok()) {
    throw new Error(`${SEED_PATH} answered ${seedResp.status()}: ${seedBody.slice(0, 400)}`);
  }
  console.log(`  ok    seeded the dev desk: ${seedBody.trim().slice(0, 200)}`);

  for (const shape of shapes) {
    await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (mode) => localStorage.setItem("townreporter.desk.mode", mode),
      shape.dark ? "dark" : "light",
    );
    const resp = await page.goto(`${base}/desk/published`, { waitUntil: "domcontentloaded" });
    if (resp && !resp.ok()) throw new Error(`/desk/published answered ${resp.status()}`);
    await page.waitForTimeout(900);
    await shot(shape);
  }

  const reportFile = resolve(outDir, "bv-published-shots.json");
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  ok    wrote ${reportFile}`);
  await browser.close();
} catch (error) {
  console.error(`  FAIL  ${error?.message ?? error}`);
  await browser.close();
  process.exit(1);
}
