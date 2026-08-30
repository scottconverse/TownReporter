import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3830";
const DIR = "C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-08-30/uiux-screens";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: `${DIR}/_authstate.json` });
const page = await ctx.newPage();

async function shot(name) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
  console.log("shot", name, page.url());
}

await page.goto(BASE + "/desk/story/1", { waitUntil: "load" });
await page.waitForTimeout(800);

const headlineField = page.locator("main input").first();
console.log("first input placeholder/value:", await headlineField.getAttribute("placeholder"), await headlineField.inputValue().catch(()=>"?"));

// dek field likely second input
const inputs = page.locator("main input");
const n = await inputs.count();
console.log("main input count:", n);
for (let i=0;i<n;i++) console.log(i, await inputs.nth(i).getAttribute("placeholder"), await inputs.nth(i).inputValue().catch(()=>"?"));

const publishBtn = page.locator('button:has-text("Publish to the paper")').first();
await publishBtn.click();
await page.waitForTimeout(500);
await shot("desk-story-publish-confirm-1440");

const yesBtn = page.locator('button:has-text("Yes, print it")').first();
await yesBtn.click();
await page.waitForTimeout(2000);
console.log("URL after confirm:", page.url());
await shot("desk-story-published-confirmed-1440");
console.log(await page.textContent("body"));

await browser.close();
