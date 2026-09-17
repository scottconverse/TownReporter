import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message ?? e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
page.on("requestfailed", (r) => errors.push("reqfail: " + r.url().slice(0, 160) + " :: " + (r.failure()?.errorText ?? "")));
await page.goto("http://127.0.0.1:3000/desk", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
console.log(JSON.stringify({
  url: page.url(),
  homeHero: t.includes("Independent. Local. Accountable."),
  deskHome: t.includes("A clear desk. A good story."),
  signIn: t.includes("Sign in"),
  openingDesk: t.includes("Opening the desk"),
  sample: t.slice(0, 320),
}));
console.log("ERRORS:", JSON.stringify(errors.slice(0, 10)));
await browser.close();
