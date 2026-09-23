import type { Sql } from "../db.ts";

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
    | "missing-current-artifact"
    | "revised-artifact";
};

type GuardRow = {
  draft_id: number;
  research_json: string | null;
  artifact_id: number | null;
  citation_snapshot: string | null;
  revision_notice: string | null;
  video_id: string | null;
  linked_sha256: string | null;
  current_artifact_id: number | null;
  current_sha256: string | null;
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
    return false;
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
    `select d.id as draft_id, d.research_json,
            l.artifact_id, l.citation_snapshot, l.revision_notice,
            linked.video_id, linked.sha256 as linked_sha256,
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
              order by current.captured_at desc,current.id desc limit 1) as current_sha256
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
  if (stale.some((item) => item.reason === "missing-draft" || item.reason === "missing-link" || item.reason === "malformed-snapshot" || item.reason === "missing-current-artifact")) {
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
    "The draft may no longer quote the tape accurately. Redraft it from the current recording before publishing; the replacement draft will derive and bind a new citation snapshot.",
  ].join(" ");
}

