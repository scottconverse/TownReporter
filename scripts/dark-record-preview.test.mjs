import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { readableCapture } from "../src/lib/news/html-text.ts";
import { blockedDigBannerText } from "../src/lib/news/desk-copy.ts";

const source = await readFile(new URL("../src/routes/desk.dark.tsx", import.meta.url), "utf8");
// Exercise the real reader's preview function, with the real capture classifier.
// This isolates the row classification without mocking the behavior under test.
const start = source.indexOf("  function previewOf(");
const end = source.indexOf("  function firstReadableId(", start);
assert.ok(start > 0 && end > start, "real reader preview function must be found");
const js = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const previewOf = new Function("readableCapture", `${js}; return previewOf;`)(readableCapture);

test("refused 200 responses are blocked rows, not readable PDF previews", () => {
  for (const method of ["refused-too-large", "refused-content-type"]) {
    const result = previewOf({
      excerpt: "This response must never be treated as readable article content.",
      fetch_status: 200,
      title: "Budget PDF",
      extraction_method: method,
    });
    assert.equal(result.kind, "blocked");
    assert.equal(result.body, "");
  }
});
test("unknown capture failures do not assert that the source failed to load", () => {
  const text = blockedDigBannerText({
    total: 3,
    ok: 1,
    blocked: 2,
    empty: 0,
    dominantReason: "other",
  });
  assert.match(text, /not readable/);
  assert.doesNotMatch(text, /failing to load/);
});
