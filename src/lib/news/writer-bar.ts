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

/** Reasons use the existing availability check, with no extra probes. */
export type ProviderAvailability = Record<string, boolean> & { reasons?: Record<string, string>; cloudWarnings?: { baseUrl: string; id: string; reason: string }[] };

/** The one shared status word used by both Pro-plan model options and Connections. */
export function geminiReadinessWord(availability: ProviderAvailability | undefined): string | undefined {
  if (!availability) return undefined;
  if (availability["gemini-flash"] === true) return "Ready";
  if (availability["gemini-flash"] === false) {
    return availability.reasons?.["gemini-flash"] ?? "Gemini is not ready.";
  }
  return undefined;
}

function availabilityChoice(choice: string): string {
  return choice.startsWith("gemini-") ? "gemini-flash" : choice;
}

export function customConnectionReadinessProblem(input: {
  choice: string;
  label: string;
  customConnection: { readinessError?: string } | null;
}): string | undefined {
  const message = input.customConnection?.readinessError;
  return message ? readinessFailureMessage(input.choice, input.label, message) : undefined;
}

export function customConnectionStatus(input: {
  id: string;
  name: string;
  hasApiKey: boolean;
  enabled: boolean;
  readinessError?: string;
}): { kind: "connected" | "off" | "notset" | "unreachable"; label?: string; help?: string } {
  if (!input.hasApiKey) return { kind: "notset" };
  if (!input.enabled) return { kind: "off", label: "Turned off" };
  const problem = customConnectionReadinessProblem({
    choice: `custom:${input.id}`,
    label: input.name,
    customConnection: input,
  });
  return problem
    ? { kind: "unreachable", label: problem, help: problem }
    : { kind: "connected" };
}

export function localCloudReadinessReason(availability: ProviderAvailability | undefined, model?: { baseUrl: string; id: string } | null): string | undefined {
  return model ? availability?.cloudWarnings?.find(row => row.baseUrl.replace(/\/+$/, "") === model.baseUrl.replace(/\/+$/, "") && row.id === model.id)?.reason : undefined;
}

export function readinessFailureMessage(choice: string, name: string, message: string): string {
  if (message.startsWith("Ollama says:") || choice.startsWith("gemini-")) return message;
  if (choice.startsWith("claude-")) {
    if (/CLI not found|not installed/i.test(message)) return "Claude Code is not installed on this server.";
    if (/signed out|not logged|sign in|session expired/i.test(message)) return "Claude is signed out on this server. Sign in once: run claude auth login on the server.";
  }
  if (isCustomModelChoice(choice) && /key.*(?:decrypt|cannot be read)|decrypt.*key/i.test(message)) return "This connection's key cannot be read. Open Models and paste the key again.";
  if (/usage limit|out of quota|quota.*(?:exceeded|exhausted)|insufficient_quota/i.test(message)) return `${name} hit its usage limit.`;
  return `${name} is not ready: ${message}`;
}

export function writerUnavailableReason(input: Parameters<typeof writerIsReady>[0] & { label: string }): string | undefined {
  if (writerIsReady(input)) return undefined;
  if (input.choice === "local-model" && input.localModel) {
    const warning = localCloudReadinessReason(input.availability, input.localModel);
    if (warning) return warning;
  }
  const customProblem = customConnectionReadinessProblem({
    choice: input.choice,
    label: input.label,
    customConnection: input.customConnection,
  });
  if (customProblem) return customProblem;
  const reason = input.availability?.reasons?.[availabilityChoice(input.choice)];
  if (reason) return reason;
  if (isCustomModelChoice(input.choice)) return "This custom connection is unavailable or has no model. Manage it on Models, or choose another model.";
  if (input.choice === "local-model") return "TownReporter cannot reach a local model. Start LM Studio's local server or Ollama, then click Refresh. See docs/local-models.md.";
  return readinessFailureMessage(input.choice, input.label, "This provider is not configured on this server.");
}

/** The editor can proceed after seeing the unavailable writer and fallback warning. */
export function writerReadinessWarning(reason: string): string {
  return `${reason} If you draft anyway, the desk will use the next ready writing model.`;
}

export function writerDraftAction(reason?: string) {
  return {
    label: reason ? "Draft anyway" : "Draft with AI",
    warning: reason ? writerReadinessWarning(reason) : undefined,
    override: reason ? ["writer-not-ready"] : undefined,
  };
}

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
  availability: ProviderAvailability | undefined;
  /** The connection behind a `custom:<id>` choice, when the desk has one. */
  customConnection: { enabled: boolean; modelId: string | null; readinessError?: string } | null;
  localModel?: { baseUrl: string; id: string } | null;
}): boolean {
  if (input.choice === "auto") return true;
  if (input.choice === "local-model" && input.localModel) {
    if (localCloudReadinessReason(input.availability, input.localModel)) return false;
    if (input.availability?.reasons?.["local-model"]?.startsWith("Ollama says:")) return true;
  }
  if (isCustomModelChoice(input.choice)) {
    return Boolean(input.customConnection?.enabled && input.customConnection.modelId && !input.customConnection.readinessError);
  }
  return input.availability ? input.availability[availabilityChoice(input.choice)] !== false : true;
}

/** Recover the editor's original pick after the job's runtime moves to a fallback. */
export function requestedModelChoice(resultJson: string | null | undefined, persistedChoice: string): string {
  try {
    const receipt = JSON.parse(resultJson ?? "{}") as { requestedRuntime?: unknown };
    return typeof receipt.requestedRuntime === "string" ? receipt.requestedRuntime : persistedChoice;
  } catch {
    return persistedChoice;
  }
}

/** Explain the first technical failure without mislabeling the model that wrote the saved draft. */
export function draftFallbackAttribution(input: {
  pickedModel: string;
  writerModel: string;
  failoverNote: string | null | undefined;
}): string | undefined {
  const picked = input.pickedModel.trim();
  const writer = input.writerModel.trim();
  if (!picked || !writer || picked === writer || !input.failoverNote) return undefined;
  const match = /timed out|sign-in lapsed|reached its usage limit|usage limit|was unavailable|reply was cut off|sent a reply the desk could not read|could not read/i.exec(input.failoverNote);
  if (!match) return undefined;
  const reason = /timed out/i.test(match[0])
    ? "timed out"
    : /sign-in lapsed/i.test(match[0])
      ? "sign-in lapsed"
      : /usage limit/i.test(match[0])
        ? "reached its usage limit"
        : /cut off/i.test(match[0])
          ? "had its reply cut off"
          : /unavailable/i.test(match[0])
            ? "was unavailable"
            : "sent a reply the desk could not read";
  return `You picked ${picked}. ${writer} wrote this draft because ${picked} ${reason}.`;
}

/**
 * The reason the job itself recorded for its latest switch. `failover_note` holds
 * either the sentence "This draft moved to <X> because <Y>" or the trail
 * "<Y> -> <X>" that `appendStoryFailoverNote` builds; the last hop's reason is
 * the part before the final " -> ". Nothing is invented: no note, no reason.
 */
export function switchReasonFromNote(failoverNote: string | null | undefined): string | undefined {
  const note = (failoverNote ?? "").trim();
  if (!note) return undefined;
  const sentence = /^This draft moved to .+? because (.+)$/i.exec(note);
  if (sentence) return sentence[1].replace(/\.$/, "");
  const hops = note.split(" -> ");
  return hops.length > 1 ? hops[hops.length - 2] : undefined;
}

/**
 * While a draft runs on a different model than the editor picked, say so in
 * words: which model is writing and the reason the job recorded for the switch.
 */
export function runningWriterSentence(input: {
  pickedModel: string;
  writerModel: string;
  failoverNote: string | null | undefined;
}): string | undefined {
  const picked = input.pickedModel.trim();
  const writer = input.writerModel.trim();
  if (!picked || !writer || picked === writer) return undefined;
  const reason = switchReasonFromNote(input.failoverNote);
  return reason
    ? `You picked ${picked}. ${writer} is writing because ${reason}.`
    : `You picked ${picked}. ${writer} is writing.`;
}

/**
 * Show an unavailable writer's reason before story readiness so a checked
 * story cannot mask a model that cannot run.
 */
export function readinessDot(ready: boolean, story?: { state: string; reason: string } | null, unavailableReason?: string): { label: string; tone: WriterTone; reason?: string } {
  if (!ready && unavailableReason) return { label: `● ${unavailableReason}`, tone: "warn", reason: unavailableReason };
  if (story) return {
    reason: story.reason,
    label: (story.state === "ready" || story.state === "verified") ? "● Ready" : story.state === "checking" ? "● Checking" : story.state === "to-check" ? "● To check" : story.state === "not-checked" ? "● Not checked yet" : "● Not ready",
    tone: (story.state === "ready" || story.state === "verified") ? "ok" : "warn",
  };
  return ready
    ? { label: "● Ready", tone: "ok" }
    : { label: "● Not ready", tone: "warn" };
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
export function lastDraftLine(input: { modelLabel: string; when: string; draftSaved?: boolean }): string {
  if (input.draftSaved === false) return "";
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
