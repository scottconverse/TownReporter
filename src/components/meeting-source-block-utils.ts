import type { ReportingNotes } from "@/lib/news/notes";

export type MeetingCitation = {
  item: string;
  segmentIndex: number;
  timestampSeconds: number;
  timestamp?: string;
  excerpt: string;
  captionSha256: string;
};

export function meetingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function meetingCitationsFor(notes: Pick<ReportingNotes, "meeting" | "transcriptCitations">): MeetingCitation[] {
  if (!notes.meeting) return [];
  return notes.transcriptCitations ?? [];
}

export function meetingCitationUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(seconds))}s`;
}

export function affectedMeetingSegmentIndexes(notice: string | null | undefined): number[] {
  if (!notice) return [];
  return [...new Set([...notice.matchAll(/\bsegment\s+(\d+)\b/gi)].map((match) => Number(match[1])))];
}
