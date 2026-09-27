#!/usr/bin/env node
/**
 * The Queue's batch panel stops listing stories that are already printed
 * (0.6.74, Unit BS hotfix).
 *
 * What the owner saw: under "Draft selected" the panel for Batch #3 listed five
 * rows offering "Redraft with Local model" for stories that were already
 * published on the paper. The panel always loads the newsroom's latest batch
 * and drew every one of its jobs, so a batch sat there for good once it had
 * run -- and every story in it that an editor went on to print stayed in the
 * list, offering to redraft a story the paper had already carried.
 *
 * This walk drives the real path to that state, with a fake OpenAI-compatible
 * endpoint answering the drafts (scripts/fakes/fake-deepseek-endpoint.mjs --
 * no real model, no network):
 *
 *   1. an owner claims a desk and saves one Custom AI connection at the fake;
 *   2. two leads are filed and drafted as one batch;
 *   3. one of the two stories is written and PRINTED from its workbench;
 *   4. back on the Queue the printed story's row must be gone from the panel,
 *      and the other must still be there -- the panel is a list of work, not
 *      a log, so an empty panel would also be wrong here;
 *   5. Dismiss must put the batch away, and it must stay away after a reload.
 *
 * Step 4 is the bug: on 0.6.74 the printed story's row was still listed, and
 * there was no Dismiss button to get rid of the panel at all. Run this walk
 * against that build and it fails on step 4 with the row still present.
 *
 *   PORT=3532 HOST=127.0.0.1 BETTER_AUTH_SECRET=... \
 *   TOWNREPORTER_CLAUDE_CODE=0 npm start &
 *   BATCH_PANEL_BASE_URL=http://127.0.0.1:3532 node scripts/batch-published-panel-e2e.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { confirmSectionAndWaitForPublishable } from "./confirm-section-step.mjs";

/**
 * This walk's own listen ports, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind either and answer this one's requests. The fake endpoint is
 * a second listener, so it is a second declared port.
 */
const PORT_BATCH_PANEL = 3532;
const PORT_BATCH_PANEL_MODEL = 3533;

const base = checkedUrl(
  process.env.BATCH_PANEL_BASE_URL || `http://127.0.0.1:${PORT_BATCH_PANEL}`,
).replace(/\/$/, "");
const modelBase = `http://127.0.0.1:${PORT_BATCH_PANEL_MODEL}/v1`;
/** The model id the fake lists and attributes every answer to. */
const modelId = "deepseek-v4.1-flash:cloud";

const stamp = Date.now();
const email = `batch-panel-${stamp}@townreporter.test`;
const password = "batch-panel-e2e-pass";
const connectionName = `DeepSeek Flash stand-in ${stamp}`;
/** The story this walk prints; the other stays open. */
const printedHeadline = `Water tower inspection backlog ${stamp}`;
const openHeadline = `Library roof bids opened ${stamp}`;

const outDir = checkedOutputPath(
  resolve(
    process.env.BATCH_PANEL_OUT_DIR || "../townreporter-deepseek-oversight/evidence/BS",
  ),
  [resolve("..")],
  "output directory",
);
mkdirSync(outDir, { recursive: true });

const REPO = resolve(".");
let page;
const done = [];
const shots = [];
const fakes = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

/**
 * Screenshots are evidence about the panel, and the panel sits under the
 * picker, below the fold of a 1280x720 viewport. Bring it into frame first, or
 * the picture is of everything except the thing being proved.
 */
async function shot(name) {
  const list = results();
  const anchor = (await list.count()) > 0 ? list : panel();
  if ((await anchor.count()) > 0) {
    await anchor.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
  }
  const file = resolve(outDir, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  shots.push(file);
  console.log(`  shot  ${file}`);
}

function stopFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

/** Start the fake and wait for its own "listening on" line, so nothing races the bind. */
function startFake(script, env) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(process.execPath, [join(REPO, script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (line) resolveStart(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`${script} exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`${script} never reported listening:\n${out.trim()}`)), 15_000);
  });
}

/** The panel's rows, as the editor sees them. */
const panel = () => page.locator("#draft-batch");
const results = () => page.locator('#draft-batch [aria-label="Draft batch results"]');
const rowFor = (headline) => results().locator(".lead-row", { hasText: headline });

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  let html = "";
  try {
    if (page) {
      url = page.url();
      text = (await page.locator("body").innerText()).slice(0, 2000);
      html = (await page.locator("#draft-batch").innerHTML()).slice(0, 2000);
    }
  } catch {
    /* page already gone */
  }
  console.error(
    JSON.stringify({ ok: false, error: message, url, text, batchPanelHtml: html, completed: done }, null, 2),
  );
  process.exit(1);
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  /*
    This walk signs up, so it needs a desk nobody has claimed. Without a
    database the app runs on an in-memory PGlite, so a server that has already
    served a walk still remembers its owner -- restart it between runs.
    Saying so here beats the 45s timeout on an absent "Name" field, which reads
    like a broken form rather than a warm server.
  */
  if ((await page.getByRole("heading", { name: /Create the desk/ }).count()) === 0) {
    throw new Error(
      `${base} already has an editor: this walk creates its owner, so it needs a server started against an empty database (in-memory PGlite: restart it)`,
    );
  }
  await page.getByLabel("Name").fill("Batch Panel Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("first account owns the desk");
}

/** A Custom AI connection at the fake, so the batch has a runtime that answers. */
async function saveTheFakeConnection() {
  await page.goto(`${base}/desk/ops#custom-ai-connections`, { waitUntil: "networkidle" });
  const section = page.locator("#custom-ai-connections");
  await section.getByRole("heading", { name: "Add your own AI API" }).waitFor({ timeout: 45_000 });
  await section.getByLabel("Connection name", { exact: true }).fill(connectionName);
  await section.getByLabel("Base URL", { exact: true }).fill(modelBase);
  await section.getByLabel("Model id (optional)", { exact: true }).fill(modelId);
  await section.getByRole("button", { name: "Save connection", exact: true }).click();
  await section.getByRole("heading", { name: connectionName, exact: true }).waitFor();
  const row = section.locator("article").filter({ hasText: connectionName });
  await row.getByRole("button", { name: "Discover models", exact: true }).click();
  const discovered = section.locator("select");
  await discovered.waitFor({ timeout: 45_000 });
  await discovered.selectOption(modelId);
  await section.getByRole("button", { name: "Save changes", exact: true }).click();
  await row.getByText(new RegExp(modelId)).waitFor();
  step(`one Custom AI connection at the fake answers as ${modelId}`);
}

async function fileTwoLeads() {
  for (const headline of [printedHeadline, openHeadline]) {
    await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
    const form = page.locator("details.file-form");
    await form.locator("summary").click();
    await form.getByLabel("Headline").fill(headline);
    await form.getByLabel("Why now").fill("Filed by the batch-panel walk.");
    await form.getByRole("button", { name: "File lead" }).click();
    // Filing lands on the story workbench; the Queue is where the batch is run.
    await page.getByLabel("Body").waitFor({ timeout: 45_000 });
  }
  step("two leads are filed");
}

/** Both leads, one batch, the fake doing the writing. */
async function draftBothAsOneBatch() {
  await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
  for (const headline of [printedHeadline, openHeadline]) {
    const row = page.locator(".lead-row", { hasText: headline }).first();
    await row
      .getByRole("checkbox", { name: `Include ${headline} in the batch draft`, exact: true })
      .check();
  }
  const batch = panel();
  const picker = batch.getByLabel("Writing model");
  const option = picker.locator("option", { hasText: connectionName });
  const choice = await option.getAttribute("value");
  assert.match(choice ?? "", /^custom:/, "the saved connection must appear in the batch picker");
  await picker.selectOption(choice);
  await batch.getByRole("button", { name: "Draft selected", exact: true }).click();
  await batch.getByText(new RegExp(`Batch #\\d+ · ${connectionName}`)).waitFor({ timeout: 45_000 });
  // Both items have to be finished before the panel offers Dismiss, and a
  // finished item is the one that reports the draft it saved -- so the second
  // such row is the desk's own word that the batch ran to the end.
  await results().getByText(/Batch saved draft #\d+/).nth(1).waitFor({ timeout: 180_000 });
  assert.equal(await results().locator(".lead-row").count(), 2, "both drafted leads are listed");
  step("one batch drafted both leads, with a fake endpoint answering");
}

/** Writes and prints the printed story from its own workbench. */
async function printTheFirstStory() {
  const row = rowFor(printedHeadline);
  const href = await row.locator("a.hl-link").getAttribute("href");
  assert.match(href ?? "", /^\/desk\/story\/\d+$/, "the row opens its story workbench");
  await row.locator("a.hl-link").click();
  await page.getByLabel("Body").waitFor({ timeout: 45_000 });
  await page.getByLabel("Headline").fill(`Water tower inspection backlog ${stamp}`);
  await page.getByLabel("Dek").fill("The city has not inspected the tower since 2019.");
  /*
    The section a draft files under is read by a person before it prints, and a
    batch draft's section came from the model. Picking it here is that read.
  */
  const topic = page.locator("#story-topic-select");
  const values = await topic.locator("option").evaluateAll((nodes) => nodes.map((n) => n.value));
  await topic.selectOption(values.includes("council") ? "council" : values[0]);
  await confirmSectionAndWaitForPublishable(page);
  await page.getByRole("button", { name: /^Publish in / }).click();
  await page.getByRole("button", { name: /^Yes, print it in / }).click();
  await page.getByText("On the paper").waitFor({ timeout: 45_000 });
  step(`"${printedHeadline}" is printed, and its lead is now published`);
  return href;
}

async function main() {
  console.log(
    `  fake  ${await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
      FAKE_DEEPSEEK_PORT: String(PORT_BATCH_PANEL_MODEL),
      FAKE_DEEPSEEK_MODEL: modelId,
    })}`,
  );

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  try {
    await ownTheDesk();
    await saveTheFakeConnection();
    await fileTwoLeads();
    await draftBothAsOneBatch();
    await shot("queue-batch-before-print");
    const printedHref = await printTheFirstStory();

    /*
      The bug, in one assertion. The panel must have dropped the story the
      paper is now carrying -- and must still be showing the other one, or a
      panel that had simply vanished would pass this too.
    */
    await page.goto(`${base}/desk/queue`, { waitUntil: "domcontentloaded" });
    await results().getByText(/Batch saved draft #\d+/).first().waitFor({ timeout: 45_000 });
    assert.equal(
      await rowFor(openHeadline).count(),
      1,
      "the story still being worked must stay in the panel",
    );
    await shot("queue-after-print");
    assert.equal(
      await results().locator(`a[href="${printedHref}"]`).count(),
      0,
      "the printed story's row was still listed in the batch panel",
    );
    assert.equal(
      await results().getByText(printedHeadline).count(),
      0,
      "the printed story was still named in the batch panel",
    );
    step("the printed story left the panel and the open one stayed");

    await panel().getByRole("button", { name: "Dismiss", exact: true }).click();
    await results().waitFor({ state: "detached", timeout: 45_000 });
    await shot("queue-after-dismiss");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#draft-batch-heading").waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1_500);
    assert.equal(
      await results().count(),
      0,
      "a dismissed batch came back after a reload",
    );
    assert.equal(
      await page.getByRole("button", { name: "Dismiss", exact: true }).count(),
      0,
      "the dismissed batch still offered a Dismiss button",
    );
    await shot("queue-after-dismiss-reload");
    step("Dismiss put the batch away, and a reload agreed");

    assert.deepEqual(browserErrors, [], "the page reported no errors");
    console.log(
      JSON.stringify(
        { ok: true, base, modelBase, steps: done, screenshots: shots, browserErrors },
        null,
        2,
      ),
    );
  } catch (error) {
    await shot("queue-failure");
    await dump(error);
  } finally {
    await browser.close();
    stopFakes();
  }
}

await main();
