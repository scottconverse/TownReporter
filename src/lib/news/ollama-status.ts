/*
  The client-safe half of Ollama supervision (DEF-2).

  Types and the desk's exact words live here so the browser bundle never has to
  evaluate `ollama-supervision.server.ts` (which spawns processes and touches
  the disk). `ollama.ts` (the server functions) imports this, and so do the two
  warning boxes.
*/

export type OllamaStatus = {
  /** Something answers on 11434 or 11435 right now. */
  running: boolean;
  root: string | null;
  endpoint: string | null;
  /** True when the answering copy is the one TownReporter started. */
  supervised: boolean;
  /** `ollama` is on PATH or in the normal Windows folder. */
  installed: boolean;
  startedAt: number | null;
};

/** Scott's words, Nov 4 2026. Shown verbatim when no Ollama answers. */
export const OLLAMA_NOT_RUNNING_WORDS =
  "Ollama is not running on this machine. DeepSeek and the local model both run through Ollama. Without it, the desk uses paid models. Install Ollama from ollama.com, then press Check again.";

export const OLLAMA_CHECK_AGAIN = "Check again";

export const OLLAMA_SIGN_IN_LABEL = "Sign in to Ollama";

/** Shown under the link `ollama signin` prints. */
export const OLLAMA_SIGN_IN_LINK_LINE = "Open this link to sign in to ollama.com. You can skip this step.";

/** Older Ollama builds have no `signin` command. Scott's words for that case. */
export const OLLAMA_NO_SIGNIN_WORDS = "This Ollama version has no sign-in. You can skip this step.";

export const OLLAMA_SIGNED_IN_WORDS = "Signed in";
