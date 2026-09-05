import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { ensureJobsSchema, enqueueJob } from "./jobs.ts";
import { writeStoryForAuthenticatedEditor } from "./model-request-commit.server.ts";
import { openInvestigationForEditor } from "./dark-open.ts";
import { emptyPlan, researchLoop, runDueMonitors, watchSource } from "./investigate.ts";
import { tickAllDueMonitors } from "./monitors-cron.ts";

/**
 * GauntletGate ENG-04 proof test.
 *
 * The guard test (scripts/newsroom-scoped-inserts.test.mjs) proves every
 * scoped INSERT's source text carries a `newsroom_id` column. This test
 * proves the value that lands there is the CALLER's newsroom, not always 1
 * -- exactly the gap ENG-04 named: "the first row with newsroom_id <> 1
 * makes that editor's hand-filed leads ... land in newsroom 1 and become
 * invisible to their own reads." It runs the real commit path
 * (`writeStoryForAuthenticatedEditor`, the same function
 * write-story-commit.test.ts exercises) for two different newsroom ids and
 * reads each back scoped, against a real in-process database (PGLite, no
 * DATABASE_URL needed).
 */
async function ensureScratchSchema() {
  const sql = await getSql();
  await ensureJobsSchema();
  await sql.query(`
    create table if not exists leads (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      headline text not null,
      why text not null,
      topic text not null default 'council',
      status text not null default 'new',
      source_urls text not null default '[]',
      evidence text not null default '',
      newsworthiness integer not null default 0,
      notes_json text not null default '{}',
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists drafts (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer not null,
      headline text not null,
      dek text not null default '',
      body text not null default '',
      topic text not null default 'council',
      source_urls text not null default '[]',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  return sql;
}

describe("a newsroom-scoped write lands in the caller's own newsroom, not always 1", () => {
  it("newsroom 2's lead and draft read back under newsroom 2, not newsroom 1", async () => {
    const sql = await ensureScratchSchema();
    const userId = `newsroom2-editor-${Date.now()}-${Math.random()}`;
    const text =
      "The planning board moved the Kimbark hearing to Oct. 2\nhttps://example.org/agenda";

    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 2 }, text, modelChoice: "auto" },
      {
        probeProvider: async () => ({ ok: true as const, choice: "claude-frontier" as const }),
        enqueueJob: async (opts) => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.equal(res.ok, true, res.ok ? "" : (res as { error: string }).error);

    // Scoped to newsroom 2: the row is there.
    const inNewsroom2 = await sql<{ id: number; user_id: string }>`
      select id, user_id from leads where user_id = ${userId} and newsroom_id = 2
    `;
    assert.equal(inNewsroom2.length, 1, "the lead did not land in newsroom 2");

    const draftInNewsroom2 = await sql<{ id: number }>`
      select id from drafts where user_id = ${userId} and newsroom_id = 2
    `;
    assert.equal(draftInNewsroom2.length, 1, "the draft did not land in newsroom 2");

    // Scoped to newsroom 1 (the old hard-coded default): the row is NOT
    // there. This is the exact silent-data-loss failure ENG-04 named -- a
    // regression here would show up as the row existing under newsroom 1
    // instead of newsroom 2, not as an error.
    const inNewsroom1 = await sql<{ id: number }>`
      select id from leads where user_id = ${userId} and newsroom_id = 1
    `;
    assert.equal(
      inNewsroom1.length,
      0,
      "the lead landed in newsroom 1 (the default) instead of the caller's newsroom 2 -- this is " +
        "the exact ENG-04 silent-data-loss bug",
    );
  });

  it("newsroom 1's own write still reads back under newsroom 1 (no regression for the default)", async () => {
    const sql = await ensureScratchSchema();
    const userId = `newsroom1-editor-${Date.now()}-${Math.random()}`;
    const text =
      "Council approves the Main Street repaving contract\nhttps://example.org/minutes";

    const res = await writeStoryForAuthenticatedEditor(
      { context: { userId, newsroomId: 1 }, text, modelChoice: "auto" },
      {
        probeProvider: async () => ({ ok: true as const, choice: "claude-frontier" as const }),
        enqueueJob: async (opts) => enqueueJob({ ...opts, kick: false }),
      },
    );
    assert.equal(res.ok, true, res.ok ? "" : (res as { error: string }).error);

    const inNewsroom1 = await sql<{ id: number }>`
      select id from leads where user_id = ${userId} and newsroom_id = 1
    `;
    assert.equal(inNewsroom1.length, 1, "a plain newsroom-1 write must still read back under newsroom 1");
  });
});

/**
 * audit-lite 0.6.11 FINDING-001 proof.
 *
 * 0.6.11's changelog and `scripts/newsroom-scoped-inserts.test.mjs`'s
 * `SCOPED_TABLES` both claimed `anomalies`, `artifacts` and `artifact_blobs`
 * were newsroom-scoped everywhere -- but every insert into them from
 * `investigate.ts` (the Dark Desk investigation engine) still hardcoded
 * `DEFAULT_NEWSROOM_ID`, unreachable by that structural guard (it only
 * checks the column is present, not what value lands in it). 0.6.13 threads
 * the real newsroom id from `dark-open.ts`/`dark.ts` down through
 * `investigate.ts`; this proves it landed, the same way the pair above
 * proves it for `leads`/`drafts`, against a real PGLite database.
 */
describe("investigate.ts's anomalies/artifacts writes land in the caller's own newsroom, not always 1", () => {
  it("seeding an investigation in newsroom 2 files its artifacts row under newsroom 2, not newsroom 1", async () => {
    const sql = await getSql();
    const userId = `newsroom2-investigate-${Date.now()}-${Math.random()}`;
    const opened = await openInvestigationForEditor(
      userId,
      { paste: "Longmont council approved the Kimbark contract.\nhttps://example.org/agenda" },
      2,
    );
    assert.equal(opened.ok, true);

    const inNewsroom2 = await sql<{ id: number }>`
      select id from artifacts
      where investigation_id = ${opened.investigationId} and newsroom_id = 2
    `;
    assert.ok(
      inNewsroom2.length >= 1,
      "seedInvestigation's rememberCapture did not file an artifacts row under newsroom 2",
    );

    const inNewsroom1 = await sql<{ id: number }>`
      select id from artifacts
      where investigation_id = ${opened.investigationId} and newsroom_id = 1
    `;
    assert.equal(
      inNewsroom1.length,
      0,
      "an artifacts row for a newsroom-2 investigation landed under newsroom 1 instead -- the exact " +
        "silent-data-loss bug FINDING-001 named",
    );
  });

  it("a research hop's anomaly (search-failed) lands under the investigation's real newsroom", async () => {
    const sql = await getSql();
    const userId = `newsroom2-anomaly-${Date.now()}-${Math.random()}`;
    const opened = await openInvestigationForEditor(userId, { paste: "Seed text, no urls here." }, 2);
    assert.equal(opened.ok, true);

    await researchLoop({
      userId,
      investigationId: opened.investigationId,
      hops: 1,
      newsroomId: 2,
      planner: async () => ({ ...emptyPlan(), searches: ["kimbark contract longmont"], stop: true }),
      searchAttempt: async () => ({
        state: "SEARCH_FAILED_NETWORK",
        hits: [],
        provider: "test",
        error: "simulated network failure",
      }),
      // No real fetches -- nothing was searched successfully, so toFetch
      // stays empty and this should never be called, but stubbed anyway so
      // a future behavior change here can't reach the real network.
      fetch: async (url: string) => ({ ok: false, status: 0, text: "", title: url, extras: [] }),
    });

    const anomNewsroom2 = await sql<{ id: number }>`
      select id from anomalies
      where investigation_id = ${opened.investigationId} and newsroom_id = 2 and kind = 'search-failed'
    `;
    assert.ok(
      anomNewsroom2.length >= 1,
      "researchLoop's search-failed anomaly did not land under newsroom 2",
    );

    const anomNewsroom1 = await sql<{ id: number }>`
      select id from anomalies
      where investigation_id = ${opened.investigationId} and newsroom_id = 1
    `;
    assert.equal(
      anomNewsroom1.length,
      0,
      "an anomaly for a newsroom-2 investigation landed under newsroom 1 instead -- the exact " +
        "silent-data-loss bug FINDING-001 named",
    );
  });
});

describe(
  "source_monitors and its anomalies land in the caller's own newsroom, not always 1 (0.6.18, closes the 0.6.11 STOP)",
  () => {
    it("watchSource files a monitor under newsroom 2, not newsroom 1", async () => {
      const sql = await getSql();
      const userId = `newsroom2-monitor-${Date.now()}-${Math.random()}`;
      const url = `https://example.org/newsroom2-monitor-${Date.now()}`;

      await watchSource({
        userId,
        url,
        title: "Newsroom 2 monitored source",
        newsroomId: 2,
        nextCheckAt: new Date(),
      });

      const inNewsroom2 = await sql<{ id: number }>`
        select id from source_monitors where user_id = ${userId} and url = ${url} and newsroom_id = 2
      `;
      assert.equal(inNewsroom2.length, 1, "watchSource did not file the monitor under newsroom 2");

      const inNewsroom1 = await sql<{ id: number }>`
        select id from source_monitors where user_id = ${userId} and url = ${url} and newsroom_id = 1
      `;
      assert.equal(
        inNewsroom1.length,
        0,
        "a newsroom-2 monitor landed under newsroom 1 instead of newsroom 2 -- the exact " +
          "silent-data-loss bug the 0.6.11 STOP named for source_monitors",
      );
    });

    it("watchSource with no newsroomId still files under newsroom 1 (no regression for the default)", async () => {
      const sql = await getSql();
      const userId = `newsroom1-monitor-${Date.now()}-${Math.random()}`;
      const url = `https://example.org/newsroom1-monitor-${Date.now()}`;

      await watchSource({ userId, url, title: "Newsroom 1 monitored source", nextCheckAt: new Date() });

      const inNewsroom1 = await sql<{ id: number }>`
        select id from source_monitors where user_id = ${userId} and url = ${url} and newsroom_id = 1
      `;
      assert.equal(inNewsroom1.length, 1, "an unscoped watchSource call should still default to newsroom 1");
    });

    it("runDueMonitors files a due monitor's disappearance anomaly under its own newsroom, not newsroom 1", async () => {
      const sql = await getSql();
      const userId = `newsroom2-due-${Date.now()}-${Math.random()}`;
      const url = `https://example.org/newsroom2-due-${Date.now()}`;

      await watchSource({
        userId,
        url,
        title: "Newsroom 2 due monitor",
        newsroomId: 2,
        nextCheckAt: new Date(0),
      });

      const result = await runDueMonitors({
        userId,
        newsroomId: 2,
        now: new Date(),
        fetch: async () => ({ ok: false, status: 404, text: "", title: "Not Found", extras: [] }),
        archives: async () => [],
      });
      assert.ok(result.checked >= 1, "runDueMonitors did not pick up the due newsroom-2 monitor");
      assert.ok(result.anomalies >= 1, "runDueMonitors did not file the disappearance anomaly");

      const anomNewsroom2 = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${url} and newsroom_id = 2 and kind = 'disappeared'
      `;
      assert.equal(
        anomNewsroom2.length,
        1,
        "the monitored disappearance did not land under the monitor's own newsroom (2)",
      );

      const anomNewsroom1 = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${url} and newsroom_id = 1
      `;
      assert.equal(
        anomNewsroom1.length,
        0,
        "a newsroom-2 monitor's anomaly landed under newsroom 1 instead -- the exact " +
          "silent-data-loss bug the 0.6.11 STOP named",
      );
    });

    it("a newsroom-1 monitor still reads back under newsroom 1 after being ticked (no regression)", async () => {
      const sql = await getSql();
      const userId = `newsroom1-due-${Date.now()}-${Math.random()}`;
      const url = `https://example.org/newsroom1-due-${Date.now()}`;

      await watchSource({ userId, url, title: "Newsroom 1 due monitor", nextCheckAt: new Date(0) });

      const result = await runDueMonitors({
        userId,
        now: new Date(),
        fetch: async () => ({ ok: false, status: 404, text: "", title: "Not Found", extras: [] }),
        archives: async () => [],
      });
      assert.ok(result.checked >= 1);

      const anomNewsroom1 = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${url} and newsroom_id = 1 and kind = 'disappeared'
      `;
      assert.equal(anomNewsroom1.length, 1, "an unscoped monitor's anomaly should still land under newsroom 1");
    });

    it("tickAllDueMonitors sweeps two newsrooms' due monitors without cross-contamination", async () => {
      const sql = await getSql();
      const stamp = `${Date.now()}-${Math.random()}`;
      const userId = `tick-cross-${stamp}`;
      const urlA = `https://example.org/tick-newsroomA-${stamp}`;
      const urlB = `https://example.org/tick-newsroomB-${stamp}`;
      const newsroomA = 9001;
      const newsroomB = 9002;

      // Same editor, two different newsrooms -- exactly the shape that
      // collapsed into one newsroom before this fix, because the old sweep
      // grouped by user_id alone.
      await watchSource({
        userId,
        url: urlA,
        title: "Tick newsroom A",
        newsroomId: newsroomA,
        nextCheckAt: new Date(0),
      });
      await watchSource({
        userId,
        url: urlB,
        title: "Tick newsroom B",
        newsroomId: newsroomB,
        nextCheckAt: new Date(0),
      });

      // Network is fully stubbed: any URL (including stray due monitors left
      // over from other tests sharing this in-process PGLite database) gets
      // a deterministic 404 so this test never makes a live request.
      await tickAllDueMonitors({
        fetch: async () => ({ ok: false, status: 404, text: "", title: "Not Found", extras: [] }),
      });

      const anomA = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${urlA} and newsroom_id = ${newsroomA} and kind = 'disappeared'
      `;
      assert.equal(anomA.length, 1, "newsroom A's monitor did not get its own anomaly from the sweep");

      const anomB = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${urlB} and newsroom_id = ${newsroomB} and kind = 'disappeared'
      `;
      assert.equal(anomB.length, 1, "newsroom B's monitor did not get its own anomaly from the sweep");

      const crossedAIntoB = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${urlA} and newsroom_id = ${newsroomB}
      `;
      assert.equal(crossedAIntoB.length, 0, "newsroom A's anomaly leaked into newsroom B");

      const crossedBIntoA = await sql<{ id: number }>`
        select id from anomalies where user_id = ${userId} and url = ${urlB} and newsroom_id = ${newsroomA}
      `;
      assert.equal(crossedBIntoA.length, 0, "newsroom B's anomaly leaked into newsroom A");
    });
  },
);
