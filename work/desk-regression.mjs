import { chromium } from "playwright";
const base = "http://127.0.0.1:4400";
const stateFile = "C:/Users/scott/Desktop/Code/townreporter-reliability-0651/work/dark-live/state.json";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: stateFile });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message ?? e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
page.on("requestfailed", (r) => errors.push("reqfail: " + r.url().slice(0, 160) + " :: " + (r.failure()?.errorText ?? "")));

const marks = (t) => {
  const s = t.replace(/\s+/g, " ");
  return {
    url: page.url(),
    homeHero: s.includes("Independent. Local. Accountable."),
    deskHome: s.includes("A clear desk. A good story."),
    deskShell: /EDITOR[’']S DESK/i.test(s),
  };
};

// Case 1: hard load of /desk
await page.goto(base + "/desk", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const hard = marks(await page.locator("body").innerText());
console.log("CASE1-HARD-LOAD", JSON.stringify(hard));
await page.screenshot({ path: "work/dark-live/regression-hard-load.png", fullPage: true });

// Case 2: public home -> Editor's desk click
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.getByRole("link", { name: /Editor[’']s desk/i }).first().click();
await page.waitForTimeout(5000);
const afterClick = marks(await page.locator("body").innerText());
console.log("CASE2-AFTER-CLICK", JSON.stringify(afterClick));
await page.screenshot({ path: "work/dark-live/regression-after-click.png", fullPage: true });

console.log("ERRORS:", JSON.stringify(errors.slice(0, 10)));
await browser.close();
