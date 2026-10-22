import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageReportLocalNews } from "../../../scripts/package-report-local-news.mjs";
import {
  REPORT_LOCAL_NEWS_REQUIRED_FILES,
  readReportLocalNewsVersion,
  reportLocalNewsVersion,
  resolveReportLocalNewsDir,
} from "./report-local-news.server.ts";

/*
  THE SKILL IS THE WRITER'S ONLY INSTRUCTIONS (D200), so two things have to be
  provable without a model call: which folder a run reads, and which version it
  records. The version rule is shared with the build script, and the build must
  never let an older installed copy silently replace a newer committed one.
*/

const V3 = [
  "---",
  'name: "report-local-news"',
  "---",
  "",
  "REPORT LOCAL NEWS, v3. Straight local news.",
  "",
  "v3 adds meeting mode.",
  "",
  "----- BEGIN audit.py -----",
  'print("audit")',
  "----- END audit.py -----",
  "",
].join("\n");

const V3_1 = [
  "---",
  'name: "report-local-news"',
  "---",
  "",
  "REPORT LOCAL NEWS, v3. Straight local news.",
  "",
  "v3.1 changes how a meeting lead is chosen: rank by resident impact.",
  "",
  "v3 adds meeting mode.",
  "",
  "----- BEGIN audit.py -----",
  'print("audit")',
  "----- END audit.py -----",
  "",
].join("\n");

/** A throwaway skill folder holding one SKILL.md carrying `text`. */
function skillFolder(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "rln-skill-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text, "utf8");
  return dir;
}

describe("reportLocalNewsVersion", () => {
  it("reads the highest version a skill document declares", () => {
    assert.equal(reportLocalNewsVersion(V3), "3");
    assert.equal(reportLocalNewsVersion(V3_1), "3.1");
  });

  it("reads the version off the skill actually shipped in this repository", () => {
    assert.equal(readReportLocalNewsVersion(join(process.cwd(), "report-local-news")), "3.1");
  });

  it("reports no version for a document that declares none", () => {
    assert.equal(reportLocalNewsVersion("Some other skill, no version line."), "");
  });
});

describe("resolveReportLocalNewsDir", () => {
  it("finds the folder packaged beside the app", () => {
    const found = resolveReportLocalNewsDir({});
    assert.equal(found.source, "packaged");
    assert.equal(found.dir, join(process.cwd(), "report-local-news"));
    assert.equal(found.complete, true);
    assert.deepEqual(found.missing, []);
  });

  it("prefers a configured folder and names the files it is missing", () => {
    const dir = skillFolder(V3_1);
    const found = resolveReportLocalNewsDir({ TOWNREPORTER_REPORT_LOCAL_NEWS_DIR: dir });
    assert.equal(found.source, "configured");
    assert.equal(found.dir, dir);
    assert.equal(found.complete, false);
    assert.deepEqual(found.missing, ["scripts/audit.py"]);
  });

  it("falls back to the packaged folder when the configured one does not exist", () => {
    const found = resolveReportLocalNewsDir({
      TOWNREPORTER_REPORT_LOCAL_NEWS_DIR: join(tmpdir(), "rln-absent-folder-that-is-not-there"),
    });
    assert.equal(found.source, "packaged");
    assert.equal(found.complete, true);
  });

  it("names every required file when no folder is found", () => {
    // The packaged candidate is resolved against the working directory, so the
    // only way to have neither candidate is to stand somewhere with no copy.
    const empty = mkdtempSync(join(tmpdir(), "rln-cwd-"));
    const before = process.cwd();
    try {
      process.chdir(empty);
      const found = resolveReportLocalNewsDir({});
      assert.equal(found.source, "none");
      assert.equal(found.complete, false);
      assert.deepEqual(found.missing, [...REPORT_LOCAL_NEWS_REQUIRED_FILES]);
    } finally {
      process.chdir(before);
    }
  });
});

describe("packageReportLocalNews version guard", () => {
  it("keeps a newer committed copy when the installed skill is older", () => {
    const committed = skillFolder(V3_1);
    const installed = skillFolder(V3);
    const result = packageReportLocalNews({ destDir: committed, candidates: [installed] });
    assert.equal(result.copied, false);
    assert.equal(result.version, "3");
    // The bytes on disk are still the committed v3.1, not the v3 candidate.
    assert.equal(reportLocalNewsVersion(readFileSync(join(committed, "SKILL.md"), "utf8")), "3.1");
  });

  it("replaces the committed copy when the installed skill is higher", () => {
    const committed = skillFolder(V3_1);
    const installed = skillFolder(V3_1.replace("v3.1 changes", "v3.2 changes"));
    const result = packageReportLocalNews({ destDir: committed, candidates: [installed] });
    assert.equal(result.copied, true);
    assert.equal(result.version, "3.2");
    assert.equal(reportLocalNewsVersion(readFileSync(join(committed, "SKILL.md"), "utf8")), "3.2");
  });

  it("does nothing when no skill is installed", () => {
    const committed = skillFolder(V3_1);
    const result = packageReportLocalNews({ destDir: committed, candidates: [join(tmpdir(), "rln-none-here")] });
    assert.equal(result.copied, false);
    assert.equal(reportLocalNewsVersion(readFileSync(join(committed, "SKILL.md"), "utf8")), "3.1");
  });
});
