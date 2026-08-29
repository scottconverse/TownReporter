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

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e.message ?? e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
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
  step("first account owns the desk with no setup token");

  // ── Opinion desk renders and refuses honestly without a voice ─────────────
  await page.goto(`${base}/desk/opinion`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Opinion", exact: true }).waitFor();
  step("Opinion desk renders");

  await page
    .getByPlaceholder(/rail district wants a second tax/i)
    .fill("The city has not posted council minutes for any 2026 session.");
  const write = page.getByRole("button", { name: /Write an editorial/ });
  await write.click();
  // No voice file and no CLI in CI: it must say so, not start a job.
  await page.getByText(/voice|Claude Code|not|cannot/i).first().waitFor({ timeout: 20_000 });
  step("Opinion refuses clearly when it cannot write");

  // ── Queue: file a lead, then delete it, then undo ─────────────────────────
  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(leadHeadline);
  await page.getByLabel("Why now").fill("The packet posted with a hearing date.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor({ timeout: 30_000 });
  step("a lead can be filed by hand");

  await page.goto(`${base}/desk/queue`, { waitUntil: "networkidle" });
  const row = page.locator(".lead-row", { hasText: leadHeadline }).first();
  await row.waitFor();

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
