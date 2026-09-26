#!/usr/bin/env node
/**
 * The daily scan on Automatic, end to end through the desk (0.6.64, Unit AA).
 *
 * Before this walk the scheduled scan had to name ONE provider: the picker
 * refused Automatic with an `if (runtime !== "auto")` guard, because a
 * scheduled run stores the model it will use in its reservation and its run
 * record before the job is queued, and "your configured gateway at call time"
 * is not a name a stored record can keep. Unit AA lets the policy store and
 * run Automatic and resolves it to a real rung up front, so the run record
 * names what actually ran. This walk holds that end to end:
 *
 *  1. the owner sets the daily scan to Automatic in the browser and saves;
 *  2. the choice survives a real reload, and the ROW still reads "auto" -- a
 *     stored hand pick is never silently rewritten into Automatic, and
 *     Automatic is never rewritten into the rung it happened to resolve to;
 *  3. the scheduler's own trigger (GET /api/cron/monitors, the route the
 *     deployed cron hits) runs a real tick, which resolves Automatic by
 *     probing the ladder and reserves the run;
 *  4. the run record names the resolved model, as the requested -> resolved
 *     pair;
 *  5. the queued job actually WRITES: it fetches its source, calls rung 1's
 *     chat endpoint, files the lead the stub answered with, and completes.
 *
 * Model-free, the way the Y2 failover walks are: rung 1 (DeepSeek v4.1 Flash)
 * is an OpenAI-compatible endpoint, so the walk starts
 * scripts/fakes/fake-deepseek-endpoint.mjs on its own port and points
 * TOWNREPORTER_DEEPSEEK_BASE_URL at it. Rung 1 answers its readiness probe, so
 * the ladder stops there and neither a real DeepSeek account, a local LM
 * Studio, nor a subscription CLI is reached -- the walk FAILS loudly if the
 * run resolves to anything but rung 1, which is also what keeps a real Codex
 * from ever being started here.
 *
 * Step 5 is why this walk is not entirely offline, and the exception is worth
 * stating plainly: the scan's writing pass runs on the text it FETCHED, and
 * the desk's SSRF guard (url-guard.ts) refuses loopback, private and
 * unresolvable hosts with no escape hatch -- so a source this walk could serve
 * to itself is a source no scan is allowed to read. The accepted source is
 * therefore https://example.com/ (IANA's static example page, ~200 characters
 * of plain text) and the walk needs ONE outbound GET to it. Everything after
 * that GET is the stub: the text is written by the model call this walk
 * stubbed, and a run that fetched the page but reached a real provider would
 * still fail the assertions below. If the fetch yields no text the walk fails
 * with the desk's own reason rather than reporting a model problem.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";
import { completeFirstRunSetup } from "./first-run-setup-step.mjs";

/**
 * This walk's own listen ports, registered with
 * scripts/integration-ports-are-unique.test.mjs so no other integration file
 * can quietly bind one and answer this walk's requests.
 */
const PORT_DAILY_SCAN_AUTOMATIC = 3336;
const PORT_FAKE_DEEPSEEK = 3337;

const REPO = process.cwd();
const base = checkedUrl(`http://127.0.0.1:${PORT_DAILY_SCAN_AUTOMATIC}`);

/** Rung 1's registry entry (src/lib/news/provider-registry.ts, `deepseek-flash`). */
const RUNG_ONE_ID = "deepseek-flash";
const RUNG_ONE_LABEL = "DeepSeek v4.1 Flash";
const RUNG_ONE_MODEL = "deepseek-v4.1-flash:cloud";
const RUNG_ONE_BASE = `http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/v1`;
/**
 * The ladder sentence the Automatic option carries in its `title`. The middle
 * rung reads "Local model" since 0.6.69 (Unit AL item 4): it names no model of
 * its own, because it runs whatever LM Studio has loaded.
 */
const LADDER_SENTENCE = "DeepSeek v4.1 Flash, Local model, then Codex Terra";
/** What the closed picker shows for Automatic (label — optionDetail). */
const AUTOMATIC_OPTION_TEXT = "Automatic — Recommended ladder";
/** The secret this walk sets on its own server before booting it. */
const CRON_SECRET = "daily-scan-automatic-e2e-cron-secret";

const stamp = Date.now();
const email = `daily-scan-automatic-${stamp}@townreporter.test`;
const password = "daily-scan-automatic-e2e-pass";
const SOURCE_NAME = "Daily scan automatic source";
/**
 * The one host this walk fetches for real: the scan reads the text it fetched,
 * and the SSRF guard refuses every address this walk could serve itself (see
 * the header). IANA's example page is static, public, and has no rate limit
 * worth the name, and the walk asserts the fetch produced text rather than
 * assuming it.
 */
const SOURCE_URL = "https://example.com/";

let page;
const done = [];
const facts = [];
const fakes = [];

function step(name) {
  done.push(name);
  console.log(`  ok    ${name}`);
}

function must(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * A jsonb column read straight off the PGlite handle comes back as text, not
 * as the object `getSql()` hands the product (which parses it). Both shapes
 * mean the same receipt, so read either.
 */
function asRecord(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) ?? {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}

async function dump(err) {
  const message = err instanceof Error ? err.message : String(err);
  let url = "";
  let text = "";
  try {
    url = page?.url() ?? "";
    text = ((await page?.locator("body").innerText()) ?? "").slice(0, 1800);
  } catch {
    /* the page is already gone */
  }
  killFakes();
  console.error(JSON.stringify({ ok: false, error: message, url, text, completed: done }, null, 2));
  process.exit(1);
}

/** Start a fake and wait for its own "listening on" line, so no probe races its bind. */
function startFake(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(REPO, script)], {
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
    setTimeout(
      () => reject(new Error(`${script} never reported listening:\n${out.trim()}`)),
      15_000,
    );
  });
}

function killFakes() {
  for (const child of fakes) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

async function readJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** What the fake rung 1 has answered, in order. */
async function fakeLog() {
  return readJson(`http://127.0.0.1:${PORT_FAKE_DEEPSEEK}/__log`);
}

/** Poll a read-only check until it returns something truthy, or fail loudly. */
async function waitForTruth(describe, read, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    last = await read();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${describe}; last read ${JSON.stringify(last)}`);
}

/**
 * The state this walk cannot arrange for itself, checked loudly. Each of these
 * turns the run into a proof of something else, or of nothing.
 */
function preconditions() {
  const problems = [];
  if (process.env.LLM_BASE_URL) {
    problems.push(
      "LLM_BASE_URL is set: a configured gateway makes Automatic pin 'configured' and skip its " +
        "ladder entirely, so this walk would prove nothing about DeepSeek running first.",
    );
  }
  if (process.env.TOWNREPORTER_DEEPSEEK === "0") {
    problems.push(
      "TOWNREPORTER_DEEPSEEK=0 switches rung 1 off, so Automatic would start at the local rung.",
    );
  }
  const declared = (process.env.TOWNREPORTER_DEEPSEEK_BASE_URL || "").replace(/\/$/, "");
  if (declared && declared !== RUNG_ONE_BASE) {
    problems.push(
      `TOWNREPORTER_DEEPSEEK_BASE_URL is ${JSON.stringify(declared)}; this walk starts its own ` +
        `fake on ${RUNG_ONE_BASE} and would otherwise probe someone else's endpoint.`,
    );
  }
  if (process.env.TOWNREPORTER_QWEN === "0") {
    problems.push(
      "TOWNREPORTER_QWEN=0: harmless here (rung 1 answers), but the ladder this walk prints in the " +
        "option title would differ from the ladder it drives.",
    );
  }
  if (problems.length) throw new Error(`preconditions:\n  ${problems.join("\n  ")}`);
}

/**
 * Boot the built server here, in this process, on its own port and in-memory
 * PGlite (never the shared Postgres: DATABASE_URL is cleared below).
 *
 * The environment is arranged so rung 1 is ENABLED and READY: its registry
 * entry needs TOWNREPORTER_DEEPSEEK not "0", and either a base URL or a
 * discovered local server. The base URL points at the fake, and the model is
 * pinned to the one id the fake lists, because the readiness probe matches it
 * by exact id.
 */
async function bootTheServer() {
  process.env.PORT = String(PORT_DAILY_SCAN_AUTOMATIC);
  process.env.HOST = "127.0.0.1";
  process.env.DATABASE_URL = ""; // PGlite in memory; never the shared Postgres
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  process.env.BETTER_AUTH_SECRET ||= "daily-scan-automatic-e2e-secret";
  process.env.CRON_SECRET = CRON_SECRET;
  delete process.env.LLM_BASE_URL;
  delete process.env.TOWNREPORTER_DEEPSEEK;
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = RUNG_ONE_BASE;
  process.env.TOWNREPORTER_DEEPSEEK_MODEL = RUNG_ONE_MODEL;
  await import(pathToFileURL(join(REPO, ".output/server/index.mjs")).href);
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the built server never answered on ${base}`);
}

async function ownTheDesk() {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Create the desk|Editor sign-in/ }).waitFor();
  await page.getByLabel("Name").fill("Daily Scan Editor");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create editor account" }).click();
  await page.getByRole("link", { name: "Queue", exact: true }).waitFor({ timeout: 45_000 });
  await completeFirstRunSetup(page, base);
  step("the first account owns the desk");
}

async function addAcceptedSource() {
  await page.goto(`${base}/desk/sources`, { waitUntil: "domcontentloaded" });
  await page.getByText("Add a source", { exact: true }).click();
  await page.getByLabel("URL", { exact: true }).fill(SOURCE_URL);
  await page.getByLabel("Name", { exact: true }).fill(SOURCE_NAME);
  await page.getByRole("button", { name: "Add source" }).click();
  await page.getByText(`On watch: ${SOURCE_NAME}`).waitFor({ timeout: 45_000 });
  step("an accepted source is on watch, without being fetched");
}

/** The Daily scan panel on /desk/ops, opened the way an owner opens it. */
async function openDailyScanPanel() {
  await page.goto(`${base}/desk/ops`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("navigation", { name: "Server settings" })
    .getByRole("button", { name: "Daily scan", exact: true })
    .click();
  const panel = page.locator("section", {
    has: page.getByRole("heading", { name: "Daily scan", exact: true }),
  });
  await panel.getByRole("heading", { name: "Daily scan", exact: true }).waitFor({
    timeout: 45_000,
  });
  return panel;
}

/** Item 2: the picker offers Automatic, and says which ladder it means. */
async function theOwnerSwitchesTheScanToAutomatic(panel) {
  await panel.getByText("Timezone: America/Denver").waitFor({ timeout: 30_000 });
  const runtime = panel.getByLabel("Writing model");
  const automatic = runtime.locator('option[value="auto"]');
  must(
    (await automatic.count()) === 1,
    "the daily scan's model picker does not offer Automatic",
  );
  const optionText = (await automatic.innerText()).trim();
  must(
    optionText === AUTOMATIC_OPTION_TEXT,
    `the Automatic option reads ${JSON.stringify(optionText)}`,
  );
  const optionTitle = await automatic.getAttribute("title");
  must(
    Boolean(optionTitle?.includes(LADDER_SENTENCE)),
    `the Automatic option's title does not name the ladder: ${JSON.stringify(optionTitle)}`,
  );
  facts.push({ optionText, optionTitle });

  await runtime.selectOption("auto");
  await panel.getByLabel("Local time").fill("00:00");
  await panel.getByRole("checkbox", { name: /Run once each day/ }).check();
  await panel.getByRole("checkbox", { name: new RegExp(SOURCE_NAME) }).check();
  await panel.getByRole("button", { name: "Save daily scan" }).click();
  /*
    An ENABLED policy is validated before it is stored, and Automatic validates
    by probing the ladder -- so this save is also the first proof that rung 1
    answers. Generous timeout: the probe reaches the fake, not a real endpoint.
  */
  await panel.getByText("Daily scan settings saved.").waitFor({ timeout: 60_000 });
  step("the owner sets the daily scan to Automatic and it saves");
}

/** Item 2/3: it survives a reload, and the stored row still reads "auto". */
async function theChoiceSurvivesAReload() {
  await page.reload({ waitUntil: "domcontentloaded" });
  const panel = await openDailyScanPanel();
  must(
    (await panel.getByLabel("Writing model").inputValue()) === "auto",
    "the saved runtime did not persist as Automatic",
  );
  must(
    await panel.getByRole("checkbox", { name: /Run once each day/ }).isChecked(),
    "Run once each day did not persist",
  );
  must(
    await panel.getByRole("checkbox", { name: new RegExp(SOURCE_NAME) }).isChecked(),
    "the selected source did not persist",
  );
  const pg = await globalThis.__pgliteInstance__;
  must(Boolean(pg), "the server booted without a PGlite instance to read the policy from");
  const row = (
    await pg.query("select runtime, model_effort, enabled from daily_scan_policies")
  ).rows[0];
  must(
    row?.runtime === "auto",
    `the stored runtime is ${JSON.stringify(row?.runtime)}, not "auto"`,
  );
  facts.push({ storedRuntime: row.runtime, storedEffort: row.model_effort, enabled: row.enabled });
  step('Automatic survives a reload and is stored as "auto" -- never rewritten to a rung');
}

/**
 * The scheduler's own trigger. This is the route the deployed cron hits; it
 * reserves the run and writes the model receipt before the job is queued.
 */
async function theScheduledTickReservesTheRun() {
  const before = (await fakeLog())?.requests?.length ?? 0;
  const res = await fetch(`${base}/api/cron/monitors`, {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  must(res.ok, `the cron trigger answered ${res.status}: ${body.slice(0, 300)}`);

  const after = await fakeLog();
  // The readiness probe is `GET {baseUrl}/models`, and the fake labels it
  // "probe" itself, so this reads the fake's own classification rather than
  // re-deriving it from the URL.
  const probes = (after?.requests ?? []).filter((r) => r.class === "probe");
  must(
    (after?.requests?.length ?? 0) > before && probes.length > 0,
    "the tick never asked the stubbed rung 1 whether it was ready",
  );
  facts.push({ rungOneProbes: probes.length, cronBody: body.slice(0, 200) });

  const pg = await globalThis.__pgliteInstance__;
  const run = (
    await pg.query(
      "select execution_origin, model_snapshot from scan_runs order by id desc limit 1",
    )
  ).rows[0];
  must(Boolean(run), "the tick reserved no scan run at all");
  const snapshot = asRecord(run.model_snapshot);
  must(
    run.execution_origin === "scheduled" &&
      snapshot.requestedRuntime === "auto" &&
      snapshot.resolvedRuntime === RUNG_ONE_ID,
    `the run record is not the receipt this walk asked for: ${JSON.stringify(run)}`,
  );
  facts.push({
    executionOrigin: run.execution_origin,
    requestedRuntime: snapshot.requestedRuntime,
    resolvedRuntime: snapshot.resolvedRuntime,
    localModel: snapshot.localModel,
  });
  step("the scheduler's own trigger resolves Automatic to rung 1 and reserves the run");
}

/**
 * Item (d) of the Unit AA report, closed: the reserved job must actually WRITE
 * on the rung its record named.
 *
 * AA's walk stopped at the receipt, because the receipt is written by the tick
 * before the job is queued -- and the job then failed "Writing pass returned no
 * usable JSON." with the stub never asked to write. The lesson is that the
 * receipt and the run are two different facts: a scan can name DeepSeek and
 * still never reach it. So this step waits for the job to finish and reads the
 * writing pass's own trace: text was fetched, rung 1's chat endpoint answered
 * the scan call, nothing failed over, and the lead it replied with is on the
 * run.
 */
async function theQueuedJobWritesOnTheResolvedRung() {
  const pg = await globalThis.__pgliteInstance__;
  const job = await waitForTruth("the queued scheduled scan job to finish", async () => {
    const row = (
      await pg.query(
        "select id, kind, status, stage, error from desk_jobs order by id desc limit 1",
      )
    ).rows[0];
    return row && (row.status === "completed" || row.status === "failed") ? row : null;
  });
  must(
    job.status === "completed",
    `the scheduled scan job ended ${job.status} (stage ${JSON.stringify(job.stage)}): ` +
      `${JSON.stringify(job.error)}. A failed job here means the writing pass did not run on the ` +
      `rung the record named, which is the whole point of this walk.`,
  );

  const run = (
    await pg.query(
      // scan_runs has no status column of its own: a run's state is the
      // reservation's, which is what the panel's "Current or last run:" reads.
      "select r.error, r.sources_fetched, r.sources_attempted, r.model_batches_used, " +
        "r.model_batches_failed, r.leads_created, r.failed_sources, " +
        "(select status from daily_scan_reservations where scan_run_id = r.id) as run_status " +
        "from scan_runs r order by r.id desc limit 1",
    )
  ).rows[0];
  must(Boolean(run), "the completed job left no scan run to read");
  /*
    The source fetch first, and with its own message: the writing pass runs on
    text the scan fetched, so a run that fetched nothing would fail below for a
    reason that is not the model's. https://example.com/ is the walk's one real
    request; if a runner has no egress this line says so instead of blaming the
    stub.
  */
  must(
    run.sources_fetched >= 1,
    `the scan fetched no source text, so no writing pass could run ` +
      `(sources_attempted ${run.sources_attempted}, failed ${JSON.stringify(run.failed_sources)}, ` +
      `run error ${JSON.stringify(run.error)}). This walk needs one outbound GET of ${SOURCE_URL}.`,
  );
  must(
    run.model_batches_used >= 1 && run.model_batches_failed === 0 && run.run_status === "completed",
    `the run did not complete on its first rung: status ${JSON.stringify(run.run_status)}, ` +
      `batches ${run.model_batches_used} used / ${run.model_batches_failed} failed, ` +
      `error ${JSON.stringify(run.error)}`,
  );
  must(
    run.leads_created >= 1,
    `the writing pass answered but the run filed no lead (leads_created ${run.leads_created})`,
  );

  const log = await fakeLog();
  const scanCalls = (log?.requests ?? []).filter(
    (r) => r.class === "scan" && r.path.endsWith("/chat/completions"),
  );
  must(
    scanCalls.length === 1,
    `the stubbed rung received ${scanCalls.length} scan writing calls, expected exactly 1 ` +
      `(every request it saw: ${JSON.stringify((log?.requests ?? []).map((r) => [r.class, r.path]))})`,
  );
  facts.push({
    jobStatus: job.status,
    scanRun: {
      status: run.run_status,
      sourcesFetched: run.sources_fetched,
      modelBatchesUsed: run.model_batches_used,
      leadsCreated: run.leads_created,
    },
    stubScanCalls: scanCalls.length,
  });
  step("the queued job fetched its source, wrote on rung 1, filed the lead, and completed");
}

/** Item 6: the run record names the model that actually ran. */
async function theRunRecordNamesTheResolvedModel() {
  await page.reload({ waitUntil: "domcontentloaded" });
  const panel = await openDailyScanPanel();
  const statusLine = panel.locator("p", { hasText: /^Current or last run:/ });
  await statusLine.waitFor({ timeout: 30_000 });
  const statusText = (await statusLine.innerText()).replace(/\s+/g, " ").trim();
  /*
    `completed`, not "some terminal state": this reads the scheduled run whose
    writing pass the step before it proved, and the panel is the owner's view of
    that same row.
  */
  must(
    /^Current or last run: completed for \d{4}-\d{2}-\d{2}/.test(statusText),
    `the panel does not show today's run as completed: ${JSON.stringify(statusText)}`,
  );
  const modelLine = panel.locator("p", { hasText: /^Model:/ });
  must(
    (await modelLine.count()) === 1,
    `the panel shows ${await modelLine.count()} "Model:" lines, expected exactly one`,
  );
  const modelText = (await modelLine.innerText()).replace(/\s+/g, " ").trim();
  must(
    modelText === `Model: Automatic → ${RUNG_ONE_LABEL}`,
    `the run record says ${JSON.stringify(modelText)}, expected the requested -> resolved pair ` +
      `"Automatic → ${RUNG_ONE_LABEL}" -- anything else means the ladder resolved somewhere ` +
      `this walk did not stub, and the walk must not pass on it.`,
  );
  facts.push({ statusText, modelText });
  step("the run record names the resolved model, as requested -> resolved");
}

async function theScanHistoryListsTheRun() {
  await page.goto(`${base}/desk/scan`, { waitUntil: "domcontentloaded" });
  // Substring, never exact: the row's meta line is "<date> · Scheduled daily
  // scan" and the exact string is that whole sentence.
  await page.getByText("Scheduled daily scan").waitFor({ timeout: 45_000 });
  step("the scan history lists the scheduled run the tick reserved");
}

async function main() {
  preconditions();
  const fake = await startFake("scripts/fakes/fake-deepseek-endpoint.mjs", {
    FAKE_DEEPSEEK_PORT: String(PORT_FAKE_DEEPSEEK),
    FAKE_DEEPSEEK_MODEL: RUNG_ONE_MODEL,
    FAKE_DEEPSEEK_MODE: "ready",
  });
  console.log(`  fake  ${fake}`);
  await bootTheServer();

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  try {
    await ownTheDesk();
    await addAcceptedSource();
    const panel = await openDailyScanPanel();
    await theOwnerSwitchesTheScanToAutomatic(panel);
    await theChoiceSurvivesAReload();
    await theScheduledTickReservesTheRun();
    await theQueuedJobWritesOnTheResolvedRung();
    await theRunRecordNamesTheResolvedModel();
    await theScanHistoryListsTheRun();
  } catch (err) {
    await dump(err);
  }
  await browser.close();
  killFakes();
  console.log(
    JSON.stringify(
      { ok: true, steps: done.length, facts, consoleErrors: consoleErrors.slice(0, 10) },
      null,
      2,
    ),
  );
  process.exit(0);
}

await main();
