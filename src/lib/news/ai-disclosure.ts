export type PublishedStoryDisclosureInput = {
  /** A line chosen by an editor or preserved from an imported publication. */
  text?: string | null;
  /** The original model-written body receipt; absent on manual-only drafts. */
  modelBody?: string | null;
  /** Draft research memo containing the public-research completion receipt. */
  researchJson?: string | null;
};

const AI_DRAFTED_AND_RESEARCHED_LINE = "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
const AI_DRAFTED_LINE = "A person reviewed and edited this story. AI tools helped write the first draft. The records we used are listed under Sources.";
const AI_RESEARCHED_LINE = "A person wrote and edited this story. AI tools helped find records. The records we used are listed under Sources.";

/** True when a saved line is one this module derives from the receipts, not one an editor typed. */
export function isDerivedDisclosureLine(text: string | null | undefined): boolean {
  return [AI_DRAFTED_AND_RESEARCHED_LINE, AI_DRAFTED_LINE, AI_RESEARCHED_LINE].includes(text?.trim() ?? "");
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
}: PublishedStoryDisclosureInput): string {
  const chosen = text?.trim();
  if (chosen) return chosen;

  const aiDrafted = Boolean(modelBody?.trim());
  const aiResearched = completedPublicAiResearch(researchJson);
  if (aiDrafted && aiResearched) return AI_DRAFTED_AND_RESEARCHED_LINE;
  if (aiDrafted) return AI_DRAFTED_LINE;
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
  pastedByEditor,
}: PublishedStoryDisclosureInput & { pastedByEditor?: boolean }): string {
  if (!pastedByEditor) return disclosureForPublishedStory({ text, modelBody, researchJson });
  return disclosureForPublishedStory({
    text: isDerivedDisclosureLine(text) ? null : text,
    modelBody: null,
    researchJson,
  });
}
