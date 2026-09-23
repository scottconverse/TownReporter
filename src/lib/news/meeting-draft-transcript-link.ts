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
    `insert into meeting_draft_transcript_links
       (newsroom_id,draft_id,artifact_id,citation_snapshot)
     values ($1,$2,$3,$4)
     on conflict (newsroom_id,draft_id,artifact_id)
     do update set citation_snapshot=excluded.citation_snapshot, updated_at=now()`,
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

