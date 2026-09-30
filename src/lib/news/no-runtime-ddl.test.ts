import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every table, column, index, constraint, function and trigger in this
 * repository belongs in `migrations/*.sql`. That is the whole claim of ENG-5,
 * and until this file existed nothing checked it: 30 modules under
 * `src/lib/news/` declared their own schema inline and re-ran it on the first
 * line of every RPC handler, `src/lib/db.ts` was the only place the two
 * appliers agreed, and the two pieces of DDL that mattered most lived in
 * neither -- `story_documents.reading_key` (runtime only) and
 * `audit_events_user_idx` (migrations only).
 *
 * This is the guard that freezes the surface so the deletions that follow it
 * (U18a-5 … U18a-9, then U18a-10) can only shrink it. The allowlist below is
 * the progress meter: an entry names a file that still issues DDL at runtime
 * and says why it is still there. It may only ever get shorter -- a file whose
 * last statement is deleted fails this test until its entry is deleted with
 * it, so the list cannot quietly go stale.
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
 * about where schema is declared, and `scripts/no-destructive-migrate.test.mjs`
 * already owns destructive statements on the migration path.
 */
const DDL_VERB =
  /\bcreate\s+(?:temp\s+|temporary\s+)?table\b|\balter\s+table\b|\bcreate\s+(?:unique\s+)?index\b|\bcreate\s+trigger\b|\bcreate\s+(?:or\s+replace\s+)?function\b|\bdrop\s+index\b|\bdrop\s+constraint\b/i;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Files that still issue DDL at runtime, with the reason and the unit that
 * removes them. U18a-10 empties this list; the test then reads "every DDL
 * statement in this repository lives in migrations/".
 *
 * Every entry below was measured, not assumed: each `ensure*Schema` body in
 * these 29 modules was replayed into an empty database and diffed table by
 * table, column by column, index by index against the same database built
 * from `migrations/*.sql` alone. The result is that the whole layer is
 * redundant -- zero tables that no migration creates, zero column type,
 * nullability or default differences on the tables both sides have. The one
 * genuine gap is `story_documents.reading_key` (a runtime-only column, moved
 * into a migration by U18a-4). `src/lib/db.ts` is the `ensureSchemaOnce`
 * mechanism itself, which still carries the ledger table until U18a-10.
 */
const ALLOWLIST: Record<string, { reason: string }> = {
  // The mechanism: `_migrations` and `_schema_ensure_state` bookkeeping, plus
  // the `ensureSchemaOnce` batch runner every entry below goes through.
  "src/lib/db.ts": { reason: "the ensure* mechanism itself; deleted in U18a-10" },

  // U18a-5 -- the bulk (~100 statements) and the pattern-setter.
  "src/lib/news/investigate.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-5" },
  "src/lib/news/dark.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-5" },
  "src/lib/news/page-watch.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-5" },

  // U18a-6 -- desk, jobs and the draft pipeline.
  "src/lib/news/jobs.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/draft-batch.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/desk.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/editorial.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/follow-ups.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/model-assignments-store.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/model-request-commit.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },
  "src/lib/news/pull.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-6" },

  // U18a-7 -- membership, sections, story shape.
  "src/lib/news/membership.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  "src/lib/news/sections.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  "src/lib/news/story-area.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-7" },
  "src/lib/news/story-documents.server.ts": {
    reason: "runtime DDL; `reading_key` is also the one runtime-only column, moved into a migration by U18a-4, the rest removed in U18a-7",
  },
  "src/lib/news/paper-settings.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-7" },

  // U18a-8 -- ops, views, settings, provider plumbing, first-run codes.
  "src/lib/news/ops.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/views.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/reading.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/provider-login.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/provider-settings.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/custom-ai-connections.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/youtube-data-api.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/recovery-codes.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },
  "src/lib/news/setup-code.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-8" },

  // U18a-9 -- the four that hard-fail on a bare database today (they alter
  // `articles`, which nothing else in this list guarantees exists).
  "src/lib/news/legal-removal-schema.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-automation.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-checks.server.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
  "src/lib/news/routine-notice-policy.ts": { reason: "runtime DDL, redundant with migrations; removed in U18a-9" },
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
