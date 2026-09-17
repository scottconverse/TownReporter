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
import type { DeskJob, setJobModelChoice, setJobModelRuntime, setJobStage, setJobFailoverNote } from "./jobs.ts";
import { modelChoiceLabel } from "./model-choice.ts";
import {
  planAutomaticFailover,
  automaticFailoverReason,
  looksLikeProviderQuota,
  failoverReasonPhrase,
  failoverNoteSentence,
} from "./automatic-failover.ts";
import { modelEffort as validatedModelEffort } from "./provider-registry.ts";

export type ReportedDraftResult = Awaited<ReturnType<typeof reportAndDraft>>;
export type DraftInput = Omit<Parameters<typeof reportAndDraft>[0], "modelChoice">;

/** Retry one already-built model call on a technical failure. Callers keep
 * every completed research/checkpoint outside this helper and pass the exact
 * same call payload to `run`, so fallback cannot repeat earlier work. */
export async function runPinnedCallWithFailover<
  TSnapshot extends { modelChoice: string },
  TResult extends { ok: boolean; error?: string },
>(opts: {
  snapshot: TSnapshot;
  source: "editor" | "auto" | "scheduled";
  run: (snapshot: TSnapshot) => Promise<TResult>;
  probe: typeof probeProvider;
  ladder?: readonly string[];
  resolve: (choice: Exclude<ReturnType<typeof import("./model-choice.ts").storyModelChoice>, "auto">) => Promise<TSnapshot>;
  onSwitch: (input: {
    previousLabel: string;
    nextLabel: string;
    nextChoice: string;
    reason: import("./automatic-failover.ts").AutomaticFailoverReason;
  }) => Promise<void>;
}): Promise<{ result: TResult; snapshot: TSnapshot }> {
  const first = await opts.run(opts.snapshot);
  if (first.ok || !first.error) return { result: first, snapshot: opts.snapshot };
  const plan = await planAutomaticFailover({
    source: opts.source,
    current: opts.snapshot.modelChoice,
    error: first.error,
    probe: opts.probe,
    ladder: opts.ladder,
  });
  if (!plan || plan.next === "auto") return { result: first, snapshot: opts.snapshot };
  const next = await opts.resolve(plan.next);
  await opts.onSwitch({
    previousLabel: modelChoiceLabel(opts.snapshot.modelChoice),
    nextLabel: plan.label,
    nextChoice: plan.next,
    reason: plan.reason,
  });
  return { result: await opts.run(next), snapshot: next };
}

/** Keep terminal provider-limit errors in the Story vocabulary. The shared
 * desk renderer also serves Opinion, whose quota copy must not be shown for a
 * Story job. Deliberately avoid the renderer's quota trigger words here while
 * preserving the reset detail when the provider supplied one. */
export function storyProviderFailure(error: string): string {
  if (!looksLikeProviderQuota(error) || automaticFailoverReason(error) !== "quota") return error;
  const reset = error
    .match(/resets?\s+(?:at\s+)?([^.,;]+(?:\s+[AP]M\s+[A-Z]{2,5})?)/i)?.[1]
    ?.trim();
  // Preserve the useful Automatic probe result while omitting the original
  // quota tokens that the shared Opinion renderer uses as its trigger.
  const automaticDetail = error.match(/Automatic (?:tried|retry)[\s\S]*$/i)?.[0]?.trim();
  const detail = automaticDetail ? ` ${automaticDetail}` : "";
  return reset
    ? `Story drafting is paused because the selected writing provider reached its allowance. It resets ${reset}.${detail} Your saved material was preserved; retry after that time.`
    : `Story drafting is paused because the selected writing provider reached its allowance.${detail} Your saved material was preserved; retry Story after the provider is available.`;
}

/** Run one non-draft stage (for example uploaded-document interpretation) on
 * the same Automatic failover seam as the final writer. Document reading is
 * intentionally before reportAndDraft, so wrapping only the writer leaves a
 * quota or unavailable provider error with no opportunity to move to Codex.
 * The callback receives one later rung and is never called more than once. */
export async function failOverOperationAndRetry<T>(opts: {
  job: DeskJob;
  error: string;
  operation: (choice: string) => Promise<T>;
  probe: typeof probeProvider;
  setModelChoice: typeof setJobModelChoice;
  setStage: typeof setJobStage;
  setFailoverNote: typeof setJobFailoverNote;
}): Promise<{ ok: true; value: T; choice: string } | { ok: false; error: string }> {
  const rejectedRungs: Array<{ choice: string; error: string }> = [];
  const plan = await planAutomaticFailover({
    source: opts.job.model_choice_source ?? "editor",
    current: opts.job.model_choice,
    error: opts.error,
    probe: async (choice) => {
      const result = await opts.probe(choice);
      if (!result.ok) rejectedRungs.push({ choice, error: result.error });
      return result;
    },
  });
  if (!plan) {
    const source = opts.job.model_choice_source ?? "editor";
    const rejectedRung = rejectedRungs.at(-1);
    if (source === "auto" && rejectedRung && automaticFailoverReason(opts.error)) {
      const label = modelChoiceLabel(rejectedRung.choice);
      return {
        ok: false,
        error: storyProviderFailure(
          `${opts.error} Automatic tried ${label} next, but it was not ready: ${rejectedRung.error}`,
        ),
      };
    }
    return { ok: false, error: storyProviderFailure(opts.error) };
  }

  const previousLabel = modelChoiceLabel(opts.job.model_choice);
  await opts.setModelChoice(opts.job.id, plan.next);
  await opts.setStage(
    opts.job.id,
    `Switched to ${plan.label}: ${failoverReasonPhrase(previousLabel, plan.reason)}`,
  );
  await opts.setFailoverNote(
    opts.job.id,
    failoverNoteSentence(plan.label, previousLabel, plan.reason),
  );
  try {
    return { ok: true, value: await opts.operation(plan.next), choice: plan.next };
  } catch (retryError) {
    const detail = retryError instanceof Error ? retryError.message : String(retryError);
    return {
      ok: false,
      error: storyProviderFailure(`Automatic retry on ${plan.label} failed: ${detail}`),
    };
  }
}

/** Injectable seam so a job with a real Claude/Codex 401 mid-run, and the
 * failover it triggers, can be tested without a real provider. Defaults to
 * the real functions -- the same pattern `reportAndDraft` uses for its own
 * `ReportDeps`. */
export type PerformDraftWorkDeps = {
  reportAndDraft?: typeof reportAndDraft;
  /** Fakeable provider boundary for the ordinary Story call-level fallback. */
  chat?: typeof import("./ai.ts").grokChat;
  /** Test seam for the pre-writer uploaded-document stage. Production uses
   * readStoryDocuments; the seam keeps its provider failure at the same
   * Automatic failover boundary without requiring a live provider in tests. */
  readStoryDocuments?: typeof import("./story-documents.server.ts").readStoryDocuments;
  probe?: typeof probeProvider;
  setJobModelChoice?: typeof setJobModelChoice;
  setJobModelRuntime?: typeof setJobModelRuntime;
  setJobStage?: typeof setJobStage;
  setJobFailoverNote?: typeof setJobFailoverNote;
  batchChatAdapters?: {
    claude: (input: {
      system: string;
      user: string;
      model: string;
      timeoutMs: number;
      noTools?: boolean;
      reasoningEffort?: import("./provider-registry.ts").ModelEffort | null;
    }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    codex: (input: {
      system: string;
      user: string;
      model: string;
      timeoutMs: number;
    }) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
    local: typeof import("./ai.ts").grokChat;
    custom: typeof import("./ai.ts").grokChat;
    xai: typeof import("./ai.ts").grokChat;
  };
  batchOcrAdapters?: import("./ocr.ts").OcrAdapters;
  /** Hermetic resolver for batch failover tests; production uses the shared
   * forced-runtime validator. */
  validateBatchRuntime?: typeof import("./forced-runtime.server.ts").validateForcedRuntime;
};

/**
 * The first attempt failed. If the job was on Automatic and the failure
 * reads as "the login is gone", "it timed out / sent nothing back", "its
 * allowance is exhausted", or "it is unavailable" (not a refusal or an
 * unknown error), try exactly one later rung of the ladder
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
  const { job, error, draftInput, runReport, probe, setModelChoice, setStage, setFailoverNote } =
    opts;
  const source = job.model_choice_source ?? "editor";
  const rejectedRungs: Array<{ choice: string; error: string }> = [];
  const plan = await planAutomaticFailover({
    source,
    current: job.model_choice,
    error,
    probe: async (choice) => {
      const result = await probe(choice);
      if (!result.ok) rejectedRungs.push({ choice, error: result.error });
      return result;
    },
  });
  if (!plan) {
    // Explain WHY Automatic did not move on, when it looked close: still on
    // Automatic, still an auth failure or a timeout/no-output, and a later
    // rung existed -- it just was not ready either. The original wording
    // from the first failure survives so the desk's own classifier
    // (scanPreflight) still reads it the same way it always did.
    const rejectedRung = rejectedRungs.at(-1);
    if (source === "auto" && rejectedRung && automaticFailoverReason(error)) {
      const label = modelChoiceLabel(rejectedRung.choice);
      return {
        error: storyProviderFailure(
          `${error} Automatic tried ${label} next, but it was not ready: ${rejectedRung.error}`,
        ),
      };
    }
    return { error: storyProviderFailure(error) };
  }

  const previousLabel = modelChoiceLabel(job.model_choice);
  await setModelChoice(job.id, plan.next);
  const switchedBecause = failoverReasonPhrase(previousLabel, plan.reason);
  await setStage(job.id, `Switched to ${plan.label}: ${switchedBecause}`);
  // Durable twin of the stage write above: `stage` gets overwritten by
  // "Done" once the job finishes, so without this the editor could see the
  // switch reason mid-run but never again once the draft landed.
  await setFailoverNote(job.id, failoverNoteSentence(plan.label, previousLabel, plan.reason));
  const retried = await runReport({
    ...draftInput,
    modelChoice: plan.next,
    modelEffort:
      draftInput.modelEffort == null
        ? null
        : validatedModelEffort(plan.next, draftInput.modelEffort),
  });
  return "error" in retried ? { error: storyProviderFailure(retried.error) } : retried;
}
