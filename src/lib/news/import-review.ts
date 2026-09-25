/**
 * The import review screen's model.
 *
 * `import-stories.ts` reads a paste into a `ParsedReport`; this turns that
 * report into the cards an editor actually edits, and answers the three
 * questions the screen asks of a card: what text will this story carry, is it
 * ready to import, and what is wrong with it if not.
 *
 * Kept apart from the route so the rules are testable without a browser, and
 * so the wording the editor reads lives in one place instead of being spread
 * through JSX.
 */

import { titlesOverlap, topicFromText } from "./desk-copy.ts";
import {
  IMPORT_LIMITS,
  disclosureLine,
  type DisclosureKey,
  type ParsedReport,
} from "./import-stories.ts";

/** Which text the imported story carries. */
export type BodyChoice = "main" | "brief" | "both";

export const BODY_CHOICES: { key: BodyChoice; label: string; note: string }[] = [
  { key: "main", label: "The story as written", note: "The body paragraphs the report wrote for this story." },
  {
    key: "brief",
    label: "The plain-language brief",
    note: "The shorter version, when the report wrote one.",
  },
  {
    key: "both",
    label: "Both, brief first",
    note: "The brief, then the full story underneath it.",
  },
];

export type ReviewLink = { text: string; url: string; keep: boolean };

export type ReviewCard = {
  key: string;
  /** The import tick box. Non-story sections arrive unticked. */
  include: boolean;
  /** False for a section of the report that is not a story. */
  isStory: boolean;
  headline: string;
  /** The section suggestion from the topic chooser, kept so "reset" is possible. */
  suggestedSection: string;
  /** A newsroom section key, or "" for "Section not chosen — pick one". */
  section: string;
  dek: string;
  bodyChoice: BodyChoice;
  /** The story's own paragraphs, exactly as pasted. */
  body: string;
  /** `**Plain-language brief:**`, exactly as pasted ("" when the report has none). */
  plainBrief: string;
  links: ReviewLink[];
  /** Editor notes. Never published. */
  score: string;
  triage: string;
  reporterNextStep: string;
  /** A Hold triage imports with a visible Hold flag. */
  hold: boolean;
  disclosureKey: DisclosureKey;
  disclosureOther: string;
  /** False when the reader could not split this cleanly — show the flag. */
  cleanSplit: boolean;
  warning: string;
};

/** The section an editor must pick; the card cannot import without one. */
export const NO_SECTION = "";

export const SECTION_REQUIRED = "Section not chosen — pick one";

/**
 * Build the cards the review screen opens with.
 *
 * A non-story section (the brief's "Beat context", "Signals and watch list",
 * "Upcoming dates") arrives unticked, and a story with a Hold triage arrives
 * ticked with `hold` set, so the Hold is visible on the Queue rather than
 * being a decision made for the editor.
 */
export function cardsFromReport(
  report: ParsedReport,
  opts: { disclosureKey?: DisclosureKey } = {},
): ReviewCard[] {
  return report.stories.map((story) => ({
    key: story.key,
    include: story.isStory,
    isStory: story.isStory,
    headline: story.headline.slice(0, IMPORT_LIMITS.headline),
    suggestedSection: story.sectionSuggestion || topicFromText(`${story.headline}\n${story.body}`),
    section: story.isStory
      ? story.sectionSuggestion || topicFromText(`${story.headline}\n${story.body}`)
      : NO_SECTION,
    dek: story.dek,
    bodyChoice: "main",
    body: story.body,
    plainBrief: story.plainBrief,
    links: story.links.map((l) => ({ ...l, keep: true })),
    score: story.score,
    triage: story.triage,
    reporterNextStep: story.reporterNextStep,
    hold: story.holds,
    disclosureKey: opts.disclosureKey ?? story.disclosureKey,
    disclosureOther: "",
    cleanSplit: story.cleanSplit,
    warning: story.warning,
  }));
}

/**
 * The text this card will import, from the choice the editor made.
 *
 * A choice that names text the report does not have falls back to what exists
 * rather than importing an empty story: "the brief" when there is no brief is
 * the story as written, never nothing.
 */
export function cardBody(card: ReviewCard): string {
  const main = card.body.trim();
  const brief = card.plainBrief.trim();
  if (card.bodyChoice === "brief") return brief || main;
  if (card.bodyChoice === "both") {
    if (brief && main && brief !== main) return `${brief}\n\n${main}`;
    return brief || main;
  }
  return main || brief;
}

/** The dek, which is also a `**Why it matters:**` paragraph when the report wrote one. */
export function cardDek(card: ReviewCard): string {
  return card.dek.trim();
}

/** The source links the editor left ticked, in the report's own order. */
export function keptLinks(card: ReviewCard): { text: string; url: string }[] {
  return card.links.filter((l) => l.keep && l.url.trim()).map(({ text, url }) => ({ text, url }));
}

/** The reader-facing line this card would print. */
export function cardDisclosure(card: ReviewCard): string {
  return disclosureLine(card.disclosureKey, card.disclosureOther);
}

/**
 * What stops this card from importing, worded for the editor.
 *
 * Empty means ready. The section check is the desk's ordinary
 * section-confirmation gate and it applies to an imported story exactly as it
 * applies to a written one: nothing reaches the paper filed under a section
 * nobody chose.
 */
export function cardProblems(card: ReviewCard): string[] {
  const problems: string[] = [];
  if (!card.headline.trim()) problems.push("Give it a headline first.");
  if (!cardBody(card).trim()) problems.push("This story has no text.");
  if (!card.section.trim()) problems.push(SECTION_REQUIRED);
  if (card.disclosureKey === "other" && !card.disclosureOther.trim())
    problems.push("Write the disclosure line, or pick one of the ready-made ones.");
  return problems;
}

/** The cards the editor ticked, in the report's own order. */
export function tickedCards(cards: ReviewCard[]): ReviewCard[] {
  return cards.filter((c) => c.include);
}

/**
 * The duplicate warning shown on a card, when there is one.
 *
 * Deliberately a warning and nothing else: the editor decides. The desk does
 * not merge, kill or rename an imported story behind their back.
 */
export type DuplicateWarning = { headline: string; slug?: string; leadId?: number };

export function duplicateNote(warning: DuplicateWarning | undefined): string {
  if (!warning) return "";
  const where = warning.slug ? `already published as “${warning.headline}”` : `already on the desk as “${warning.headline}”`;
  return `This looks like a story ${where}. Import it anyway if it is different — you decide.`;
}

/**
 * Whether a card looks like a story the paper already has.
 *
 * A report covering the last month of meetings will happily re-tell something
 * already printed, and the desk is the only place that can say so. Both lists
 * come from questions the Queue screen already asks (`listLeads`,
 * `listPublishedDesk`), so this costs no extra round trip.
 *
 * Published is checked before the desk: "already in the paper" is the more
 * useful of the two facts when both are true, and the editor can still see the
 * card in front of them either way. The headline is compared with the same
 * `titlesOverlap` the desk already uses for its own ≈ PRINTED flag, so an
 * imported story is judged by the rule every other story on the desk is.
 */
export function findDuplicate(
  card: { headline: string },
  existing: {
    leads?: { id: number; headline: string }[];
    published?: { slug: string; headline: string; published_at?: string }[];
  },
): DuplicateWarning | undefined {
  const headline = card.headline.trim();
  if (!headline) return undefined;
  const printed = (existing.published ?? []).find((p) => titlesOverlap(headline, p.headline));
  if (printed) return { headline: printed.headline, slug: printed.slug };
  const lead = (existing.leads ?? []).find((l) => titlesOverlap(headline, l.headline));
  if (lead) return { headline: lead.headline, leadId: lead.id };
  return undefined;
}

/** The label for a card, used by the tick box and the status line. */
export function cardLabel(card: ReviewCard): string {
  const headline = card.headline.trim() || "Untitled";
  return card.isStory ? `Story: ${headline}` : `Not a story: ${headline}`;
}
