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

/*
  Walk F15: these rows sat beside a "Sources read" of 255 while "Sources
  selected" and "Fetch cap" both read 12, which looks like a run that broke its
  own limit. It did not: the saved picks and the priority-set cap order which
  sources the rotation tries first, and every scheduled daily run reads every
  accepted source within the 90-minute reading budget
  (`dailyScanPlan(..., allAccepted = true)`). The labels stay as the desk has
  always drawn them; each row's hover text says what its number counts, and a
  "Read scope" row says how many the run may actually read.
*/
export function dailyScanCounts(
  policy?: (Pick<DailyScanPolicy, "selectedSourceIds" | "sourceCap" | "lastScan"> &
    Partial<Pick<DailyScanPolicy, "everyDaySourceCount" | "timezone">>) | null,
) {
  const run = dailyRunName(policy?.lastScan, policy?.timezone || PAPER.timezone);
  return [
    {
      label: "Sources selected",
      value: policy ? String(policy.selectedSourceIds?.length ?? 0) : "Not available",
      help: "The sources you picked by hand. They order which sources the rotation tries first; they do not limit how many a daily run may read.",
    },
    {
      label: "Priority set",
      value: Number.isInteger(policy?.everyDaySourceCount)
        ? String(policy?.everyDaySourceCount)
        : "Not available",
      help: "How many picked sources the rotation gives priority to.",
    },
    {
      label: "Fetch cap",
      value: policy ? String(policy.sourceCap) : "Not available",
      help: "The ceiling on the priority set, not a limit on the daily run.",
    },
    {
      label: "Read scope",
      value: policy ? "Every accepted source, within the 90-minute budget" : "Not available",
    },
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
