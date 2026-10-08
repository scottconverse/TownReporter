import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listDeskJobs, type JobProgressView } from "@/lib/news/job-progress";
import { refreshFinishedScanPolicy } from "../lib/desk/scan-policy-refresh.ts";

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

/** The one key. Exported so a press that STARTS a job can refresh it. */
export const DESK_JOBS_KEY = ["desk-jobs"] as const;

/**
 * Call this after ANY press that starts a job (FB1, unit 3).
 *
 * The report's finding: starting a story invalidated `["leads"]` and the old
 * `["recent-story-work"]` but NOT `["desk-jobs"]`, so the card the editor had
 * just asked for arrived up to 30 s late -- the idle poll interval -- and in
 * the meantime the screen looked like the press had done nothing. Every
 * job-starting mutation on the desk calls this now, and it is one function so
 * the next one cannot forget the key.
 *
 * `refetchType: "active"` (the default) is what makes it cheap: a screen that
 * is not mounted does not refetch, it just marks the entry stale.
 */
export function invalidateDeskJobs(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: DESK_JOBS_KEY });
}

/**
 * Every job the desk can show, of every kind, open ones first. Polled fast
 * while any of them is open and slowly when none is. One query for the whole
 * screen: the card takes a job, not a query, so a screen with several cards
 * still makes one request per tick.
 *
 * FB1, unit 3: this is THE reader. The shell's Running box, Today's running
 * strip and its drafts strip, the story page and the Drafts list all read this
 * one key -- which is also why a write that starts a job invalidates
 * `["desk-jobs"]` and not a key of its own. The report's finding was that
 * starting a story left the card up to 30 s late because `["desk-jobs"]` was
 * never invalidated; see the presses that now do.
 *
 * `initial` is the row a route's own loader already has. It is only the first
 * paint -- the query replaces it on its first tick.
 */
export function useDeskJobs(initial?: JobProgressView[] | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["desk-jobs"],
    queryFn: async () => {
      const rows = await listDeskJobs();
      refreshFinishedScanPolicy(qc, qc.getQueryData<JobProgressView[]>(DESK_JOBS_KEY) ?? [], rows);
      return rows;
    },
    ...(initial && initial.length
      ? { initialData: initial, initialDataUpdatedAt: Date.now() }
      : {}),
    refetchInterval: (q) => (anyOpen(q.state.data) ? RUNNING_POLL_MS : IDLE_POLL_MS),
  });
}
