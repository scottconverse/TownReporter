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
