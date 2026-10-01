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
  THE FAILURE STREAK, ON REAL POSTGRESQL (SH0-1).

  WHAT THIS PROVES, and why each assertion needs a real database rather than a
  unit test of a string:

    1. THE COUNT MOVES BY ONE PER FAILED ATTEMPT AND IS CLEARED BY A SUCCESS.
       fail, fail, success, fail -> 1, 2, 0, 1. The scan writes it inside the
       same statement that writes `last_error`, so only a real run of the real
       fetch loop can show the two moving together.

    2. `last_ok_at` IS SET ONLY ON A SUCCESS. That column is the whole reason
       this migration exists -- `last_fetched_at` moves on a FAILED attempt too,
       so before 0115 nothing in the schema could say when a source last READ.

    3. THE STREAK'S START IS STAMPED ONCE. `failure_streak_started_at` is
       `coalesce`d, so the SECOND failure in a run does not move it: "first
       failed <date>" has to name the first one.

    4. THE SCHEDULED PATH CARRIES IT TOO. A source-text pin (no database
       needed) checks that the `pendingSourceTouches` commit -- the OTHER of the
       scan's two write paths -- increments the same column. That path once
       went without a write the inline path had, which is why
       `scan-coverage.test.ts` exists; the pin is the same defence.

  The fetcher is stubbed, so nothing here opens a socket, and the provider is
  stubbed, so nothing loads a model. Real PostgreSQL, as
  `scripts/run-postgres-integration.mjs` provides.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL failure-streak proof",
    };
const skip = probe.ok ? false : probe.reason;
const databaseName = `town_source_streak_${process.pid}_${Date.now()}`;
let created = false;
let db: typeof import("../db.ts");
let scan: typeof import("./desk.ts").performScanWork;

// desk.ts uses Vite aliases and extensionless imports. Resolve those only in
// this Node test process, as scan-progress.postgres.test.ts does.
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
    appUrl.searchParams.set("application_name", `town_source_streak_${process.pid}`);
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
       values (1,'Test Paper','Springfield','IL','America/Chicago',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`,
    );
  });

  after(async () => {
    hooks.deregister();
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

const SOURCE_URL = "https://example.test/streak-fixture";

/** The one source on watch. Created once, so every attempt below is an attempt
 *  at the SAME row -- which is the only way a streak means anything. */
async function seedSource(): Promise<number> {
  const sql = await db.getSql();
  const [seeded] = await sql.query<{ id: number }>(
    `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
     values($1,1,$2,'Streak fixture','official','A','accepted') returning id`,
    [`source-streak-${process.pid}`, SOURCE_URL],
  );
  return seeded!.id;
}

/** One claimed scan job. Seeded with the kind's OWN stage list, as
 *  `executeJob` leaves it, so the run takes the production path. */
async function seedScanJob(): Promise<import("./jobs.ts").DeskJob> {
  const sql = await db.getSql();
  const userId = `source-streak-${process.pid}`;
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,1) returning id",
    [userId],
  );
  const claimToken = `source-streak-claim-${process.pid}-${run.id}`;
  const { JOB_STAGE_LISTS } = await import("./jobs.ts");
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs
      (newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,
       claim_token,stages_json,stage_index,beat_at,started_at)
     values(1,$1,'scan',$2,'grok','editor','default','running','Working',
            $3,$4,0,now(),now()) returning id`,
    [userId, run.id, claimToken, JSON.stringify(JOB_STAGE_LISTS.scan)],
  );
  return {
    id: jobRow!.id,
    user_id: userId,
    newsroom_id: 1,
    kind: "scan",
    subject_id: run.id,
    model_choice: "grok",
    model_choice_source: "editor",
    claim_token: claimToken,
    stages_json: JSON.stringify(JOB_STAGE_LISTS.scan),
    stage_index: 0,
  } as import("./jobs.ts").DeskJob;
}

/** One attempt: the fetch either answers with readable text or throws, and
 *  nothing else in the scan is faked differently. */
async function attempt(fail: boolean): Promise<void> {
  try {
    await runAttempt(fail);
  } catch (error) {
    /*
      A scan in which EVERY source failed ends by refusing to run a writing
      pass -- "Scan fetched no source text, so no writing pass ran" -- which is
      the correct behaviour and not what this test is about. The source rows
      were written DURING the fetch loop, before that refusal, so the streak is
      already on the row. An attempt that was supposed to succeed must still
      complete, and this lets it say so.
    */
    if (!fail) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    assert.match(msg, /no source text|writing pass/, `unexpected scan failure: ${msg}`);
  }
}

async function runAttempt(fail: boolean): Promise<void> {
  await scan(await seedScanJob(), {
    ingestUrl: async (url: string) => {
      if (fail) throw new Error(`404 not found: ${url}`);
      return {
        text: "The council meets on Tuesday to vote on the water contract.",
        titleHint: "Streak fixture",
        extras: [],
      };
    },
    grokChat: async () => ({
      ok: true as const,
      text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: "Streak fixture." }),
    }),
    setJobModelChoice: async () => {},
  });
}

async function streakOf(sourceId: number): Promise<{
  consecutive_failures: number;
  failure_streak_started_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
}> {
  const sql = await db.getSql();
  const [row] = await sql.query<{
    consecutive_failures: number;
    failure_streak_started_at: string | null;
    last_ok_at: string | null;
    last_error: string | null;
  }>(
    /* `::text` on the two timestamps: the driver hands back Date objects, and
       two Dates for the same instant are not `strictEqual` to each other. The
       question here is whether the stored value MOVED, so the stored text is
       the honest thing to compare. */
    `select consecutive_failures, failure_streak_started_at::text, last_ok_at::text, last_error
     from sources where id=$1`,
    [sourceId],
  );
  return row!;
}

it(
  "a source that fails, fails, succeeds, fails reads 1, 2, 0, 1",
  { skip, timeout: 120000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sourceId = await seedSource();

    /* The row as the migration leaves it: no history, and no claim to one. */
    const fresh = await streakOf(sourceId);
    assert.equal(fresh.consecutive_failures, 0);
    assert.equal(fresh.failure_streak_started_at, null);
    assert.equal(fresh.last_ok_at, null);

    await attempt(true);
    const first = await streakOf(sourceId);
    assert.equal(first.consecutive_failures, 1, "one failed attempt reads 1");
    assert.ok(first.last_error, "the reason is still written beside the count");
    assert.ok(first.failure_streak_started_at, "the streak records when it began");
    assert.equal(first.last_ok_at, null, "a failed attempt is not a success");

    await attempt(true);
    const second = await streakOf(sourceId);
    assert.equal(second.consecutive_failures, 2);
    assert.equal(
      second.failure_streak_started_at,
      first.failure_streak_started_at,
      "the second failure must not move the date the run of failures began",
    );
    assert.equal(second.last_ok_at, null);

    await attempt(false);
    const read = await streakOf(sourceId);
    assert.equal(read.consecutive_failures, 0, "a success ends the streak");
    assert.equal(read.failure_streak_started_at, null);
    assert.equal(read.last_error, null);
    assert.ok(read.last_ok_at, "last_ok_at is the one column that says it READ");

    await attempt(true);
    const again = await streakOf(sourceId);
    assert.equal(again.consecutive_failures, 1, "the count restarts rather than resuming");
    assert.equal(
      again.last_ok_at,
      read.last_ok_at,
      "a failure must never overwrite when the source last read",
    );
  },
);

/*
  ── THE SCHEDULED PATH, PINNED IN SOURCE ─────────────────────────────────────

  A scheduled scan does not write the source rows inline: it pushes
  `pendingSourceTouches` and commits them inside the run's transaction. Both
  paths must carry the streak, and a test cannot easily drive the scheduled one
  end to end -- so this binds to the SQL itself, the way `scan-coverage.test.ts`
  binds to the paths it exists to protect.
*/
it("the scheduled commit increments the same streak the inline write does", () => {
  const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
  const block = desk.slice(
    desk.indexOf("for (const touch of pendingSourceTouches)"),
    desk.indexOf("for (const gone of pendingDisappeared)"),
  );
  assert.ok(block, "the pendingSourceTouches commit block exists");
  assert.match(
    block,
    /consecutive_failures\s*=\s*case when[\s\S]*?sources\.consecutive_failures \+ 1/,
    "the scheduled path must increment consecutive_failures, not just write last_error",
  );
  assert.match(
    block,
    /last_ok_at\s*=\s*case when[\s\S]*?now\(\)/,
    "the scheduled path must stamp last_ok_at on the sources it read",
  );
  assert.match(
    block,
    /failure_streak_started_at[\s\S]*?coalesce\(failure_streak_started_at, now\(\)\)/,
    "the scheduled path must coalesce the streak's start",
  );
});
