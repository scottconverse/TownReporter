export type MeetingTranscriptChoice = {
  artifactId: number;
  kind: "whisper" | "captions";
};

export function transcriptKind(sourceMethod: string): MeetingTranscriptChoice["kind"] | null {
  if (sourceMethod === "textflowkit-json") return "whisper";
  if (sourceMethod === "yt-dlp-captions") return "captions";
  return null;
}

export function meetingTranscriptChoices(
  rows: readonly { id: number; source_method: string }[],
): MeetingTranscriptChoice[] {
  return rows.flatMap((row) => {
    const kind = transcriptKind(row.source_method);
    return kind ? [{ artifactId: Number(row.id), kind }] : [];
  }).sort((a, b) => Number(b.kind === "whisper") - Number(a.kind === "whisper"));
}

export function defaultMeetingTranscriptArtifactId(
  choices: readonly MeetingTranscriptChoice[],
): number | null {
  return choices.find((choice) => choice.kind === "whisper")?.artifactId
    ?? choices.find((choice) => choice.kind === "captions")?.artifactId
    ?? null;
}

export function meetingArtifactIdFromDraftReceipt(resultJson: string | null | undefined, fallback: number | null): number | null {
  try {
    const receipt = JSON.parse(resultJson || "{}") as { meetingArtifactId?: unknown };
    return Number.isSafeInteger(receipt.meetingArtifactId) && Number(receipt.meetingArtifactId) > 0
      ? Number(receipt.meetingArtifactId)
      : fallback;
  } catch {
    return fallback;
  }
}
