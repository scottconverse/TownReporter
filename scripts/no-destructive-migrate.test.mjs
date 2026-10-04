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
 *
 * THERE IS NO EXEMPTION. GR-C once had one for `DROP TABLE xai_oauth_connections`
 * in 0112; the production auditor showed why that was wrong (see the live-
 * release rule below) and the drop moved to docs/design/DEFERRED-MIGRATIONS.md.
 */
const DROP_GATE_EXEMPT = new Map();

test("no migration file empties a table", () => {
  const dir = join(ROOT, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length > 0, "expected migration files");
  for (const name of files) {
    const sql = readFileSync(join(dir, name), "utf8").replace(/--.*$/gm, "");
    if (DROP_GATE_EXEMPT.has(name)) continue;
    for (const re of DESTRUCTIVE) {
      // Historical migrations (before the live release) may carry old drops;
      // they are judged by the live-release rule below, not here.
      if (re.source.includes("DROP") && migrationNumber(name) <= LIVE_RELEASE_LAST_MIGRATION) continue;
      assert.doesNotMatch(sql, re, `${name} must not contain ${re}`);
    }
  }
});

/**
 * THE LIVE-RELEASE RULE (owner, 2026-10-01). `npm run build` runs the
 * migrations BEFORE the new build starts, and a promote that fails after that
 * point puts the PREVIOUS build back. So a migration in a rollout must leave
 * everything the live release's schema had in place: nothing dropped, renamed,
 * retyped, emptied, or made stricter for a writer that does not know about it.
 * The live release is batch 4 (32ef34ea), whose last migration is 0108. Move
 * LIVE_RELEASE_LAST_MIGRATION forward only when a new release is actually live.
 */
const LIVE_RELEASE_LAST_MIGRATION = 108;

function migrationNumber(name) {
  const m = /^(\d+)/.exec(name);
  return m ? Number(m[1]) : 0;
}

const BREAKS_THE_PREVIOUS_BUILD = [
  [/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|TYPE|VIEW|SCHEMA)\b/i, "drops something the previous build may read"],
  [/\bRENAME\b/i, "renames something the previous build reads"],
  [/\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i, "retypes a column the previous build reads"],
  [/\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i, "makes an existing column stricter for the previous build's writes"],
  [/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+[^,;]*\bNOT\s+NULL\b(?![^,;]*\bDEFAULT\b)/i, "adds a NOT NULL column with no default, so the previous build's inserts fail"],
  [/\bDELETE\s+FROM\b/i, "deletes rows"],
  [/\bTRUNCATE\b/i, "empties a table"],
];

test("no migration after the live release breaks the previous build", () => {
  const dir = join(ROOT, "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && migrationNumber(f) > LIVE_RELEASE_LAST_MIGRATION)
    .sort();
  assert.ok(files.length > 0, "expected migrations after the live release");
  for (const name of files) {
    const sql = readFileSync(join(dir, name), "utf8").replace(/--.*$/gm, "");
    for (const [re, why] of BREAKS_THE_PREVIOUS_BUILD) {
      assert.doesNotMatch(sql, re, `${name} ${why}; a failed promote would put the old build back on this database`);
    }
  }
});

test("the deferred Grok-table drop is not in any migration that ships", () => {
  const dir = join(ROOT, "migrations");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql") && migrationNumber(f) > LIVE_RELEASE_LAST_MIGRATION)) {
    const sql = readFileSync(join(dir, name), "utf8").replace(/--.*$/gm, "");
    assert.doesNotMatch(sql, /xai_oauth_connections/i, `${name} must not touch xai_oauth_connections (docs/design/DEFERRED-MIGRATIONS.md)`);
  }
  const doc = readFileSync(join(ROOT, "docs", "design", "DEFERRED-MIGRATIONS.md"), "utf8");
  assert.match(doc, /drop table if exists xai_oauth_connections/i, "the deferred drop must stay written down");
});
