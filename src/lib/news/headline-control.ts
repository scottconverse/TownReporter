import { LIMITS } from "./request-input.ts";

/**
 * Who owns a draft's headline, and what an editor's headline edit means.
 *
 * WHAT THIS FILE IS FOR. Three decisions about headlines that the desk used to
 * leave to whatever wrote last:
 *
 *   - a Redraft replaces the draft row, so it replaced the editor's headline
 *     with the model's without anything noticing. `editorOwnsHeadline` is the
 *     rule that stops it (lead 240, 2026-09-25: the scan headline was good and
 *     two redrafts rewrote it worse).
 *   - a published headline edit has to leave a record of what it replaced.
 *     `headlineEditRecord` is that record's shape.
 *   - "Suggest headlines" is a model call whose whole contract is that nothing
 *     is applied without a click, so the parsing of the model's answer is a
 *     decision with a failure mode, not string handling. A suggestion that
 *     cannot be printed must be dropped, never offered and then refused by the
 *     publish gate.
 *
 * WHY HERE AND NOT IN desk.ts. `desk.ts` opens a database at import time and
 * cannot be loaded by `node --experimental-strip-types`, so the rule would only
 * ever be tested through a running server. These are pure decisions over plain
 * values, and `headline-control.test.ts` tests them directly -- the same split
 * `provider-settings-input.ts` and `paper-settings.ts` already use.
 */

/** The longest headline the desk will store or suggest. */
export const HEADLINE_MAX = LIMITS.headlineEdit;

/**
 * The longest line that will be offered as a headline suggestion.
 *
 * Tighter than `HEADLINE_MAX` on purpose, and not an arbitrary number: the desk
 * prints headlines around 240 characters at the very most (`coerce-draft.ts:60`
 * writes 240; a hand-typed draft may go to `LIMITS.draftHeadline`). A model
 * answer over this is a paragraph or the model's own commentary, not a headline,
 * and offering it would spend the editor's click to show them something they
 * would then have to edit. Storage keeps the wider ceiling, so nothing anyone
 * already typed becomes uneditable.
 */
export const SUGGESTION_MAX = 300;

/** A draft row's headline provenance, as much of it as this rule needs. */
export type HeadlineProvenance = {
  headline?: string | null;
  model_headline?: string | null;
  headline_source?: string | null;
};

/**
 * Did the editor write the headline on this draft row?
 *
 * Two ways to be sure, because the flag is younger than the data:
 *
 *   1. `headline_source === "editor"` -- the desk recorded the editor's edit.
 *   2. the row carries a model headline and the headline on the row is not it.
 *      That is an editor's words even on a row whose flag says otherwise (a
 *      row written between the migration and this rule, or edited by a path
 *      that did not stamp it), and it is the case the editor actually hit.
 *
 * A row from before 0.6.66 has no `model_headline`, so only (1) can speak, and
 * it reads 'model'. That is deliberate: the desk did not record who wrote those
 * headlines and must not claim to know.
 */
export function editorOwnsHeadline(draft: HeadlineProvenance | null | undefined): boolean {
  if (!draft) return false;
  if (String(draft.headline_source ?? "") === "editor") return true;
  const model = String(draft.model_headline ?? "").trim();
  const kept = String(draft.headline ?? "").trim();
  return Boolean(model) && model !== kept;
}

/**
 * The headline a new draft row should carry.
 *
 * The editor's, when the editor owns the headline of the row being replaced;
 * the model's otherwise. Returns both the headline and the provenance to stamp
 * on the new row, so the two can never disagree.
 */
export function headlineForRedraft(
  previous: HeadlineProvenance | null | undefined,
  modelHeadline: string,
): { headline: string; modelHeadline: string; source: "editor" | "model" } {
  const model = String(modelHeadline ?? "").trim();
  const kept = String(previous?.headline ?? "").trim();
  if (editorOwnsHeadline(previous) && kept) {
    return { headline: kept, modelHeadline: model || kept, source: "editor" };
  }
  return { headline: model || kept, modelHeadline: model || kept, source: "model" };
}

/**
 * The `headline_source` to stamp when an editor saves the draft.
 *
 * "Editor" means the headline on the row is not the one the model wrote. That
 * is the same test `editorOwnsHeadline` reads, applied to the headline being
 * saved, so the flag and the rule can never disagree: a save that leaves the
 * model's headline alone -- an editor who only rewrote the body -- keeps
 * `model`, and the next redraft is free to replace it.
 *
 * A row with no recorded model headline (a draft from before 0.6.66) reads
 * "editor" for any non-empty headline, because the desk cannot show the editor
 * a headline and then claim the model wrote it.
 */
export function headlineSourceAfterEdit(
  previous: HeadlineProvenance | null | undefined,
  nextHeadline: string,
): "editor" | "model" {
  const next = String(nextHeadline ?? "").trim();
  const model = String(previous?.model_headline ?? "").trim();
  if (model) return next === model ? "model" : "editor";
  if (next) return "editor";
  return String(previous?.headline_source ?? "") === "editor" ? "editor" : "model";
}

/** A published-headline edit, as it is stored. */
export type HeadlineEditRecord = {
  oldHeadline: string;
  newHeadline: string;
  changedBy: string;
};

/**
 * The row for `article_headline_history`, or null when the edit changes
 * nothing.
 *
 * A save that does not change the headline writes no row: the history is the
 * record of decisions, and "pressed save twice" is not a second decision.
 * Whitespace-only differences do not count as a change either, because the
 * stored headline is what the reader sees and it is trimmed on the way in.
 */
export function headlineEditRecord(
  article: { headline?: string | null } | null | undefined,
  next: string,
  changedBy: string,
): HeadlineEditRecord | null {
  const before = String(article?.headline ?? "").trim();
  const after = String(next ?? "").trim();
  if (!after || after === before) return null;
  return { oldHeadline: before, newHeadline: after, changedBy };
}

/**
 * The clean headline to store, or null when the editor left it blank.
 *
 * Collapses runs of whitespace so a paste from a word processor is one line,
 * the way the publish path's own `slugify` expects to read it.
 */
export function cleanHeadline(raw: unknown): string | null {
  /*
    A headline is a string or it is nothing. Coercing instead would print the
    text form of whatever arrived -- a number, an object -- as the story's
    headline, which is a failure an editor cannot see coming.
  */
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, HEADLINE_MAX);
}

/**
 * The audit detail for a section the editor published under that the model did
 * not choose. One line, JSON, because `audit_events.detail` is read by a human
 * on the desk and by nothing else -- the shape is stable so Stats can count it.
 */
export function sectionOverrideDetail(input: {
  leadId: number;
  modelTopic: string;
  editorTopic: string;
}): string {
  return JSON.stringify({
    leadId: input.leadId,
    modelSection: input.modelTopic,
    editorSection: input.editorTopic,
  });
}

/** Was the section that printed the model's own choice? */
export function sectionOverridden(
  modelTopic: string | null | undefined,
  printedTopic: string | null | undefined,
): boolean {
  const model = String(modelTopic ?? "").trim();
  const printed = String(printedTopic ?? "").trim();
  /*
    An unrecorded model choice (a draft from before 0.6.66) is not evidence of
    a disagreement. Counting NULL as "the model chose nothing, the editor
    changed it" would put every old story in the override count and make the
    number mean nothing.
  */
  if (!model || !printed) return false;
  return model !== printed;
}

/** The model's ask for headline options. Nothing is applied without a click. */
export function headlineSuggestionPrompt(input: {
  leadHeadline: string;
  section: string;
  /** The headline on the desk right now, when the editor has changed it. */
  currentHeadline?: string;
  dek?: string;
  body?: string;
}): { system: string; user: string } {
  const body = String(input.body ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return {
    system:
      "You write headlines for a small local newspaper. A headline is one line, in the paper's " +
      "voice, saying what happened and to whom -- no colon-stacked two-part headlines, no " +
      "questions, no 'amid', no 'sparks', no opinion, no words the story does not support. " +
      "Answer with three numbered headlines and nothing else.",
    user: [
      `Section: ${input.section || "unknown"}`,
      `The lead as it was filed: ${input.leadHeadline}`,
      input.currentHeadline ? `The headline on the desk now: ${input.currentHeadline}` : "",
      input.dek ? `Dek: ${input.dek}` : "",
      body ? `Story so far:\n${body}` : "",
      "Give three headlines the editor can choose between. Vary the emphasis, not the facts.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * The three suggestions out of a model answer, or fewer when it gave fewer.
 *
 * The model is asked for three numbered lines and often wraps them in a
 * sentence, a markdown fence or quotes. What comes back is offered to an editor
 * who will click one, so the bar is: it must be a headline the publish gate
 * would accept. Anything longer than the desk's own headline ceiling, or too
 * short to be a headline, is dropped rather than shown -- an option that fails
 * on publish is worse than no option.
 */
export function parseHeadlineSuggestions(text: string, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    /*
      Bullets, numbers, wrapping quotes and markdown emphasis all come off. The
      emphasis matters as much as the quotes: a headline prints as plain text,
      so `*Annexation approved*` offered as an option would be applied and then
      print its asterisks. (The `*` is stripped twice on purpose -- a model
      writing `*one*` uses the same character for emphasis and for a bullet.)
    */
    const line = rawLine
      .replace(/^\s*(?:[-*•]|\d+\s*[.)])\s*/, "")
      .replace(/^["'“”*_]+|["'“”*_]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line.length < 12 || line.length > SUGGESTION_MAX) continue;
    // The model's own framing ("Here are three headlines:") is not a headline.
    if (/:$/.test(line)) continue;
    if (/^```/.test(rawLine.trim())) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}
