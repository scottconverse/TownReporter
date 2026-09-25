import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";

/*
  An Automatic daily scan must WRITE on the rung its record named.

  Unit AA proved the receipt: the tick resolves Automatic up front, so the run
  record says requested "auto" / resolved "deepseek-flash". Unit AA's own walk
  then showed what a receipt is worth on its own -- the queued job failed
  "Writing pass returned no usable JSON." while the stubbed rung was probed four
  times and never asked to write.

  Two separate causes were measured, and this file holds both shut:

  1. the stub answered the scan's writing pass with a DRAFT shape
     (scripts/fakes/fake-deepseek-endpoint.mjs), which `parseScanResult` refuses
     because it accepts only `leads` / `editor_summary` / `proposed_sources`;
  2. the walk's own source could not be fetched, so no writing pass ran at all.

  This file is the model half, at the seam where it can be pinned: the real
  schedule path (`runDailyScanWork` -> `performScanWork` -> `runScanChatWithFailover`
  -> `runForcedChat` -> `grokChat`) is left intact, with NOTHING injected for the
  model, and the only stub is the endpoint itself -- so a test that passes here
  is evidence that the writing pass really does call the resolved rung's HTTP
  endpoint. The source text is injected (`ingestUrl`) purely because the desk's
  SSRF guard refuses any host a test could serve locally; the fetch is a
  different fact, and the browser walk is what holds it.

  The second case is the owner's real failover: the rung answers its readiness
  probe but hits its usage limit on the writing call, so the run must move to
  the next ready rung and say so in the switch note -- not fail the scan.
*/

let vite: ViteDevServer;
let getPglite: typeof import("../db.ts").getPglite;
let getSql: typeof import("../db.ts").getSql;
let performScanWork: typeof import("./desk.ts").performScanWork;
let runDailyScanWork: typeof import("./daily-scan.server.ts").runDailyScanWork;
let validateForcedRuntime: typeof import("./forced-runtime.server.ts").validateForcedRuntime;

const RUNG_ONE_ID = "deepseek-flash";
/** Rung 3 of `automaticLadder()`, the one after Qwen (off in this file). */
const RUNG_THREE_ID = "codex-balanced";
const RUNG_ONE_MODEL = "deepseek-v4.1-flash:cloud";
/** The one model id the stub lists; the readiness probe matches it exactly. */
const SOURCE_URL = "https://example.test/agenda";
const SOURCE_TEXT =
  "Council votes Tuesday on a water contract. The agenda lists the contract as item 7.";

let fake: ChildProcess | undefined;
let fakeBaseUrl = "";

/** Start the stub on an OS-chosen port and read the port back off its own line. */
async function startFake(): Promise<string> {
  const child = spawn(process.execPath, [join(process.cwd(), "scripts/fakes/fake-deepseek-endpoint.mjs")], {
    env: {
      ...process.env,
      FAKE_DEEPSEEK_PORT: "0",
      FAKE_DEEPSEEK_MODEL: RUNG_ONE_MODEL,
      FAKE_DEEPSEEK_MODE: "ready",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  fake = child;
  return new Promise<string>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      const line = out.split("\n").find((text) => text.includes("listening on"));
      const port = line?.match(/:(\d+)\/v1/)?.[1];
      if (port) resolve(`http://127.0.0.1:${port}/v1`);
    });
    child.stderr.on("data", (chunk) => (out += String(chunk)));
    child.on("exit", (code) => reject(new Error(`the stub exited with ${code} before it listened:\n${out}`)));
    setTimeout(() => reject(new Error(`the stub never reported listening:\n${out}`)), 15_000);
  });
}

/** What the stub has answered, in order. */
async function fakeLog(): Promise<{ requests: { class: string; path: string; mode: string }[] }> {
  const res = await fetch(`${fakeBaseUrl.replace(/\/v1$/, "")}/__log`, {
    signal: AbortSignal.timeout(2_000),
  });
  return (await res.json()) as { requests: { class: string; path: string; mode: string }[] };
}

async function setScanMode(mode: string | null): Promise<void> {
  await fetch(`${fakeBaseUrl.replace(/\/v1$/, "")}/__mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanMode: mode }),
  });
}

before(async () => {
  fakeBaseUrl = await startFake();
  /*
    Arranged so the ladder is exactly two rungs this test controls: rung 1 is
    the stub, Qwen is switched off (its own rung would be reached on a machine
    with LM Studio running and would answer for real), and the Codex rung runs
    the repository's own CLI stub.
  */
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = fakeBaseUrl;
  process.env.TOWNREPORTER_DEEPSEEK_MODEL = RUNG_ONE_MODEL;
  delete process.env.TOWNREPORTER_DEEPSEEK;
  delete process.env.LLM_BASE_URL;
  process.env.TOWNREPORTER_QWEN = "0";
  process.env.CODEX_CLI_PATH = join(process.cwd(), "scripts/fakes/fake-codex-cli.mjs");
  process.env.FAKE_CODEX_SIGNED_IN = "1";
  process.env.FAKE_CODEX_VALID_DRAFT = "1";

  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getPglite, getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performScanWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ runDailyScanWork } = await vite.ssrLoadModule("/src/lib/news/daily-scan.server.ts"));
  ({ validateForcedRuntime } = await vite.ssrLoadModule("/src/lib/news/forced-runtime.server.ts"));
  await getPglite();
});
after(async () => {
  fake?.kill();
  await vite.close();
});

/**
 * One scheduled run of an Automatic scan, arranged exactly as the tick leaves
 * it: the reservation carries the resolved rung snapshot, the run is open, and
 * the job is claimed by this "worker".
 */
async function seedScheduledRun(runtime: "deepseek-flash" | "codex-terra") {
  const sql = await getSql();
  // scan_runs.daily_reservation_id has no ON DELETE, so the runs go first.
  await sql.query("delete from leads where newsroom_id=1");
  await sql.query("delete from scan_runs where newsroom_id=1");
  await sql.query("delete from daily_scan_reservations where newsroom_id=1");
  await sql.query("delete from desk_jobs where newsroom_id=1");
  await sql.query("delete from daily_scan_policies where newsroom_id=1");
  await sql.query("delete from sources where newsroom_id=1");
  await sql.query("delete from newsroom_members where newsroom_id=1");
  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values('auto-owner','owner',1)",
  );
  const [source] = await sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values('auto-owner',1,$1,'Agenda','official','A','accepted') returning id",
    [SOURCE_URL],
  );
  await sql.query(
    "insert into daily_scan_policies(newsroom_id,enabled,paused,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id) values(1,true,false,'06:00','auto',12,$1::jsonb,1,'auto-owner')",
    [JSON.stringify([source.id])],
  );
  const sourceSnapshot = [
    {
      id: source.id,
      url: SOURCE_URL,
      title: "Agenda",
      kind: "official",
      tier: "A",
      status: "accepted",
      last_hash: null,
      last_fetched_at: null,
      last_error: null,
    },
  ];
  /*
    The snapshot the desk would store for Automatic: the rung's own resolve
    step, not a hand-written object -- so this test cannot pass on a snapshot
    shape the product would never write.
  */
  const rung = await validateForcedRuntime(1, runtime, null, { automaticRung: true });
  const stored = {
    ...rung,
    requestedRuntime: "auto",
    requestedEffort: null,
    resolvedRuntime: runtime,
    switchReason: null,
    switchNote: null,
  };
  const [reservation] = await sql.query<{ id: number }>(
    "insert into daily_scan_reservations(newsroom_id,local_day,status,policy_revision,policy_snapshot,source_snapshot,model_snapshot) values(1,'2026-09-25','running',1,'{}',$1::jsonb,$2::jsonb) returning id",
    [JSON.stringify(sourceSnapshot), JSON.stringify(stored)],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id,execution_origin,daily_reservation_id,model_snapshot) values('auto-owner',1,'scheduled',$1,$2::jsonb) returning id",
    [reservation.id, JSON.stringify(stored)],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values(1,'auto-owner','scan',$1,$2,'scheduled','default','running','Working','auto-lease') returning id",
    [run.id, rung.modelChoice],
  );
  await sql.query("update daily_scan_reservations set scan_run_id=$1,desk_job_id=$2 where id=$3", [
    run.id,
    jobRow.id,
    reservation.id,
  ]);
  const job = {
    id: jobRow.id,
    newsroom_id: 1,
    user_id: "auto-owner",
    kind: "scan",
    subject_id: run.id,
    model_choice: rung.modelChoice,
    model_choice_source: "scheduled",
    lane: "default",
    status: "running",
    stage: "Working",
    failover_note: "",
    error: null,
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    claim_token: "auto-lease",
  } as DeskJob;
  return { job, runId: run.id, reservationId: reservation.id, sourceId: source.id };
}

/** Run the scheduled work with the REAL model adapters: only the source is injected. */
async function runTheScheduledWork(job: DeskJob) {
  await runDailyScanWork(job, {
    performScan: (workJob, workDeps) => performScanWork(workJob, workDeps),
    scanDeps: {
      ingestUrl: async () => ({ text: SOURCE_TEXT, extras: [] }),
      setJobStage: async () => undefined,
    },
  });
}

it("the writing pass of an Automatic scan calls the resolved rung's own endpoint", async () => {
  const { job, runId, reservationId } = await seedScheduledRun(RUNG_ONE_ID);
  await setScanMode(null);
  const before = (await fakeLog()).requests.length;

  await runTheScheduledWork(job);

  const scanCalls = (await fakeLog()).requests
    .slice(before)
    .filter((r) => r.class === "scan" && r.path.endsWith("/chat/completions"));
  assert.equal(
    scanCalls.length,
    1,
    "the resolved rung's endpoint was not asked to write the scan exactly once",
  );

  const sql = await getSql();
  // scan_runs carries no status column of its own: the run's state is the
  // reservation's (that is what the panel's "Current or last run:" reads).
  const [run] = await sql.query<{
    reservation_status: string;
    model_batches_used: number;
    model_batches_failed: number;
    leads_created: number;
  }>(
    "select (select status from daily_scan_reservations where scan_run_id=r.id) as reservation_status, " +
      "r.model_batches_used, r.model_batches_failed, r.leads_created from scan_runs r where r.id=$1",
    [runId],
  );
  assert.deepEqual(run, {
    reservation_status: "completed",
    model_batches_used: 1,
    model_batches_failed: 0,
    leads_created: 1,
  });
  const [lead] = await sql.query<{ headline: string; source_urls: string }>(
    "select headline,source_urls from leads where scan_run_id=$1",
    [runId],
  );
  // The stub's scan-shaped answer, filed: proof the reply the rung sent was
  // read as a scan rather than rejected as an unreadable draft.
  assert.match(lead.headline, /ran the scheduled scan's writing pass/);
  assert.match(lead.source_urls, /example\.test/);
  const [reservation] = await sql.query<{ status: string; model_snapshot: unknown }>(
    "select status,model_snapshot from daily_scan_reservations where id=$1",
    [reservationId],
  );
  assert.equal(reservation.status, "completed");
  const receipt = reservation.model_snapshot as Record<string, unknown>;
  assert.equal(receipt.requestedRuntime, "auto");
  assert.equal(receipt.resolvedRuntime, RUNG_ONE_ID);
  assert.equal(receipt.switchNote, null);
});

it("a usage limit on the writing pass moves the run to the next rung, and says so", async () => {
  const { job, runId } = await seedScheduledRun(RUNG_ONE_ID);
  await setScanMode("quota");
  const before = (await fakeLog()).requests.length;

  try {
    await runTheScheduledWork(job);
  } finally {
    await setScanMode(null);
  }

  const requests = (await fakeLog()).requests.slice(before);
  const scanCalls = requests.filter((r) => r.class === "scan");
  /*
    More than one, and that is the transport's doing, not the desk's: grokChat
    itself re-asks once when an OpenAI-compatible endpoint answers 429 or 5xx
    (ai.ts), so a rung that is really out of allowance is asked twice before
    the writing pass reports the failure and the hop below happens.
  */
  assert.ok(scanCalls.length >= 1, "the writing pass never reached the first rung");
  assert.deepEqual(
    [...new Set(scanCalls.map((r) => r.mode))],
    ["quota"],
    "every writing call on the first rung should have hit its limit",
  );

  const sql = await getSql();
  const [run] = await sql.query<{
    reservation_status: string;
    leads_created: number;
    model_snapshot: string;
  }>(
    "select (select status from daily_scan_reservations where scan_run_id=r.id) as reservation_status, " +
      "r.leads_created, r.model_snapshot from scan_runs r where r.id=$1",
    [runId],
  );
  assert.equal(run.reservation_status, "completed");
  // The Codex CLI stub's scan answer, filed -- so the rung the desk moved to
  // parsed as a scan too, and no real Codex was started (the stub is the path).
  const [lead] = await sql.query<{ headline: string }>(
    "select headline from leads where scan_run_id=$1",
    [runId],
  );
  assert.match(lead.headline, /Codex Terra completed the scheduled scan/);

  // scan_runs.model_snapshot is a text column holding the stored JSON.
  const receipt = JSON.parse(run.model_snapshot) as Record<string, unknown>;
  assert.equal(receipt.resolvedRuntime, RUNG_THREE_ID);
  // What the owner asked for does not change when the desk moves: the run is
  // still an Automatic one, and its record says so after the hop.
  assert.equal(receipt.requestedRuntime, "auto");
  assert.match(String(receipt.switchReason), /usage limit/i);
  assert.match(String(receipt.switchNote), /usage limit/i);
  const [row] = await sql.query<{ model_choice: string; model_choice_source: string }>(
    "select model_choice,model_choice_source from desk_jobs where id=$1",
    [job.id],
  );
  assert.deepEqual(row, { model_choice: "codex-balanced", model_choice_source: "scheduled" });
});
