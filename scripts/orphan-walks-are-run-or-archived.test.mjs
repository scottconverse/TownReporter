import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A browser walk nobody runs is a claim, not a check.
 *
 * Unit U5 found twenty-three of them under `scripts/`: guards with headers full
 * of "this proves" and no CI job, no `npm test` discovery (which matches only
 * `scripts/**\/*.test.mjs` and `src/**\/*.test.ts`) and no caller. The cost was
 * not hypothetical. `contrast-audit.mjs` IS a node:test file with nine
 * assertions, and three docs plus four CSS comments cited it as the thing that
 * "rejects" a low-contrast pair -- while it had not executed since it was
 * written and two of the nine had gone stale against a product that moved on.
 * `publish-blockers-walk.mjs` had drifted in three separate ways. A guard that
 * cannot fail loudly can only drift quietly.
 *
 * So this asserts the property directly: every browser walk on disk is either
 * invoked by a CI job or is in `scripts/archive/`, where nothing pretends it
 * runs. There is no third state, and adding one is a test failure.
 *
 * WHICH FILES. The brief's own set: anything whose name says what it is --
 * `*e2e*.mjs`, `*walk*.mjs`, `*-audit.mjs`. A walk named something else slips
 * through, and that is a deliberate limit rather than an oversight: a wider
 * glob would start guessing, and a guard that cries wolf about `with-app-env`
 * gets deleted rather than fixed.
 *
 * WHAT COUNTS AS RUNNING. A `run:` line, not a mention. `ci-jobs.test.mjs`
 * learned this the hard way -- "a weaker guard test passed simply because the
 * filename appeared in ci.yml" -- so whole-line YAML comments are stripped
 * before the search. Naming a script in a comment is exactly the practice that
 * made these twenty-three look guarded in the first place.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ciSource = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
/** ci.yml with whole-line comments removed -- what the runner would execute. */
const ciExecutable = ciSource
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");

const ARCHIVE = "scripts/archive";
/**
 * A file this test is about: a browser walk, or the audit that reads the CSS.
 *
 * `*.test.mjs` is excluded, and not because it is inconvenient -- those files
 * ARE run, by `npm test` (`scripts/run-tests-safe.mjs` runs
 * `scripts/**\/*.test.mjs`). They are the one kind of file in this directory
 * whose execution needs no job of its own, which is also why `contrast-audit`
 * keeping its old name is the whole reason it ran nowhere: it is a node:test
 * file, and its name is not `*.test.mjs`.
 */
const isWalk = (name) =>
  !name.endsWith(".test.mjs") && (/e2e|walk/i.test(name) || /-audit\.mjs$/.test(name));
/** Every `.mjs` directly inside `dir`, by the name that identifies it. */
function walkNamesIn(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .filter(isWalk)
    .sort();
}

test("every browser walk in scripts/ is run by CI or archived", () => {
  const orphans = walkNamesIn("scripts").filter(
    (name) => !ciExecutable.includes(`scripts/${name}`),
  );
  assert.deepEqual(
    orphans,
    [],
    "these walks are on disk and run by nothing. Wire each into an EXISTING job " +
      "in .github/workflows/ci.yml (this repository does not add jobs -- branch " +
      "protection pins the current ones), or move it to scripts/archive/ with a " +
      "line in scripts/archive/README.md saying why:\n  " +
      orphans.map((name) => `scripts/${name}`).join("\n  "),
  );
});

test("the archive is indexed, so it cannot become a silent dumping ground", () => {
  const readmePath = join(ROOT, ARCHIVE, "README.md");
  const readme = readFileSync(readmePath, "utf8"); // throws if the index is gone
  const unindexed = walkNamesIn(ARCHIVE).filter((name) => !readme.includes(name));
  assert.deepEqual(
    unindexed,
    [],
    `${ARCHIVE}/README.md does not say why these are here:\n  ` +
      unindexed.map((name) => `${ARCHIVE}/${name}`).join("\n  "),
  );
});

test("nothing in the archive is also invoked by CI", () => {
  // Both states at once is the contradiction this whole unit is about: a file
  // CI runs does not belong in the archive, and one in the archive does not
  // belong in a job. If a walk is worth running, move it back and say so.
  const both = walkNamesIn(ARCHIVE).filter((name) =>
    ciExecutable.includes(`scripts/archive/${name}`),
  );
  assert.deepEqual(both, [], `archived AND run by CI:\n  ${both.join("\n  ")}`);
});
