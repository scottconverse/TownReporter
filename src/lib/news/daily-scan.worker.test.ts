import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

let vite: ViteDevServer;
let getPglite: typeof import("../db.ts").getPglite;
let getSql: typeof import("../db.ts").getSql;
let performScanWork: typeof import("./desk.ts").performScanWork;
let runDailyScanWork: typeof import("./daily-scan.server.ts").runDailyScanWork;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getPglite, getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performScanWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ runDailyScanWork } = await vite.ssrLoadModule("/src/lib/news/daily-scan.server.ts"));
  await getPglite();
});
after(async () => vite.close());

it("the scheduled worker persists actual scan outputs through its fenced commit", async () => {
  const sql = await getSql();
  await sql.query("delete from daily_scan_reservations where newsroom_id=1");
  await sql.query("delete from desk_jobs where newsroom_id=1");
  await sql.query("delete from daily_scan_policies where newsroom_id=1");
  await sql.query("delete from newsroom_members where newsroom_id=1");
  await sql.query("delete from sources where newsroom_id=1");
  await sql.query("delete from leads where newsroom_id=1");
  await sql.query("delete from scan_runs where newsroom_id=1");

  await sql.query(
    "insert into newsroom_members(user_id,role,newsroom_id) values('daily-owner','owner',1)",
  );
  const [source] = await sql.query<{ id: number }>(
    "insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values('daily-owner',1,'https://example.test/agenda','Agenda','official','A','accepted') returning id",
  );
  await sql.query(
    "insert into daily_scan_policies(newsroom_id,enabled,paused,local_time,runtime,source_cap,selected_source_ids,revision,configured_by_user_id) values(1,true,false,'06:00','codex-terra',12,$1::jsonb,1,'daily-owner')",
    [JSON.stringify([source.id])],
  );
  const sourceSnapshot = [
    {
      id: source.id,
      url: "https://example.test/agenda",
      title: "Agenda",
      kind: "official",
      tier: "A",
      status: "accepted",
      last_hash: null,
      last_fetched_at: null,
      last_error: null,
    },
  ];
  const [reservation] = await sql.query<{ id: number }>(
    "insert into daily_scan_reservations(newsroom_id,local_day,status,policy_revision,policy_snapshot,source_snapshot,model_snapshot) values(1,'2026-09-07','running',1,'{}',$1::jsonb,$2::jsonb) returning id",
    [
      JSON.stringify(sourceSnapshot),
      JSON.stringify({
        runtime: "codex-terra",
        modelChoice: "codex-balanced",
        transport: "codex",
        model: "selected-terra",
      }),
    ],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id,execution_origin,daily_reservation_id) values('daily-owner',1,'scheduled',$1) returning id",
    [reservation.id],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token) values(1,'daily-owner','scan',$1,'codex-balanced','scheduled','default','running','Working','worker-lease') returning id",
    [run.id],
  );
  await sql.query("update daily_scan_reservations set scan_run_id=$1,desk_job_id=$2 where id=$3", [
    run.id,
    jobRow.id,
    reservation.id,
  ]);

  const job = {
    id: jobRow.id,
    newsroom_id: 1,
    user_id: "daily-owner",
    kind: "scan",
    subject_id: run.id,
    model_choice: "codex-balanced",
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
    claim_token: "worker-lease",
  };

  let codexCalls = 0;
  const oldOpenAi = process.env.OPENAI_API_KEY;
  const oldAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = "must-not-be-used";
  process.env.ANTHROPIC_API_KEY = "must-not-be-used";
  try {
    await runDailyScanWork(job, {
      performScan: (workJob, workDeps) => performScanWork(workJob, workDeps),
      scanDeps: {
        ingestUrl: async () => ({ text: "Council votes Tuesday on a water contract.", extras: [] }),
        setJobStage: async () => undefined,
      },
      chatAdapters: {
        claude: async () => {
          throw new Error("Claude must not be called");
        },
        local: async () => {
          throw new Error("local must not be called");
        },
        codex: async () => {
          codexCalls += 1;
          return {
            ok: true as const,
            text: JSON.stringify({
              editor_summary: "Council has a contract vote.",
              leads: [
                {
                  headline: "Council schedules water contract vote",
                  why: "The vote is Tuesday.",
                  topic: "council",
                  source_urls: ["https://example.test/agenda"],
                  evidence: "Council votes Tuesday on a water contract.",
                  newsworthiness: 10,
                },
              ],
              proposed_sources: [],
            }),
            provider: "codex" as const,
            model: "selected-terra",
          };
        },
      },
    });
  } finally {
    if (oldOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAi;
    if (oldAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldAnthropic;
  }

  assert.equal(codexCalls, 1);
  assert.equal(
    (await sql.query("select 1 from snapshots where source_id=$1", [source.id])).length,
    1,
  );
  assert.equal((await sql.query("select 1 from leads where scan_run_id=$1", [run.id])).length, 1);
  const [savedRun] = await sql.query<{ leads_created: number; execution_origin: string }>(
    "select leads_created,execution_origin from scan_runs where id=$1",
    [run.id],
  );
  assert.deepEqual(savedRun, { leads_created: 1, execution_origin: "scheduled" });
  const [savedReservation] = await sql.query<{ status: string }>(
    "select status from daily_scan_reservations where id=$1",
    [reservation.id],
  );
  assert.equal(savedReservation.status, "completed");

  await sql.query("delete from snapshots where source_id=$1", [source.id]);
  await sql.query("delete from leads where scan_run_id=$1", [run.id]);
  await sql.query("delete from audit_events where newsroom_id=1 and action='scan'");
  await sql.query("delete from sources where newsroom_id=1 and id<>$1", [source.id]);
  await sql.query(
    "update sources set last_hash='baseline-hash',last_fetched_at=null,last_error='baseline-error' where id=$1",
    [source.id],
  );
  await sql.query(
    "update scan_runs set finished_at=null,sources_fetched=0,leads_created=0,summary=null,error=null where id=$1",
    [run.id],
  );
  await sql.query(
    "update daily_scan_reservations set status='running',finished_at=null,error=null where id=$1",
    [reservation.id],
  );
  await sql.query(
    "update daily_scan_policies set paused=false,pause_reason=null where newsroom_id=1",
  );
  let boundaryError: unknown;
  try {
    await runDailyScanWork(job, {
      performScan: (workJob, workDeps) => performScanWork(workJob, workDeps),
      scanDeps: {
        ingestUrl: async () => ({
          text: "Council votes Tuesday on a water contract.",
          extras: [],
        }),
        setJobStage: async () => undefined,
      },
      beforeScheduledCommit: async () => {
        await sql.query("update desk_jobs set claim_token='replacement-lease' where id=$1", [
          job.id,
        ]);
      },
      chatAdapters: {
        claude: async () => {
          throw new Error("Claude must not be called");
        },
        local: async () => {
          throw new Error("local must not be called");
        },
        codex: async () => {
          return {
            ok: true,
            text: JSON.stringify({
              editor_summary: "Must not persist",
              leads: [
                {
                  headline: "Must not persist",
                  why: "Permission changed.",
                  topic: "council",
                  source_urls: ["https://example.test/agenda"],
                  evidence: "Must not persist",
                  newsworthiness: 10,
                },
              ],
              proposed_sources: [
                {
                  title: "Must not persist proposed source",
                  url: "https://example.test/proposed",
                },
              ],
            }),
            provider: "codex",
            model: "selected-terra",
          };
        },
      },
    });
  } catch (error) {
    boundaryError = error;
  }
  assert.equal(
    (await sql.query("select 1 from snapshots where source_id=$1", [source.id])).length,
    0,
  );
  assert.equal((await sql.query("select 1 from leads where scan_run_id=$1", [run.id])).length, 0);
  assert.deepEqual(
    (
      await sql.query<{
        last_hash: string;
        last_fetched_at: string | null;
        last_error: string;
      }>("select last_hash,last_fetched_at,last_error from sources where id=$1", [source.id])
    )[0],
    { last_hash: "baseline-hash", last_fetched_at: null, last_error: "baseline-error" },
  );
  assert.equal(
    (await sql.query("select 1 from sources where url='https://example.test/proposed'")).length,
    0,
  );
  assert.equal(
    (await sql.query("select 1 from audit_events where newsroom_id=1 and action='scan'")).length,
    0,
  );
  const [rejectedRun] = await sql.query<{
    finished_at: string | null;
    sources_fetched: number;
    leads_created: number;
    sources_proposed: number;
    summary: string | null;
  }>(
    "select finished_at,sources_fetched,leads_created,sources_proposed,summary from scan_runs where id=$1",
    [run.id],
  );
  assert.equal(rejectedRun.finished_at, null);
  assert.deepEqual(
    {
      sources_fetched: rejectedRun.sources_fetched,
      leads_created: rejectedRun.leads_created,
      sources_proposed: rejectedRun.sources_proposed,
      summary: rejectedRun.summary,
    },
    { sources_fetched: 0, leads_created: 0, sources_proposed: 0, summary: null },
  );
  const [rejectedReservation] = await sql.query<{ status: string }>(
    "select status from daily_scan_reservations where id=$1",
    [reservation.id],
  );
  assert.equal(rejectedReservation.status, "running");
  assert.match(String(boundaryError), /lease was lost/);
});
