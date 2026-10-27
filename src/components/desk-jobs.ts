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

/**
 * The rows the nav's Running box draws on this page (D1, "Running · 1" with two rows).
 *
 * Today (`/desk`) draws every open job itself, in its "Running now" section,
 * from the same query and the same first three, with the story's name and both
 * presses ("Open your story", "Cancel"). The box drew the same job again above
 * it with only Cancel, so one job showed as two rows on one screen. On Today
 * the box keeps its count line and draws no rows.
 *
 * Every other page that draws a card for a job of its own (Drafts, Server
 * operations, Dark Desk, the story page, ...) says so through
 * `useJobCardDrawnOnPage`, and the box leaves that one job out (G24-D1-2). Other
 * running jobs still show, at most three.
 */
export function navRunningRows<T extends { id: string | number }>(
  jobs: readonly T[],
  pathname: string,
  drawnOnPage: ReadonlySet<string | number> = new Set(),
): T[] {
  /* Ids from the document are text; ids from the query are numbers. */
  if (pathname.replace(/\/+$/, "") === "/desk") return [];
  return jobs.filter((job) => !drawnOnPage.has(job.id) && !drawnOnPage.has(String(job.id))).slice(0, 3);
}

/*
  Which jobs the page itself is drawing a card for. Every job card carries its
  job's id in `data-job-id`; the cards the nav's Running box draws sit inside
  `.astra-running`, and any other card is the page's own. The nav and the page
  are not parent and child, so the box reads the document rather than asking
  each page to report: a page that draws a card for a job is covered with no
  change to the page.
*/
const NAV_BOX = ".astra-running";

/** Ids of the job cards on the page, outside the nav's Running box. */
export function jobIdsDrawnOutside(root: {
  querySelectorAll(selector: string): ArrayLike<{
    getAttribute(name: string): string | null;
    closest(selector: string): unknown;
  }>;
}): Set<string> {
  const ids = new Set<string>();
  const cards = root.querySelectorAll("[data-job-id]");
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const id = card.getAttribute("data-job-id");
    if (id && !card.closest(NAV_BOX)) ids.add(id);
  }
  return ids;
}

/** The job ids the page is drawing a card for, kept current as the page changes. */
export function useJobsDrawnOnPage(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = jobIdsDrawnOutside(document);
      setIds((prev) =>
        prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-job-id"],
    });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return ids;
}
