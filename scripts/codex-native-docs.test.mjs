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

test("live documentation does not claim TownReporter Codex calls inherit full operator access", () => {
  const offenders = [];
  const stale = [
    /Codex.{0,300}native configuration and full available access/i,
    /Codex.{0,300}full machine capabilities/i,
    /Codex.{0,300}does not disable its search/i,
    /Codex.{0,300}does not replace them with a read-only sandbox/i,
    /danger-full-access.{0,160}Codex/i,
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

test("operator docs describe the actual scoped Codex and Claude reporting calls", () => {
  for (const rel of ["README.md", "docs/editor.md", "docs/manual.md", "docs/setup.md", "docs/index.html"]) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.match(text, /signed-in\s+account(?:s)?[\s\S]{0,100}authenticat(?:e|ion)|Codex[\s\S]{0,160}authenticat(?:e|ion)[\s\S]{0,100}signed-in\s+account/i, rel);
    assert.match(text, /read-only sandbox/i, rel);
    assert.match(text, /disables\s+shell[\s\S]{0,100}computer[\s\S]{0,100}browser/i, rel);
    assert.match(text, /not an operating-system security[\s\S]{0,30}sandbox/i, rel);
    assert.match(text, /Claude Code[\s\S]{0,500}restricted safe mode/i, rel);
    assert.match(text, /only[\s\S]{0,40}WebSearch[\s\S]{0,40}WebFetch/i, rel);
  }
});
