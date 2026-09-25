#!/usr/bin/env node
/**
 * Screenshots for the "add sources without leaving the page" unit (0.6.63).
 *
 * Deliberately measurement-free: it renders the screens, it does not judge
 * them. It exists so the same file can be pointed at the build BEFORE the
 * change and AFTER it and produce two comparable sets, which is the only way
 * a before/after claim is worth anything -- a script that only works on the
 * new UI cannot photograph the old one.
 *
 * It walks the owner's actual path: Server -> Sections, add a reporting
 * section named "Business", apply it, then look at what the panel and the
 * Sources add form show at 1280 and at 375.
 *
 *   SECTIONS_UX_BASE_URL=http://127.0.0.1:3492 \
 *   SECTIONS_UX_OUT_DIR=../townreporter-deepseek-oversight/scratch/S/after \
 *   node scripts/sections-sources-ux-shots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * The same address the behaviour walk uses. These screenshots are a second
 * face of one walk rather than a walk of their own, so they share its port --
 * which is declared, and checked for uniqueness against every other test
 * file, in scripts/sections-source-add-e2e.mjs.
 */
const PORT_SECTIONS_UX = 3492;

const base = checkedUrl(
  process.env.SECTIONS_UX_BASE_URL || `http://127.0.0.1:${PORT_SECTIONS_UX}`,
).replace(/\/$/, "");
const outDir = checkedOutputPath(
  resolve(
    process.env.SECTIONS_UX_OUT_DIR ||
      "../townreporter-deepseek-oversight/scratch/S",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const stamp = Date.now();
const email = `sections-ux-${stamp}@townreporter.test`;
const password = "sections-ux-shots-pass";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const shots = [];

async function shot(name, target, width) {
  await page.setViewportSize({ width, height: width === 375 ? 780 : 900 });
  await page.waitForTimeout(250);
  const file = resolve(outDir, `${name}-${width}.png`);
  await (target ?? page).screenshot({ path: file, animations: "disabled" });
  shots.push(file);
  console.log(`  shot  ${file}`);
}

try {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Sections UX Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  console.log("  ok    the first account owns the desk");

  // Server -> Sections (the hash opens the panel directly).
  await page.goto(`${base}/desk/ops#sections`, { waitUntil: "networkidle" });
  const panel = page.locator('section[aria-label="Newspaper sections"]');
  await panel.getByRole("heading", { name: "Newspaper sections" }).waitFor({ timeout: 45_000 });

  // A reporting section named Business, applied, so it is truly empty.
  await panel.getByLabel("New section name").fill("Business");
  await panel.getByRole("button", { name: "Add section" }).click();
  // Exact: "Preview changes" contains "Review changes", and a substring match
  // here clicks the wrong button (it only toggles the preview).
  await panel.getByRole("button", { name: "Review changes", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm and apply", exact: true }).click();
  await panel.getByText(/Sections saved/).waitFor({ timeout: 30_000 });
  console.log("  ok    Business is a saved, empty reporting section");

  const business = page.getByRole("group", { name: /^Business/ });
  await business.waitFor({ timeout: 30_000 });
  await shot("sections-empty-business", business, 1280);
  await shot("sections-empty-business", business, 375);

  // The Sources add form, on its own page.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  const addForm = page.locator("details.astra-source-add");
  await addForm.getByText("Add a source", { exact: true }).click();
  await addForm.getByLabel("URL", { exact: true }).waitFor({ timeout: 30_000 });
  await shot("sources-add-form", addForm, 1280);
  await shot("sources-add-form", addForm, 375);

  // An unsaved section draft, so the sticky bar is on screen if it exists.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/desk/ops#sections`, { waitUntil: "networkidle" });
  await panel.getByRole("heading", { name: "Newspaper sections" }).waitFor({ timeout: 45_000 });
  await panel.getByLabel("New section name").fill("Civic life");
  await panel.getByRole("button", { name: "Add section" }).click();
  await page.waitForTimeout(300);
  await shot("sections-unsaved-draft", null, 1280);
  await shot("sections-unsaved-draft", null, 375);

  // The bar carries "Review changes" and "Cancel changes"; "Confirm and apply"
  // only appears once the preview is open. Photograph that second state too,
  // so both buttons the brief asks for are in the set.
  await page.setViewportSize({ width: 1280, height: 900 });
  const bar = page.locator('[aria-label="Section changes not saved"]');
  if (await bar.count()) {
    await bar.getByRole("button", { name: /^Review changes/ }).click();
    await bar.getByRole("button", { name: /^Confirm and apply/ }).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await shot("sections-bar-preview", null, 1280);
    await shot("sections-bar-preview", null, 375);
  }

  // Discard before leaving: a dirty draft is allowed to warn on unload, and
  // a walk that navigates through that warning measures the warning, not the
  // screens it came for.
  await page.setViewportSize({ width: 1280, height: 900 });
  if (await bar.count()) {
    await bar.getByRole("button", { name: /Cancel changes/ }).click();
  } else {
    await panel.getByRole("button", { name: "Cancel changes" }).click();
  }
  await panel.getByText(/discarded/).waitFor({ timeout: 15_000 });
  console.log("  ok    the draft was discarded");
} catch (err) {
  const text = await page.locator("body").innerText().catch(() => "");
  console.error(
    JSON.stringify(
      { ok: false, error: err instanceof Error ? err.message : String(err), text: text.slice(0, 1200) },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(1);
}

await browser.close();
console.log(JSON.stringify({ ok: true, outDir, shots }, null, 2));
