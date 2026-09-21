import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const modulePath = new URL("./meeting-transcript-artifacts.ts", import.meta.url);

describe("meeting transcript artifacts Slice 3", () => {
  it("requires an absolute configured storage root and never falls back to the app directory", async () => {
    assert.equal(existsSync(modulePath), true, "meeting-transcript-artifacts.ts must exist");
    const { resolveMeetingStorageRoot } = await import("./meeting-transcript-artifacts.ts");
    assert.throws(() => resolveMeetingStorageRoot(null), /storage root/i);
    assert.throws(() => resolveMeetingStorageRoot("relative/root"), /absolute/i);
    const resolved = resolveMeetingStorageRoot("C:\\TownReporterData\\meetings");
    assert.equal(resolved, "C:\\TownReporterData\\meetings");
  });

  it("parses caption bytes into timestamped segments with verbatim excerpts", async () => {
    const { parseTranscriptSegments } = await import("./meeting-transcript-artifacts.ts");
    const segments = parseTranscriptSegments("Hello council.\nThen the vote passed.", "abc123");
    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.segmentIndex, 0);
    assert.equal(segments[0]?.excerpt, "Hello council.");
    assert.equal(segments[0]?.captionSha256, "abc123");
    assert.equal(typeof segments[0]?.startSeconds, "number");
    assert.equal(typeof segments[1]?.startSeconds, "number");
    assert.ok(segments[1]!.startSeconds >= segments[0]!.startSeconds);
  });

  it("resolves a citation by segment index and by timestamp to item, timestamp, excerpt, hash, path", async () => {
    const { resolveTranscriptCitation } = await import("./meeting-transcript-artifacts.ts");
    const artifact = { id: 7, storagePath: "C:\\data\\meet.srv3", sha256: "abc123" };
    const segments = [
      { segmentIndex: 0, startSeconds: 0, endSeconds: 4, item: null, excerpt: "First", captionSha256: "abc123" },
      { segmentIndex: 1, startSeconds: 12, endSeconds: 20, item: "Item 3", excerpt: "The vote passed 6-1.", captionSha256: "abc123" },
    ];
    const byIndex = resolveTranscriptCitation({ artifact, segments, segmentIndex: 1 });
    assert.equal(byIndex.item, "Item 3");
    assert.equal(byIndex.timestampSeconds, 12);
    assert.equal(byIndex.excerpt, "The vote passed 6-1.");
    assert.equal(byIndex.captionSha256, "abc123");
    assert.equal(byIndex.storagePath, "C:\\data\\meet.srv3");
    const byTime = resolveTranscriptCitation({ artifact, segments, timestampSeconds: 14 });
    assert.equal(byTime.segmentIndex, 1);
    assert.equal(byTime.excerpt, "The vote passed 6-1.");
  });

  it("retention modes are operator-configured behavior and no mode deletes automatically", async () => {
    const { retentionPlan } = await import("./meeting-transcript-artifacts.ts");
    for (const mode of ["media", "audio-only", "transcript-only"] as const) {
      const plan = retentionPlan(mode);
      assert.equal(plan.retentionMode, mode);
      assert.equal(plan.keepsTranscript, true);
      assert.equal(plan.automaticDeletion, false);
    }
    assert.deepEqual(retentionPlan("media").allows, ["media", "audio-only", "transcript-only"]);
    assert.deepEqual(retentionPlan("transcript-only").allows, ["transcript-only"]);
  });

  it("draft evidence token covers transcriptCitations so a stale citation cannot publish", async () => {
    const { evidenceReviewToken } = await import("./draft-evidence.ts");
    const base = { id: 1, headline: "H", dek: "D", topic: "T", body: "B", source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]", research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 1, captionSha256: "abc" }] }) };
    const changed = { ...base, research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 2, captionSha256: "abc" }] }) };
    assert.notEqual(evidenceReviewToken(base), evidenceReviewToken(changed));
  });
});
