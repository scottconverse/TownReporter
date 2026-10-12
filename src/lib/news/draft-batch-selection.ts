export type DraftBatchLeadChoice = {
  id: number;
  headline: string;
  has_draft?: boolean;
};

export function resolveDraftBatchSelection<T extends DraftBatchLeadChoice>(
  selectedIds: readonly number[],
  pool: readonly T[],
  loaded: boolean,
) {
  if (!loaded) {
    return { selectedCount: selectedIds.length, loading: true, startableIds: [] as number[], rows: [] as T[], excluded: [] as { id: number; headline: string; reason: string }[] };
  }
  const byId = new Map(pool.map((lead) => [lead.id, lead]));
  const rows: T[] = [];
  const excluded: { id: number; headline: string; reason: string }[] = [];
  for (const id of selectedIds) {
    const lead = byId.get(id);
    if (!lead) {
      excluded.push({ id, headline: `Lead ${id}`, reason: "This lead is no longer in the queue." });
    } else if (lead.has_draft) {
      rows.push(lead);
      excluded.push({ id, headline: lead.headline, reason: "This lead already has a draft." });
    } else {
      rows.push(lead);
    }
  }
  return {
    selectedCount: selectedIds.length,
    loading: false,
    startableIds: rows.filter((lead) => !lead.has_draft).map((lead) => lead.id),
    rows,
    excluded,
  };
}
