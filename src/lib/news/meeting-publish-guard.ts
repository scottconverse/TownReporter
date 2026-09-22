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
  artifactId: number;
  segmentIndex: number;
  recorded: string;
  current: string;
};

export async function staleMeetingCitations(
  sql: Sql,
  input: {
    newsroomId: number;
    draftId: number;
    citations: { segmentIndex: number; captionSha256: string }[];
  },
): Promise<StaleCitation[]> {
  if (!input.citations.length) return [];
  const rows = await sql.query<{ draft_id: number; artifact_id: number; sha256: string }>(
    `select l.draft_id, l.artifact_id, a.sha256
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts a on a.id = l.artifact_id
      where l.newsroom_id = $1 and l.draft_id = $2`,
    [input.newsroomId, input.draftId],
  );
  if (!rows.length) return [];
  const currentByArtifact = new Map(rows.map((r) => [Number(r.artifact_id), r.sha256]));
  const stale: StaleCitation[] = [];
  for (const [artifactId, current] of currentByArtifact) {
    for (const c of input.citations) {
      if (c.captionSha256 && c.captionSha256 !== current) {
        stale.push({ artifactId, segmentIndex: c.segmentIndex, recorded: c.captionSha256, current });
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
  const count = stale.length;
  const where = stale
    .slice(0, 5)
    .map((s) => `segment ${s.segmentIndex}`)
    .join(", ");
  return [
    `The recording this draft quotes has changed since it was written (${count} citation${count === 1 ? "" : "s"} affected${where ? `: ${where}` : ""}).`,
    "The draft may no longer quote the tape accurately. Redraft it from the current recording, or check the changed moments and confirm the draft still matches, before publishing.",
  ].join(" ");
}

