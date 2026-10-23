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
  /*
    MS-WIRE W1: a skill run records what an editor can check -- which
    instructions, which model, how long, and where the run's files are -- rather
    than model calls and tokens. Its sentence is still empty when nothing was
    recorded.
  */
  if (stats?.writer) {
    const hasWall = Number.isFinite(stats.wallMs);
    const minutes = hasWall ? Math.max(1, Math.round(stats.wallMs / 60_000)) : 0;
    const skill = stats.skillVersion ? `${stats.writer} v${stats.skillVersion}` : stats.writer;
    const asked =
      stats.requestedModel && stats.requestedModel !== stats.model
        ? ` (you picked ${stats.requestedModel})`
        : "";
    return [
      `Written by ${skill}`,
      stats.model ? `model ${stats.model}${asked}` : "",
      hasWall ? `took ${minutes} min` : "",
      stats.workDir ? `run folder ${stats.workDir}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (!stats || (!stats.wallMs && !stats.modelCalls && !stats.inputTokens && !stats.outputTokens)) {
    return "";
  }
  const minutes = Math.round(stats.wallMs / 60_000);
  const number = (value: number) => value.toLocaleString("en-US");
  return `Took ${minutes} min, ${number(stats.modelCalls)} model calls, ${number(stats.inputTokens)} tokens in, ${number(stats.outputTokens)} out`;
}
