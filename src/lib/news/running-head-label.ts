/*
  FC13 (Oct 11 walk): the desk header's Running box said "Running · 11" while
  the work queue said 1 running and 10 queued, so jobs waiting in line are
  counted apart.

  This lives in a module with no imports on purpose. `job-progress.ts` imports
  `desk-auth.ts` (the desk middleware) and the server fn machinery, so a client
  component that reached `runningHeadLabel` from there dragged the whole
  server-bearing graph -- `verify.server`, `isolation.server` -- into the
  browser bundle, which does not build. The label needs nothing but its rows.
*/

/** The minimum a job needs to be counted: whether it is waiting in line. */
type CountableJob = { status: string };

/**
 * The desk header's Running box line, counting the queued apart from the rest.
 */
export function runningHeadLabel(jobs: readonly CountableJob[]): string {
  const queued = jobs.filter((job) => job.status === "queued").length;
  return `Running · ${jobs.length - queued}${queued ? ` · ${queued} queued` : ""}`;
}

/**
 * Which jobs the nav's Running box draws as rows on this screen.
 *
 * Today ("/desk") already draws every open job as its own "Running now" card,
 * with the story name, "Open your story" and Cancel. The box beside it drew the
 * same job a second time, so one draft showed as two rows. On Today the box keeps
 * its "Running · N" heading (a link to Today) and leaves the rows to the page;
 * everywhere else it is the only place the job is drawn, so it keeps them.
 */
export function runningBoxRows<T>(pathname: string, jobs: readonly T[]): T[] {
  if (pathname.replace(/\/+$/, "") === "/desk") return [];
  return jobs.slice(0, 3);
}
