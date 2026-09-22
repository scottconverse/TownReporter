import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import { requireEditor } from "./membership.ts";
import { authMiddleware } from "../auth/middleware.ts";

export type MeetingActivityRow = {
  videoId: string;
  title: string;
  published: string;
  channelUrl: string;
  status: "not-captured" | "captured" | "failed";
  failureReason: string | null;
  captionFormat: string | null;
  captionSha256: string | null;
  audioFormat: string | null;
  audioSha256: string | null;
  audioBytes: number | null;
  audioTriggerReason: string | null;
  captureDisposition: "provisional" | "final" | null;
  revisionCount: number;
  settledUnderChurn: boolean;
  forcedRecapture: boolean;
  artifactPath: string | null;
  artifactFormat: string | null;
  artifactSha256: string | null;
  artifactBytes: number | null;
  aligned: boolean | null;
  alignmentReason: string | null;
  chunks: { item: string; title: string; startSeconds: number; endSeconds: number }[];
  votes: { item: string; mover: string | null; seconder: string | null; tally: string | null; result: string; source: string | null }[];
  /*
    What the meeting produced for the desk.

    A capture that transcribed perfectly and produced no story is a different
    outcome from one that produced a draft waiting to be read, and the desk could
    not tell them apart: the rows showed the transcription state and stopped
    there. The lead the capture pass files carries the video id in its notes, so
    the connection exists in the data.
  */
  leadId: number | null;
  leadStatus: string | null;
  draftId: number | null;
  citationCount: number;
};

/**
 * N-3: everything an operator needs to see what meeting capture did, read from
 * the real tables. Every field is a real column value; nothing is inferred.
 */
export const listMeetingActivity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MeetingActivityRow[]> => {
    const me = await requireEditor(context.userId);
    const sql = await getSql();
    const newsroomId = me.newsroomId;

    const records = await sql.query<{
      video_id: string; title: string; published: string; channel_url: string;
      status: MeetingActivityRow["status"]; failure_reason: string | null;
      caption_format: string | null; caption_sha256: string | null;
      audio_format: string | null; audio_sha256: string | null; audio_bytes: number | null; audio_trigger_reason: string | null;
      capture_disposition: "provisional" | "final" | null; revision_count: number | null; settled_under_churn: boolean | null;
      forced_recapture: boolean | null;
    }>(
      `select video_id,title,published,channel_url,status,failure_reason,
              caption_format,caption_sha256,audio_format,audio_sha256,audio_bytes,audio_trigger_reason,
              capture_disposition,revision_count,settled_under_churn,forced_recapture
       from meeting_capture_records where newsroom_id=$1 order by captured_at desc nulls last, id desc`,
      [newsroomId],
    );

    const artifacts = await sql.query<{
      video_id: string; artifact_type: string; storage_path: string; format: string; sha256: string; byte_size: number | null;
    }>(
      "select video_id,artifact_type,storage_path,format,sha256,byte_size from meeting_transcript_artifacts where newsroom_id=$1 order by captured_at desc, id desc",
      [newsroomId],
    );
    const byVideo = new Map<string, typeof artifacts[number]>();
    for (const a of artifacts) if (!byVideo.has(a.video_id)) byVideo.set(a.video_id, a);

    const alignments = await sql.query<{ video_id: string; aligned: boolean; reason: string | null }>(
      "select distinct on (video_id) video_id,aligned,reason from meeting_alignments where newsroom_id=$1 order by video_id, created_at desc",
      [newsroomId],
    );
    const alignByVideo = new Map(alignments.map((a) => [a.video_id, a]));

    const chunks = await sql.query<{ video_id: string; item: string; title: string; start_seconds: number; end_seconds: number }>(
      "select video_id,item,title,start_seconds,end_seconds from meeting_agenda_chunks where newsroom_id=$1 order by video_id,item",
      [newsroomId],
    );
    const chunksByVideo = new Map<string, MeetingActivityRow["chunks"]>();
    for (const c of chunks) {
      const list = chunksByVideo.get(c.video_id) ?? [];
      list.push({ item: c.item, title: c.title, startSeconds: Number(c.start_seconds), endSeconds: Number(c.end_seconds) });
      chunksByVideo.set(c.video_id, list);
    }

    const votes = await sql.query<{ video_id: string; item: string; mover: string | null; seconder: string | null; tally: string | null; result: string; source: string | null }>(
      "select video_id,item,mover,seconder,tally,result,source from meeting_structured_votes where newsroom_id=$1 order by video_id,item",
      [newsroomId],
    );
    const votesByVideo = new Map<string, MeetingActivityRow["votes"]>();
    for (const v of votes) {
      const list = votesByVideo.get(v.video_id) ?? [];
      list.push({ item: v.item, mover: v.mover, seconder: v.seconder, tally: v.tally, result: v.result, source: v.source });
      votesByVideo.set(v.video_id, list);
    }

    /*
      Meeting leads, matched on the video id the capture pass wrote into their
      notes. Read as jsonb rather than parsed in JS so the match happens in the
      database and does not depend on a shape the parser might later change.
    */
    const meetingLeads = await sql.query<{
      lead_id: number; lead_status: string; draft_id: number | null; video_id: string; citation_count: number;
    }>(
      /*
        The cast is guarded. A lead whose notes are not valid JSON would otherwise
        throw here and take the whole Scan desk down with it -- one bad row breaking
        an unrelated screen is a worse failure than the one being fixed. The regex
        check keeps the cast to rows that can actually survive it.
      */
      `select l.id as lead_id, l.status as lead_status,
              (select d.id from drafts d where d.lead_id = l.id and d.newsroom_id = l.newsroom_id order by d.updated_at desc, d.id desc limit 1) as draft_id,
              (l.notes_json::jsonb -> 'meeting' ->> 'videoId') as video_id,
              coalesce(jsonb_array_length(l.notes_json::jsonb -> 'transcriptCitations'), 0) as citation_count
         from leads l
        where l.newsroom_id = $1
          and l.notes_json is not null
          and l.notes_json ~ '^[[:space:]]*{'
          and l.notes_json::jsonb -> 'meeting' ->> 'videoId' is not null`,
      [newsroomId],
    );
    const leadByVideo = new Map(meetingLeads.map((l) => [l.video_id, l]));

    return records.map((r) => {
      const leadRow = leadByVideo.get(r.video_id);
      const artifact = byVideo.get(r.video_id);
      const alignment = alignByVideo.get(r.video_id);
      return {
        videoId: r.video_id, title: r.title, published: r.published, channelUrl: r.channel_url,
        status: r.status, failureReason: r.failure_reason,
        captionFormat: r.caption_format, captionSha256: r.caption_sha256,
        audioFormat: r.audio_format, audioSha256: r.audio_sha256, audioBytes: r.audio_bytes, audioTriggerReason: r.audio_trigger_reason,
        captureDisposition: r.capture_disposition, revisionCount: r.revision_count ?? 0, settledUnderChurn: r.settled_under_churn ?? false,
        forcedRecapture: r.forced_recapture ?? false,
        artifactPath: artifact?.storage_path ?? null, artifactFormat: artifact?.format ?? null,
        artifactSha256: artifact?.sha256 ?? null, artifactBytes: artifact?.byte_size ?? null,
        aligned: alignment?.aligned ?? null, alignmentReason: alignment?.reason ?? null,
        chunks: chunksByVideo.get(r.video_id) ?? [],
        votes: votesByVideo.get(r.video_id) ?? [],
        leadId: leadRow?.lead_id ?? null,
        leadStatus: leadRow?.lead_status ?? null,
        draftId: leadRow?.draft_id ?? null,
        citationCount: leadRow?.citation_count ?? 0,
      };
    });
  });
