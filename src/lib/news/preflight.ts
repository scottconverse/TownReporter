/**
 * Is the desk able to do the expensive thing before it starts doing it?
 *
 * An outside audit walked the paper with no model provider present. Scan
 * enqueued a job, fetched every watched source, and only then failed at the
 * model call. The editor saw a failed run with no setup guidance and an
 * invitation to try again — which cannot work, because retrying does not
 * install a model. A first-run dead-end on the core feature is a Blocker.
 *
 * This is the check that runs first. It is a pure function on the probe's
 * answer so it can be tested without a provider, a database, or a browser.
 */

export type ProbeResult = { ok: true; label: string } | { ok: false; error: string };

/** Which kind of not-ready this is. They need different words and different buttons. */
export type PreflightKind =
  "unconfigured" | "cli-missing" | "codex-missing" | "provider-auth" | "timeout" | "unknown";

export type Preflight =
  | { ok: true }
  | {
      ok: false;
      kind: PreflightKind;
      /** What the editor should do next. Never "try again" unless that can work. */
      guidance: string;
      /** The provider's own words, kept so an operator can see the detail. */
      detail: string;
      /** Whether pressing the button again could possibly help. */
      retryable: boolean;
    };

/**
 * Guidance per kind.
 *
 * Each one names a concrete next action. None of them says "try again": the
 * audit's specific complaint was that the desk told the editor to retry a
 * thing no retry can fix.
 */
const GUIDANCE: Record<PreflightKind, string> = {
  unconfigured:
    "No model is set up yet. Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY, or point LLM_BASE_URL at any OpenAI-compatible endpoint — a local model counts. See docs/setup.md. Nothing is spent until one of those answers.",
  "cli-missing":
    "Claude Code is the default and it is not installed here. Install it with `npm i -g @anthropic-ai/claude-code` and run `claude` once to sign in, or set CLAUDE_CLI_PATH to its binary, or set ANTHROPIC_API_KEY to bill a key instead. See docs/setup.md.",
  "codex-missing":
    "Codex is not installed on this machine. Install the Codex CLI, open Codex and sign in, then choose Codex again. Nothing was queued or spent.",
  "provider-auth":
    "The selected model is signed out. Open that provider on this machine, sign in, then choose it again. Nothing was queued or spent.",
  timeout:
    "The selected model was reachable but did not answer the readiness check in time. No model job was started, nothing was spent, and your saved work is unchanged. Choose another model, or try this one again if the machine was busy.",
  unknown:
    "The model did not answer, and the reason is not one the desk recognizes. The provider's own message is below; docs/setup.md covers how the desk picks a provider.",
};

const PROVIDER_AUTH_GUIDANCE = {
  codex:
    "Codex needs you to sign in again. Open Codex on this machine and sign in, then start this action again. Nothing was queued or spent.",
  claude:
    "Claude Code needs you to sign in again. Open Claude Code on this machine and sign in, then start this action again. Nothing was queued or spent.",
  anthropicKey:
    "Claude rejected ANTHROPIC_API_KEY. Update that key, or open Claude Code on this machine and sign in, then start this action again. Nothing was queued or spent.",
} as const;

/**
 * The provider said the login is gone. Shared with the desk copy so a 401
 * that arrives MID-RUN (the preflight passed, the token expired between the
 * login check and the call) gets the same "sign in again" answer, not "click
 * again". 2026-09-02: a live draft failed with "OAuth access token has
 * expired" and the desk told the editor to retry.
 */
const PROVIDER_AUTH_RE =
  /signed out|not logged|unauthorized|sign in|rejected.*credentials|credentials.*rejected|invalid.*(?:credential|api key)|oauth.*expired|(?:login|auth(?:entication)?|session).*expired|expired.*(?:oauth|login|auth(?:entication)?|session)|failed to authenticate|re-?authenticate|\b401\b/i;

export function looksLikeProviderAuthFailure(detail: string | null | undefined): boolean {
  return Boolean(detail) && PROVIDER_AUTH_RE.test(detail!);
}

/**
 * "The provider was reachable but slow (or said so directly)." Shared with
 * `automatic-failover.ts` (audit-lite 0.6.7 FINDING-003: this regex used to
 * be defined independently in both files -- same question, "does this error
 * text mean the model was reachable but slow?", answered twice, with no
 * shared source of truth to keep a future wording change from silently
 * diverging between this probe-time guidance and that post-run failover
 * decision).
 */
const TIMEOUT_RE = /timed out|timeout/i;

export function looksLikeTimeoutText(detail: string | null | undefined): boolean {
  return Boolean(detail) && TIMEOUT_RE.test(detail!);
}

/** Which login is the one that lapsed. */
export type ProviderAuthTarget = "codex" | "anthropicKey" | "claude" | "unknown";

export function providerAuthTarget(detail: string): ProviderAuthTarget {
  if (/\bcodex\b/i.test(detail)) return "codex";
  if (/ANTHROPIC_API_KEY|rejected.*credentials/i.test(detail)) return "anthropicKey";
  if (/\bclaude(?:\s+code)?\b|\banthropic\b|oauth/i.test(detail)) return "claude";
  return "unknown";
}

function providerAuthGuidance(detail: string): string {
  const target = providerAuthTarget(detail);
  if (target === "unknown") return GUIDANCE["provider-auth"];
  return PROVIDER_AUTH_GUIDANCE[target];
}

/**
 * What the desk says when the editor explicitly picked "Local model" and no
 * local server is configured. One message, not the generic "sign in to
 * Claude Code or Codex" guidance stacked on top of the provider's own "AI is
 * not available" text -- an owner screenshot (2026-09-05) showed both boxes
 * on the story page for a run that never had anything to sign in to. This is
 * also the message `provider-registry.ts`'s picker shows next to a disabled
 * "Local model" option, so the two surfaces agree.
 */
export const LOCAL_MODEL_UNCONFIGURED =
  "TownReporter cannot reach a local model. Start LM Studio's local server or Ollama, then click Refresh under Local model. For a server at a different address, set LLM_BASE_URL. See docs/local-models.md. Nothing was spent.";

/**
 * What the desk calls each local server it knows how to probe.
 *
 * Lives here, next to the sentences below, because `ai.ts` (which refuses a
 * hand-picked model that is not loaded) and `model-choice.ts` (which explains
 * the same thing under the picker, client-side) both need to name the server
 * the same way the operator does. `preflight.ts` imports nothing, so both can
 * use it without dragging `local-models.ts`'s server-only `.server.ts` code
 * into the browser bundle.
 */
export function localServerName(kind: string): string {
  if (kind === "lmstudio") return "LM Studio";
  if (kind === "ollama") return "Ollama";
  if (kind === "llamacpp") return "llama.cpp";
  return "the local server";
}

/**
 * Unit BB item 2's refusal: the editor picked "Use whatever is loaded" and
 * neither LM Studio nor Ollama has a model in memory.
 *
 * Scott asked for these exact words (2026-09-26), and they are the whole
 * answer to "never load a model": the desk cannot pull a model in, so the run
 * stops here rather than asking a server for something it would have to page
 * in from disk. The "or pick a model" half is not filler -- the picker lists
 * every model on disk and an editor may load one themselves.
 */
export const LOCAL_MODEL_NOTHING_LOADED =
  "Local model: nothing is loaded in LM Studio or Ollama. Load a model there, or pick a model.";

/**
 * Unit BB item 4's refusal for a hand-picked, on-device model that the server
 * says is not in memory. Same rule: refuse before the call, never load.
 */
export function localModelNotLoadedMessage(id: string, serverKind: string): string {
  return `${id} is not loaded in ${localServerName(serverKind)}. Load it there, or pick Use whatever is loaded.`;
}

/**
 * Is this refusal one of the desk's own two sentences?
 *
 * `scanPreflight` below has to recognize them by text because that is all the
 * probe returns, and getting this wrong is how the item-2 message would reach
 * the editor as the generic "sign in to Claude Code or Codex" guidance
 * instead. Kept as one predicate so the two sentences can never drift apart.
 */
export function isLocalModelNotReady(message: string): boolean {
  if (!message) return false;
  return message === LOCAL_MODEL_NOTHING_LOADED || / is not loaded in .*\. Load it there, or pick Use whatever is loaded\.$/.test(message);
}

/**
 * Classify by the provider's message.
 *
 * Matching on text is not lovely, but the probe returns opaque strings from
 * three different providers and the alternative is to give every one of them a
 * typed error first. That is the right refactor; this is the fix that stops a
 * new editor hitting a wall today. Anything unrecognized is `unknown` and is
 * NOT assumed retryable — guessing "try again" is the bug being fixed.
 *
 * `modelChoice`, when passed, is the id the editor actually picked (not
 * "auto"). It only changes ONE thing: an "unconfigured" refusal for
 * `"local-model"` specifically gets `LOCAL_MODEL_UNCONFIGURED` instead of the
 * generic sign-in-to-a-CLI guidance, which names logins this pick has
 * nothing to do with.
 */
export function scanPreflight(probe: ProbeResult, modelChoice?: string): Preflight {
  if (probe.ok) return { ok: true };

  const detail = probe.error ?? "";

  // The desk's own local-model refusals are complete sentences already: they
  // name the model, the server and the fix, and the operator reads them
  // verbatim. They must reach the editor as the guidance, not be re-labelled
  // "unavailable" and shown alongside sign-in advice for a CLI this choice has
  // nothing to do with.
  if (isLocalModelNotReady(detail)) {
    return { ok: false, kind: "unconfigured", guidance: detail, detail: "", retryable: false };
  }

  const kind: PreflightKind = looksLikeTimeoutText(detail)
    ? "timeout"
    : /Codex is not installed|Codex CLI.*not found/i.test(detail)
      ? "codex-missing"
      : /CLI not found|claude-code|CLAUDE_CLI_PATH/i.test(detail)
        ? "cli-missing"
        : looksLikeProviderAuthFailure(detail)
          ? "provider-auth"
          : /not available|ANTHROPIC_API_KEY|LLM_BASE_URL|XAI_API_KEY/i.test(detail)
            ? "unconfigured"
            : "unknown";

  const guidance =
    kind === "unconfigured" && modelChoice === "local-model"
      ? LOCAL_MODEL_UNCONFIGURED
      : kind === "provider-auth"
        ? providerAuthGuidance(detail)
        : GUIDANCE[kind];

  return {
    ok: false,
    kind,
    guidance,
    // The provider's raw text is redundant with LOCAL_MODEL_UNCONFIGURED
    // (which already says everything relevant); dropping it here is what
    // stops a caller that renders `${guidance}\n\n${detail}` from doubling
    // up on this specific, already-complete message.
    detail: guidance === LOCAL_MODEL_UNCONFIGURED ? "" : detail,
    retryable: kind === "timeout",
  };
}
