import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3830";
const DIR = "C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-08-30/uiux-screens";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: undefined });
const page = await ctx.newPage();

async function shot(name) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
  console.log("shot", name, page.url());
}

await page.goto(BASE + "/login", { waitUntil: "load" });
await page.waitForTimeout(1500);

// Test empty submit first
const submitBtn = page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Sign")').first();
console.log("submit button text:", await submitBtn.textContent().catch(() => "N/A"));

const inputs = page.locator("input");
const nameInput = inputs.nth(0);
const emailInput = inputs.nth(1);
const passInput = inputs.nth(2);
const passConfirm = inputs.nth(3);

await nameInput.fill("TownReporter Gate UIUX");
await emailInput.fill("uiux-gate@example.test");
await passInput.fill("GateUiuxPass123!");
await passConfirm.fill("GateUiuxPass123!");
await shot("login-filled-1440");

await submitBtn.click();
await page.waitForTimeout(3000);
await shot("desk-after-signup-1440");
console.log("URL after signup:", page.url());
console.log("body text snippet:", (await page.textContent("body")).slice(0, 400));

await ctx.storageState({ path: `${DIR}/_authstate.json` });
await browser.close();
