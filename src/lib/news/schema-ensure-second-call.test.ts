/*
  A routed `ensure*` function must run its DDL once per database, not once per
  call.

  This is the unit-level half of the paper-read-lock fix; the other half is
  `paper-settings-read-lock.test.ts`, which holds ACCESS SHARE from a second
  connection and proves a *read* path no longer waits on a `pg_dump`. That test
  needs a real Postgres. This one needs nothing but the PGLite the node test
  process already builds, and it measures the property directly: count the
  statements a second call actually sends.

  The instrument is the shared PGlite instance's own `query`. `createPgliteSql`
  wraps it as `await pg.query(text, params)` -- a property lookup at call time,
  not a captured reference -- so replacing that one property intercepts every
  query the `sql` handle makes, including the ones issued deep inside
  `ensureSchemaOnce`. Nothing else in the process is affected.

  No `DATABASE_URL` may be set here (this file is PGlite-only): with one set,
  `getSql()` returns the Neon handle and the interception silently measures
  nothing. The assertions below would still pass against a warm Postgres on the
  "no DDL on the second call" line, so the first-call assertion is there to
  fail loudly if the instrument is wrong: on an empty PGlite the first call MUST
  send the statements, and it sends them through the patched `query` or not at
  all.

  It imports no `pg`, so it is not picked up by the postgres-integration
  discovery: it stays an ordinary PGlite unit test.
*/

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { ensureSchemaOnce, getSql } from "../db.ts";
import { ensurePaperSettingsSchema } from "./paper-settings.ts";
import { ensureInvestigateSchema } from "./investigate.ts";

const MARKER_TABLE = "_schema_ensure_state";

// Bug 19a: failed schema batches were fingerprinted as successful and never retried.
it("failed ensure logs, leaves no fingerprint, and retries", async () => {
  const sql = await getSql();
  const statements = ["create table ensure_retry_fixture(id integer references ensure_retry_parent(id))"];
  const logs: unknown[][] = [], previous = console.error;
  console.error = (...args) => { logs.push(args); };
  try {
    await assert.rejects(ensureSchemaOnce(sql, "retry-fixture", statements), /ensure_retry_parent/);
    assert.equal((await sql`select * from _schema_ensure_state where name='retry-fixture'`).length, 0);
    assert.equal(logs.length, 1);
    await sql`create table ensure_retry_parent(id integer primary key)`;
    assert.equal(await ensureSchemaOnce(sql, "retry-fixture", statements), "ran");
    assert.equal(await ensureSchemaOnce(sql, "retry-fixture", statements), "skipped");
  } finally { console.error = previous; }
});

// Bug 19b: ensure-created NOT VALID foreign keys stayed unvalidated after orphan data was repaired.
it("investigation foreign keys log orphan data and validate after repair", async () => {
  const sql = await getSql();
  const previous = console.error, logs: unknown[][] = [];
  console.error = (...args) => { logs.push(args); };
  try {
    await sql`alter table frontier_items drop constraint frontier_items_investigation_id_fkey`;
    await sql`alter table artifacts drop constraint artifacts_investigation_id_fkey`;
    await sql`insert into frontier_items(user_id,investigation_id,kind,label) values('validation-fixture',987654,'question','Fixture')`;
    await sql`insert into artifacts(user_id,investigation_id,url,content_hash) values('validation-fixture',987654,'https://example.test/fixture','fixture')`;
    await sql`delete from _schema_ensure_state where name='investigate'`;
    await ensureInvestigateSchema();
    const constraints = () => sql<{ convalidated: boolean }>`select convalidated from pg_constraint where conname in ('frontier_items_investigation_id_fkey','artifacts_investigation_id_fkey')`;
    assert.deepEqual((await constraints()).map((c) => c.convalidated), [false, false]);
    assert.equal(logs.length, 2);
    await sql`insert into investigations(id,user_id,title) values(987654,'validation-fixture','Repaired')`;
    await ensureInvestigateSchema();
    assert.deepEqual((await constraints()).map((c) => c.convalidated), [true, true]);
  } finally { console.error = previous; }
});

/**
 * Is this statement DDL against something other than the marker table itself?
 *
 * The marker is allowed its `create table if not exists _schema_ensure_state`
 * on every call -- that is how `ensureSchemaOnce` is written, and against an
 * existing table it takes no lock that conflicts with a dump. Everything else
 * with `alter`/`create` in it is what the incident was made of.
 */
function foreignDdl(text: string): boolean {
  if (!/\b(alter|create)\b/i.test(text)) return false;
  return !text.includes(MARKER_TABLE);
}

/** The one PGlite instance this process's `getSql()` is pointed at. */
function pgliteInstance(): Promise<PGlite> {
  return (globalThis as typeof globalThis & { __pgliteInstance__: Promise<PGlite> })
    .__pgliteInstance__;
}

describe("the second call of a routed ensure issues no DDL", () => {
  const seen: string[] = [];
  let pg: PGlite;
  let restore: () => void;

  before(async () => {
    if (process.env.DATABASE_URL) {
      throw new Error(
        "this test measures the PGlite handle; unset DATABASE_URL (with-app-env.mjs does not set it)",
      );
    }
    await getSql(); // open the instance and let its migration pass finish
    pg = await pgliteInstance();
    const original = pg.query;
    restore = () => {
      (pg as unknown as { query: typeof original }).query = original;
    };
    (pg as unknown as { query: unknown }).query = (text: string, params?: unknown[]) => {
      seen.push(text);
      return original.call(pg, text as never, params as never);
    };
  });

  after(() => {
    restore?.();
  });

  it("first call sends the whole batch, second call sends only the marker check", async () => {
    seen.length = 0;
    await ensurePaperSettingsSchema();
    const firstDdl = seen.filter(foreignDdl);
    assert.ok(
      firstDdl.length > 0,
      "the first call against an empty PGlite must send the paper-settings DDL -- " +
        `it sent ${seen.length} statements and none of them touched the schema. ` +
        `The intercept is wrong, or this process's database was already warm: ${JSON.stringify(seen)}`,
    );

    seen.length = 0;
    await ensurePaperSettingsSchema();
    assert.deepEqual(
      seen.filter(foreignDdl),
      [],
      `the second call re-ran schema DDL that the marker should have skipped: ${JSON.stringify(seen)}`,
    );
    // Two round trips and no more: the marker table's own create, then the
    // fingerprint lookup that decides to return early. This is the "down from
    // 111 to 2" claim in db.ts's own docstring, measured.
    assert.equal(
      seen.length,
      2,
      `a warm ensure must be two round trips, not ${seen.length}: ${JSON.stringify(seen)}`,
    );
    assert.ok(
      seen.some((text) => text.includes(`select fingerprint from ${MARKER_TABLE}`)),
      `the second call must still consult the marker: ${JSON.stringify(seen)}`,
    );
  });

  it("the marker records this module's batch under one stable name", async () => {
    const sql = await getSql();
    const rows = await sql<{ name: string; fingerprint: string }>`
      select name, fingerprint from _schema_ensure_state where name = 'paper-settings'
    `;
    assert.equal(rows.length, 1, "the paper-settings batch must leave exactly one marker row");
    assert.match(rows[0].fingerprint, /^[0-9a-f]{40}$/, "the marker stores a sha1 fingerprint");
  });
});
