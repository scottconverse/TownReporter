type DailyScanPolicy = import("../news/daily-scan.ts").DailyScanPolicy;
type ScanSummary = {
  id: number;
  sources_selected?: number | null;
  sources_fetched: number;
  leads_created: number;
  execution_origin?: "manual" | "scheduled" | null;
};
export function dailyScanCounts(
  policy?: (Pick<DailyScanPolicy, "selectedSourceIds" | "sourceCap" | "lastScan"> &
    Partial<Pick<DailyScanPolicy, "everyDaySourceCount">>) | null,
  latestRun?: ScanSummary | null,
) {
  const run = latestRun ?? policy?.lastScan ?? null;
  const runLabel = run ? `run ${run.id}` : "";
  const origin = run?.execution_origin ?? "origin not recorded";
  return [
    {
      label: "Saved daily sources selected",
      value: policy ? String(policy.selectedSourceIds?.length ?? 0) : "Not available",
    },
    {
      label: "Saved daily priority set",
      value: policy ? String(policy.everyDaySourceCount ?? 0) : "Not available",
    },
    {
      label: "Saved daily source cap",
      value: policy ? String(policy.sourceCap) : "Not available",
    },
    {
      label: run ? `Latest scan · ${runLabel} · ${origin}` : "Latest scan",
      value: run
        ? run.sources_selected == null
          ? `${run.sources_fetched} sources read · scope not recorded`
          : `${run.sources_fetched} of ${run.sources_selected} sources read`
        : "Not recorded",
    },
    {
      label: run ? `Leads filed · ${runLabel}` : "Leads filed",
      value: run ? String(run.leads_created) : "Not recorded",
    },
  ];
}
