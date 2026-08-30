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

await page.goto(BASE + "/desk", { waitUntil: "load" });
await page.waitForTimeout(600);
// find avatar / account trigger
const avatar = page.locator('button:has-text("TownReporter Gate UIUX"), [aria-haspopup]').first();
console.log("avatar count:", await page.locator('button').count());
const acctBtn = page.locator('text=TownReporter Gate UIUX').first();
await acctBtn.click().catch(e=>console.log("click err", e.message));
await page.waitForTimeout(400);
await shot("desk-account-menu-1440");
console.log("menu text:", (await page.textContent("body")).match(/Leave[^.]{0,60}/));

await browser.close();

// Mobile pass
const b2 = await chromium.launch();
const ctx2 = await b2.newContext({ viewport: { width: 375, height: 812 }, storageState: `${DIR}/_authstate.json`, isMobile: true, hasTouch: true });
const page2 = await ctx2.newPage();
await page2.goto(BASE + "/desk/sources", { waitUntil: "load" });
await page2.waitForTimeout(600);
await page2.screenshot({ path: `${DIR}/desk-sources-375.png` });
console.log("mobile shot done desk-sources-375");

const dropBtns = page2.locator('button:has-text("Drop")');
const dn = await dropBtns.count();
if (dn > 0) {
  const box = await dropBtns.first().boundingBox();
  console.log("Drop button box at 375:", box);
}

await page2.goto(BASE + "/", { waitUntil: "load" });
await page2.waitForTimeout(600);
await page2.screenshot({ path: `${DIR}/home-375.png` });
console.log("mobile home shot done");

await b2.close();
