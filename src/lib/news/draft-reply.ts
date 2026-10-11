import type { ChatResult } from "./ai-result-metadata.ts";
import { coerceDraft } from "./coerce-draft.ts";
import { draftLooksCutOff } from "./draft-completeness.ts";
export type DraftReplyResult = ChatResult & { partialText?: string };
/** Keep the exact call on this model for its single retry. */
export async function runDraftReply(attempt: (retryInstruction?: string) => Promise<ChatResult>, minimumWords = 0): Promise<DraftReplyResult> {
  let partialText: string | undefined;
  for (let i = 0; i < 2; i++) {
    const result = await attempt(i ? "Your reply was cut off. Write the complete draft, ending every sentence, as one complete JSON object." : undefined);
    if (!result.ok) return partialText ? { ...result, partialText } : result;
    const draft = coerceDraft(result.text, { headline: "", dek: "", topic: "" });
    if (!draft.body || !draftLooksCutOff(draft.body, minimumWords)) return result;
    partialText = result.text;
  }
  return { ok: false, error: "reply was cut off", partialText };
}
