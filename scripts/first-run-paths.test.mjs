import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two ways a stranger can start this paper must both work.
 *
 * A gate lane built the real first-run state -- empty database, no model CLI
 * anywhere on disk, no voice file -- and followed the README. Both documented
 * routes died before a self-hoster saw a single page:
 *
 *   1. The zero-config quickstart (no DATABASE_URL, embedded PGLite) crashed at
 *      boot. Migration 0018 installs pg_trgm and caught only
 *      `insufficient_privilege`, on the assumption that lacking superuser is
 *      the only way to fail. PGLite does not ship pg_trgm at all and raises a
 *      different class, so the migration aborted and took the bootstrap with
 *      it. That was a defect introduced the same day, by the search-index work.
 *
 *   2. The Postgres route 500'd on the first page load with `relation
 *      "articles" does not exist`. `npm run build` migrated; `npm run dev` --
 *      the command the README actually gives -- did not, while docs/setup.md
 *      said the schema is applied "on boot".
 *
 * Neither is visible on a developer's machine, because a developer's database
 * already has a schema and their build already ran. That is the whole reason
 * the first-run rule exists.
 *
 * These assertions are cheap stand-ins for the expensive thing: the real proof
 * is a first-run walk, and CI's smoke-dev job runs the README's own quick start
 * from a copied .env.example. What is guarded here is the two specific
 * regressions, because both were one character or one word away from returning.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the dev command applies migrations, because the docs say the schema is applied", () => {
  const dev = pkg.scripts.dev ?? "";
  assert.match(
    dev,
    /db:migrate/,
    "npm run dev no longer migrates. The README sends a new self-hoster here " +
      "with an empty database, and without this they meet " +
      '`relation "articles" does not exist` on the front page.',
  );
  const at = dev.indexOf("db:migrate");
  const vite = dev.indexOf("vite dev");
  assert.ok(at >= 0 && vite > at, "migrations must run BEFORE the server starts");
});

test("an optional extension can never abort a migration", () => {
  // Every CREATE EXTENSION in the tree must sit inside a block that swallows
  // any failure. An extension the index merely prefers is not worth refusing
  // to start over -- and the embedded database used by the quickstart ships
  // almost none of them.
  const sql = readFileSync(join(ROOT, "migrations/0018_search_index.sql"), "utf8");
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS pg_trgm/i, "the extension line is gone");
  const guard = sql.slice(0, sql.indexOf("CREATE EXTENSION"));
  assert.match(guard, /DO \$\$/, "CREATE EXTENSION is not inside a DO block");
  assert.match(
    sql,
    /EXCEPTION WHEN OTHERS THEN/,
    "the handler catches a specific error class again. PGLite raises " +
      "`extension \"pg_trgm\" is not available`, which is not insufficient_privilege, " +
      "and an uncaught one aborts the migration and the boot with it.",
  );
});

test("the dollar-quoted blocks in that migration are intact", () => {
  // Repairing the handler above, a patch script wrote `DO $` instead of `DO $$`
  // -- String.replace treats `$$` in the replacement as an escape. That turned
  // a clear failure into `syntax error at or near "$"`, which is a much worse
  // thing to hand someone on their first run.
  const sql = readFileSync(join(ROOT, "migrations/0018_search_index.sql"), "utf8");
  const opens = (sql.match(/^DO \$\$$/gm) ?? []).length;
  const closes = (sql.match(/^\$\$;$/gm) ?? []).length;
  assert.equal(opens, closes, `${opens} DO $$ openers but ${closes} $$; closers`);
  assert.ok(opens > 0, "no dollar-quoted blocks found at all");
  assert.ok(
    !/^DO \$$/m.test(sql) && !/^\$;$/m.test(sql),
    "a dollar-quote delimiter lost a character",
  );
});
