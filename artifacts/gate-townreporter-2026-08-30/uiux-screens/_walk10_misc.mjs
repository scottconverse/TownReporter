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

// Evidence bad URL
const resp = await page.goto(BASE + "/evidence/00000000-0000-0000-0000-000000000000", { waitUntil: "load" }).catch(e=>null);
console.log("evidence bad status:", resp && resp.status());
await page.waitForTimeout(600);
await shot("evidence-bad-1440");
console.log("evidence body:", (await page.textContent("body")).slice(0,500));

// get-the-code
await page.goto(BASE + "/get-the-code", { waitUntil: "load" });
await page.waitForTimeout(600);
await shot("get-the-code-1440");
const links = await page.locator("a").evaluateAll(as => as.map(a => `${a.textContent.trim()} -> ${a.getAttribute('href')}`));
console.log("get-the-code links:", links.filter(l=>l.trim()!=="->"));

// Dark desk populate
await page.goto(BASE + "/desk/dark", { waitUntil: "load" });
await page.waitForTimeout(600);
await shot("desk-dark-before-1440");
const checkBtn = page.locator('button:has-text("Check r/longmont")').first();
if (await checkBtn.count() > 0) {
  await checkBtn.click().catch(e=>console.log("check click err", e.message));
  await page.waitForTimeout(4000);
  await shot("desk-dark-after-check-1440");
  console.log("dark desk body after check:", (await page.textContent("body")).slice(0, 1500));
} else {
  console.log("no Check r/longmont button found");
  console.log((await page.textContent("body")).slice(0,1000));
}

// Published page delete confirm
await page.goto(BASE + "/desk/published", { waitUntil: "load" });
await page.waitForTimeout(600);
await shot("desk-published-1440-v2");
const delBtn = page.locator('button:has-text("Delete")').first();
if (await delBtn.count() > 0) {
  await delBtn.click();
  await page.waitForTimeout(400);
  await shot("desk-published-delete-confirm-1440");
  console.log("delete confirm text:", (await page.textContent("body")).slice(0, 1500));
}

// Leave as editor position
await page.goto(BASE + "/desk", { waitUntil: "load" });
await page.waitForTimeout(600);
console.log("Leave as editor visible?", await page.locator("text=Leave as editor").count());

await browser.close();
