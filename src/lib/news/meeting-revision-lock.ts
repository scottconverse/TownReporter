import type { Sql } from "../db.ts";

async function lockMeetingRecord(sql: Sql, newsroomId: number, videoId: string): Promise<void> {
  const rows = await sql.query<{ video_id: string }>(
    `select video_id from meeting_capture_records
      where newsroom_id=$1 and video_id=$2
      for update`,
    [newsroomId, videoId],
  );
  if (!rows.length) throw new Error(`Meeting capture record ${videoId} is missing.`);
}

/**
 * Capture/revision side of the shared fence.
 *
 * Publication already owns the lead and current-draft rows before it locks the
 * meeting record. Capture therefore takes every affected lead in numeric order
 * first, then the meeting record. The shared order avoids the classic cycle of
 * publisher holding a draft while waiting for the meeting and capture holding
 * the meeting while waiting to mark that same draft revised.
 */
export async function lockMeetingRevisionForCapture(
  sql: Sql,
  input: { newsroomId: number; videoId: string },
): Promise<void> {
  const leadRows = await sql.query<{ lead_id: number }>(
    `select distinct d.lead_id
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts a on a.id=l.artifact_id
       join drafts d on d.id=l.draft_id and d.newsroom_id=l.newsroom_id
      where l.newsroom_id=$1 and a.video_id=$2
      order by d.lead_id`,
    [input.newsroomId, input.videoId],
  );
  const leadIds = [...new Set(leadRows.map((row) => Number(row.lead_id)))].sort((a, b) => a - b);
  for (const leadId of leadIds) {
    await sql.query(
      `select id from leads where newsroom_id=$1 and id=$2 for update`,
      [input.newsroomId, leadId],
    );
  }
  await lockMeetingRecord(sql, input.newsroomId, input.videoId);
}

/** Publication side of the shared fence. The caller must already own its lead lock. */
export async function lockMeetingsForDraftPublish(
  sql: Sql,
  input: { newsroomId: number; draftId: number },
): Promise<void> {
  const videos = await sql.query<{ video_id: string }>(
    `select distinct a.video_id
       from meeting_draft_transcript_links l
       join meeting_transcript_artifacts a on a.id=l.artifact_id
      where l.newsroom_id=$1 and l.draft_id=$2
      order by a.video_id`,
    [input.newsroomId, input.draftId],
  );
  const videoIds = [...new Set(videos.map((row) => row.video_id))].sort();
  for (const videoId of videoIds) await lockMeetingRecord(sql, input.newsroomId, videoId);
}
