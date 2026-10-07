export type TodayWorkRow = {
  leadId: number;
  kind: string;
};

export function todayInProgressJobs<T extends TodayWorkRow>(
  rows: T[],
  publishedLeadIds: ReadonlySet<number>,
): T[] {
  return rows.filter(
    (row) =>
      row.leadId > 0 &&
      (row.kind === "draft" || row.kind === "reconcile") &&
      !publishedLeadIds.has(row.leadId),
  );
}

export function todayPublishedLeadIds(
  leads: { id: number; status: string; article_slug?: string | null }[],
): Set<number> {
  return new Set(leads.filter(lead => lead.status === "published" || lead.article_slug != null).map(lead => lead.id));
}
