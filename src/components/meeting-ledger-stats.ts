import type { RunStats } from "@/lib/news/meeting-whole";

/*
  The run's own one line, in a `.ts` file for the reason job-card-state.ts and
  follow-up-jobs.ts give: a file that exports both a component and a plain
  function trips eslint's react-refresh/only-export-components, and the panel
  is a component.

  Pure, so the wording is testable without a render: "Took 12 min, 57 model
  calls, 410,000 tokens in, 38,000 out". Empty when the run recorded nothing,
  so the panel prints no sentence about a run it cannot describe.
*/
export function runStatsLine(stats: RunStats | null): string {
  if (!stats || (!stats.wallMs && !stats.modelCalls && !stats.inputTokens && !stats.outputTokens)) {
    return "";
  }
  const minutes = Math.round(stats.wallMs / 60_000);
  const number = (value: number) => value.toLocaleString("en-US");
  return `Took ${minutes} min, ${number(stats.modelCalls)} model calls, ${number(stats.inputTokens)} tokens in, ${number(stats.outputTokens)} out`;
}
