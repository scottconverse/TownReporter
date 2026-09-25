#!/usr/bin/env node
/**
 * Browser acceptance for the real Story failure that prompted this repair
 * (0.6.63 Unit Y2, on the new Automatic ladder).
 *
 * WHAT THIS PROVED FOR THE OLD LADDER. Codex Terra was rung 1 and Claude
 * Sonnet rung 2. An editor uploaded a real packet, left the writing model on
 * Automatic, and Codex's own readiness probe SUCCEEDED -- so the job was
 * enqueued on Codex -- and then its very first uploaded-document read came
 * back as a provider-shaped usage limit. Automatic had to move the same saved
 * document to the next rung and land a draft that still carried the packet's
 * exact evidence marker. The point was that the upload is retained across the
 * switch: the failure happened on the document read, not the write, and the
 * finished story proved the document survived it.
 *
 * WHAT IT PROVES NOW. Rung 1 is DeepSeek v4.1 Flash, an OpenAI-compatible
 * endpoint, so the readiness probe is a real HTTP GET and the document read is
 * a real HTTP POST -- this walk starts a fake of that endpoint
 * (scripts/fakes/fake-deepseek-endpoint.mjs) in its quota mode: /models
 * answers 200 (the rung is genuinely ready and gets pinned BEFORE the job
 * exists), /chat/completions answers a provider-shaped 429 (the rung is
 * genuinely out of quota moments later). Rung 2, Qwen 3.6 35B, is skipped for
 * the reason the desk now records -- "not loaded" -- via
 * scripts/fakes/fake-lmstudio-endpoint.mjs on port 1234. Rung 3 is
 * scripts/fakes/fake-codex-cli.mjs with FAKE_CODEX_VALID_DRAFT=1, and it is
 * Codex Terra that reads the retained document and writes the story.
 *
 * So the SAME shape is proven against the new ladder, and one thing more: the
 * receipt on the job row names the model Automatic actually pinned (rung 1,
 * caught by the page's own poll before the hop rewrites it), then names Codex
 * Terra as what ran while still saying Automatic was asked for -- not just the
 * model it ended on. What it does NOT name is the rung the mid-run hop passed
 * over on its way: `planAutomaticFailover` returns only {next,label,reason}
 * (automatic-failover.ts:158-184) and the hop writes only the choice, the stage
 * and the note (desk.ts:1375), so a runtime hop's skipped rung lives in no
 * column at all. This walk asserts that absence instead of asserting a key the
 * product never writes; the rung that IS recorded as skipped -- at preflight,
 * where the ladder really walks past one -- is scripts/failover-e2e.mjs's
 * draft 1. The fake's delay stands in for provider thinking time so the running
 * job can actually be observed in both states -- pinned, then switched.
 *
 *   STORY_QUOTA_FAILOVER_BASE_URL=http://127.0.0.1:3320 \
 *   TOWNREPORTER_DEEPSEEK_BASE_URL=http://127.0.0.1:3321/v1 \
 *   CODEX_CLI_PATH=scripts/fakes/fake-codex-cli.mjs \
 *   FAKE_CODEX_SIGNED_IN=1 FAKE_CODEX_VALID_DRAFT=1 FAKE_CODEX_DELAY_MS=1500 \
 *   node scripts/story-quota-failover-e2e.mjs
 *
 * On a machine that already runs LM Studio on 1234 with the rung's own model
 * loaded, run with TOWNREPORTER_QWEN_MODEL set to a model that server does NOT
 * have; the walk checks this and says so rather than quietly calling it.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fromCrossJSON } from "seroval";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";
import { LMSTUDIO_BASE, LMSTUDIO_PORT } from "./fakes/lmstudio-address.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** This walk's own listen ports; see scripts/integration-ports-are-unique.test.mjs. */
const PORT_STORY_QUOTA_FAILOVER = 3320;
const PORT_FAKE_DEEPSEEK = 3321;
/* Rung 2's server is not a port of this walk's own: it is LM Studio's address,
   imported so both ladder walks share one declaration (./fakes/lmstudio-address.mjs). */

const DEEPSEEK_BASE = `http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/v1`;

// Verbatim from src/lib/news/provider-registry.ts and automatic-failover.ts.
const DEEPSEEK_LABEL = "DeepSeek v4.1 Flash";
const TERRA_LABEL = "Codex Terra";
const SWITCH_NOTE = `This draft moved to ${TERRA_LABEL} because ${DEEPSEEK_LABEL} reached its usage limit`;
const QWEN_MODEL = (process.env.TOWNREPORTER_QWEN_MODEL || "halo/qwen3.6-35b-a3b").trim();

/**
 * Long enough that the pinned-but-not-yet-failed job is observable between the
 * page's 2s polls (the receipt has to be caught naming rung 1), while standing
 * in for nothing more than a provider taking its time to answer.
 */
const DEEPSEEK_DELAY_MS = 4_000;

const base = checkedUrl(
  process.env.STORY_QUOTA_FAILOVER_BASE_URL || `http://127.0.0.1:${PORT_STORY_QUOTA_FAILOVER}`,
).replace(/\/$/, "");
const stamp = Date.now();
const marker = `AUTOMATIC_DOCUMENT_MARKER_${stamp}`;
const email = `story-quota-${stamp}@townreporter.test`;
const password = "story-quota-e2e-pass";
const snapshots = [];
const completed = [];
const fakes = [];
let page;

function step(text) {
  completed.push(text);
  console.log(`  ok    ${text}`);
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

/** Start a fake and wait for its own "listening on" line, so nothing races the bind. */
function startFake(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    fakes.push(child);
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      if (line) resolve(line.trim());
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) =>
      reject(new Error(`${script} exited with ${code} before it listened:\n${out.trim()}`)),
    );
    setTimeout(() => reject(new Error(`${script} never reported listening:\n${out.trim()}`)), 15_000);
  });
}

async function readJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The state this walk cannot arrange for itself, checked loudly. */
function preconditions() {
  const problems = [];
  const declared = (process.env.TOWNREPORTER_DEEPSEEK_BASE_URL || "").replace(/\/$/, "");
  if (declared !== DEEPSEEK_BASE) {
    problems.push(
      `TOWNREPORTER_DEEPSEEK_BASE_URL must be ${DEEPSEEK_BASE} (the fake this walk starts); got ` +
        `${JSON.stringify(process.env.TOWNREPORTER_DEEPSEEK_BASE_URL ?? null)}. Without it rung 1 ` +
        `is not enabled and the ladder is two rungs.`,
    );
  }
  if (process.env.LLM_BASE_URL) {
    problems.push("LLM_BASE_URL is set: automatic pinning 'configured' would skip the whole ladder.");
  }
  if (process.env.FAKE_CODEX_VALID_DRAFT !== "1") {
    problems.push(
      "FAKE_CODEX_VALID_DRAFT=1 is required: rung 3's fake CLI has to answer as the CURRENT ladder.",
    );
  }
  if (process.env.FAKE_CODEX_SIGNED_IN !== "1") {
    problems.push("FAKE_CODEX_SIGNED_IN=1 is required, or rung 3 is not ready and nothing hops.");
  }
  if (process.env.FAKE_CODEX_QUOTA_PROMPTS === "1" || process.env.FAKE_CODEX_FAIL_PROMPTS === "1") {
    problems.push(
      "FAKE_CODEX_QUOTA_PROMPTS/FAIL_PROMPTS is set: Codex is the destination now, not the source. " +
        "The usage limit belongs to the fake endpoint (FAKE_DEEPSEEK_MODE=quota).",
    );
  }
  for (const off of ["TOWNREPORTER_DEEPSEEK", "TOWNREPORTER_QWEN", "TOWNREPORTER_CODEX"]) {
    if (process.env[off] === "0") problems.push(`${off}=0 switches that rung off.`);
  }
  if (process.env.TOWNREPORTER_LOCAL_DISCOVERY === "0") {
    problems.push(
      'TOWNREPORTER_LOCAL_DISCOVERY=0: rung 2\'s skip reads "its server did not answer", not "not loaded".',
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/** Rung 2's server: the fake in CI, the machine's own LM Studio if one is already up. */
async function ensureRungTwoServer() {
  const live = await readJson(`${LMSTUDIO_BASE}/models`);
  if (live) {
    const ids = (live.data ?? []).map((entry) => entry?.id).filter((id) => typeof id === "string");
    if (ids.includes(QWEN_MODEL)) {
      throw new Error(
        `a server is already on ${LMSTUDIO_BASE} and lists ${QWEN_MODEL}, so rung 2 would be tried ` +
          `for real. Run this walk with TOWNREPORTER_QWEN_MODEL=<a model that server does not have>.`,
      );
    }
    return `kept the server already on ${LMSTUDIO_BASE}; it does not list ${QWEN_MODEL} (no fake started)`;
  }
  const line = await startFake("scripts/fakes/fake-lmstudio-endpoint.mjs", {
    FAKE_LMSTUDIO_PORT: String(LMSTUDIO_PORT),
  });
  return `${line} -- started because nothing answered on ${LMSTUDIO_BASE}`;
}

async function main() {
  preconditions();

  // Rung 1 is READY from the start (its probe answers 200, so the preflight
  // pins it) and out of quota by the time a document read arrives.
  console.log(
    `  fake  ${await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
      FAKE_DEEPSEEK_PORT: String(PORT_FAKE_DEEPSEEK),
      FAKE_DEEPSEEK_MODE: "quota",
      FAKE_DEEPSEEK_DELAY_MS: String(DEEPSEEK_DELAY_MS),
    })}`,
  );
  console.log(`  fake  ${await ensureRungTwoServer()}`);

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  // Same wire channel the desk's own 2s polling uses (desk.story.$leadId.tsx):
  // a desk_jobs row always carries `stage` and `model_choice` as strings, which
  // is how a getLead response is told apart from every other server function,
  // on dev and on a built server alike.
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
    .fill("Write a short news story from the attached packet and preserve its exact evidence marker.");
  await page.getByText("Research & section", { exact: false }).click();
  await page.getByLabel("Drafting scope").selectOption("supplied");
  assert.doesNotMatch(await page.locator("#story-composer").innerText(), /Codex does not support/i);
  assert.equal(await page.getByLabel("Writing model").inputValue(), "auto");
  step("attached a real text document and kept Automatic with supplied material only");

  await page.getByRole("button", { name: "Write draft", exact: true }).click();
  await page.getByRole("heading", { name: "Story workspace", exact: true }).waitFor();

  const visibleSwitch = page
    .getByText(`Model switch: ${SWITCH_NOTE}`, { exact: true })
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
  assert.equal(
    finished.job.model_choice,
    "codex-balanced",
    "The finished job should be on rung 3 after rung 1's usage limit",
  );
  assert.equal(finished.job.failover_note, SWITCH_NOTE);
  const receipt = JSON.parse(finished.job.result_json || "{}");
  assert.equal(receipt.requestedRuntime, "auto", `receipt: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.actualRuntime, "codex-balanced", `receipt: ${JSON.stringify(receipt)}`);
  // No skippedRungs: rung 1 answered this job's own preflight probe, so the
  // ladder passed nothing over at enqueue and model-runtime-receipt.ts:34 writes
  // no key at all. The rung the LATER hop passed over is recorded nowhere -- see
  // the header; the recorded-skip case is scripts/failover-e2e.mjs's draft 1.
  assert.equal(
    receipt.skippedRungs,
    undefined,
    `receipt should carry no skippedRungs (nothing was skipped at enqueue): ${JSON.stringify(receipt)}`,
  );
  assert.equal(receipt.preflightFailover, null, `receipt: ${JSON.stringify(receipt)}`);
  step(`the finished job's receipt asks for "auto" and names "codex-balanced" as what ran`);

  // Before the hop the same job was pinned to rung 1 -- the receipt named the
  // model Automatic had actually resolved, not the one it ended on. This is
  // the state the desk's 2s poll has to be able to see, hence the fake's delay.
  const pinned = snapshots.find(
    (entry) => entry.job.status === "running" && entry.job.model_choice === "deepseek-flash",
  );
  assert.ok(
    pinned,
    `Never observed the running job pinned to rung 1: ${JSON.stringify(
      snapshots.map((entry) => [entry.job.status, entry.job.model_choice, entry.job.stage]),
    )}`,
  );
  assert.equal(JSON.parse(pinned.job.result_json || "{}").actualRuntime, "deepseek-flash");
  const sawDurableSwitchWhileRunning = snapshots.some(
    (entry) => entry.job.status === "running" && entry.job.failover_note === SWITCH_NOTE,
  );
  assert.equal(
    sawDurableSwitchWhileRunning,
    true,
    "The running Story job never exposed its durable provider switch",
  );
  step("the running job showed rung 1 pinned, then the durable switch to Codex Terra");

  // The wire, not just the row: rung 1 was asked to prove itself and then to
  // read the document, and every one of those document reads came back out of
  // quota. Nothing else was ever sent to rung 1 -- the hop happened there.
  const log = await readJson(`http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/__log`);
  assert.ok(log, "fake-deepseek never answered GET /__log");
  const probes = log.requests.filter((entry) => entry.class === "probe");
  const documents = log.requests.filter((entry) => entry.class === "document");
  const leaked = log.requests.filter(
    (entry) => entry.class === "research" || entry.class === "write",
  );
  assert.ok(
    probes.some((entry) => entry.status === 200),
    `rung 1's readiness probe never answered 200: ${JSON.stringify(log.requests)}`,
  );
  assert.ok(documents.length >= 1, `rung 1 was never asked to read the document: ${JSON.stringify(log.requests)}`);
  assert.ok(
    documents.every((entry) => entry.status === 429),
    `a document read did not come back as a usage limit: ${JSON.stringify(documents)}`,
  );
  assert.deepEqual(leaked, [], `rung 1 was asked to draft after the hop: ${JSON.stringify(leaked)}`);
  step(`rung 1 answered the probe with 200 and ${documents.length} document read(s) with 429, nothing more`);

  const body = await page.getByLabel("Body").inputValue();
  assert.match(
    body,
    new RegExp(marker),
    "Codex Terra's draft did not contain the uploaded document marker",
  );
  assert.doesNotMatch(await page.locator("body").innerText(), /failed Opinion request/i);
  step("Codex Terra read the retained upload and its marker reached the finished story");

  await browser.close();
  stopFakes();
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(
    JSON.stringify(
      {
        ok: true,
        marker,
        completed,
        receipt,
        rungOneTraffic: log.requests,
        finishedJob: finished.job,
      },
      null,
      2,
    ),
  );
}

main().catch(async (error) => {
  const body = await page
    ?.locator("body")
    .innerText()
    .catch(() => "");
  stopFakes();
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
