import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPglite } from "../db.ts";

/**
 * The unit suite's database is built from `migrations/*.sql`.
 *
 * It was not, and that was the whole problem this unit exists to fix. Under
 * plain `node --test` there is no Vite transform, so `createPgliteSql`'s
 * `import.meta.glob` threw, was caught, and applied nothing: the test PGlite
 * had `_migrations` (empty) and `_schema_ensure_state` and then whatever the
 * runtime `ensure*Schema` helpers and each file's own inline fixtures built.
 * That is 54 of the 109 migrated tables. `leads`, `articles`,
 * `story_documents`, `draft_batches` and `owner_setup_code` -- the tables most
 * of the desk is written against -- simply did not exist, and every test that
 * touched one declared a smaller, hand-written version of it instead, so the
 * suite could pass against a schema the paper does not have.
 *
 * The fix is the preload in `src/lib/test-support/pglite-migrations.ts`, which
 * `scripts/run-tests-safe.mjs` imports before every file in the `src/**`
 * group. This test is its proof, and it is deliberately written to NOT import
 * that module: it asks the process-wide PGlite what exists and reads
 * `migrations/` itself for the expected list, so removing the preload
 * registration makes it fail rather than silently migrating on its own.
 */

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "migrations",
);

/** Tables the brief names: absent from the test database before this unit, all present after. */
const REQUIRED = ["leads", "articles", "story_documents", "draft_batches", "owner_setup_code"];

describe("the test database is built from migrations/*.sql", () => {
  it("has the tables the desk is written against", async () => {
    const pg = await getPglite();
    for (const name of REQUIRED) {
      const { rows } = await pg.query<{ oid: string | null }>(
        "select to_regclass($1)::text as oid",
        [`public.${name}`],
      );
      assert.ok(
        rows[0]?.oid,
        `relation "${name}" does not exist in the test PGlite -- the migrations preload ` +
          `(src/lib/test-support/pglite-migrations.ts, registered by scripts/run-tests-safe.mjs) ` +
          `did not run, so the suite is testing a schema the paper does not have`,
      );
    }
  });

  it("has the column and the index that used to live outside migrations/", async () => {
    const pg = await getPglite();

    // `story_documents.reading_key` -- the runtime-only column (U18a-4). The
    // ensure list in `story-documents.server.ts` created it and no migration
    // did, so this database did not have a column the desk selects, compares
    // and writes. `migrations/0111_story_documents_reading_key.sql` is where it
    // lives now; deleting that file is the mutation this assertion catches.
    const readingKey = await pg.query<{ data_type: string }>(
      `select format_type(a.atttypid, a.atttypmod) as data_type
         from pg_attribute a
         join pg_class c on c.oid = a.attrelid
        where c.relname = 'story_documents'
          and a.attname = 'reading_key'
          and a.attnum > 0
          and not a.attisdropped`,
    );
    assert.deepEqual(
      readingKey.rows,
      [{ data_type: "text" }],
      "story_documents.reading_key is missing (or has the wrong type) after a migrations-only " +
        "replay -- it is declared in migrations/0111_story_documents_reading_key.sql, and the " +
        "runtime alter that used to create it has been deleted",
    );

    // `audit_events_user_idx` -- the mirror image, and the reason the parity
    // fixture stopped replaying 0005 into its ensure-side database: this index
    // exists in `migrations/0005_ops.sql` and in nothing the runtime creates,
    // so a database built any other way lacks it. Replayed from migrations/,
    // it must be here.
    const userIndex = await pg.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'audit_events'
          and indexname = 'audit_events_user_idx'`,
    );
    assert.deepEqual(
      userIndex.rows.map((row) => row.indexname),
      ["audit_events_user_idx"],
      "audit_events_user_idx is missing after a migrations-only replay -- it is created by " +
        "migrations/0005_ops.sql and by no runtime ensure* function",
    );
  });

  it("records every migrations/*.sql file in _migrations", async () => {
    const expected = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    // Guard against a vacuous pass: an empty migrations/ directory would make
    // the comparison below true while proving nothing.
    assert.ok(expected.length > 100, `expected the full migration set, found ${expected.length}`);

    const pg = await getPglite();
    const { rows } = await pg.query<{ name: string }>("select name from _migrations order by name");
    assert.deepEqual(
      rows.map((row) => row.name),
      expected,
      "the ledger disagrees with migrations/ -- a file was applied without being recorded, " +
        "recorded without being applied, or the preload stopped part way",
    );
  });
});
