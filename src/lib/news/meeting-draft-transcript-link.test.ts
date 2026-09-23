import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { citationSnapshotFor, linkDraftToTranscript, loadDraftMeetingEvidence } from "./meeting-draft-transcript-link.ts";

/**
 * The writer that populates meeting_draft_transcript_links, and the shape it
 * must produce. The revision re-check reads this shape; writing anything else
 * makes it find nothing, which is the defect being repaired. So these assert the
 * contract the reader depends on, not merely that a row was written.
 */
describe("meeting draft to transcript link", () => {
  it("writes citations in the shape meeting-revision reads back", () => {
    const snapshot = citationSnapshotFor(
      [{ segmentIndex: 12, captionSha256: "abc" }],
      7,
    );
    const parsed = JSON.parse(snapshot) as unknown;
    assert.ok(Array.isArray(parsed), "the snapshot must be a JSON array");
    const first = (parsed as { artifactId: number; segmentIndex: number; captionSha256: string }[])[0]!;
    // meeting-revision.ts reads exactly these three fields.
    assert.equal(first.artifactId, 7);
    assert.equal(first.segmentIndex, 12);
    assert.equal(first.captionSha256, "abc");
  });

  it("carries the caption hash, which is what the revision check compares", () => {
    /*
      affectedClaims() matches on captionSha256 === previousSha256. A snapshot
      without the hash would never match, so the re-check would run and always
      report no affected claims -- silently, and on every pass.
    */
    const snapshot = citationSnapshotFor([{ segmentIndex: 1, captionSha256: "sha-old" }], 3);
    const parsed = JSON.parse(snapshot) as { captionSha256: string }[];
    assert.equal(parsed[0]!.captionSha256, "sha-old");
  });

  it("does not inflate the snapshot when a segment is cited twice", () => {
    const snapshot = citationSnapshotFor(
      [
        { segmentIndex: 4, captionSha256: "h" },
        { segmentIndex: 4, captionSha256: "h" },
      ],
      1,
    );
    const parsed = JSON.parse(snapshot) as unknown[];
    assert.equal(parsed.length, 1, "a repeated segment must appear once");
  });

  it("inserts the link idempotently on newsroom, draft, and artifact", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return [] as T[];
    };
    const result = await linkDraftToTranscript(sql, {
      newsroomId: 3,
      draftId: 41,
      artifactId: 9,
      citations: [{ segmentIndex: 2, captionSha256: "hh" }],
    });
    assert.equal(result.linked, true);
    const write = calls.find((c) => /meeting_draft_transcript_links/.test(c.text));
    assert.ok(write, "the link table must be written");
    assert.match(write!.text, /on conflict \(newsroom_id,draft_id,artifact_id\)/, "re-linking must update, not accumulate");
    assert.deepEqual(write!.params, [3, 41, 9, result.snapshot]);
    const marker = calls.find((c) => /update drafts set research_json/.test(c.text));
    assert.ok(marker, "the same transaction must mark that this draft used meeting evidence");
    assert.match(marker!.text, /research_json::jsonb|research_json,''\),'\{\}'\)::jsonb/, "existing research must be merged, not discarded");
    assert.deepEqual(JSON.parse(String(marker!.params[0])), {
      meetingEvidence: { used: true, artifactId: 9, citationCount: 1 },
    });
    assert.deepEqual(marker!.params.slice(1), [41, 3]);
  });

  it("writes no link for a draft with no citations", async () => {
    const calls: string[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string) => {
      calls.push(text);
      return [] as T[];
    };
    const result = await linkDraftToTranscript(sql, {
      newsroomId: 3,
      draftId: 41,
      artifactId: 9,
      citations: [],
    });
    assert.equal(result.linked, false, "a draft with no citations is not a meeting draft");
    assert.equal(calls.length, 0, "no row should be written");
  });

  it("loads the current draft's persisted used citations rather than lead candidates", async () => {
    let call = 0;
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>() => {
      call += 1;
      if (call === 1) return [{
        artifact_id: 9, citation_snapshot: JSON.stringify([
          { artifactId: 9, segmentIndex: 2, captionSha256: "used-hash" },
        ]), revision_notice: null, video_id: "meeting-1", artifact_sha256: "used-hash",
        current_artifact_id: 10, current_sha256: "new-hash", title: "Council", published: "2026-09-22",
      }] as T[];
      if (call === 2) return [{ segment_index: 2, start_seconds: 65, excerpt: "used words" }] as T[];
      return [{ item: "7", segment_indexes: "[2]" }] as T[];
    };
    const evidence = await loadDraftMeetingEvidence(sql, { newsroomId: 3, draftId: 41 });
    assert.equal(evidence?.citations.length, 1);
    assert.deepEqual(evidence?.citations[0], {
      item: "7", segmentIndex: 2, timestampSeconds: 65, excerpt: "used words", captionSha256: "used-hash",
    });
    assert.equal(evidence?.newerTranscriptExists, true);
  });
});

