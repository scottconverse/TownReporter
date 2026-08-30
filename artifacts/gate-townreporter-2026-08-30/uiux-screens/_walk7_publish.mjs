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

// Fill headline/dek/body manually
const headline = page.locator('input, textarea').filter({ hasText: "" });
// Use more targeted selectors by label proximity via placeholder guesses
const allTextInputs = page.locator("main input[type=text], main textarea");
const cnt = await allTextInputs.count();
console.log("editable fields:", cnt);
for (let i=0;i<cnt;i++){
  console.log(i, await allTextInputs.nth(i).getAttribute("placeholder"), await allTextInputs.nth(i).evaluate(el=>el.tagName));
}

// Fill by best-guess order: headline, dek, body (topic is a select, skip)
if (cnt >= 1) await allTextInputs.nth(0).fill("Council packet posted late for the Sept 1 session");
if (cnt >= 2) await allTextInputs.nth(1).fill("The packet went up under 48 hours before the vote, again.");
if (cnt >= 3) await allTextInputs.nth(cnt-1).fill("The agenda packet for the September 1 city council session was posted less than 48 hours before the scheduled vote, again falling inside the required notice window by only a slim margin. Residents flagged the timing on the city's own portal. The clerk's office did not respond to a request for comment by publication time. TownReporter is tracking whether the pattern recurs at the next session.");

await shot("desk-story-body-filled-1440");

const saveBtn = page.locator('button:has-text("Save edits")').first();
await saveBtn.click();
await page.waitForTimeout(1500);
await shot("desk-story-saved-1440");

const publishBtn = page.locator('button:has-text("Publish to the paper")').first();
console.log("publish disabled?", await publishBtn.isDisabled());
await publishBtn.click();
await page.waitForTimeout(2000);
console.log("URL after publish click:", page.url());
await shot("desk-story-after-publish-click-1440");
console.log(await page.textContent("body"));

await ctx.storageState({ path: `${DIR}/_authstate.json` });
await browser.close();
