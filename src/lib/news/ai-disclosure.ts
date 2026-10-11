export type PublishedStoryDisclosureInput = {
  /** A line chosen by an editor or preserved from an imported publication. */
  text?: string | null;
  /** The original model-written body receipt; absent on manual-only drafts. */
  modelBody?: string | null;
  /** Draft research memo containing the public-research completion receipt. */
  researchJson?: string | null;
};

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
  if (aiDrafted && aiResearched) {
    return "A person reviewed and edited this story. AI tools helped find records and write the first draft. The records we used are listed under Sources.";
  }
  if (aiDrafted) {
    return "A person reviewed and edited this story. AI tools helped write the first draft. The records we used are listed under Sources.";
  }
  if (aiResearched) {
    return "A person wrote and edited this story. AI tools helped find records. The records we used are listed under Sources.";
  }
  return "";
}
