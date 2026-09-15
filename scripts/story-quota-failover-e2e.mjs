#!/usr/bin/env node
/**
 * Browser acceptance for the real Story failure that prompted this repair.
 * Claude's readiness probe succeeds, its first uploaded-document read returns
 * a provider-shaped 429, and Automatic must move the same saved document to
 * Codex Terra and land a draft. The fake CLIs preserve the production process
 * boundary without spending subscription allowance.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fromCrossJSON } from "seroval";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

const PORT_STORY_QUOTA_FAILOVER = 3320;
const base = checkedUrl(
  process.env.STORY_QUOTA_FAILOVER_BASE_URL || `http://127.0.0.1:${PORT_STORY_QUOTA_FAILOVER}`,
).replace(/\/$/, "");
const stamp = Date.now();
const marker = `AUTOMATIC_DOCUMENT_MARKER_${stamp}`;
const email = `story-quota-${stamp}@townreporter.test`;
const password = "story-quota-e2e-pass";
const snapshots = [];
const completed = [];
let page;

function step(text) {
  completed.push(text);
  console.log(`  ok    ${text}`);
}

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", async (response) => {
    try {
      if (!response.url().includes("_serverFn")) return;
      if (!(response.headers()["content-type"] || "").includes("application/json")) return;
      const decoded = fromCrossJSON(await response.json(), {});
      const job = decoded?.result?.job;
      if (job && typeof job.stage === "string" && typeof job.model_choice === "string") {
        snapshots.push({ at: Date.now(), job });
      }
    } catch {
      // Other server-function responses do not have the Story payload shape.
    }
  });

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Name").fill("Story Quota Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor();
  await completeFirstRunSetup(page, base);
  await page.goto(`${base}/desk`, { waitUntil: "networkidle" });
  step("created an isolated editor and opened Write a story");

  await page.getByLabel("Attach documents").setInputFiles({
    name: "quota-failover-packet.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      `Longmont City Council packet test. Exact retained evidence: ${marker}. ` +
        "The council approved the packet item after public discussion.",
    ),
  });
  await page.getByText("quota-failover-packet.txt", { exact: false }).waitFor();
  await page
    .getByLabel("What story do you want?")
    .fill(
      "Write a short news story from the attached packet and preserve its exact evidence marker.",
    );
  await page.getByText("Research & section", { exact: false }).click();
  await page.getByLabel("Drafting scope").selectOption("supplied");
  assert.doesNotMatch(await page.locator("#story-composer").innerText(), /Codex does not support/i);
  assert.equal(await page.getByLabel("Writing model").inputValue(), "auto");
  step("attached a real text document and kept Automatic with supplied material only");

  await page.getByRole("button", { name: "Write draft", exact: true }).click();
  await page.getByRole("heading", { name: "Story workspace", exact: true }).waitFor();
  const visibleSwitch = page
    .getByText(
      "Model switch: This draft moved to Codex Terra because Claude Opus reached its usage limit",
      { exact: true },
    )
    .waitFor({ timeout: 45_000 });
  const deadline = Date.now() + Number(process.env.STORY_QUOTA_FAILOVER_DEADLINE_MS || 150_000);
  while (Date.now() < deadline) {
    if (await page.getByRole("button", { name: "Redraft", exact: true }).count()) break;
    const failed = snapshots.findLast((entry) => entry.job.status === "failed");
    if (failed) throw new Error(`Story job failed: ${JSON.stringify(failed.job)}`);
    await page.waitForTimeout(500);
  }
  await page.getByRole("button", { name: "Redraft", exact: true }).waitFor({ timeout: 1_000 });
  await visibleSwitch;
  step("Automatic recovered and landed a draft");

  const finished = snapshots.findLast((entry) => entry.job.status === "completed");
  assert.ok(finished, `No completed Story job observed: ${JSON.stringify(snapshots.slice(-5))}`);
  assert.equal(finished.job.model_choice, "codex-balanced");
  assert.equal(
    finished.job.failover_note,
    "This draft moved to Codex Terra because Claude Opus reached its usage limit",
  );
  const sawDurableSwitchWhileRunning = snapshots.some(
    (entry) =>
      entry.job.status === "running" &&
      entry.job.failover_note ===
        "This draft moved to Codex Terra because Claude Opus reached its usage limit",
  );
  assert.equal(
    sawDurableSwitchWhileRunning,
    true,
    "The running Story job never exposed its durable provider switch",
  );
  step("the completed job records Codex Terra and the Claude quota reason");

  const body = await page.getByLabel("Body").inputValue();
  assert.match(
    body,
    new RegExp(marker),
    "Codex draft did not contain the uploaded document marker",
  );
  assert.doesNotMatch(await page.locator("body").innerText(), /failed Opinion request/i);
  step("Codex read the retained upload and its marker reached the finished story");

  await browser.close();
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, marker, completed, finishedJob: finished.job }, null, 2));
}

main().catch(async (error) => {
  const body = await page
    ?.locator("body")
    .innerText()
    .catch(() => "");
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        body: body?.slice(0, 2_000),
        completed,
        snapshots: snapshots.slice(-6),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
