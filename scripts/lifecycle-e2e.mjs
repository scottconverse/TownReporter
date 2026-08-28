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
  await page.getByRole("heading", { name: "Create editor" }).waitFor();
  await page.getByLabel("Name").fill("E2E Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor" }).click();
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
  await page.getByRole("button", { name: "Publish to the paper" }).click();
  await page.getByText("On the paper").waitFor({ timeout: 30_000 });

  await page.getByRole("link", { name: "Read it on the paper" }).click();
  await page.waitForURL(/\/articles\//, { timeout: 20_000, waitUntil: "commit" });
  await page.getByRole("heading", { level: 1, name: /water plant/i }).waitFor();
  await page.getByText(/Longmont City Council set a special session on the water plant/i).waitFor();

  await page.goto(`${base}/desk/published`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Post correction" }).first().click();
  await page.getByPlaceholder("What was wrong").fill(correction);
  await page.getByRole("button", { name: "Publish correction" }).click();
  await page.getByText("Correction is public").waitFor();

  await page.getByRole("link", { name: "Read on the paper" }).first().click();
  await page.waitForURL(/\/articles\//, { timeout: 20_000, waitUntil: "commit" });
  await page.getByRole("heading", { name: "Corrections" }).waitFor();
  await page.getByText(/Tuesday evening/).waitFor();

  await browser.close();
  console.log(JSON.stringify({ ok: true, email, headline }));
}

main().catch(dump);
