import { failoverNoteSentence, failoverReasonPhrase, type AutomaticFailoverReason } from "./automatic-failover.ts";
import { modelChoiceLabel, type OpinionModelChoice } from "./model-choice.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";

type EffectiveOpinionChoice = Exclude<OpinionModelChoice, "auto">;

/** Build the durable runtime receipt before the retry starts. The original
 * editor choice remains separate from the destination that will actually
 * run, and the effort is revalidated for that destination model. */
export function opinionFallbackRuntimeReceipt(input: {
  requestedRuntime: OpinionModelChoice;
  requestedEffort: ModelEffort | null | undefined;
  previous: EffectiveOpinionChoice;
  next: EffectiveOpinionChoice;
  reason: AutomaticFailoverReason;
}) {
  const previousLabel = modelChoiceLabel(input.previous);
  const nextLabel = modelChoiceLabel(input.next);
  return {
    requestedRuntime: input.requestedRuntime,
    requestedEffort: input.requestedEffort ?? null,
    actualRuntime: input.next,
    actualEffort: modelEffort(input.next, input.requestedEffort),
    stage: `Switched to ${nextLabel}: ${failoverReasonPhrase(previousLabel, input.reason)}`,
    note: failoverNoteSentence(nextLabel, previousLabel, input.reason),
  };
}
