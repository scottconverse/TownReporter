import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import {
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  withDatabase,
} from "../test-support/pg-admin.ts";

/**
 * A killed lead the scanner rediscovers must be stamped, not refiled.
 *
 * Before this feature, `performScanWork`'s lead loop inserted every
 * AI-returned lead as a brand new row with no check against what already
 * existed -- a lead the editor killed came back, unmatched, every scan. The
 * fix is `fileScanLeads` (src/lib/news/lead-filing.ts), the filing loop pulled out
 * of `performScanWork` so it can run here against a real Postgres without a
 * real scan (no sources to fetch, no AI to call). It matches each
 * AI-returned lead against `existing` in code (`findMatchingLead`,
 * ./lead-match.ts -- unit-tested on its own in lead-match.test.ts) and, on a
 * match, updates the existing row's resurfaced_count / last_resurfaced_at /
 * last_resurfaced_scan_run_id instead of inserting a duplicate.
 *
 * This test seeds one killed lead and one open (new) lead, runs the filing
 * loop with three AI leads -- one that matches the killed lead, one that
 * matches the open lead, and one with nothing to match -- and asserts: two
 * stamps (one counted as resurfacedKilled, one as resurfacedOpen), one
 * insert, and that the stamped rows keep every original field (nothing
 * hidden or deleted, per the operator's binding requirement).
 *
 * Needs a real Postgres (`TEST_POSTGRES_ADMIN_URL` — see pg-admin.ts); skips
 * with a reason otherwise. Named in the `postgres-integration` CI job in
 * `.github/workflows/ci.yml`, enforced by
 * `scripts/postgres-tests-are-covered.test.mjs`.
 */

const PSQL_ADMIN_URL = resolveAdminUrl();
const dbName = `townreporter_test_resurface_${process.pid}_${Date.now()}`;

const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run this test (real Postgres; the postgres-integration " +
        "CI job runs it on every push)",
    });
const skip = dbProbe.ok ? false : dbProbe.reason;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let fileScanLeads: typeof import("./lead-filing.ts").fileScanLeads;
let getSql: typeof import("../db.ts").getSql;
let closePoolForTests: typeof import("../db.ts").closePoolForTests;

const NEWSROOM_ID = 1;
const USER_ID = "resurface-test-user";

if (dbProbe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();

    const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
    // Set BEFORE importing anything that touches ../db.ts -- it reads
    // DATABASE_URL the moment it is first evaluated and would otherwise fall
    // back to PGLite.
    process.env.DATABASE_URL = dbUrl;
    process.env.TOWNREPORTER_CLAUDE_CODE = "0";

    await run(process.execPath, [repoRoot + "scripts/migrate.mjs"], repoRoot, {
      ...process.env,
      DATABASE_URL: dbUrl,
    });

    const leadFiling = await import("./lead-filing.ts");
    const db = await import("../db.ts");
    fileScanLeads = leadFiling.fileScanLeads;
    getSql = db.getSql;
    closePoolForTests = db.closePoolForTests;
  }, 60_000);

  after(async () => {
    await closePoolForTests?.();
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      )
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }, 30_000);
}

describe("fileScanLeads stamps a resurfaced lead instead of refiling it", () => {
  it(
    "stamps a matching killed lead, stamps a matching open lead, and inserts a genuinely new one",
    { skip },
    async () => {
      const sql = await getSql();
      const runRows = await sql<{ id: number }>`
        insert into scan_runs (user_id, newsroom_id) values (${USER_ID}, ${NEWSROOM_ID}) returning id
      `;
      const runId = runRows[0]!.id;

      const killedRows = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (
          ${USER_ID}, ${NEWSROOM_ID},
          'Longmont council has two closed-door executive sessions on the books for late September',
          'Testing a resurfaced kill', 'council', 'killed',
          ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 8
        )
        returning id
      `;
      const killedId = killedRows[0]!.id;

      const openRows = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (
          ${USER_ID}, ${NEWSROOM_ID},
          'Longmont library board discusses branch hours', 'Testing an open match', 'council', 'new',
          ${JSON.stringify(["https://longmontcolorado.gov/library-board"])}, 4
        )
        returning id
      `;
      const openId = openRows[0]!.id;

      const existing = [
        {
          id: killedId,
          status: "killed",
          headline: "Longmont council has two closed-door executive sessions on the books for late September",
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
        },
        {
          id: openId,
          status: "new",
          headline: "Longmont library board discusses branch hours",
          source_urls: ["https://longmontcolorado.gov/library-board"],
        },
      ];

      const aiLeads = [
        {
          // Reworded repeat of the killed lead, same source -- must stamp, not insert.
          headline: "Two closed executive sessions are on the books for Longmont city council in late September",
          why: "Same closed-session story, reworded by the scan.",
          topic: "council",
          source_urls: ["https://www.longmontleader.com/agenda/sept-council/"],
          evidence: "",
          newsworthiness: 8,
        },
        {
          // Same open lead verbatim -- must stamp, not insert a duplicate.
          headline: "Longmont library board discusses branch hours",
          why: "Same open lead, unchanged.",
          topic: "council",
          source_urls: ["https://longmontcolorado.gov/library-board"],
          evidence: "",
          newsworthiness: 4,
        },
        {
          // A genuinely new story -- must insert.
          headline: "Longmont approves new roundabout funding for Ken Pratt Boulevard",
          why: "Brand new item, no match against anything seeded.",
          topic: "infrastructure",
          source_urls: ["https://longmontcolorado.gov/roundabout-funding"],
          evidence: "",
          newsworthiness: 6,
        },
      ];

      const result = await fileScanLeads(
        sql,
        { userId: USER_ID, newsroomId: NEWSROOM_ID },
        NEWSROOM_ID,
        runId,
        aiLeads,
        existing,
      );

      assert.equal(result.leadsCreated, 1, "exactly one genuinely new lead should have been inserted");
      assert.equal(result.resurfacedKilled, 1, "the killed lead should count as one resurfaced-killed match");
      assert.equal(result.resurfacedOpen, 1, "the open lead should count as one resurfaced-open match");

      const killedAfter = await sql<{
        status: string;
        resurfaced_count: number;
        last_resurfaced_at: string | null;
        last_resurfaced_scan_run_id: number | null;
        headline: string;
        why: string;
      }>`
        select status, resurfaced_count, last_resurfaced_at, last_resurfaced_scan_run_id, headline, why
        from leads where id = ${killedId}
      `;
      assert.equal(killedAfter[0]!.status, "killed", "kill status must not change -- nothing is auto-restored");
      assert.equal(killedAfter[0]!.resurfaced_count, 1);
      assert.ok(killedAfter[0]!.last_resurfaced_at, "last_resurfaced_at should be set");
      assert.equal(killedAfter[0]!.last_resurfaced_scan_run_id, runId);
      assert.equal(
        killedAfter[0]!.headline,
        "Longmont council has two closed-door executive sessions on the books for late September",
        "the original lead's own data must be untouched -- nothing is hidden or deleted",
      );

      const openAfter = await sql<{ status: string; resurfaced_count: number }>`
        select status, resurfaced_count from leads where id = ${openId}
      `;
      assert.equal(openAfter[0]!.status, "new");
      assert.equal(openAfter[0]!.resurfaced_count, 1);

      const allLeads = await sql<{ id: number }>`
        select id from leads where newsroom_id = ${NEWSROOM_ID}
      `;
      assert.equal(allLeads.length, 3, "no duplicate rows: two seeded + exactly one newly inserted");
    },
  );
});
