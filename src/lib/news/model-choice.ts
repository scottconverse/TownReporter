export const STORY_MODEL_CHOICES = [
  { value: "auto", label: "Automatic", detail: "Recommended ladder" },
  { value: "local", label: "Local Qwen", detail: "This machine" },
  { value: "zen", label: "Zen MiMo", detail: "Provider-hosted" },
  { value: "codex-balanced", label: "Codex Terra", detail: "More depth" },
  { value: "codex-frontier", label: "Codex Sol", detail: "Frontier" },
  { value: "claude-frontier", label: "Claude Opus", detail: "Frontier" },
] as const;

export type StoryModelChoice = (typeof STORY_MODEL_CHOICES)[number]["value"];
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
*/
export const OPINION_MODEL_CHOICES = STORY_MODEL_CHOICES.filter(
  (choice) => choice.value === "auto" || choice.value === "claude-frontier",
);

export type OpinionModelChoice = (typeof OPINION_MODEL_CHOICES)[number]["value"];

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

export function modelChoiceLabel(value: unknown): string {
  if (value === "configured") return "Configured gateway";
  const normalized = storyModelChoice(value);
  return STORY_MODEL_CHOICES.find((choice) => choice.value === normalized)?.label ?? "Automatic";
}

export function modelChoiceHelp(value: unknown, scope: "story" | "opinion" = "story"): string {
  const selected =
    scope === "opinion"
      ? OPINION_MODEL_CHOICES.find((choice) => choice.value === opinionModelChoice(value))!
      : STORY_MODEL_CHOICES.find((choice) => choice.value === storyModelChoice(value))!;
  if (selected.value !== "auto") {
    return `Uses only ${selected.label} for this run; no fallback.`;
  }
  return scope === "opinion"
    ? "Claude Opus writes the whole editorial. Codex is offered for Story drafts only: its model declines to write an editorial that takes a position."
    : "Uses your configured gateway when set; otherwise tries Zen MiMo, Codex Terra, then Claude Opus. Local Qwen is available by explicit choice.";
}

export function opinionProviderProblem(error: string): string {
  if (!/AI is not available/i.test(error)) return error;
  return "No Opinion model is available. Open Claude Code on this machine and sign in.";
}
