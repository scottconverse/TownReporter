import { useQuery } from "@tanstack/react-query";
import { listStoryJobProgress, type JobProgressView } from "@/lib/news/job-progress";

/*
  The job card's state rule and its data hook, apart from the card's markup.

  They live in a `.ts` file and the components in `JobCard.tsx` on purpose:
  eslint's react-refresh/only-export-components warns about a file that exports
  both, and splitting is this repo's convention for it (`reader-context.ts` +
  `reader-controls.tsx`, `appearance-context.ts` + `appearance-provider.tsx`).
*/

export type JobCardState = "running" | "done" | "failed";

/** `queued` is a running job that has not started: same treatment, no clock. */
export function jobCardState(job: Pick<JobProgressView, "status">): JobCardState {
  if (job.status === "completed") return "done";
  if (job.status === "failed") return "failed";
  return "running";
}

const RUNNING_POLL_MS = 2000;
/**
 * While nothing is running, one query every 30 s. Not `false`: a job started in
 * another tab, or by a scheduled pass, should appear on a desk that is already
 * open, and 30 s of an idle desk is cheaper than the support question "why did
 * it never show up". Not 2 s either -- an idle desk must not poll like a busy
 * one.
 */
const IDLE_POLL_MS = 30_000;

const anyOpen = (rows: JobProgressView[] | undefined) =>
  Boolean(rows?.some((row) => row.status === "queued" || row.status === "running"));

/**
 * Every story job the desk can show, newest first, polled fast while any of
 * them is open and slowly when none is. One query for the whole screen: the
 * card takes a job, not a query, so a screen with several cards still makes one
 * request per tick.
 *
 * `initial` is the row a route's own loader already has. It is only the first
 * paint -- the query replaces it on its first tick.
 */
export function useDeskJobs(initial?: JobProgressView[] | null) {
  return useQuery({
    queryKey: ["desk-jobs"],
    queryFn: () => listStoryJobProgress(),
    ...(initial && initial.length
      ? { initialData: initial, initialDataUpdatedAt: Date.now() }
      : {}),
    refetchInterval: (q) => (anyOpen(q.state.data) ? RUNNING_POLL_MS : IDLE_POLL_MS),
  });
}
