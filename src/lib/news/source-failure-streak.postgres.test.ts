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
import { BLOCKED_TRIES_PER_HOST_PER_DAY, skipThisPass } from "./fetch-politeness.ts";
import { keepsFailing } from "./source-rows.ts";
import type { Sql } from "../db.ts";

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
let IngestFetchError: typeof import("./ingest.ts").IngestFetchError;
let checkOneSource: typeof import("./desk.ts").performCheckOneSource;
/** The app connection string, for the one test that needs its own connection
 *  (to hold a lock) rather than the shared pool. */
let appUrlString = "";

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
    appUrlString = appUrl.toString();
    process.env.DATABASE_URL = appUrlString;
    db = await import("../db.ts");
    const desk = await import("./desk.ts");
    scan = desk.performScanWork;
    checkOneSource = desk.performCheckOneSource;
    IngestFetchError = (await import("./ingest.ts")).IngestFetchError;
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
async function seedScanJob(newsroomId = 1): Promise<import("./jobs.ts").DeskJob> {
  const sql = await db.getSql();
  const userId = `source-streak-${process.pid}`;
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,$2) returning id",
    [userId, newsroomId],
  );
  const claimToken = `source-streak-claim-${process.pid}-${run.id}`;
  const { JOB_STAGE_LISTS } = await import("./jobs.ts");
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs
      (newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,lane,status,stage,
       claim_token,stages_json,stage_index,beat_at,started_at)
     values($1,$2,'scan',$3,'grok','editor','default','running','Working',
            $4,$5,0,now(),now()) returning id`,
    [newsroomId, userId, run.id, claimToken, JSON.stringify(JOB_STAGE_LISTS.scan)],
  );
  return {
    id: jobRow!.id,
    user_id: userId,
    newsroom_id: newsroomId,
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
  ── THE SCHEDULED PATH, DRIVEN FOR REAL (HIGH-1, A-B8) ───────────────────────

  A scheduled scan does not write the source rows inline: it queues
  `pendingSourceTouches` and commits them inside the run's transaction. That
  path used to decide "did we read this page?" from `last_error is null` -- and
  a "come back later" touch carries a null error on purpose -- so an unattended
  scan wrote a 429 as a SUCCESSFUL READ while the inline scan and the editor's
  Check press counted the same event as a failure.

  The old test for this was a regex over the SQL text of `desk.ts`, and it
  passed on the broken code because it pinned the very CASE expression that was
  wrong. This one runs `performScanWork` with a real `scheduledCommit`, against
  real PostgreSQL, and reads the row afterwards -- the same shape the manual
  path's test above uses, so the two paths are now compared on the ROW rather
  than on the words that wrote it.

  One source always reads fine: a run in which every source failed throws before
  the commit, and the touches would never be written at all.
*/

/** Newsroom 2, so this block owns its whole watch list. `watchSlice` is every
 *  accepted source in the newsroom, and `keepsFailing`'s count and the progress
 *  step mean nothing if another test's rows are in it. */
const SCHEDULED_NEWSROOM = 2;
const HEALTHY_URL = "https://example.test/scheduled-healthy";
/** A public IP literal, so the SSRF guard takes its no-DNS path and the
 *  replaced transport is what actually answers. Nothing reaches the network. */
const PRESS_URL = "http://93.184.216.34/council-records";

type Fixture = {
  url: string;
  /** The refusal the stubbed fetch throws, or undefined for a clean read. */
  bad?: number;
  retryAfterMs?: number | null;
  /** How long the stubbed fetch takes, so a counted progress step can be
   *  observed while the pass is still running. */
  delayMs?: number;
};

async function seedScheduledNewsroom(): Promise<void> {
  const sql = await db.getSql();
  await sql.query(
    `insert into paper_settings
      (newsroom_id,name,city,state,timezone,onboarded,youtube_channels,meeting_keywords,seed_sources)
     values ($1,'Scheduled Fixture','Springfield','IL','America/Chicago',true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)
     on conflict (newsroom_id) do nothing`,
    [SCHEDULED_NEWSROOM],
  );
}

/** The newsroom's whole watch list, replaced. `healthy` is always present --
 *  see the note above -- and is appended first so the fixtures' order is the
 *  caller's. */
async function seedWatch(fixtures: Fixture[]): Promise<Map<string, number>> {
  const sql = await db.getSql();
  const urls = [HEALTHY_URL, ...fixtures.map((f) => f.url)];
  /* The newsroom is this block's alone, so anything not in the current watch
     list goes. It is a DELETE and not a truncate for the rows the caller wants
     to KEEP: several tests run the pass twice over the same rows, and a fresh
     id each time would make "the same row gained a streak" untestable. The
     upsert therefore leaves the row's history exactly where it was. */
  await sql.query("delete from sources where newsroom_id=$1 and url <> all($2::text[])", [
    SCHEDULED_NEWSROOM,
    urls,
  ]);
  const ids = new Map<string, number>();
  for (const [index, url] of urls.entries()) {
    const [row] = await sql.query<{ id: number }>(
      `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
       values($1,$2,$3,$4,'official','A','accepted')
       on conflict (user_id,newsroom_id,url) do update set status = 'accepted'
       returning id`,
      [`source-streak-${process.pid}`, SCHEDULED_NEWSROOM, url, `Fixture ${index}`],
    );
    ids.set(url, row!.id);
  }
  return ids;
}

/** A claimed scan job and one run over the fixtures. `scheduled` is the lane:
 *  the scheduler's (queued touches, committed in the run transaction) or the
 *  editor's (inline writes), because the audit's findings were about the two
 *  disagreeing. */
async function scheduledRun(fixtures: Fixture[], scheduled = true): Promise<Map<string, number>> {
  const sql = await db.getSql();
  const ids = await seedWatch(fixtures);
  await scan(await seedScanJob(SCHEDULED_NEWSROOM), {
    ingestUrl: async (url: string) => {
      const fixture = fixtures.find((f) => f.url === url);
      if (fixture?.delayMs) await new Promise((r) => setTimeout(r, fixture.delayMs));
      if (fixture?.bad)
        throw new IngestFetchError(fixture.bad, fixture.retryAfterMs ?? null);
      return {
        text: `The council meets on Tuesday to vote on the water contract (${url}).`,
        titleHint: "Scheduled fixture",
        extras: [],
      };
    },
    grokChat: async () => ({
      ok: true as const,
      text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: "Scheduled fixture." }),
    }),
    setJobModelChoice: async () => {},
    ...(scheduled ? { scheduledCommit: <T,>(write: (s: Sql) => Promise<T>) => write(sql) } : {}),
  });
  return ids;
}

/** The whole health of one row: the streak, the two "when" columns, the
 *  reason, and the wait. Timestamps are read as text -- the question is whether
 *  the stored value MOVED, and two Dates for one instant are not equal. */
async function healthOf(sourceId: number): Promise<{
  consecutive_failures: number;
  failure_streak_started_at: string | null;
  last_ok_at: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  retry_after: string | null;
  retry_after_note: string | null;
}> {
  const sql = await db.getSql();
  const [row] = await sql.query<{
    consecutive_failures: number;
    failure_streak_started_at: string | null;
    last_ok_at: string | null;
    last_fetched_at: string | null;
    last_error: string | null;
    retry_after: string | null;
    retry_after_note: string | null;
  }>(
    `select consecutive_failures, failure_streak_started_at::text, last_ok_at::text,
            last_fetched_at::text, last_error, retry_after::text, retry_after_note
     from sources where id=$1`,
    [sourceId],
  );
  return row!;
}

/** Give the row a real history before a run, so "this column did not move" is
 *  a claim about a value rather than about a null that was null already. */
async function seedHistory(sourceId: number, consecutiveFailures: number): Promise<void> {
  const sql = await db.getSql();
  await sql.query(
    `update sources
     set last_ok_at = now() - interval '2 days',
         last_fetched_at = now() - interval '2 days',
         consecutive_failures = $2,
         failure_streak_started_at = case when $2 > 0 then now() - interval '2 days' else null end
     where id = $1`,
    [sourceId, consecutiveFailures],
  );
}

it(
  "the scheduled scan counts a come-back-later as an attempt, not a read",
  { skip, timeout: 120000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    await seedScheduledNewsroom();
    const url = "https://example.test/scheduled-429";
    const ids = await scheduledRun([{ url, bad: 429, retryAfterMs: 600_000 }]);
    const id = ids.get(url)!;
    const row = await healthOf(id);

    assert.equal(
      row.consecutive_failures,
      1,
      "a 429 the unattended scan met is an ATTEMPT: it moves the streak by one",
    );
    assert.ok(row.failure_streak_started_at, "and the streak records when it began");
    assert.equal(
      row.last_ok_at,
      null,
      "a wait is not a read -- last_ok_at must stay whatever the last real read left",
    );
    assert.ok(row.last_fetched_at, "the desk did knock on the door");
    assert.equal(row.last_error, null, "a site that asked us to wait has not failed us");
    assert.ok(row.retry_after, "the wait the site asked for is recorded");
    assert.ok(skipThisPass({ retryAfter: row.retry_after, nowMs: Date.now() }),
      "and the next pass is left alone until then");
    assert.match(row.retry_after_note ?? "", /^Asked us to come back at /);
  },
);

it(
  "a 503 with no Retry-After says the desk is waiting, not that the site asked",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const url = "https://example.test/scheduled-503";
    const ids = await scheduledRun([{ url, bad: 503, retryAfterMs: null }]);
    const row = await healthOf(ids.get(url)!);

    assert.equal(row.consecutive_failures, 1, "a bare 503 is still an attempt");
    assert.equal(row.last_error, null);
    assert.match(
      row.retry_after_note ?? "",
      /^Was busy at .+ — trying again after .+$/,
      "the site asked for nothing, so the row must not say it did",
    );
    assert.doesNotMatch(row.retry_after_note ?? "", /Asked us/, "nobody asked");
    assert.doesNotMatch(row.retry_after_note ?? "", /429|503|HTTP|Retry-After/, "no jargon");
  },
);

it(
  "three 503s in a row reach Keeps failing while the chip still says Waiting",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const url = "https://example.test/scheduled-down";
    const ids = await scheduledRun([{ url, bad: 503, retryAfterMs: null }]);
    const id = ids.get(url)!;
    const sql = await db.getSql();
    for (const _ of [0, 1]) {
      /* Move the clock rather than wait: the row is parked for half an hour
         after each refusal, which is the feature working. Writing the wait into
         the past is what "the next pass after the time" means. */
      await sql.query("update sources set retry_after = now() - interval '1 minute' where id=$1", [id]);
      await scheduledRun([{ url, bad: 503, retryAfterMs: null }]);
    }
    const row = await healthOf(id);

    assert.equal(row.consecutive_failures, 3, "three refusals, three attempts");
    assert.equal(
      keepsFailing({ status: "accepted", consecutive_failures: row.consecutive_failures }),
      true,
      "the row the Sources screen gates Delete and Find-a-replacement on is flagged",
    );
    assert.ok(
      skipThisPass({ retryAfter: row.retry_after, nowMs: Date.now() }),
      "and it is still parked, so the chip reads Waiting rather than Keeps failing",
    );
  },
);

it(
  "a scheduled read clears the streak, the wait and the reason",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const url = "https://example.test/scheduled-recovers";
    const ids = await scheduledRun([{ url, bad: 403 }]);
    const id = ids.get(url)!;
    await seedHistory(id, 2);
    const before = await healthOf(id);

    await scheduledRun([{ url }]);
    const after = await healthOf(id);

    assert.equal(after.consecutive_failures, 0, "a read ends the streak");
    assert.equal(after.failure_streak_started_at, null);
    assert.notEqual(after.last_ok_at, before.last_ok_at, "last_ok_at is stamped by a read");
    assert.equal(after.retry_after, null, "and the wait a block left is cleared");
    assert.equal(after.retry_after_note, null);
    assert.equal(after.last_error, null);
  },
);

it(
  "a source the pass deliberately skipped moves nothing at all",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const url = "https://example.test/scheduled-parked";
    const ids = await scheduledRun([{ url }]);
    const id = ids.get(url)!;
    await seedHistory(id, 2);
    const sql = await db.getSql();
    await sql.query(
      `update sources set retry_after = now() + interval '1 hour',
              retry_after_note = 'Asked us to come back at 4:00 PM — will retry then'
       where id=$1`,
      [id],
    );
    const before = await healthOf(id);

    /* The row is parked, so the pass must leave it alone -- and its own note
       must survive untouched rather than being rewritten by a source that was
       never fetched. */
    await scheduledRun([{ url, bad: 429, retryAfterMs: 600_000 }]);
    const after = await healthOf(id);

    assert.equal(after.consecutive_failures, before.consecutive_failures);
    assert.equal(after.failure_streak_started_at, before.failure_streak_started_at);
    assert.equal(after.last_ok_at, before.last_ok_at);
    assert.equal(after.last_fetched_at, before.last_fetched_at, "nothing was fetched");
    assert.equal(after.last_error, before.last_error);
    assert.equal(after.retry_after, before.retry_after);
    assert.equal(after.retry_after_note, before.retry_after_note);
  },
);

it(
  "the editor's Check press counts a 429 as an attempt, not a read",
  { skip, timeout: 120000 },
  async () => {
    /*
      THE THIRD WRITE SITE. The press, the inline scan and the scheduled commit
      are the same rule at three places, and the audit's HIGH-1 was exactly the
      two of them disagreeing. The press is driven through the scan's own fetch
      path -- `setFetchImplForTests` is the transport seam `source-retry.test.ts`
      uses, and the URL is a public IP literal so the SSRF guard takes its
      no-DNS path. Nothing here reaches the network.
    */
    await seedScheduledNewsroom();
    const ids = await seedWatch([{ url: PRESS_URL }]);
    const id = ids.get(PRESS_URL)!;
    await seedHistory(id, 1);
    const before = await healthOf(id);

    const fetchUrl = await import("./fetch-url.ts");
    fetchUrl.setFetchImplForTests(
      async () =>
        new Response("<html><body><p>Too many requests. Please slow down.</p></body></html>", {
          status: 429,
          headers: { "content-type": "text/html; charset=utf-8", "retry-after": "600" },
        }),
    );
    try {
      const result = await checkOneSource(
        { userId: `source-streak-${process.pid}`, newsroomId: SCHEDULED_NEWSROOM },
        id,
        0,
      );
      assert.equal(result.ok, false, "the press says so on the row");
    } finally {
      fetchUrl.setFetchImplForTests(null);
    }

    const after = await healthOf(id);
    assert.equal(after.consecutive_failures, before.consecutive_failures + 1);
    assert.ok(after.failure_streak_started_at, "the streak records when it began");
    assert.equal(after.last_ok_at, before.last_ok_at, "a wait is not a read, on a press either");
    assert.equal(after.last_error, null, "the site did not fail us");
    assert.match(after.retry_after_note ?? "", /^Asked us to come back at /);
    assert.ok(skipThisPass({ retryAfter: after.retry_after, nowMs: Date.now() }));
  },
);

it(
  "the host's daily cap skips a healthy source without calling it a failure",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const url = "https://capped.test/scheduled-sibling";
    const ids = await seedWatch([{ url }]);
    const id = ids.get(url)!;
    await seedHistory(id, 1);
    const before = await healthOf(id);
    const sql = await db.getSql();
    /* The host spent today's allowance elsewhere -- the newsroom watches six
       pages of one city site and the other five collected the refusals. This
       source was never asked for anything. */
    await sql.query(
      `insert into source_host_tries (newsroom_id, host, day, tries)
       values ($1,'capped.test',current_date,$2)
       on conflict (newsroom_id, host, day) do update set tries = $2`,
      [SCHEDULED_NEWSROOM, 4],
    );

    /* BOTH PATHS: a scheduled run queues the touch, a manual one writes it
       inline, and the audit found the two disagreeing about what a skip means
       (LOW-2). Whichever wrote it, the row must read the same. */
    for (const scheduled of [true, false]) {
      await scheduledRun([{ url }], scheduled);
      const after = await healthOf(id);
      assert.equal(after.consecutive_failures, before.consecutive_failures,
        `a fetch that never happened is not an attempt (scheduled=${scheduled})`);
      assert.equal(after.last_fetched_at, before.last_fetched_at, "nothing was fetched");
      assert.equal(after.last_ok_at, before.last_ok_at);
      assert.equal(
        after.last_error,
        before.last_error,
        "`Tried 4 times today` is about the HOST, and this source was never tried",
      );
      assert.ok(after.retry_after, "the wait is still recorded");
      assert.equal(
        after.retry_after_note,
        `Tried ${BLOCKED_TRIES_PER_HOST_PER_DAY} times today — will try again tomorrow`,
      );
    }
  },
);

it(
  "a skipped source still moves the scan's progress count",
  { skip, timeout: 120000 },
  async () => {
    await seedScheduledNewsroom();
    const sql = await db.getSql();
    const parked = "https://example.test/scheduled-progress-parked";
    const slowA = "https://example.test/scheduled-progress-a";
    const slowB = "https://example.test/scheduled-progress-b";
    const fixtures: Fixture[] = [
      { url: parked },
      { url: slowA, bad: 404, delayMs: 1200 },
      { url: slowB, bad: 404, delayMs: 2400 },
    ];
    const ids = await seedWatch(fixtures);
    await sql.query("update sources set retry_after = now() + interval '1 hour' where id=$1", [
      ids.get(parked)!,
    ]);
    const job = await seedScanJob(SCHEDULED_NEWSROOM);

    /*
      The counted step is written by the fetch loop and then overwritten by the
      NEXT stage's arrival a few milliseconds later, so it cannot be read off
      the row once the run is over. It is read while it is still there: the
      pass is held at the first query after the loop by an exclusive lock on
      `beat_memory`, which is what that stage reads first.
    */
    const holder = new Client({ connectionString: appUrlString });
    await holder.connect();
    await holder.query("begin");
    await holder.query("lock table beat_memory in access exclusive mode");

    const run = scan(job, {
      ingestUrl: async (url: string) => {
        const fixture = fixtures.find((f) => f.url === url);
        if (fixture?.delayMs) await new Promise((r) => setTimeout(r, fixture.delayMs));
        if (fixture?.bad) throw new IngestFetchError(fixture.bad, null);
        return { text: "The council meets on Tuesday.", titleHint: "Fixture", extras: [] };
      },
      grokChat: async () => ({
        ok: true as const,
        text: JSON.stringify({ leads: [], proposed_sources: [], editor_summary: "Fixture." }),
      }),
      setJobModelChoice: async () => {},
      scheduledCommit: (write) => write(sql),
    });
    let step = "";
    try {
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const [row] = await sql.query<{ step_text: string | null }>(
          "select step_text from desk_jobs where id=$1",
          [job.id],
        );
        step = row?.step_text ?? "";
        /*
          The pass is held AT THE FIRST QUERY AFTER THE FETCH LOOP, and that is
          the moment the counted step is final: no later arrival can overwrite
          it. A waiting lock on the held table is how the test knows the loop
          is over without assuming how far the count got -- the count is the
          question being asked.
        */
        const [waiting] = await sql.query<{ n: number }>(
          `select count(*)::int as n from pg_locks
           where not granted and relation = 'beat_memory'::regclass`,
        );
        if ((waiting?.n ?? 0) > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    } finally {
      await holder.query("rollback");
      await holder.end();
    }
    await run.catch(() => undefined);

    assert.equal(
      step,
      "Reading sources — 4 of 4",
      "the card must reach the end of the count, parked source included",
    );
  },
);
