import type { ReportingNotes } from "@/lib/news/notes";
import type { DraftMeetingEvidence } from "@/lib/news/meeting-draft-transcript-link";

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
 * Candidate citations carried by the lead. These are shown separately from the
 * persisted used-citation snapshot; they must never be presented as evidence
 * the current draft actually used.
 */
export function meetingCitationsFor(notes: Pick<ReportingNotes, "meeting" | "transcriptCitations">): MeetingCitation[] {
  if (!notes.meeting) return [];
  return notes.transcriptCitations ?? [];
}

export function MeetingSourceBlock({
  notes,
  usedEvidence,
}: {
  notes: Pick<ReportingNotes, "meeting" | "transcriptCitations">;
  usedEvidence?: DraftMeetingEvidence | null;
}) {
  const candidates = meetingCitationsFor(notes);
  const visibleCandidates = candidates.slice(0, 50);
  const citations = usedEvidence?.citations ?? [];
  if (!citations.length && !candidates.length) return null;
  const meeting = usedEvidence?.meeting ?? notes.meeting;
  const videoId = meeting?.videoId;
  return (
    <div className="note-sec">
      {usedEvidence?.newerTranscriptExists || usedEvidence?.revisionNotice ? (
        <div className="note-gate">
          <p className="side-label">Newer transcript available — redraft before publishing</p>
          <p className="note-one">
            This saved draft used artifact {usedEvidence.artifactId}, but artifact {usedEvidence.currentArtifactId ?? "unknown"} is current.
            {usedEvidence.revisionNotice ? ` ${usedEvidence.revisionNotice}` : ""}
          </p>
        </div>
      ) : null}
      {citations.length ? (
        <>
          <p className="side-label">Where this draft came from</p>
          <p className="note-one">
            This saved draft used the meeting recording
            {meeting?.date ? ` of ${meeting.date}` : ""}.
            {meeting?.title ? ` ${meeting.title}.` : ""}
            {" "}These are the exact persisted citations used by this draft.
          </p>
          <ul className="meeting-citations">
            {citations.map((c) => (
              <li key={`${c.segmentIndex}-${c.item}`}>
                <p className="meeting-citation-head">
                  <b>Item {c.item || "unlabelled"}</b>
                  {" · "}
                  <span className="meeting-citation-time">{meetingClock(c.timestampSeconds)}</span>
                </p>
                <p className="meeting-citation-excerpt">{c.excerpt}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="note-one note-gate">
          This lead has transcript material, but the current draft has no complete persisted used-citation record. Publishing will remain blocked until it is redrafted from the current recording.
        </p>
      )}
      {candidates.length ? (
        <details>
          <summary>Transcript material considered ({candidates.length})</summary>
          <ul className="meeting-citations">
            {visibleCandidates.map((c) => (
              <li key={`candidate-${c.segmentIndex}-${c.item}`}>
                <p className="meeting-citation-head"><b>Item {c.item || "unlabelled"}</b> · {c.timestamp ?? meetingClock(c.timestampSeconds)}</p>
                <p className="meeting-citation-excerpt">{c.excerpt}</p>
              </li>
            ))}
          </ul>
          {candidates.length > visibleCandidates.length ? (
            <p className="note-one">
              Showing 50 of {candidates.length} timestamped transcript segments considered by the draft.
            </p>
          ) : null}
        </details>
      ) : null}
      {videoId && citations.length ? (
        <p className="note-one">
          <a
            href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(citations[0]!.timestampSeconds))}s`}
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

