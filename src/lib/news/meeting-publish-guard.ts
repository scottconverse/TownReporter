import type { Sql } from "../db.ts";
import { acceptedSnapshotMatchesCurrent, draftEvidenceSha256 } from "./meeting-draft-revision-review.ts";

/**
 * Whether a meeting draft can still be published against its tape.
 *
 * A meeting draft cites specific moments in a recording. If the recording was
 * revised after the draft was written, the quoted words may no longer be there,
 * and publishing would print a claim about a tape that no longer says it. That is
 * the one failure this whole feature exists to make impossible, so publication is
 * blocked until the editor has seen the change.
 *
 * The check compares the caption hash each citation recorded against the artifact
 * the transcript actually is now. It is deliberately not a re-read of the
 * transcript text: a hash comparison is the same fact the revision machinery
 * already uses, so the guard and the notice cannot disagree about whether the tape
 * moved.
 */
export type StaleCitation = {
  artifactId: number | null;
  segmentIndex: number;
  recorded: string;
  current: string;
  reason:
    | "missing-draft"
    | "missing-link"
    | "malformed-snapshot"
    | "invalid-linked-artifact"
    | "missing-current-artifact"
    | "invalid-current-artifact"
    | "invalid-citation-segment"
    | "revised-artifact";
};

type GuardRow = {
  draft_id: number;
  id?: number;
  headline?: string; dek?: string; topic?: string; body?: string;
  source_urls?: string; provenance_json?: string; found_note?: string; unanswered?: string;
  research_json: string | null;
  link_id: number | null;
  artifact_id: number | null;
  citation_snapshot: string | null;
  revision_notice: string | null;
  video_id: string | null;
  linked_sha256: string | null;
  linked_integrity_status: string | null;
  current_artifact_id: number | null;
  current_sha256: string | null;
  current_integrity_status: string | null;
  is_current?: boolean | null;
};

type SnapshotCitation = {
  artifactId: number;
  segmentIndex: number;
  captionSha256: string;
};

function draftClaimsMeetingEvidence(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { meetingEvidence?: { used?: unknown } };
    return parsed.meetingEvidence?.used === true;
  } catch {
    // Damaged provenance cannot establish that a draft used no meeting tape.
    // A missing link must therefore fail closed until the editor repairs it.
    return true;
  }
}

function citationSnapshot(raw: string | null, artifactId: number): SnapshotCitation[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const citations: SnapshotCitation[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object") return null;
      const row = value as Partial<SnapshotCitation>;
      if (
        Number(row.artifactId) !== artifactId ||
        !Number.isInteger(Number(row.segmentIndex)) ||
        Number(row.segmentIndex) < 0 ||
        typeof row.captionSha256 !== "string" ||
        !row.captionSha256.trim()
      ) return null;
      citations.push({
        artifactId,
        segmentIndex: Number(row.segmentIndex),
        captionSha256: row.captionSha256,
      });
    }
    return citations;
  } catch {
    return null;
  }
}

export async function staleMeetingCitations(
  sql: Sql,
  input: {
    newsroomId: number;
    draftId: number;
    /** @deprecated Lead candidates are deliberately ignored; the draft snapshot is authoritative. */
    citations?: { segmentIndex: number; captionSha256: string }[];
  },
): Promise<StaleCitation[]> {
  const rows = await sql.query<GuardRow>(
    `select d.id as draft_id,d.id,d.headline,d.dek,d.topic,d.body,d.source_urls,d.provenance_json,d.found_note,d.unanswered,d.research_json,
            l.id as link_id,l.artifact_id, l.citation_snapshot, l.revision_notice,
            linked.video_id, linked.sha256 as linked_sha256, linked.integrity_status as linked_integrity_status,
            (select current.id
               from meeting_transcript_artifacts current
              where current.newsroom_id=d.newsroom_id
                and current.video_id=linked.video_id
                and current.artifact_type='transcript'
              order by current.captured_at desc,current.id desc limit 1) as current_artifact_id,
            (select current.sha256
               from meeting_transcript_artifacts current
              where current.newsroom_id=d.newsroom_id
                and current.video_id=linked.video_id
                and current.artifact_type='transcript'
              order by current.captured_at desc,current.id desc limit 1) as current_sha256,
            (select current.integrity_status
               from meeting_transcript_artifacts current
              where current.newsroom_id=d.newsroom_id
                and current.video_id=linked.video_id
                and current.artifact_type='transcript'
              order by current.captured_at desc,current.id desc limit 1) as current_integrity_status
       from drafts d
       left join meeting_draft_transcript_links l
         on l.newsroom_id=d.newsroom_id and l.draft_id=d.id and l.is_current=true
       left join meeting_transcript_artifacts linked on linked.id=l.artifact_id
      where d.newsroom_id=$1 and d.id=$2
      order by l.id`,
    [input.newsroomId, input.draftId],
  );
  if (!rows.length) {
    return [{ artifactId: null, segmentIndex: -1, recorded: "missing", current: "missing", reason: "missing-draft" }];
  }

  const stale: StaleCitation[] = [];
  const claimsMeetingEvidence = rows.some((row) => draftClaimsMeetingEvidence(row.research_json));
  const linkedRows = rows.filter((row) => row.artifact_id != null && row.is_current !== false);
  if (!linkedRows.length) {
    return claimsMeetingEvidence
      ? [{ artifactId: null, segmentIndex: -1, recorded: "missing", current: "missing", reason: "missing-link" }]
      : [];
  }

  for (const row of linkedRows) {
    const artifactId = Number(row.artifact_id);
    const citations = citationSnapshot(row.citation_snapshot, artifactId);
    if (!citations || !row.linked_sha256 || citations.some((citation) => citation.captionSha256 !== row.linked_sha256)) {
      stale.push({
        artifactId,
        segmentIndex: -1,
        recorded: row.linked_sha256 ?? "missing",
        current: row.current_sha256 ?? "missing",
        reason: "malformed-snapshot",
      });
      continue;
    }
    const persistedSegments = await sql.query<{ segment_index: number; caption_sha256: string }>(
      `select segment_index,caption_sha256
         from meeting_transcript_segments
        where artifact_id=$1 and segment_index=any($2::int[])
        order by segment_index`,
      [artifactId, citations.map((citation) => citation.segmentIndex)],
    );
    const segmentByIndex = new Map(persistedSegments.map((segment) => [Number(segment.segment_index), segment]));
    const invalidCitation = citations.find((citation) => {
      const segment = segmentByIndex.get(citation.segmentIndex);
      return !segment || segment.caption_sha256 !== citation.captionSha256;
    });
    if (invalidCitation) {
      const segment = segmentByIndex.get(invalidCitation.segmentIndex);
      stale.push({
        artifactId,
        segmentIndex: invalidCitation.segmentIndex,
        recorded: invalidCitation.captionSha256,
        current: segment?.caption_sha256 ?? "missing",
        reason: "invalid-citation-segment",
      });
      continue;
    }
    if (row.linked_integrity_status !== "valid") {
      stale.push({
        artifactId,
        segmentIndex: citations[0]!.segmentIndex,
        recorded: citations[0]!.captionSha256,
        current: row.linked_integrity_status ?? "missing",
        reason: "invalid-linked-artifact",
      });
      continue;
    }
    if (!row.current_artifact_id || !row.current_sha256) {
      stale.push({
        artifactId,
        segmentIndex: citations[0]!.segmentIndex,
        recorded: citations[0]!.captionSha256,
        current: "missing",
        reason: "missing-current-artifact",
      });
      continue;
    }
    if (row.current_integrity_status !== "valid") {
      stale.push({
        artifactId,
        segmentIndex: citations[0]!.segmentIndex,
        recorded: citations[0]!.captionSha256,
        current: row.current_integrity_status ?? "missing",
        reason: "invalid-current-artifact",
      });
      continue;
    }
    if (row.revision_notice || row.current_artifact_id !== artifactId || row.current_sha256 !== row.linked_sha256) {
      const [accepted] = await sql.query<{
        accepted_artifact_id: number;
        accepted_artifact_sha256: string;
        accepted_citation_snapshot: string;
        draft_evidence_sha256: string;
        reviewed_by: string;
        resolution_note: string;
      }>(
        `select accepted_artifact_id,accepted_artifact_sha256,accepted_citation_snapshot,draft_evidence_sha256,reviewed_by,resolution_note
           from meeting_draft_transcript_revision_reviews
          where newsroom_id=$1 and draft_id=$2 and draft_link_id=$3
            and prior_artifact_id=$4 and accepted_artifact_id=$5
            and accepted_artifact_sha256=$6
          order by reviewed_at desc,id desc limit 1`,
        [input.newsroomId,input.draftId,row.link_id,artifactId,row.current_artifact_id,row.current_sha256],
      );
      if (accepted?.reviewed_by?.trim() && accepted.resolution_note?.trim()
        && accepted.draft_evidence_sha256 === draftEvidenceSha256(row)
        && acceptedSnapshotMatchesCurrent({
          acceptedArtifactId: Number(row.current_artifact_id),
          acceptedArtifactSha256: row.current_sha256,
          acceptedSnapshot: accepted.accepted_citation_snapshot,
          expected: citations,
        })) {
        let acceptedRows: unknown;
        try { acceptedRows = JSON.parse(accepted.accepted_citation_snapshot) as unknown; } catch { acceptedRows = null; }
        const acceptedCitations = Array.isArray(acceptedRows) ? acceptedRows as Record<string, unknown>[] : [];
        const currentSegments = await sql.query<{ segment_index: number; caption_sha256: string; start_seconds: number; end_seconds: number; excerpt: string }>(
          `select segment_index,caption_sha256,start_seconds,end_seconds,excerpt from meeting_transcript_segments
            where artifact_id=$1 and segment_index=any($2::int[]) order by segment_index`,
          [Number(row.current_artifact_id),acceptedCitations.map((citation) => Number(citation.acceptedSegmentIndex))],
        );
        const byIndex = new Map(currentSegments.map((segment) => [Number(segment.segment_index),segment]));
        const acceptedStillMatches = acceptedCitations.length === citations.length && acceptedCitations.every((citation) => {
          const current = byIndex.get(Number(citation.acceptedSegmentIndex));
          return current
            && current.caption_sha256 === citation.captionSha256
            && Number(current.start_seconds) === Number(citation.acceptedTimestampSeconds)
            && Number(current.end_seconds) === Number(citation.acceptedEndSeconds)
            && current.excerpt === citation.excerpt;
        });
        if (acceptedStillMatches) continue;
      }
    }
    if (row.revision_notice || row.current_artifact_id !== artifactId || row.current_sha256 !== row.linked_sha256) {
      for (const citation of citations) {
        stale.push({
          artifactId,
          segmentIndex: citation.segmentIndex,
          recorded: citation.captionSha256,
          current: row.current_sha256,
          reason: "revised-artifact",
        });
      }
    }
  }
  return stale;
}

/**
 * The sentence an editor reads when publication is held back.
 *
 * Names what moved and what to do about it, in the same voice as the other guards
 * in the desk rather than a bare error code.
 */
export function staleCitationNotice(stale: StaleCitation[]): string {
  if (stale.some((item) => item.reason === "missing-draft" || item.reason === "missing-link" || item.reason === "malformed-snapshot" || item.reason === "invalid-citation-segment" || item.reason === "invalid-linked-artifact" || item.reason === "missing-current-artifact" || item.reason === "invalid-current-artifact")) {
    return "This meeting draft's transcript evidence is missing or incomplete. Redraft it from the current recording before publishing.";
  }
  const count = stale.length;
  const where = stale
    .slice(0, 5)
    .filter((s) => s.segmentIndex >= 0)
    .map((s) => `segment ${s.segmentIndex}`)
    .join(", ");
  return [
    `The recording this draft quotes has changed since it was written (${count} citation${count === 1 ? "" : "s"} affected${where ? `: ${where}` : ""}).`,
    "The draft may no longer quote the tape accurately. Redraft it from the current recording, or compare and confirm every affected citation against the current transcript before publishing.",
  ].join(" ");
}

