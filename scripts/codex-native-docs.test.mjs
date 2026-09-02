import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_DOCS = [
  "README.md",
  "docs/editor.md",
  "docs/manual.md",
  "docs/setup.md",
  "docs/index.html",
];

test("live documentation cannot reinstate the removed Codex capability restriction", () => {
  const offenders = [];
  const stale = [
    /Codex[\s\S]{0,100}\btool-free\b/i,
    /Codex[\s\S]{0,100}\b(?:capabilit\w*|tools?)\s+disabled\b/i,
    /Codex[\s\S]{0,100}\b(?:runs?|uses?|with)\s+(?:a\s+)?read-only\b/i,
    /Codex Sol[\s\S]{0,80}\b(?:refuses|fails closed)\b/i,
    /every local\/tool capability disabled/i,
  ];

  for (const rel of LIVE_DOCS) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const pattern of stale) {
      if (pattern.test(text)) offenders.push(`${rel}: ${pattern}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these live docs describe the removed Codex restriction:\n  ${offenders.join("\n  ")}`,
  );
});

test("operator docs state the native full-access Codex boundary", () => {
  for (const rel of ["README.md", "docs/editor.md", "docs/manual.md", "docs/setup.md"]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.match(
      text,
      /Codex[\s\S]{0,700}(?:native|signed-in Windows)[\s\S]{0,500}(?:full|danger-full-access)/i,
      rel,
    );
  }
});
