import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Only Markdown reports may be tracked under artifacts/.
 *
 * artifacts/ holds audit and gate output. The written reports are the
 * deliverable and belong in git; the screenshots, HTML captures, and QA data
 * behind them are reproducible bulk that clones should not pay for (ENG-010).
 *
 * The first fix used per-prefix ignore rules keyed on the "audit-" run folder
 * and they rotted the moment a new run wrote a gate-... folder of screens:
 * 59 screenshots and 12 QA files sailed straight past a rule written for the
 * "audit-" prefix. 106 files, 4.3 MB, tracked. This gate does not care about the
 * prefix. If a single non-Markdown file is tracked under artifacts/, it fails.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("artifacts/ tracks only Markdown reports, never evidence", () => {
  let tracked;
  try {
    tracked = execFileSync("git", ["ls-files", "artifacts/"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    // Not a git checkout (e.g. an exported tarball) -- nothing to police.
    return;
  }
  const offenders = tracked
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !path.toLowerCase().endsWith(".md"));
  assert.deepEqual(
    offenders,
    [],
    "these non-Markdown files are tracked under artifacts/ -- evidence, not " +
      "reports, belongs in .gitignore not git:\n  " + offenders.join("\n  "),
  );
});
