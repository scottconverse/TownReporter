import { LIMITS } from "./request-input.ts";

/**
 * What a correction note says, and how the desk gets one for the editor.
 *
 * WHAT THIS FILE IS FOR. The owner's first real correction (2026-09-25) was
 * that the correction box starts empty. A correction is the one thing a paper
 * publishes under pressure -- the number was wrong, the name was wrong -- and
 * the editor is writing it while the thing they got wrong is still on the page
 * above them. An empty box asks them to invent the house form at that moment.
 *
 * Three decisions, none of them string handling:
 *
 *   - `correctionTemplate` is the note the desk can always write, from the two
 *     lines the editor types, with no model involved. "Without a model the box
 *     still fills" is a promise about the desk, not about a network call, so it
 *     is a pure function here and not a branch of the server call.
 *   - `correctionWordingPrompt` is the model's ask. It may only re-phrase the
 *     two lines the editor gave it and the story it can see; it may not add a
 *     fact, which is the one way this feature could make a correction worse
 *     than the thing it corrects.
 *   - `parseCorrectionWording` reads the model's answer back. A model that
 *     answers with a paragraph of its own commentary, or with three options, or
 *     with the prompt echoed back, must produce nothing the editor can post by
 *     accident -- a suggestion is offered to be edited, but it must be a
 *     correction note before it is offered at all.
 *
 * WHY HERE AND NOT IN corrections.ts. `corrections.ts` imports `../db.ts`,
 * which opens a database at import time and cannot be loaded by
 * `node --experimental-strip-types`, so a rule put there is only ever tested
 * through a running server. These are decisions over plain values, tested
 * directly by `correction-wording.test.ts` -- the same split `headline-control.ts`
 * and `provider-settings-input.ts` already use.
 */

/**
 * The longest correction note this desk will build or accept.
 *
 * `LIMITS.correctionBody` is the schema's own ceiling and the one the database
 * write is checked against, so a template or a suggestion at exactly this
 * length is still postable. A suggestion longer than this is a paragraph, not a
 * note, and offering it would spend the editor's click on something the post
 * button would then refuse.
 */
export const CORRECTION_MAX = LIMITS.correctionBody;

/** The longest "what was wrong" / "what is right" line the editor may type. */
export const CORRECTION_LINE_MAX = LIMITS.correctionLine;

/**
 * The note the desk writes itself, with no model.
 *
 * The house form is two sentences and it says the one thing a correction has to
 * say: this is what we printed, and this is what is true. It is deliberately
 * plain -- a model is asked for the same shape, and an editor who likes neither
 * can type their own, which is the path that never went away.
 *
 * A blank half produces nothing: "An earlier version of this story said ." is
 * worse than an empty box, because it looks finished. The caller is expected to
 * have both lines; when it does not, this answers null and the desk says which
 * line is missing rather than filling the box with a broken sentence.
 */
export function correctionTemplate(wasWrong: string, isRight: string): string | null {
  const wrong = cleanCorrectionLine(wasWrong);
  const right = cleanCorrectionLine(isRight);
  if (!wrong || !right) return null;
  return `An earlier version of this story said ${wrong}. In fact, ${right}.`.slice(0, CORRECTION_MAX);
}

/**
 * One of the editor's two lines, cleaned for a sentence.
 *
 * Trailing full stops come off because the line is pasted into a sentence the
 * desk writes: "said the fee was $4,200.." is the kind of thing that makes a
 * correction look careless, which is the opposite of its job.
 */
export function cleanCorrectionLine(raw: unknown): string {
  /*
    A line is a string or it is nothing. Coercing instead would print the text
    form of whatever arrived -- a number, an object -- into a published
    correction, which is a failure the editor cannot see coming.
  */
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
    .trim()
    .slice(0, CORRECTION_LINE_MAX);
}

/** What the editor typed, and the story it is about. */
export type CorrectionWordingInput = {
  /** "What was wrong" -- the editor's line. */
  wasWrong: string;
  /** "What is right" -- the editor's line. */
  isRight: string;
  /** The headline on the paper, so the model knows which story this is. */
  headline?: string;
  /** The printed body, trimmed by the caller. The model may read it for context. */
  body?: string;
};

/**
 * The model's ask. Nothing is applied without a click, and nothing is added.
 *
 * The two constraints that make this prompt different from the headline one:
 *
 *   - The answer is one note, not three options. A correction is not a choice
 *     between angles; the editor has already decided what was wrong and what is
 *     right, and the model is only writing it in the house form.
 *   - It may not introduce a fact. The story text is given as context so the
 *     note reads like it belongs to this piece, not so the model can summarize
 *     it -- a correction that adds a number nobody checked is a second error
 *     with the paper's name on it.
 */
export function correctionWordingPrompt(input: CorrectionWordingInput): {
  system: string;
  user: string;
} {
  const body = String(input.body ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return {
    system:
      "You write corrections for a small local newspaper. A correction is one short paragraph, " +
      "in the paper's own voice, that says plainly what the story got wrong and what is true. " +
      "Use only the two lines the editor gives you: never add a fact, a number, a name or a date " +
      "that is not in them. Do not apologize, do not explain how the error happened, do not " +
      "address the reader, do not mention the editor. Answer with the correction note and " +
      "nothing else -- no heading, no options, no commentary.",
    user: [
      input.headline ? `The story's headline: ${input.headline}` : "",
      `What was wrong: ${cleanCorrectionLine(input.wasWrong)}`,
      `What is right: ${cleanCorrectionLine(input.isRight)}`,
      body ? `The story as it printed, for tone only:\n${body}` : "",
      "Write the correction note now.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * The model's answer as a postable note, or null when it is not one.
 *
 * The model is asked for one note and often wraps it anyway: a markdown fence,
 * a lead-in sentence, a "Correction:" label, straight quotes around the whole
 * thing. Those come off. What is refused, because offering it would spend the
 * editor's click on something the post button then rejects:
 *
 *   - anything longer than the schema's own ceiling;
 *   - anything too short to be a correction (the desk's own minimum is eight
 *     characters, and "Sorry!" is not a correction);
 *   - a numbered or bulleted list, which means the model gave options when one
 *     note was asked for.
 *
 * The note is NOT required to contain the editor's two lines, because the model
 * is being asked to rephrase them -- a check that demanded the same words would
 * reject exactly the answers worth having. The editor reads it before posting;
 * that click is the gate, and this function only decides what may be put in
 * front of them.
 */
export function parseCorrectionWording(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    // A fenced block, with or without a language tag.
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/, "")
    /*
      Only the first line is read. A model that answers in two paragraphs has
      written an explanation, and the second paragraph is where its own opinion
      starts; taking the first keeps the note one note.
    */
    .split(/\r?\n/)[0]
    .trim()
    /*
      Quotes and the label come off in both orders. Which one is outermost is
      the model's choice -- `Correction: "…"` and `"Correction: …"` both occur --
      and stripping only one order leaves the other order's punctuation in the
      note that is put in front of the editor.
    */
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/^correction:\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // An answer that starts with a bullet or a number is a list of options.
  if (/^(?:[-*•]|\d+\s*[.)])\s+/.test(cleaned)) return null;
  if (cleaned.length < 8 || cleaned.length > CORRECTION_MAX) return null;
  return cleaned;
}

/**
 * The body the desk should store when the editor fixes the text, or null when
 * there is nothing to change.
 *
 * A blank body is refused rather than stored: a story with no text is not a
 * corrected story. An unchanged body writes no history row for the same reason
 * a second press of Save writes no headline row -- the history is the record of
 * decisions, and "pressed post twice" is not a second decision.
 *
 * No article row, no record. The caller finds the row inside the transaction
 * before it gets here, so this is the rule stated for what it is: a history row
 * whose "before" is empty text is not a record of a change, it is a claim that
 * the story used to be blank.
 */
export function bodyEditRecord(
  article: { body?: string | null } | null | undefined,
  next: string,
): { oldBody: string; newBody: string } | null {
  if (article == null) return null;
  const before = String(article.body ?? "").trim();
  const after = String(next ?? "").trim();
  if (!after || after === before) return null;
  return { oldBody: before, newBody: after };
}
