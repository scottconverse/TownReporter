import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { draftEvidenceSha256 } from "./meeting-draft-revision-review.ts";
import {
  completePublishedMeetingReviewWithCorrection,
  flagPublishedArticlesForTranscriptRevision,
  listPublishedMeetingReviews,
  recordPublishedMeetingEvidence,
  resolvePublishedMeetingReview,
} from "./meeting-article-revision.ts";

const acceptedArtifactSha256 = "b".repeat(64);

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
    const { sql, calls } = recorder([[], [{ article_id: 72 }]]);
    await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 });
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.text, /current\.integrity_status/);
    assert.match(calls[1]!.text, /insert into meeting_article_transcript_links/i);
    assert.match(calls[1]!.text, /select .*l\.artifact_id.*l\.citation_snapshot/is);
    assert.match(calls[1]!.text, /a\.sha256/i, "published provenance must freeze the artifact hash");
    assert.match(calls[1]!.text, /l\.is_current=true/i, "publication must freeze only the current draft evidence, not historical links");
    assert.deepEqual(calls[1]!.params, [3, 72, 41]);
  });

  it("publishes the reviewed B snapshot while preserving the original A draft link", async () => {
    const aHash = "a".repeat(64);
    const bHash = "b".repeat(64);
    const segmentHash = "c".repeat(64);
    const draft = {
      id: 41, draft_id: 41, headline: "Council approves plan", dek: "", topic: "council",
      body: "The council approves the plan.", source_urls: "[]", provenance_json: "[]",
      found_note: "", unanswered: "[]", research_json: JSON.stringify({ meetingEvidence: { used: true } }),
    };
    const accepted = [{
      artifactId: 5, segmentIndex: 107, captionSha256: segmentHash, sourceArtifactId: 4,
      sourceSegmentIndex: 7, sourceTimestampSeconds: 12, sourceCaptionSha256: aHash,
      acceptedArtifactId: 5, acceptedArtifactSha256: bHash, acceptedSegmentIndex: 107,
      acceptedTimestampSeconds: 13, acceptedEndSeconds: 16, excerpt: "The council approves the plan.",
    }];
    const { sql, calls } = recorder([
      [{ ...draft, newsroom_id: 3, link_id: 55, artifact_id: 4, citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7, captionSha256: aHash }]), video_id: "video-1", sha256: aHash, linked_integrity_status: "valid", current_artifact_id: 5, current_sha256: bHash, current_integrity_status: "valid", accepted_artifact_id: 5, accepted_artifact_sha256: bHash, accepted_citation_snapshot: JSON.stringify(accepted), draft_evidence_sha256: draftEvidenceSha256(draft), reviewed_by: "editor-1", resolution_note: "Checked this quote against B." }],
      [{ segment_index: 107, caption_sha256: segmentHash, start_seconds: 13, end_seconds: 16, excerpt: "The council approves the plan." }],
      [{ article_id: 72 }],
    ]);
    const result = await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 });
    assert.equal(result.recorded, 1);
    assert.equal(calls.length, 3);
    assert.match(calls[0]!.text, /meeting_draft_transcript_revision_reviews/);
    assert.match(calls[1]!.text, /start_seconds.*end_seconds.*excerpt/);
    assert.match(calls[2]!.text, /values \(\$1,\$2,\$3,\$4,\$5,\$6,\$7\)/);
    assert.deepEqual(calls[2]!.params, [3, 72, 41, 5, bHash, "video-1", JSON.stringify(accepted)]);
    assert.match(calls[0]!.text, /draft_link_id=l\.id/);
  });

  it("does not publish B acceptance after the draft text changed", async () => {
    const aHash = "a".repeat(64);
    const bHash = "b".repeat(64);
    const oldDraft = {
      id: 41, draft_id: 41, headline: "Council approves plan", dek: "", topic: "council",
      body: "The council approves the plan.", source_urls: "[]", provenance_json: "[]",
      found_note: "", unanswered: "[]", research_json: JSON.stringify({ meetingEvidence: { used: true } }),
    };
    const editedDraft = { ...oldDraft, body: "The council rejected the plan." };
    const { sql, calls } = recorder([[
      { ...editedDraft, newsroom_id: 3, link_id: 55, artifact_id: 4, citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7, captionSha256: aHash }]), video_id: "video-1", sha256: aHash, linked_integrity_status: "valid", current_artifact_id: 5, current_sha256: bHash, current_integrity_status: "valid", accepted_artifact_id: 5, accepted_artifact_sha256: bHash, accepted_citation_snapshot: "[]", draft_evidence_sha256: draftEvidenceSha256(oldDraft), reviewed_by: "editor-1", resolution_note: "Checked." },
    ]]);
    await assert.rejects(recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 }), /citation review no longer matches/i);
    assert.equal(calls.some((call) => /insert into meeting_article_transcript_links/i.test(call.text)), false);
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
      [{ id: 9, prior_artifact_id: 4, current_artifact_id: 5, current_sha256: acceptedArtifactSha256, citation_snapshot: JSON.stringify([
        { artifactId: 4, segmentIndex: 7, captionSha256: "old" },
        { artifactId: 4, segmentIndex: 11, captionSha256: "old" },
      ]) }],
      [
        { segment_index: 7, start_seconds: 12, caption_sha256: "caption-a-7" },
        { segment_index: 11, start_seconds: 22, caption_sha256: "caption-a-11" },
      ],
      [
        { review_id: 9, source_segment_index: 7, current_segment_index: 107, current_start_seconds: 13, current_end_seconds: 16, current_excerpt: "B seven", current_caption_sha256: "c".repeat(64) },
        { review_id: 9, source_segment_index: 11, current_segment_index: 111, current_start_seconds: 24, current_end_seconds: 27, current_excerpt: "B eleven", current_caption_sha256: "d".repeat(64) },
      ],
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
    assert.match(calls[1]!.text, /artifact_id=\$1 and segment_index=any/i, "the server loads original citation timestamps from A");
    assert.match(calls[2]!.text, /abs\(s\.start_seconds-used\.timestamp_seconds\)/i, "B matching uses nearby timestamps, not A's numeric segment index");
    assert.doesNotMatch(calls[2]!.text, /s\.segment_index=used\.source_segment_index/i);
    assert.match(calls[3]!.text, /update meeting_article_revision_reviews/i);
    assert.match(calls[3]!.text, /status='verified'/i);
    assert.match(calls[3]!.text, /resolved_by=\$2/i, "the review records who accepted B");
    assert.match(calls[3]!.text, /resolved_at=now\(\)/i, "the review records when B was accepted");
    assert.match(calls[3]!.text, /accepted_artifact_sha256=\$6/i);
    assert.match(calls[3]!.text, /accepted_citation_snapshot=\$7/i);
    assert.doesNotMatch(calls[3]!.text, /update articles/i, "the historical article must not be silently rewritten");
    assert.deepEqual(calls[3]!.params.slice(0, 6), [5, "editor-1", "Checked every affected quote against B.", 3, 9, acceptedArtifactSha256]);
    assert.deepEqual(JSON.parse(String(calls[3]!.params[6])), [
      { sourceArtifactId: 4, sourceSegmentIndex: 7, sourceTimestampSeconds: 12, sourceCaptionSha256: "caption-a-7", acceptedArtifactId: 5, acceptedArtifactSha256, acceptedSegmentIndex: 107, acceptedTimestampSeconds: 13, acceptedEndSeconds: 16, excerpt: "B seven", captionSha256: "c".repeat(64) },
      { sourceArtifactId: 4, sourceSegmentIndex: 11, sourceTimestampSeconds: 22, sourceCaptionSha256: "caption-a-11", acceptedArtifactId: 5, acceptedArtifactSha256, acceptedSegmentIndex: 111, acceptedTimestampSeconds: 24, acceptedEndSeconds: 27, excerpt: "B eleven", captionSha256: "d".repeat(64) },
    ]);
  });

  it("refuses a same-index B segment when it is not near the original timestamp", async () => {
    const { sql, calls } = recorder([
      [{ id: 9, prior_artifact_id: 4, current_artifact_id: 5, current_sha256: acceptedArtifactSha256, citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7 }]) }],
      [{ segment_index: 7, start_seconds: 12, caption_sha256: "caption-a-7" }],
      [{ review_id: 9, source_segment_index: 7, current_segment_index: null, current_start_seconds: null, current_end_seconds: null, current_excerpt: null, current_caption_sha256: null }],
    ]);
    await assert.rejects(resolvePublishedMeetingReview(sql, {
      newsroomId: 3, reviewId: 9, reviewerId: "editor-1", resolution: "still-accurate", acceptedArtifactId: 5,
      note: "Same index, unrelated B segment.", confirmedSegmentIndices: [7],
    }), /no current transcript segment near its original timestamp/i);
    assert.equal(calls.length, 3, "a no-match review must fail before resolution");
  });

  it("refuses an artifact row without a SHA-256 hash", async () => {
    const { sql, calls } = recorder([
      [{ id: 9, prior_artifact_id: 4, current_artifact_id: 5, current_sha256: "missing", citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7 }]) }],
    ]);
    await assert.rejects(resolvePublishedMeetingReview(sql, {
      newsroomId: 3, reviewId: 9, reviewerId: "editor-1", resolution: "still-accurate",
      acceptedArtifactId: 5, note: "Checked citation.", confirmedSegmentIndices: [7],
    }), /artifact hash is missing or invalid/i);
    assert.equal(calls.length, 1, "a missing artifact hash must not resolve the review");
  });

  it("fails closed when the published citation snapshot is only partly valid", async () => {
    const { sql, calls } = recorder([[
      { id: 9, prior_artifact_id: 4, current_artifact_id: 5, current_sha256: acceptedArtifactSha256,
        citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7 }, { artifactId: 4 }]) },
    ]]);
    await assert.rejects(resolvePublishedMeetingReview(sql, {
      newsroomId: 3, reviewId: 9, reviewerId: "editor-1", resolution: "still-accurate",
      acceptedArtifactId: 5, note: "Malformed snapshots must not be partially accepted.", confirmedSegmentIndices: [7],
    }), /citation snapshot is missing or malformed/i);
    assert.equal(calls.length, 1, "malformed evidence must fail before reading/accepting B");
  });

  it("refuses a still-accurate confirmation that did not verify every affected citation", async () => {
    const { sql } = recorder([{ id: 9, prior_artifact_id: 4, current_artifact_id: 5, citation_snapshot: JSON.stringify([
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
    const { sql, calls } = recorder([
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
        { artifact_id: 4, segment_index: 11, start_seconds: 22, excerpt: "old eleven" },
      ],
      [
        { review_id: 9, source_segment_index: 7, current_segment_index: 107, current_start_seconds: 13, current_end_seconds: 16, current_excerpt: "new seven", current_caption_sha256: "new-caption-7" },
        { review_id: 9, source_segment_index: 11, current_segment_index: null, current_start_seconds: null, current_end_seconds: null, current_excerpt: null, current_caption_sha256: null },
      ],
    ]);
    const reviews = await listPublishedMeetingReviews(sql, 3);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.article.headline, "Council approves housing plan");
    assert.deepEqual(reviews[0]!.citations[0], {
      segmentIndex: 7, oldExcerpt: "old seven", currentSegmentIndex: 107, currentExcerpt: "new seven",
      timestampSeconds: 12, currentTimestampSeconds: 13, currentCaptionSha256: "new-caption-7",
    });
    assert.match(calls[2]!.text, /abs\(s\.start_seconds-used.timestamp_seconds\)/i);
    assert.doesNotMatch(calls[2]!.text, /s\.segment_index=used.source_segment_index/i,
      "displayed B evidence must be selected by timestamp even when its index changes");
    assert.equal(reviews[0]!.citations[1]!.currentExcerpt, null, "missing direct comparison must be stated honestly");
  });

  it("returns resolved reviews with the exact accepted B evidence for editor history", async () => {
    const acceptedCaptionSha = "c".repeat(64);
    const acceptedSnapshot = JSON.stringify([{
      sourceArtifactId: 4, sourceSegmentIndex: 7, sourceTimestampSeconds: 12, sourceCaptionSha256: "a".repeat(64),
      acceptedArtifactId: 5, acceptedArtifactSha256: acceptedArtifactSha256,
      acceptedSegmentIndex: 107, acceptedTimestampSeconds: 13, acceptedEndSeconds: 16,
      excerpt: "The accepted current transcript text.", captionSha256: acceptedCaptionSha,
    }]);
    const { sql, calls } = recorder([
      [{
        id: 9, article_id: 72, headline: "Council approves housing plan", slug: "housing-plan",
        status: "verified", revision_reason: "hash", prior_artifact_id: 4, current_artifact_id: 5,
        prior_sha256: "a".repeat(64), current_sha256: acceptedArtifactSha256,
        citation_snapshot: JSON.stringify([{ artifactId: 4, segmentIndex: 7 }]),
        created_at: "2026-09-22T00:00:00Z", resolved_at: "2026-09-23T01:00:00Z",
        resolved_by: "editor-account", resolution_note: "I checked this passage against B.",
        accepted_artifact_id: 5,
        accepted_artifact_sha256: acceptedArtifactSha256, accepted_citation_snapshot: acceptedSnapshot,
      }],
      [{ artifact_id: 4, segment_index: 7, start_seconds: 12, excerpt: "Old published excerpt" }],
      [{ review_id: 9, source_segment_index: 7, current_segment_index: 107,
        current_start_seconds: 13, current_end_seconds: 16, current_excerpt: "Current segment excerpt",
        current_caption_sha256: acceptedCaptionSha }],
    ]);

    const reviews = await listPublishedMeetingReviews(sql, 3);
    assert.equal(reviews.length, 1, "resolved history must remain queryable");
    assert.doesNotMatch(calls[0]!.text, /status\s+in\s*\(/i, "query must not filter out resolved statuses");
    assert.equal(reviews[0]!.status, "verified");
    assert.equal(reviews[0]!.resolvedBy, "editor-account");
    assert.equal(reviews[0]!.resolvedAt, "2026-09-23T01:00:00Z");
    assert.equal(reviews[0]!.resolutionNote, "I checked this passage against B.");
    assert.deepEqual(reviews[0]!.acceptedEvidence, {
      artifactSha256: acceptedArtifactSha256,
      citations: [{
        segmentIndex: 107, timestampSeconds: 13, endSeconds: 16,
        excerpt: "The accepted current transcript text.", captionSha256: acceptedCaptionSha,
      }],
    });
  });

  it("does not present a mismatched or malformed accepted B snapshot as verified evidence", async () => {
    const { sql } = recorder([[
      {
        id: 9, article_id: 72, headline: "Council approves housing plan", slug: "housing-plan",
        status: "verified", revision_reason: "hash", prior_artifact_id: 4, current_artifact_id: 5,
        prior_sha256: "a".repeat(64), current_sha256: acceptedArtifactSha256,
        citation_snapshot: "[]", created_at: "2026-09-22T00:00:00Z", resolved_at: "2026-09-23T01:00:00Z",
        resolved_by: "editor-account", resolution_note: "Checked.", accepted_artifact_id: 6,
        accepted_artifact_sha256: acceptedArtifactSha256,
        accepted_citation_snapshot: JSON.stringify([{ acceptedSegmentIndex: -1, acceptedTimestampSeconds: 13, acceptedEndSeconds: 16, excerpt: "bad", captionSha256: "c".repeat(64), acceptedArtifactSha256 }]),
      },
    ]]);
    const reviews = await listPublishedMeetingReviews(sql, 3);
    assert.equal(reviews[0]!.status, "verified");
    assert.equal(reviews[0]!.acceptedEvidence, null);
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

  it("uses PostgreSQL timestamp matching when B reindexes citations and persists exactly the displayed segment", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create table articles (id integer primary key, newsroom_id integer not null, headline text not null, slug text not null);
        create table meeting_article_transcript_links (id integer primary key, citation_snapshot text not null);
        create table meeting_article_revision_reviews (
          id integer primary key, newsroom_id integer not null, article_link_id integer not null, article_id integer not null,
          video_id text not null, prior_artifact_id integer not null, current_artifact_id integer not null,
          accepted_artifact_id integer, correction_id integer, revision_reason text not null, status text not null,
          resolved_by text, resolution_note text, resolved_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
          accepted_artifact_sha256 text, accepted_citation_snapshot text
        );
        create table meeting_transcript_artifacts (id integer primary key, newsroom_id integer not null, sha256 text not null);
        create table meeting_transcript_segments (
          artifact_id integer not null, segment_index integer not null, start_seconds numeric not null, end_seconds numeric not null,
          item text, excerpt text not null, caption_sha256 text not null, primary key(artifact_id,segment_index)
        );
        insert into articles values (72,3,'Council story','council-story');
        insert into meeting_article_transcript_links values (90,'[]'),(91,'[]');
        insert into meeting_transcript_artifacts values (4,3,repeat('a',64)),(5,3,repeat('b',64));
        insert into meeting_transcript_segments values
          (4,7,12,15,'4','Published A wording',repeat('a',64)),
          (4,8,100,103,'5','Second published A wording',repeat('c',64)),
          (5,7,500,503,'99','Unrelated same-number B wording','wrong-caption'),
          (5,8,500,503,'99','Same index but distant B wording','wrong-caption-8'),
          (5,107,13,16,'4','Correct timestamp-matched B wording',repeat('b',64));
        insert into meeting_article_revision_reviews
          (id,newsroom_id,article_link_id,article_id,video_id,prior_artifact_id,current_artifact_id,revision_reason,status)
        values (9,3,90,72,'meeting-1',4,5,'hash','pending'),(10,3,91,72,'meeting-1',4,5,'hash','pending');
        update meeting_article_transcript_links set citation_snapshot='[{"artifactId":4,"segmentIndex":7}]' where id=90;
        update meeting_article_transcript_links set citation_snapshot='[{"artifactId":4,"segmentIndex":8}]' where id=91;
      `);
      const sql = (async () => [] as never[]) as unknown as Sql;
      sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;

      const shown = await listPublishedMeetingReviews(sql, 3);
      const firstShown = shown.find((review) => review.id === 9)!;
      const secondShown = shown.find((review) => review.id === 10)!;
      assert.equal(firstShown.citations[0]!.currentSegmentIndex, 107);
      assert.equal(firstShown.citations[0]!.currentExcerpt, "Correct timestamp-matched B wording");
      assert.notEqual(firstShown.citations[0]!.currentExcerpt, "Unrelated same-number B wording");
      assert.equal(secondShown.citations[0]!.currentSegmentIndex, null);
      assert.equal(secondShown.citations[0]!.currentExcerpt, null, "distant same-index text is unavailable, not a match");

      await resolvePublishedMeetingReview(sql, {
        newsroomId: 3, reviewId: 9, reviewerId: "editor-1", resolution: "still-accurate",
        acceptedArtifactId: 5, note: "Compared the displayed B segment.", confirmedSegmentIndices: [7],
      });
      const [saved] = (await db.query<{
        status: string; accepted_artifact_id: number; accepted_artifact_sha256: string;
        accepted_citation_snapshot: string; resolved_by: string; resolved_at: string;
      }>(`select status,accepted_artifact_id,accepted_artifact_sha256,accepted_citation_snapshot,resolved_by,resolved_at
            from meeting_article_revision_reviews where id=9`)).rows;
      assert.equal(saved!.status, "verified");
      assert.equal(saved!.accepted_artifact_id, 5);
      assert.equal(saved!.accepted_artifact_sha256, "b".repeat(64));
      assert.equal(saved!.resolved_by, "editor-1");
      assert.ok(saved!.resolved_at);
      assert.deepEqual(JSON.parse(saved!.accepted_citation_snapshot), [{
        sourceArtifactId: 4, sourceSegmentIndex: 7, sourceTimestampSeconds: 12, sourceCaptionSha256: "a".repeat(64),
        acceptedArtifactId: 5, acceptedArtifactSha256: "b".repeat(64), acceptedSegmentIndex: 107,
        acceptedTimestampSeconds: 13, acceptedEndSeconds: 16, excerpt: "Correct timestamp-matched B wording", captionSha256: "b".repeat(64),
      }]);
      await assert.rejects(resolvePublishedMeetingReview(sql, {
        newsroomId: 3, reviewId: 10, reviewerId: "editor-1", resolution: "still-accurate",
        acceptedArtifactId: 5, note: "Distant same-index text must not count.", confirmedSegmentIndices: [8],
      }), /no current transcript segment near its original timestamp/i);
      const [stillPending] = (await db.query<{ status: string }>("select status from meeting_article_revision_reviews where id=10")).rows;
      assert.equal(stillPending!.status, "pending");
    } finally {
      await db.close();
    }
  });
});
