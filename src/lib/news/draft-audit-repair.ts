/**
 * The bounded style repair: audit the draft, hand the model ONLY the problems
 * the audit found, take its rewrite, audit again -- at most twice -- and throw
 * the rewrite away if it broke something the audit cannot see.
 *
 * Code measures, the model rewrites, code checks. That order matters: the
 * model never sees a general instruction like "make this better", so it has
 * nothing to improve except the listed problems, and it can never wander.
 *
 * The guard is the point of this file. A model asked to fix a comma will
 * happily also "tidy" a quotation, round a number, or drop the name of the
 * person who said the thing -- and a newsroom cannot publish the result of
 * that, because nothing would have noticed. So every rewrite is compared
 * against the text it replaces: quotes, numbers, names and links must survive
 * unchanged, the draft must not be gutted, and the rhythm must not be
 * flattened. A rewrite that fails any of those is REJECTED and the previous
 * text is kept. Nothing here publishes anything; a rejection costs a round and
 * the editor still sees every finding.
 *
 * PURE. No I/O, no clock, no database, no model: the provider call arrives as
 * a `DraftRepairCall` argument, which is what makes the loop testable with a
 * fake and is the same seam `desk-model-run.ts` uses.
 */
import {
  DRAFT_AUDIT_LIMITS,
  auditDraft,
  quotedSpans,
  urlsIn,
  type DraftAuditFinding,
  type DraftAuditResult,
} from "./draft-audit.ts";

export const DRAFT_REPAIR_LIMITS = {
  /**
   * Starting values, alongside `DRAFT_AUDIT_LIMITS`: two rounds is enough to
   * clear the phrase-level problems the audit reports, and the loop stops
   * early on its own when a round changes nothing or is rejected.
   */
  maxRounds: 2,
  /** A rewrite that keeps less than this share of the words is a rewrite of
   *  the story, not a repair of it. */
  minWordShareKept: 0.6,
  /** A long list invites the model to rewrite the whole draft, so only the
   *  first few problems are sent in one round. */
  maxFindingsSent: 12,
  /** A quotation is compared whole; anything shorter is noise. */
  minQuotedChars: 4,
} as const;

export type DraftRepairStatus = "clean" | "repaired" | "open" | "provider-failed";

/** What one problem looks like to the model: where it is and what it is. No
 *  snippet, because the model is given the draft itself and a snippet would
 *  only tempt it to treat the quote as the thing to edit. */
export type DraftRepairInstruction = {
  paragraph: number;
  sentence: number;
  message: string;
};

export type DraftRepairRequest = {
  findings: DraftRepairInstruction[];
  body: string;
};

export type DraftRepairCall = (
  request: DraftRepairRequest,
) => Promise<{ ok: true; body: string } | { ok: false; error: string }>;

export type DraftStyleRepairOutcome = {
  version: 1;
  /** The text to keep: the repaired body, or exactly what came in. */
  body: string;
  status: DraftRepairStatus;
  /** Rounds that actually reached the model. */
  rounds: number;
  repairCalls: number;
  before: DraftAuditResult;
  after: DraftAuditResult;
  /** Every rewrite this loop refused, and the plain reason it refused it. */
  rejections: Array<{ round: number; reason: string }>;
  /** One plain sentence for the editor. */
  note: string;
};

/*
  ── What a rewrite is not allowed to touch ──────────────────────────────────
*/

const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]*/g;
const DIGIT_TOKEN = /\d[\d,.]*/g;

/**
 * Words that are capitalised for grammar rather than because they name
 * somebody. Kept short on purpose: a word wrongly listed here stops a name
 * from being protected, and a word wrongly left out only costs a round.
 */
const COMMON_CAPITALIZED = new Set([
  "The", "A", "An", "And", "But", "Or", "If", "As", "So", "Then", "Now", "Also", "However",
  "Meanwhile", "After", "Before", "When", "While", "There", "This", "That", "These", "Those",
  "It", "Its", "He", "She", "They", "We", "You", "I", "In", "On", "At", "By", "For", "With",
  "From", "To", "Of", "Not", "No", "Yes", "More", "Most", "Both", "Each", "Every", "Some",
  "Many", "Still", "Later", "Last", "Next", "First", "Second", "Third", "One", "Two", "Three",
  "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "His", "Her", "Their", "Our", "Your",
]);

const sentencesOf = (text: string): string[] =>
  text
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);

/**
 * Capitalised words that sit inside a sentence and are not common words. The
 * best stand-in for "a name" this file can manage without a grammar: a word
 * at the start of a sentence is capitalised for free, so it is skipped, and a
 * word that is simply a common word is skipped too.
 */
function nameCandidates(text: string): string[] {
  const found: string[] = [];
  for (const sentence of sentencesOf(text)) {
    const words = sentence.match(WORD_PATTERN) ?? [];
    for (let i = 1; i < words.length; i += 1) {
      const word = words[i]!;
      if (!/^[A-Z]/.test(word) || COMMON_CAPITALIZED.has(word)) continue;
      found.push(word);
    }
  }
  return [...new Set(found)];
}

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Anywhere in the text, ignoring case: a rewrite may move a name, not lose it. */
const mentions = (text: string, word: string): boolean =>
  new RegExp(`\\b${escapeForRegExp(word)}\\b`, "i").test(text);

const sortedTokens = (text: string, pattern: RegExp): string[] =>
  (text.match(pattern) ?? []).map((token) => token.replace(/[.,]+$/, "")).sort();

const sameMultiset = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const countWordsIn = (text: string): number => (text.match(/\S+/g) ?? []).length;

/**
 * Why this rewrite must not be used, or null when it may be.
 *
 * Every reason is a fact about the two texts, not a judgement about the
 * writing -- which is why the loop can act on it without a model.
 */
export function repairKeepsFacts(previous: string, next: string): string | null {
  if (next.trim().length === 0) return "the model returned nothing";
  if (next.trim() === previous.trim()) return "the model returned the draft unchanged";
  if (countWordsIn(next) < countWordsIn(previous) * DRAFT_REPAIR_LIMITS.minWordShareKept) {
    return "the model cut the draft down instead of repairing it";
  }

  /*
    Quotations first. A quoted span is the source's own words; a rewrite of it
    is not a style repair, it is putting words in somebody's mouth. Compared as
    a multiset so a rewrite may move a quotation, never reword one.
  */
  const quotes = (text: string) =>
    quotedSpans(text)
      .filter((span) => span.length >= DRAFT_REPAIR_LIMITS.minQuotedChars)
      .sort();
  if (!sameMultiset(quotes(previous), quotes(next))) return "it changed quoted words";

  /*
    Links next, and before the numbers: a URL usually carries digits, so a
    rewrite that edits `/agenda/2026` to `/agenda/2027` reads as a changed
    number to the check below and would tell the editor something untrue about
    what the model did.
  */
  const urls = (text: string) => urlsIn(text).map((url) => url.replace(/[.,;]+$/, "")).sort();
  if (!sameMultiset(urls(previous), urls(next))) return "it changed a link";

  const digits = (text: string) => sortedTokens(text, DIGIT_TOKEN);
  if (!sameMultiset(digits(previous), digits(next))) return "it changed a number";

  const namesBefore = nameCandidates(previous);
  const namesAfter = nameCandidates(next);
  const lost = namesBefore.find((name) => !mentions(next, name));
  if (lost) return `it dropped the name "${lost}"`;
  const invented = namesAfter.find((name) => !mentions(previous, name));
  if (invented) return `it added the name "${invented}"`;

  return null;
}

/**
 * Why this rewrite flattened the prose, or null when the rhythm held.
 *
 * Only fires when the draft HAD rhythm to lose and both texts are long enough
 * for the measurement to mean anything: short drafts are flat by nature, and
 * a repair is not blamed for a number that was never above the line.
 */
export function repairFlattenedRhythm(before: DraftAuditResult, after: DraftAuditResult): string | null {
  const longEnough = (result: DraftAuditResult): boolean =>
    result.measurements.sentenceCount >= DRAFT_AUDIT_LIMITS.minSentencesForRhythm;
  if (!longEnough(before) || !longEnough(after)) return null;
  if (before.measurements.sentenceLengthCv < DRAFT_AUDIT_LIMITS.minSentenceLengthCv) return null;
  if (after.measurements.sentenceLengthCv >= DRAFT_AUDIT_LIMITS.minSentenceLengthCv) return null;
  return "it evened out the sentence lengths the draft had";
}

/**
 * The findings worth sending to a model that returns a body: only the
 * fix-level ones, only the ones in the body, and never more than a handful.
 *
 * A headline or dek finding is left out on purpose. The call returns a body,
 * so the model cannot act on it, and sending it would only invite the model to
 * rewrite the opening line somewhere other than where it belongs. Those
 * findings stay in the list for the editor.
 */
export function repairInstructions(
  result: DraftAuditResult,
  limit = DRAFT_REPAIR_LIMITS.maxFindingsSent,
): DraftRepairInstruction[] {
  return result.findings
    .filter((finding: DraftAuditFinding) => finding.severity === "fix" && finding.paragraph > 0)
    .slice(0, limit)
    .map(({ paragraph, sentence, message }) => ({ paragraph, sentence, message }));
}

/** The prompt for one repair round: the problems, then the draft. */
export function buildDraftRepairPrompt(request: DraftRepairRequest): { system: string; user: string } {
  const system = [
    "You fix specific, listed style problems in one news draft.",
    "",
    "How to work:",
    "- Fix only what the listed problems are about. Leave every other sentence as it is.",
    "- Keep every name, number, date, quotation and link exactly as the draft has it.",
    "- Words inside quotation marks belong to the person who said them. Never change them.",
    "- Never add a fact, and never invent a name for a speaker the draft does not name. If a",
    "  problem can only be fixed by adding one, leave that sentence alone.",
    "- Keep the draft's pace: short sentences stay short, long ones stay long.",
    "",
    "Reply with the corrected draft alone. No notes, no headings, no explanation.",
  ].join("\n");
  const user = [
    "Problems the style check found:",
    ...request.findings.map(
      (finding) => `- Paragraph ${finding.paragraph}, sentence ${finding.sentence}: ${finding.message}`,
    ),
    "",
    "The draft:",
    "",
    request.body,
  ].join("\n");
  return { system, user };
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Audit, repair, audit again -- at most `maxRounds` times, and only while the
 * audit still reports something to fix.
 *
 * The body this returns is always the safest text available: the last rewrite
 * that survived the guard, or the text that came in.
 */
export async function repairDraftStyle(input: {
  headline: string;
  dek: string;
  body: string;
  form: string;
  repair: DraftRepairCall;
  maxRounds?: number;
}): Promise<DraftStyleRepairOutcome> {
  const measure = (body: string): DraftAuditResult =>
    auditDraft({ headline: input.headline, dek: input.dek, body, form: input.form });

  const before = measure(input.body);
  const rejections: Array<{ round: number; reason: string }> = [];
  let body = input.body;
  let current = before;
  let rounds = 0;
  let repairCalls = 0;

  const finish = (status: DraftRepairStatus, note: string): DraftStyleRepairOutcome => ({
    version: 1,
    body,
    status,
    rounds,
    repairCalls,
    before,
    after: current,
    rejections,
    note,
  });

  if (before.fixCount === 0) {
    return finish("clean", "The style check found nothing to fix, so no rewrite was asked for.");
  }

  const maxRounds = input.maxRounds ?? DRAFT_REPAIR_LIMITS.maxRounds;
  while (rounds < maxRounds && current.fixCount > 0) {
    const findings = repairInstructions(current);
    // Nothing in the list can be acted on by a call that returns a body: every
    // remaining problem is in the headline or the dek, and those are the
    // editor's to fix.
    if (findings.length === 0) break;

    rounds += 1;
    repairCalls += 1;
    const attempt = await input.repair({ findings, body });
    if (!attempt.ok) {
      /*
        A failed call leaves the draft exactly as the writer left it. The audit
        findings still stand and the editor still sees them; there is nothing
        to undo and nothing to report but the plain reason.
      */
      return finish(
        "provider-failed",
        `The style repair did not run: ${attempt.error} The draft is unchanged.`,
      );
    }

    const rewritten = attempt.body;
    const factProblem = repairKeepsFacts(body, rewritten);
    if (factProblem) {
      rejections.push({ round: rounds, reason: factProblem });
      return finish("open", `The model's rewrite was not used: ${factProblem}. The draft is unchanged.`);
    }

    const next = measure(rewritten);
    const rhythmProblem = repairFlattenedRhythm(current, next);
    if (rhythmProblem) {
      rejections.push({ round: rounds, reason: rhythmProblem });
      return finish("open", `The model's rewrite was not used: ${rhythmProblem}. The draft is unchanged.`);
    }

    body = rewritten;
    current = next;
  }

  if (current.fixCount === 0) {
    return finish(
      "repaired",
      `The model repaired the ${plural(before.fixCount - current.fixCount, "problem", "problems")} the style check found.`,
    );
  }
  return finish(
    "open",
    `${plural(current.fixCount, "problem", "problems")} to fix ${current.fixCount === 1 ? "is" : "are"} still there. Fix ${current.fixCount === 1 ? "it" : "them"} by hand, or ask the model again.`,
  );
}
