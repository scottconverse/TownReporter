import { useEffect, useState } from "react";
import type { JobProgressView } from "@/lib/news/job-progress";

/*
  The desk's job display vocabulary, in one place.

  THE JOB ROW ITSELF MOVED (FB1, unit 3). This module used to own `RunningJob`
  -- the four fields `listRecentStoryWork` happened to return -- and an
  `elapsedLabel(job, nowMs)` that formatted them. Both are gone with the reader
  they were shaped for: every screen now draws the real `JobProgressView` from
  the one `useDeskJobs()` query, and the card's own clock (m:ss, in JobCard.tsx)
  is the format.

  What is left is what more than one screen needs and nothing else owns: the
  one-second ticker an elapsed time needs to be "now" rather than "when the
  query answered", and the one-line name for a job.

  This is not a component module on purpose: react-refresh requires a file that
  exports components to export components only.
*/

/**
 * Ticks once a second while `active`, so an elapsed time on screen is the
 * elapsed time now rather than the elapsed time when the query last answered.
 * A desk with nothing running does not re-render every second.
 */
export function useNowMs(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * What to call a job in one line. A story job is its headline; every other kind
 * is its card title ("Scanning the watch list"), because the alternative --
 * showing a scan's `scan_runs` id in the place a headline goes -- would read on
 * the nav's Running box as a story nobody wrote.
 *
 * Null and blank both fall through to the title: `headline` is null for every
 * kind whose subject is not a lead, and a lead whose headline is empty string
 * is a lead the desk has not named yet, which is not a name to print.
 */
export function jobHeadline(job: Pick<JobProgressView, "headline" | "title">): string {
  return job.headline?.trim() || job.title;
}
