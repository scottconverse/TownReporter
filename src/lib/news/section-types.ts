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
/**
 * P0-1: an editor-chosen explicit source set for one scan run.
 *
 * Distinct from a `SectionScanSnapshot` (which carries a section's assigned
 * sources). This is the "Custom sources" scope: the editor picked these exact
 * accepted sources. `sourceIds` is persisted into the run's snapshot BEFORE
 * fetching begins, so the run is reproducible and auditable even if the source
 * list changes mid-run.
 */
export type CustomScanSnapshot = {
  kind: "custom";
  sourceIds: number[];
  /** Optional saved pack this selection came from (P0-2), for the run record. */
  packId?: number;
  packName?: string;
};

/** The union of every scan scope a run can carry in `section_snapshot`. */
export type ScanScopeSnapshot = SectionScanSnapshot | CustomScanSnapshot;

/**
 * P0-1: the single source-selection predicate for a custom scan. This is the
 * production filter -- `desk.ts`'s `performScanWork` calls THIS function, so a
 * test that imports it is bound to the code that actually runs, not a copy.
 *
 * A custom scan fetches only the explicitly selected sources that are still
 * accepted. Proposed, rejected, unavailable, and unselected rows are excluded.
 */
export function selectCustomScanSources<T extends { id: number; status: string }>(
  snapshot: CustomScanSnapshot,
  sources: T[],
): T[] {
  const ids = new Set(snapshot.sourceIds);
  return sources.filter((s) => s.status === "accepted" && ids.has(s.id));
}
/** Narrow a parsed snapshot to the custom-source scope. */
export function isCustomScanSnapshot(value: unknown): value is CustomScanSnapshot {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "custom" &&
    Array.isArray((value as { sourceIds?: unknown }).sourceIds)
  );
}
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
