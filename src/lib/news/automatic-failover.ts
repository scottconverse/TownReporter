/**
 * Automatic fails over to the next rung of the ladder when the first
 * provider's login lapsed mid-run, OR when it timed out / produced no
 * output.
 *
 * Live case 2026-09-02, job 41: Automatic pinned to Claude Opus, Claude Code's
 * OAuth token expired between the commit-time probe and the actual draft
 * call, and the job died with `Claude Code error (401): ... OAuth access
 * token has expired.` Codex was never tried, because by the time the job ran,
 * `desk_jobs.model_choice` held the concrete choice ("claude-frontier") and
 * nothing on the row said Automatic had picked it — see
 * `model_choice_source` in migrations/0026_model_choice_source.sql.
 *
 * Live case 2026-09-02 (second one, same day): a different Automatic draft
 * died with `Claude Code request timed out after 150s, 0 bytes out` while
 * both CLIs were signed in. That is not "the login is gone", so the
 * auth-lapse trigger correctly ignored it -- but nothing else caught it
 * either, and the editor got a silent failure instead of Codex. A timeout or
 * a zero-output response reads the same way to an editor as a dead login:
 * the paper didn't get a draft. So Automatic now treats "timed out" (and,
 * defensively, "0 bytes out" without the word "timeout" nearby, though no
 * current adapter produces that shape independently -- see `NO_OUTPUT_RE`'s
 * own comment) as a second trigger, alongside the auth lapse -- each is
 * reported back via `reason` so the caller can word the switch
 * accurately.
 *
 * This is still deliberately narrow. A content refusal, an empty (but non-
 * zero-byte) response, or an error this desk does not recognise must never
 * fail over -- those are not "the login is gone" or "nothing came back", and
 * silently swapping providers on them would hide a real problem behind a
 * different provider's answer. An editor's explicit model choice never falls
 * back either: choosing one model IS choosing not to run the others (see
 * `modelChoiceHelp` in ./model-choice.ts). And a hop only ever goes one rung
 * -- the single retry in desk.ts's `failOverAndRetry` is the whole loop,
 * never more.
 */

import { AUTOMATIC_LADDER, type ProviderProbe } from "./ai.ts";
import { looksLikeProviderAuthFailure, looksLikeTimeoutText } from "./preflight.ts";
import { modelChoiceLabel, storyModelChoice, type StoryModelChoice } from "./model-choice.ts";

export type AutomaticFailoverInput = {
  /** Whether the editor left this job on Automatic, or chose a model explicitly. */
  source: "editor" | "auto";
  /** The concrete choice the job is currently running (or just failed) on. */
  current: string;
  /** The provider's own error text from the failed attempt. */
  error: string;
  /** Injectable so this stays a pure, hermetic function to test. */
  probe: (choice: string) => Promise<ProviderProbe>;
};

/** Why Automatic is moving on, so the caller can word the switch accurately. */
export type AutomaticFailoverReason = "auth" | "timeout";

export type AutomaticFailoverPlan = {
  next: StoryModelChoice;
  label: string;
  reason: AutomaticFailoverReason;
};

/**
 * The other shape the live 150s timeout took: a connection that closed
 * having sent nothing. Defensive/forward-looking today, not an independent
 * trigger in practice (audit-lite 0.6.7 FINDING-002): the only current
 * producer of "0 bytes out" text is `ai-claude-code.server.ts`'s timeout
 * message, and that message always also contains "timed out" on the same
 * line, so `TIMEOUT_RE` (imported as `looksLikeTimeoutText`, shared with
 * `preflight.ts`) already matches every real case this regex sees today.
 * It earns its keep the day some adapter reports a zero-output failure
 * without the word "timeout" in it.
 */
const NO_OUTPUT_RE = /0 bytes out/i;

/** True for a timeout or a response that came back empty of actual output. */
export function looksLikeTimeoutOrNoOutput(detail: string | null | undefined): boolean {
  return looksLikeTimeoutText(detail) || (Boolean(detail) && NO_OUTPUT_RE.test(detail!));
}

/**
 * Decide whether Automatic should move to the next rung, and which one.
 *
 * Returns null unless ALL of: the job was on Automatic; the error reads as
 * either a provider login failure or a timeout/no-output; AUTOMATIC_LADDER
 * has a rung after `current`; and that rung's probe reports ready. Only
 * rungs strictly AFTER `current` are ever tried, in ladder order, and
 * probing stops at the first one that is ready -- a single hop, never a
 * loop.
 *
 * A timeout/no-output reading takes priority over an auth-shaped one when an
 * error happens to match both (e.g. "session expired" wording inside a
 * timeout message): the plan's `reason` is "timeout" in that case, matching
 * the pre-existing rule that a timeout is never treated as a login lapse.
 */
export async function planAutomaticFailover(
  input: AutomaticFailoverInput,
): Promise<AutomaticFailoverPlan | null> {
  if (input.source !== "auto") return null;

  const isTimeout = looksLikeTimeoutOrNoOutput(input.error);
  const isAuthLapse = !isTimeout && looksLikeProviderAuthFailure(input.error);
  if (!isTimeout && !isAuthLapse) return null;
  const reason: AutomaticFailoverReason = isTimeout ? "timeout" : "auth";

  const currentIndex = AUTOMATIC_LADDER.indexOf(input.current as (typeof AUTOMATIC_LADDER)[number]);
  if (currentIndex === -1) return null;

  for (let i = currentIndex + 1; i < AUTOMATIC_LADDER.length; i++) {
    const rung = AUTOMATIC_LADDER[i];
    const probed = await input.probe(rung);
    if (probed.ok) {
      return { next: storyModelChoice(rung), label: probed.label || modelChoiceLabel(rung), reason };
    }
  }
  return null;
}

/**
 * "<previous label> timed out" / "<previous label> sign-in lapsed" -- the
 * one piece of wording every failover site (desk.ts's `failOverAndRetry`,
 * dark.ts, scan-model-run.ts) builds independently for its transient
 * `stage` write. Pulled out here, pure and hermetic, so 0.6.8's durable
 * `failover_note` (desk.ts) can reuse the EXACT same wording instead of a
 * second hand-typed copy that could drift from the stage text.
 */
export function failoverReasonPhrase(previousLabel: string, reason: AutomaticFailoverReason): string {
  return reason === "timeout" ? `${previousLabel} timed out` : `${previousLabel} sign-in lapsed`;
}

/**
 * The durable sentence 0.6.8 writes to `desk_jobs.failover_note` when a
 * Story draft switches providers: "This draft moved to <new label> because
 * <previous label> <reason>."
 */
export function failoverNoteSentence(
  newLabel: string,
  previousLabel: string,
  reason: AutomaticFailoverReason,
): string {
  return `This draft moved to ${newLabel} because ${failoverReasonPhrase(previousLabel, reason)}`;
}
