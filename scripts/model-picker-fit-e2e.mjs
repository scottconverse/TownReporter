#!/usr/bin/env node
/**
 * Does the option text an editor reads actually fit inside its select?
 *
 * Item 7 of Unit P: an owner screenshot showed "Automatic — Recommende" --
 * a native select clips the selected option's text at its own content box, so
 * a label that is 30px too long is not a cosmetic detail, it is a sentence
 * with its ending missing on the one control that decides what a run spends.
 *
 * This is a measurement, not an assertion about CSS spelling: for every
 * `.model-picker select` on every desk surface it records the select's inner
 * content width and the width the selected option's text really needs, both
 * measured in the browser with the select's own computed font. It also writes
 * the before/after screenshots.
 *
 *   PICKER_FIT_BASE_URL=http://127.0.0.1:8090 PICKER_FIT_OUT=../shot-dir \
 *     node scripts/model-picker-fit-e2e.mjs
 *
 * The server must be one you started (the repo's built server on a port of
 * your own); this script only navigates and reads.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.PICKER_FIT_BASE_URL || "http://127.0.0.1:3491")
  .replace(/\/$/, "");
const outDir = resolve(process.env.PICKER_FIT_OUT || "../model-picker-fit");
mkdirSync(outDir, { recursive: true });
const stamp = Date.now();

/** Desktop and the narrow phone width the owner screenshotted. */
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "375", width: 375, height: 812 },
];

/** Every desk surface that renders a ModelPicker, plus the story page below. */
const SURFACES = [
  { path: "/desk", name: "command-center" },
  { path: "/desk/queue", name: "queue" },
  { path: "/desk/scan", name: "scan" },
  { path: "/desk/dark", name: "dark-desk" },
  { path: "/desk/opinion", name: "opinion" },
];

/*
  Measures text with the browser's own font stack, so the number is the
  number Chromium clips against -- not an estimate from character counts.
*/
const MEASURE = () => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const rows = [];
  for (const select of document.querySelectorAll("select")) {
    const style = getComputedStyle(select);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const box = select.getBoundingClientRect();
    if (box.width === 0) continue;
    const picker = select.closest(".model-picker, .local-model-picker");
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.font = font;
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const border = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
    // The text box a native select clips against: its content box.
    const content = select.clientWidth - padLeft - padRight;
    const options = [...select.options].map((option) => {
      const text = option.textContent.trim();
      return { text, needs: Math.ceil(ctx.measureText(text).width), selected: option.selected };
    });
    const selected = options.find((option) => option.selected);
    const widest = options.reduce((a, b) => (b.needs > a.needs ? b : a), { text: "", needs: 0 });
    const id = select.id || select.getAttribute("aria-label") || "(no id)";
    const label = picker?.querySelector(".model-picker-label")?.textContent?.trim() ?? "(no label)";
    rows.push({
      surface: location.pathname,
      id,
      label,
      compact: Boolean(picker?.classList.contains("compact")),
      clientWidth: select.clientWidth,
      contentWidth: Math.round(content),
      border: Math.round(border),
      selected: selected?.text ?? null,
      selectedNeeds: selected?.needs ?? 0,
      widest: widest.text,
      widestNeeds: widest.needs,
      // Room the text box has after its padding: what the clip is measured against.
      roomForText: Math.round(content),
      selectedOverflowPx: Math.round((selected?.needs ?? 0) - content),
      widestOverflowPx: Math.round(widest.needs - content),
    });
  }
  return rows;
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const report = [];

try {
  const page = await browser.newPage({ viewport: VIEWPORTS[0] });
  page.setDefaultTimeout(45_000);
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Picker Fit Editor");
  await page.getByLabel("Email").fill(`picker-fit-${stamp}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("picker-fit-e2e-pass");
  await page.getByLabel("Confirm password").fill("picker-fit-e2e-pass");
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await completeFirstRunSetup(page, base);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const surface of SURFACES) {
      await page.goto(`${base}${surface.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
      const rows = await page.evaluate(MEASURE);
      for (const [index, row] of rows.entries()) {
        const name = `${surface.name}-${viewport.name}-${index}`;
        const handle = page.locator("select").nth(index);
        await handle.screenshot({ path: join(outDir, `${name}.png`) }).catch(() => {});
        report.push({ ...row, viewport: viewport.name, surfaceName: surface.name, shot: `${name}.png` });
      }
      await page.screenshot({
        path: join(outDir, `${surface.name}-${viewport.name}-page.png`),
        fullPage: false,
      });
    }
  }
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  const cut = report.filter((row) => row.selectedOverflowPx > 0);
  for (const row of report) {
    const flag = row.selectedOverflowPx > 0 ? "CUT " : "ok  ";
    console.log(
      `  ${flag} ${row.surfaceName}/${row.viewport} ${row.label.padEnd(14)} ` +
        `select ${String(row.clientWidth).padStart(4)}px  room ${String(row.roomForText).padStart(4)}px  ` +
        `needs ${String(row.selectedNeeds).padStart(4)}px  ${row.selectedOverflowPx > 0 ? `(+${row.selectedOverflowPx})` : ""}  ` +
        `${JSON.stringify(row.selected)}`,
    );
  }
  console.log(`  ${report.length} selects measured, ${cut.length} clip the selected option`);
  /*
    The second number is the one a closed select only shows if that option is
    the current value: an unavailable option carries an appended
    " — not set up", which no shipped option text budget accounts for. Printed
    separately so the remaining gap is visible rather than averaged away.
  */
  const wide = report.filter((row) => row.widestOverflowPx > 0);
  console.log(`  ${wide.length} selects have SOME option wider than the box (only clips if selected)`);
  for (const row of wide) console.log(`     wide ${row.surfaceName}/${row.viewport} ${JSON.stringify(row.widest)}`);
  console.log(`  report: ${join(outDir, "report.json")}`);
} finally {
  await browser.close();
}
