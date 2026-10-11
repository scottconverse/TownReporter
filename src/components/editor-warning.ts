/** Shared warning parsing and second-press labels for the desk consent dialog. */
/** The structured refusal a scoped policy gate answers with. */
export type EditorWarning = { key: string; sentence: string };

/**
 * The full refusal shape. `error` mirrors `warning.sentence` for consumers that
 * predate the structured form; `warning` is what the new press reads.
 */
export type EditorWarningResult = { ok: false; warning: EditorWarning; error: string };

/** What an action's input carries back: the keys already approved. */
export type EditorOverrideInput = { override?: string[] };

/**
 * Read the structured warning out of a settled answer, or null when the answer
 * did not warn. Never guesses: a malformed warning is treated as absent.
 */
export function warningFromAnswer(answer: unknown): EditorWarning | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as { ok?: unknown; warning?: unknown };
  if (a.ok !== false) return null;
  const w = a.warning as { key?: unknown; sentence?: unknown } | null | undefined;
  if (!w || typeof w !== "object") return null;
  const key = typeof w.key === "string" ? w.key.trim() : "";
  const sentence = typeof w.sentence === "string" ? w.sentence.trim() : "";
  if (!key || !sentence) return null;
  return { key, sentence };
}

/** How the second press finishes its sentence. */
export type WarningPressKind = "default" | "run" | "check" | "restart";

/**
 * The word the second press wears.
 *
 *   - default  → "<Action> anyway"   ("Draft this story anyway")
 *   - run      → "Run anyway"         (an hourly cap, a disabled setting)
 *   - check    → "Check anyway"       (a cooldown, a paused source)
 *   - restart  → "Stop and restart with <model>"
 */
export function warningPressLabel(
  action: string,
  kind: WarningPressKind = "default",
  model?: string,
): string {
  if (kind === "run") return "Run anyway";
  if (kind === "check") return "Check anyway";
  if (kind === "restart") return `Stop and restart with ${model?.trim() || "this model"}`;
  return `${action} anyway`;
}
