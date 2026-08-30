/**
 * UX-002: how long does "Draft with AI" take to admit there is no model?
 * The audit measured 36 seconds. It should be immediate.
 */
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3200";
const stamp = Date.now();
const browser = await chromium.launch();
const page = await browser.newContext().then((c) => c.newPage());
page.setDefaultTimeout(60_000);

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.getByLabel("Name").fill("Preflight Editor");
await page.getByLabel("Email").fill(`ux002-${stamp}@townreporter.test`);
await page.getByLabel("Password", { exact: true }).fill("ux002-proof-pass");
await page.getByLabel("Confirm password").fill("ux002-proof-pass");
await page.getByRole("button", { name: "Create editor account" }).click();
await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

await page.goto(`${BASE}/desk/queue`, { waitUntil: "networkidle" });
await page.getByText("File a lead yourself").click();
await page.getByLabel("Headline").fill(`Water board packet ${stamp}`);
await page.getByLabel("Why now").fill("The packet posted with a hearing date.");
await page.getByRole("button", { name: "File lead" }).click();
await page.getByLabel("Body").waitFor({ timeout: 30_000 });

const btn = page.getByRole("button", { name: /Draft with AI/i }).first();
await btn.waitFor({ timeout: 20_000 });
const t0 = Date.now();
await btn.click();
// Wait for any message naming the missing model.
await page
  .getByText(/no model|not set up|Claude Code|cannot|sign in to/i)
  .first()
  .waitFor({ timeout: 60_000 });
const ms = Date.now() - t0;
const said = (await page.locator("body").innerText()).match(/[^\n]*(no model|not set up|Claude Code)[^\n]*/i)?.[0] ?? "";

console.log(`  told the editor after ${(ms / 1000).toFixed(1)}s`);
console.log(`  message: ${said.trim().slice(0, 160)}`);
const ok = ms < 5000;
console.log(JSON.stringify({ ok, ms }, null, 2));
if (!ok) process.exitCode = 1;
await browser.close();
