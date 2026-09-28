#!/usr/bin/env node
/**
 * Unit BY evidence: the picked Queue row, light and dark, plus the contrast
 * numbers the brief asks to be measured on `--panel`.
 *
 *   BY_TINT_BASE_URL=http://127.0.0.1:8123 \
 *   BY_TINT_OUT_DIR=../townreporter-deepseek-oversight/reports/BY-evidence \
 *   node scripts/by-queue-tint-shots.mjs
 *
 * The server is started and stopped by whoever runs this, on a port it picks;
 * this file only visits. It files its own leads through the shipped dialog --
 * no dev-seed route -- so it works against a built server as it ships.
 *
 * What it prints, per theme: the page's background, an unpicked row's
 * background, the picked row's background (all computed, not read from the
 * sheet), and every text color on the picked row with its WCAG ratio against
 * that row's own fill. The shot is taken with the row still ticked.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const base = checkedUrl(
  process.env.BY_TINT_BASE_URL || "http://127.0.0.1:8123",
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.BY_TINT_OUT_DIR || "../townreporter-deepseek-oversight/reports/BY-evidence",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const email = "by-queue-tint@townreporter.test";
const password = "by-queue-tint-pass";

/** WCAG 2.x relative luminance + contrast, on the two computed rgb() strings. */
function contrast(fg, bg) {
  const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) =>
    [r, g, b]
      .map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      })
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [a, b] = [lum(parse(fg)), lum(parse(bg))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(45_000);

const report = { base, outDir, themes: [], shots: [] };

async function measureQueue() {
  return page.evaluate(() => {
    const rowOf = (sel) => document.querySelector(sel);
    const rows = [...document.querySelectorAll(".lead-list.roomy .lead-row")];
    const picked = rows.find((r) => r.classList.contains("picked"));
    const plain = rows.find((r) => !r.classList.contains("picked"));
    if (!picked || !plain) {
      throw new Error(
        `expected one picked and one unpicked row, got ${rows.length} rows ` +
          `(${rows.filter((r) => r.classList.contains("picked")).length} picked)`,
      );
    }
    const fill = getComputedStyle(picked).backgroundColor;
    /** The color that actually paints behind a glyph: the nearest ancestor
        with a fill of its own, which is the row's --panel for most of them and
        the control's own box for a button or the tick square. */
    const behind = (el) => {
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const parts = (bg.match(/[\d.]+/g) || []).map(Number);
        if (parts.length === 4 && parts[3] === 0) continue;
        return bg;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const texts = [];
    for (const el of picked.querySelectorAll("*")) {
      let own = "";
      for (const node of el.childNodes) if (node.nodeType === 3) own += node.nodeValue ?? "";
      if (!own.trim()) continue;
      const closed = el.closest("details:not([open])");
      if (closed && !el.closest("summary")) continue; // a closed menu draws nothing
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      texts.push({
        text: own.trim().slice(0, 48),
        color: s.color,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        behind: behind(el),
        className: el.className && typeof el.className === "string" ? el.className : "",
      });
    }
    const list = rowOf(".lead-list.roomy");
    return {
      pageBackground: getComputedStyle(document.querySelector(".desk-ltr.astra")).backgroundColor,
      listBackground: list ? getComputedStyle(list).backgroundColor : null,
      pickedBackground: fill,
      unpickedBackground: getComputedStyle(plain).backgroundColor,
      pickedRowTinted: picked.classList.contains("picked"),
      unpickedRowClass: plain.className,
      texts,
    };
  });
}

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: /Create the desk|Editor sign-in/ })
    .waitFor({ timeout: 45_000 });
  const create = page.getByRole("button", { name: "Create editor account" });
  if (await create.count()) {
    await page.getByLabel("Name").fill("BY Tint Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await fillPendingSetupCodeIfPresent(page);
    await create.click();
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

  // Two leads, through the shipped dialog: a picked row needs an unpicked
  // neighbour in the same list for the shot to show what the tint does.
  //
  // The press lands on the new lead's story page (the form's submit navigates
  // there), so each filing waits for that URL before the next one starts --
  // otherwise the previous mutation's own redirect lands after the next
  // navigation and the dialog opens on the story page instead of the Queue.
  const headlines = [
    "BY tint walk: council posts the Oct. 8 packet",
    "BY tint walk: trail closure extended through Oct. 16",
  ];
  for (const headline of headlines) {
    await page.goto(`${base}/desk/queue#file-lead`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Why now").fill("Filed by the BY tint walk.");
    await page.getByRole("button", { name: "File lead" }).click();
    await page.waitForURL(/\/desk\/story\/\d+/, { timeout: 45_000 });
    console.log(`  ok    filed ${headline}`);
  }

  for (const theme of [
    { tag: "light", storage: "light", appearance: "light" },
    { tag: "dark", storage: "dark", appearance: "desk-dark" },
  ]) {
    await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (mode) => localStorage.setItem("townreporter.desk.mode", mode),
      theme.storage,
    );
    await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
    await page.locator(".lead-list.roomy .lead-row").first().waitFor({ timeout: 30_000 });

    const appearance = await page.evaluate(
      () => document.documentElement.dataset.appearance ?? "",
    );
    if (appearance !== theme.appearance) {
      throw new Error(`asked for data-appearance="${theme.appearance}", page says "${appearance}"`);
    }

    // Tick the first row's box the way an editor does: press the box.
    await page.locator(".lead-list.roomy .lead-row").first().locator(".queue-check").click();
    await page.waitForTimeout(250);

    const measured = await measureQueue();
    const rows = measured.texts.map((t) => ({
      ...t,
      onPanel: t.behind === measured.pickedBackground,
      ratio: Number(contrast(t.color, t.behind).toFixed(2)),
    }));
    report.themes.push({ theme: theme.tag, ...measured, texts: rows });
    console.log(
      `\n  ${theme.tag.toUpperCase()}  page=${measured.pageBackground}  ` +
        `unpicked=${measured.unpickedBackground}  picked=${measured.pickedBackground}  ` +
        `unticked-row-class="${measured.unpickedRowClass}"`,
    );
    for (const t of rows) {
      console.log(
        `    ${String(t.ratio).padStart(5)}  ${t.onPanel ? "panel" : "own  "}  ${t.fontSize.padStart(7)}  ${t.color.padStart(18)}  ${t.text}`,
      );
    }

    const file = resolve(outDir, `queue-picked-${theme.tag}.png`);
    await page.locator(".lead-list.roomy").screenshot({ path: file, animations: "disabled" });
    report.shots.push(file);
    console.log(`    shot ${file}`);
  }

  writeFileSync(resolve(outDir, "by-queue-tint.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${resolve(outDir, "by-queue-tint.json")}`);
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err), url: page.url() }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
