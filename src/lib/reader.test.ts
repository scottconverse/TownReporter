import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionMailto, readerSearch, readerStorageKey } from "./reader.ts";
test("reader navigation rejects invalid pages and unsupported views", () => {
  assert.equal(readerSearch({ page: -3 }).page, undefined);
  assert.equal(readerSearch({ page: "2", view: "saved", q: " water " }).page, 2);
  assert.equal(readerSearch({ page: Infinity, view: "admin" }).view, undefined);
  assert.equal(readerSearch({ q: "x".repeat(900) }).q?.length, 80);
  assert.equal(readerSearch({ sort: "DROP TABLE articles" }).sort, undefined);
});
test("correction email preserves multiline details and URL punctuation without extra headers", () => {
  const d = {
    article: "Story & city",
    details: "Name: José\nTime: 6:30",
    evidence: "https://example.org/a?q=1&b=2",
    name: "Reader",
    email: "reader@example.org",
  };
  const url = correctionMailto("townreporter@gmail.com", "TownReporter", d);
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "townreporter@gmail.com");
  assert.deepEqual([...parsed.searchParams.keys()], ["subject", "body"]);
  assert.match(parsed.searchParams.get("body")!, /Name: José\nTime: 6:30/);
  assert.ok(parsed.searchParams.get("body")!.includes(d.evidence));
  assert.notEqual(readerStorageKey("Paper", "City A"), readerStorageKey("Paper", "City B"));
});
