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

    return records.map((r) => {
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
      };
    });
  });
