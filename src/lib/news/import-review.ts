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

import { titlesOverlap } from "./desk-copy.ts";
import {
  IMPORT_LIMITS,
  disclosureLine,
  type DisclosureKey,
  type ImportKind,
  type ParsedReport,
} from "./import-stories.ts";

/**
 * Where the Desk parks a paste on its way to the import screen.
 *
 * The Desk's second choice ("Import finished stories") takes the paste in the
 * same place the editor is already working, and the review screen opens with it
 * already in the box. A paste can be a quarter of a megabyte, so it cannot ride
 * in the URL; this is the same handoff the Desk already uses to open a Dark
 * Desk investigation (`townreporter.dark.openId`). Absent or unreadable, the
 * review screen simply opens empty with its own box.
 */
export const IMPORT_PASTE_KEY = "townreporter.import.paste";

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

/** What a card can be imported as, in the words the card wears. */
export const IMPORT_KINDS: { key: ImportKind; label: string; note: string }[] = [
  {
    key: "story",
    label: "Finished story",
    note: "It goes in as a draft holding the text it carries, ready to edit and publish.",
  },
  {
    key: "idea",
    label: "Story idea",
    note: "It goes in as a lead with the description as its why, for someone to write.",
  },
];

export type ReviewCard = {
  key: string;
  /** The import tick box. Non-story sections arrive unticked. */
  include: boolean;
  /** What the editor is about to tick this as, until they say otherwise. */
  kind: ImportKind;
  /** The tick box as the reader set it, so "reset" has something to reset to. */
  includeByDefault: boolean;
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
  /**
   * The documents the report cited that have no URL (a packet page, a
   * recording), in its own words. Filed beside the links, never printed as one.
   */
  citations: string[];
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
 *
 * The tick comes from the reader's `includeByDefault` rather than from
 * `isStory`: a report can list a lead it also dropped, and a card the report
 * dropped is a card the editor should have to tick on purpose. What a card is
 * -- a finished story or a story idea -- is the reader's `kind`, which the
 * editor can overrule on the card.
 */
export function cardsFromReport(
  report: ParsedReport,
  opts: { disclosureKey?: DisclosureKey } = {},
): ReviewCard[] {
  return report.stories.map((story) => ({
    key: story.key,
    include: story.includeByDefault,
    kind: story.kind,
    includeByDefault: story.includeByDefault,
    isStory: story.isStory,
    headline: story.headline.slice(0, IMPORT_LIMITS.headline),
    suggestedSection: story.sectionSuggestion,
    section: story.isStory ? story.sectionSuggestion : NO_SECTION,
    dek: story.dek,
    bodyChoice: "main",
    body: story.body,
    plainBrief: story.plainBrief,
    citations: story.citations,
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
 * What the review screen says it just read, in the shape of what it found.
 *
 * "Read 19 stories" was true of every paste this box used to accept, because
 * every card in one was a written story. A report that lists leads it has not
 * written, and a paste that is nothing but an idea list, are both read here
 * now, and an editor who pastes eight ideas and is told eight stories have been
 * read will go looking for eight stories that are not there.
 */
export function readSummary(report: ParsedReport): string {
  const leads = report.stories.filter((s) => s.isStory);
  const ideas = leads.filter((s) => s.kind === "idea").length;
  const stories = leads.length - ideas;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (report.method === "plain") {
    return stories + ideas <= 1 ? "Read one story, with no headings to split it." : "Read the paste.";
  }
  const parts = [
    stories ? plural(stories, "story", "stories") : "",
    ideas ? plural(ideas, "story idea", "story ideas") : "",
  ].filter(Boolean);
  if (parts.length === 0) return "Read the paste.";
  return `Read ${parts.join(" and ")} out of the paste.`;
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
 *
 * The missing-text line names what the card is: an idea that came in with
 * nothing under it is missing a description, and telling its editor it "has no
 * text" would send them looking for a body the card was never going to have.
 */
export function cardProblems(card: ReviewCard): string[] {
  const problems: string[] = [];
  if (!card.headline.trim()) problems.push("Give it a headline first.");
  if (!cardBody(card).trim())
    problems.push(card.kind === "idea" ? "This idea has no description." : "This story has no text.");
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

/**
 * The label for a card, used by the tick box and the status line.
 *
 * No "Story: " in front of a headline the HEADLINE field two lines below
 * already shows word for word (coordinator review of the Unit X screenshots,
 * 2026-09-24) -- the prefix only said "story" to an editor who is looking at a
 * story card. The one card that must keep its word is the one that is not a
 * story: that is the whole reason the label exists.
 *
 * An idea keeps a word for the same reason: "Story idea: The budget's water
 * fund gap" is the one line that tells an editor the card holds a description
 * rather than a written story. What is still not repeated is the headline
 * itself, which the field beneath shows word for word.
 */
export function cardLabel(card: ReviewCard): string {
  const headline = card.headline.trim() || "Untitled";
  if (!card.isStory) return `Not a story: ${headline}`;
  return card.kind === "idea" ? `Story idea: ${headline}` : headline;
}

/**
 * What one card sends to the import server function.
 *
 * Declared here rather than imported from `import-stories.server.ts` so this
 * module stays client-safe: it is read by the Desk and by the review screen,
 * and neither should have a `.server.ts` edge in its bundle. It is the same
 * shape as that file's `ImportSelection`, and TypeScript checks the two against
 * each other at every call site, so they cannot drift apart quietly.
 */
export type ImportSelectionPayload = {
  headline: string;
  /**
   * A finished story is filed as a lead and a draft; a story idea is filed as
   * a lead only, waiting for someone to write it.
   */
  kind: ImportKind;
  section: string;
  dek: string;
  body: string;
  /** The documents the report cited that carry no URL. Never printed as links. */
  citations: string[];
  links: { text: string; url: string }[];
  score: string;
  triage: string;
  reporterNextStep: string;
  hold: boolean;
  disclosureKey: DisclosureKey;
  disclosureOther: string;
};

/**
 * One card, as the payload the import server function takes.
 *
 * The single mapping from a card to a row, so the review screen and the Desk's
 * one-story paste cannot save the same card two different ways.
 */
export function selectionFromCard(card: ReviewCard): ImportSelectionPayload {
  return {
    headline: card.headline.trim(),
    kind: card.kind,
    section: card.section,
    dek: cardDek(card),
    body: cardBody(card),
    citations: card.citations.slice(),
    links: keptLinks(card),
    score: card.score,
    triage: card.triage,
    reporterNextStep: card.reporterNextStep,
    hold: card.hold,
    disclosureKey: card.disclosureKey,
    disclosureOther: card.disclosureOther.trim(),
  };
}
