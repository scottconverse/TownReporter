export type TodayWorkRow = {
  id?: number;
  leadId: number;
  kind: string;
};

export function todayInProgressJobs<T extends TodayWorkRow>(
  rows: T[],
  closedLeadIds: ReadonlySet<number>,
): T[] {
  const latest = new Map<number, T>();
  for (const row of rows) {
    if (row.kind !== "draft" && row.kind !== "reconcile") continue;
    const prior = latest.get(row.leadId);
    if (!prior || (row.id ?? 0) > (prior.id ?? 0)) latest.set(row.leadId, row);
  }
  return [...latest.values()].filter(
    (row) =>
      row.leadId > 0 &&
      (row.kind === "draft" || row.kind === "reconcile") &&
      !closedLeadIds.has(row.leadId),
  );
}

export function todayClosedLeadIds(
  leads: { id: number; status: string; article_slug?: string | null }[],
): Set<number> {
  return new Set(leads.filter(lead => lead.status === "killed" || lead.status === "published" || lead.article_slug != null).map(lead => lead.id));
}
