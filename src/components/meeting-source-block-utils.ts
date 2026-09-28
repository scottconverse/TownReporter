import type { ReportingNotes } from "@/lib/news/notes";
import type { DraftMeetingEvidence } from "@/lib/news/meeting-draft-transcript-link";

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

/**
 * Whether a transcript citation still resolves, in words.
 *
 * The three states are not invented here; they are the three states the story
 * notes already read out of the same object. A draft written from the current
 * artifact carries no comparison (`newerTranscriptExists` is false) and its
 * citation resolves by definition -- the citation is the record. Once a newer
 * capture exists, every citation either matched a passage in it
 * (`currentEvidence`, matched by `loadDraftMeetingEvidence` within
 * `CURRENT_SEGMENT_MATCH_TOLERANCE_SECONDS`) or did not, and "did not" is the
 * one an editor has to act on, so it is the only one phrased as a problem.
 *
 * Lives beside the citation helpers rather than in a component so the three
 * states can be tested without rendering, and so the story notes and the
 * Claims & evidence panel answer the same question the same way.
 */
export function citationResolution(
  evidence: Pick<
    DraftMeetingEvidence,
    "artifactId" | "currentArtifactId" | "newerTranscriptExists"
  >,
  citation: Pick<DraftMeetingEvidence["citations"][number], "currentEvidence">,
): string {
  if (!evidence.newerTranscriptExists) {
    return `Resolves against artifact ${evidence.artifactId}, the transcript this draft was written from.`;
  }
  const current = citation.currentEvidence;
  if (!current) {
    return `No longer resolves: no matching passage was found in the current transcript (artifact ${evidence.currentArtifactId ?? "unknown"}). This citation cannot be accepted as-is — redraft or correct the story.`;
  }
  return `Still resolves in the current transcript (artifact ${current.artifactId}) at ${meetingClock(current.timestampSeconds)}.`;
}

export function affectedMeetingSegmentIndexes(notice: string | null | undefined): number[] {
  if (!notice) return [];
  return [...new Set([...notice.matchAll(/\bsegment\s+(\d+)\b/gi)].map((match) => Number(match[1])))];
}
