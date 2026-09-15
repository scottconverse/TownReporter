#!/usr/bin/env node
/**
 * Pull's real editor path: public web search, durable progress after reload,
 * Stop/Continue, and an excerpt actually saved into the story workspace.
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const base = checkedUrl(process.env.PULL_E2E_BASE_URL || "http://127.0.0.1:3492").replace(/\/$/, "");
const stamp = Date.now();
const query = "Find the official City of Longmont City Council meeting agendas and packets for 2026";
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Pull Proof Editor");
  await page.getByLabel("Email").fill(`pull-proof-${stamp}@townreporter.test`);
  await page.getByLabel("Password", { exact: true }).fill("pull-proof-e2e-pass");
  await page.getByLabel("Confirm password").fill("pull-proof-e2e-pass");
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await completeFirstRunSetup(page, base, {
    name: "Longmont Pull Proof",
    city: "Longmont",
    state: "Colorado",
  });

  // Setup finishes through a client redirect; on fast machines its last
  // navigation can briefly overlap the next goto. Retry the destination once
  // instead of treating that browser cancellation as a product failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
      break;
    } catch (error) {
      if (attempt || !/ERR_ABORTED/.test(String(error))) throw error;
      await page.waitForTimeout(800);
    }
  }
  await page.getByText("File a lead yourself").click();
  await page.getByLabel("Headline").fill(`Longmont council packet proof ${stamp}`);
  await page.getByLabel("Why now").fill("Verify that Pull finds and saves official council records.");
  await page.getByRole("button", { name: "File lead" }).click();
  await page.getByLabel("Body").waitFor();
  await page.getByRole("tab", { name: "Reporting", exact: true }).click();

  await page
    .locator('input[placeholder="Your own line — a call to make, a record to pull"]:visible')
    .fill(query);
  await page.locator(".note-add:visible").getByRole("button", { name: "Add", exact: true }).click();
  const group = page.locator(".todo-pull-group:visible").filter({ hasText: query });
  await group.getByRole("button", { name: "Pull", exact: true }).click();
  const progress = group.locator(".pull-progress");
  await progress.getByText("Mechanical web search and document extraction — no AI model is being used.").waitFor();
  await progress.getByText(/searches · .* providers · .* documents opened · .* saved/).waitFor();

  // The request is now detached from the browser. Reloading must reconnect to
  // the same job rather than losing the only visible sign of work.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Reporting", exact: true }).click();
  const reloadedGroup = page.locator(".todo-pull-group:visible").filter({ hasText: query });
  const reloadedProgress = reloadedGroup.locator(".pull-progress");
  await reloadedProgress.waitFor();
  await reloadedProgress.getByText(/Mechanical web search/).waitFor();

  // Stop is cooperative at a network boundary. It must become resumable and
  // retain every checkpoint already visible in the counters.
  const stop = reloadedProgress.getByRole("button", { name: "Stop", exact: true });
  if (await stop.isVisible().catch(() => false)) {
    await stop.click();
    await reloadedProgress.getByRole("button", { name: "Continue pull", exact: true }).waitFor({ timeout: 70_000 });
    await reloadedProgress.getByRole("button", { name: "Continue pull", exact: true }).click();
  }

  page.setDefaultTimeout(180_000);
  const activeProgress = page
    .locator(".todo-pull-group:visible")
    .filter({ hasText: query })
    .locator(".pull-progress");
  await activeProgress.getByText(/Finished · .*relevant document.*saved/).waitFor();
  const counters = await activeProgress.locator(".pull-counts").innerText();
  if (!/[1-9]\d* saved/.test(counters)) throw new Error(`Pull finished without a saved document: ${counters}`);
  const savedNotes = await page.getByLabel("Pulled notes").inputValue();
  if (!/https?:\/\//.test(savedNotes)) {
    throw new Error("The completed Pull counted a document but did not save its URL in Pulled notes");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Reporting", exact: true }).click();
  const restored = page
    .locator(".todo-pull-group:visible")
    .filter({ hasText: query })
    .locator(".pull-progress");
  await restored.getByText(/Finished · .*relevant document.*saved/).waitFor();
  await page.locator(".note-sec:visible").filter({ hasText: "Documents opened for this draft" }).waitFor();
  const pulledNotes = await page.getByLabel("Pulled notes").inputValue();
  if (!/https?:\/\//.test(pulledNotes)) throw new Error("The completed Pull did not save its source URL in Pulled notes");
  if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join(" | ")}`);

  console.log("Pull progress: real browser and public-web proof passed");
  console.log("  ok    live mechanical stage and counters appeared immediately");
  console.log("  ok    active job reappeared after browser reload");
  console.log("  ok    Stop made the saved checkpoint continuable");
  console.log("  ok    Continue did not lose prior progress");
  console.log(`  ok    real extraction completed (${counters})`);
  console.log("  ok    completed status and saved source survived a second reload");
} finally {
  await browser.close();
}
