/**
 * The Writer / Effort bar's four facts (unit CW, 0.6.81).
 *
 * `Desk Story.dc.html` draws one row above the three editors -- "Writer",
 * "Automatic", "Effort: standard", "● Ready", "Last draft: Codex Sol, 7:48
 * a.m." -- and one line at the head of the Story editor, "Saved 8:20 a.m.".
 * Each of those says something about this draft, so each is derived here from
 * the state the page already holds, never typed into the JSX.
 *
 * WHAT "● READY" IS ABOUT. It is the writer, not the draft. The drawing's own
 * page is not publishable -- the same drawing puts "Review 1 name to publish."
 * on the sticky bar below -- and still draws "● Ready" above it, so the dot
 * cannot mean "this story may print". It says the model the editor has chosen
 * can actually run on this server, which is the question the two selects
 * beside it raise and the one an editor needs answered before pressing Draft.
 * `writerIsReady` is the desk's existing rule for that (`ModelPicker`'s own
 * "is this option usable" check, extracted here so the bar and the picker
 * cannot answer it differently) and the words are the picker's words.
 */

import { isCustomModelChoice } from "./model-choice.ts";
import { clockLabel } from "./follow-up-copy.ts";

/** The three colors these lines are allowed to be, in the desk's own names. */
export type WriterTone = "ok" | "warn" | "mut";

/**
 * Can the chosen writer run on this server?
 *
 * The same three answers `ModelPicker` gives each option in its menu:
 * Automatic is always usable (it has a ladder and resolves at run time), a
 * custom connection needs to be on and to carry a model, and every other
 * provider is read off `providerAvailability()` -- where "not answered yet"
 * counts as usable, because a slow availability call must not lock the desk.
 * A run that starts anyway is still refused by preflight before it spends
 * anything; the picker's comment on that is at its own `isAvailable`.
 */
export function writerIsReady(input: {
  choice: string;
  /** `providerAvailability()`'s map, or undefined while it is in flight. */
  availability: Record<string, boolean> | undefined;
  /** The connection behind a `custom:<id>` choice, when the desk has one. */
  customConnection: { enabled: boolean; modelId: string | null } | null;
}): boolean {
  if (input.choice === "auto") return true;
  if (isCustomModelChoice(input.choice)) {
    return Boolean(input.customConnection?.enabled && input.customConnection.modelId);
  }
  return input.availability ? input.availability[input.choice] !== false : true;
}

/**
 * The dot. The drawn word when the writer can run, and the picker's own
 * "not set up" when it cannot -- the same two words that picker already puts
 * on an option it cannot reach, in the desk's warn color.
 */
export function readinessDot(ready: boolean): { label: string; tone: WriterTone } {
  return ready
    ? { label: "● Ready", tone: "ok" }
    : { label: "● Not set up", tone: "warn" };
}

/**
 * When the last draft finished, as the drawn line writes it: "7:48 a.m.".
 *
 * The drawing has one clock and no date, which is right for the morning it
 * was drawn on and wrong for a draft left over from yesterday -- "7:48 a.m."
 * then reads as this morning's work. So a draft from another day carries its
 * date: "Sep 26, 7:48 a.m.". `now` is an argument so a test can pin a day,
 * the same way `nextCheckLabel` does.
 *
 * Returns "" for a missing or unparseable stamp, which is how "there is no
 * draft on the books" reaches `lastDraftLine`.
 */
export function lastDraftWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const clock = clockLabel(iso);
  /* A clock that came back at all means `iso` parsed: see `clockLabel`. */
  if (!clock || !iso) return "";
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) return clock;
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${clock}`;
}

/**
 * "Last draft: Codex Sol, 7:48 a.m." -- which model wrote the draft in hand,
 * and when it finished.
 *
 * A caller with no model to name still gets the time -- "Last draft: 7:48
 * a.m." -- but an empty `when` drops the whole line rather than printing
 * "Last draft: Codex Sol, ". A draft whose model the desk never recorded is
 * not a draft that was written at an unknown hour.
 */
export function lastDraftLine(input: { modelLabel: string; when: string }): string {
  if (!input.when.trim()) return "";
  const model = input.modelLabel.trim();
  return model ? `Last draft: ${model}, ${input.when}` : `Last draft: ${input.when}`;
}

/**
 * What the Story editor's own line says: the drawn green "Saved 8:20 a.m.",
 * and the two states the drawing does not draw but the desk will not hide.
 *
 * "Unsaved changes" outranks the timestamp because it is the answer to the
 * only question this line exists for -- does what I typed exist anywhere but
 * this tab? -- and a green "Saved 8:20 a.m." beside unsaved text is the exact
 * lie a save line must never tell. A story already on the paper says so
 * instead: its save is "Publish", and a redraft of it goes through the
 * corrections desk.
 */
export function saveState(input: {
  published: boolean;
  dirty: boolean;
  when: string;
}): { label: string; tone: WriterTone } {
  if (input.published) return { label: "Published story", tone: "mut" };
  if (input.dirty) return { label: "Unsaved changes", tone: "warn" };
  const when = input.when.trim();
  return when ? { label: `Saved ${when}`, tone: "ok" } : { label: "Saved draft", tone: "ok" };
}
