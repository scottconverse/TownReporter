import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = join(root, "artifacts", "audit-townreporter-2026-08-29");

test("the archived audit with twelve historical link failures is explicitly frozen", () => {
  const noticePath = join(archive, "README.md");
  assert.equal(existsSync(noticePath), true);
  const notice = readFileSync(noticePath, "utf8");
  assert.match(notice, /historical audit snapshot/i);
  assert.match(notice, /twelve relative Markdown links/i);
  assert.match(notice, /not current product[\s\S]*guidance/i);
  assert.match(notice, /intentionally not repaired/i);
});

test("the live documentation checker does not silently present archived artifacts as current manuals", () => {
  const checker = readFileSync(join(root, "scripts", "docs-links.test.mjs"), "utf8");
  assert.match(checker, /const seeds = \["docs", "README\.md", "SELF-HOSTING\.md", "TODO\.md"\]/);
  assert.doesNotMatch(checker, /const seeds = \[[^\]]*"artifacts"/);
});
