import type { grokChat } from './ai.ts';
import { effectiveStoryModelChoice } from './model-choice.ts';
import type { DupCheckChat } from './dup-check.ts';

type ScanChatOptions = NonNullable<Parameters<typeof grokChat>[3]>;
/** The scan's auxiliary calls share its pinned provider, effort and local model. */
export function scanDuplicateChat(
  snapshot: Omit<ScanChatOptions, 'choice'> & { modelChoice: unknown },
  chat: typeof grokChat,
): DupCheckChat {
  return async (system, user, maxTokens) => {
    const { modelChoice, ...options } = snapshot;
    const choice = effectiveStoryModelChoice(modelChoice);
    const got = await chat(system, user, maxTokens, { ...options, choice });
    return got.ok ? {ok:true, text:got.text, model:got.meta?.model ?? null} : {ok:false,error:got.error};
  };
}
