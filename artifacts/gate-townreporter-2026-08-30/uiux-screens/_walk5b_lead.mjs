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

await page.goto(BASE + "/desk/queue", { waitUntil: "load" });
await page.waitForTimeout(800);
await page.locator("summary:has-text('File a lead yourself')").click();
await page.waitForTimeout(400);
await shot("desk-file-lead-expanded-1440");

const fields = page.locator("details input, details textarea");
const n = await fields.count();
console.log("fields:", n);
for (let i=0;i<n;i++){
  console.log(i, await fields.nth(i).getAttribute("placeholder"), await fields.nth(i).evaluate(el=>el.tagName));
}
if (n>0) await fields.nth(0).fill("Council packet posted late for the Sept 1 session");
if (n>1) await fields.nth(1).fill("The packet went up under 48 hours before the vote, again.");
if (n>2) await fields.nth(2).fill("https://longmont.primegov.com/public/portal");
await shot("desk-file-lead-filled2-1440");

const submitLead = page.locator('button:has-text("File lead")').first();
await submitLead.scrollIntoViewIfNeeded();
await submitLead.click();
await page.waitForTimeout(2000);
console.log("URL after filing lead:", page.url());
await shot("desk-story-after-lead2-1440");
console.log(await page.textContent("body"));

await ctx.storageState({ path: `${DIR}/_authstate.json` });
await browser.close();
