#!/usr/bin/env node
/**
 * Prove in a real browser that Stats' 12-month CSV adds to the displayed
 * legacy page-load and beacon visit totals. It starts the built app against
 * its own in-memory PGlite, creates an editor through the login screen, and
 * seeds distinct page-view and beacon counters for newsroom 1.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";

const PORT_STATS_EXPORT = 3542;
const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT_STATS_EXPORT}`);
const email = `stats-export-${Date.now()}@townreporter.test`;
const password = "stats-export-e2e-pass";

function csvFields(line) {
  return line.match(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)?.map((field) => {
    const value = field.replace(/^,/, "");
    return value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
  }) ?? [];
}

async function bootTheServer() {
  process.env.PORT = String(PORT_STATS_EXPORT);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = "";
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "reading-stats-export-e2e-secret";
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`);
      if (response.ok) return;
    } catch {
      /* the app is still binding */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The built worktree server did not answer on ${base}.`);
}

async function main() {
  await bootTheServer();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  try {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
    await page.getByLabel("Name").fill("Stats export editor");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await fillPendingSetupCodeIfPresent(page);
    await page.getByRole("button", { name: "Create editor account" }).click();
    await page.getByRole("link", { name: /^Queue\b/ }).waitFor({ timeout: 45_000 });
    await completeFirstRunSetup(page, base);

    await page.goto(`${base}/desk/stats`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Stats", exact: true }).waitFor();
    const pg = await globalThis.__pgliteInstance__;
    assert.ok(pg, "the isolated server exposes its in-memory database to this walk");
    await pg.query(
      `insert into page_views (newsroom_id, target, day, count)
       values (1, 'site', current_date, 604)
       on conflict (newsroom_id, target, day) do update set count = excluded.count`,
    );
    await pg.query(
      `insert into read_hourly
        (newsroom_id, hour_start, path, ref_class, device, loads, visits)
       values (1, date_trunc('hour', now()), '/', 'search', 'computer', 216, 171)
       on conflict (newsroom_id, hour_start, path, ref_class, device)
       do update set loads = excluded.loads, visits = excluded.visits`,
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "12 months", exact: true }).click();
    const summary = page.locator('section[aria-label="Summary"]');
    await page.waitForFunction(() => {
      const text = document.querySelector('section[aria-label="Summary"]')?.innerText ?? "";
      return /Page loads\s*604/.test(text) && /Visits\s*171/.test(text);
    });
    const screen = (await summary.innerText()).replace(/\s+/g, " ");
    assert.match(screen, /Page loads 604/);
    assert.match(screen, /Visits 171/);
    console.log("  ok    the 12-month Stats screen shows 604 page loads and 171 visits");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export CSV", exact: true }).click(),
    ]);
    const csvPath = await download.path();
    assert.ok(csvPath, "the browser received a CSV download");
    const lines = (await readFile(csvPath, "utf8")).trim().split(/\r?\n/);
    const header = csvFields(lines[0] ?? "");
    const records = lines.slice(1).map(csvFields);
    const pageLoadsIndex = header.indexOf("page_loads");
    const visitsIndex = header.indexOf("visits");
    const beaconLoadsIndex = header.indexOf("beacon_loads");
    assert.ok(pageLoadsIndex >= 0 && visitsIndex >= 0 && beaconLoadsIndex >= 0, "CSV labels both load counters and visits");
    const total = (index) => records.reduce((sum, row) => sum + Number(row[index] || 0), 0);
    assert.equal(total(pageLoadsIndex), 604, "CSV page loads equal the screen total");
    assert.equal(total(visitsIndex), 171, "CSV visits equal the screen total");
    assert.equal(total(beaconLoadsIndex), 216, "beacon loads remain a separate total");
    console.log("  ok    exported page_loads and visits equal the screen; 216 beacon loads remain separate");
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
