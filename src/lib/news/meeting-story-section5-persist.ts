import type { Sql } from "../db.ts";
import type { AgendaChunk, AlignmentResult, StructuredVote } from "./meeting-story-section5.ts";

/**
 * Additive persistence for section-5 artifacts. Nothing here drafts or
 * publishes: it stores the chunks, the alignment outcome, and the structured
 * votes so item-level work has a durable, addressable record.
 */
export async function persistSection5(
  sql: Sql,
  input: {
    newsroomId: number;
    videoId: string;
    artifactId: number;
    chunks: AgendaChunk[];
    alignment: AlignmentResult;
    votes: StructuredVote[];
  },
): Promise<void> {
  for (const chunk of input.chunks) {
    await sql.query(
      `insert into meeting_agenda_chunks
         (newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (newsroom_id,video_id,item)
       do update set title=excluded.title,start_seconds=excluded.start_seconds,
         end_seconds=excluded.end_seconds,segment_indexes=excluded.segment_indexes`,
      [input.newsroomId, input.videoId, input.artifactId, chunk.item, chunk.title, chunk.startSeconds, chunk.endSeconds, JSON.stringify(chunk.segmentIndexes)],
    );
  }
  await sql.query(
    `insert into meeting_alignments(newsroom_id,video_id,artifact_id,aligned,reason,packet_items)
     values ($1,$2,$3,$4,$5,$6)`,
    [input.newsroomId, input.videoId, input.artifactId, input.alignment.aligned, input.alignment.reason, JSON.stringify(input.chunks.map((c) => ({ item: c.item, title: c.title })))],
  );
  for (const vote of input.votes) {
    await sql.query(
      `insert into meeting_structured_votes
         (newsroom_id,video_id,item,established,motion,mover,seconder,tally,result,source,provenance,disagreements)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (newsroom_id,video_id,item)
       do update set established=excluded.established,motion=excluded.motion,mover=excluded.mover,
         seconder=excluded.seconder,tally=excluded.tally,result=excluded.result,source=excluded.source,
         provenance=excluded.provenance,disagreements=excluded.disagreements`,
      [
        input.newsroomId, input.videoId, vote.item, vote.established, vote.motion, vote.mover,
        vote.seconder, vote.tally, vote.result, vote.source,
        JSON.stringify(vote.provenance), JSON.stringify(vote.disagreements),
      ],
    );
  }
}

export type UnalignedMeetingLead = {
  leadHeadline: string;
  leadWhy: string;
  untimed: true;
  itemLevelDraft: false;
};

/**
 * Honest unalignable-meeting behavior: retain the full transcript (already
 * stored by Slice 3), file one untimed lead naming the alignment failure, and
 * produce no item-level draft.
 */
export function unalignedMeetingLead(input: { videoId: string; title: string; reason: string }): UnalignedMeetingLead {
  return {
    leadHeadline: input.title,
    leadWhy: `Meeting transcript captured, but packet items could not be aligned to the transcript: ${input.reason}. Filed as a single untimed record; no item-level draft produced.`,
    untimed: true,
    itemLevelDraft: false,
  };
}
