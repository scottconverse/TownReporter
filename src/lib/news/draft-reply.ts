import type { ChatResult } from "./ai-result-metadata.ts";
import { coerceDraft } from "./coerce-draft.ts";
import { draftLooksCutOff } from "./draft-completeness.ts";
import { unreadableReplyError } from "./ai.ts";
export type DraftReplyResult = ChatResult & { partialText?: string };
/** Keep the exact call on this model for its single retry. An empty body is a failed attempt, never a saved draft. */
export async function runDraftReply(
  attempt: (retryInstruction?: string) => Promise<ChatResult>,
  minimumWords = 0,
  options: { requireReadable?: boolean; onRetry?: () => void | Promise<void> } = {},
): Promise<DraftReplyResult> {
  let partialText: string | undefined;
  let problem: "unreadable" | "empty" | "cutoff" | null = null;
  for (let i = 0; i < 2; i++) {
    const result = await attempt(
      i
        ? problem === "unreadable"
          ? "Your previous reply could not be read as a draft. Reply with JSON only: one complete JSON object with headline, dek, body, topic and source_urls. Escape quotes and newlines in strings. Do not include commentary."
          : problem === "empty"
            ? "Your previous reply had an empty body. Reply with JSON only: one complete JSON object with headline, dek, body (the full story), topic and source_urls."
            : "Your reply was cut off. Write the complete draft, ending every sentence, as one complete JSON object."
        : undefined,
    );
    if (!result.ok) return partialText ? { ...result, partialText } : result;
    const draft = coerceDraft(result.text, { headline: "", dek: "", topic: "" });
    if (!draft.body || !draft.headline.trim()) {
      // A reply with no JSON object at all is unreadable; one that parsed with a blank headline or body is empty.
      problem = options.requireReadable || !/\{[\s\S]*\}/.test(result.text) ? "unreadable" : "empty";
      if (!i) await options.onRetry?.();
      continue;
    }
    if (!draftLooksCutOff(draft.body, minimumWords)) return result;
    problem = "cutoff";
    partialText = result.text;
  }
  return {
    ok: false,
    error:
      problem === "unreadable"
        ? unreadableReplyError("The writing model")
        : problem === "empty"
          ? "The writing model returned an empty draft."
          : "reply was cut off",
    partialText,
  };
}
