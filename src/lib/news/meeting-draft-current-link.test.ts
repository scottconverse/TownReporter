import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { recordPublishedMeetingEvidence } from "./meeting-article-revision.ts";
import { linkDraftToTranscript } from "./meeting-draft-transcript-link.ts";
import { recordDraftTranscriptRevisionReview } from "./meeting-draft-revision-review.ts";
import { draftEvidenceSha256 } from "./meeting-draft-revision-review.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import { staleMeetingCitations } from "./meeting-publish-guard.ts";

test("redraft keeps A as history while B becomes the only publishable evidence", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table leads (id integer primary key, newsroom_id integer not null);
      create table drafts (
        id integer primary key, newsroom_id integer not null, lead_id integer not null,
        headline text not null default 'Council approves plan', dek text not null default '',
        topic text not null default 'council', body text not null default 'The council approves the plan.',
        source_urls text not null default '[]', provenance_json text not null default '[]',
        found_note text not null default '', unanswered text not null default '[]',
        research_json text not null default '{"meetingEvidence":{"used":true}}', updated_at timestamptz default now()
      );
      create table meeting_capture_records (newsroom_id integer not null, video_id text not null, primary key(newsroom_id,video_id));
      create table meeting_transcript_artifacts (
        id integer primary key, newsroom_id integer not null, video_id text not null,
        artifact_type text not null default 'transcript', sha256 text not null,
        integrity_status text not null default 'valid', captured_at timestamptz not null
      );
      create table meeting_transcript_segments (
        artifact_id integer not null, segment_index integer not null,
        caption_sha256 text not null, start_seconds numeric not null default 10,
        end_seconds numeric not null default 12, excerpt text not null default 'Council voted to approve the plan.',
        primary key(artifact_id,segment_index)
      );
      create table meeting_draft_transcript_links (
        id serial primary key, newsroom_id integer not null, draft_id integer not null,
        artifact_id integer not null, citation_snapshot text not null default '[]', revision_notice text,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique(newsroom_id,draft_id,artifact_id)
      );
      create table meeting_article_transcript_links (
        id serial primary key, newsroom_id integer not null, article_id integer not null,
        origin_draft_id integer, artifact_id integer not null, artifact_sha256 text not null,
        video_id text not null, citation_snapshot text not null, published_at timestamptz default now(),
        created_at timestamptz default now(), unique(newsroom_id,article_id,artifact_id)
      );
      insert into leads(id,newsroom_id) values (13,3),(14,3);
      insert into drafts(id,newsroom_id,lead_id,research_json) values
        (41,3,13,'{}'),(42,3,14,'{"meetingEvidence":{"used":true}}');
      insert into meeting_transcript_artifacts(id,newsroom_id,video_id,sha256,captured_at) values
        (4,3,'meeting-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now()-interval '1 minute'),
        (5,3,'meeting-1','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',now());
      insert into meeting_transcript_segments(artifact_id,segment_index,caption_sha256)
        values
          (4,7,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
          (5,7,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      insert into meeting_capture_records(newsroom_id,video_id) values (3,'meeting-1');
    `);
    const migration = await readFile(new URL("../../../migrations/0082_current_draft_transcript_link.sql", import.meta.url), "utf8");
    await db.exec(migration);
    const reviewMigration = await readFile(new URL("../../../migrations/0085_meeting_draft_revision_review.sql", import.meta.url), "utf8");
    await db.exec(reviewMigration);
    const sql = (async () => [] as never[]) as unknown as Sql;
    sql.query = async <T>(text: string, params: unknown[] = []) => (await db.query<T>(text, params)).rows;
    await linkDraftToTranscript(sql, {
      newsroomId: 3, draftId: 41, artifactId: 4,
      citations: [{ segmentIndex: 7, captionSha256: "a".repeat(64) }],
    });
    await db.query("update meeting_draft_transcript_links set revision_notice='The recording changed.' where draft_id=41 and artifact_id=4");
    await linkDraftToTranscript(sql, {
      newsroomId: 3, draftId: 41, artifactId: 5,
      citations: [{ segmentIndex: 7, captionSha256: "b".repeat(64) }],
    });
    const links = (await db.query<{ artifact_id: number; is_current: boolean; revision_notice: string | null }>(
      "select artifact_id,is_current,revision_notice from meeting_draft_transcript_links order by artifact_id",
    )).rows;
    assert.deepEqual(links, [
      { artifact_id: 4, is_current: false, revision_notice: "The recording changed." },
      { artifact_id: 5, is_current: true, revision_notice: null },
    ]);
    assert.deepEqual(await staleMeetingCitations(sql, { newsroomId: 3, draftId: 41 }), []);
    const recorded = await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 72, draftId: 41 });
    assert.equal(recorded.recorded, 1);
    const published = (await db.query<{ artifact_id: number; artifact_sha256: string }>(
      "select artifact_id,artifact_sha256 from meeting_article_transcript_links",
    )).rows;
    assert.deepEqual(published, [{ artifact_id: 5, artifact_sha256: "b".repeat(64) }]);

    // A separate, still-A-linked draft exercises the citation-only route all
    // the way through the production-shaped PostgreSQL guard and article copy.
    await linkDraftToTranscript(sql, {
      newsroomId: 3, draftId: 42, artifactId: 4,
      citations: [{ segmentIndex: 7, captionSha256: "a".repeat(64) }],
    });
    const draftRows = (await db.query<{
      id: number; lead_id: number; headline: string; dek: string; topic: string; body: string;
      source_urls: string; provenance_json: string; found_note: string; unanswered: string; research_json: string;
    }>("select id,lead_id,headline,dek,topic,body,source_urls,provenance_json,found_note,unanswered,research_json from drafts where id=42")).rows;
    const review = await recordDraftTranscriptRevisionReview(sql, {
      newsroomId: 3, leadId: 14, draftId: 42, reviewerId: "editor-1",
      expectedEvidenceToken: evidenceReviewToken(draftRows[0]!), acceptedArtifactId: 5,
      confirmedSegmentIndexes: [7], note: "Compared the old quotation with the current caption line.",
    });
    assert.ok(review.reviewId > 0);
    assert.deepEqual(await staleMeetingCitations(sql, { newsroomId: 3, draftId: 42 }), []);
    const savedReview = (await db.query<{
      accepted_artifact_id: number; accepted_artifact_sha256: string; accepted_citation_snapshot: string;
      draft_evidence_sha256: string; reviewed_by: string; resolution_note: string;
    }>("select accepted_artifact_id,accepted_artifact_sha256,accepted_citation_snapshot,draft_evidence_sha256,reviewed_by,resolution_note from meeting_draft_transcript_revision_reviews where id=$1", [review.reviewId])).rows[0]!;
    assert.equal(savedReview.accepted_artifact_id, 5);
    assert.equal(savedReview.accepted_artifact_sha256, "b".repeat(64));
    assert.equal(savedReview.draft_evidence_sha256, draftEvidenceSha256(draftRows[0]!));
    assert.equal(savedReview.reviewed_by, "editor-1");
    assert.equal(savedReview.resolution_note, "Compared the old quotation with the current caption line.");
    const reviewPublish = await recordPublishedMeetingEvidence(sql, { newsroomId: 3, articleId: 73, draftId: 42 });
    assert.equal(reviewPublish.recorded, 1);
    const preserved = (await db.query<{ artifact_id: number }>(
      "select artifact_id from meeting_draft_transcript_links where draft_id=42 and is_current=true",
    )).rows;
    assert.deepEqual(preserved, [{ artifact_id: 4 }], "citation-only review keeps the draft's original A link");
    const reviewedArticle = (await db.query<{ artifact_id: number; artifact_sha256: string; citation_snapshot: string }>(
      "select artifact_id,artifact_sha256,citation_snapshot from meeting_article_transcript_links where article_id=73",
    )).rows;
    assert.equal(reviewedArticle[0]?.artifact_id, 5, "article provenance binds to accepted B");
    assert.equal(reviewedArticle[0]?.artifact_sha256, "b".repeat(64));
    assert.match(reviewedArticle[0]?.citation_snapshot ?? "", /Council voted to approve the plan/);
  } finally {
    await db.close();
  }
});
