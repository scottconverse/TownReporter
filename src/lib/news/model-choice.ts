/*
  The picker lists, derived -- not typed out.

  Every option below comes from PROVIDER_REGISTRY (./provider-registry.ts).
  This module's job is now the small amount of picker-specific vocabulary the
  registry does not own: "Automatic" (which is a ladder, not a provider), the
  normalising functions that turn an untrusted stored string back into a valid
  choice, and the sentences the desk shows under each selection.
*/

import {
  automaticLadder,
  providersFor,
  providerEntry,
  type PickerProviderId,
  type ProviderSurface,
} from "./provider-registry.ts";

export type ModelChoiceOption = {
  value: StoryModelChoice;
  label: string;
  detail: string;
};

/**
 * Not a provider: an instruction to probe the ladder and pin whatever
 * answers. It is prepended to every picker rather than living in the
 * registry, because it has no model, no budget and no transport of its own.
 */
const AUTOMATIC: ModelChoiceOption = {
  value: "auto",
  label: "Automatic",
  detail: "Recommended ladder",
};

function optionsFor(surface: ProviderSurface): ModelChoiceOption[] {
  return [
    AUTOMATIC,
    ...providersFor(surface).map((entry) => ({
      value: entry.id as StoryModelChoice,
      label: entry.label,
      detail: entry.detail,
    })),
  ];
}

export const STORY_MODEL_CHOICES: readonly ModelChoiceOption[] = optionsFor("story");

export type StoryModelChoice = "auto" | PickerProviderId;
export type EffectiveStoryModelChoice = StoryModelChoice | "configured";

/*
  Opinion offers Claude only. Decided 2026-09-02.

  Codex was offered here too, and its model refuses the job: asked for an
  editorial that takes a position on a local policy question, gpt-5.6-sol
  returned "EDITORIAL_REFUSAL: I can't provide an editorial that advocates a
  position on a local government policy issue" -- twice, with the real voice,
  on a real subject. That is the provider's policy, not a bug, and working
  around it would mean prompting against their rules. Codex stays on the
  Story picker, where it drafts reporting and works.

  That decision now lives on the registry entries as `offeredFor.opinion`,
  and this list is the same option OBJECTS the Story list holds, filtered --
  so the two can never drift into showing different labels for one provider.
*/
export const OPINION_MODEL_CHOICES: readonly ModelChoiceOption[] = STORY_MODEL_CHOICES.filter(
  (choice) => choice.value === "auto" || providerEntry(choice.value)?.offeredFor.opinion,
);

/**
 * Dark Desk's picker. 0.6.2: before this, Dark Desk called the model with no
 * choice at all -- `grokChat` with no `choice` option, which silently used
 * whatever `resolveProvider()` happened to return. It is the same list Story
 * gets, because every provider that can draft can also dig.
 */
export const DARK_MODEL_CHOICES: readonly ModelChoiceOption[] = STORY_MODEL_CHOICES.filter(
  (choice) => choice.value === "auto" || providerEntry(choice.value)?.offeredFor.dark,
);

export type OpinionModelChoice = StoryModelChoice;
export type DarkModelChoice = StoryModelChoice;

export function storyModelChoice(value: unknown): StoryModelChoice {
  return STORY_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as StoryModelChoice)
    : "auto";
}

/** The provider Automatic actually selected, persisted for the whole queued run. */
export function effectiveStoryModelChoice(value: unknown): EffectiveStoryModelChoice {
  return value === "configured" ? "configured" : storyModelChoice(value);
}

export function opinionModelChoice(value: unknown): OpinionModelChoice {
  return OPINION_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as OpinionModelChoice)
    : "auto";
}

/** Same narrowing as Opinion's, against the Dark list. */
export function darkModelChoice(value: unknown): DarkModelChoice {
  return DARK_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as DarkModelChoice)
    : "auto";
}

export function modelChoiceLabel(value: unknown): string {
  if (value === "configured") return providerEntry("configured")?.label ?? "Configured gateway";
  const normalized = storyModelChoice(value);
  return STORY_MODEL_CHOICES.find((choice) => choice.value === normalized)?.label ?? "Automatic";
}

/**
 * The Automatic ladder, in words: "Claude Opus, then Codex Terra".
 *
 * Read from the registry rather than typed out, so a reordered or retired
 * rung cannot leave this sentence describing a ladder that no longer exists
 * -- which is exactly what happened when Zen and Local Qwen were removed
 * from the ladder in 0.6.1 and three help strings still named them.
 */
function ladderSentence(): string {
  const labels = automaticLadder().map((id) => providerEntry(id)?.label ?? id);
  if (labels.length === 0) return "nothing (no model is set up)";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")}, then ${labels[labels.length - 1]}`;
}

/**
 * The sentence under the picker.
 *
 * Automatic's story/scan/dark wording names the ladder in the order it is
 * actually tried, read from the registry, so removing or reordering a rung
 * cannot leave the help text describing a ladder that no longer exists.
 */
export function modelChoiceHelp(
  value: unknown,
  scope: ProviderSurface = "story",
): string {
  const options =
    scope === "opinion"
      ? OPINION_MODEL_CHOICES
      : scope === "dark"
        ? DARK_MODEL_CHOICES
        : STORY_MODEL_CHOICES;
  const normalized = options.some((choice) => choice.value === value)
    ? (value as StoryModelChoice)
    : "auto";
  const selected = options.find((choice) => choice.value === normalized)!;
  if (selected.value !== "auto") {
    return `Uses only ${selected.label} for this run; no fallback.`;
  }
  if (scope === "opinion") {
    return "Claude Opus writes the whole editorial. Codex is offered for Story drafts only: its model declines to write an editorial that takes a position.";
  }
  const noun = scope === "dark" ? "round" : "draft";
  return `Uses your configured gateway when set; otherwise tries ${ladderSentence()}. If the first one's login has lapsed or it does not respond in time, the ${noun} moves to the next.`;
}

export function opinionProviderProblem(error: string): string {
  if (!/AI is not available/i.test(error)) return error;
  return "No Opinion model is available. Open Claude Code on this machine and sign in.";
}
