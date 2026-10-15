import { PAPER, formatClockTime } from "../paper.ts";

type DailyScanPolicy = import("../news/daily-scan.ts").DailyScanPolicy;
type DailyScanRun = NonNullable<DailyScanPolicy["lastScan"]>;

/*
  Names the DAILY run the read and filed rows came from, by when it started, so
  a manual or other scan is never read as the daily one. A run still going says so
  and carries no start time yet.
*/
function dailyRunName(run: DailyScanRun | null | undefined, timeZone: string): string {
  if (!run) return "no daily run recorded";
  if (!run.finishedAt) return "daily scan, running";
  const at = new Date(run.startedAt);
  if (Number.isNaN(at.getTime())) return "daily scan";
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at);
  return `daily scan, ${day}, ${formatClockTime(at, timeZone)}`;
}

export function dailyScanCounts(
  policy?: (Pick<DailyScanPolicy, "selectedSourceIds" | "sourceCap" | "lastScan"> &
    Partial<Pick<DailyScanPolicy, "everyDaySourceCount" | "timezone">>) | null,
) {
  const run = dailyRunName(policy?.lastScan, policy?.timezone || PAPER.timezone);
  return [
    {
      label: "Sources selected",
      value: policy ? String(policy.selectedSourceIds?.length ?? 0) : "Not available",
    },
    {
      label: "Priority set",
      value: Number.isInteger(policy?.everyDaySourceCount)
        ? String(policy?.everyDaySourceCount)
        : "Not available",
    },
    { label: "Fetch cap", value: policy ? String(policy.sourceCap) : "Not available" },
    {
      label: `Sources read (${run})`,
      value: policy?.lastScan ? String(policy.lastScan.sources_fetched) : "Not recorded",
    },
    {
      label: `Leads filed (${run})`,
      value: policy?.lastScan ? String(policy.lastScan.leads_created) : "Not recorded",
    },
  ];
}
