import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import {
  acceptedSnapshotMatchesCurrent,
  draftEvidenceSha256,
  recordDraftTranscriptRevisionReview,
} from "./meeting-draft-revision-review.ts";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const draft = {
  id: 41, lead_id: 13, headline: "Council approves plan", dek: "", topic: "council",
  body: "The council approves the plan.", source_urls: "[]", provenance_json: "[]",
  found_note: "", unanswered: "[]", research_json: JSON.stringify({ meetingEvidence: { used: true } }),
};

function accepted(segmentIndex: number, sourceSegmentIndex = 1) {
  return {
    artifactId: 5, segmentIndex, captionSha256: hashB,
    sourceArtifactId: 4, sourceSegmentIndex, sourceTimestampSeconds: sourceSegmentIndex * 10,
    sourceCaptionSha256: hashA, acceptedArtifactId: 5, acceptedArtifactSha256: hashB,
    acceptedSegmentIndex: segmentIndex, acceptedTimestampSeconds: sourceSegmentIndex * 10 + 1,
    acceptedEndSeconds: sourceSegmentIndex * 10 + 4, excerpt: `B words for ${sourceSegmentIndex}`,
  };
}

function reviewSql(options: { currentArtifactId?: number; currentSha256?: string; reviewId?: number; draft?: typeof draft; snapshot?: unknown; calls?: { text: string; params: unknown[] }[] } = {}) {
  const calls = options.calls ?? [];
  const selectedDraft = options.draft ?? draft;
  const snapshot = options.snapshot ?? [
    { artifactId: 4, segmentIndex: 20, captionSha256: hashA },
    { artifactId: 4, segmentIndex: 10, captionSha256: hashA },
  ];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (/select id from leads/.test(text)) return [{ id: 13 }] as T[];
    if (/from drafts/.test(text) && /for update/.test(text)) return [selectedDraft] as T[];
    if (/select distinct a\.video_id/.test(text)) return [{ video_id: "video-1" }] as T[];
    if (/from meeting_capture_records/.test(text) && /for update/.test(text)) return [{ video_id: "video-1" }] as T[];
    if (/select l\.id as link_id/.test(text)) return [{
      link_id: 77, artifact_id: 4, citation_snapshot: JSON.stringify(snapshot), revision_notice: "Affected claims: segment 10, segment 20.",
      prior_sha256: hashA, prior_integrity: "valid", video_id: "video-1",
      current_artifact_id: options.currentArtifactId ?? 5, current_sha256: options.currentSha256 ?? hashB, current_integrity: "valid",
    }] as T[];
    if (/select segment_index,start_seconds,caption_sha256 from meeting_transcript_segments/.test(text)) {
      return [{ segment_index: 10, start_seconds: 100, caption_sha256: hashA }, { segment_index: 20, start_seconds: 200, caption_sha256: hashA }] as T[];
    }
    if (/from unnest\(/.test(text)) {
      assert.deepEqual(params[1], [10, 20], "indices are paired in sorted order");
      assert.deepEqual(params[2], [100, 200], "each sorted citation keeps its own timestamp");
      return [
        { source_segment_index: 10, segment_index: 110, start_seconds: 101, end_seconds: 104, excerpt: "B words for 10", caption_sha256: options.currentSha256 ?? hashB },
        { source_segment_index: 20, segment_index: 120, start_seconds: 201, end_seconds: 204, excerpt: "B words for 20", caption_sha256: options.currentSha256 ?? hashB },
      ] as T[];
    }
    if (/insert into meeting_draft_transcript_revision_reviews/.test(text)) return [{ id: options.reviewId ?? 9, reviewed_at: "2026-09-23T20:00:00.000Z" }] as T[];
    return [] as T[];
  };
  return { sql, calls };
}

describe("draft transcript citation-only review", () => {
  it("requires the editor to confirm every A citation and stores exact B passages, reviewer, note, and draft fingerprint", async () => {
    const { sql, calls } = reviewSql();
    const result = await recordDraftTranscriptRevisionReview(sql, {
      newsroomId: 3, leadId: 13, draftId: 41, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [20, 10], note: "I compared both quotations with the current transcript.",
    });
    assert.equal(result.reviewId, 9);
    const insert = calls.find((call) => /insert into meeting_draft_transcript_revision_reviews/.test(call.text));
    assert.ok(insert);
    assert.match(insert.text, /draft_evidence_sha256/);
    assert.equal(insert.params[0], 3);
    assert.equal(insert.params[1], 41);
    assert.equal(insert.params[10], JSON.stringify([
      { artifactId: 5, segmentIndex: 120, captionSha256: hashB, sourceArtifactId: 4, sourceSegmentIndex: 20, sourceTimestampSeconds: 200, sourceCaptionSha256: hashA, acceptedArtifactId: 5, acceptedArtifactSha256: hashB, acceptedSegmentIndex: 120, acceptedTimestampSeconds: 201, acceptedEndSeconds: 204, excerpt: "B words for 20" },
      { artifactId: 5, segmentIndex: 110, captionSha256: hashB, sourceArtifactId: 4, sourceSegmentIndex: 10, sourceTimestampSeconds: 100, sourceCaptionSha256: hashA, acceptedArtifactId: 5, acceptedArtifactSha256: hashB, acceptedSegmentIndex: 110, acceptedTimestampSeconds: 101, acceptedEndSeconds: 104, excerpt: "B words for 10" },
    ]));
    assert.equal(insert.params[11], draftEvidenceSha256(draft));
    assert.equal(insert.params[12], "editor-1");
    assert.equal(insert.params[13], "I compared both quotations with the current transcript.");
    assert.ok(calls.some((call) => /for update/.test(call.text) && /meeting_capture_records/.test(call.text)), "review uses the shared meeting-row lock");
  });

  it("fails closed when the editor skipped a citation", async () => {
    const { sql, calls } = reviewSql();
    await assert.rejects(recordDraftTranscriptRevisionReview(sql, {
      newsroomId: 3, leadId: 13, draftId: 41, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [10], note: "Checked one.",
    }), /confirm every citation/i);
    assert.equal(calls.some((call) => /insert into meeting_draft_transcript_revision_reviews/.test(call.text)), false);
  });

  it("rejects B if transcript C arrived while the editor was reviewing", async () => {
    const { sql, calls } = reviewSql({ currentArtifactId: 6 });
    await assert.rejects(recordDraftTranscriptRevisionReview(sql, {
      newsroomId: 3, leadId: 13, draftId: 41, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [10, 20], note: "Checked B.",
    }), /newer transcript arrived/i);
    assert.equal(calls.some((call) => /insert into meeting_draft_transcript_revision_reviews/.test(call.text)), false);
  });

  it("allows a later C review on the same original A link after B was reviewed", async () => {
    const b = reviewSql({ currentArtifactId: 5, currentSha256: hashB, reviewId: 9 });
    const bResult = await recordDraftTranscriptRevisionReview(b.sql, {
      newsroomId: 3, leadId: 13, draftId: 41, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [10, 20], note: "Compared A with B.",
    });
    assert.equal(bResult.reviewId, 9);
    const bInsert = b.calls.find((call) => /insert into meeting_draft_transcript_revision_reviews/.test(call.text));
    assert.ok(bInsert);
    assert.equal(bInsert.params[4], 5);

    const hashC = "c".repeat(64);
    const c = reviewSql({ currentArtifactId: 6, currentSha256: hashC, reviewId: 10 });
    const cResult = await recordDraftTranscriptRevisionReview(c.sql, {
      newsroomId: 3, leadId: 13, draftId: 41, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 6,
      confirmedSegmentIndexes: [10, 20], note: "Rechecked both passages against C.",
    });
    assert.equal(cResult.reviewId, 10);
    const cInsert = c.calls.find((call) => /insert into meeting_draft_transcript_revision_reviews/.test(call.text));
    assert.ok(cInsert);
    assert.equal(cInsert.params[3], 4, "the original A link remains the source link");
    assert.equal(cInsert.params[4], 6, "the second immutable review targets C");
    assert.equal(cInsert.params[8], hashC);
  });

  it("does not reveal another newsroom's lead or insert a cross-newsroom review", async () => {
    const calls: { text: string; params: unknown[] }[] = [];
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return [] as T[];
    };
    await assert.rejects(recordDraftTranscriptRevisionReview(sql, {
      newsroomId: 999, leadId: 13, draftId: 41, reviewerId: "other-editor",
      expectedEvidenceToken: evidenceReviewToken(draft), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [10, 20], note: "Attempted cross-newsroom review.",
    }), /not on this newsroom's desk/i);
    assert.deepEqual(calls[0]!.params, [999, 13]);
    assert.equal(calls.some((call) => /meeting_draft_transcript_revision_reviews/.test(call.text)), false);
  });

  it("recognizes only a complete B snapshot that maps every persisted A citation exactly once", () => {
    const expected = [
      { artifactId: 4, segmentIndex: 20, captionSha256: hashA },
      { artifactId: 4, segmentIndex: 10, captionSha256: hashA },
    ];
    const snapshot = JSON.stringify([accepted(120, 20), accepted(110, 10)]);
    assert.equal(acceptedSnapshotMatchesCurrent({ acceptedArtifactId: 5, acceptedArtifactSha256: hashB, acceptedSnapshot: snapshot, expected }), true);
    assert.equal(acceptedSnapshotMatchesCurrent({ acceptedArtifactId: 6, acceptedArtifactSha256: hashB, acceptedSnapshot: snapshot, expected }), false);
    assert.equal(acceptedSnapshotMatchesCurrent({ acceptedArtifactId: 5, acceptedArtifactSha256: hashB, acceptedSnapshot: JSON.stringify([accepted(110, 10), accepted(110, 10)]), expected }), false);
    assert.equal(acceptedSnapshotMatchesCurrent({ acceptedArtifactId: 5, acceptedArtifactSha256: hashB, acceptedSnapshot: "malformed", expected }), false);
  });
});
