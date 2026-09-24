import { useEffect, useState } from "react";
import type { ReportingNotes } from "@/lib/news/notes";
import type { DraftMeetingEvidence } from "@/lib/news/meeting-draft-transcript-link";
import { affectedMeetingSegmentIndexes, meetingCitationUrl, meetingCitationsFor, meetingClock } from "@/components/meeting-source-block-utils";

/**
 * "Where this came from" -- the block that makes a meeting story checkable.
 *
 * When a new transcript appears, the editor can either redraft from it or review
 * every persisted citation against the new version. A citation-only review keeps
 * the prose and original A link untouched; the server records an append-only
 * decision bound to the exact current B artifact and fails if the tape moves.
 */
export function MeetingSourceBlock({
  notes,
  usedEvidence,
  onRedraft,
  redrafting = false,
  onReverify,
  reverifying = false,
  evidenceToken = "",
}: {
  notes: Pick<ReportingNotes, "meeting" | "transcriptCitations">;
  usedEvidence?: DraftMeetingEvidence | null;
  onRedraft?: () => void;
  redrafting?: boolean;
  onReverify?: (review: { confirmedSegmentIndexes: number[]; note: string }) => void;
  reverifying?: boolean;
  evidenceToken?: string;
}) {
  const candidates = meetingCitationsFor(notes);
  const visibleCandidates = candidates.slice(0, 50);
  const citations = usedEvidence?.citations ?? [];
  const meeting = usedEvidence?.meeting ?? notes.meeting;
  const videoId = meeting?.videoId;
  const hasRevision = Boolean(usedEvidence?.newerTranscriptExists || usedEvidence?.revisionNotice);
  const affectedIndexes = affectedMeetingSegmentIndexes(usedEvidence?.revisionNotice);
  const affected = citations.filter((citation) => !affectedIndexes.length || affectedIndexes.includes(citation.segmentIndex));
  const comparisonCitations = onReverify ? citations : affected;
  const reviewKey = `${evidenceToken}:${usedEvidence?.artifactId ?? "?"}:${usedEvidence?.currentArtifactId ?? "?"}:${usedEvidence?.currentSha256 ?? "?"}`;
  const [checked, setChecked] = useState<{ key: string; indexes: number[] }>({ key: reviewKey, indexes: [] });
  const [reviewNote, setReviewNote] = useState("");
  const effectiveChecked = checked.key === reviewKey ? new Set(checked.indexes) : new Set<number>();
  const currentSha256 = usedEvidence?.currentSha256 ?? "";
  const currentReady = Boolean(usedEvidence?.currentArtifactId && /^[a-f\d]{64}$/i.test(currentSha256));
  const allCompared = citations.length > 0 && currentReady && citations.every((citation) => citation.currentEvidence != null);
  const allConfirmed = allCompared && citations.every((citation) => effectiveChecked.has(citation.segmentIndex));
  const savedReview = usedEvidence?.acceptedReview;

  useEffect(() => {
    setChecked({ key: reviewKey, indexes: [] });
    setReviewNote("");
  }, [reviewKey]);

  if (!citations.length && !candidates.length) return null;
  return (
    <div className="note-sec">
      {hasRevision ? (
        <div className="note-gate">
          <p className="side-label">Newer transcript available — review before publishing</p>
          <p className="note-one">
            This saved draft used artifact {usedEvidence?.artifactId ?? "unknown"}, but artifact {usedEvidence?.currentArtifactId ?? "unknown"} is current.
            {usedEvidence?.revisionNotice ? ` ${usedEvidence.revisionNotice}` : " The draft's original evidence is preserved."}
          </p>
          {comparisonCitations.length ? (
            <ul className="meeting-citations" aria-label="Transcript revision evidence comparison">
              {comparisonCitations.map((citation) => {
                const current = citation.currentEvidence;
                const isAffected = !affectedIndexes.length || affectedIndexes.includes(citation.segmentIndex);
                return (
                  <li key={`revision-${citation.segmentIndex}`}>
                    <p className="meeting-citation-head"><b>Segment {citation.segmentIndex}</b> · {meetingClock(citation.timestampSeconds)} · {isAffected ? "Changed citation" : "Other citation in this draft"}</p>
                    <p className="meeting-citation-excerpt"><b>Used by this draft (artifact A):</b> {citation.excerpt}</p>
                    {current ? (
                      <p className="meeting-citation-excerpt">
                        <b>Current transcript (artifact {current.artifactId} · {meetingClock(current.timestampSeconds)}):</b> {current.excerpt}
                      </p>
                    ) : (
                      <p className="meeting-citation-excerpt">
                        <b>Current transcript comparison unavailable:</b> no matching segment was found near this timestamp. Redraft or inspect the recording; this citation cannot be accepted as-is.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {savedReview ? (
            <p className="note-one" role="status">
              Citation review saved against artifact {savedReview.artifactId} ({savedReview.artifactSha256.slice(0, 12)}…).
              {" "}{savedReview.citationCount} citations checked by {savedReview.reviewedBy} on {new Date(savedReview.reviewedAt).toLocaleString()}.
              {" "}{savedReview.note}
            </p>
          ) : null}
          {onReverify && !savedReview ? (
            <div className="note-one" aria-label="Citation-only transcript review">
              <p><b>Keep this draft text:</b> compare each cited passage with the current transcript. The saved review applies only to this draft and this transcript version.</p>
              {citations.map((citation) => {
                const current = citation.currentEvidence;
                return (
                  <label key={`confirm-${citation.segmentIndex}`} className="gate-claim">
                    <input
                      type="checkbox"
                      checked={effectiveChecked.has(citation.segmentIndex)}
                      disabled={reverifying || !current}
                      onChange={(event) => {
                        const isChecked = event.currentTarget.checked;
                        setChecked((prior) => {
                        const indexes = new Set(prior.key === reviewKey ? prior.indexes : []);
                        if (isChecked) indexes.add(citation.segmentIndex);
                        else indexes.delete(citation.segmentIndex);
                        return { key: reviewKey, indexes: [...indexes] };
                        });
                      }}
                    />
                    <span>I compared segment {citation.segmentIndex} in A with its current passage in B</span>
                  </label>
                );
              })}
              <label className="field-label" htmlFor="meeting-citation-review-note">What did you verify?</label>
              <textarea
                id="meeting-citation-review-note"
                aria-label="Citation review note"
                value={reviewNote}
                disabled={reverifying}
                onChange={(event) => setReviewNote(event.currentTarget.value)}
                placeholder="Note the comparison or any wording concern"
                rows={2}
              />
              {!allCompared ? <p className="note-gate">A cited passage could not be matched in the current transcript. Redraft or correct the story instead.</p> : null}
              <button
                type="button"
                className="btn"
                disabled={reverifying || !allConfirmed || !reviewNote.trim() || !currentReady}
                onClick={() => onReverify({ confirmedSegmentIndexes: citations.map((citation) => citation.segmentIndex), note: reviewNote.trim() })}
              >
                {reverifying ? "Saving citation review…" : "Save review against current transcript"}
              </button>
            </div>
          ) : null}
          {onRedraft ? (
            <button type="button" className="btn" disabled={redrafting} onClick={onRedraft}>
              {redrafting ? "Redrafting and rechecking…" : "Redraft from current transcript"}
            </button>
          ) : null}
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
                  {videoId ? (
                    <a className="meeting-citation-time" href={meetingCitationUrl(videoId, c.timestampSeconds)} target="_blank" rel="noreferrer">
                      {meetingClock(c.timestampSeconds)}
                    </a>
                  ) : <span className="meeting-citation-time">{meetingClock(c.timestampSeconds)}</span>}
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
          {candidates.length > visibleCandidates.length ? <p className="note-one">Showing 50 of {candidates.length} timestamped transcript segments considered by the draft.</p> : null}
        </details>
      ) : null}
    </div>
  );
}
