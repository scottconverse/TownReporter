import type { ChatResult } from "./ai-result-metadata.ts";
import { coerceDraft } from "./coerce-draft.ts";
import { draftLooksCutOff } from "./draft-completeness.ts";
import { unreadableReplyError } from "./ai.ts";
export type DraftReplyResult = ChatResult & { partialText?: string };
/** Keep the exact call on this model for its single retry. */
export async function runDraftReply(
  attempt: (retryInstruction?: string) => Promise<ChatResult>,
  minimumWords = 0,
  options: { requireReadable?: boolean; onRetry?: () => void | Promise<void> } = {},
): Promise<DraftReplyResult> {
  let partialText: string | undefined;
  let unreadable = false;
  for (let i = 0; i < 2; i++) {
    const result = await attempt(
      i
        ? unreadable
          ? "Your previous reply could not be read as a draft. Reply with JSON only: one complete JSON object with headline, dek, body, topic and source_urls. Escape quotes and newlines in strings. Do not include commentary."
          : "Your reply was cut off. Write the complete draft, ending every sentence, as one complete JSON object."
        : undefined,
    );
    if (!result.ok) return partialText ? { ...result, partialText } : result;
    const draft = coerceDraft(result.text, { headline: "", dek: "", topic: "" });
    if (!draft.body && options.requireReadable) {
      unreadable = true;
      if (!i) await options.onRetry?.();
      continue;
    }
    if (!draft.body || !draftLooksCutOff(draft.body, minimumWords)) return result;
    unreadable = false;
    partialText = result.text;
  }
  return {
    ok: false,
    error: unreadable ? unreadableReplyError("The writing model") : "reply was cut off",
    partialText,
  };
}
