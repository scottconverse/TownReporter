import { useQuery } from "@tanstack/react-query";

import { listFollowUpJobProgress, type FollowUpJobProgress } from "@/lib/news/job-progress";

/*
  The follow-up screen's live runs, in a `.ts` file for the reason
  `job-card-state.ts` gives: a file that exports both a hook and a component
  trips eslint's react-refresh/only-export-components.

  The polling rule is the story jobs' rule, because it is the same fact: a run
  in flight changes every couple of seconds and an idle desk does not. Without
  it a cancelled or finished run would keep its progress bar for as long as the
  editor left the screen open.
*/

const RUNNING_POLL_MS = 2000;
const IDLE_POLL_MS = 30_000;

const anyOpen = (rows: FollowUpJobProgress[] | undefined) =>
  Boolean(rows?.some((row) => row.view.status === "queued" || row.view.status === "running"));

/** Every follow-up run in flight in this newsroom, keyed by the card it belongs to. */
export function useFollowUpJobs() {
  return useQuery({
    queryKey: ["follow-up-jobs"],
    queryFn: () => listFollowUpJobProgress(),
    refetchInterval: (query) => (anyOpen(query.state.data) ? RUNNING_POLL_MS : IDLE_POLL_MS),
  });
}

/** The run for one card, or null. The screen draws one card per follow-up. */
export function jobForFollowUp(
  jobs: FollowUpJobProgress[] | undefined,
  followUpId: number,
) {
  return jobs?.find((job) => job.followUpId === followUpId)?.view ?? null;
}
