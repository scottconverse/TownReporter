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
 * Which jobs the nav's Running box draws as ROWS on the screen it is beside.
 *
 * D1 (Oct 24 walk): on Today the box said "Running · 1" and listed the draft
 * twice -- once as the box's row (the story name, Cancel) and once as Today's
 * "Running now" card (the kind's name, Open your story, Cancel). One job is one
 * row per page, and Today's own card is the row that carries the story name and
 * both presses, so on Today the box keeps its heading and leaves the rows to the
 * page. Everywhere else the box is the only place an open job is drawn, so it
 * keeps up to three rows.
 *
 * The heading is kept rather than the whole box hidden because it is the nav's
 * own link to Today; it is a count, not a second row.
 */
export function runningBoxRows<T>(pathname: string, jobs: readonly T[]): T[] {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/desk" ? [] : jobs.slice(0, 3);
}
