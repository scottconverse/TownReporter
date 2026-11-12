// Authenticated connector walk against a disposable PGlite desk and synthetic service.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { completeFirstRunSetup, fillPendingSetupCodeIfPresent } from "./first-run-setup-step.mjs";
import { freePort, startConnectorFixture } from "./civic-connectors-service.fixture.mjs";

async function main() {
assert.equal(process.env.TOWNREPORTER_TEST_ENV_VERIFIED, "1");
assert.equal(process.env.DATABASE_URL, "");
const dataRoot = await mkdtemp(join(tmpdir(), "townreporter-connector-browser-"));
const fixture = await startConnectorFixture();
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
Object.assign(process.env, { TOWNREPORTER_DATA_ROOT: dataRoot, DATABASE_URL: "", VERCEL: "", VERCEL_ENV: "",
  PORT: String(port), NITRO_PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1",
  BETTER_AUTH_URL: base, CIVIC_CONNECTORS_URL: fixture.baseUrl, CIVIC_CONNECTORS_NEWSROOM_TOKENS: "{}" });
let browser;
try {
  await import(pathToFileURL(join(process.cwd(), ".output/server/index.mjs")).href);
  const { s: getSql } = await import(pathToFileURL(join(process.cwd(), ".output/server/_chunks/db.mjs")).href);
  const sql = await getSql();
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/login`)).ok) break; } catch { /* starting */ }
    if (i === 149) throw new Error("Disposable application did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env.CIVIC_CONNECTORS_BROWSER_EXECUTABLE ? { executablePath: process.env.CIVIC_CONNECTORS_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name", { exact: true }).fill("Connector fixture editor");
  await page.getByLabel("Email", { exact: true }).fill(`connector-${Date.now()}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("connector-fixture-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("connector-fixture-password");
  await fillPendingSetupCodeIfPresent(page, { dataRoot });
  await page.getByRole("button", { name: "Create editor account", exact: true }).click();
  await page.getByRole("link", { name: /^Queue/ }).waitFor();
  await completeFirstRunSetup(page, base);
  const [owner] = await sql.query("select user_id, newsroom_id from newsroom_members limit 1");
  assert.ok(owner);
  process.env.CIVIC_CONNECTORS_NEWSROOM_TOKENS = JSON.stringify({ [owner.newsroom_id]: fixture.tokens[0] });
  const [source] = await sql.query("insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,$4,'accepted') returning id",
    [owner.user_id, owner.newsroom_id, "https://synthetic.escribemeetings.com/", "Synthetic Council"]);
  await page.goto(`${base}/desk/sources`, { waitUntil: "networkidle" });
  const panel = page.getByTestId("civic-connectors-panel");
  await panel.locator("summary").first().click();
  await panel.getByLabel("Connector accepted source").selectOption(String(source.id));
  await panel.getByLabel("Connector provider").selectOption("escribe");
  await panel.getByRole("button", { name: "Save connector configuration" }).click();
  await panel.getByText("Connector source configuration saved.").waitFor();
  const capture = Buffer.from(JSON.stringify({ d: [{ ID: "browser-1", MeetingName: "Synthetic Council Meeting",
    StartDate: "2026/11/11 19:00:00", Url: "/Meeting.aspx?Id=browser-1" }] }));
  await panel.getByLabel("Connector saved capture").setInputFiles({ name: "capture.json", mimeType: "application/json", buffer: capture });
  await panel.getByRole("button", { name: "Preview capture" }).click();
  await panel.getByText("Preview only. No newsroom evidence saved.").waitFor();
  assert.equal((await sql.query("select count(*)::integer as n from civic_connector_evidence"))[0].n, 0);
  await panel.getByRole("button", { name: "Discover and save evidence" }).click();
  await panel.getByText(/Saved 1 new evidence revision/).waitFor();
  const evidence = panel.getByTestId("connector-evidence").filter({ hasText: "Synthetic Council Meeting" }).first();
  await evidence.waitFor();
  await evidence.getByRole("button", { name: "Reopen cited evidence" }).click();
  await panel.getByTestId("connector-reopened").getByText(/browser-1/).waitFor();
  const [download] = await Promise.all([page.waitForEvent("download"), evidence.getByRole("button", { name: "Export zip" }).click()]);
  assert.match(download.suggestedFilename(), /\.zip$/);
  assert.equal((await sql.query("select count(*)::integer as n from leads"))[0].n, 0);
  console.log("PASS authenticated browser source configuration, preview, saved evidence, reopen and ZIP export; no lead or publication");
} finally {
  await browser?.close();
  await fixture.close();
  // This directory was created by this test and is never a user profile.
  await rm(dataRoot, { recursive: true, force: true });
}
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
