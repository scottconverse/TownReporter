#!/usr/bin/env node
/**
 * The 0.5.1 desk flows, driven in a browser.
 *
 * `lifecycle-e2e.mjs` covers file → draft → publish → correct, and stops
 * there. Everything shipped in 0.5.1 had no browser coverage at all: the
 * Opinion desk, delete, Undo, the trash and its restore, the Server page, and
 * the Dark Desk dials. An audit filed that as TE-04, and it is the reason a
 * locator leak and an unreachable editorial both reached the paper — the
 * screens were verified by an agent looking at them once, not by anything that
 * runs again.
 *
 * Deliberately model-free: nothing here starts a scan, a dig, or an editorial.
 * Those cost money and time and are covered by the opt-in live evaluation.
 * What this proves is that the wiring is real — buttons reach the server, the
 * server changes the database, and the change shows up on the screen.
 *
 * Wants an UNCLAIMED desk: it creates its own throwaway owner, like the
 * lifecycle script.
 *
 *   DESK_FLOWS_BASE_URL=http://127.0.0.1:3200 node scripts/desk-flows-e2e.mjs
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(
  process.env.DESK_FLOWS_BASE_URL || "http://127.0.0.1:8080",
).replace(/\/$/, "");

const stamp = Date.now();
const email = `flows-${stamp}@townreporter.test`;
const password = "desk-flows-e2e-pass";
const leadHeadline = `Planning board meets on the Kimbark parcel ${stamp}`;

let page;
const done = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

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
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);

  /*
    Record WHERE each error happened, not just that one did.

    The first run of this walk reported a React error at the end and named the
    last page visited, which sent me bisecting the wrong change for half an
    hour. An error collector that does not say which step it fired on is a
    puzzle rather than a diagnosis.
  */
  const consoleErrors = [];
  const note = (text) =>
    consoleErrors.push(`[after: ${done[done.length - 1] ?? "start"} | ${page.url()}] ${text}`);
  page.on("pageerror", (e) => note(String(e.message ?? e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") note(m.text().slice(0, 200));
  });

  console.log(`desk flows: ${base}`);

  // ── Own the desk ──────────────────────────────────────────────────────────
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Flows Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk with no setup token");

  // ── Opinion desk renders and refuses honestly without a voice ─────────────
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Opinion", exact: true }).waitFor();
  step("Opinion desk renders");

  // Opinion is Claude only: Automatic and Claude Opus. Codex's model refuses
  // editorials that take a position, so it is offered for Story drafts only.
  const opinionModel = page.getByLabel("Writing model");
  if ((await opinionModel.locator("option").count()) !== 2 || (await opinionModel.inputValue()) !== "auto") {
    throw new Error("Opinion model picker choices/default do not match the product contract");
  }
  step("Opinion exposes Automatic and Claude Opus, nothing else");

  // UIUX-03: a live region has to exist before its content changes, or the
  // announcement is frequently never made.
  if ((await page.locator("#desk-announcer").count()) !== 1) {
    throw new Error("the persistent live region is missing from the desk shell");
  }
  step("the desk carries a persistent live region");

  // UIUX-04: page heading is h1, section headings are h2. A jump to h3 reads
  // as a missing level to anyone navigating by heading.
  const h3s = await page.locator("main h3").count();
  if (h3s > 0) throw new Error(`${h3s} section heading(s) still skip to h3`);
  step("section headings are h2, with no skipped level");

  // UIUX-05: the dependency is visible before anything is typed.
  const notReady = await page.getByText(/This desk cannot write yet/i).count();
  const writeBtn = page.getByRole("button", { name: /Write an editorial/ });
  if (notReady > 0) {
    if (!(await writeBtn.isDisabled())) {
      throw new Error("Opinion says it cannot write but the button is still enabled");
    }
    step("Opinion states the missing dependency before anything is typed");
  } else {
    step("Opinion is ready to write (dependency present)");
  }

  await page
    .getByPlaceholder(/rail district wants a second tax/i)
    .fill("The city has not posted council minutes for any 2026 session.");
  if (await writeBtn.isEnabled()) {
    await writeBtn.click();
    await page.getByText(/voice|Claude Code|not|cannot/i).first().waitFor({ timeout: 20_000 });
    step("Opinion refuses clearly when asked to write and it cannot");
  } else {
    step("Opinion refused up front, so nothing was submitted");
  }

  // ── Queue: file a lead, then delete it, then undo ─────────────────────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(leadHeadline);
  await page.getByLabel("Why now").fill("The packet posted with a hearing date.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });
  step("a lead can be filed by hand");

  const storyModel = page.getByLabel("Writing model");
  if ((await storyModel.locator("option").count()) !== 6 || (await storyModel.inputValue()) !== "auto") {
    throw new Error("Story model picker choices/default do not match the product contract");
  }
  step("Story exposes the full model ladder with Automatic selected");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const row = page.locator(".lead-row", { hasText: leadHeadline }).first();
  await row.waitFor();

  const queueModel = row.getByLabel("Writing model");
  if ((await queueModel.locator("option").count()) !== 6 || (await queueModel.inputValue()) !== "auto") {
    throw new Error("Queue row model picker choices/default do not match the product contract");
  }
  await queueModel.selectOption("local");
  await row.getByRole("button", { name: `Draft ${leadHeadline} with Local Qwen` }).click();
  await row.getByText(/Local Qwen is unreachable|model .* is not loaded/i).waitFor({ timeout: 20_000 });
  if ((await row.locator("[aria-describedby]").getAttribute("aria-describedby")) === "model-picker-help") {
    throw new Error("Queue model picker still uses the old shared description id");
  }
  step("Queue row sends its own explicit model and refuses unavailable Local before enqueue");

  // The actions must be visible without hovering.
  const acts = row.locator(".row-acts");
  const opacity = await acts.evaluate((el) => getComputedStyle(el).opacity);
  if (opacity !== "1") throw new Error(`row actions are hidden (opacity ${opacity})`);
  step("row actions are visible without hovering");

  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: /Yes, delete/ }).click();
  await page.getByText(/Deleted, and kept for 30 days/).waitFor({ timeout: 20_000 });
  step("delete asks once and says the copy is kept");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.locator(".lead-row", { hasText: leadHeadline }).first().waitFor({ timeout: 20_000 });
  step("Undo puts the lead back on the queue");

  // ── Delete again, then restore from the trash on the Server page ──────────
  const row2 = page.locator(".lead-row", { hasText: leadHeadline }).first();
  await row2.getByRole("button", { name: "Delete", exact: true }).click();
  await row2.getByRole("button", { name: /Yes, delete/ }).click();
  await page.getByText(/Deleted, and kept for 30 days/).waitFor({ timeout: 20_000 });

  await page.goto(`${base}/desk/ops`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor();
  step("Server page renders");

  await page.getByRole("heading", { name: "Recently deleted" }).waitFor({ timeout: 20_000 });
  const trashRow = page.locator("li", { hasText: leadHeadline }).first();
  await trashRow.waitFor({ timeout: 20_000 });
  step("the deleted lead is listed in Recently deleted");

  await trashRow.getByRole("button", { name: "Restore" }).click();
  await page.getByText(/Back on the desk/).waitFor({ timeout: 20_000 });
  step("Restore from the trash reports success");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.locator(".lead-row", { hasText: leadHeadline }).first().waitFor({ timeout: 20_000 });
  step("the restored lead is back on the queue");

  // ── Dark Desk dials open and describe themselves ──────────────────────────
  await page.goto(`${base}/desk/dark`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Dark Desk", exact: true }).waitFor();
  step("Dark Desk renders");

  await page.getByText("How hard to dig").waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Change", exact: true }).first().click();
  await page.getByText(/Dig — how far it chases/).waitFor({ timeout: 10_000 });
  await page.getByText(/Nerve — how speculative/).waitFor({ timeout: 10_000 });
  step("the dials open and label themselves in plain words");

  if (consoleErrors.length > 0) {
    throw new Error(`console errors during the walk: ${consoleErrors.slice(0, 5).join(" | ")}`);
  }
  step("no console errors across every screen walked");

  await context.close();
  await browser.close();
  console.log(JSON.stringify({ ok: true, steps: done.length, email }, null, 2));
}

main().catch(dump);
