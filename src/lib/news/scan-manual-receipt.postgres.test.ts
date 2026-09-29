import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  withDatabase,
} from "../test-support/pg-admin.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL receipt proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `town_scan_receipt_${process.pid}_${Date.now()}`;
const appName = `town_scan_receipt_${process.pid}`;
let appDatabaseUrl = "";
let created = false;
let db: typeof import("../db.ts");
let scan: typeof import("./desk.ts").performScanWork;
const nul = String.fromCharCode(0);
const replacement = String.fromCharCode(0xfffd);

// desk.ts has Vite aliases and extensionless imports. Resolve those only in
// this Node test process, as scan-section-cache.test.ts does for PGLite.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
      created = true;
    } finally {
      await admin.end();
    }

    const appUrl = new URL(withDatabase(adminUrl, databaseName));
    appUrl.searchParams.set("application_name", appName);
    appDatabaseUrl = appUrl.toString();
    process.env.DATABASE_URL = appDatabaseUrl;
    db = await import("../db.ts");
    scan = (await import("./desk.ts")).performScanWork;
    const sql = await db.getSql();
    const migrationDir = resolve(process.cwd(), "migrations");
    for (const name of readdirSync(migrationDir)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      await sql.query(readFileSync(resolve(migrationDir, name), "utf8"));
    }
    await sql.query(
      `insert into paper_settings
        (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
       values (1,'Test Paper','Longmont','CO','America/Denver',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    );
  });

  after(async () => {
    await db?.closePoolForTests();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
        [databaseName],
      );
      await admin.query(`drop database ${databaseName}`);
    } finally {
      await admin.end();
    }
  });
}

type ScanFixture = {
  job: import("./jobs.ts").DeskJob;
  runId: number;
  sourceId: number;
};

let fixtureCounter = 0;
async function seedManualScan(): Promise<ScanFixture> {
  const sql = await db.getSql();
  const suffix = ++fixtureCounter;
  const userId = `scan-pg-${process.pid}-${suffix}`;
  const [source] = await sql.query<{ id: number }>(
    `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
     values($1,1,$2,$3,'official','A','accepted') returning id`,
    [userId, `https://example.test/scan-${suffix}`, `PG receipt fixture ${suffix}`],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,1) returning id",
    [userId],
  );
  const claimToken = `scan-pg-claim-${suffix}`;
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs
      (newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token)
     values(1,$1,'scan',$2,'grok','editor','default','running','Working',$3) returning id`,
    [userId, run.id, claimToken],
  );
  return {
    sourceId: source.id,
    runId: run.id,
    job: {
      id: jobRow.id,
      user_id: userId,
      newsroom_id: 1,
      kind: "scan",
      subject_id: run.id,
      model_choice: "grok",
      model_choice_source: "editor",
      claim_token: claimToken,
    } as import("./jobs.ts").DeskJob,
  };
}

function scanDeps(
  sourceText: string,
  extra: Pick<import("./desk.ts").PerformScanWorkDeps, "beforeScheduledCommit"> = {},
) {
  let prompt = "";
  let calls = 0;
  return {
    get prompt() {
      return prompt;
    },
    get calls() {
      return calls;
    },
    deps: {
      ...extra,
      ingestUrl: async () => ({ text: sourceText, titleHint: "Fixture", extras: [] }),
      grokChat: async (_system: string, userMessage: string) => {
        calls += 1;
        prompt = userMessage;
        return {
          ok: true as const,
          text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: "PG scan completed." }),
        };
      },
      setJobStage: async () => {},
      setJobModelChoice: async () => {},
    },
  };
}

async function waitForClaimSelectWait(observer: Client): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1 from pg_stat_activity
         where application_name=$1 and state='active' and wait_event_type='Lock'
           and regexp_replace(lower(query), '[[:space:]]+', ' ', 'g')
             like '%select id from desk_jobs%for update%'
       ) as waiting`,
      [appName],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("manual scan did not block on its claim-row SELECT FOR UPDATE");
}

it(
  "real PostgreSQL settles a NUL-bearing General manual scan and fences a reclaimed claim",
  { skip, timeout: 30000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();

    const normal = await seedManualScan();
    const nulRun = scanDeps(`Council votes Tuesday on a water contract.${nul} Agenda item 7.`);
    await scan(normal.job, nulRun.deps);
    const [successfulReceipt] = await sql.query<{
      finished_at: string | null;
      sources_selected: number;
      sources_attempted: number;
      sources_fetched: number;
      sources_failed: number;
      sources_analyzed: number;
      model_batches_used: number;
      error: string | null;
    }>(
      `select finished_at,sources_selected,sources_attempted,sources_fetched,sources_failed,
              sources_analyzed,model_batches_used,error
       from scan_runs where id=$1`,
      [normal.runId],
    );
    const [snapshot] = await sql.query<{ excerpt: string }>(
      "select excerpt from snapshots where source_id=$1 order by id desc limit 1",
      [normal.sourceId],
    );
    assert.ok(successfulReceipt.finished_at, "successful manual run must have a terminal receipt");
    assert.equal(successfulReceipt.sources_selected, 1);
    assert.equal(successfulReceipt.sources_attempted, 1);
    assert.equal(successfulReceipt.sources_fetched, 1);
    assert.equal(successfulReceipt.sources_failed, 0);
    assert.equal(successfulReceipt.sources_analyzed, 1);
    assert.equal(successfulReceipt.model_batches_used, 1);
    assert.equal(successfulReceipt.error, null);
    assert.equal(nulRun.calls, 1);
    assert.ok(nulRun.prompt.includes(replacement));
    assert.ok(!nulRun.prompt.includes(nul));
    assert.ok(snapshot?.excerpt.includes(replacement));
    assert.ok(!snapshot?.excerpt.includes(nul));

    const stale = await seedManualScan();
    let enterCommit!: () => void;
    let releaseCommit!: () => void;
    const precommitReached = new Promise<void>((resolveReached) => (enterCommit = resolveReached));
    const allowCommit = new Promise<void>((resolveCommit) => (releaseCommit = resolveCommit));
    const staleRun = scanDeps("The council will consider a water contract Tuesday.", {
      beforeScheduledCommit: async () => {
        enterCommit();
        await allowCommit;
      },
    });
    const blocker = new Client({ connectionString: appDatabaseUrl });
    const observer = new Client({ connectionString: appDatabaseUrl });
    let blockerTransaction = false;
    let scanPromise: Promise<unknown> | undefined;
    try {
      await blocker.connect();
      await observer.connect();
      scanPromise = scan(stale.job, staleRun.deps);
      await precommitReached;
      await blocker.query("begin");
      blockerTransaction = true;
      await blocker.query(
        "update desk_jobs set claim_token='replacement-worker-lease' where id=$1 and status='running'",
        [stale.job.id],
      );
      releaseCommit();

      // Observe the actual FOR UPDATE waiter, rather than inferring it from a
      // final row value. If the lock clause is removed, the assertion fails
      // before the later token-fenced refresh can mask that mutation.
      await waitForClaimSelectWait(observer);
      await blocker.query("commit");
      blockerTransaction = false;
      await assert.rejects(scanPromise, /claim was superseded/);
    } finally {
      releaseCommit();
      if (blockerTransaction) await blocker.query("rollback").catch(() => undefined);
      await scanPromise?.catch(() => undefined);
      await Promise.all([blocker.end().catch(() => undefined), observer.end().catch(() => undefined)]);
    }

    const [staleReceipt] = await sql.query<{
      finished_at: string | null;
      sources_fetched: number;
      error: string | null;
    }>("select finished_at,sources_fetched,error from scan_runs where id=$1", [stale.runId]);
    const [staleJob] = await sql.query<{ status: string; claim_token: string | null }>(
      "select status,claim_token from desk_jobs where id=$1",
      [stale.job.id],
    );
    const [staleSnapshot] = await sql.query<{ count: number }>(
      "select count(*)::int as count from snapshots where source_id=$1",
      [stale.sourceId],
    );
    assert.equal(staleRun.calls, 1, "stale worker reaches result commit after fetching and analysis");
    assert.equal(staleReceipt.finished_at, null, "stale worker must not settle the newer owner's run");
    assert.equal(staleReceipt.sources_fetched, 0);
    assert.equal(staleReceipt.error, null);
    assert.equal(staleSnapshot.count, 0, "stale result transaction must roll back snapshot writes");
    assert.equal(staleJob.status, "running");
    assert.equal(staleJob.claim_token, "replacement-worker-lease");
  },
);

after(() => hooks.deregister());
