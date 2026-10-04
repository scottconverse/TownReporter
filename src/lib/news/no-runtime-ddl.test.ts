import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every table, column, index, constraint, function and trigger in this
 * repository belongs in `migrations/*.sql`. That is the whole claim of ENG-5,
 * and until this file existed nothing checked it: 29 modules under
 * `src/lib/news/` declared their own schema inline and re-ran it on the first
 * line of every RPC handler, `src/lib/db.ts` was the only place the two
 * appliers agreed, and the two pieces of DDL that mattered most lived in
 * neither -- `story_documents.reading_key` (runtime only) and
 * `audit_events_user_idx` (migrations only).
 *
 * This is the guard that freezes the surface so the deletions that follow it
 * (U18a-5 … U18a-9, then U18a-10) can only shrink it. The allowlist below is
 * the progress meter: an entry names a file that still issues DDL at runtime,
 * says HOW MUCH it still issues, and says why it is still there. It may only
 * ever get shorter -- a file whose last statement is deleted fails this test
 * until its entry is deleted with it, so the list cannot quietly go stale.
 *
 * THE COUNT IS THE POINT (batch-6 pre-merge audit, item 14). The list used to
 * be a set of names, so it answered "does this file still issue DDL" and not
 * "did this file start issuing MORE": a new `create table` added to an
 * already-excused file passed silently, and the excuse written for three
 * statements went on covering four. Each entry now carries the number of DDL
 * statements the file had when it was measured, and the test fails on any
 * difference in either direction -- a rise is new runtime DDL that has to be
 * justified or moved into a migration, and a fall is news the progress meter
 * has to record. Measured on the merged batch-7 tree: 30 files, 347
 * statements. Unit F3 added one more (paper_settings.model_prompt_state, in
 * paper-settings.ts, mirrored by migrations/0118): 348. Group 6a added one (investigate.ts re-validates
 * its NOT VALID foreign keys once the data allows it): 349.
 *
 * What counts as a hit: the DDL verbs in `DDL_VERB`, in a non-test `.ts`/
 * `.tsx` file under `src/` or `server/`, on a line that is really code.
 * Comments are removed first -- both line and block comments in the
 * TypeScript, and a `--` line inside a SQL string -- because a paragraph
 * explaining why some
 * DDL was deleted is not DDL. `src/lib/news/public.ts` carries exactly such a
 * paragraph where the newsletter that used to `ALTER TABLE` on every call was
 * removed, and it must keep passing.
 */

/**
 * The verbs this guard covers. Deliberately the DDL that CREATES or RESHAPES
 * app schema. `drop table` and `truncate` are absent on purpose: this test is
 * about where schema is declared, not destructive statements on the migration
 * path.
 */
const DDL_VERB =
  /\bcreate\s+(?:temp\s+|temporary\s+)?table\b|\balter\s+table\b|\bcreate\s+(?:unique\s+)?index\b|\bcreate\s+trigger\b|\bcreate\s+(?:or\s+replace\s+)?function\b|\bdrop\s+index\b|\bdrop\s+constraint\b/i;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Files that still issue DDL at runtime, with HOW MANY statements, the reason
 * and the unit that removes them. U18a-10 empties this list; the test then
 * reads "every DDL statement in this repository lives in migrations/".
 *
 * Every entry below was measured, not assumed: each `ensure*Schema` body in
 * these 29 news modules was replayed into an empty database and diffed table
 * by table, column by column, index by index against the same database built
 * from `migrations/*.sql` alone. The result is that the whole layer is
 * redundant -- zero tables that no migration creates, zero column type,
 * nullability or default differences on the tables both sides have. The one
 * genuine gap is `story_documents.reading_key` (a runtime-only column, moved
 * into a migration by U18a-4). `src/lib/db.ts` is the `ensureSchemaOnce`
 * mechanism itself, which still carries the ledger table until U18a-10 -- so
 * the list is 30 files: `src/lib/db.ts` and the 29 modules under
 * `src/lib/news/`.
 *
 * `statements` is counted by `countRuntimeDdl` below -- the same comment
 * stripping and the same `DDL_VERB` the scan uses, one count per DDL statement
 * rather than one per file. It is pinned exactly: see the "as much DDL as the
 * allowlist says" test.
 */
const ALLOWLIST: Record<string, { statements: number; reason: string }> = {
  // The mechanism: `_migrations` and `_schema_ensure_state` bookkeeping, plus
  // the `ensureSchemaOnce` batch runner every entry below goes through.
  "src/lib/db.ts": { statements: 2, reason: "the ensure* mechanism itself; deleted in U18a-10" },

  // U18a-5 -- the bulk and the pattern-setter.
  "src/lib/news/investigate.ts": { statements: 155, reason: "runtime DDL, redundant with migrations; removed in U18a-5 (one is the FK re-validation added in 6a)" },
  "src/lib/news/dark.ts": { statements: 36, reason: "runtime DDL, redundant with migrations; removed in U18a-5" },
  "src/lib/news/page-watch.ts": { statements: 14, reason: "runtime DDL, redundant with migrations; removed in U18a-5" },

  // U18a-6 -- desk, jobs and the draft pipeline.
  "src/lib/news/jobs.ts": { statements: 19, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/draft-batch.server.ts": { statements: 6, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/desk.ts": { statements: 2, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/editorial.server.ts": { statements: 4, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/follow-ups.ts": { statements: 20, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/model-assignments-store.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/model-request-commit.server.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/pull.server.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-6" },

  // U18a-7 -- membership, sections, story shape.
  "src/lib/news/membership.ts": { statements: 5, reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  "src/lib/news/sections.server.ts": { statements: 6, reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  "src/lib/news/story-area.server.ts": { statements: 2, reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  // U18a-4 moved the one runtime-ONLY column (`reading_key`) into
  // migrations/0111 and deleted its line; the table and the other five alters
  // remain, so the entry stays until U18a-7.
  "src/lib/news/story-documents.server.ts": {
    statements: 6,
    reason: "runtime DDL, redundant with migrations (reading_key moved to 0111 by U18a-4); removed in U18a-7",
  },
  "src/lib/news/paper-settings.ts": {
    statements: 6,
    reason:
      "runtime DDL, redundant with migrations (model_prompt_state added by Unit F3, mirrored by migrations/0118); removed in U18a-7",
  },

  // U18a-8 -- ops, views, settings, provider plumbing, first-run codes.
  "src/lib/news/ops.ts": { statements: 8, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/views.ts": { statements: 3, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/reading.server.ts": { statements: 6, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/provider-login.server.ts": { statements: 4, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/provider-settings.ts": { statements: 4, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/custom-ai-connections.server.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/youtube-data-api.server.ts": { statements: 2, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/recovery-codes.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/setup-code.server.ts": { statements: 1, reason: "runtime DDL, redundant with migrations; removed in U18a-8" },

  // U18a-9 -- the four that hard-fail on a bare database today (they alter
  // `articles`, which nothing else in this list guarantees exists).
  "src/lib/news/legal-removal-schema.ts": { statements: 17, reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-automation.ts": { statements: 6, reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-checks.server.ts": { statements: 6, reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-policy.ts": { statements: 4, reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
};

describe("no runtime DDL outside migrations/", () => {
  it("no source file declares schema outside migrations/ unless it is on the allowlist", () => {
    const offenders = scanForRuntimeDdl().filter((file) => !(file in ALLOWLIST));
    assert.deepEqual(
      offenders,
      [],
      `${offenders.length} file(s) issue DDL at runtime and are not on the allowlist. ` +
        `Move the statements into migrations/*.sql, or add the file with a reason and the ` +
        `unit that removes it:\n  ${offenders.join("\n  ")}`,
    );
  });

  it("the allowlist only shrinks -- no entry outlives the DDL it excused", () => {
    const scanned = new Set(scanForRuntimeDdl());
    const stale = Object.keys(ALLOWLIST).filter((file) => !scanned.has(file));
    assert.deepEqual(
      stale,
      [],
      `these files no longer issue runtime DDL, so their allowlist entries are ` +
        `stale and must be deleted (the list is the progress meter, and it only ` +
        `ever gets shorter):\n  ${stale.join("\n  ")}`,
    );
  });

  it("every allowlist entry gives a reason", () => {
    for (const [file, { reason }] of Object.entries(ALLOWLIST)) {
      assert.ok(reason && reason.trim().length > 0, `${file} has no reason on the allowlist`);
    }
  });

  /**
   * THE PIN (batch-6 pre-merge audit, item 14). An allowlist of NAMES answers
   * "does this file still issue DDL"; it does not answer "did this file start
   * issuing more", so a `create table` added to an already-excused file passed
   * in silence and the excuse written for three statements quietly covered
   * four. Pinned exactly, in both directions.
   */
  it("issues exactly as much DDL as the allowlist says, per file", () => {
    const measured = measuredDdlCounts();
    const drifted = Object.entries(ALLOWLIST)
      .map(([file, { statements }]) => ({ file, allowed: statements, actual: measured[file] ?? 0 }))
      .filter(({ allowed, actual }) => allowed !== actual)
      .map(({ file, allowed, actual }) =>
        actual > allowed
          ? `${file}: ${actual} statements, allowlist says ${allowed} -- NEW runtime DDL. ` +
            `Move it into migrations/*.sql.`
          : `${file}: ${actual} statements, allowlist says ${allowed} -- FEWER than the ` +
            `allowlist records. Lower the number (or delete the entry if it is zero).`,
      );
    assert.deepEqual(
      drifted,
      [],
      `the allowlist's per-file DDL counts and the tree disagree:\n  ${drifted.join("\n  ")}`,
    );
  });

  it("counts the whole surface, so the docstring's numbers are checkable", () => {
    /*
      The header says "30 files, 349 statements", and this is what makes that
      sentence fail when it stops being true -- the count is the progress meter
      and a stale meter is worse than none.
    */
    const measured = measuredDdlCounts();
    const files = Object.keys(ALLOWLIST).length;
    const statements = Object.values(measured).reduce((sum, n) => sum + n, 0);
    assert.equal(files, 30, "the allowlist header says 30 files");
    assert.equal(statements, 349, "the allowlist header says 349 statements");
  });
});

/** Repo-relative paths of non-test source files under `src/` and `server/` that issue DDL. */
function scanForRuntimeDdl(): string[] {
  const found: string[] = [];
  for (const group of ["src", "server"]) {
    for (const file of walk(join(ROOT, group))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      // A test may build whatever schema its fixture needs -- that is the
      // point of a fixture, and U18a-1 keeps those honest by making the real
      // tables exist underneath them.
      if (/\.test\.tsx?$/.test(rel)) continue;
      if (hasRuntimeDdl(readFileSync(file, "utf8"))) found.push(rel);
    }
  }
  return found.sort();
}

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** True when `source` contains a DDL verb on a line that is not a comment. */
function hasRuntimeDdl(source: string): boolean {
  for (const line of stripComments(source).split("\n")) {
    const text = line.trim();
    // A `--` line INSIDE a SQL string is a comment about the statement below
    // it, not a statement. It survives `stripComments` because the string it
    // lives in has to survive.
    if (text.startsWith("--")) continue;
    if (DDL_VERB.test(text)) return true;
  }
  return false;
}

/**
 * How many DDL statements `source` carries.
 *
 * The same walk as `hasRuntimeDdl`, counted instead of short-circuited: one
 * count per DDL verb, on a line that is really code, so a file with three
 * `create table`s reads three rather than "yes". A line carrying two verbs
 * (`create table …; create index …`) counts two, which is why this is a
 * statement count and not a line count.
 */
function countRuntimeDdl(source: string): number {
  const global = new RegExp(DDL_VERB.source, "gi");
  let count = 0;
  for (const line of stripComments(source).split("\n")) {
    const text = line.trim();
    if (text.startsWith("--")) continue;
    count += [...text.matchAll(global)].length;
  }
  return count;
}

/** `repo-relative path -> DDL statement count` for the files on the allowlist. */
function measuredDdlCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of Object.keys(ALLOWLIST)) {
    counts[file] = countRuntimeDdl(readFileSync(join(ROOT, file), "utf8"));
  }
  return counts;
}

/**
 * Blank out TypeScript comments without touching string contents -- the DDL
 * this test is looking for is inside template literals, so strings must be
 * preserved exactly, while a block comment that merely mentions `CREATE TABLE`
 * must not be mistaken for one.
 */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  "; // keep the line structure
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          out += source[index] + (source[index + 1] ?? "");
          index += 2;
          continue;
        }
        out += source[index];
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}
