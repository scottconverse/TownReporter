import { useEffect, useState } from "react";

/*
  The desk's job vocabulary, in one place.

  A lead's draft is a `desk_jobs` row the desk already polls
  (`["recent-story-work"]`, listRecentStoryWork in lib/news/desk.ts). Three
  surfaces read the same row: the shell's Running box, Today's Running now and
  the Drafts list. They have to agree about what a job is and how long it has
  been running -- a shell that said "2:03" while the card next to it said
  "2:05" is exactly the kind of small disagreement the redesign is meant to
  remove, so the shape and the m:ss format live here and nowhere else.

  This is not a component module on purpose: react-refresh requires a file that
  exports components to export components only, and the job card itself
  (`JobSlot`) lives with the rest of the shell chrome in desk-chrome.tsx.
*/

/** One job as the shell's Running box and Today's Running now both show it. */
export type RunningJob = {
  id: number;
  headline: string;
  status: string;
  stage: string;
  started_at: string | null;
  updated_at: string;
};

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

/** m:ss, the desk's elapsed format (README "Job card anatomy"). */
export function elapsedLabel(job: RunningJob, nowMs: number): string {
  const from = Date.parse(job.started_at ?? job.updated_at);
  if (!Number.isFinite(from)) return "0:00";
  const secs = Math.max(0, Math.floor((nowMs - from) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
