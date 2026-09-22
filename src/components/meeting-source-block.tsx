import type { ReportingNotes } from "@/lib/news/notes";

/**
 * "Where this came from" -- the block that makes a meeting story checkable.
 *
 * A meeting story without this is a claim about a four-hour recording that the
 * editor cannot check without watching the recording. With it, every sentence the
 * draft drew from the tape resolves to an agenda item, a timestamp and the
 * verbatim words, so the editor checks the draft against the record in one click.
 *
 * It renders nothing for a draft with no transcript citations, so an ordinary
 * story is unchanged.
 */
export function meetingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export type MeetingCitation = {
  item: string;
  segmentIndex: number;
  timestampSeconds: number;
  timestamp?: string;
  excerpt: string;
  captionSha256: string;
};

/**
 * The citations a draft actually used, read off its own notes.
 *
 * Deliberately reads from the lead's recorded citations rather than re-deriving
 * them in the browser: the server already derived what the draft used, and a
 * second derivation here could disagree with the link table the revision check
 * reads.
 */
export function meetingCitationsFor(notes: Pick<ReportingNotes, "meeting" | "transcriptCitations">): MeetingCitation[] {
  if (!notes.meeting) return [];
  return notes.transcriptCitations ?? [];
}

export function MeetingSourceBlock({ notes }: { notes: Pick<ReportingNotes, "meeting" | "transcriptCitations"> }) {
  const citations = meetingCitationsFor(notes);
  if (!citations.length) return null;
  return (
    <div className="note-sec">
      <p className="side-label">Where this came from</p>
      <p className="note-one">
        This draft was written from the meeting recording
        {notes.meeting?.date ? ` of ${notes.meeting.date}` : ""}.
        {notes.meeting?.title ? ` ${notes.meeting.title}.` : ""}
        {" "}Each line below is verbatim from the tape at that timestamp, so a claim can be
        {" "}checked against the record rather than taken on trust.
      </p>
      <ul className="meeting-citations">
        {citations.map((c) => (
          <li key={`${c.segmentIndex}-${c.item}`}>
            <p className="meeting-citation-head">
              <b>Item {c.item || "unlabelled"}</b>
              {" · "}
              <span className="meeting-citation-time">{c.timestamp ?? meetingClock(c.timestampSeconds)}</span>
            </p>
            <p className="meeting-citation-excerpt">{c.excerpt}</p>
          </li>
        ))}
      </ul>
      {notes.meeting?.videoId ? (
        <p className="note-one">
          <a
            href={`https://www.youtube.com/watch?v=${notes.meeting.videoId}&t=${Math.max(0, Math.floor(citations[0]!.timestampSeconds))}s`}
            target="_blank"
            rel="noreferrer"
          >
            Open the recording at the first cited moment
          </a>
        </p>
      ) : null}
    </div>
  );
}

