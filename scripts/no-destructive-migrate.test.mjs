import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration applies schema. It never deletes data.
 *
 * `npm run build` ends in `db:migrate`. For a while that path also called a
 * one-shot "factory reset" which ran `TRUNCATE ... RESTART IDENTITY CASCADE`
 * across articles, drafts, leads, investigations, subscribers, newsroom
 * membership and the entire Better Auth identity set — fired by the presence
 * of two hard-coded article slugs and the absence of a marker row.
 *
 * So an ordinary build could wipe a clone, a fork, or a restored backup that
 * happened to contain those two stories. Worse, the marker lived in the same
 * database a backup would restore, which re-armed the trigger.
 *
 * An outside audit found it. It had never fired here only because those slugs
 * were not in this database — luck, not design.
 *
 * This is the gate, not a note asking the next person to be careful.
 */

const ROOT = join(import.meta.dirname, "..");

/** Statements that destroy data rather than describe schema. */
const DESTRUCTIVE = [
  /\bTRUNCATE\b/i,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bDELETE\s+FROM\b/i,
];

test("the migration runner issues no destructive statement", () => {
  const src = readFileSync(join(ROOT, "scripts", "migrate.mjs"), "utf8");
  // Comments explain the history on purpose; only real code is judged.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const re of DESTRUCTIVE) {
    assert.doesNotMatch(code, re, `migrate.mjs must not contain ${re}`);
  }
});

test("the migration runner imports nothing that could wipe the database", () => {
  const src = readFileSync(join(ROOT, "scripts", "migrate.mjs"), "utf8");
  assert.doesNotMatch(src, /factory-reset/i, "the one-shot reset must stay out of the migrate path");
  assert.ok(!existsSync(join(ROOT, "scripts", "factory-reset.mjs")), "the one-shot reset script is deleted");
});

/**
 * A migration file may legitimately drop a constraint, an index, or a column.
 * It may not empty a table. `migrations/` is applied automatically on every
 * build, so anything here runs against production without a human present.
 */
test("no migration file empties a table", () => {
  const dir = join(ROOT, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length > 0, "expected migration files");
  for (const name of files) {
    const sql = readFileSync(join(dir, name), "utf8").replace(/--.*$/gm, "");
    for (const re of DESTRUCTIVE) {
      assert.doesNotMatch(sql, re, `${name} must not contain ${re}`);
    }
  }
});
