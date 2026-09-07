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
