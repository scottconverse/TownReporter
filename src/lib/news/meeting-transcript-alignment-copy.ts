import type { MeetingTranscriptChoice } from "./meeting-transcript-choice.ts";

export function transcriptAlignmentLabel(choice: MeetingTranscriptChoice): string {
  const source = choice.kind === "whisper" ? "Whisper transcript" : "YouTube captions";
  const count = choice.agendaItemCount ?? 0;
  return `${source} (${choice.date ?? "date unknown"}, transcript ${choice.artifactId}) — ${count > 0 ? `aligned to ${count} agenda item${count === 1 ? "" : "s"}` : "not aligned to agenda items"}`;
}

export function transcriptAlignmentAction(choices: readonly MeetingTranscriptChoice[]): string {
  const alternatives = choices.filter((choice) => (choice.agendaItemCount ?? 0) > 0);
  return alternatives.length
    ? `Pick the ${alternatives.map(transcriptAlignmentLabel).join(" or the ")}, or run the agenda alignment for this transcript.`
    : "Run the agenda alignment for this transcript before drafting. No saved transcript for this meeting is aligned to agenda items.";
}
