#!/usr/bin/env node
/**
 * One lifecycle path: create the desk → file a lead → write a body → publish →
 * correction on the article. No model. No scan. Fails the 0.4.0 gate if this
 * click-path is broken.
 *
 *   LIFECYCLE_BASE_URL=http://127.0.0.1:8080 node scripts/lifecycle-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.LIFECYCLE_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const stamp = Date.now();
const email = `e2e-${stamp}@townreporter.test`;
const password = "lifecycle-e2e-pass";
const headline = `Council sets a special session on the water plant ${stamp}`;
const why = "The packet posted this morning with a new date.";
const body =
  "Longmont City Council set a special session on the water plant. The packet is on the city site.";
const correction = "The session is Tuesday evening, not Wednesday morning.";

let page;

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1200);
  } catch {
    /* page already gone */
  }
  console.error(JSON.stringify({ ok: false, error: message, url, text, email, headline }));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  page = await browser.newPage();
  page.setDefaultTimeout(45_000);

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor();

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("E2E Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });

  await page.getByRole("link", { name: "Queue", exact: true }).click();
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Why now").fill(why);
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });

  await page.getByLabel("Headline").fill(headline);
  await page.getByLabel("Dek").fill(why);
  await page.getByLabel("Body").fill(body);
  /*
    Publishing asks once now, and that is the point of these two lines.

    It used to be a single unconfirmed click that put a story on a public
    website -- while Delete, which keeps a copy for thirty days, asked
    twice. If someone removes the confirmation, the second click here finds
    no "Yes, print it" and this walk fails, which is the behaviour we want.
  */
  await page.getByRole("button", { name: "Publish to the paper" }).click();
  await page.getByRole("button", { name: "Yes, print it" }).click();
  await page.getByText("On the paper").waitFor({ timeout: 30_000 });

  await page.getByRole("link", { name: "Read it on the paper" }).click();
  await page.waitForURL(/\/articles\//, { timeout: 20_000, waitUntil: "commit" });
  const articleUrl = page.url();
  await page.getByRole("heading", { level: 1, name: /water plant/i }).waitFor();
  await page.getByText(/Longmont City Council set a special session on the water plant/i).waitFor();

  await page.goto(`${base}/desk`, { waitUntil: "domcontentloaded" });
  // Was "Leave as editor", which sat in the header of every desk page. It moved
  // to the Server page and asks you to type your address; see claim.ts. The desk
  // is still proven to be rendering by the nav link on the next line.
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await page.getByRole("link", { name: "Published", exact: true }).first().click();
  await page.waitForURL(/\/desk\/published/);
  // Click until the form actually opens. A force-click that lands before
  // React has hydrated the handler silently does nothing, and this walk
  // clicks faster than any person can -- CI caught the page in exactly that
  // window (the captured DOM showed the button present, the form absent).
  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Post correction" }).first().click({ force: true });
    const open = await page
      .getByPlaceholder("What was wrong")
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (open) break;
    if (i === 5) throw new Error("the correction form never opened after six clicks");
  }
  await page.getByPlaceholder("What was wrong").fill(correction);
  await page.getByRole("button", { name: "Publish correction" }).click({ force: true });
  await page.getByText(/Tuesday evening/).waitFor({ timeout: 20_000 }).catch(() => {});
  for (let i = 0; i < 4; i++) {
    try {
      await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      break;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (i === 3 || !/ERR_ABORTED|interrupted/i.test(m)) throw err;
    }
  }
  for (let i = 0; i < 20; i++) {
    if ((await page.getByText(/Tuesday evening/).count()) > 0) break;
    if (i === 19) throw new Error("correction did not appear on the article");
    await new Promise((r) => setTimeout(r, 1000));
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.getByRole("heading", { name: "Corrections" }).waitFor();
  await page.getByText(/Tuesday evening/).waitFor();

  await browser.close();
  console.log(JSON.stringify({ ok: true, email, headline }));
}

main().catch(dump);
