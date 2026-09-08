export type Section = {
  key: string;
  name: string;
  visible: boolean;
  brief: string;
  instructions: string;
  replacementKey: string | null;
  sourceIds: number[];
};
export type SectionConfig = { revision: number; sections: Section[] };
export type SectionSourceLabel = { id: number; title: string; url: string };
export type SectionPreviewChange = {
  key: string;
  nameBefore: string | null;
  nameAfter: string;
  positionBefore: number | null;
  positionAfter: number;
  visibleBefore: boolean | null;
  visibleAfter: boolean;
  briefBefore: string | null;
  briefAfter: string;
  instructionsBefore: string | null;
  instructionsAfter: string;
  sourcesBefore: SectionSourceLabel[];
  sourcesAfter: SectionSourceLabel[];
  replacementBefore: string | null;
  replacementAfter: string | null;
};
export type SectionScanSnapshot = Pick<
  Section,
  "key" | "name" | "brief" | "instructions" | "sourceIds"
> & { revision: number };

/** The worker revalidates acceptance after enqueue, even for pinned IDs. */
export function selectedScanSources<T extends { id: number; status: string }>(
  snapshot: SectionScanSnapshot | null,
  sources: T[],
): T[] {
  return sources.filter(
    (s) => s.status === "accepted" && (!snapshot || snapshot.sourceIds.includes(s.id)),
  );
}

export function sectionPreviewChanges(
  saved: SectionConfig,
  draft: SectionConfig,
  sources: SectionSourceLabel[],
): SectionPreviewChange[] {
  const labels = new Map(sources.map((source) => [source.id, source]));
  const sourceLabels = (ids: number[]) =>
    ids.flatMap((id) => {
      const source = labels.get(id);
      return source
        ? [source]
        : [{ id, title: `Source #${id}`, url: "No longer accepted or available" }];
    });
  return draft.sections.flatMap((section, position) => {
    const beforePosition = saved.sections.findIndex((candidate) => candidate.key === section.key);
    const before = beforePosition >= 0 ? saved.sections[beforePosition]! : null;
    const changed =
      !before ||
      beforePosition !== position ||
      before.name !== section.name ||
      before.visible !== section.visible ||
      before.brief !== section.brief ||
      before.instructions !== section.instructions ||
      before.replacementKey !== section.replacementKey ||
      before.sourceIds.length !== section.sourceIds.length ||
      before.sourceIds.some((id, index) => id !== section.sourceIds[index]);
    if (!changed) return [];
    return [
      {
        key: section.key,
        nameBefore: before?.name ?? null,
        nameAfter: section.name,
        positionBefore: before ? beforePosition + 1 : null,
        positionAfter: position + 1,
        visibleBefore: before?.visible ?? null,
        visibleAfter: section.visible,
        briefBefore: before?.brief ?? null,
        briefAfter: section.brief,
        instructionsBefore: before?.instructions ?? null,
        instructionsAfter: section.instructions,
        sourcesBefore: sourceLabels(before?.sourceIds ?? []),
        sourcesAfter: sourceLabels(section.sourceIds),
        replacementBefore: before?.replacementKey ?? null,
        replacementAfter: section.replacementKey,
      },
    ];
  });
}
