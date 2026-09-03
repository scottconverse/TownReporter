import test from "node:test";
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * GauntletGate ENG-04 guard: every INSERT into a newsroom-scoped table must
 * write `newsroom_id`, or that row silently vanishes from its own reads the
 * first time a second newsroom exists (the column defaults to 1, so today
 * it happens to be correct by accident, not by design).
 *
 * SCOPED_TABLES below is the exact set of tables this release's fix (and
 * the eng-08 evidence artifact's 26-site list) verified are now fully
 * correct -- every INSERT into one of them, anywhere under src/lib, writes
 * `newsroom_id`. It intentionally does NOT include every table that has a
 * `newsroom_id` column: `investigate.ts`'s forensics tables
 * (`frontier_items`, `claims`, `relationships`, `hypotheses`, `dead_ends`,
 * `entities`, `entity_aliases`, `entity_matches`, `investigation_entities`,
 * `search_attempts`, `artifact_chunks`) have the SAME gap on several insert
 * sites, discovered while fixing ENG-04, but GauntletGate's own engineering
 * report says plainly that "investigate.ts's 2,945 lines of investigation
 * logic were not reviewed line by line; forensics correctness is outside
 * this pass" -- closing those is out of scope for this release and is
 * reported separately rather than folded in here silently. Adding a table
 * to SCOPED_TABLES is a promise that every insert into it was checked;
 * don't add one without doing that check.
 */
const SCOPED_TABLES = [
  "leads",
  "drafts",
  "snapshots",
  "sources",
  "dark_runs",
  "dark_signals",
  "dark_promises",
  "investigations",
  "anomalies",
  "beat_memory",
  "corrections",
  "articles",
  "artifacts",
  "artifact_blobs",
  "desk_rate",
  "audit_events",
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every non-test TypeScript source file under src/lib. */
function sourceFiles() {
  return globSync("src/lib/**/*.ts", { cwd: ROOT }).filter((f) => !f.includes(".test."));
}

/**
 * Find every `insert into <table> (...)` in `text`, table-name and the
 * full parenthesised column list, tolerant of the statement spanning many
 * lines (every real occurrence in this codebase does).
 */
function findInserts(text) {
  const results = [];
  const re = /insert\s+into\s+(\w+)\s*\(([^)]*)\)/gis;
  let m;
  while ((m = re.exec(text))) {
    results.push({ table: m[1], columns: m[2], index: m.index });
  }
  return results;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

test("every insert into a newsroom-scoped table writes newsroom_id (GauntletGate ENG-04)", () => {
  const offenders = [];

  for (const file of sourceFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const { table, columns, index } of findInserts(text)) {
      if (!SCOPED_TABLES.includes(table)) continue;
      const cols = columns
        .split(",")
        .map((c) => c.trim().replace(/^"|"$/g, ""));
      if (!cols.includes("newsroom_id")) {
        offenders.push(`${file}:${lineOf(text, index)}: insert into ${table} (${columns.trim()})`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `insert(s) into a newsroom-scoped table with no newsroom_id column ` +
      `(defaults to 1 today, silently wrong the moment a second newsroom exists):\n` +
      offenders.join("\n"),
  );
});
