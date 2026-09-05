import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPglite, getSql } from "../db.ts";
import { WELCOME_SLUG } from "./welcome-article.ts";

/**
 * Owner rebrand (2026-09): the reader-facing org type changes from "civic"
 * to "non-profit" everywhere. Production's `welcome-to-townreporter` row was
 * already hand-edited; migrations/0040_welcome_nonprofit.sql exists so a
 * FRESH install lands on the same wording without anyone touching a
 * database by hand.
 *
 * Apply the real migrations, from disk, the same way src/lib/news/delete.test.ts
 * does: under `node --test` there is no Vite glob transform, so `getSql()`
 * brings up an empty PGLite and `articles` never appears (it is declared
 * only in `migrations/`, with no `ensure*` counterpart -- see
 * schema-parity.test.ts's docstring). What is being tested here is the
 * migration file's own SQL, so copying its UPDATE into the test would test
 * the copy, not the migration. Read the files instead.
 */
async function applyMigrations() {
  const sql = await getSql();
  // `sql.query` prepares a statement, and a migration file is many
  // statements. `exec` is what db.ts uses for exactly this, so use the same
  // door (see delete.test.ts).
  const pg = await getPglite();
  const dir = join(process.cwd(), "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, name), "utf8"));
    } catch {
      // A migration that does not apply on a bare PGLite (e.g. one that
      // depends on the opt-in auth schema under migrations/auth/, which is
      // deliberately not read here) is not this test's problem. The
      // assertions below fail loudly if 0002/0009/0040 -- the ones that
      // matter -- were among the failures, so this can never quietly make
      // the test vacuous.
    }
  }
  return sql;
}

describe("migrations/0040_welcome_nonprofit.sql", () => {
  it("a fresh PGLite install's seeded welcome article reads non-profit, not civic", async () => {
    const sql = await applyMigrations();
    const rows = await sql<{ headline: string; body: string }[]>`
      select headline, body from articles where slug = ${WELCOME_SLUG} and user_id = 'masthead'
    `;
    assert.equal(rows.length, 1, "expected the migration-seeded welcome article to exist");
    const [{ headline, body }] = rows;

    assert.match(headline, /A non-profit paper for Longmont, edited by a human/);
    assert.match(body, /TownReporter is a non-profit newsroom for Longmont, Colorado/);
    // Only the org-type phrase changes. "civic sources" elsewhere in the
    // same body describes the subject matter (civic affairs), not the
    // organization type, and is deliberately left alone -- same rule as
    // src/routes/about.tsx's "Independent civic reporting" and "watch known
    // civic pages".
    assert.doesNotMatch(headline, /civic paper/i);
    assert.doesNotMatch(body, /civic newsroom/i);
  });

  it("is idempotent: re-running 0040 against an already-updated row (production's shape) is a no-op", async () => {
    const sql = await applyMigrations();

    // Simulate production: an operator hand-edited the row to say
    // "non-profit" already, with wording 0040's replace() would not
    // otherwise produce, so any accidental re-match would be visible.
    const handEditedHeadline = "A non-profit paper for Longmont, Colorado, edited by a human";
    const handEditedBody =
      "TownReporter is a non-profit newsroom for Longmont, Colorado. Hand-edited by the owner.";
    await sql`
      update articles
      set headline = ${handEditedHeadline}, body = ${handEditedBody}
      where slug = ${WELCOME_SLUG} and user_id = 'masthead'
    `;

    // Re-apply 0040 itself (recorded in _migrations, but re-running its
    // exact statement is exactly what "idempotent" claims).
    const pg = await getPglite();
    const migrationText = readFileSync(
      join(process.cwd(), "migrations", "0040_welcome_nonprofit.sql"),
      "utf8",
    );
    await pg.exec(migrationText);

    const rows = await sql<{ headline: string; body: string }[]>`
      select headline, body from articles where slug = ${WELCOME_SLUG} and user_id = 'masthead'
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].headline, handEditedHeadline, "hand-edited headline must be untouched");
    assert.equal(rows[0].body, handEditedBody, "hand-edited body must be untouched");
  });
});
