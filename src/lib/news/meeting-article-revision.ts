import type { Sql } from "../db.ts";

export type PublishedMeetingReview = {
  id: number;
  article: { id: number; headline: string; slug: string };
  status: "pending" | "verified" | "correction-required" | "corrected";
  reason: "hash" | "revision-timestamp" | "duration";
  priorArtifact: { id: number; sha256: string };
  currentArtifact: { id: number; sha256: string };
  createdAt: string;
  citations: { segmentIndex: number; oldExcerpt: string | null; currentExcerpt: string | null; timestampSeconds: number | null }[];
};

export async function listPublishedMeetingReviews(sql: Sql, newsroomId: number): Promise<PublishedMeetingReview[]> {
  const reviews = await sql.query<{
    id: number; article_id: number; headline: string; slug: string; status: PublishedMeetingReview["status"];
    revision_reason: PublishedMeetingReview["reason"]; prior_artifact_id: number; current_artifact_id: number;
    prior_sha256: string; current_sha256: string; citation_snapshot: string; created_at: string;
  }>(
    `select r.id,r.article_id,a.headline,a.slug,r.status,r.revision_reason,
            r.prior_artifact_id,r.current_artifact_id,
            prior.sha256 as prior_sha256,current.sha256 as current_sha256,
            l.citation_snapshot,r.created_at
       from meeting_article_revision_reviews r
       join meeting_article_transcript_links l on l.id=r.article_link_id
       join articles a on a.id=r.article_id and a.newsroom_id=r.newsroom_id
       join meeting_transcript_artifacts prior on prior.id=r.prior_artifact_id
       join meeting_transcript_artifacts current on current.id=r.current_artifact_id
      where r.newsroom_id=$1 and r.status in ('pending','correction-required')
      order by r.created_at desc,r.id desc`,
    [newsroomId],
  );
  if (!reviews.length) return [];
  const artifactIds = [...new Set(reviews.flatMap((row) => [Number(row.prior_artifact_id), Number(row.current_artifact_id)]))];
  const segments = await sql.query<{ artifact_id: number; segment_index: number; start_seconds: number; excerpt: string }>(
    `select artifact_id,segment_index,start_seconds,excerpt
       from meeting_transcript_segments
      where artifact_id=any($1::int[])
      order by artifact_id,segment_index`,
    [artifactIds],
  );
  const byArtifactSegment = new Map(segments.map((row) => [`${row.artifact_id}:${row.segment_index}`, row]));
  return reviews.map((row) => {
    let indices: number[] = [];
    try {
      const parsed = JSON.parse(row.citation_snapshot) as { segmentIndex?: unknown }[];
      if (Array.isArray(parsed)) indices = parsed.map((item) => Number(item.segmentIndex)).filter(Number.isInteger);
    } catch {
      indices = [];
    }
    return {
      id: Number(row.id),
      article: { id: Number(row.article_id), headline: row.headline, slug: row.slug },
      status: row.status,
      reason: row.revision_reason,
      priorArtifact: { id: Number(row.prior_artifact_id), sha256: row.prior_sha256 },
      currentArtifact: { id: Number(row.current_artifact_id), sha256: row.current_sha256 },
      createdAt: row.created_at,
      citations: indices.map((segmentIndex) => {
        const oldSegment = byArtifactSegment.get(`${row.prior_artifact_id}:${segmentIndex}`);
        const currentSegment = byArtifactSegment.get(`${row.current_artifact_id}:${segmentIndex}`);
        return {
          segmentIndex,
          oldExcerpt: oldSegment?.excerpt ?? null,
          currentExcerpt: currentSegment?.excerpt ?? null,
          timestampSeconds: oldSegment == null ? null : Number(oldSegment.start_seconds),
        };
      }),
    };
  });
}

/** Freeze the exact tape evidence used by an article in the publication transaction. */
export async function recordPublishedMeetingEvidence(
  sql: Sql,
  input: { newsroomId: number; articleId: number; draftId: number },
): Promise<{ recorded: number }> {
  const rows = await sql.query<{ article_id: number }>(
    `insert into meeting_article_transcript_links
       (newsroom_id,article_id,origin_draft_id,artifact_id,artifact_sha256,video_id,citation_snapshot)
      select l.newsroom_id,$2,l.draft_id,l.artifact_id,a.sha256,a.video_id,l.citation_snapshot
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts a on a.id=l.artifact_id
       where l.newsroom_id=$1 and l.draft_id=$3 and l.is_current=true
     on conflict (newsroom_id,article_id,artifact_id) do nothing
     returning article_id`,
    [input.newsroomId, input.articleId, input.draftId],
  );
  return { recorded: rows.length };
}

/** Create durable, idempotent editor work when B supersedes a published A. */
export async function flagPublishedArticlesForTranscriptRevision(
  sql: Sql,
  input: {
    newsroomId: number;
    videoId: string;
    priorArtifactId: number;
    currentArtifactId: number;
    reason: "hash" | "revision-timestamp" | "duration";
  },
): Promise<{ created: number }> {
  const rows = await sql.query<{ id: number }>(
    `insert into meeting_article_revision_reviews
       (newsroom_id,article_link_id,article_id,video_id,prior_artifact_id,current_artifact_id,revision_reason,status)
     select l.newsroom_id,l.id,l.article_id,$2,$3,$4,$5,'pending'
       from meeting_article_transcript_links l
      where l.newsroom_id=$1 and l.video_id=$2 and l.artifact_id=$3
     on conflict (article_link_id,current_artifact_id) do nothing
     returning id`,
    [input.newsroomId, input.videoId, input.priorArtifactId, input.currentArtifactId, input.reason],
  );
  return { created: rows.length };
}

export async function resolvePublishedMeetingReview(
  sql: Sql,
  input: {
    newsroomId: number;
    reviewId: number;
    reviewerId: string;
    resolution: "still-accurate" | "correction-required";
    acceptedArtifactId: number;
    note: string;
    confirmedSegmentIndices: number[];
  },
): Promise<void> {
  const status = input.resolution === "still-accurate" ? "verified" : "correction-required";
  if (input.resolution === "still-accurate") {
    const [review] = await sql.query<{ id: number; current_artifact_id: number; citation_snapshot: string }>(
      `select r.id,r.current_artifact_id,l.citation_snapshot
         from meeting_article_revision_reviews r
         join meeting_article_transcript_links l on l.id=r.article_link_id
        where r.newsroom_id=$1 and r.id=$2 and r.status='pending'
        for update`,
      [input.newsroomId, input.reviewId],
    );
    if (!review || Number(review.current_artifact_id) !== input.acceptedArtifactId) {
      throw new Error("Transcript revision review is no longer pending or does not match this artifact.");
    }
    let expected: number[] = [];
    try {
      const parsed = JSON.parse(review.citation_snapshot) as { segmentIndex?: unknown }[];
      if (!Array.isArray(parsed)) throw new Error("not an array");
      expected = [...new Set(parsed.map((row) => Number(row.segmentIndex)))].sort((a, b) => a - b);
      if (!expected.length || expected.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("invalid segments");
    } catch {
      throw new Error("The published article's citation snapshot is missing or malformed.");
    }
    const confirmed = [...new Set(input.confirmedSegmentIndices.map(Number))].sort((a, b) => a - b);
    if (JSON.stringify(confirmed) !== JSON.stringify(expected)) {
      throw new Error("Confirm every affected citation against the current transcript before marking it still accurate.");
    }
  }
  const rows = await sql.query<{ id: number }>(
    `update meeting_article_revision_reviews
        set status='${status}', accepted_artifact_id=$1, resolved_by=$2,
            resolution_note=$3, resolved_at=now(), updated_at=now()
      where newsroom_id=$4 and id=$5 and status='pending'
        and current_artifact_id=$1
      returning id`,
    [input.acceptedArtifactId, input.reviewerId, input.note, input.newsroomId, input.reviewId],
  );
  if (!rows.length) throw new Error("Transcript revision review is no longer pending or does not match this artifact.");
}

export async function completePublishedMeetingReviewWithCorrection(
  sql: Sql,
  input: { newsroomId: number; reviewId: number; articleId: number; correctionId: number; reviewerId: string },
): Promise<void> {
  const review = await sql.query<{ id: number }>(
    `select id from meeting_article_revision_reviews
      where newsroom_id=$1 and id=$2 and article_id=$3 and status='correction-required'
      for update`,
    [input.newsroomId, input.reviewId, input.articleId],
  );
  if (!review.length) throw new Error("That transcript review is not waiting for this story's correction.");
  const updated = await sql.query<{ id: number }>(
    `update meeting_article_revision_reviews
        set status='corrected', correction_id=$1, resolved_by=$2,
            resolved_at=now(), updated_at=now()
      where newsroom_id=$3 and id=$4 and status='correction-required'
      returning id`,
    [input.correctionId, input.reviewerId, input.newsroomId, input.reviewId],
  );
  if (!updated.length) throw new Error("The transcript review changed before the correction was saved.");
}
