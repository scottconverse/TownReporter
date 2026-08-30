import { chromium } from "playwright";
const base = process.env.BASE || "http://127.0.0.1:3600";
const email = "desk-owner@example.com";
const password = "correct-horse-battery-1";
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(45000);

await page.goto(`${base}/login`, { waitUntil: "networkidle" });
const heading = await page.locator("h1,h2").first().innerText();
log("login heading:", heading);
if (/Create the desk/i.test(heading)) {
  await page.getByLabel("Name").fill("Verify Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
} else {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /Sign in/i }).click();
}
await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
log("signed in OK");

// 1. header check across desk pages
for (const p of ["/desk", "/desk/queue", "/desk/ops"]) {
  await page.goto(`${base}${p}`, { waitUntil: "networkidle" });
  const header = page.locator("header").first();
  const headerText = (await header.count()) ? await header.innerText() : "(no header el)";
  const inHeader = /Leave as editor|Leave the desk|leave/i.test(headerText);
  log(`page ${p}: header mentions leave? ${inHeader} | header text: ${JSON.stringify(headerText.slice(0,200))}`);
  const anyLeaveBtn = await page.locator("button.leave-editor").count();
  log(`page ${p}: .leave-editor buttons on page = ${anyLeaveBtn}`);
}

// 2. ops page bottom control
await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
const sec = page.getByText("Give up the desk", { exact: false }).first();
log("Give up the desk section present:", await sec.count() > 0);
await page.locator("button.leave-editor").click();
log("confirm copy:", JSON.stringify((await page.locator(".leave-ask").innerText()).slice(0,400)));

// 3. wrong email typed -> disabled
await page.locator("#leave-confirm-email").fill("attacker@example.com");
log("yes-button disabled with wrong email:", await page.locator("button.leave-yes").isDisabled());
const alert = await page.locator("[role=alert]").first().innerText().catch(()=>"(none)");
log("mismatch alert:", JSON.stringify(alert));

// 4. tamper the RPC body: type the correct email, rewrite the wire payload
let captured = null;
await page.route("**/_serverFn/**", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") return route.continue();
  const body = req.postData();
  captured = body;
  log("captured RPC body:", JSON.stringify(body));
  const tampered = body.replace(/desk-owner@example.com/g, "attacker@example.com");
  log("tampered  RPC body:", JSON.stringify(tampered));
  await route.continue({ postData: tampered });
});
await page.locator("#leave-confirm-email").fill(email);
log("yes-button disabled with correct email:", await page.locator("button.leave-yes").isDisabled());
await page.locator("button.leave-yes").click();
await page.waitForTimeout(4000);
const after = await page.content();
log("still on ops page:", page.url());
const alerts = await page.locator("[role=alert]").allInnerTexts().catch(()=>[]);
log("alerts after tampered submit:", JSON.stringify(alerts));
log("page still shows Give up the desk:", after.includes("Give up the desk"));
await browser.close();
