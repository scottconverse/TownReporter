import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3830";
const DIR = "C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-08-30/uiux-screens";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
  console.log("shot", name, page.url());
}

// Create the first editor account (unclaimed desk)
await page.goto(BASE + "/login", { waitUntil: "networkidle" });
await shot("login-before-signup-1440");

// Try to find email/password/name fields
const inputs = await page.locator("input").all();
for (const inp of inputs) {
  console.log("input:", await inp.getAttribute("name"), await inp.getAttribute("type"), await inp.getAttribute("placeholder"));
}
