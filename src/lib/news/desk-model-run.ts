/**
 * The Draft half of the one-shot Automatic failover (see
 * `automatic-failover.ts` and `runScanChatWithFailover` in
 * `scan-model-run.ts`, the same pattern for Scan). Pulled out of
 * `performDraftWork`/`desk.ts` into its own relative-imports-only module for
 * the same reason `scan-model-run.ts` was split out: `desk.ts` imports
 * `@/lib/db`, which only resolves under the Vite alias config and cannot be
 * loaded by a plain `node --test` process, so `failOverAndRetry` -- the
 * exact function the 2026-09-02 production incidents hit -- had no
 * regression test, old or new (audit-lite 0.6.7 FINDING-001). Everything
 * this file imports at runtime is a relative, alias-free module already
 * proven safe under `node --test` by `scan-model-run.ts` and its tests.
 */
import type { reportAndDraft } from "./report.ts";
import type { probeProvider } from "./ai.ts";
import { AUTOMATIC_LADDER } from "./ai.ts";
import type { DeskJob, setJobModelChoice, setJobStage, setJobFailoverNote } from "./jobs.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import {
  planAutomaticFailover,
  looksLikeTimeoutOrNoOutput,
  failoverReasonPhrase,
  failoverNoteSentence,
} from "./automatic-failover.ts";
import { looksLikeProviderAuthFailure } from "./preflight.ts";

export type ReportedDraftResult = Awaited<ReturnType<typeof reportAndDraft>>;
export type DraftInput = Omit<Parameters<typeof reportAndDraft>[0], "modelChoice">;

/** Injectable seam so a job with a real Claude/Codex 401 mid-run, and the
 * failover it triggers, can be tested without a real provider. Defaults to
 * the real functions -- the same pattern `reportAndDraft` uses for its own
 * `ReportDeps`. */
export type PerformDraftWorkDeps = {
  reportAndDraft?: typeof reportAndDraft;
  probe?: typeof probeProvider;
  setJobModelChoice?: typeof setJobModelChoice;
  setJobStage?: typeof setJobStage;
  setJobFailoverNote?: typeof setJobFailoverNote;
};

/**
 * The first attempt failed. If the job was on Automatic and the failure
 * reads as "the login is gone" or "it timed out / sent nothing back" (not a
 * refusal or an unknown error), try exactly one later rung of the ladder
 * and, if it is ready, run the draft again on it -- once. Anything else,
 * including a second failure on the new rung, is returned/thrown as-is by
 * the caller.
 */
export async function failOverAndRetry(opts: {
  job: DeskJob;
  error: string;
  draftInput: DraftInput;
  runReport: typeof reportAndDraft;
  probe: typeof probeProvider;
  setModelChoice: typeof setJobModelChoice;
  setStage: typeof setJobStage;
  setFailoverNote: typeof setJobFailoverNote;
}): Promise<ReportedDraftResult> {
  const { job, error, draftInput, runReport, probe, setModelChoice, setStage, setFailoverNote } = opts;
  const source = job.model_choice_source ?? "editor";
  const plan = await planAutomaticFailover({
    source,
    current: job.model_choice,
    error,
    probe: (choice) => probe(choice),
  });
  if (!plan) {
    // Explain WHY Automatic did not move on, when it looked close: still on
    // Automatic, still an auth failure or a timeout/no-output, and a later
    // rung existed -- it just was not ready either. The original wording
    // from the first failure survives so the desk's own classifier
    // (scanPreflight) still reads it the same way it always did.
    const ladderIndex = AUTOMATIC_LADDER.indexOf(
      job.model_choice as (typeof AUTOMATIC_LADDER)[number],
    );
    const hasLaterRung = ladderIndex !== -1 && ladderIndex < AUTOMATIC_LADDER.length - 1;
    const wouldHaveTried =
      source === "auto" &&
      hasLaterRung &&
      (looksLikeTimeoutOrNoOutput(error) || looksLikeProviderAuthFailure(error));
    if (wouldHaveTried) {
      const nextRung = AUTOMATIC_LADDER[ladderIndex + 1]!;
      const nextProbe = await probe(nextRung);
      const label = modelChoiceLabel(nextRung);
      const why = nextProbe.ok ? "" : nextProbe.error;
      return { error: `${error} Automatic tried ${label} next, but it was not ready: ${why}` };
    }
    return { error };
  }

  const previousLabel = modelChoiceLabel(job.model_choice);
  await setModelChoice(job.id, plan.next);
  const switchedBecause = failoverReasonPhrase(previousLabel, plan.reason);
  await setStage(job.id, `Switched to ${plan.label}: ${switchedBecause}`);
  // Durable twin of the stage write above: `stage` gets overwritten by
  // "Done" once the job finishes, so without this the editor could see the
  // switch reason mid-run but never again once the draft landed.
  await setFailoverNote(job.id, failoverNoteSentence(plan.label, previousLabel, plan.reason));
  return runReport({ ...draftInput, modelChoice: plan.next });
}
