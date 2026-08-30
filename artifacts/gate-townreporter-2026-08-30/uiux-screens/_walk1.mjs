import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3830";
const DIR = "C:/Users/scott/Desktop/Code/townreporter-dev/artifacts/gate-townreporter-2026-08-30/uiux-screens";
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function shot(name, url) {
  if (url) await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: false });
  console.log("shot", name, page.url());
}

// Home page fresh
await shot("home-1440", "/");
console.log("H1 count:", await page.locator("h1").count());
console.log("Heading tags in order:", await page.evaluate(() =>
  [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(h => `${h.tagName}: ${h.textContent.trim().slice(0,60)}`)
));

// Zoom on top-right CTA
await page.screenshot({ path: `${DIR}/home-topright-1440.png`, clip: { x: 1100, y: 0, width: 340, height: 60 } });

await shot("about-1440", "/about");
console.log("About page text includes contact?", (await page.textContent("body")).match(/mailto|@|contact/i));

await shot("corrections-1440", "/corrections");

await shot("login-1440", "/login");

await browser.close();
