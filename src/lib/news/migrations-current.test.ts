import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPglite, migrationFileNames } from "../db.ts";
import {
  assertMigrationsCurrent,
  formatBehind,
  migrationsBehind,
  pendingMigrations,
} from "../migration-status.ts";

/**
 * The boot guard refuses a server whose database is behind `migrations/*.sql`
 * (ENG-5, U18a-3 -- `src/lib/migration-status.ts`).
 *
 * Before it, nothing at runtime ever compared `_migrations` against
 * `migrations/*.sql`. The Neon path opens a pool and does nothing else, so a
 * server started any way other than `installer/Start.ps1` or
 * `ops/start-townreporter.ps1` served whatever schema the database had, and
 * the mismatch reached the desk as a column-not-found error on an editor's
 * save. The fix reads the ledger the appliers were already writing.
 *
 * This is the executable half of that claim: on the migrated test database the
 * guard passes, and the moment a ledger row disappears -- the exact state a
 * database left behind by an older release is in -- it throws a message that
 * NAMES the missing file and the command that applies it, then passes again
 * once the row is back.
 *
 * A guard that returned instead of throwing would leave the first assertion
 * below passing and the `assert.rejects` (the whole point of the unit) failing;
 * that is the mutation this file is written against.
 *
 * PGlite lane, deliberately: this proves the guard's logic against a real
 * ledger, and the built server's own boot is walked separately. The file names
 * come from the same `migrations/` read the applier uses
 * (`src/lib/test-support/pglite-migrations.ts`, registered as a preload by
 * `scripts/run-tests-safe.mjs`), so it must be run by that runner -- the
 * precondition below says so rather than letting an empty list pass for
 * "current".
 */

/** A migration every installation has, deleted and restored by the test below. */
const VICTIM = "0005_ops.sql";

describe("boot refuses a database whose migration ledger is behind", () => {
  it("passes on a database that is up to date with migrations/", async () => {
    // Guard against a vacuous pass: with no name list there is nothing to
    // compare, and "no migrations pending" would mean nothing.
    assert.ok(
      migrationFileNames().length > 100,
      "no migration names are visible to this process -- run this file through " +
        "`npm test` (scripts/run-tests-safe.mjs preloads migrations/); a guard with an empty " +
        "list cannot tell a current database from a stale one",
    );
    assert.deepEqual(await migrationsBehind(), []);
    await assertMigrationsCurrent();
  });

  it("throws, naming the missing file and the command, when a ledger row is gone", async () => {
    const pg = await getPglite();
    assert.deepEqual(
      await pg.query<{ name: string }>("select name from _migrations where name = $1", [VICTIM]).then(
        (result) => result.rows.map((row) => row.name),
      ),
      [VICTIM],
      `sanity check: ${VICTIM} is not in the ledger to begin with`,
    );

    await pg.query("delete from _migrations where name = $1", [VICTIM]);
    try {
      await assert.rejects(
        assertMigrationsCurrent(),
        (error: Error) => {
          assert.match(error.message, new RegExp(VICTIM.replace(".", "\\.")));
          assert.match(error.message, /npm run db:migrate/);
          return true;
        },
        "a database whose ledger is behind migrations/ must be refused, not served",
      );
      assert.deepEqual(await migrationsBehind(), [VICTIM]);
    } finally {
      // Restored even when the assertion above fails: the PGlite instance is
      // shared with the rest of this file (and, on the PGlite lane, with the
      // preload's own ledger check).
      await pg.query("insert into _migrations (name) values ($1) on conflict (name) do nothing", [
        VICTIM,
      ]);
    }

    assert.deepEqual(await migrationsBehind(), []);
    await assertMigrationsCurrent();
  });
});

describe("pendingMigrations / formatBehind", () => {
  it("reports what migrations/ has and the ledger does not, in apply order", () => {
    const names = [
      "/migrations/0002_newsroom.sql",
      "/migrations/0001_auth.sql",
      "0003_scan.sql",
      "/migrations/notes.txt",
    ];
    assert.deepEqual(pendingMigrations(names, ["0001_auth.sql"]), [
      "0002_newsroom.sql",
      "0003_scan.sql",
    ]);
    assert.deepEqual(pendingMigrations(names, ["0001_auth.sql", "0002_newsroom.sql", "0003_scan.sql"]), []);
  });

  it("names every missing file, says the server refuses, and gives the command", () => {
    const message = formatBehind(["0111_story_documents_reading_key.sql", "0112_other.sql"]);
    assert.match(message, /0111_story_documents_reading_key\.sql/);
    assert.match(message, /0112_other\.sql/);
    assert.match(message, /Refusing to serve/);
    assert.match(message, /npm run db:migrate/);
  });
});
