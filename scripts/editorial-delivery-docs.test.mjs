import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("current operator docs describe Opinion validation and pair-level fallback", () => {
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
    assert.match(
      text,
      /Automatic[\s\S]{0,1200}(?:fresh|from scratch|independent|completely new)[\s\S]{0,700}(?:pair|research)/i,
      rel,
    );
  }
});

test("current local-model guidance cannot revert to the removed all-or-nothing router", () => {
  const text = read("docs/local-models.md");
  assert.doesNotMatch(text, /There is \*\*no per-call provider routing\*\*/i);
  assert.doesNotMatch(text, /sends \*\*everything\*\* local/i);
  assert.match(text, /per-run[\s\S]{0,300}Story routing/i);
});

test("self-hosting distinguishes the deployed release from the untagged candidate", () => {
  const text = read("SELF-HOSTING.md");
  assert.match(text, /production checkout is still[\s\S]{0,80}v0\.5\.6/i);
  assert.match(text, /not live until[\s\S]{0,100}tagged and promoted/i);
});
