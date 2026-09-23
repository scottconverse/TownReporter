import type { Sql } from "../db.ts";

/**
 * The writer that connects a meeting transcript to a draft.
 *
 * This is the piece that did not exist. `meeting_draft_transcript_links` has
 * been built since migration 0070 and holds 0 rows, because nothing ever
 * inserted into it -- so `recheckProvisionalMeetings` ran on every capture pass,
 * found no links, and exited having done nothing. A draft that cites the tape
 * is the precondition for every part of the revision machinery.
 *
 * The shape is not invented here. `meeting-revision.ts` reads
 * `citation_snapshot` as an array of `{ artifactId, segmentIndex, captionSha256 }`
 * and compares those hashes against the new caption hash to decide which claims
 * a revision affects. Writing any other shape would make the re-check silently
 * find nothing, which is the defect being repaired.
 */
export type TranscriptCitationRecord = {
  artifactId: number;
  segmentIndex: number;
  captionSha256: string;
};

export type DraftMeetingEvidence = {
  meeting: { videoId: string; title: string; date: string };
  artifactId: number;
  artifactSha256: string;
  currentArtifactId: number | null;
  currentSha256: string | null;
  newerTranscriptExists: boolean;
  revisionNotice: string | null;
  citations: { item: string; segmentIndex: number; timestampSeconds: number; excerpt: string; captionSha256: string }[];
};

export async function loadDraftMeetingEvidence(
  sql: Sql,
  input: { newsroomId: number; draftId: number },
): Promise<DraftMeetingEvidence | null> {
  const [row] = await sql.query<{
    artifact_id: number; citation_snapshot: string; revision_notice: string | null;
    video_id: string; artifact_sha256: string; current_artifact_id: number | null; current_sha256: string | null;
    title: string | null; published: string | null;
  }>(
    `select l.artifact_id,l.citation_snapshot,l.revision_notice,a.video_id,a.sha256 as artifact_sha256,
            c.title,c.published,
            (select current.id from meeting_transcript_artifacts current
              where current.newsroom_id=l.newsroom_id and current.video_id=a.video_id
                and current.artifact_type='transcript'
              order by current.captured_at desc,current.id desc limit 1) as current_artifact_id,
            (select current.sha256 from meeting_transcript_artifacts current
              where current.newsroom_id=l.newsroom_id and current.video_id=a.video_id
                and current.artifact_type='transcript'
              order by current.captured_at desc,current.id desc limit 1) as current_sha256
      from meeting_draft_transcript_links l
      join meeting_transcript_artifacts a on a.id=l.artifact_id
      left join meeting_capture_records c on c.newsroom_id=l.newsroom_id and c.video_id=a.video_id
      where l.newsroom_id=$1 and l.draft_id=$2 and l.is_current=true
      order by l.updated_at desc,l.id desc limit 1`,
    [input.newsroomId, input.draftId],
  );
  if (!row) return null;
  let snapshot: TranscriptCitationRecord[] = [];
  try {
    const parsed = JSON.parse(row.citation_snapshot) as unknown;
    if (Array.isArray(parsed)) snapshot = parsed as TranscriptCitationRecord[];
  } catch {
    snapshot = [];
  }
  const indices = [...new Set(snapshot.map((citation) => Number(citation.segmentIndex)).filter(Number.isInteger))];
  const segments = indices.length
    ? await sql.query<{ segment_index: number; start_seconds: number; excerpt: string }>(
        `select segment_index,start_seconds,excerpt from meeting_transcript_segments
          where artifact_id=$1 and segment_index=any($2::int[])
          order by segment_index`,
        [row.artifact_id, indices],
      )
    : [];
  const chunks = await sql.query<{ item: string; segment_indexes: string }>(
    `select item,segment_indexes from meeting_agenda_chunks
      where newsroom_id=$1 and video_id=$2 and artifact_id=$3
      order by start_seconds`,
    [input.newsroomId, row.video_id, row.artifact_id],
  );
  const itemBySegment = new Map<number, string>();
  for (const chunk of chunks) {
    try {
      const parsed = JSON.parse(chunk.segment_indexes) as unknown;
      if (Array.isArray(parsed)) for (const index of parsed.map(Number).filter(Number.isInteger)) itemBySegment.set(index, chunk.item);
    } catch {
      // A malformed chunk cannot invent provenance; the citation remains unlabelled.
    }
  }
  const snapshotByIndex = new Map(snapshot.map((citation) => [Number(citation.segmentIndex), citation]));
  return {
    meeting: { videoId: row.video_id, title: row.title ?? "Meeting", date: row.published ?? "" },
    artifactId: Number(row.artifact_id),
    artifactSha256: row.artifact_sha256,
    currentArtifactId: row.current_artifact_id == null ? null : Number(row.current_artifact_id),
    currentSha256: row.current_sha256,
    newerTranscriptExists: row.current_artifact_id != null && Number(row.current_artifact_id) !== Number(row.artifact_id),
    revisionNotice: row.revision_notice,
    citations: segments.map((segment) => ({
      item: itemBySegment.get(Number(segment.segment_index)) ?? "",
      segmentIndex: Number(segment.segment_index),
      timestampSeconds: Number(segment.start_seconds),
      excerpt: segment.excerpt,
      captionSha256: snapshotByIndex.get(Number(segment.segment_index))?.captionSha256 ?? row.artifact_sha256,
    })),
  };
}

/**
 * The citation array as `meeting-revision.ts` expects to read it back.
 *
 * Kept as a named function so the writer and the revision check cannot drift
 * apart: if the revision reader ever changes shape, this is the one place the
 * writer has to change with it.
 */
export function citationSnapshotFor(
  citations: { segmentIndex: number; captionSha256: string }[],
  artifactId: number,
): string {
  const records: TranscriptCitationRecord[] = citations.map((c) => ({
    artifactId,
    segmentIndex: c.segmentIndex,
    captionSha256: c.captionSha256,
  }));
  // One row per segment, so a repeated index cannot inflate the snapshot.
  const seen = new Set<string>();
  const unique = records.filter((r) => {
    const key = `${r.artifactId}:${r.segmentIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return JSON.stringify(unique);
}

/**
 * Link a draft to the transcript artifact it drew from.
 *
 * Idempotent on `(newsroom_id, draft_id, artifact_id)`: re-running for the same
 * draft and artifact replaces the snapshot rather than accumulating rows, which
 * is what a redraft of the same meeting needs. Does not draft, publish, or
 * touch the transcript itself.
 */
export async function linkDraftToTranscript(
  sql: Sql,
  input: {
    newsroomId: number;
    draftId: number;
    artifactId: number;
    citations: { segmentIndex: number; captionSha256: string }[];
  },
): Promise<{ linked: boolean; snapshot: string }> {
  const snapshot = citationSnapshotFor(input.citations, input.artifactId);
  if (input.citations.length === 0) {
    /*
      A draft with no citations is not a meeting draft. Writing an empty link
      would tell the revision check there is something to look at when there is
      not, which reads identically to "nothing to check" but costs a row and a
      query on every capture pass.
    */
    return { linked: false, snapshot };
  }
  await sql.query(
    `update meeting_draft_transcript_links
        set is_current=false
      where newsroom_id=$1 and draft_id=$2 and is_current=true`,
    [input.newsroomId, input.draftId],
  );
  await sql.query(
    `insert into meeting_draft_transcript_links
       (newsroom_id,draft_id,artifact_id,citation_snapshot,is_current,revision_notice)
     values ($1,$2,$3,$4,true,null)
     on conflict (newsroom_id,draft_id,artifact_id)
     do update set citation_snapshot=excluded.citation_snapshot,is_current=true,revision_notice=null,updated_at=now()`,
    [input.newsroomId, input.draftId, input.artifactId, snapshot],
  );
  await sql.query(
    `update drafts set research_json =
       (coalesce(nullif(research_json,''),'{}')::jsonb || $1::jsonb)::text,
       updated_at=now()
     where id=$2 and newsroom_id=$3`,
    [
      JSON.stringify({
        meetingEvidence: {
          used: true,
          artifactId: input.artifactId,
          citationCount: JSON.parse(snapshot).length,
        },
      }),
      input.draftId,
      input.newsroomId,
    ],
  );
  return { linked: true, snapshot };
}

