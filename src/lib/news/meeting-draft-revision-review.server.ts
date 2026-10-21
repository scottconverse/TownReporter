import type { Sql } from "../db.ts";
import { createHash } from "node:crypto";
import { evidenceReviewToken } from "./draft-evidence.ts";
import { lockMeetingsForDraftPublish } from "./meeting-revision-lock.ts";

const MATCH_TOLERANCE_SECONDS = 30;

export function draftEvidenceSha256(draft: Parameters<typeof evidenceReviewToken>[0]): string {
  return createHash("sha256").update(evidenceReviewToken(draft)).digest("hex");
}

type Citation = { artifactId: number; segmentIndex: number; captionSha256: string };
type AcceptedCitation = {
  artifactId: number;
  segmentIndex: number;
  captionSha256: string;
  sourceArtifactId: number;
  sourceSegmentIndex: number;
  sourceTimestampSeconds: number;
  sourceCaptionSha256: string;
  acceptedArtifactId: number;
  acceptedArtifactSha256: string;
  acceptedSegmentIndex: number;
  acceptedTimestampSeconds: number;
  acceptedEndSeconds: number;
  excerpt: string;
};

function parseSnapshot(raw: string, artifactId: number, artifactSha256: string): Citation[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("The saved draft citation snapshot is malformed."); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("The saved draft has no complete citation snapshot to verify.");
  const rows: Citation[] = [];
  const seen = new Set<number>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") throw new Error("The saved draft citation snapshot is malformed.");
    const row = value as Partial<Citation>;
    const segmentIndex = Number(row.segmentIndex);
    if (Number(row.artifactId) !== artifactId || !Number.isInteger(segmentIndex) || segmentIndex < 0
      || seen.has(segmentIndex) || typeof row.captionSha256 !== "string"
      || row.captionSha256.toLowerCase() !== artifactSha256.toLowerCase()) {
      throw new Error("The saved draft citation snapshot does not match its original transcript.");
    }
    seen.add(segmentIndex);
    rows.push({ artifactId, segmentIndex, captionSha256: row.captionSha256 });
  }
  return rows;
}

/**
 * Save an editor's citation-only A→B review without rewriting the draft or its
 * original A link. The caller must use a transaction; this function acquires
 * the same lead→meeting locks as publication before comparing B.
 */
export async function recordDraftTranscriptRevisionReview(
  sql: Sql,
  input: {
    newsroomId: number;
    leadId: number;
    draftId: number;
    reviewerId: string;
    expectedEvidenceToken: string;
    acceptedArtifactId: number;
    confirmedSegmentIndexes: number[];
    note: string;
  },
): Promise<{ reviewId: number; acceptedArtifactSha256: string; reviewedAt: string }> {
  const note = input.note.trim();
  if (!note) throw new Error("Record what you compared before saving the citation review.");

  const lead = await sql.query<{ id: number }>(
    "select id from leads where newsroom_id=$1 and id=$2 for update",
    [input.newsroomId, input.leadId],
  );
  if (!lead.length) throw new Error("That story is not on this newsroom's desk.");
  const draftRows = await sql.query<{
    id: number; lead_id: number; headline: string; dek: string; topic: string; body: string;
    source_urls: string; provenance_json: string; found_note: string; unanswered: string; research_json: string;
  }>(
    `select id,lead_id,headline,dek,topic,body,source_urls,provenance_json,found_note,unanswered,research_json
       from drafts where newsroom_id=$1 and lead_id=$2 and id=$3 for update`,
    [input.newsroomId, input.leadId, input.draftId],
  );
  const draft = draftRows[0];
  if (!draft) throw new Error("The saved draft no longer exists.");
  if (evidenceReviewToken(draft) !== input.expectedEvidenceToken) {
    throw new Error("The draft changed while you were reviewing it. Reload and compare its current citations.");
  }

  await lockMeetingsForDraftPublish(sql, { newsroomId: input.newsroomId, draftId: input.draftId });
  const rows = await sql.query<{
    link_id: number; artifact_id: number; citation_snapshot: string; revision_notice: string | null;
    prior_sha256: string; prior_integrity: string; video_id: string;
    current_artifact_id: number | null; current_sha256: string | null; current_integrity: string | null;
  }>(
    `select l.id as link_id,l.artifact_id,l.citation_snapshot,l.revision_notice,
            prior.sha256 as prior_sha256,prior.integrity_status as prior_integrity,prior.video_id,
            current.id as current_artifact_id,current.sha256 as current_sha256,current.integrity_status as current_integrity
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts prior on prior.id=l.artifact_id and prior.newsroom_id=l.newsroom_id
       left join lateral (
         select id,sha256,integrity_status from meeting_transcript_artifacts
          where newsroom_id=l.newsroom_id and video_id=prior.video_id and artifact_type='transcript'
          order by captured_at desc,id desc limit 1
       ) current on true
      where l.newsroom_id=$1 and l.draft_id=$2 and l.is_current=true
      order by l.id limit 1
      for update of l`,
    [input.newsroomId, input.draftId],
  );
  const link = rows[0];
  if (!link) throw new Error("This draft has no current transcript link to review.");
  if (!link.current_artifact_id || !link.current_sha256 || !/^[a-f\d]{64}$/i.test(link.current_sha256)
    || link.current_integrity !== "valid") {
    throw new Error("The current transcript is missing or failed its integrity check.");
  }
  if (Number(link.current_artifact_id) !== input.acceptedArtifactId) {
    throw new Error("A newer transcript arrived while you were reviewing. Reload its comparison before confirming.");
  }
  if (Number(link.artifact_id) === Number(link.current_artifact_id)
    && link.prior_sha256 === link.current_sha256 && !link.revision_notice) {
    throw new Error("There is no transcript revision to review yet.");
  }
  if (link.prior_integrity !== "valid" || !/^[a-f\d]{64}$/i.test(link.prior_sha256)) {
    throw new Error("The original transcript is missing or failed its integrity check.");
  }

  const citations = parseSnapshot(link.citation_snapshot, Number(link.artifact_id), link.prior_sha256);
  const expectedIndices = citations.map((citation) => citation.segmentIndex).sort((a, b) => a - b);
  const confirmed = [...new Set(input.confirmedSegmentIndexes.map(Number))].sort((a, b) => a - b);
  if (JSON.stringify(confirmed) !== JSON.stringify(expectedIndices)) {
    throw new Error("Compare and confirm every citation against the current transcript before saving.");
  }

  const priorRows = await sql.query<{
    segment_index: number; start_seconds: number; caption_sha256: string;
  }>(
    `select segment_index,start_seconds,caption_sha256 from meeting_transcript_segments
      where artifact_id=$1 and segment_index=any($2::int[]) order by segment_index`,
    [link.artifact_id, expectedIndices],
  );
  const priorByIndex = new Map(priorRows.map((row) => [Number(row.segment_index), row]));
  if (priorRows.length !== citations.length || citations.some((citation) =>
    priorByIndex.get(citation.segmentIndex)?.caption_sha256 !== citation.captionSha256)) {
    throw new Error("One or more original cited segments no longer matches artifact A.");
  }

  const currentRows = await sql.query<{
    source_segment_index: number; segment_index: number | null; start_seconds: number | null;
    end_seconds: number | null; excerpt: string | null; caption_sha256: string | null;
  }>(
    `select prior.segment_index as source_segment_index,current.segment_index,current.start_seconds,
            current.end_seconds,current.excerpt,current.caption_sha256
       from unnest($2::int[],$3::numeric[]) as prior(segment_index,timestamp_seconds)
       left join lateral (
         select segment_index,start_seconds,end_seconds,excerpt,caption_sha256
           from meeting_transcript_segments
          where artifact_id=$1 and abs(start_seconds-prior.timestamp_seconds)<=$4
          order by abs(start_seconds-prior.timestamp_seconds),segment_index limit 1
       ) current on true
      order by prior.segment_index`,
    [Number(link.current_artifact_id), expectedIndices,
      expectedIndices.map((index) => Number(priorByIndex.get(index)!.start_seconds)),
      MATCH_TOLERANCE_SECONDS],
  );
  const currentBySource = new Map(currentRows.map((row) => [Number(row.source_segment_index), row]));
  const accepted: AcceptedCitation[] = citations.map((citation) => {
    const prior = priorByIndex.get(citation.segmentIndex)!;
    const current = currentBySource.get(citation.segmentIndex);
    if (!current || current.segment_index == null || current.start_seconds == null || current.end_seconds == null
      || !current.excerpt?.trim() || !current.caption_sha256 || !/^[a-f\d]{64}$/i.test(current.caption_sha256)) {
      throw new Error(`Citation segment ${citation.segmentIndex} has no valid match in artifact B. Redraft or correct the story instead.`);
    }
    return {
      artifactId: Number(link.current_artifact_id),
      segmentIndex: Number(current.segment_index),
      captionSha256: current.caption_sha256,
      sourceArtifactId: Number(link.artifact_id),
      sourceSegmentIndex: citation.segmentIndex,
      sourceTimestampSeconds: Number(prior.start_seconds),
      sourceCaptionSha256: citation.captionSha256,
      acceptedArtifactId: Number(link.current_artifact_id),
      acceptedArtifactSha256: link.current_sha256!,
      acceptedSegmentIndex: Number(current.segment_index),
      acceptedTimestampSeconds: Number(current.start_seconds),
      acceptedEndSeconds: Number(current.end_seconds),
      excerpt: current.excerpt,
    };
  });

  const inserted = await sql.query<{ id: number; reviewed_at: string }>(
    `insert into meeting_draft_transcript_revision_reviews
      (newsroom_id,draft_id,draft_link_id,prior_artifact_id,accepted_artifact_id,
        lead_id,draft_headline,prior_artifact_sha256,accepted_artifact_sha256,prior_citation_snapshot,
        accepted_citation_snapshot,draft_evidence_sha256,reviewed_by,resolution_note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     returning id,reviewed_at`,
    [input.newsroomId,input.draftId,link.link_id,link.artifact_id,link.current_artifact_id,
      input.leadId,draft.headline,link.prior_sha256,link.current_sha256,link.citation_snapshot,JSON.stringify(accepted),
      draftEvidenceSha256(draft),input.reviewerId,note],
  );
  if (!inserted[0]) throw new Error("The citation review could not be saved.");
  return {
    reviewId: Number(inserted[0].id),
    acceptedArtifactSha256: link.current_sha256,
    reviewedAt: inserted[0].reviewed_at,
  };
}

export function acceptedSnapshotMatchesCurrent(input: {
  acceptedArtifactId: number; acceptedArtifactSha256: string; acceptedSnapshot: string;
  expected: Citation[];
}): boolean {
  try {
    const parsed = JSON.parse(input.acceptedSnapshot) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== input.expected.length) return false;
    const accepted = parsed as AcceptedCitation[];
    const bySource = new Map(accepted.map((row) => [row.sourceSegmentIndex, row]));
    if (bySource.size !== accepted.length) return false;
    return input.expected.every((citation) => {
      const row = bySource.get(citation.segmentIndex);
      return Boolean(row)
        && row!.artifactId === input.acceptedArtifactId
        && row!.segmentIndex === row!.acceptedSegmentIndex
        && row!.sourceArtifactId === citation.artifactId
        && row!.sourceCaptionSha256 === citation.captionSha256
        && row!.acceptedArtifactId === input.acceptedArtifactId
        && row!.acceptedArtifactSha256 === input.acceptedArtifactSha256
        && Number.isInteger(row!.acceptedSegmentIndex) && row!.acceptedSegmentIndex >= 0
        && Number.isFinite(row!.acceptedTimestampSeconds) && row!.acceptedTimestampSeconds >= 0
        && Number.isFinite(row!.acceptedEndSeconds) && row!.acceptedEndSeconds >= row!.acceptedTimestampSeconds
        && Boolean(row!.excerpt?.trim()) && /^[a-f\d]{64}$/i.test(row!.captionSha256);
    });
  } catch { return false; }
}
