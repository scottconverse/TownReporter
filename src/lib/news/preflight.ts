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
    "The model was reachable but did not answer in time. This one is worth starting again. If it keeps happening, the machine may be busy or the provider slow.",
  unknown:
    "The model did not answer, and the reason is not one the desk recognises. The provider's own message is below; docs/setup.md covers how the desk picks a provider.",
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
 * Classify by the provider's message.
 *
 * Matching on text is not lovely, but the probe returns opaque strings from
 * three different providers and the alternative is to give every one of them a
 * typed error first. That is the right refactor; this is the fix that stops a
 * new editor hitting a wall today. Anything unrecognised is `unknown` and is
 * NOT assumed retryable — guessing "try again" is the bug being fixed.
 */
export function scanPreflight(probe: ProbeResult): Preflight {
  if (probe.ok) return { ok: true };

  const detail = probe.error ?? "";
  const kind: PreflightKind = /timed out|timeout/i.test(detail)
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

  return {
    ok: false,
    kind,
    guidance: kind === "provider-auth" ? providerAuthGuidance(detail) : GUIDANCE[kind],
    detail,
    retryable: kind === "timeout",
  };
}
