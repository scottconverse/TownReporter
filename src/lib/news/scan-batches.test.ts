import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildScanBatches, mergeScanBatchResults, DEFAULT_SCAN_BATCH_CHARS } from "./scan-batches.ts";

/** A block roughly the size the old pass appended for a changed source. */
function block(id: number, chars = 2800): { id: number; title: string; url: string; block: string } {
  return {
    id,
    title: `Source ${id}`,
    url: `https://example.test/source-${id}`,
    block: `SOURCE: Source ${id}\nURL: https://example.test/source-${id}\nCHANGED: yes\nTEXT:\n${"x".repeat(chars)}`,
  };
}

describe("buildScanBatches (P0-5 truncation fix)", () => {
  it("delivers EVERY source when the total exceeds one payload budget", () => {
    // 100 sources x ~2900 chars = ~290,000 chars, far past the old 48,000 pass.
    const sources = Array.from({ length: 100 }, (_, i) => block(i + 1));
    const totalChars = sources.reduce((n, s) => n + s.block.length, 0);
    assert.ok(totalChars > DEFAULT_SCAN_BATCH_CHARS * 5, `fixture must exceed the old budget (was ${totalChars})`);

    // What the OLD single-pass code did: append until the next block would
    // overflow the 48,000 budget, then break -- silently dropping the rest.
    const oldDelivered = (() => {
      let payload = "";
      let delivered = 0;
      for (const s of sources) {
        const next = payload ? `${payload}\n\n---\n\n${s.block}` : s.block;
        if (next.length > DEFAULT_SCAN_BATCH_CHARS) break;
        payload = next;
        delivered += 1;
      }
      return delivered;
    })();
    assert.ok(
      oldDelivered < sources.length,
      `the old single-pass code must actually drop sources, else the fixture proves nothing (old delivered ${oldDelivered}/${sources.length})`,
    );

    const batches = buildScanBatches({ sources });
    const deliveredIds = batches.flatMap((b) => b.sources.map((s) => s.id));
    assert.equal(deliveredIds.length, sources.length, "all sources must reach a batch");
    assert.deepEqual(deliveredIds, sources.map((s) => s.id), "no source dropped or reordered");
    assert.ok(batches.length > 1, "a >budget fixture must split into multiple batches");
    // Per-batch budget is respected (a single over-budget block goes alone).
    for (const b of batches) {
      if (b.sources.length > 1) {
        assert.ok(b.payload.length <= DEFAULT_SCAN_BATCH_CHARS, `batch ${b.index} over budget: ${b.payload.length}`);
      }
    }
  });

  it("caps sources per batch as well as characters", () => {
    const sources = Array.from({ length: 85 }, (_, i) => block(i + 1, 10));
    const batches = buildScanBatches({ sources, maxSourcesPerBatch: 40 });
    assert.equal(batches.length, 3);
    assert.equal(batches[0]!.sources.length, 40);
    assert.equal(batches[1]!.sources.length, 40);
    assert.equal(batches[2]!.sources.length, 5);
  });

  it("keeps a single over-budget block rather than dropping it", () => {
    const huge = block(1, DEFAULT_SCAN_BATCH_CHARS + 5000);
    const batches = buildScanBatches({ sources: [huge, block(2, 10)] });
    assert.equal(batches[0]!.sources[0]!.id, 1);
    assert.ok(batches.some((b) => b.sources.some((s) => s.id === 2)));
  });

  it("deduplicates leads and proposed sources across batches", () => {
    const merged = mergeScanBatchResults([
      { leads: [{ headline: "Council approves budget", source_urls: ["https://a.test"] }], proposed_sources: [{ url: "https://x.test" }], editor_summary: "Batch one." },
      { leads: [{ headline: "council APPROVES budget!", source_urls: ["https://a.test"] }], proposed_sources: [{ url: "https://x.test" }], editor_summary: "Batch two." },
      { leads: [{ headline: "Schools set calendar", source_urls: ["https://b.test"] }], proposed_sources: [{ url: "https://y.test" }], editor_summary: "" },
    ]);
    assert.equal(merged.leads.length, 2, "duplicate headline across batches collapses to one");
    assert.equal(merged.proposed_sources.length, 2, "duplicate proposed URL collapses to one");
    assert.match(merged.editor_summary, /Batch one\./);
    assert.match(merged.editor_summary, /Batch two\./);
    assert.equal(merged.leads[1]!.source_urls[0], "https://b.test", "per-lead source attribution preserved");
  });
});