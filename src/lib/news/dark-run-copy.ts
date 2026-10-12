/** Human-readable stop reason for the Server's Dark Desk run history. */
export function darkRunStopCopy(error: string, summary: string | null): string {
  const outputLimit = /reply was cut off because the output token limit was reached/i.test(
    `${error}\n${summary ?? ""}`,
  );
  const localUnreachable = /local model\b[\s\S]{0,160}?\bis unreachable/i.test(error);

  if (outputLimit && localUnreachable) {
    return "Synthesis stopped because the local server could not be reached. Check that it is running and online. Separately, the brief reply was cut off at the output token limit. Increase the model's output limit or write a shorter brief.";
  }
  if (outputLimit) {
    return "The model reply was cut off at its output token limit. Increase the model's output limit or write a shorter brief.";
  }
  if (localUnreachable) {
    return "The local model server could not be reached. Check that it is running and online, then retry.";
  }
  return error;
}
