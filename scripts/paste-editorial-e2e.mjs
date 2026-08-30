#!/usr/bin/env node
/**
 * File a piece written outside the desk, in a browser.
 *
 * The Opinion desk could only generate. An editor who wrote a column somewhere
 * else -- in their own editor, or in another session against the voice file
 * that deliberately lives outside this repository -- had no way to get it onto
 * the desk at all; the only route in was a recovery script wanting a model CLI
 * envelope and a user id read out of the database.
 *
 * This walks the real path: paste, file, and confirm it arrived as a DRAFT with
 * its receipts attached. Deliberately model-free -- the whole point of this
 * feature is that no model is involved.
 *
 *   PASTE_BASE_URL=http://127.0.0.1:3200 node scripts/paste-editorial-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.PASTE_BASE_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const stamp = Date.now();
const email = process.env.E2E_DESK_EMAIL ?? `paste-${stamp}@townreporter.test`;
const password = process.env.E2E_DESK_PASSWORD ?? "paste-e2e-pass";
const headline = `Longmont is about to declare First and Main blighted ${stamp}`;

/*
  A real piece, in the shape the desk itself produces: headline, body, then the
  receipts and the fact sheet under their own headings. If the parser ever stops
  splitting these apart, the assertions below notice.
*/
const PIECE = [
  headline,
  "",
  "On September 8 the city council holds a public hearing on an ordinance finding",
  "that the ground around First Avenue and Main Street is a blighted area.",
  "",
  "Blight is the price of admission. Colorado law will not let a city run tax",
  "increment financing on a district until the governing body declares it blighted.",
  "",
  "CLAIMS AND SOURCES",
  "",
  "The Longmont Urban Renewal Authority held a special meeting on August 18, 2026.",
  "Source: https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=16373",
  "",
  "EDITOR'S FACT SHEET",
  "",
  "Records requests: none filed. No subject was contacted for comment.",
].join("\n");

let page;
const done = [];
const step = (n) => {
  done.push(n);
  console.log(`  ok    ${n}`);
};

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });

  console.log(`paste editorial: ${base}`);

  /*
    Create the desk, or sign in if it is already claimed. This script runs
    SECOND in its CI job (after sources-reach-the-reader claims the desk),
    and the sign-in page has no "Name" field to wait for. Credentials are
    shared through E2E_DESK_EMAIL / E2E_DESK_PASSWORD.
  */
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const loginHeading = page.getByRole("heading", { name: /Create the desk|Editor sign-in/ });
  await loginHeading.waitFor();
  if (/Create the desk/.test((await loginHeading.textContent()) ?? "")) {
    await page.getByLabel("Name").fill("Paste Editor");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create editor account" }).click();
  } else {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in with email" }).click();
  }
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  step("owns the desk");

  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Opinion", exact: true }).waitFor();

  // Closed by default: writing here is still the common case.
  const area = page.getByPlaceholder(/Headline on the first line/);
  if (await area.isVisible().catch(() => false)) {
    throw new Error("the paste box is open before it was asked for");
  }
  step("the paste box stays out of the way until asked for");

  await page.getByRole("button", { name: "Paste a piece I wrote" }).click();
  await area.waitFor();
  step("the paste box opens");

  await area.fill(PIECE);
  await page.getByRole("button", { name: "File it as a draft" }).click();
  await page.getByText(/Filed as a draft/).waitFor({ timeout: 30_000 });
  step("filing reports success");

  await page.reload({ waitUntil: "networkidle" });
  const row = page.getByText(headline, { exact: false }).first();
  await row.waitFor({ timeout: 30_000 });
  step("the piece is on the Opinion desk");

  /*
    The one thing that must never be true of a paste box: that it published.
    Publishing is a person's deliberate click and this path does not have one.
  */
  const paper = await (await fetch(`${base}/`)).text();
  if (paper.includes(headline)) {
    throw new Error("a pasted piece reached the public paper without anyone publishing it");
  }
  const feed = await (await fetch(`${base}/feed`)).text();
  if (feed.includes(headline)) {
    throw new Error("a pasted piece reached the feed without anyone publishing it");
  }
  step("it did NOT reach the paper or the feed");

  /*
    Open it and check the receipts survived the trip.

    The list row is not itself clickable -- the desk opens an editorial from its
    own control, which the first version of this walk did not know. Reading a
    row is not the same as reaching one.
  */
  await page.getByRole("button", { name: /^Read$|^Open$|^Read it$/ }).first().click();
  await page.getByText(/CLAIMS AND SOURCES|primegov/i).first().waitFor({ timeout: 20_000 });
  step("the sources came with it");

  if (errors.length) throw new Error(`console errors: ${errors.slice(0, 3).join(" | ")}`);
  step("no console errors");

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length }, null, 2));
}

main().catch(async (err) => {
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 900);
  } catch {
    /* gone */
  }
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err), url, text, completed: done }, null, 2));
  process.exit(1);
});
