export type PublishedStoryDisclosureInput = {
  /** A line chosen by an editor or preserved from an imported publication. */
  text?: string | null;
  /** The original model-written body receipt; absent on manual-only drafts. */
  modelBody?: string | null;
  /** Draft research memo containing the public-research completion receipt. */
  researchJson?: string | null;
  /** The body that was published; compared with `modelBody` to tell an unchanged AI draft from an edited one. */
  publishedBody?: string | null;
  /**
   * The piece went to paper through "Publish anyway" over claims nobody
   * reviewed (audit action `publish-unreviewed-claims`). The line then says
   * an editor published it, not that one approved it, and says some claims
   * were not checked.
   */
  publishedWithUnreviewedClaims?: boolean;
};

const AI_DRAFTED_AND_RESEARCHED_LINE = "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
const AI_DRAFTED_LINE = "A person reviewed and edited this story. AI tools helped write the first draft. The records we used are listed under Sources.";
const AI_RESEARCHED_LINE = "A person wrote and edited this story. AI tools helped find records. The records we used are listed under Sources.";
// D67 (DHF-2): an AI draft published with its body unchanged was approved, not edited.
const AI_DRAFTED_AND_RESEARCHED_APPROVED_LINE = "An editor approved this story for publication. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
const AI_DRAFTED_APPROVED_LINE = "An editor approved this story for publication. AI tools helped write the first draft. The records we used are listed under Sources.";

// THT-17: an override of unreviewed claims is never an approval. These say what happened.
const AI_DRAFTED_AND_RESEARCHED_UNCHECKED_LINE = "An editor published this story. AI tools helped find records and write the first draft. Some claims in it were not checked against sources. The records we used are listed under Sources.";
const AI_DRAFTED_UNCHECKED_LINE = "An editor published this story. AI tools helped write the first draft. Some claims in it were not checked against sources. The records we used are listed under Sources.";
const AI_RESEARCHED_UNCHECKED_LINE = "A person wrote and edited this story. AI tools helped find records. Some claims in it were not checked against sources. The records we used are listed under Sources.";

// The import screen's old "An outside AI tool" preset line. Like the lines above
// it was never an editor's own words, so a copy saved on an article is dropped.
const OUTSIDE_AI_IMPORT_LINE = "An outside AI research tool wrote this from public records; an editor reviewed it.";

const DERIVED_LINES = [
  OUTSIDE_AI_IMPORT_LINE,
  AI_DRAFTED_AND_RESEARCHED_LINE,
  AI_DRAFTED_LINE,
  AI_RESEARCHED_LINE,
  AI_DRAFTED_AND_RESEARCHED_APPROVED_LINE,
  AI_DRAFTED_APPROVED_LINE,
  AI_DRAFTED_AND_RESEARCHED_UNCHECKED_LINE,
  AI_DRAFTED_UNCHECKED_LINE,
  AI_RESEARCHED_UNCHECKED_LINE,
];

/** True when a saved line is one this module derives from the receipts, not one an editor typed. */
export function isDerivedDisclosureLine(text: string | null | undefined): boolean {
  return DERIVED_LINES.includes(text?.trim() ?? "");
}

/**
 * The line a reader sees under a published story. Scott, Oct 12 2026: "NO
 * reference to AI anywhere in this system except ONE place and I'll write it.
 * In the about section." So no line is derived from the authoring receipts any
 * more. Only a line an editor typed (an imported story's own wording) is shown;
 * a saved AI line from before this change is dropped.
 */
export function disclosureForPublishedStory({ text }: PublishedStoryDisclosureInput): string {
  if (isDerivedDisclosureLine(text)) return "";
  return text?.trim() ?? "";
}

/** The line a reader sees on a published story; see disclosureForPublishedStory. */
export function disclosureForReader(input: PublishedStoryDisclosureInput & { pastedByEditor?: boolean }): string {
  return disclosureForPublishedStory(input);
}
