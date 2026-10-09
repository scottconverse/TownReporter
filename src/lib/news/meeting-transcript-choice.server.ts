import type { Sql } from "../db.ts";
import { meetingTranscriptChoices } from "./meeting-transcript-choice.ts";

type TranscriptRow = { id: number; video_id: string; source_method: string; title: string | null; published: string | null };
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Upload dates differ across channels. Prefer the meeting date in the title.
function meetingIdentity(row: Pick<TranscriptRow, "title" | "published">): string | null {
  let title = (row.title ?? "").toLowerCase();
  const dated = title.match(/\b([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/)
    ?? title.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?[,]?\s+(\d{4})\b/);
  let date = "";
  if (dated) {
    const monthFirst = /^[a-z]/.test(dated[1]!);
    const month = months.findIndex((name) => name.startsWith(monthFirst ? dated[1]! : dated[2]!));
    const day = Number(monthFirst ? dated[2] : dated[1]);
    if (month < 0 || day < 1 || day > 31) return null;
    date = `${dated[3]}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    title = title.replace(dated[0], "");
  } else {
    const iso = title.match(/\b\d{4}-\d{2}-\d{2}\b/);
    date = iso?.[0] ?? (row.published ?? "").slice(0, 10);
    if (iso) title = title.replace(iso[0], "");
  }
  const body = title.replace(/[^a-z0-9]+/g, " ").trim();
  return body && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${body}|${date}` : null;
}

export async function loadMeetingTranscriptChoices(sql: Sql, newsroomId: number, videoId: string) {
  const captures = await sql.query<{ title: string; published: string }>(
    "select title,published from meeting_capture_records where newsroom_id=$1 and video_id=$2 limit 1", [newsroomId, videoId],
  );
  const identity = captures[0] ? meetingIdentity(captures[0]) : null;
  const rows = await sql.query<TranscriptRow>(
    `select a.id,a.video_id,a.source_method,c.title,c.published from meeting_transcript_artifacts a
     left join meeting_capture_records c on c.newsroom_id=a.newsroom_id and c.video_id=a.video_id
     where a.newsroom_id=$1 and a.artifact_type='transcript' and a.source_method in ('textflowkit-json','yt-dlp-captions')
     order by a.captured_at desc,a.id desc`, [newsroomId],
  );
  return meetingTranscriptChoices(rows.filter((row) => row.video_id === videoId || (identity !== null && meetingIdentity(row) === identity)));
}
