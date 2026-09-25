/**
 * The Scan half of the one-shot Automatic failover Draft has (see
 * `automatic-failover.ts` and `failOverAndRetry` in desk.ts). Pulled out of
 * `performScanWork` into its own relative-imports-only module for two
 * reasons: `desk.ts` imports `@/lib/db`, which only resolves under the Vite
 * alias config and cannot be loaded by a plain `node --test` process, so the
 * retry decision could not be unit tested where it lived; and `desk.ts`
 * itself has to stay `createServerOnlyFn`-wrapped end to end (see the
 * comment on `performScanWork`), so a smaller, hermetic piece is easier to
 * reason about in isolation.
 */
import type { EffectiveProviderChoice, ProviderProbe, LocalModelOverride, grokChat } from "./ai.ts";
import { providerBudget, readableReplyOrRetry } from "./ai.ts";
import {
  modelEffort as validatedModelEffort,
  type ModelEffort,
  type ProviderOverrides,
} from "./provider-registry.ts";
import { effectiveStoryModelChoice, modelChoiceLabel } from "./model-choice.ts";
import {
  planAutomaticFailover,
  failoverReasonPhrase,
  failoverNoteSentence,
} from "./automatic-failover.ts";

/**
 * The scan's one AI read used to hardcode 90s regardless of provider, while
 * Story drafts size every call with `providerBudget(choice).callMs` (150s on
 * the Claude Code / Codex CLIs, which reload a ~25k-token preamble per call
 * and routinely land in the 60-90s range on a full 31-source read). 2026-09-02
 * production timeout (desk_jobs 46 / scan_runs 5): 31 sources fetched clean in
 * ~35s, then the single AI read died at "timed out after 90s, 0 bytes out"
 * even though past successful scans took 1:43-2:29 end to end. Floor stays at
 * 90s so the configured-gateway path (150s wall budget, smaller callMs) is
 * never made worse than it already was.
 */
export function scanCallTimeoutMs(choice: string, overrides?: ProviderOverrides | null): number {
  return Math.max(90_000, providerBudget(choice, overrides).callMs);
}

/**
 * The same function, bound to one paper's stored overrides, in the shape
 * `runScanChatWithFailover` wants: `(choice) => ms`, re-evaluated per attempt
 * so a mid-run failover is sized by the rung it actually moved to.
 */
export function scanCallTimeoutFor(
  overrides?: ProviderOverrides | null,
): (choice: string) => number {
  return (choice: string) => scanCallTimeoutMs(choice, overrides);
}

type GrokResult = Awaited<ReturnType<typeof grokChat>>;
type GrokChatFn = (
  system: string,
  user: string,
  maxTokens: number,
  opts?: {
    timeoutMs?: number;
    model?: string;
    choice?: EffectiveProviderChoice;
    newsroomId?: number;
    localModel?: LocalModelOverride | null;
    reasoningEffort?: ModelEffort | null;
  },
) => Promise<GrokResult>;

export type ScanJobForFailover = {
  id: number;
  model_choice: string;
  model_choice_source: "editor" | "auto" | "scheduled";
};

export type RunScanChatWithFailoverInput = {
  job: ScanJobForFailover;
  /** Authenticated scope used only when the pinned choice is custom:<UUID>. */
  newsroomId?: number;
  localModel?: LocalModelOverride | null;
  system: string;
  user: string;
  maxTokens: number;
  modelEffort?: ModelEffort | null;
  /**
   * Sized per attempt, not once up front: when Automatic fails over mid-run
   * to a later ladder rung, the retry runs on THAT rung's own budget (a CLI
   * rung gets far longer than the configured-gateway path). Callers that
   * really do want one fixed number for every attempt can pass `() => ms`.
   */
  timeoutMs: (choice: string) => number;
  grokChat: GrokChatFn;
  /**
   * Says whether a SUCCESSFUL reply is the JSON the scan asked for.
   *
   * 0.6.63, Unit Y item 3. A reply the desk cannot read is not a success even
   * though the transport called it one: given this validator, such a reply is
   * retried once on the same rung and then reported unreadable, which makes it
   * an ordinary `!ai.ok` failure for the one-hop failover below -- so a model
   * that stutters twice moves the batch to the next rung instead of ending the
   * scan. Omitted, a successful reply is taken at its word (the pre-0.6.63
   * behaviour, kept for callers whose reply is not JSON).
   */
  read?: (text: string) => boolean;
  probe: (choice: string) => Promise<ProviderProbe>;
  setModelChoice: (id: number, choice: string) => Promise<void>;
  setStage: (id: number, stage: string) => Promise<void>;
  setFailoverNote?: (id: number, note: string) => Promise<void>;
  onSwitch?: (receipt: {
    previousChoice: string;
    nextChoice: string;
    previousLabel: string;
    nextLabel: string;
    nextEffort: ModelEffort | null;
    reason: import("./automatic-failover.ts").AutomaticFailoverReason;
    switchReason: string;
    switchNote: string;
  }) => Promise<void>;
};

/**
 * Run the scan's one AI read on the job's pinned model. If it fails and the
 * job has a login-lapse-shaped OR timeout/no-output-shaped
 * error, try exactly one later rung of AUTOMATIC_LADDER, once -- reusing the
 * SAME `system`/`user` text, never re-fetching sources. A refusal or any
 * second failure on the new rung is returned
 * as-is (see automatic-failover.ts's `planAutomaticFailover` for exactly
 * what counts).
 */
export async function runScanChatWithFailover(
  input: RunScanChatWithFailoverInput,
): Promise<GrokResult> {
  const {
    job,
    system,
    user,
    maxTokens,
    timeoutMs,
    grokChat: chat,
    probe,
    setModelChoice,
    setStage,
  } = input;
  const firstChoice = effectiveStoryModelChoice(job.model_choice);
  const firstEffort = input.modelEffort == null
    ? null
    : validatedModelEffort(firstChoice, input.modelEffort);
  const runOn = (choice: EffectiveProviderChoice, effort: ModelEffort | null) =>
    chat(system, user, maxTokens, {
      timeoutMs: timeoutMs(choice),
      choice,
      newsroomId: input.newsroomId,
      ...(input.localModel ? { localModel: input.localModel } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
    });

  /*
    The retry the desk owes a malformed reply, taken from the shared helper so
    there is one implementation of it: `read` returning null means this reply
    is no use, and the helper asks the SAME rung once more before it reports
    the reply unreadable. Everything after this treats that report like any
    other provider failure, which is what lets the hop below happen.
  */
  const reply = await readableReplyOrRetry({
    attempt: () => runOn(firstChoice, firstEffort),
    read: (text) => (input.read && !input.read(text) ? null : text),
    label: modelChoiceLabel(firstChoice),
  });
  const ai: GrokResult = reply.ok
    ? { ok: true, text: reply.value, ...(reply.meta ? { meta: reply.meta } : {}) }
    : { ok: false, error: reply.error, ...(reply.meta ? { meta: reply.meta } : {}) };
  if (ai.ok) return ai;

  const plan = await planAutomaticFailover({
    source: job.model_choice_source ?? "editor",
    current: job.model_choice,
    error: ai.error,
    probe,
  });
  if (!plan) return ai;

  const previousLabel = modelChoiceLabel(job.model_choice);
  const nextEffort = input.modelEffort == null
    ? null
    : validatedModelEffort(plan.next, input.modelEffort);
  const switchReason = failoverReasonPhrase(previousLabel, plan.reason);
  const switchNote = failoverNoteSentence(plan.label, previousLabel, plan.reason);
  await input.onSwitch?.({
    previousChoice: job.model_choice,
    nextChoice: plan.next,
    previousLabel,
    nextLabel: plan.label,
    nextEffort,
    reason: plan.reason,
    switchReason,
    switchNote,
  });
  await setModelChoice(job.id, plan.next);
  await setStage(job.id, `Switched to ${plan.label}: ${switchReason}`);
  await input.setFailoverNote?.(job.id, switchNote);
  return runOn(plan.next, nextEffort);
}
