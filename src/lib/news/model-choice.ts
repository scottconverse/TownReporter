export const STORY_MODEL_CHOICES = [
  { value: "auto", label: "Automatic", detail: "Recommended ladder" },
  { value: "local", label: "Local Qwen", detail: "This machine" },
  { value: "zen", label: "Zen MiMo", detail: "Provider-hosted" },
  { value: "codex-balanced", label: "Codex Terra", detail: "More depth" },
  { value: "codex-frontier", label: "Codex Sol", detail: "Frontier" },
  { value: "claude-frontier", label: "Claude Opus", detail: "Frontier" },
] as const;

export type StoryModelChoice = (typeof STORY_MODEL_CHOICES)[number]["value"];

export const OPINION_MODEL_CHOICES = STORY_MODEL_CHOICES.filter(
  (choice) =>
    choice.value === "auto" ||
    choice.value === "codex-frontier" ||
    choice.value === "claude-frontier",
);

export type OpinionModelChoice = (typeof OPINION_MODEL_CHOICES)[number]["value"];

export function storyModelChoice(value: unknown): StoryModelChoice {
  return STORY_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as StoryModelChoice)
    : "auto";
}

export function opinionModelChoice(value: unknown): OpinionModelChoice {
  return OPINION_MODEL_CHOICES.some((choice) => choice.value === value)
    ? (value as OpinionModelChoice)
    : "auto";
}

export function modelChoiceLabel(value: unknown): string {
  const normalized = storyModelChoice(value);
  return STORY_MODEL_CHOICES.find((choice) => choice.value === normalized)?.label ?? "Automatic";
}

export function modelChoiceHelp(
  value: unknown,
  scope: "story" | "opinion" = "story",
): string {
  const selected = scope === "opinion"
    ? OPINION_MODEL_CHOICES.find((choice) => choice.value === opinionModelChoice(value))!
    : STORY_MODEL_CHOICES.find((choice) => choice.value === storyModelChoice(value))!;
  if (selected.value !== "auto") {
    return `Uses only ${selected.label} for this run; no fallback.`;
  }
  return scope === "opinion"
    ? "Tries Codex Sol, then Claude Opus. The selected provider writes the whole editorial; explicit choices never fall back."
    : "Uses your configured gateway when set; otherwise tries Zen MiMo, Codex Terra, then Claude Opus. Local Qwen is available by explicit choice.";
}

export function opinionProviderProblem(error: string): string {
  if (!/AI is not available/i.test(error)) return error;
  return "No Opinion model is available. Sign in to Codex or Claude Code on this machine, or set ANTHROPIC_API_KEY.";
}
