export type TodayWorkRow = {
  leadId: number;
  kind: string;
};

export function todayInProgressJobs<T extends TodayWorkRow>(
  rows: T[],
  closedLeadIds: ReadonlySet<number>,
): T[] {
  return rows.filter(
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
