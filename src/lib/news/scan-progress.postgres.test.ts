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
  A SCAN'S PROGRESS, ON REAL POSTGRESQL (FB1, units 1 and 4).

  The owner's live complaint was the Scan screen: "a line going back and forth
  is just lazy", and worse, a scan that was hard at work read "0 fetched · No
  sources were fetched" on the Sources page. Both are about the same thing --
  the job row and the run row said nothing while the scan ran -- and both are
  things only a real database can prove, because the writes go through `pg`
  with the desk's own SQL.

  WHAT IS ASSERTED, and why each one is worth a real database:

    1. THE JOB ROW ADVANCES. `stage_index` walks the seeded scan stage list,
       `step_text` names what the scan is reading, `pct` is a real number inside
       its phase's slice, and `beat_at` is fresh -- so a working scan is not
       called stalled and offers no "Retry on next model".

    2. THE COUNT IS LIVE, MID-FETCH. `noteSourceProgress` writes
       `sources_fetched` / `sources_attempted` onto `scan_runs` as the fetch
       loop runs. The observer below reads the row from INSIDE the fetch, which
       is the only moment that distinguishes "written as it goes" from "written
       when it finished" -- and the defect was exactly that the row was written
       only at the end.

    3. THE ONE READER FINDS IT. `readDeskJobs` returns the scan -- the kind the
       old readers filtered out -- with its own title and no invented lead.

  The provider is faked (`grokChat` returns an empty, valid scan result) and the
  fetcher is a stub, so nothing here loads a model or opens a socket. Real
  PostgreSQL, as `scripts/run-postgres-integration.mjs` provides.
*/

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : {
      ok: false as const,
      reason: "set TEST_POSTGRES_ADMIN_URL; CI runs the real PostgreSQL scan-progress proof",
    };
const skip = probe.ok ? false : probe.reason;
const databaseName = `town_scan_progress_${process.pid}_${Date.now()}`;
let created = false;
let db: typeof import("../db.ts");
let scan: typeof import("./desk.ts").performScanWork;
let readDeskJobs: typeof import("./job-progress.ts").readDeskJobs;

// desk.ts and job-progress.ts use Vite aliases and extensionless imports.
// Resolve those only in this Node test process, as scan-manual-receipt does.
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
    appUrl.searchParams.set("application_name", `town_scan_progress_${process.pid}`);
    process.env.DATABASE_URL = appUrl.toString();
    db = await import("../db.ts");
    scan = (await import("./desk.ts")).performScanWork;
    readDeskJobs = (await import("./job-progress.ts")).readDeskJobs;
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

/**
 * More sources than the fetch loop's concurrency (6), so the tail of the list
 * starts only after the head has finished -- which is what makes "was the run
 * row written DURING the fetch" an observable question at all.
 */
const SOURCE_COUNT = 8;

async function seedScan(): Promise<{ job: import("./jobs.ts").DeskJob; runId: number }> {
  const sql = await db.getSql();
  const userId = `scan-progress-${process.pid}`;
  const [run] = await sql.query<{ id: number }>(
    "insert into scan_runs(user_id,newsroom_id) values($1,1) returning id",
    [userId],
  );
  for (let n = 0; n < SOURCE_COUNT; n += 1) {
    await sql.query(
      `insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
       values($1,1,$2,$3,'official','A','accepted')`,
      [userId, `https://example.test/progress-${n}`, `Progress fixture ${n}`],
    );
  }
  const claimToken = `scan-progress-claim-${process.pid}`;
  /*
    The row is seeded the way `executeJob` leaves it at claim: `running`, with
    the kind's OWN stage list in `stages_json` and `stage_index` at 0. Seeding
    the list here rather than leaving it null is what makes this test exercise
    the production path -- `progressReporterFor` resolves arrivals against the
    row it was handed, so a null list would silently test nothing.
  */
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
      stages_json: JSON.stringify(JOB_STAGE_LISTS.scan),
      stage_index: 0,
    } as import("./jobs.ts").DeskJob,
  };
}

it(
  "a simulated scan advances its job row and its run row while it fetches",
  { skip, timeout: 60000 },
  async () => {
    assert.equal(db.getDbSource(), "neon", "fixture must use the real pg adapter, not PGLite");
    const sql = await db.getSql();
    const fixture = await seedScan();

    /*
      WHAT THE RUN ROW SAID WHILE THE FETCH WAS STILL GOING.

      `scheduledGuard` runs at the TOP of every fetch slot, so its calls after
      the first six sources start are reads taken mid-run. The job row is read
      in the same breath, so the two halves of the claim -- "the card moves" and
      "the run row stops saying zero" -- are observed at the same instant.
    */
    const during: { fetched: number; step: string | null; pct: number | null }[] = [];
    const observe = async () => {
      const [run] = await sql.query<{ sources_fetched: number }>(
        "select sources_fetched from scan_runs where id=$1",
        [fixture.runId],
      );
      const [job] = await sql.query<{ step_text: string | null; pct: number | null }>(
        "select step_text,pct from desk_jobs where id=$1",
        [fixture.job.id],
      );
      during.push({ fetched: run!.sources_fetched, step: job!.step_text, pct: job!.pct });
    };
    /*
      A SAMPLER, not a hook, because the two writes this test is about are timed
      differently. The run-row write is throttled with the progress write (at
      most one a second), so a reader that only looked at fetch boundaries could
      miss the second it landed in. Sampling every 75 ms while the scan runs
      reads the row as the desk would -- and it is the DESK's question this test
      is asking: what does the row say while the scan is still going.
    */
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        await observe();
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    })();

    await scan(fixture.job, {
      scheduledGuard: async () => {
        await observe();
      },
      /*
        SLOW ENOUGH FOR THE THROTTLE TO MATTER. The progress write is capped at
        one a second by design, so a fetcher that returns instantly would finish
        the whole list inside the first second and no counted step would ever be
        written -- which is the correct behaviour of the throttle and a useless
        test of it. 700 ms a page puts a tick inside the fetch window.
      */
      ingestUrl: async (url: string) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return {
          text: `Fixture page for ${url}: the council meets on Tuesday to vote on the water contract.`,
          titleHint: "Fixture",
          extras: [],
        };
      },
      grokChat: async () => ({
        ok: true as const,
        text: JSON.stringify({
          leads: [],
          proposed_sources: [],
          editor_summary: "Scan progress fixture completed.",
        }),
      }),
      setJobModelChoice: async () => {},
    });
    sampling = false;
    await sampler;

    /* 2. THE RUN ROW WAS NON-ZERO DURING THE FETCH. */
    assert.ok(during.length > 0, "the fetch loop called the observer");
    assert.ok(
      during.some((snapshot) => snapshot.fetched > 0),
      `the run row never left zero while fetching: ${JSON.stringify(during)}`,
    );
    /*
      1. THE JOB ROW WAS MOVING DURING THE FETCH, and the two halves of that
      belong to ONE sample rather than two. The step and the percentage are
      written by the same `reportProgress`, so reading them from one row is what
      proves they agree -- two separate `some()` calls would pass on a run whose
      count line had no percentage at all, which is precisely the defect FB1
      fixes.
    */
    const counted = during.filter(
      (snapshot) =>
        /^Reading sources — \d+ of \d+$/.test(snapshot.step ?? "") &&
        snapshot.pct != null &&
        snapshot.pct >= 5 &&
        snapshot.pct <= 55,
    );
    assert.ok(
      counted.length > 0,
      `no sample during the fetch carried both a count and a percentage: ${JSON.stringify(during)}`,
    );

    /* THE FINAL ROW: the whole list walked, the last arrival reached. */
    const { JOB_STAGE_LISTS } = await import("./jobs.ts");
    const [finished] = await sql.query<{
      stage_index: number | null;
      step_text: string | null;
      pct: number | null;
      beat_at: string | null;
      stages_json: string | null;
    }>("select stage_index,step_text,pct,beat_at,stages_json from desk_jobs where id=$1", [
      fixture.job.id,
    ]);
    assert.deepEqual(
      JSON.parse(finished!.stages_json ?? "null"),
      [...JOB_STAGE_LISTS.scan],
      "the seeded scan stage list survived the run",
    );
    assert.ok(
      finished!.stage_index != null && finished!.stage_index >= 2,
      `the chips advanced past the fetch: ${finished!.stage_index}`,
    );
    assert.ok(
      finished!.pct != null && finished!.pct >= 55,
      `the bar passed the fetch slice: ${finished!.pct}`,
    );
    assert.ok(finished!.beat_at, "the worker left a heartbeat behind");

    /* 3. THE ONE READER RETURNS THE SCAN -- the kind the old readers filtered out. */
    const rows = await readDeskJobs(1);
    const card = rows.find((row) => row.id === fixture.job.id);
    assert.ok(card, "readDeskJobs returns the scan job");
    assert.equal(card!.kind, "scan");
    assert.equal(card!.title, "Scanning the watch list");
    assert.equal(card!.leadId, 0, "a scan's subject is a run, not a lead");
    assert.equal(card!.headline, null);
    assert.deepEqual(card!.stages, [...JOB_STAGE_LISTS.scan]);
    assert.ok(card!.pct != null && card!.pct > 0, "the card carries the percentage");
  },
);
