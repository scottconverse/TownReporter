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

await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("home-with-published-story-1440");

const link = page.locator('a:has-text("Council packet posted late for the Sept 1 session")').first();
await link.click();
await page.waitForTimeout(1000);
console.log("article URL:", page.url());
await shot("article-published-1440");
const bodyText = await page.textContent("body");
console.log("mentions 'source' or the primegov URL?", /source/i.test(bodyText), bodyText.includes("primegov"));
console.log(bodyText.slice(0, 2500));

await browser.close();
