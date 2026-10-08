type ScanJob = { id: number; kind: string; status: string };
type PolicyCache = { invalidateQueries: (filters: { queryKey: string[] }) => unknown };

/** Refresh the editor's latest-scan counts when polling observes a finished scan. */
export function refreshFinishedScanPolicy(cache: PolicyCache, previous: ScanJob[], next: ScanJob[]): void {
  const finished = (job: ScanJob) => job.status === "completed" || job.status === "failed";
  if (next.some((job) => job.kind === "scan" && finished(job)
    && !previous.some((old) => old.id === job.id && finished(old)))) {
    void cache.invalidateQueries({ queryKey: ["daily-scan-policy"] });
  }
}
