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
 * Unit U28 (2026-09-30): the duplicate check's verdict, on a REAL Postgres.
 *
 * The unit tests prove the question, the answer and the filing decision
 * against scratch PGlite tables they declare themselves. This proves the part
 * only a migrated database can: that migration 0113's eight columns exist on
 * `leads` as the migration writes them (the boot guard refuses a database
 * behind `migrations/*.sql`, and a test that declares its own table cannot
 * catch a migration that was never written), that a real INSERT carries the
 * check's verdict and its sentence through, and that the row read back is the
 * row the Queue draws its chip from -- `printedDupChip` returns the model's
 * own line for it.
 *
 * No model is called. The check runs through `runDupCheck` with a fake
 * `DupCheckChat` closure, the same seam the unit tests use and the same one
 * the scan worker binds to `grokChat` in production (desk.ts), so what is
 * being proved here is the persistence, not a provider.
 *
 * Named in the `postgres-integration` CI job in `.github/workflows/ci.yml`
 * through scripts/postgres-test-discovery.mjs, which finds it by its import of
 * `../test-support/pg-admin.ts`; enforced by
 * scripts/postgres-tests-are-covered.test.mjs. It skips with a reason when
 * `TEST_POSTGRES_ADMIN_URL` is not set, exactly as its siblings do.
 */

const PSQL_ADMIN_URL = integrationRequested() ? resolveAdminUrl() : "";
const dbName = `townreporter_test_dupcheck_${process.pid}_${Date.now()}`;

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
let collectDupPairs: typeof import("./dup-check.ts").collectDupPairs;
let runDupCheck: typeof import("./dup-check.ts").runDupCheck;
let printedDupChip: typeof import("./desk-copy.ts").printedDupChip;
let printedDuplicateLine: typeof import("./desk-copy.ts").printedDuplicateLine;
let getSql: typeof import("../db.ts").getSql;
let closePoolForTests: typeof import("../db.ts").closePoolForTests;

const NEWSROOM_ID = 1;
const USER_ID = "dup-check-test-user";
/** The live paper's own place, as `getPaperPlace` reads it -- the matcher's
 * region words are the paper's, not the software's. */
const PLACE = { city: "Longmont", state: "Colorado", county: "Boulder" };

/** The real pair from lead-match.ts's doc comment: one PrimeGov page, two
 * headlines, "possible" because their content-token Jaccard is nowhere near
 * matchStrength's 0.85 "strong" bar. */
const EXISTING_HEADLINE =
  "Longmont council has two closed-door executive sessions on the books for late September";
const EXISTING_WHY = "Two closed sessions are scheduled.";
const CANDIDATE = {
  headline:
    "Council books two executive sessions in eight days -- Sept. 22 and Sept. 29 -- with packets already posted",
  why: "Both packets are public.",
  topic: "council",
  source_urls: ["https://longmontleader.com/agenda/sept-council"],
};

/** A candidate the word rule chips against a PUBLISHED story: two shared real
 * names and one section is `nearDuplicate`'s second way in. */
const BOHN_CANDIDATE = {
  headline: "Bohn Farm rezoning heads to the planning board in October",
  why: "The board takes it up Tuesday.",
  topic: "council",
  source_urls: ["https://longmontleader.com/bohn-farm-rezoning"],
};
const BOHN_PRINTED = [
  {
    slug: "bohn-farm-water-tests",
    headline: "Bohn Farm well water tests find nitrates near the creek",
    dek: "Testing found the creek downstream of the farm over the limit.",
    topic: "council",
    published_at: "2026-09-01T10:00:00Z",
  },
];

const answering =
  (same: boolean, why: string): import("./dup-check.ts").DupCheckChat =>
  async (_system, user) =>
    ({
      ok: true as const,
      text: JSON.stringify((JSON.parse(user) as { id: number }[]).map((p) => ({ id: p.id, same, why }))),
      model: "deepseek-v4.1-flash:cloud",
    });

type FiledRow = {
  id: number;
  possible_duplicate_of: number | null;
  dup_kind: string | null;
  dup_ai_same: boolean | null;
  dup_ai_why: string | null;
  dup_ai_target: string | null;
  dup_ai_printed_same: boolean | null;
  dup_ai_printed_why: string | null;
  dup_ai_printed_slug: string | null;
  dup_ai_model: string | null;
  dup_ai_checked_at: Date | null;
};

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

    const filing = await import("./lead-filing.ts");
    const check = await import("./dup-check.ts");
    const copy = await import("./desk-copy.ts");
    const db = await import("../db.ts");
    fileScanLeads = filing.fileScanLeads;
    collectDupPairs = check.collectDupPairs;
    runDupCheck = check.runDupCheck;
    printedDupChip = copy.printedDupChip;
    printedDuplicateLine = copy.printedDuplicateLine;
    getSql = db.getSql;
    closePoolForTests = db.closePoolForTests;
  }, { timeout: 60_000 });

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
  }, { timeout: 30_000 });
}

describe("U28: the duplicate check's verdict persists and reaches the Queue read", () => {
  it(
    "migration 0113's columns are on leads as the migration writes them",
    { skip },
    async () => {
      const sql = await getSql();
      const cols = await sql<{ column_name: string }>`
        select column_name from information_schema.columns
        where table_name = 'leads'
          and column_name in ('dup_ai_same','dup_ai_why','dup_ai_target',
            'dup_ai_printed_same','dup_ai_printed_why','dup_ai_printed_slug',
            'dup_ai_model','dup_ai_checked_at')
      `;
      assert.equal(cols.length, 8, "all eight columns exist on a migrated database");
    },
  );

  it(
    "a 'no' on the matcher's possible tier persists as no link, with the model's reason on the row",
    { skip },
    async () => {
      const sql = await getSql();
      const runRows = await sql<{ id: number }>`
        insert into scan_runs (user_id, newsroom_id) values (${USER_ID}, ${NEWSROOM_ID}) returning id
      `;
      const runId = runRows[0]!.id;

      const seeded = await sql<{ id: number }>`
        insert into leads (user_id, newsroom_id, headline, why, topic, status, source_urls, newsworthiness)
        values (${USER_ID}, ${NEWSROOM_ID}, ${EXISTING_HEADLINE}, ${EXISTING_WHY}, ${"council"}, ${"new"},
                ${JSON.stringify(["https://longmontleader.com/agenda/sept-council"])}, 6)
        returning id
      `;
      const existing = [
        {
          id: seeded[0]!.id,
          status: "new",
          headline: EXISTING_HEADLINE,
          source_urls: ["https://longmontleader.com/agenda/sept-council"],
          why: EXISTING_WHY,
        },
      ];

      const { pairs } = collectDupPairs({ candidates: [CANDIDATE], existing, printed: [], place: PLACE });
      assert.equal(pairs.length, 1, "the matcher rates this pair 'possible', so the desk asks");
      const outcome = await runDupCheck({
        pairs,
        chat: answering(false, "one is an executive session, the other is a permit hearing"),
      });
      assert.equal(outcome.failure, null);

      const result = await fileScanLeads(sql, { userId: USER_ID }, NEWSROOM_ID, runId, [CANDIDATE], existing, PLACE, outcome);
      assert.equal(result.dupCheckCleared, 1);
      assert.equal(result.possibleMatched, 0);

      const rows = await sql<FiledRow>`
        select id, possible_duplicate_of, dup_kind, dup_ai_same, dup_ai_why, dup_ai_target,
               dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug, dup_ai_model, dup_ai_checked_at
        from leads where scan_run_id = ${runId} and newsroom_id = ${NEWSROOM_ID}
      `;
      const filed = rows[0]!;
      assert.equal(filed.possible_duplicate_of, null, "no link, so no 'Possible duplicate · compare' chip");
      assert.equal(filed.dup_kind, null);
      assert.equal(filed.dup_ai_same, false);
      assert.equal(filed.dup_ai_why, "one is an executive session, the other is a permit hearing");
      assert.equal(filed.dup_ai_target, EXISTING_HEADLINE);
      assert.equal(filed.dup_ai_model, "deepseek-v4.1-flash:cloud");
      assert.ok(filed.dup_ai_checked_at instanceof Date);
      // The half the desk was NOT asked about stays null, which is not "no".
      assert.equal(filed.dup_ai_printed_same, null);
      assert.equal(filed.dup_ai_printed_slug, null);
    },
  );

  it(
    "the Queue read returns the reason: the row's chip says who said what, and a 'no' is not on it",
    { skip },
    async () => {
      const sql = await getSql();
      const runRows = await sql<{ id: number }>`
        insert into scan_runs (user_id, newsroom_id) values (${USER_ID}, ${NEWSROOM_ID}) returning id
      `;
      const runId = runRows[0]!.id;

      const { pairs } = collectDupPairs({
        candidates: [BOHN_CANDIDATE],
        existing: [],
        printed: BOHN_PRINTED,
        place: PLACE,
      });
      assert.equal(pairs.length, 1);
      assert.equal(pairs[0]!.kind, "printed");

      const yes = await runDupCheck({
        pairs,
        chat: answering(true, "same rezoning vote, same planning board date"),
      });
      await fileScanLeads(sql, { userId: USER_ID }, NEWSROOM_ID, runId, [BOHN_CANDIDATE], [], PLACE, yes);

      /* The exact columns the Queue's own reader projects (desk.ts's
         `queryLeadRows`, pinned there by lead-possible-duplicate-projection's
         test), read back from a real database rather than off an object. */
      const readBack = await sql<{ headline: string; topic: string | null } & FiledRow>`
        select id, headline, topic, possible_duplicate_of, dup_kind,
               dup_ai_same, dup_ai_why, dup_ai_target,
               dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug,
               dup_ai_model, dup_ai_checked_at
        from leads where scan_run_id = ${runId} and newsroom_id = ${NEWSROOM_ID} limit 1
      `;
      const row = readBack[0]!;
      const chip = printedDupChip(row, BOHN_PRINTED, PLACE);
      assert.ok(chip, "the word rule's chip survived the yes");
      assert.equal(chip.slug, "bohn-farm-water-tests");
      assert.equal(
        printedDuplicateLine(chip.headline, chip.aiWhy),
        "Looks already printed: Bohn Farm well water tests find nitrates near the creek — AI: same rezoning vote, same planning board date",
      );

      /*
        And the same row under a "no" -- the other half of the pair, filed by
        the same code path, so "the reason shows" is not being read off a row
        that would have been chipped either way.
      */
      const no = await runDupCheck({
        pairs,
        chat: answering(false, "one is a rezoning, the other is a water test"),
      });
      await fileScanLeads(
        sql,
        { userId: USER_ID },
        NEWSROOM_ID,
        runId,
        [{ ...BOHN_CANDIDATE, headline: "Bohn Farm rezoning returns to the planning board" }],
        [],
        PLACE,
        no,
      );
      const second = await sql<{ headline: string; topic: string | null } & FiledRow>`
        select id, headline, topic, possible_duplicate_of, dup_kind,
               dup_ai_same, dup_ai_why, dup_ai_target,
               dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug,
               dup_ai_model, dup_ai_checked_at
        from leads where scan_run_id = ${runId} and newsroom_id = ${NEWSROOM_ID}
          and headline = ${"Bohn Farm rezoning returns to the planning board"}
      `;
      assert.equal(printedDupChip(second[0]!, BOHN_PRINTED, PLACE), null, "a 'no' leaves no chip to explain");
      assert.equal(second[0]!.dup_ai_printed_why, "one is a rezoning, the other is a water test");
    },
  );

  it(
    "a check that failed stores nothing at all, so the row behaves exactly as it did before this unit",
    { skip },
    async () => {
      const sql = await getSql();
      const runRows = await sql<{ id: number }>`
        insert into scan_runs (user_id, newsroom_id) values (${USER_ID}, ${NEWSROOM_ID}) returning id
      `;
      const runId = runRows[0]!.id;

      const { pairs } = collectDupPairs({
        candidates: [BOHN_CANDIDATE],
        existing: [],
        printed: BOHN_PRINTED,
        place: PLACE,
      });
      const outcome = await runDupCheck({
        pairs,
        chat: async () => ({ ok: false as const, error: "timed out after 90000ms" }),
      });
      assert.ok(outcome.failure);

      await fileScanLeads(sql, { userId: USER_ID }, NEWSROOM_ID, runId, [BOHN_CANDIDATE], [], PLACE, outcome);

      const rows = await sql<{ headline: string; topic: string | null } & FiledRow>`
        select id, headline, topic, possible_duplicate_of, dup_kind,
               dup_ai_same, dup_ai_why, dup_ai_target,
               dup_ai_printed_same, dup_ai_printed_why, dup_ai_printed_slug,
               dup_ai_model, dup_ai_checked_at
        from leads where scan_run_id = ${runId} and newsroom_id = ${NEWSROOM_ID} limit 1
      `;
      const row = rows[0]!;
      assert.equal(row.dup_ai_printed_same, null);
      assert.equal(row.dup_ai_model, null);
      assert.equal(row.dup_ai_checked_at, null);
      const chip = printedDupChip(row, BOHN_PRINTED, PLACE);
      assert.ok(chip, "the word rule stands");
      assert.equal(
        printedDuplicateLine(chip.headline, chip.aiWhy),
        "Looks already printed: Bohn Farm well water tests find nitrates near the creek",
      );
    },
  );
});
