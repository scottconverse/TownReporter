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
await shot("desk-story-1440-fresh");

// Click Draft with AI, poll
const draftBtn = page.locator('button:has-text("Draft with AI")').first();
console.log("Draft with AI disabled?", await draftBtn.isDisabled());
const t0 = Date.now();
await draftBtn.click();
for (let i=0;i<8;i++){
  await page.waitForTimeout(6000);
  const busy = await page.locator("text=Reporting first").count();
  console.log(`t+${Math.round((Date.now()-t0)/1000)}s busy indicator count:`, busy);
  if (busy === 0) break;
}
await shot("desk-story-draftai-resolved-1440");
console.log("elapsed s:", Math.round((Date.now()-t0)/1000));
console.log(await page.textContent("body"));

await browser.close();
