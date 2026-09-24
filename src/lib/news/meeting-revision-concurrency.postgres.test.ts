import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import type { Sql } from "../db.ts";
import { integrationRequested, probePostgres, resolveAdminUrl, withDatabase } from "../test-support/pg-admin.ts";
import { resolvePublishedMeetingReview } from "./meeting-article-revision.ts";

const adminUrl = integrationRequested() ? resolveAdminUrl() : "";
const probe = integrationRequested()
  ? await probePostgres(adminUrl)
  : { ok: false as const, reason: "set TEST_POSTGRES_ADMIN_URL; CI runs this against a disposable database" };
const skip = probe.ok ? false : probe.reason;
const dbName = `townreporter_test_meeting_revision_race_${process.pid}_${Date.now()}`;
const dbUrl = probe.ok ? withDatabase(adminUrl, dbName) : "";
const newsroomId = 910002;
let created = false;
let setup: Client;

function sqlFrom(connection: Client): Sql {
  const sql = (async () => [] as never[]) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await connection.query(text, params)).rows as T[];
  return sql;
}

async function connection() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  return client;
}

async function seedMeeting(videoId: string) {
  await setup.query(
    "insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,caption_sha256,capture_disposition) values($1,$2,'https://youtube.com/@city','City Council','2026-09-22','captured',$3,'provisional')",
    [newsroomId, videoId, `${videoId}-hash-a`],
  );
  const artifact = await setup.query<{ id: number }>(
    "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,integrity_status,captured_at) values($1,$2,$3,'vtt',$4,'captions','transcript-only','valid',now()-interval '1 minute') returning id",
    [newsroomId, videoId, `C:/scratch/${videoId}-a.vtt`, `${videoId}-hash-a`],
  );
  const artifactId = artifact.rows[0]!.id;
  await setup.query(
    "insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256) values($1,1,10,14,'Council approves the plan.',$2)",
    [artifactId, `${videoId}-hash-a`],
  );
  const { fileMeetingLead } = await import("./meeting-lead.ts");
  const filed = await fileMeetingLead(sqlFrom(setup), {
    newsroomId,
    userId: "editor",
    videoId,
    title: "City Council",
    meetingDate: "2026-09-22",
    topic: "council",
    sourceUrls: [`https://youtube.com/watch?v=${videoId}`],
    items: [{ item: "4", title: "Housing plan" }],
    establishedVotes: 0,
    citations: [{ item: "4", segmentIndex: 1, timestampSeconds: 10, excerpt: "Council approves the plan.", captionSha256: `${videoId}-hash-a` }],
    artifactId,
    votes: [],
  });
  const draft = await setup.query<{ id: number }>(
    "insert into drafts(user_id,newsroom_id,lead_id,headline,body,topic,source_urls,research_json) values('editor',$1,$2,'Council approves plan','Council approves the plan.','council','[]','{}') returning id",
    [newsroomId, filed.leadId],
  );
  const { linkDraftToTranscript } = await import("./meeting-draft-transcript-link.ts");
  await linkDraftToTranscript(sqlFrom(setup), {
    newsroomId,
    draftId: draft.rows[0]!.id,
    artifactId,
    citations: [{ segmentIndex: 1, captionSha256: `${videoId}-hash-a` }],
  });
  return { leadId: filed.leadId, draftId: draft.rows[0]!.id, artifactId };
}

async function insertRevision(sql: Sql, videoId: string) {
  const currentSha256 = "b".repeat(64);
  const rows = await sql.query<{ id: number }>(
    "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,integrity_status,captured_at) values($1,$2,$3,'vtt',$4,'captions','transcript-only','valid',now()) returning id",
    [newsroomId, videoId, `C:/scratch/${videoId}-b.vtt`, currentSha256],
  );
  await sql.query(
    "insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256) values($1,101,11,15,'Council delays the plan.',$2)",
    [rows[0]!.id, currentSha256],
  );
  return rows[0]!.id;
}

if (probe.ok) {
  before(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      console.log(`[meeting revision concurrency] creating disposable PostgreSQL database: ${dbName}`);
      await admin.query(`create database ${dbName}`);
      created = true;
    } finally {
      await admin.end();
    }
    execFileSync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "ignore",
    });
    setup = await connection();
    await setup.query("insert into newsrooms(id,name) values($1,'Meeting revision race')", [newsroomId]);
    await setup.query("insert into newsroom_members(newsroom_id,user_id,role) values($1,'editor','owner')", [newsroomId]);
  });
  after(async () => {
    await setup?.end();
    if (!created) return;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [dbName]);
      await admin.query(`drop database ${dbName}`);
    } finally {
      await admin.end();
    }
  });
}

describe("meeting revision and publication share one PostgreSQL lock order", { skip }, () => {
  it("fails closed when persisted used citations do not resolve to hashed segments on the linked artifact", async () => {
    const missing = await seedMeeting("guard-missing-segment");
    const mismatched = await seedMeeting("guard-mismatched-segment");
    await setup.query("delete from meeting_transcript_segments where artifact_id=$1 and segment_index=1", [missing.artifactId]);
    await setup.query("update meeting_transcript_segments set caption_sha256='not-the-artifact-hash' where artifact_id=$1 and segment_index=1", [mismatched.artifactId]);

    const { staleMeetingCitations } = await import("./meeting-publish-guard.ts");
    const missingResult = await staleMeetingCitations(sqlFrom(setup), { newsroomId, draftId: missing.draftId });
    assert.equal(missingResult.length, 1);
    assert.equal(missingResult[0]!.reason, "invalid-citation-segment");
    assert.equal(missingResult[0]!.current, "missing");

    const mismatchResult = await staleMeetingCitations(sqlFrom(setup), { newsroomId, draftId: mismatched.draftId });
    assert.equal(mismatchResult.length, 1);
    assert.equal(mismatchResult[0]!.reason, "invalid-citation-segment");
    assert.equal(mismatchResult[0]!.current, "not-the-artifact-hash");
  });

  it("publication owns the canonical meeting row, not only the lead row", async () => {
    const seeded = await seedMeeting("publication-meeting-row");
    const publication = await connection();
    const contender = await connection();
    try {
      const { lockMeetingsForDraftPublish } = await import("./meeting-revision-lock.ts");
      await publication.query("begin");
      await publication.query("select id from leads where newsroom_id=$1 and id=$2 for update", [newsroomId, seeded.leadId]);
      await lockMeetingsForDraftPublish(sqlFrom(publication), { newsroomId, draftId: seeded.draftId });

      await contender.query("begin");
      await contender.query("set local lock_timeout='100ms'");
      let lockError: unknown;
      try {
        await contender.query(
          "select video_id from meeting_capture_records where newsroom_id=$1 and video_id=$2 for update",
          [newsroomId, "publication-meeting-row"],
        );
      } catch (error) {
        lockError = error;
      }
      assert.equal(
        (lockError as { code?: string } | undefined)?.code,
        "55P03",
        "publication must hold the canonical meeting row; removing that lock must fail this assertion",
      );
      await contender.query("rollback");
      await publication.query("rollback");
    } finally {
      await contender.query("rollback").catch(() => undefined);
      await publication.query("rollback").catch(() => undefined);
      await contender.end();
      await publication.end();
    }
  });

  it("capture owns the canonical meeting row until its revision transaction commits", async () => {
    await seedMeeting("capture-meeting-row");
    const capture = await connection();
    const contender = await connection();
    try {
      const { lockMeetingRevisionForCapture } = await import("./meeting-revision-lock.ts");
      await capture.query("begin");
      await lockMeetingRevisionForCapture(sqlFrom(capture), { newsroomId, videoId: "capture-meeting-row" });

      await contender.query("begin");
      await contender.query("set local lock_timeout='100ms'");
      let lockError: unknown;
      try {
        await contender.query(
          "select video_id from meeting_capture_records where newsroom_id=$1 and video_id=$2 for update",
          [newsroomId, "capture-meeting-row"],
        );
      } catch (error) {
        lockError = error;
      }
      assert.equal(
        (lockError as { code?: string } | undefined)?.code,
        "55P03",
        "capture must hold the shared meeting row; removing its lock must fail this assertion",
      );
    } finally {
      await contender.query("rollback").catch(() => undefined);
      await capture.query("rollback").catch(() => undefined);
      await contender.end();
      await capture.end();
    }
  });

  it("retains an immutable draft citation review when the editor deletes its lead into trash", async () => {
    const seeded = await seedMeeting("review-retention-on-delete");
    const link = await setup.query<{ id: number }>(
      "select id from meeting_draft_transcript_links where newsroom_id=$1 and draft_id=$2 and is_current=true",
      [newsroomId, seeded.draftId],
    );
    const bHash = "e".repeat(64);
    const b = await setup.query<{ id: number }>(
      "insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode,integrity_status,captured_at) values($1,$2,'C:/scratch/review-retention-b.vtt','vtt',$3,'captions','transcript-only','valid',now()) returning id",
      [newsroomId,"review-retention-on-delete",bHash],
    );
    await setup.query(
      `insert into meeting_draft_transcript_revision_reviews
         (newsroom_id,draft_id,draft_link_id,lead_id,draft_headline,prior_artifact_id,accepted_artifact_id,
          prior_artifact_sha256,accepted_artifact_sha256,prior_citation_snapshot,accepted_citation_snapshot,
          draft_evidence_sha256,reviewed_by,resolution_note)
       values($1,$2,$3,$4,'Council approves plan',$5,$6,$7,$8,'[]','[]',$9,'editor','Compared every cited passage with B.')`,
      [newsroomId,seeded.draftId,link.rows[0]!.id,seeded.leadId,seeded.artifactId,b.rows[0]!.id,
        "a".repeat(64),bHash,"f".repeat(64)],
    );

    await setup.query("delete from leads where newsroom_id=$1 and id=$2", [newsroomId,seeded.leadId]);
    const liveDraft = await setup.query("select id from drafts where id=$1", [seeded.draftId]);
    const liveLink = await setup.query("select id from meeting_draft_transcript_links where id=$1", [link.rows[0]!.id]);
    const retained = await setup.query<{
      lead_id: number; draft_id: number; draft_headline: string; reviewed_by: string; accepted_artifact_id: number;
    }>(
      "select lead_id,draft_id,draft_headline,reviewed_by,accepted_artifact_id from meeting_draft_transcript_revision_reviews where newsroom_id=$1 and draft_id=$2",
      [newsroomId,seeded.draftId],
    );
    assert.equal(liveDraft.rowCount, 0, "the story delete still removes the live draft");
    assert.equal(liveLink.rowCount, 0, "the story delete still removes the live draft link");
    assert.equal(retained.rowCount, 1, "the editor's A-to-B review survives independently");
    assert.equal(retained.rows[0]!.lead_id, seeded.leadId);
    assert.equal(retained.rows[0]!.draft_headline, "Council approves plan");
    assert.equal(retained.rows[0]!.reviewed_by, "editor");
    assert.equal(Number(retained.rows[0]!.accepted_artifact_id), b.rows[0]!.id);

    await assert.rejects(
      setup.query("update meeting_draft_transcript_revision_reviews set resolution_note='changed' where newsroom_id=$1 and draft_id=$2", [newsroomId,seeded.draftId]),
      /append-only/,
      "a retained editor decision cannot be rewritten",
    );
    await assert.rejects(
      setup.query("delete from meeting_draft_transcript_revision_reviews where newsroom_id=$1 and draft_id=$2", [newsroomId,seeded.draftId]),
      /append-only/,
      "a retained editor decision cannot be erased",
    );
  });

  it("capture B first makes an A-linked publication observe B and fail closed", async () => {
    const seeded = await seedMeeting("capture-first");
    const capture = await connection();
    const publication = await connection();
    try {
      await capture.query("begin");
      const { lockMeetingRevisionForCapture, lockMeetingsForDraftPublish } = await import("./meeting-revision-lock.ts");
      await lockMeetingRevisionForCapture(sqlFrom(capture), { newsroomId, videoId: "capture-first" });
      await insertRevision(sqlFrom(capture), "capture-first");
      await capture.query("commit");

      await publication.query("begin");
      await publication.query("select id from leads where newsroom_id=$1 and id=$2 for update", [newsroomId, seeded.leadId]);
      await lockMeetingsForDraftPublish(sqlFrom(publication), { newsroomId, draftId: seeded.draftId });
      const { staleMeetingCitations } = await import("./meeting-publish-guard.ts");
      const stale = await staleMeetingCitations(sqlFrom(publication), { newsroomId, draftId: seeded.draftId });
      assert.equal(stale.length, 1);
      assert.equal(stale[0]!.current, "b".repeat(64));
      await publication.query("rollback");
    } finally {
      await capture.end();
      await publication.end();
    }
  });

  it("publication A first makes capture wait, then B flags the frozen article once", async () => {
    const seeded = await seedMeeting("publish-first");
    const publication = await connection();
    const capture = await connection();
    try {
      const { lockMeetingRevisionForCapture, lockMeetingsForDraftPublish } = await import("./meeting-revision-lock.ts");
      const { staleMeetingCitations } = await import("./meeting-publish-guard.ts");
      const { recordPublishedMeetingEvidence, flagPublishedArticlesForTranscriptRevision } = await import("./meeting-article-revision.ts");

      await publication.query("begin");
      await publication.query("select id from leads where newsroom_id=$1 and id=$2 for update", [newsroomId, seeded.leadId]);
      await lockMeetingsForDraftPublish(sqlFrom(publication), { newsroomId, draftId: seeded.draftId });
      assert.deepEqual(await staleMeetingCitations(sqlFrom(publication), { newsroomId, draftId: seeded.draftId }), []);

      await capture.query("begin");
      let captureAcquired = false;
      const captureLock = lockMeetingRevisionForCapture(sqlFrom(capture), { newsroomId, videoId: "publish-first" })
        .then(() => { captureAcquired = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(captureAcquired, false, "capture must wait while publication owns the shared lead/meeting fence");

      const article = await publication.query<{ id: number }>(
        "insert into articles(user_id,newsroom_id,lead_id,slug,headline,body,topic,source_urls,status,origin_draft_id) values('editor',$1,$2,'publish-first','Council approves plan','Original published body.','council','[]','published',$3) returning id",
        [newsroomId, seeded.leadId, seeded.draftId],
      );
      await recordPublishedMeetingEvidence(sqlFrom(publication), { newsroomId, articleId: article.rows[0]!.id, draftId: seeded.draftId });
      await publication.query("commit");

      await captureLock;
      assert.equal(captureAcquired, true);
      const artifactB = await insertRevision(sqlFrom(capture), "publish-first");
      await flagPublishedArticlesForTranscriptRevision(sqlFrom(capture), {
        newsroomId, videoId: "publish-first", priorArtifactId: seeded.artifactId, currentArtifactId: artifactB, reason: "hash",
      });
      await capture.query("commit");

      const stored = await setup.query<{ body: string; artifact_id: number; artifact_sha256: string; citation_snapshot: string; n: number }>(
        `select a.body,l.artifact_id,l.artifact_sha256,l.citation_snapshot,
                (select count(*)::int from meeting_article_revision_reviews r where r.article_id=a.id) as n
           from articles a join meeting_article_transcript_links l on l.article_id=a.id
          where a.id=$1`,
        [article.rows[0]!.id],
      );
      assert.equal(stored.rows[0]!.body, "Original published body.");
      assert.equal(stored.rows[0]!.artifact_sha256, "publish-first-hash-a");
      assert.equal(stored.rows[0]!.n, 1);

      await setup.query("begin");
      await flagPublishedArticlesForTranscriptRevision(sqlFrom(setup), {
        newsroomId, videoId: "publish-first", priorArtifactId: seeded.artifactId, currentArtifactId: artifactB, reason: "hash",
      });
      await setup.query("commit");
      const duplicate = await setup.query<{ n: number }>(
        "select count(*)::int as n from meeting_article_revision_reviews where article_id=$1",
        [article.rows[0]!.id],
      );
      assert.equal(duplicate.rows[0]!.n, 1, "reprocessing B must not duplicate review work");

      const [review] = (await setup.query<{ id: number }>(
        "select id from meeting_article_revision_reviews where article_id=$1 and status='pending'",
        [article.rows[0]!.id],
      )).rows;
      assert.ok(review, "the publication-first path must create a resolvable post-publication review");
      await setup.query("begin");
      await resolvePublishedMeetingReview(sqlFrom(setup), {
        newsroomId,
        reviewId: review.id,
        reviewerId: "editor",
        resolution: "still-accurate",
        acceptedArtifactId: artifactB,
        note: "Compared the published evidence with the current B transcript segment.",
        confirmedSegmentIndices: [1],
      });
      await setup.query("commit");

      const [resolved] = (await setup.query<{
        body: string; artifact_id: number; artifact_sha256: string; citation_snapshot: string;
        status: string; accepted_artifact_sha256: string; accepted_citation_snapshot: string;
        resolved_by: string; resolved_at: Date;
      }>(
        `select a.body,l.artifact_id,l.artifact_sha256,l.citation_snapshot,r.status,
                r.accepted_artifact_sha256,r.accepted_citation_snapshot,r.resolved_by,r.resolved_at
           from articles a
           join meeting_article_transcript_links l on l.article_id=a.id
           join meeting_article_revision_reviews r on r.article_id=a.id
          where a.id=$1 and r.id=$2`,
        [article.rows[0]!.id, review.id],
      )).rows;
      assert.equal(resolved!.body, "Original published body.", "post-publication review must not rewrite article text");
      assert.equal(resolved!.artifact_id, stored.rows[0]!.artifact_id, "the published article remains linked to artifact A");
      assert.equal(resolved!.artifact_sha256, stored.rows[0]!.artifact_sha256, "A's published hash remains unchanged");
      assert.equal(resolved!.citation_snapshot, stored.rows[0]!.citation_snapshot, "A's published citations remain unchanged");
      assert.equal(resolved!.status, "verified");
      assert.equal(resolved!.accepted_artifact_sha256, "b".repeat(64));
      assert.equal(resolved!.resolved_by, "editor");
      assert.ok(resolved!.resolved_at);
      assert.deepEqual(JSON.parse(resolved!.accepted_citation_snapshot), [{
        sourceArtifactId: seeded.artifactId,
        sourceSegmentIndex: 1,
        sourceTimestampSeconds: 10,
        sourceCaptionSha256: "publish-first-hash-a",
        acceptedArtifactId: artifactB,
        acceptedArtifactSha256: "b".repeat(64),
        acceptedSegmentIndex: 101,
        acceptedTimestampSeconds: 11,
        acceptedEndSeconds: 15,
        excerpt: "Council delays the plan.",
        captionSha256: "b".repeat(64),
      }], "the accepted snapshot records the exact shifted-index B evidence the editor reviewed");
    } finally {
      if (publication) await publication.query("rollback").catch(() => undefined);
      if (capture) await capture.query("rollback").catch(() => undefined);
      await publication.end();
      await capture.end();
    }
  });

  it("releases the shared fence when publication rolls back after a handled failure", async () => {
    const seeded = await seedMeeting("rollback-release");
    const publication = await connection();
    const capture = await connection();
    try {
      const { lockMeetingRevisionForCapture, lockMeetingsForDraftPublish } = await import("./meeting-revision-lock.ts");
      await publication.query("begin");
      await publication.query("select id from leads where newsroom_id=$1 and id=$2 for update", [newsroomId, seeded.leadId]);
      await lockMeetingsForDraftPublish(sqlFrom(publication), { newsroomId, draftId: seeded.draftId });

      await capture.query("begin");
      let acquired = false;
      const waiting = lockMeetingRevisionForCapture(sqlFrom(capture), { newsroomId, videoId: "rollback-release" })
        .then(() => { acquired = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(acquired, false);
      await publication.query("rollback");
      await Promise.race([
        waiting,
        new Promise((_, reject) => setTimeout(() => reject(new Error("capture never acquired the fence after rollback")), 2_000)),
      ]);
      assert.equal(acquired, true);
      await capture.query("rollback");
    } finally {
      await publication.query("rollback").catch(() => undefined);
      await capture.query("rollback").catch(() => undefined);
      await publication.end();
      await capture.end();
    }
  });
});
