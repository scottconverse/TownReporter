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

/*
  SCAN-001, the half the first fix missed.

  `postgresText` (now in ./storable-text.ts) replaced NUL in FETCHED text --
  pages, attachments, the error messages about them. The lead a model writes
  went straight into the INSERT untouched, so a model that emitted one U+0000
  in one headline did not spoil one field: Postgres refused the statement with
  "invalid byte sequence for encoding UTF8: 0x00", the scan's commit
  transaction rolled back, and every lead the run had found was lost.

  This runs on REAL PostgreSQL rather than PGlite on purpose. PGlite is
  Postgres compiled to WASM and its text handling is not the server's; a
  guard verified only there proves nothing about the database the newsroom
  actually runs. The lane is the repository's own runner:

    $env:TOWNREPORTER_RUN_POSTGRES_INTEGRATION='1'
    $env:TEST_POSTGRES_ADMIN_URL='postgres://...@127.0.0.1:5432/postgres'
    node scripts/run-postgres-integration.mjs src/lib/news/scan-model-nul.postgres.test.ts
*/
const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL NUL proof" };
const skip = probe.ok ? false : probe.reason;
const databaseName = `town_scan_nul_${process.pid}_${Date.now()}`;
let created = false;
let db: typeof import("../db.ts");
let scan: typeof import("./desk.ts").performScanWork;

const NUL = String.fromCharCode(0);

// desk.ts has Vite aliases and extensionless imports. Resolve those only in
// this Node test process, as scan-manual-receipt.postgres.test.ts does.
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
    process.env.DATABASE_URL = appUrl.toString();
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

let fixtureCounter = 0;
async function seedManualScan() {
  const sql = await db.getSql();
  const suffix = ++fixtureCounter;
  const userId = `scan-nul-${process.pid}-${suffix}`;
  await sql.query(
    `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
     values($1,1,$2,$3,'official','A','accepted')`,
    [userId, `https://example.test/scan-nul-${suffix}`, `NUL fixture ${suffix}`],
  );
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,1) returning id",
    [userId],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs
      (newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,claim_token)
     values(1,$1,'scan',$2,'grok','editor','default','running','Working',$3) returning id`,
    [userId, run.id, `scan-nul-claim-${suffix}`],
  );
  return {
    runId: run.id,
    job: {
      id: jobRow.id,
      user_id: userId,
      newsroom_id: 1,
      kind: "scan",
      subject_id: run.id,
      model_choice: "grok",
      model_choice_source: "editor",
      claim_token: `scan-nul-claim-${suffix}`,
    } as import("./jobs.ts").DeskJob,
  };
}

/** A model reply whose every written field carries a NUL. */
function nulModelReply() {
  return JSON.stringify({
    editor_summary: `Council has a contract vote.${NUL} Next week.`,
    leads: [
      {
        headline: `Council schedules water${NUL} contract vote`,
        why: `The vote is Tuesday.${NUL}`,
        topic: "council",
        source_urls: ["https://example.test/nul-agenda"],
        evidence: `Council votes Tuesday.${NUL}`,
        newsworthiness: 10,
      },
    ],
    proposed_sources: [
      {
        url: "https://example.test/nul-proposed",
        title: `Proposed${NUL} page`,
        why: `The agenda names it.${NUL}`,
        section: "council",
      },
    ],
  });
}

function scanDeps(sourceText: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    deps: {
      ingestUrl: async () => ({ text: sourceText, titleHint: "Fixture", extras: [] }),
      grokChat: async () => {
        calls += 1;
        return { ok: true as const, text: nulModelReply() };
      },
      setJobStage: async () => {},
      setJobModelChoice: async () => {},
    },
  };
}

const carriesNul = (value: unknown) => String(value ?? "").includes(NUL);

it(
  "a model-written NUL cannot fail a real PostgreSQL scan, and never reaches the row",
  { skip, timeout: 30000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();

    const fixture = await seedManualScan();
    const run = scanDeps(`Council votes Tuesday on a water contract.`);
    // Before the guard this line rejected with the Postgres encoding error and
    // rolled the whole run back. That rejection IS the failure this test
    // reproduces, so it must not be caught and asserted on separately.
    await scan(fixture.job, run.deps);
    assert.equal(run.calls, 1, "the writing pass must have run exactly once");

    const [lead] = await sql.query<{
      headline: string;
      why: string;
      evidence: string;
      topic: string;
      status: string;
    }>("select headline,why,evidence,topic,status from leads where scan_run_id=$1", [fixture.runId]);
    assert.ok(lead, "the run must have filed its lead instead of losing the transaction");
    assert.equal(lead.headline, "Council schedules water contract vote");
    assert.equal(lead.why, "The vote is Tuesday.");
    assert.equal(lead.evidence, "Council votes Tuesday.");
    assert.equal(lead.topic, "council");
    for (const [column, value] of Object.entries(lead)) {
      assert.equal(carriesNul(value), false, `leads.${column} must hold no NUL`);
    }

    const [receipt] = await sql.query<{
      finished_at: string | null;
      summary: string | null;
      error: string | null;
      leads_created: number;
      sources_proposed: number;
    }>(
      "select finished_at,summary,error,leads_created,sources_proposed from scan_runs where id=$1",
      [fixture.runId],
    );
    assert.ok(receipt.finished_at, "the run must have a terminal receipt");
    assert.equal(receipt.error, null);
    assert.equal(receipt.leads_created, 1);
    assert.equal(receipt.sources_proposed, 1);
    assert.equal(receipt.summary, "Council has a contract vote. Next week.");
    assert.equal(carriesNul(receipt.summary), false);

    const [proposed] = await sql.query<{
      title: string;
      proposed_reason: string | null;
      proposed_section: string | null;
    }>(
      "select title,proposed_reason,proposed_section from sources where url='https://example.test/nul-proposed'",
    );
    assert.ok(proposed, "the run's proposed source must have been filed");
    assert.equal(proposed.title, "Proposed page");
    assert.equal(proposed.proposed_reason, "The agenda names it.");
    for (const [column, value] of Object.entries(proposed)) {
      assert.equal(carriesNul(value), false, `sources.${column} must hold no NUL`);
    }
  },
);

after(() => hooks.deregister());
