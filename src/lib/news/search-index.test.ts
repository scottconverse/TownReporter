import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
  ensureBuilt,
  integrationRequested,
  probePostgres,
  resolveAdminUrl,
  run,
  spawnBuiltServer,
  waitForServer,
  withDatabase,
  type ChildProcess,
} from "../test-support/pg-admin.ts";
// `SEARCH_MIN_INDEXED` is imported dynamically, below, AFTER this file has
// decided whether it has a real Postgres and, if so, set `DATABASE_URL` to
// its own scratch database. `../db.ts` -- which public.ts imports -- self-inits
// a PGLite fallback the moment it is first evaluated if `DATABASE_URL` is not
// yet set (see the bottom of that file); a static top-of-file import would run
// before this file gets a chance to set it. This file otherwise talks to
// Postgres with its own `pg.Client` (`probeClient`, below) rather than
// `getSql()`, specifically so it owns that connection and can close it
// cleanly in `after` -- `getSql()` memoizes a module-global pool this file
// cannot reach to close, and asking Postgres to force-terminate it out from
// under itself surfaced as an uncaught rejection after the test run had
// already finished.

/**
 * The public archive search must stay an indexed lookup.
 *
 * `/?q=` takes no session and has no rate limit, and it used to run
 * `body ilike '%q%'` across every published story. Measured on a 20,000-story
 * archive: 217 ms and 669 shared buffers per request, which anyone could send
 * as fast as they liked (ENG-008). With migration 0018 applied the same query
 * is 0.4 ms and 37 buffers. `npm run proof:search` reproduces both numbers.
 *
 * What this file asserts is the contract, not the plan. Three earlier versions
 * asserted `EXPLAIN` output and each one was really measuring how many rows
 * happened to be in the developer's database: the planner legitimately prefers
 * a different index on a small table, so the test failed while the code was
 * correct. Cost-based choices do not belong in a unit test.
 *
 * A fourth version asked Postgres's catalogs whether `gin_trgm_ops` supports
 * `~~*` (ILIKE) at all. That question has exactly one true answer for every
 * Postgres with pg_trgm installed, on every machine, forever -- it is a fact
 * about the extension, not about this application. No edit anyone could make
 * to this repository changes what the catalog says, which is the literal
 * definition of a test that cannot fail. It is deleted, not weakened: see
 * "the search actually finds..." below for what took its place.
 *
 * What remains has four parts, and breaking any one of them puts the scan back:
 *
 *   1. the three indexes exist, and are trigram indexes, partial on
 *      `status = 'published'` (checked against the database, below);
 *   2. the query keeps the ILIKE operator, the status predicate, and the
 *      short-query floor (checked against the source -- see the note at that
 *      test for why this one property is not cleanly observable any other
 *      way);
 *   3. the search actually behaves the way the contract promises: it is
 *      case-insensitive, it never surfaces a draft, and it never sweeps the
 *      body of a story for a query shorter than the floor (checked against a
 *      real running build and a real seeded database, below).
 *
 * Parts 1 and 3 need a real Postgres with pg_trgm, reachable at
 * `TEST_POSTGRES_ADMIN_URL` (or the local default -- see
 * src/lib/test-support/pg-admin.ts). Without one -- no Postgres at all, or a
 * self-hoster's Postgres without superuser -- they skip, with a reason, rather
 * than failing a machine that cannot run them. Part 2 needs neither a database
 * nor a build and always runs. CI runs the full set for real: see the
 * `postgres-integration` job in .github/workflows/ci.yml.
 */
const COLUMNS = ["headline", "dek", "body"] as const;

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PSQL_ADMIN_URL = resolveAdminUrl();
const PORT = 3863;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const dbName = `townreporter_test_searchidx_${process.pid}_${Date.now()}`;

/*
  Opt-in, because this file builds the app and boots a server.

  Five files do that. Node's test runner starts files concurrently, so on any
  machine with Postgres on the default port they all did it at once during an
  ordinary `npm test` -- and seven unrelated database tests then timed out,
  starved rather than broken. TEST_POSTGRES_ADMIN_URL is the switch; the
  postgres-integration CI job sets it and names this file, and a gate fails if
  it ever stops doing so.
*/
const dbProbe = integrationRequested()
  ? await probePostgres(PSQL_ADMIN_URL)
  : ({
      ok: false as const,
      reason:
        "set TEST_POSTGRES_ADMIN_URL to run the integration tests (they build the app and boot a server; the postgres-integration CI job runs them on every push)",
    });

// This app's own scratch database, distinct from townreporter/townreporter_dev/
// townreporter_e2e/townreporter_audit_*. Created here, migrated (which is what
// gets pg_trgm and migration 0018's indexes in place), and dropped in `after`.
// Skipped entirely when there is no reachable Postgres -- see the file
// comment for why the tests below still register (skipped, with a reason)
// rather than silently vanishing.
// Captured BEFORE this file redirects DATABASE_URL to its scratch database:
// the third failure diagnostic below asks whether the server is secretly
// reading the job-level database instead of the per-file override.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
let probeClient: Client | undefined;
if (dbProbe.ok) {
  const admin = new Client({ connectionString: PSQL_ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
  process.env.DATABASE_URL = dbUrl;

  probeClient = new Client({ connectionString: dbUrl });
  await probeClient.connect();

  // Migrate BEFORE checking for trigrams: migration 0018 is what installs
  // pg_trgm and the indexes in the first place. Checking for trigrams first
  // and migrating only inside `if (HAS_TRGM)` -- as an earlier version of
  // this file did -- checks a fresh, unmigrated database and always finds
  // nothing, which made every Postgres look like it lacked pg_trgm.
  await run(process.execPath, [join(repoRoot, "scripts", "migrate.mjs")], repoRoot, {
    ...process.env,
    DATABASE_URL: dbUrl,
  });
}

const { SEARCH_MIN_INDEXED } = await import("./public.ts");

/**
 * Is this a Postgres that actually has trigrams?
 *
 * The unit suite runs against PGLite when DATABASE_URL is unset, and PGLite
 * ships no pg_trgm. Migration 0018 is written to notice that and skip the
 * indexes rather than refuse to start, which is also what a self-hoster
 * without superuser gets. Asserting indexes there would fail on a correctly
 * degraded database, so this check announces the skip instead of pretending
 * to have run. This file always creates its own real Postgres scratch
 * database when one is reachable (see above), so in practice HAS_TRGM is true
 * there -- the guard is kept because the sub-tests below are also meaningful,
 * unmodified, against a self-hoster's real (superuser-less) database.
 */
async function trigramsAvailable(): Promise<boolean> {
  if (!probeClient) return false;
  try {
    const { rows } = await probeClient.query<{ n: number }>(
      "select count(*)::int as n from pg_extension where extname = 'pg_trgm'",
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

const HAS_TRGM = await trigramsAvailable();
const skip = !dbProbe.ok
  ? dbProbe.reason
  : HAS_TRGM
    ? false
    : "no pg_trgm on this database (PGLite or no superuser)";

// --- real build + real server, for the behavioral contract tests below ---
// (see sign-in-throttle.test.ts for the long version of why a build is
// needed at all: `createServerFn`-wrapped functions like `searchPublished`
// throw "No Start context found" when called directly outside the framework's
// request runtime, so a real HTTP request against the real `/?q=` route --
// the one the public actually uses -- is the road in, not a shortcut.)
let server: ChildProcess | undefined;

after(async () => {
  server?.kill();
  await probeClient?.end();
  if (dbProbe.ok) {
    const admin = new Client({ connectionString: PSQL_ADMIN_URL });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});

// A marker shared by the three "actually finds" tests below, computed
// unconditionally so it exists even when HAS_TRGM is false and the block
// never runs -- keeps the skipped-test registration below simple.
const marker = `Zqxwvtneedle${process.pid}`;

if (HAS_TRGM && probeClient) {
  const dbUrl = withDatabase(PSQL_ADMIN_URL, dbName);
  await ensureBuilt(repoRoot);
  server = spawnBuiltServer(repoRoot, dbUrl, PORT);
  await waitForServer(BASE_URL, 30_000);

  // Three seeded stories exercise the three parts of the contract that a
  // query-plan or catalog check cannot: published-only, case-insensitive
  // substring matching, and the short-query floor. All three share one
  // unlikely marker so a hit can only mean the search found this row.
  await probeClient.query(
    `insert into articles (user_id, slug, headline, dek, body, topic, status)
     values ('search-probe', $1, 'Marker headline published', 'dek', $2, 'council', 'published')`,
    [`search-probe-published-${process.pid}`, `A story whose body mentions ${marker} once.`],
  );
  await probeClient.query(
    `insert into articles (user_id, slug, headline, dek, body, topic, status)
     values ('search-probe', $1, 'Marker headline draft', 'dek', $2, 'council', 'draft')`,
    [`search-probe-draft-${process.pid}`, `A draft body that also mentions ${marker}.`],
  );
}

describe("the search actually finds what the contract promises, end to end", () => {
  it("matches a body substring case-insensitively, through the real running app", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/?q=${encodeURIComponent(marker.toLowerCase())}`);
    const html = await res.text();
    // On failure, show the part that matters: node's assert diff truncates the
    // page before the main content, so a miss printed 6KB of <head> and nav
    // and cut off exactly where the answer was. The chip rail ends where the
    // stories (or the empty-state) begin.
    const afterChips = html.slice(html.lastIndexOf("chip-rail")).slice(0, 2600);
    /*
      Discriminate "the row is not there" from "the server cannot see it".
      CI renders the empty state with no server-side error logged, while the
      identical run passes locally -- so at failure time, ask the SAME
      database the server was spawned against, over the probe connection,
      the SAME question the server-fn asks.
    */
    /*
      Second discriminator: the RSS feed reads the same articles table through
      a plain server route -- no server-fn, no router loader. If /feed carries
      the marker story while the page does not, the database connection is
      fine and the break is in the SSR loader/server-fn path of the Linux
      build specifically.
    */
    let feedSays = "feed unavailable";
    try {
      const feed = await (await fetch(`${BASE_URL}/feed`)).text();
      feedSays = /Marker headline published/.test(feed)
        ? "the RSS feed DOES carry the story"
        : "the RSS feed does NOT carry the story either";
    } catch (err) {
      feedSays = `feed fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    /*
      Third discriminator: is the server reading the JOB-level database
      instead of the scratch one? Seed a distinct marker into the original
      DATABASE_URL (townreporter_ci in CI) and re-ask the feed. If THAT
      marker appears, the spawn-time DATABASE_URL override is being lost.
    */
    let originSays = "no original DATABASE_URL to test";
    if (ORIGINAL_DATABASE_URL) {
      try {
        const origin = new Client({ connectionString: ORIGINAL_DATABASE_URL });
        await origin.connect();
        await origin.query(
          `insert into articles (user_id, slug, headline, dek, body, topic, status)
           values ('search-probe', $1, 'Origin-db marker headline', 'dek', 'origin db probe', 'council', 'published')
           on conflict do nothing`,
          [`origin-probe-${process.pid}`],
        );
        await origin.end();
        const feed2 = await (await fetch(`${BASE_URL}/feed`)).text();
        originSays = /Origin-db marker headline/.test(feed2)
          ? "the server IS reading the job-level DATABASE_URL, not the scratch override"
          : "the server is not reading the job-level DATABASE_URL either";
      } catch (err) {
        originSays = `origin-db probe failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    /*
      Fourth discriminator, the conclusive one: write THROUGH the server,
      read via the probe. A signup that lands in the scratch database proves
      the server is on it; a signup the probe cannot see means the server
      silently fell back to its in-memory PGLite -- DATABASE_URL invisible
      inside the Linux build artifact.
    */
    let writeSays = "write probe skipped";
    try {
      const su = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `searchdiag-${process.pid}@townreporter.test`,
          password: "search-diag-pass-8",
          name: "Search Diag",
        }),
      });
      const seen = probeClient
        ? await probeClient.query(`select count(*)::int as n from "user" where email like 'searchdiag-%'`)
        : null;
      writeSays = `signup HTTP ${su.status}; probe sees ${seen?.rows[0]?.n ?? "?"} such user(s) in scratch`;
    } catch (err) {
      writeSays = `write probe failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    let probeSays = "probe unavailable";
    if (probeClient) {
      try {
        const direct = await probeClient.query(
          `select count(*)::int as n from articles
           where status = 'published' and body ilike $1`,
          [`%${marker.toLowerCase()}%`],
        );
        probeSays = `direct ilike over the same database finds ${direct.rows[0]?.n} row(s)`;
      } catch (err) {
        probeSays = `probe query failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    assert.match(
      html,
      /Marker headline published/,
      "a lowercase query did not find a story whose body contains the marker in mixed case -- " +
        "the search is not doing case-insensitive substring matching against body. " +
        `${probeSays}; ${feedSays}; ${originSays}; ${writeSays}. What the page shows after the chip rail:\n${afterChips}`,
    );
  });

  it("never surfaces a draft, no matter what its body contains", { skip }, async () => {
    const res = await fetch(`${BASE_URL}/?q=${encodeURIComponent(marker)}`);
    const html = await res.text();
    assert.doesNotMatch(
      html,
      /Marker headline draft/,
      "an unpublished story's body matched the public search -- the status = 'published' " +
        "predicate is not actually filtering results",
    );
  });

  it("does not sweep the body for a query shorter than the floor", { skip }, async () => {
    const shortQuery = marker.slice(0, SEARCH_MIN_INDEXED - 1);
    const res = await fetch(`${BASE_URL}/?q=${encodeURIComponent(shortQuery)}`);
    const html = await res.text();
    assert.doesNotMatch(
      html,
      /Marker headline published/,
      `a ${shortQuery.length}-character query (below SEARCH_MIN_INDEXED=${SEARCH_MIN_INDEXED}) matched a ` +
        "story only by its body -- the short-query floor is not disabling the body sweep",
    );
  });
});

describe("the public archive search is index-backed", () => {
  it("carries a partial trigram index on every column the search reads", { skip }, async () => {
    const { rows } = await probeClient!.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where tablename = 'articles'",
    );
    const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    for (const col of COLUMNS) {
      const def = byName.get(`articles_${col}_trgm`);
      assert.ok(def, `missing articles_${col}_trgm (have: ${[...byName.keys()].join(", ")})`);
      assert.match(def, /USING gin/i, `articles_${col}_trgm is not a GIN index`);
      assert.match(def, /gin_trgm_ops/, `articles_${col}_trgm is not a trigram index`);
      assert.match(
        def,
        /WHERE \(?status = 'published'/i,
        `articles_${col}_trgm is not partial on published, so it indexes drafts too`,
      );
    }
  });

  /*
    Left as a source check on purpose. Whether the code spells the comparison
    `ilike`, a regex, or `lower(x) like lower(y)` is not something the search's
    OBSERVABLE behavior distinguishes: all three can return identical rows for
    identical input (the "the search actually finds..." tests above cover that
    observable contract and run against a real database). What differs is only
    which operator Postgres can serve from `gin_trgm_ops` -- a fact about the
    query's SQL text, not about any result set a test could construct. That is
    the one property in this file for which reading the source is not a
    shortcut but the direct check. No database needed, so it always runs.
  */
  it("the query still says published, and still refuses a two-character scan", () => {
    const src = readFileSync(new URL("./public.ts", import.meta.url), "utf8");
    const search = src.slice(src.indexOf("export const searchPublished"));
    const body = search.slice(0, search.indexOf("export const", 10));
    for (const col of COLUMNS) {
      assert.match(
        body,
        new RegExp(`${col} ilike`),
        `the search no longer uses ILIKE on ${col}, so its trigram index is dead`,
      );
    }
    assert.match(
      body,
      /status = 'published'/,
      "without the status predicate the partial indexes cannot be used at all",
    );
    assert.match(body, /q\.length >= SEARCH_MIN_INDEXED/, "the short-query floor is gone");
    assert.equal(SEARCH_MIN_INDEXED, 3, "a trigram is three characters; a lower floor scans");
  });
});
