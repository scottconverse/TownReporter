import { meetingTranscriptReadLine } from "@/lib/news/desk-copy";
import {
  transcriptAlignmentLabel,
  transcriptAlignmentAction,
} from "../lib/news/meeting-transcript-alignment-copy.ts";
import type { MeetingTranscriptChoice } from "@/lib/news/meeting-transcript-choice";

export function MeetingTranscriptChooser({
  choices,
  selectedArtifactId,
  onSelect,
  disabled = false,
}: {
  choices: readonly MeetingTranscriptChoice[];
  selectedArtifactId: number | null;
  onSelect: (artifactId: number) => void;
  disabled?: boolean;
}) {
  const selected = choices.find((choice) => choice.artifactId === selectedArtifactId) ?? choices[0];
  if (!selected) return null;
  return (
    <section className="meeting-transcript-chooser" aria-label="Transcript for the reporter">
      <p className="label">Transcript the reporter will read</p>
      {choices.length > 1 ? (
        <div role="group" aria-label="Choose a transcript" className="meeting-transcript-choices">
          {choices.map((choice) => (
            <button
              key={choice.artifactId}
              className="btn quiet"
              type="button"
              aria-pressed={choice.artifactId === selected.artifactId}
              disabled={disabled}
              onClick={() => onSelect(choice.artifactId)}
              style={{ minHeight: 44 }}
            >
              {transcriptAlignmentLabel(choice)}
            </button>
          ))}
        </div>
      ) : null}
      <p role="status" className="meta">
        {meetingTranscriptReadLine(selected.kind)}
      </p>
      <p className="meta">{transcriptAlignmentLabel(selected)}</p>
      {(selected.agendaItemCount ?? 0) === 0 ? (
        <p role="alert" className="meta">
          {transcriptAlignmentAction(choices)}
        </p>
      ) : null}
    </section>
  );
}
