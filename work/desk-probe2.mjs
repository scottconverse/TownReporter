import { chromium } from "playwright";
const base = "http://127.0.0.1:4400";
const stateFile = "C:/Users/scott/Desktop/Code/townreporter-reliability-0651/work/dark-live/state.json";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: stateFile });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message ?? e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });
page.on("requestfailed", (r) => errors.push("reqfail: " + r.url().slice(0, 140)));
const marks = (t) => {
  const s = t.replace(/\s+/g, " ");
  return {
    url: page.url(),
    homeHero: s.includes("Independent. Local. Accountable."),
    deskHome: s.includes("A clear desk. A good story."),
    deskShell: s.includes("EDITOR'S DESK") || s.includes("Editor’s desk · Longmont") || s.includes("EDITOR’S DESK"),
  };
};
// second (footer) desk link
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const links = page.getByRole("link", { name: /Editor[’']s desk/i });
await links.nth(1).click();
await page.waitForTimeout(4000);
console.log("FOOTER-CLICK", JSON.stringify(marks(await page.locator("body").innerText())));
// trailing slash
await page.goto(base + "/desk/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
console.log("TRAILING-SLASH", JSON.stringify(marks(await page.locator("body").innerText())));
// mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.getByRole("link", { name: /Editor[’']s desk/i }).first().click();
await page.waitForTimeout(4000);
console.log("MOBILE-CLICK", JSON.stringify(marks(await page.locator("body").innerText())));
console.log("ERRORS:", JSON.stringify(errors.slice(0, 8)));
await browser.close();
