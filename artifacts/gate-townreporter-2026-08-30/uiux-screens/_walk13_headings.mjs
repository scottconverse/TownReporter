import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3830";
const DIR = "C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-08-30/uiux-screens";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(600);
console.log("headings:", await page.evaluate(() =>
  [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => `${h.tagName}: ${h.textContent.trim().slice(0,60)}`)
));
await page.screenshot({ path: `${DIR}/home-two-stories-1440.png` });
await browser.close();
