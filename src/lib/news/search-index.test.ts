import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSql } from "../db.ts";
import { SEARCH_MIN_INDEXED } from "./public.ts";

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
 * The contract has four parts, and breaking any one of them puts the scan back:
 *
 *   1. the three indexes exist, and are trigram indexes;
 *   2. they are partial on `status = 'published'`, so the query must say so;
 *   3. the operator the code uses (ILIKE) is one the index can serve -- this is
 *      what fails if someone rewrites the search as a regex or `lower(x) like`;
 *   4. the query keeps the `status` predicate and the short-query floor.
 */
const COLUMNS = ["headline", "dek", "body"] as const;

/**
 * Is this a Postgres that actually has trigrams?
 *
 * The unit suite runs against PGLite when DATABASE_URL is unset, and PGLite
 * ships no pg_trgm. Migration 0018 is written to notice that and skip the
 * indexes rather than refuse to start, which is also what a self-hoster
 * without superuser gets. Asserting indexes there would fail on a correctly
 * degraded database, so these two checks announce the skip instead of
 * pretending to have run. The source-shape check below always runs.
 */
async function trigramsAvailable(): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from pg_extension where extname = 'pg_trgm'
    `;
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

const HAS_TRGM = await trigramsAvailable();
const skip = HAS_TRGM ? false : "no pg_trgm on this database (PGLite or no superuser)";

describe("the public archive search is index-backed", () => {
  it("carries a partial trigram index on every column the search reads", { skip }, async () => {
    const sql = await getSql();
    const rows = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes where tablename = 'articles'
    `;
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

  it("the index can serve the operator the search actually uses", { skip }, async () => {
    // ILIKE is `~~*`. If the search is ever rewritten as a regex or wrapped in
    // lower(), the rewritten operator will not be in this list and the index
    // becomes decorative while every other test stays green.
    const sql = await getSql();
    const rows = await sql<{ oprname: string }>`
      select o.oprname
      from pg_amop ao
      join pg_opfamily f on f.oid = ao.amopfamily
      join pg_operator o on o.oid = ao.amopopr
      where f.opfname = 'gin_trgm_ops'
    `;
    const ops = rows.map((r) => r.oprname);
    assert.ok(ops.includes("~~*"), `gin_trgm_ops does not support ILIKE (has: ${ops.join(" ")})`);
  });

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
