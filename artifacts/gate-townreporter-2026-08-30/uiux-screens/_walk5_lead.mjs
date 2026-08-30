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

// File a lead by hand from desk index
await page.goto(BASE + "/desk", { waitUntil: "load" });
await page.waitForTimeout(1000);
const fileLead = page.locator('text=file a lead').first();
await fileLead.click().catch(e => console.log("click err", e.message));
await page.waitForTimeout(500);
await shot("desk-file-lead-open-1440");

const textareas = page.locator("textarea, input[type=text]");
const count = await textareas.count();
console.log("form fields found:", count);
for (let i=0;i<count;i++){
  const ph = await textareas.nth(i).getAttribute("placeholder");
  console.log(i, ph);
}
// fill headline-like first field + source url
if (count >= 1) await textareas.nth(0).fill("Council packet posted late for the Sept 1 session");
if (count >= 2) await textareas.nth(1).fill("https://longmont.primegov.com/public/portal");
await shot("desk-file-lead-filled-1440");

const submitLead = page.locator('button:has-text("File"), button:has-text("Add lead"), button:has-text("Submit")').first();
console.log("submit lead text:", await submitLead.textContent().catch(()=>"N/A"));
await submitLead.click().catch(e => console.log("submit err", e.message));
await page.waitForTimeout(2000);
console.log("URL after filing lead:", page.url());
await shot("desk-story-after-lead-1440");

await browser.close();
