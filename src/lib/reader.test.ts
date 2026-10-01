import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionMailto, correctionRecipient, readerSearch, readerStorageKey } from "./reader.ts";
import * as readerApi from "./reader.ts";
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

/*
  Unit U24: /corrections and /about must name the SAME address.

  They read the same setting (`paper_settings.editor_email`, over the
  build-time `VITE_TOWNREPORTER_EDITOR_EMAIL`), but the correction form used to
  override it for any paper whose name was "TownReporter" and print
  `townreporter@gmail.com` instead. On the stand-in editorial day the two public
  pages named two different addresses for one paper -- and the page that exists
  to tell a reader where to send a correction was the one that was wrong.
*/
test("the correction recipient is the paper's configured contact, whatever the paper is called", () => {
  /* The exact pair the walkthrough saw. */
  assert.equal(correctionRecipient({ editorEmail: "editor@townreporter.test" }), "editor@townreporter.test");
  /* A paper that happens to be called TownReporter gets its own configured
     address, not a shipped one. */
  assert.equal(correctionRecipient({ editorEmail: "desk@example.org" }), "desk@example.org");
  /* Whitespace is not an address. */
  assert.equal(correctionRecipient({ editorEmail: "   " }), null);
  /* Unset means unset, and the form says so rather than inventing one. */
  assert.equal(correctionRecipient({ editorEmail: null }), null);
});

test("reader text-size preferences normalize the saved choices", () => {
  const normalizeReaderSize = (Reflect.get(readerApi, "normalizeReaderSize") ?? (() => undefined)) as (
    value: unknown,
  ) => number;
  assert.deepEqual(
    [18, 21, 25, 0, -1, "25", null, undefined, 99].map(normalizeReaderSize),
    [21, 21, 25, 21, 21, 21, 21, 21, 21],
  );
});
