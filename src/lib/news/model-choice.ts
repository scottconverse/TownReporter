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
import { LOCAL_MODEL_UNCONFIGURED } from "./preflight.ts";

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

export function modelChoicesFor(surface: ProviderSurface): readonly ModelChoiceOption[] {
  const automatic = surface === "forced" ? [] : [AUTOMATIC];
  return [
    ...automatic,
    ...providersFor(surface).map((entry) => ({
      value: entry.id as StoryModelChoice,
      label: entry.label,
      detail: entry.detail,
    })),
  ];
}

export const STORY_MODEL_CHOICES: readonly ModelChoiceOption[] = modelChoicesFor("story");

export type CustomModelChoice = `custom:${string}`;
export type StoryModelChoice = "auto" | PickerProviderId | CustomModelChoice;
/** Preserve explicit custom intent, including stale IDs. Server resolution validates
 * ownership and availability; invalid custom picks must never become Automatic. */
export function isCustomModelChoice(value: unknown): value is CustomModelChoice {
  return typeof value === "string" && value.startsWith("custom:");
}
export type EffectiveStoryModelChoice = StoryModelChoice | "configured";

/* Opinion uses the same native subscription providers as Story. Automatic
   starts on Codex Sol and keeps Claude Sonnet as its limited fallback; an
   explicit pick never falls through. */
export const DEFAULT_OPINION_MODEL = "codex-frontier" as const;
export const OPINION_AUTOMATIC_LADDER = ["codex-frontier", "claude-sonnet"] as const;
/**
 * Dark Desk spends most of a round on mechanical planning and evidence
 * triage. Automatic therefore uses the balanced synthesis models; Opus and
 * Astra remain explicit choices for an editor who wants them.
 */
export const DARK_AUTOMATIC_LADDER = ["codex-balanced", "claude-sonnet"] as const;
export const OPINION_MODEL_CHOICES: readonly ModelChoiceOption[] = modelChoicesFor("opinion");

/**
 * Dark Desk's picker. 0.6.2: before this, Dark Desk called the model with no
 * choice at all -- `grokChat` with no `choice` option, which silently used
 * whatever `resolveProvider()` happened to return. It is the same list Story
 * gets, because every provider that can draft can also dig.
 */
export const DARK_MODEL_CHOICES: readonly ModelChoiceOption[] = modelChoicesFor("dark");
/** Batch and scheduled runs must name one exact provider; Automatic is absent. */
export const FORCED_MODEL_CHOICES: readonly ModelChoiceOption[] = modelChoicesFor("forced");

export type OpinionModelChoice = StoryModelChoice;
export type DarkModelChoice = StoryModelChoice;
export type ForcedModelChoice = Exclude<StoryModelChoice, "auto">;

export function storyModelChoice(value: unknown): StoryModelChoice {
  if (isCustomModelChoice(value)) return value;
  return STORY_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as StoryModelChoice)
    : "auto";
}

/** The provider Automatic actually selected, persisted for the whole queued run. */
export function effectiveStoryModelChoice(value: unknown): EffectiveStoryModelChoice {
  return value === "configured" ? "configured" : storyModelChoice(value);
}

export function opinionModelChoice(value: unknown): OpinionModelChoice {
  if (isCustomModelChoice(value)) return value;
  return OPINION_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as OpinionModelChoice)
    : DEFAULT_OPINION_MODEL;
}

/** Same narrowing as Opinion's, against the Dark list. */
export function darkModelChoice(value: unknown): DarkModelChoice {
  if (isCustomModelChoice(value)) return value;
  return DARK_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as DarkModelChoice)
    : "auto";
}

export function shouldHydrateDarkModel(
  selectedInvestigationId: number,
  detailInvestigationId: number,
  lastModelChoice: unknown,
  status: unknown,
): boolean {
  return (
    selectedInvestigationId === detailInvestigationId &&
    (lastModelChoice != null || status !== "investigating")
  );
}

export function modelChoiceLabel(value: unknown, scope: ProviderSurface = "story"): string {
  if (isCustomModelChoice(value)) return "Custom API connection";
  if (value === "configured") return providerEntry("configured")?.label ?? "Configured gateway";
  for (const surface of [scope, "story", "scan", "opinion", "dark", "forced"] as const) {
    const match = modelChoicesFor(surface).find((choice) => choice.value === value);
    if (match) return match.label;
  }
  return "Automatic";
}

/**
 * The Automatic ladder, in words: "Codex Terra, then Claude Sonnet".
 *
 * Read from the registry rather than typed out, so a reordered or retired
 * rung cannot leave this sentence describing a ladder that no longer exists
 * -- which is exactly what happened when Zen and Local Qwen were removed
 * from the ladder in 0.6.1 and three help strings still named them.
 */
function ladderSentence(ladder: readonly string[] = automaticLadder()): string {
  const labels = ladder.map((id) => providerEntry(id)?.label ?? id);
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
export function modelChoiceHelp(value: unknown, scope: ProviderSurface = "story"): string {
  if (isCustomModelChoice(value))
    return "Uses only the selected custom API connection for this run; no fallback. Your provider's usage charges may apply.";
  const options = modelChoicesFor(scope);
  const normalized = options.some((choice) => choice.value === value)
    ? (value as StoryModelChoice)
    : scope === "forced"
      ? options[0]?.value
      : "auto";
  const selected = options.find((choice) => choice.value === normalized) ?? options[0];
  if (!selected) return "No model is available for this surface.";
  if (selected.value !== "auto") {
    return `Uses only ${selected.label} for this run; no fallback.`;
  }
  if (scope === "opinion") {
    return `Tries ${ladderSentence(OPINION_AUTOMATIC_LADDER)}. If one reaches a usage limit or has a technical failure, the editorial moves to the next signed-in provider. A provider refusal stops the run, and an explicit pick never falls back.`;
  }
  if (scope === "dark") {
    return `Uses your configured gateway when set; otherwise tries ${ladderSentence(DARK_AUTOMATIC_LADDER)}. Planning uses the selected provider's faster planning model. If the first provider's login has lapsed or synthesis does not respond in time, only the unfinished stage moves to the next provider.`;
  }
  return `Uses your configured gateway when set; otherwise tries ${ladderSentence()}. If the first provider reaches a usage limit, becomes unavailable, loses its login, or does not respond in time, the draft moves to the next. A content refusal stops the run, and an explicit pick never falls back.`;
}

/**
 * Recreate the choice the editor made for the latest Story run.
 *
 * Automatic is resolved to a concrete provider before it is stored on the
 * job, so reading only `model_choice` makes a reopened Story page pretend the
 * editor explicitly chose that provider. `model_choice_source` preserves the
 * distinction. This keeps Redraft on the visible choice that produced the
 * current draft while still showing Automatic when the ladder made the pick.
 */
export function rememberedStoryModelChoice(value: unknown, source: unknown): StoryModelChoice {
  return source === "auto" ? "auto" : storyModelChoice(value);
}

/**
 * Rewrites the generic "no model configured at all" message into Opinion's
 * own guidance. `candidate` says WHICH rung was being probed when that
 * happened -- defaulting to "claude-frontier" keeps existing call sites that
 * omit the candidate compatible.
 *
 * Before `candidate` existed, this rewrote to "Open Claude Code ... and sign
 * in" unconditionally, so a "local-model" pick with no LLM_BASE_URL set at
 * all reported an unrelated Claude sign-in instruction instead of naming the
 * setting that would actually fix it (audit finding "Opinion 'Local model'
 * pick silently uses Claude" also named this exact symptom). A local-model
 * failure that is specifically "nothing is configured" now gets the SAME
 * `LOCAL_MODEL_UNCONFIGURED` sentence Story and Scan's preflight show (see
 * ./preflight.ts) -- one wording for "you picked Local model and nothing is
 * there," everywhere the desk says it. Any other local-model failure
 * (unreachable server, rejected credentials) is already specific and passes
 * through untouched.
 */
export function opinionProviderProblem(
  error: string,
  candidate: OpinionModelChoice = "claude-frontier",
): string {
  if (!/AI is not available/i.test(error)) return error;
  if (candidate === "local-model") return LOCAL_MODEL_UNCONFIGURED;
  if (candidate !== "claude-frontier") return error;
  return "No Opinion model is available. Open Claude Code on this machine and sign in.";
}

/**
 * The option label a local model gets in the picker: its id, plus "loaded" /
 * "thinking off" / "vision" whichever apply — e.g. "gemma4:12b · loaded ·
 * vision". A pure function (no JSX), kept in this module rather than
 * model-picker.tsx so it can be unit-tested directly: this repo has no
 * component-rendering test harness (no jsdom/testing-library dependency,
 * and `node --test`'s type-stripping cannot parse JSX), so the picker's
 * render behaviour is pinned here instead of through a DOM assertion.
 */
export function localModelOptionLabel(model: {
  id: string;
  loaded: boolean | null;
  thinking: boolean;
  vision: boolean;
}): string {
  const suffix = [
    model.loaded ? "loaded" : null,
    model.thinking ? "thinking off" : null,
    model.vision ? "vision" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return suffix ? `${model.id} · ${suffix}` : model.id;
}
