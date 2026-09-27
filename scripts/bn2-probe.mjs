#!/usr/bin/env node
/**
 * Unit BN2, item 1 — the hit-test probe, re-run after the fix.
 *
 * The measurement this repeats is the one in `questions/BN.md § 1`, which found
 * that a lead row's "More ▾" panel is clipped by the list's own `overflow:
 * hidden` (and, on a row near the window's bottom edge, paints off the
 * viewport), so its lower rows receive no mouse press. The fix is two rules in
 * `src/desk-astra.css` (the list's overflow goes visible while a menu is open;
 * the panel hangs from the summary's top edge when it does not fit below) plus
 * the open-time measurement in `DeskMoreMenu` that sets `more-up`.
 *
 * What is asserted here is the ground truth the bug report used: for every row
 * of the open panel, `document.elementFromPoint` at that row's centre has to
 * resolve to that row (the `<li>` or something inside it). Both the FIRST row of
 * a six-lead list and the LAST one are measured, at 1280×900 — the two cases the
 * bug report measured as 7-of-7 and 0-of-7.
 *
 *   DESK_FLOWS_BASE_URL=http://127.0.0.1:8090 node scripts/bn2-probe.mjs
 *
 * Model-free: leads are filed through the legacy `#file-lead` form, which never
 * starts a scan or a draft.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.DESK_FLOWS_BASE_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
/* Shots land beside the other units' evidence, in the oversight repo, not in the
   worktree (which stays a clean diff of source). */
const SHOTS = process.env.BN2_SHOTS || "C:/Users/scott/Desktop/Code/townreporter-deepseek-oversight/evidence/BN2";
mkdirSync(SHOTS, { recursive: true });
const stamp = Date.now();
const email = `bn2-probe-${stamp}@townreporter.test`;
const password = "bn2-probe-pass";
const LEADS = 6;

/** The panel's rows, and what a press at each row's centre actually reaches. */
const measure = async (page, rowIndex) =>
  page.evaluate(
    ({ index }) => {
      const rows = [...document.querySelectorAll(".lead-row")];
      const row = rows[index];
      if (!row) return { error: `no lead row at index ${index} of ${rows.length}` };
      const details = row.querySelector("details.more");
      const list = row.closest(".lead-list");
      const panel = details?.querySelector(".more-menu");
      if (!details || !panel || !list) return { error: "row has no menu or no list" };

      const label = (li) => {
        const control = li.querySelector("button, a, summary, select");
        const text = (control?.textContent ?? li.textContent ?? "").replace(/\s+/g, " ").trim();
        return text.slice(0, 44) || "(unlabelled)";
      };
      const identify = (el) => {
        if (!el) return "null";
        const cls = [...el.classList].slice(0, 2).join(".");
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
        return `${el.tagName}${cls ? "." + cls : ""}:${text}`;
      };

      const listBox = list.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const rowsOut = [];
      for (const li of panel.querySelectorAll(":scope > li")) {
        const box = li.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        const hit = document.elementFromPoint(x, y);
        rowsOut.push({
          label: label(li),
          box: `${Math.round(box.top)}–${Math.round(box.bottom)}`,
          centre: `${x},${y}`,
          hit: identify(hit),
          own: Boolean(hit && li.contains(hit)),
          onScreen: box.bottom > 0 && box.top < window.innerHeight,
        });
      }
      const ancestors = [];
      for (let el = details.parentElement; el && el !== document.body; el = el.parentElement) {
        ancestors.push({
          el: `${el.tagName}.${[...el.classList].slice(0, 2).join(".")}`,
          overflow: getComputedStyle(el).overflow,
          h: Math.round(el.getBoundingClientRect().height),
        });
      }
      return {
        rowIndex: index,
        listBox: `${Math.round(listBox.top)},${Math.round(listBox.height)}`,
        listBottom: Math.round(listBox.bottom),
        panelTop: Math.round(panelBox.top),
        panelHeight: Math.round(panelBox.height),
        panelBottom: Math.round(panelBox.bottom),
        moreUp: details.classList.contains("more-up"),
        ancestors,
        rows: rowsOut,
      };
    },
    { index: rowIndex },
  );

async function openMenu(page, rowIndex) {
  await page.evaluate(({ index }) => {
    const details = [...document.querySelectorAll(".lead-row")][index]?.querySelector("details.more");
    if (details && !details.open) details.querySelector("summary.more-sum").click();
  }, { index: rowIndex });
  // The open-time measurement runs from `onToggle`; give the browser a couple of
  // frames to lay the panel out before reading it.
  await page.waitForTimeout(150);
}

async function closeMenu(page, rowIndex) {
  await page.evaluate(({ index }) => {
    const details = [...document.querySelectorAll(".lead-row")][index]?.querySelector("details.more");
    if (details?.open) details.open = false;
  }, { index: rowIndex });
}

function printTable(title, result) {
  console.log(`\n${title}`);
  if (result.error) {
    console.log(`  ERROR ${result.error}`);
    return;
  }
  console.log(
    `  list ${result.listBox} (bottom ${result.listBottom}) · panel top ${result.panelTop} height ${result.panelHeight} bottom ${result.panelBottom} · more-up ${result.moreUp}`,
  );
  console.log(
    `  ancestors: ${result.ancestors.map((a) => `${a.el} overflow=${a.overflow} h=${a.h}`).join(" | ")}`,
  );
  console.log("  | drawn row | box | centre | hit-test at centre | own element |");
  console.log("  |---|---|---|---|---|");
  for (const r of result.rows) {
    console.log(`  | ${r.label} | ${r.box} | ${r.centre} | ${r.hit} | ${r.own ? "YES" : "**NO**"} |`);
  }
  const own = result.rows.filter((r) => r.own).length;
  console.log(`  ${own} of ${result.rows.length} rows hit their own element`);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  console.log(`bn2 probe: ${base} at 1280×900`);
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("BN2 Probe");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);

  // Six leads, through the model-free legacy form the walks already use.
  for (let i = 0; i < LEADS; i++) {
    await page.goto(`${base}/desk/queue#file-lead`, { waitUntil: "networkidle" });
    await page.getByLabel("Headline").fill(`Probe lead ${i + 1} of ${LEADS} for the hit test ${stamp}`);
    await page.getByLabel("Why now").fill("Filed by the BN2 hit-test probe; nothing here starts a job.");
    await page.getByRole("button", { name: "File lead" }).click();
    await page.getByLabel("Body").waitFor({ timeout: 30_000 });
    console.log(`  filed lead ${i + 1} of ${LEADS}`);
  }

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.locator(".lead-row").first().waitFor({ timeout: 30_000 });
  const count = await page.locator(".lead-row").count();
  console.log(`  ${count} lead rows on the Queue`);

  const first = await (async () => {
    await openMenu(page, 0);
    await page.screenshot({ path: `${SHOTS}/menu-first-row.png` });
    const r = await measure(page, 0);
    await closeMenu(page, 0);
    return r;
  })();
  const last = await (async () => {
    await openMenu(page, count - 1);
    await page.screenshot({ path: `${SHOTS}/menu-last-row.png` });
    const r = await measure(page, count - 1);
    await closeMenu(page, count - 1);
    return r;
  })();

  // Item 5's control, in place: the rail's "+ New story", on the desk landing page.
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  await page.locator(".astra-sidebar").waitFor({ timeout: 30_000 });
  await page.locator(".astra-sidebar").screenshot({ path: `${SHOTS}/rail-new-story.png` });
  // Scoped to the rail on purpose: the desk header carries a same-named control,
  // and the claim here is about the rail's own button.
  await page.locator(".astra-sidebar").getByRole("button", { name: "New story", exact: true }).click();
  await page.getByRole("heading", { name: "New story", exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/rail-new-story-dialog.png` });
  console.log("  rail '+ New story' opened the New story dialog");

  printTable(`FIRST row of a ${count}-lead list`, first);
  printTable(`LAST row of a ${count}-lead list`, last);

  const failures = [first, last].flatMap((r) =>
    (r.rows ?? []).filter((row) => !row.own).map((row) => `row "${row.label}" hit ${row.hit}`),
  );
  const error = [first, last].find((r) => r.error)?.error;
  if (error) {
    console.log(`\nFAIL: ${error}`);
    await browser.close();
    process.exit(1);
  }
  if (failures.length) {
    console.log(`\nFAIL: ${failures.length} menu rows did not hit their own element:`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    console.log("\nPASS: every row of both panels hit its own element");
  }
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
