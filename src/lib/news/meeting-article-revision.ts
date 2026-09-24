import type { Sql } from "../db.ts";
import { acceptedSnapshotMatchesCurrent, draftEvidenceSha256 } from "./meeting-draft-revision-review.ts";

export type PublishedMeetingReview = {
  id: number;
  article: { id: number; headline: string; slug: string };
  status: "pending" | "verified" | "correction-required" | "corrected";
  reason: "hash" | "revision-timestamp" | "duration";
  priorArtifact: { id: number; sha256: string };
  currentArtifact: { id: number; sha256: string };
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  acceptedEvidence: {
    artifactSha256: string;
    citations: { segmentIndex: number; timestampSeconds: number; endSeconds: number; excerpt: string; captionSha256: string }[];
  } | null;
  citations: {
    segmentIndex: number;
    oldExcerpt: string | null;
    currentSegmentIndex: number | null;
    currentExcerpt: string | null;
    timestampSeconds: number | null;
    currentTimestampSeconds: number | null;
    currentCaptionSha256: string | null;
  }[];
};

const CURRENT_REVIEW_SEGMENT_TOLERANCE_SECONDS = 30;

type MatchedCurrentSegment = {
  review_id: number;
  source_segment_index: number;
  current_segment_index: number | null;
  current_start_seconds: number | null;
  current_end_seconds: number | null;
  current_excerpt: string | null;
  current_caption_sha256: string | null;
};

/** Find actual B segments near each A citation timestamp; numeric indices can shift across caption revisions. */
async function matchCurrentSegments(
  sql: Sql,
  input: { newsroomId: number; citations: { reviewId: number; segmentIndex: number; timestampSeconds: number }[] },
): Promise<MatchedCurrentSegment[]> {
  if (!input.citations.length) return [];
  return sql.query<MatchedCurrentSegment>(
    `select used.review_id,used.source_segment_index,current.segment_index as current_segment_index,
            current.start_seconds as current_start_seconds,current.end_seconds as current_end_seconds,current.excerpt as current_excerpt,
            current.caption_sha256 as current_caption_sha256
       from unnest($1::int[],$2::int[],$3::numeric[]) as used(review_id,source_segment_index,timestamp_seconds)
       join meeting_article_revision_reviews r on r.id=used.review_id and r.newsroom_id=$4
       left join lateral (
         select s.segment_index,s.start_seconds,s.end_seconds,s.excerpt,s.caption_sha256
           from meeting_transcript_segments s
          where s.artifact_id=r.current_artifact_id
            and abs(s.start_seconds-used.timestamp_seconds) <= $5
          order by abs(s.start_seconds-used.timestamp_seconds),s.segment_index
          limit 1
       ) current on true
      order by used.review_id,used.source_segment_index`,
    [
      input.citations.map((citation) => citation.reviewId),
      input.citations.map((citation) => citation.segmentIndex),
      input.citations.map((citation) => citation.timestampSeconds),
      input.newsroomId,
      CURRENT_REVIEW_SEGMENT_TOLERANCE_SECONDS,
    ],
  );
}

function citationIndices(snapshot: string, artifactId?: number): number[] {
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const indices: number[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object") return [];
      const item = value as { segmentIndex?: unknown; artifactId?: unknown };
      if (typeof item.segmentIndex !== "number" || !Number.isInteger(item.segmentIndex) || item.segmentIndex < 0) return [];
      if (artifactId != null && item.artifactId !== artifactId) return [];
      indices.push(item.segmentIndex);
    }
    return [...new Set(indices)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function listPublishedMeetingReviews(sql: Sql, newsroomId: number): Promise<PublishedMeetingReview[]> {
  const reviews = await sql.query<{
    id: number; article_id: number; headline: string; slug: string; status: PublishedMeetingReview["status"];
    revision_reason: PublishedMeetingReview["reason"]; prior_artifact_id: number; current_artifact_id: number;
    prior_sha256: string; current_sha256: string; citation_snapshot: string; created_at: string;
    resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
    accepted_artifact_id: number | null; accepted_artifact_sha256: string | null; accepted_citation_snapshot: string | null;
  }>(
    `select r.id,r.article_id,a.headline,a.slug,r.status,r.revision_reason,
            r.prior_artifact_id,r.current_artifact_id,
            prior.sha256 as prior_sha256,current.sha256 as current_sha256,
            l.citation_snapshot,r.created_at,r.resolved_at,r.resolved_by,r.resolution_note,
            r.accepted_artifact_id,r.accepted_artifact_sha256,r.accepted_citation_snapshot
       from meeting_article_revision_reviews r
       join meeting_article_transcript_links l on l.id=r.article_link_id
       join articles a on a.id=r.article_id and a.newsroom_id=r.newsroom_id
       join meeting_transcript_artifacts prior on prior.id=r.prior_artifact_id
       join meeting_transcript_artifacts current on current.id=r.current_artifact_id
      where r.newsroom_id=$1
      order by r.created_at desc,r.id desc`,
    [newsroomId],
  );
  if (!reviews.length) return [];
  const citationKeys = reviews.flatMap((row) => citationIndices(row.citation_snapshot, Number(row.prior_artifact_id)).map((segmentIndex) => ({
    reviewId: Number(row.id), artifactId: Number(row.prior_artifact_id), segmentIndex,
  })));
  const artifactIds = [...new Set(citationKeys.map((citation) => citation.artifactId))];
  const sourceIndices = [...new Set(citationKeys.map((citation) => citation.segmentIndex))];
  const segments = artifactIds.length && sourceIndices.length ? await sql.query<{ artifact_id: number; segment_index: number; start_seconds: number; excerpt: string }>(
    `select artifact_id,segment_index,start_seconds,excerpt
       from meeting_transcript_segments
      where artifact_id=any($1::int[]) and segment_index=any($2::int[])
      order by artifact_id,segment_index`,
    [artifactIds, sourceIndices],
  ) : [];
  const byArtifactSegment = new Map(segments.map((row) => [`${row.artifact_id}:${row.segment_index}`, row]));
  const currentMatches = await matchCurrentSegments(sql, {
    newsroomId,
    citations: citationKeys.flatMap((citation) => {
      const old = byArtifactSegment.get(`${citation.artifactId}:${citation.segmentIndex}`);
      return old ? [{ reviewId: citation.reviewId, segmentIndex: citation.segmentIndex, timestampSeconds: Number(old.start_seconds) }] : [];
    }),
  });
  const byReviewSegment = new Map(currentMatches.map((row) => [`${row.review_id}:${row.source_segment_index}`, row]));
  return reviews.map((row) => {
    return {
      id: Number(row.id),
      article: { id: Number(row.article_id), headline: row.headline, slug: row.slug },
      status: row.status,
      reason: row.revision_reason,
      priorArtifact: { id: Number(row.prior_artifact_id), sha256: row.prior_sha256 },
      currentArtifact: { id: Number(row.current_artifact_id), sha256: row.current_sha256 },
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      resolutionNote: row.resolution_note,
      acceptedEvidence: parseAcceptedEvidence(
        row.accepted_artifact_id,
        Number(row.current_artifact_id),
        row.accepted_artifact_sha256,
        row.accepted_citation_snapshot,
      ),
      citations: citationIndices(row.citation_snapshot, Number(row.prior_artifact_id)).map((segmentIndex) => {
        const oldSegment = byArtifactSegment.get(`${row.prior_artifact_id}:${segmentIndex}`);
        const currentSegment = byReviewSegment.get(`${row.id}:${segmentIndex}`);
        return {
          segmentIndex,
          oldExcerpt: oldSegment?.excerpt ?? null,
          currentSegmentIndex: currentSegment?.current_segment_index == null ? null : Number(currentSegment.current_segment_index),
          currentExcerpt: currentSegment?.current_excerpt ?? null,
          timestampSeconds: oldSegment == null ? null : Number(oldSegment.start_seconds),
          currentTimestampSeconds: currentSegment?.current_start_seconds == null ? null : Number(currentSegment.current_start_seconds),
          currentCaptionSha256: currentSegment?.current_caption_sha256 ?? null,
        };
      }),
    };
  });
}

function parseAcceptedEvidence(
  acceptedArtifactId: number | null,
  currentArtifactId: number,
  artifactSha256: string | null,
  snapshot: string | null,
): PublishedMeetingReview["acceptedEvidence"] {
  if (acceptedArtifactId == null || Number(acceptedArtifactId) !== currentArtifactId
    || !artifactSha256 || !/^[a-f\d]{64}$/i.test(artifactSha256) || !snapshot) return null;
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const citations = parsed.map((value) => {
      if (!value || typeof value !== "object") return null;
      const citation = value as Record<string, unknown>;
      if (!Number.isInteger(citation.acceptedSegmentIndex) || Number(citation.acceptedSegmentIndex) < 0
        || typeof citation.acceptedTimestampSeconds !== "number" || !Number.isFinite(citation.acceptedTimestampSeconds) || citation.acceptedTimestampSeconds < 0
        || typeof citation.acceptedEndSeconds !== "number" || !Number.isFinite(citation.acceptedEndSeconds) || citation.acceptedEndSeconds < citation.acceptedTimestampSeconds
        || typeof citation.excerpt !== "string" || !citation.excerpt.trim()
        || typeof citation.captionSha256 !== "string" || !/^[a-f\d]{64}$/i.test(citation.captionSha256)
        || citation.acceptedArtifactSha256 !== artifactSha256) return null;
      return {
        segmentIndex: Number(citation.acceptedSegmentIndex),
        timestampSeconds: citation.acceptedTimestampSeconds,
        endSeconds: citation.acceptedEndSeconds,
        excerpt: citation.excerpt,
        captionSha256: citation.captionSha256,
      };
    });
    if (citations.some((citation) => citation == null)) return null;
    return { artifactSha256, citations: citations as NonNullable<(typeof citations)[number]>[] };
  } catch {
    return null;
  }
}

/** Freeze the exact tape evidence used by an article in the publication transaction. */
export async function recordPublishedMeetingEvidence(
  sql: Sql,
  input: { newsroomId: number; articleId: number; draftId: number },
): Promise<{ recorded: number }> {
  const [draftLink] = await sql.query<{
    newsroom_id: number; link_id: number; artifact_id: number; citation_snapshot: string;
    video_id: string; sha256: string; current_artifact_id: number | null; current_sha256: string | null;
    linked_integrity_status: string; current_integrity_status: string | null;
      draft_id: number; id: number; headline: string; dek: string; topic: string; body: string;
    source_urls: string; provenance_json: string; found_note: string; unanswered: string; research_json: string;
    accepted_artifact_id: number | null; accepted_artifact_sha256: string | null;
    accepted_citation_snapshot: string | null; draft_evidence_sha256: string | null;
    reviewed_by: string | null; resolution_note: string | null;
  }>(
    `select l.newsroom_id,l.id as link_id,l.artifact_id,l.citation_snapshot,a.video_id,a.sha256,
            a.integrity_status as linked_integrity_status,current.id as current_artifact_id,current.sha256 as current_sha256,
              current.integrity_status as current_integrity_status,d.id as draft_id,d.id,d.headline,d.dek,d.topic,d.body,
            d.source_urls,d.provenance_json,d.found_note,d.unanswered,d.research_json,
            accepted.accepted_artifact_id,accepted.accepted_artifact_sha256,
            accepted.accepted_citation_snapshot,accepted.draft_evidence_sha256,accepted.reviewed_by,accepted.resolution_note
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts a on a.id=l.artifact_id and a.newsroom_id=l.newsroom_id
       join drafts d on d.id=l.draft_id and d.newsroom_id=l.newsroom_id
       left join lateral (
         select id,sha256,integrity_status from meeting_transcript_artifacts
          where newsroom_id=l.newsroom_id and video_id=a.video_id and artifact_type='transcript'
          order by captured_at desc,id desc limit 1
       ) current on true
       left join lateral (
         select accepted_artifact_id,accepted_artifact_sha256,accepted_citation_snapshot,draft_evidence_sha256,reviewed_by,resolution_note
           from meeting_draft_transcript_revision_reviews
          where newsroom_id=l.newsroom_id and draft_id=l.draft_id and draft_link_id=l.id
            and accepted_artifact_id=current.id and accepted_artifact_sha256=current.sha256
          order by reviewed_at desc,id desc limit 1
       ) accepted on true
      where l.newsroom_id=$1 and l.draft_id=$2 and l.is_current=true
      order by l.id limit 1`,
    [input.newsroomId,input.draftId],
  );
  if (draftLink && (draftLink.linked_integrity_status !== "valid"
    || !draftLink.current_artifact_id || draftLink.current_integrity_status !== "valid")) {
    throw new Error("The draft's linked or current transcript failed its integrity check.");
  }
  if (draftLink && (Number(draftLink.current_artifact_id) !== Number(draftLink.artifact_id)
    || draftLink.current_sha256 !== draftLink.sha256) && draftLink.accepted_artifact_id == null) {
    throw new Error("The recording changed after this draft was written. Review its current citations before publishing.");
  }
  if (draftLink?.accepted_artifact_id != null) {
    const expected = citationIndices(draftLink.citation_snapshot, Number(draftLink.artifact_id));
    let source: { artifactId: number; segmentIndex: number; captionSha256: string }[] = [];
    try {
      const parsed = JSON.parse(draftLink.citation_snapshot) as unknown;
      if (Array.isArray(parsed)) source = parsed as typeof source;
    } catch { source = []; }
    const accepted = acceptedSnapshotMatchesCurrent({
      acceptedArtifactId: Number(draftLink.current_artifact_id),
      acceptedArtifactSha256: String(draftLink.current_sha256 ?? ""),
      acceptedSnapshot: draftLink.accepted_citation_snapshot ?? "",
      expected: source,
    });
    if (!expected.length || !accepted || !draftLink.reviewed_by?.trim() || !draftLink.resolution_note?.trim()
      || draftLink.draft_evidence_sha256 !== draftEvidenceSha256(draftLink)) {
      throw new Error("The draft's transcript citation review no longer matches the current recording.");
    }
    const acceptedRows = JSON.parse(draftLink.accepted_citation_snapshot!) as {
      artifactId: number; segmentIndex: number; captionSha256: string;
      acceptedTimestampSeconds: number; acceptedEndSeconds: number; excerpt: string;
    }[];
    const segments = await sql.query<{ segment_index: number; caption_sha256: string; start_seconds: number; end_seconds: number; excerpt: string }>(
      `select segment_index,caption_sha256,start_seconds,end_seconds,excerpt from meeting_transcript_segments
        where artifact_id=$1 and segment_index=any($2::int[])`,
      [Number(draftLink.current_artifact_id), acceptedRows.map((citation) => citation.segmentIndex)],
    );
    const segmentByIndex = new Map(segments.map((segment) => [Number(segment.segment_index),segment]));
    if (segments.length !== acceptedRows.length || acceptedRows.some((citation) =>
      citation.artifactId !== Number(draftLink.current_artifact_id)
      || segmentByIndex.get(citation.segmentIndex)?.caption_sha256 !== citation.captionSha256
      || Number(segmentByIndex.get(citation.segmentIndex)?.start_seconds) !== citation.acceptedTimestampSeconds
      || Number(segmentByIndex.get(citation.segmentIndex)?.end_seconds) !== citation.acceptedEndSeconds
      || segmentByIndex.get(citation.segmentIndex)?.excerpt !== citation.excerpt)) {
      throw new Error("The accepted transcript citation snapshot no longer matches its immutable artifact.");
    }
    const rows = await sql.query<{ article_id: number }>(
      `insert into meeting_article_transcript_links
         (newsroom_id,article_id,origin_draft_id,artifact_id,artifact_sha256,video_id,citation_snapshot)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (newsroom_id,article_id,artifact_id) do nothing returning article_id`,
      [input.newsroomId,input.articleId,input.draftId,draftLink.current_artifact_id,
        draftLink.current_sha256,draftLink.video_id,draftLink.accepted_citation_snapshot],
    );
    return { recorded: rows.length };
  }
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
  let acceptedEvidence: { artifactSha256: string; citationSnapshot: string } | null = null;
  if (input.resolution === "still-accurate") {
    const [review] = await sql.query<{
      id: number; prior_artifact_id: number; current_artifact_id: number; current_sha256: string | null; citation_snapshot: string;
    }>(
      `select r.id,r.prior_artifact_id,r.current_artifact_id,current.sha256 as current_sha256,l.citation_snapshot
         from meeting_article_revision_reviews r
         join meeting_article_transcript_links l on l.id=r.article_link_id
         left join meeting_transcript_artifacts current on current.id=r.current_artifact_id and current.newsroom_id=r.newsroom_id
        where r.newsroom_id=$1 and r.id=$2 and r.status='pending'
        for update of r`,
      [input.newsroomId, input.reviewId],
    );
    if (!review || Number(review.current_artifact_id) !== input.acceptedArtifactId) {
      throw new Error("Transcript revision review is no longer pending or does not match this artifact.");
    }
    const expected = citationIndices(review.citation_snapshot, Number(review.prior_artifact_id));
    if (!expected.length) throw new Error("The published article's citation snapshot is missing or malformed.");
    const confirmed = [...new Set(input.confirmedSegmentIndices.map(Number))].sort((a, b) => a - b);
    if (JSON.stringify(confirmed) !== JSON.stringify(expected)) {
      throw new Error("Confirm every affected citation against the current transcript before marking it still accurate.");
    }
    const artifactSha256 = review.current_sha256;
    if (!artifactSha256 || !/^[a-f\d]{64}$/i.test(artifactSha256)) {
      throw new Error("The current transcript artifact hash is missing or invalid.");
    }
    const priorSegments = await sql.query<{
      segment_index: number;
      start_seconds: number;
      caption_sha256: string;
    }>(
      `select segment_index,start_seconds,caption_sha256 from meeting_transcript_segments
        where artifact_id=$1 and segment_index=any($2::int[])
        order by segment_index`,
      [review.prior_artifact_id, expected],
    );
    if (priorSegments.length !== expected.length) {
      throw new Error("The published transcript is missing one or more cited segments; the B comparison cannot be verified.");
    }
    const matches = await matchCurrentSegments(sql, {
      newsroomId: input.newsroomId,
      citations: priorSegments.map((row) => ({
        reviewId: input.reviewId,
        segmentIndex: Number(row.segment_index),
        timestampSeconds: Number(row.start_seconds),
      })),
    });
    const matchBySourceSegment = new Map(matches.map((row) => [Number(row.source_segment_index), row]));
    if (matches.length !== expected.length || expected.some((segmentIndex) => {
      const match = matchBySourceSegment.get(segmentIndex);
      return match?.current_segment_index == null || match.current_start_seconds == null
        || match.current_end_seconds == null || !match.current_excerpt?.trim() || !match.current_caption_sha256
        || !/^[a-f\d]{64}$/i.test(match.current_caption_sha256);
    })) {
      throw new Error("One or more citations has no current transcript segment near its original timestamp; this review cannot be marked still accurate.");
    }
    acceptedEvidence = {
      artifactSha256,
      citationSnapshot: JSON.stringify(priorSegments.map((prior) => {
        const current = matchBySourceSegment.get(Number(prior.segment_index))!;
        return {
          sourceArtifactId: Number(review.prior_artifact_id),
          sourceSegmentIndex: Number(prior.segment_index),
          sourceTimestampSeconds: Number(prior.start_seconds),
          sourceCaptionSha256: prior.caption_sha256,
          acceptedArtifactId: input.acceptedArtifactId,
          acceptedArtifactSha256: artifactSha256,
          acceptedSegmentIndex: Number(current.current_segment_index),
          acceptedTimestampSeconds: Number(current.current_start_seconds),
          acceptedEndSeconds: Number(current.current_end_seconds),
          excerpt: current.current_excerpt,
          captionSha256: current.current_caption_sha256,
        };
      })),
    };
  }
  const rows = await sql.query<{ id: number }>(
    `update meeting_article_revision_reviews
        set status='${status}', accepted_artifact_id=$1, resolved_by=$2,
            resolution_note=$3, resolved_at=now(), updated_at=now(),
            accepted_artifact_sha256=$6, accepted_citation_snapshot=$7
      where newsroom_id=$4 and id=$5 and status='pending'
        and current_artifact_id=$1
     returning id`,
    [input.acceptedArtifactId, input.reviewerId, input.note, input.newsroomId, input.reviewId,
      acceptedEvidence?.artifactSha256 ?? null, acceptedEvidence?.citationSnapshot ?? null],
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
