// guards: unknown source URLs could be presented as official primary evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./dom-harness.mjs";
const { kindFromSourceUrl, tierFromKind } = await import(
  await moduleUrl("src/lib/news/desk-copy.ts")
);
test("unknown hosts stay unclassified while known outlets retain their kind", () => {
  for (const url of [
    "https://unknown.example/",
    "https://unknown.example/?url=https://city.gov/",
    "https://timescall.com.evil.example/",
  ]) {
    const kind = kindFromSourceUrl(url);
    assert.equal(kind, "unclassified");
    assert.equal(tierFromKind(kind), "C");
  }
  assert.equal(kindFromSourceUrl("https://www.timescall.com/"), "news");
  assert.equal(kindFromSourceUrl("https://longmontcolorado.gov/"), "official");
});
