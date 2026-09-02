import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("current operator docs describe Opinion validation, and say Opinion is Claude only", () => {
  /*
    Opinion offered Codex for one release candidate and its model refused
    every editorial that took a position. The picker is Claude only now; a
    doc that still promises a Codex-then-Claude ladder promises a button
    that fails.
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
    assert.match(text, /Codex is not offered (?:for|here)|Opinion is (?:always )?Claude(?: Opus)? only/i, rel);
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

test("self-hosting names the tagged build production runs, with no stale candidate framing", () => {
  const text = read("SELF-HOSTING.md");
  assert.match(text, /tagged \*\*v0\.5\.8\*\* build, which is what the production checkout runs/i);
  assert.doesNotMatch(text, /untagged development candidate|not live until[\s\S]{0,100}tagged and promoted/i);
});
