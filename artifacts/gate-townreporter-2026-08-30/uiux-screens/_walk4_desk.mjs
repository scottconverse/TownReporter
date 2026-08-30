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
await page.waitForTimeout(1500);
await shot("desk-index-1440");

// Desk index bottom-half emptiness measure
const metrics = await page.evaluate(() => {
  const doc = document.documentElement;
  return { scrollHeight: doc.scrollHeight, viewportHeight: window.innerHeight };
});
console.log("desk index scrollHeight vs viewport:", metrics);

await page.goto(BASE + "/desk/sources", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-sources-1440");

await page.goto(BASE + "/desk/scan", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-scan-before-1440");

const runScanBtn = page.locator('button:has-text("Run scan")').first();
console.log("Run scan button disabled?", await runScanBtn.isDisabled().catch(()=>"N/A"));
await runScanBtn.click().catch(e => console.log("click err", e.message));
await page.waitForTimeout(4000);
await shot("desk-scan-after-1440");
console.log("scan page text after click:", (await page.textContent("body")).slice(0, 1200));

await page.goto(BASE + "/desk/queue", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-queue-1440");

await page.goto(BASE + "/desk/opinion", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-opinion-1440");
console.log("opinion page text:", (await page.textContent("body")).slice(0, 800));

await page.goto(BASE + "/desk/dark", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-dark-1440");

await page.goto(BASE + "/desk/ops", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-ops-1440");
console.log("ops page text:", (await page.textContent("body")).slice(0, 1500));

await page.goto(BASE + "/desk/published", { waitUntil: "load" });
await page.waitForTimeout(1000);
await shot("desk-published-1440");

await page.goto(BASE + "/desk/memory", { waitUntil: "load" });
await page.waitForTimeout(1000);
console.log("URL after visiting /desk/memory:", page.url());
await shot("desk-memory-redirect-1440");

await browser.close();
