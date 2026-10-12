import type { MeetingTranscriptChoice } from "./meeting-transcript-choice.ts";

/** The source's name as the editor knows it: "Whisper transcript" or "YouTube captions". */
export function transcriptSourceName(choice: MeetingTranscriptChoice): string {
  return choice.kind === "whisper" ? "Whisper transcript" : "YouTube captions";
}

export function transcriptAlignmentLabel(choice: MeetingTranscriptChoice): string {
  const source = transcriptSourceName(choice);
  const count = choice.agendaItemCount ?? 0;
  return `${source} (${choice.date ?? "date unknown"}, transcript ${choice.artifactId}) — ${count > 0 ? `aligned to ${count} agenda item${count === 1 ? "" : "s"}` : "not aligned to agenda items"}`;
}

export function transcriptAlignmentAction(choices: readonly MeetingTranscriptChoice[]): string {
  const alternatives = choices.filter((choice) => (choice.agendaItemCount ?? 0) > 0);
  return alternatives.length
    ? `Pick the ${alternatives.map(transcriptAlignmentLabel).join(" or the ")}, or run the agenda alignment for this transcript.`
    : "Run the agenda alignment for this transcript before drafting. No saved transcript for this meeting is aligned to agenda items.";
}

/**
 * The aligned transcript a failed draft tells the editor to pick, found in the
 * "Pick the ... (transcript N) ..." clause of `transcriptAlignmentAction`. Null
 * when the failure names no aligned transcript the desk actually has.
 */
export function transcriptToPickFromFailure(
  failure: string,
  choices: readonly MeetingTranscriptChoice[],
): MeetingTranscriptChoice | null {
  const pickClause = /Pick the (.+?)(?:, or run the agenda alignment|$)/.exec(failure);
  if (!pickClause) return null;
  for (const match of pickClause[1].matchAll(/transcript (\d+)/g)) {
    const named = choices.find((choice) => choice.artifactId === Number(match[1]) && (choice.agendaItemCount ?? 0) > 0);
    if (named) return named;
  }
  return null;
}
