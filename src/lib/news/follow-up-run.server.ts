/*
  The job worker's entry point into the three AI follow-up agents. Named
  `*.server.ts` for the reason every other line of `realWork` is: the browser
  build drops a `.server`-named dynamic import, and the agents module reaches
  the page watcher, the ingest and the provider adapters -- none of which a
  browser may load. Keeping the name off this edge put all of that in the
  client bundle (see docs/releases/next-BI.md).
*/
export { followUpRunLimits, performFollowUpRun } from "./follow-up-agents.ts";
