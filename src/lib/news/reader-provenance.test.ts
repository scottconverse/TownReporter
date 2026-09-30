import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readerProvenanceItems, sourceIdentity } from "./reader-provenance.ts";
import type { ProvenanceItem } from "./findings.ts";

/*
  Unit U11b3: the reader's source list.

  Two defects live here, and both of them are about a source appearing twice.

    1. The dedup compared raw strings. A story whose provenance held
       `https://records.example.test/agenda` and whose `source_urls` held the
       same address with a trailing slash or a tracking parameter printed that
       source twice: once as the record card -- which, since unit U11b2, can
       carry "the link was removed at the publisher's request" -- and once as a
       bare URL card with a live "Current source" link. The removed link came
       back on the same page that said it was removed.
    2. The merge itself was either/or before unit BX: a story with any
       provenance record dropped the rest of its `source_urls`, which hid a
       meeting story's own video.

  The rule moved out of `articles.$slug.tsx` into `reader-provenance.ts` so a
  test can drive it; these cases are that rule.
*/

function record(overrides: Partial<ProvenanceItem> = {}): ProvenanceItem {
  return {
    title: "Board packet",
    organization: "records.example.test",
    document_date: "",
    url: "https://records.example.test/agenda",
    captured_at: "2026-09-01T10:00:00.000Z",
    version_id: 42,
    version_count: 2,
    capture_event_id: 7,
    disappeared: false,
    role: "record",
    ...overrides,
  };
}

describe("the reader's source list", () => {
  it("treats the same source, spelled differently, as one source", () => {
    for (const spelled of [
      "https://records.example.test/agenda/",
      "https://records.example.test/agenda?utm_source=newsletter",
      "https://www.records.example.test/agenda",
      "https://records.example.test/agenda#item-7",
    ]) {
      const items = readerProvenanceItems([record()], [spelled]);
      assert.equal(items.length, 1, `${spelled} printed the source twice`);
      assert.equal(items[0]!.version_id, 42, "the record card is the one kept");
    }
  });

  it("keeps a removed link removed, even when the URL is cited again", () => {
    /*
      The defect this rule exists for. The record card says the link came down;
      a second, URL-only card for the same source would have printed it as a
      live link again, because a url-only card has no flags and the page
      renders "Current source" for anything with a url and no `disappeared`.
    */
    const removed = record({ excerpt_removed: true, excerpt_removed_link_kept: false });
    const items = readerProvenanceItems([removed], ["https://records.example.test/agenda/"]);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.excerpt_removed, true);
    assert.equal(items[0]!.excerpt_removed_link_kept, false, "the flags survive the merge");
  });

  it("still lists every cited URL no record already names", () => {
    const items = readerProvenanceItems(
      [record()],
      ["https://records.example.test/agenda", "https://youtu.be/meeting-recording"],
    );
    assert.deepEqual(
      items.map((item) => item.url),
      ["https://records.example.test/agenda", "https://youtu.be/meeting-recording"],
    );
    assert.equal(items[1]!.role, "source");
    assert.equal(items[1]!.version_id, null, "a cited URL with no capture has no record behind it");
  });

  it("keeps a named record that has no page to open, and does not treat it as a URL", () => {
    const named = record({ url: "", title: "September 22 budget packet (Attachment G)" });
    const items = readerProvenanceItems([named], ["https://records.example.test/agenda"]);
    assert.equal(items.length, 2);
    assert.equal(items[0]!.title, "September 22 budget packet (Attachment G)");
    assert.equal(items[1]!.url, "https://records.example.test/agenda");
  });

  it("gives an address identity even when it cannot be parsed", () => {
    assert.equal(sourceIdentity("not a url"), "not a url");
    assert.equal(
      sourceIdentity("https://records.example.test/agenda/"),
      sourceIdentity("https://records.example.test/agenda"),
    );
  });
});
