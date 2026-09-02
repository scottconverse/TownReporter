/**
 * Automatic fails over to the next rung of the ladder ONLY when the first
 * provider's login lapsed mid-run.
 *
 * Live case 2026-09-02, job 41: Automatic pinned to Claude Opus, Claude Code's
 * OAuth token expired between the commit-time probe and the actual draft
 * call, and the job died with `Claude Code error (401): ... OAuth access
 * token has expired.` Codex was never tried, because by the time the job ran,
 * `desk_jobs.model_choice` held the concrete choice ("claude-frontier") and
 * nothing on the row said Automatic had picked it — see
 * `model_choice_source` in migrations/0026_model_choice_source.sql.
 *
 * This is deliberately narrow. A content refusal, a timeout, an empty
 * response, or an error this desk does not recognise must never fail over —
 * those are not "the login is gone", and silently swapping providers on them
 * would hide a real problem behind a different provider's answer. An
 * editor's explicit model choice never falls back either: choosing one model
 * IS choosing not to run the others (see `modelChoiceHelp` in
 * ./model-choice.ts).
 */

import { AUTOMATIC_LADDER, type ProviderProbe } from "./ai.ts";
import { looksLikeProviderAuthFailure } from "./preflight.ts";
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

export type AutomaticFailoverPlan = { next: StoryModelChoice; label: string };

/** A timeout is "the provider was reachable but slow", not "signed out" — never fails over. */
const TIMEOUT_RE = /timed out|timeout/i;

/**
 * Decide whether Automatic should move to the next rung, and which one.
 *
 * Returns null unless ALL of: the job was on Automatic; the error reads as a
 * provider login failure and not a timeout; AUTOMATIC_LADDER has a rung after
 * `current`; and that rung's probe reports ready. Only rungs strictly AFTER
 * `current` are ever tried, in ladder order, and probing stops at the first
 * one that is ready.
 */
export async function planAutomaticFailover(
  input: AutomaticFailoverInput,
): Promise<AutomaticFailoverPlan | null> {
  if (input.source !== "auto") return null;
  if (!looksLikeProviderAuthFailure(input.error)) return null;
  if (TIMEOUT_RE.test(input.error)) return null;

  const currentIndex = AUTOMATIC_LADDER.indexOf(input.current as (typeof AUTOMATIC_LADDER)[number]);
  if (currentIndex === -1) return null;

  for (let i = currentIndex + 1; i < AUTOMATIC_LADDER.length; i++) {
    const rung = AUTOMATIC_LADDER[i];
    const probed = await input.probe(rung);
    if (probed.ok) {
      return { next: storyModelChoice(rung), label: probed.label || modelChoiceLabel(rung) };
    }
  }
  return null;
}
