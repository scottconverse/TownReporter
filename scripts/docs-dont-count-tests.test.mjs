import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * No document may state a fixed test count or run time.
 *
 * A gate audit filed DOC-1: SELF-HOSTING.md said "540 tests in about fourteen
 * seconds" and the manual said "528 tests", while the real numbers were 800-odd
 * and roughly two and a half minutes. Both were true once. A number that is
 * exact today is a number that is wrong next week, and this suite grows every
 * time a finding is fixed -- it moved through 528, 540, 578, 798, 811, 816 in a
 * single session. The honest description of a growing suite does not carry the
 * count.
 *
 * The rule is narrow: prose that asserts "<N> tests" or "in <N> seconds" as a
 * fact about this suite. It deliberately does not object to a version number,
 * a port, or a count of something that does not change on every commit.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = ["SELF-HOSTING.md", "README.md", "docs/manual.md", "docs/editor.md", "docs/setup.md"];

// "540 tests", "528 tests", "1,024 tests" -- a bare number immediately before
// the word tests. A word like "the tests" or "these tests" is fine.
const COUNTS_TESTS = /\b\d[\d,]*\s+tests\b/i;
// "in about fourteen seconds", "in 14 seconds", "in ~2 minutes".
const CLAIMS_RUNTIME = /\bin\s+(about\s+)?[~\d]\S*\s+(seconds?|minutes?)\b/i;

test("no doc pins a test count or a run time that will rot", () => {
  const offenders = [];
  for (const rel of DOCS) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      /*
        Past-tense history is not a live claim. The README's changelog says
        "170 tests had never run" about a release that has shipped; that number
        records what was wrong then and will never rot, because it is not
        describing the suite as it stands. Only a present-tense assertion about
        the current suite goes stale.
      */
      const pastTense = /\b(had|were|was|used to|before|previously|once)\b/i.test(line);
      // A runtime figure only matters when the sentence is about the tests.
      const aboutTests = /\btest|npm test|suite\b/i.test(line);
      if (COUNTS_TESTS.test(line) && !pastTense)
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      else if (aboutTests && CLAIMS_RUNTIME.test(line) && !pastTense)
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "these state a test count or run time that goes stale on the next commit; " +
      "describe the suite without a number instead:\n  " + offenders.join("\n  "),
  );
});
