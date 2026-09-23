import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import {
  completePublishedMeetingReviewWithCorrection,
  flagPublishedArticlesForTranscriptRevision,
  listPublishedMeetingReviews,
  recordPublishedMeetingEvidence,
  resolvePublishedMeetingReview,
} from "./meeting-article-revision.ts";

function recorder(returning: Record<string, unknown>[] | Record<string, unknown>[][] = []) {
  const calls: { text: string; params: unknown[] }[] = [];
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    const selected = Array.isArray(returning[0])
      ? (returning as Record<string, unknown>[][])[calls.length - 1] ?? []
      : returning as Record<string, unknown>[];
    return selected as T[];
  };
  return { sql, calls };
}

describe("published meeting evidence and later transcript revisions", () => {
  it("copies the draft's exact artifact and citation snapshot into immutable article provenance", async () => {
    const { sql, calls } = recorder([{ article_id: 72 }]);
    await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 });
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /insert into meeting_article_transcript_links/i);
    assert.match(calls[0]!.text, /select .*l\.artifact_id.*l\.citation_snapshot/is);
    assert.match(calls[0]!.text, /a\.sha256/i, "published provenance must freeze the artifact hash");
    assert.match(calls[0]!.text, /l\.is_current=true/i, "publication must freeze only the current draft evidence, not historical links");
    assert.deepEqual(calls[0]!.params, [3, 72, 41]);
  });

  it("creates one pending review for every A-based article when B commits", async () => {
    const { sql, calls } = recorder([
      [{ id: 9, current_artifact_id: 5, citation_snapshot: JSON.stringify([
        { artifactId: 4, segmentIndex: 7, captionSha256: "old" },
        { artifactId: 4, segmentIndex: 11, captionSha256: "old" },
      ]) }],
      [{ id: 9 }],
    ]);
    const result = await flagPublishedArticlesForTranscriptRevision(sql, {
      newsroomId: 3,
      videoId: "meeting-1",
      priorArtifactId: 4,
      currentArtifactId: 5,
      reason: "hash",
    });
    assert.equal(result.created, 1);
    assert.match(calls[0]!.text, /insert into meeting_article_revision_reviews/i);
    assert.match(calls[0]!.text, /on conflict .* do nothing/is, "reprocessing B must not duplicate review work");
    assert.deepEqual(calls[0]!.params, [3, "meeting-1", 4, 5, "hash"]);
  });

  it("records still-accurate verification against B without rewriting A publication provenance", async () => {
    const { sql, calls } = recorder([
      [{ id: 9, current_artifact_id: 5, citation_snapshot: JSON.stringify([
        { artifactId: 4, segmentIndex: 7, captionSha256: "old" },
        { artifactId: 4, segmentIndex: 11, captionSha256: "old" },
      ]) }],
      [{ id: 9 }],
    ]);
    await resolvePublishedMeetingReview(sql, {
      newsroomId: 3,
      reviewId: 9,
      reviewerId: "editor-1",
      resolution: "still-accurate",
      acceptedArtifactId: 5,
      note: "Checked every affected quote against B.",
      confirmedSegmentIndices: [11, 7],
    });
    assert.match(calls[0]!.text, /select .*citation_snapshot/is, "the server must load the affected citations itself");
    assert.match(calls[1]!.text, /update meeting_article_revision_reviews/i);
    assert.match(calls[1]!.text, /status='verified'/i);
    assert.doesNotMatch(calls[1]!.text, /update articles/i, "the historical article must not be silently rewritten");
    assert.deepEqual(calls[1]!.params, [5, "editor-1", "Checked every affected quote against B.", 3, 9]);
  });

  it("refuses a still-accurate confirmation that did not verify every affected citation", async () => {
    const { sql } = recorder([{ id: 9, current_artifact_id: 5, citation_snapshot: JSON.stringify([
      { artifactId: 4, segmentIndex: 7, captionSha256: "old" },
      { artifactId: 4, segmentIndex: 11, captionSha256: "old" },
    ]) }]);
    await assert.rejects(resolvePublishedMeetingReview(sql, {
      newsroomId: 3, reviewId: 9, reviewerId: "editor-1", resolution: "still-accurate",
      acceptedArtifactId: 5, note: "Only checked one.", confirmedSegmentIndices: [7],
    }), /every affected citation/i);
  });

  it("routes a material change to correction work without closing the review", async () => {
    const { sql, calls } = recorder([{ id: 9 }]);
    await resolvePublishedMeetingReview(sql, {
      newsroomId: 3,
      reviewId: 9,
      reviewerId: "editor-1",
      resolution: "correction-required",
      acceptedArtifactId: 5,
      note: "The published tally differs from B.",
      confirmedSegmentIndices: [],
    });
    assert.match(calls[0]!.text, /status='correction-required'/i);
    assert.doesNotMatch(calls[0]!.text, /update articles/i);
  });

  it("shows the editor the published article, A/B artifacts, and old/new evidence", async () => {
    const { sql } = recorder([
      [{
        id: 9, article_id: 72, headline: "Council approves housing plan", slug: "housing-plan",
        status: "pending", revision_reason: "hash", prior_artifact_id: 4, current_artifact_id: 5,
        prior_sha256: "old", current_sha256: "new", citation_snapshot: JSON.stringify([
          { artifactId: 4, segmentIndex: 7, captionSha256: "old" },
          { artifactId: 4, segmentIndex: 11, captionSha256: "old" },
        ]), created_at: "2026-09-22T00:00:00Z",
      }],
      [
        { artifact_id: 4, segment_index: 7, start_seconds: 12, excerpt: "old seven" },
        { artifact_id: 5, segment_index: 7, start_seconds: 12, excerpt: "new seven" },
        { artifact_id: 4, segment_index: 11, start_seconds: 22, excerpt: "old eleven" },
      ],
    ]);
    const reviews = await listPublishedMeetingReviews(sql, 3);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.article.headline, "Council approves housing plan");
    assert.deepEqual(reviews[0]!.citations[0], {
      segmentIndex: 7, oldExcerpt: "old seven", currentExcerpt: "new seven", timestampSeconds: 12,
    });
    assert.equal(reviews[0]!.citations[1]!.currentExcerpt, null, "missing direct comparison must be stated honestly");
  });

  it("ties a published correction to the exact article revision review", async () => {
    const { sql, calls } = recorder([[{ id: 9 }], [{ id: 9 }]]);
    await completePublishedMeetingReviewWithCorrection(sql, {
      newsroomId: 3, reviewId: 9, articleId: 72, correctionId: 14, reviewerId: "editor-1",
    });
    assert.match(calls[0]!.text, /status='correction-required'/i);
    assert.match(calls[0]!.text, /article_id=\$3/i);
    assert.match(calls[1]!.text, /status='corrected'/i);
    assert.match(calls[1]!.text, /correction_id=\$1/i);
    assert.deepEqual(calls[1]!.params, [14, "editor-1", 3, 9]);
  });
});
