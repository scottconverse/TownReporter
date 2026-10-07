type DailyScanPolicy = import("../news/daily-scan.ts").DailyScanPolicy;
export function dailyScanCounts(
  policy?: Pick<DailyScanPolicy, "selectedSourceIds" | "sourceCap" | "lastScan"> | null,
) {
  return [
    {
      label: "Sources selected",
      value: policy ? String(policy.selectedSourceIds?.length ?? 0) : "Not available",
    },
    { label: "Fetch cap", value: policy ? String(policy.sourceCap) : "Not available" },
    {
      label: "Sources actually read",
      value: policy?.lastScan ? String(policy.lastScan.sources_fetched) : "Not recorded",
    },
    {
      label: "Leads filed",
      value: policy?.lastScan ? String(policy.lastScan.leads_created) : "Not recorded",
    },
  ];
}
