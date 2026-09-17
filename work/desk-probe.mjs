import { chromium } from "playwright";
const base = "http://127.0.0.1:4400";
const stateFile = "C:/Users/scott/Desktop/Code/townreporter-reliability-0651/work/desk-state/editor-state.json";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: stateFile });
const page = await context.newPage();
const marks = (t) => {
  const s = t.replace(/\s+/g, " ");
  return {
    url: page.url(),
    homeHero: s.includes("Independent. Local. Accountable."),
    homeFeatured: s.includes("A clearer view of Longmont."),
    deskHeading: s.includes("A clear desk. A good story."),
    deskNav: s.includes("Dark Desk Follow-ups"),
    length: t.length,
  };
};
// exact production flow: home -> desk -> Public news page -> home -> Editor's desk click
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("HOME", JSON.stringify(marks(await page.locator("body").innerText())));
const links = page.getByRole("link", { name: /Editor[’']s desk/i });
console.log("desk links:", await links.count());
for (let i = 0; i < await links.count(); i++) console.log("link", i, await links.nth(i).getAttribute("href"), await links.nth(i).innerText().catch(()=>"?"));
await links.first().click();
await page.waitForTimeout(4000);
console.log("AFTER-CLICK1", JSON.stringify(marks(await page.locator("body").innerText())));
// now from desk, use Public news page to go home, then click masthead desk link again
const pub = page.getByRole("link", { name: /Public news page/i }).first();
console.log("public link count:", await page.getByRole("link", { name: /Public news page/i }).count());
await pub.click();
await page.waitForTimeout(2500);
console.log("BACK-ON-HOME", JSON.stringify(marks(await page.locator("body").innerText())));
await page.getByRole("link", { name: /Editor[’]s desk/i }).first().click();
await page.waitForTimeout(4000);
console.log("AFTER-CLICK2", JSON.stringify(marks(await page.locator("body").innerText())));
await page.screenshot({ path: "work/desk-defect/probe-after-click2.png", fullPage: true });
await browser.close();
