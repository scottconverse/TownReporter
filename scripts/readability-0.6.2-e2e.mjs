#!/usr/bin/env node
/**
 * Browser proof for the 0.6.2 readability pass.
 *
 * Signs up a fresh editor, completes first-run setup, switches to Dark, and
 * screenshots the Queue (the operator's Killed-tab complaint: "small and not
 * white") and the Server page, then switches to Large and screenshots the
 * Queue again. Also pulls the computed color/background/font-size of one
 * KILLED chip and one meta line via page.evaluate, so the contrast fix is
 * provable from the rendered DOM, not just the CSS source.
 *
 * This walk's own listen port, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind it and answer this one's requests.
 *
 *   READABILITY_LABEL=after node scripts/readability-0.6.2-e2e.mjs
 *
 * READABILITY_LABEL names the output files (artifacts/readability-0.6.2/<label>-*.png)
 * and is "after" by default; the "before" run is a separate invocation
 * against the pre-fix source (see docs/editor.md / CHANGELOG.md for how that
 * comparison was produced -- git stash around this same script).
 */
import { mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const PORT_READABILITY = 3319;

const base = checkedUrl(
  process.env.READABILITY_BASE_URL || `http://127.0.0.1:${PORT_READABILITY}`,
).replace(/\/$/, "");
const label = process.env.READABILITY_LABEL || "after";
const outDir = join(process.cwd(), "artifacts", "readability-0.6.2");
mkdirSync(outDir, { recursive: true });

const stamp = Date.now();
const email = `readability-${stamp}@townreporter.test`;
const password = "readability-e2e-pass";

let page;
const done = [];
function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1500);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, label, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  console.log(`readability ${label}: ${base}`);

  // ── Own the desk ──────────────────────────────────────────────────────────
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Readability Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk, first-run setup complete");

  // ── File a lead and kill it, so the Queue actually has a KILLED chip ────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const headline = `Council eyes downtown parking overhaul ${stamp}`;
  const fileDetails = page.locator(".file-form summary");
  if (await fileDetails.count()) {
    await fileDetails.click();
    await page.getByLabel("Headline", { exact: true }).fill(headline);
    await page.getByLabel("Why now", { exact: true }).fill("Readability e2e proof, filed by the walk");
    await page.getByRole("button", { name: "File lead" }).click();
    // Filing navigates straight to the new lead's story page
    // (desk.queue.tsx's file mutation onSuccess). Let that settle, then go
    // back to the Queue deliberately -- clicking Kill mid-navigation is a
    // race between the story-page redirect and the Queue row rendering.
    await page.waitForURL(/\/desk\/story\//, { timeout: 20_000 });
    step("filed a lead");
    await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
    await page.getByText(headline).first().waitFor({ timeout: 20_000 });
    const row = page.locator(".lead-row", { has: page.getByText(headline) }).first();
    const killBtn = row.getByRole("button", { name: "Kill" });
    const killBtnCount = await killBtn.count();
    if (killBtnCount) {
      await killBtn.click();
      await page.waitForTimeout(1200);
      step(`clicked Kill (found ${killBtnCount} button(s))`);
    } else {
      step(`WARNING: no Kill button found in the row for "${headline}"`);
    }
  } else {
    step("file form not found on this build; screenshotting Queue as-is");
  }

  // ── The Killed tab: this is the exact screen from the operator's report ──
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const killedTab = page.getByRole("button", { name: /killed/i });
  if (await killedTab.count()) {
    await killedTab.click();
    await page.locator(".chip.st-killed").first().waitFor({ timeout: 10_000 }).catch(() => {});
    step("opened the Killed tab");
  }

  // ── Dark mode ─────────────────────────────────────────────────────────────
  const darkBtn = page.getByRole("button", { name: "Dark", exact: true });
  if (await darkBtn.count()) {
    await darkBtn.click();
    step("switched to Dark");
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${label}-queue-dark.png`), fullPage: true });
  step(`saved ${label}-queue-dark.png`);

  // ── Measure a KILLED chip and a meta line, straight from computed style ──
  const measurements = await page.evaluate(() => {
    function computed(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize };
    }
    const chip = document.querySelector(".chip.st-killed");
    const meta =
      document.querySelector(".meta") ||
      document.querySelector(".td-meta") ||
      document.querySelector(".sec-sub");
    return { killedChip: computed(chip), metaLine: computed(meta) };
  });
  console.log(`  measured (${label}):`, JSON.stringify(measurements));
  writeFileSync(join(outDir, `${label}-measurements.json`), JSON.stringify(measurements, null, 2));

  // ── Server page ───────────────────────────────────────────────────────────
  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${label}-server-dark.png`), fullPage: true });
  step(`saved ${label}-server-dark.png`);

  // ── Large text (only meaningful on the "after" / fixed build) ───────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const largeBtn = page.getByRole("button", { name: "Large", exact: true });
  if (await largeBtn.count()) {
    await largeBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `${label}-queue-dark-large.png`), fullPage: true });
    step(`saved ${label}-queue-dark-large.png`);
  } else {
    step("Large control not present on this build (expected for a pre-fix 'before' run)");
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, label, completed: done, measurements }, null, 2));
}

main().catch(dump);
