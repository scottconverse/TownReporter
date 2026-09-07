import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("current operator docs describe Opinion validation, Claude Automatic and explicit Local", () => {
  /*
    Opinion offered Codex for one release candidate and its model refused
    every editorial that took a position. Automatic uses Claude now; a
    doc that still promises a Codex-then-Claude ladder promises a button
    that fails. Explicit Local model was subsequently added; Automatic remains Claude.
  */
  for (const rel of [
    "README.md",
    "docs/editor.md",
    "docs/manual.md",
    "docs/setup.md",
    "docs/index.html",
    "SELF-HOSTING.md",
  ]) {
    const text = read(rel);
    assert.match(text, /(?:provider )?(?:refusal|declines?)/i, rel);
    assert.match(text, /(?:no\s+draft|never\s+becomes\s+a\s+draft|before\s+draft storage)/i, rel);
    assert.match(text, /Codex\s+is\s+not\s+offered\s+(?:for|here)/i, rel);
    assert.match(text, /Local model/i, rel);
    assert.match(text, /Automatic[\s\S]{0,200}Claude Opus/i, rel);
    assert.doesNotMatch(
      text,
      /Automatic (?:tries|runs)[^.\n]{0,80}Codex Sol/i,
      `${rel} still describes the withdrawn Codex Opinion ladder`,
    );
  }
});

test("current local-model guidance cannot revert to the removed all-or-nothing router", () => {
  const text = read("docs/local-models.md");
  assert.doesNotMatch(text, /There is \*\*no per-call provider routing\*\*/i);
  assert.doesNotMatch(text, /sends \*\*everything\*\* local/i);
  assert.match(text, /per-run[\s\S]{0,300}Story routing/i);
});

test("self-hosting separates repository version from attributed deployment evidence", () => {
  const text = read("SELF-HOSTING.md");
  // Repository releases can advance while Halo is offline. A release must not
  // manufacture a matching production claim just to keep this check green.
  const version = JSON.parse(read("package.json")).version.replace(/\./g, "\\.");
  assert.match(text, new RegExp(`Repository documentation version: \\*\\*${version}\\*\\*`, "i"));
  assert.match(
    text,
    /operator receipt reports \*\*v\d+\.\d+\.\d+\*\* promoted on\s+\d{4}-\d{2}-\d{2}/i,
  );
  assert.match(text, /\[the dated receipt\]\(HANDOFF-SESSION-2026-09-04\.md\)/);
  assert.match(text, /has not independently checked the running deployment/i);
  assert.match(text, /release does not establish production version/i);
  assert.doesNotMatch(text, /tagged[^\n]+build, which is what the production checkout runs/i);
});
