export type PublishedStoryDisclosureInput = {
  /** A line chosen by an editor or preserved from an imported publication. */
  text?: string | null;
  /** The original model-written body receipt; absent on manual-only drafts. */
  modelBody?: string | null;
  /** Draft research memo containing the public-research completion receipt. */
  researchJson?: string | null;
  /** The body that was published; compared with `modelBody` to tell an unchanged AI draft from an edited one. */
  publishedBody?: string | null;
};

const AI_DRAFTED_AND_RESEARCHED_LINE = "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
const AI_DRAFTED_LINE = "A person reviewed and edited this story. AI tools helped write the first draft. The records we used are listed under Sources.";
const AI_RESEARCHED_LINE = "A person wrote and edited this story. AI tools helped find records. The records we used are listed under Sources.";
// D67 (DHF-2): an AI draft published with its body unchanged was approved, not edited.
const AI_DRAFTED_AND_RESEARCHED_APPROVED_LINE = "An editor approved this story for publication. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
const AI_DRAFTED_APPROVED_LINE = "An editor approved this story for publication. AI tools helped write the first draft. The records we used are listed under Sources.";

const DERIVED_LINES = [
  AI_DRAFTED_AND_RESEARCHED_LINE,
  AI_DRAFTED_LINE,
  AI_RESEARCHED_LINE,
  AI_DRAFTED_AND_RESEARCHED_APPROVED_LINE,
  AI_DRAFTED_APPROVED_LINE,
];

/** True when a saved line is one this module derives from the receipts, not one an editor typed. */
export function isDerivedDisclosureLine(text: string | null | undefined): boolean {
  return DERIVED_LINES.includes(text?.trim() ?? "");
}

function completedPublicAiResearch(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      && (parsed as Record<string, unknown>).publicAiResearchCompleted === true;
  } catch {
    return false;
  }
}

/**
 * Derive the public AI line from the two saved receipts of work that actually
 * ran. A saved editor-authored line takes priority; missing receipts make no
 * claim. This also lets old articles fail closed when their originating draft
 * has since been removed.
 */
export function disclosureForPublishedStory({
  text,
  modelBody,
  researchJson,
  publishedBody,
}: PublishedStoryDisclosureInput): string {
  const chosen = text?.trim();
  if (chosen) return chosen;

  const aiDrafted = Boolean(modelBody?.trim());
  const aiResearched = completedPublicAiResearch(researchJson);
  // Only a body that is still exactly the model's draft counts as approved; any edit keeps the edited line.
  const approved = aiDrafted && publishedBody?.trim() === modelBody?.trim();
  if (aiDrafted && aiResearched) return approved ? AI_DRAFTED_AND_RESEARCHED_APPROVED_LINE : AI_DRAFTED_AND_RESEARCHED_LINE;
  if (aiDrafted) return approved ? AI_DRAFTED_APPROVED_LINE : AI_DRAFTED_LINE;
  if (aiResearched) return AI_RESEARCHED_LINE;
  return "";
}

/**
 * The line a reader sees on a published story. A piece the editor pasted in
 * (`pastedByEditor`) has no model-written draft, so its model body is never an
 * AI receipt, and a stored line this module derived for it (written before
 * FC04 was fixed) is dropped. An editor's own line still stands.
 */
export function disclosureForReader({
  text,
  modelBody,
  researchJson,
  publishedBody,
  pastedByEditor,
}: PublishedStoryDisclosureInput & { pastedByEditor?: boolean }): string {
  // A stored derived line (the publish path saved one before D67) is recomputed from the receipts, so the
  // approved-or-edited wording follows the body a reader is actually shown.
  const chosen = isDerivedDisclosureLine(text) ? null : text;
  if (!pastedByEditor) return disclosureForPublishedStory({ text: chosen, modelBody, researchJson, publishedBody });
  return disclosureForPublishedStory({
    text: chosen,
    modelBody: null,
    researchJson,
  });
}
