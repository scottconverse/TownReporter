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

  /*
    The load path, which is the ONLY path production uses.

    `resolveTranscriptCitation` was well covered and always passed, because the
    test handed it a segment that already carried an `item`. Every row production
    actually writes has `item = null`, because nothing in the codebase ever
    populates that column -- so a citation named a timestamp and never the agenda
    item it sat under, silently, and the suite stayed green.

    This binds to `loadTranscriptCitation` against a stub SQL handle that returns
    exactly the shape the database returns: segments with a null item, and chunks
    that know which segments belong to which item. It fails against the old
    implementation and passes against the fix.
  */
  it("resolves the agenda item on the load path, from the chunks, not from segment.item", async () => {
    const { loadTranscriptCitation } = await import("./meeting-transcript-artifacts.ts");

    const calls: string[] = [];
    const sql = {
      query: async (text: string, params?: unknown[]) => {
        calls.push(text);
        if (/from meeting_transcript_artifacts/.test(text)) {
          return [{ id: 13, storage_path: "C:\\data\\m.srv3", sha256: "abc123", video_id: "vid1" }];
        }
        if (/from meeting_transcript_segments/.test(text)) {
          return [
            { segment_index: 0, start_seconds: 0, end_seconds: 10, item: null, excerpt: "agenda opened", caption_sha256: "abc123" },
            { segment_index: 1, start_seconds: 18448, end_seconds: 18452, item: null, excerpt: "And that is all uh city manager remarks.", caption_sha256: "abc123" },
          ];
        }
        if (/from meeting_agenda_chunks/.test(text)) {
          assert.deepEqual(params, ["vid1"], "the chunk lookup must be scoped to this artifact's video");
          return [
            { item: "5", segment_indexes: [0] },
            { item: "8", segment_indexes: [1] },
          ];
        }
        throw new Error("unexpected query: " + text);
      },
    };

    const byTime = await loadTranscriptCitation(sql, { artifactId: 13, timestampSeconds: 18450 });
    assert.equal(byTime.item, "8", "a citation must name the agenda item it sits under");
    assert.equal(byTime.segmentIndex, 1);
    assert.equal(byTime.excerpt, "And that is all uh city manager remarks.");
    assert.equal(byTime.captionSha256, "abc123");

    const byIndex = await loadTranscriptCitation(sql, { artifactId: 13, segmentIndex: 0 });
    assert.equal(byIndex.item, "5");

    assert.ok(calls.some((q) => /meeting_agenda_chunks/.test(q)), "the item must come from the chunk table");
  });

  it("draft evidence token covers transcriptCitations so a stale citation cannot publish", async () => {
    const { evidenceReviewToken } = await import("./draft-evidence.ts");
    const base = { id: 1, headline: "H", dek: "D", topic: "T", body: "B", source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]", research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 1, captionSha256: "abc" }] }) };
    const changed = { ...base, research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 2, captionSha256: "abc" }] }) };
    assert.notEqual(evidenceReviewToken(base), evidenceReviewToken(changed));
  });
});
