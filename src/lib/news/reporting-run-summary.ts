type ReportingRunSummaryInput = {
  runStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  runNote: string;
  coverageComplete: boolean;
  actions: readonly unknown[];
  stories: readonly unknown[];
};

export type ReportingRunSummaryCopy = {
  read: string;
  established: string;
  stillToCheck: string;
  nextAction: string;
  label: string;
  tone: "ok" | "warn" | "err";
};

/** Turn the saved reporting receipt into a short handoff an editor can act on. */
export function reportingRunSummary(report: ReportingRunSummaryInput): ReportingRunSummaryCopy {
  const note = report.runNote || "";
  const noRetainedTape = /no retained tape was scoped/i.test(note);
  const suppliedOnly = /supplied-sources-only/i.test(note);
  const retainedRead = /read\s+(\d+)\s+retained segments in\s+(\d+)\s+windows/i.exec(note);
  const storyCount = report.stories.length;
  const actionCount = report.actions.length;

  let read: string;
  if (noRetainedTape) {
    read = suppliedOnly
      ? "No saved meeting transcript or recording was included. The run used only links supplied with this assignment; no public search was run."
      : "No saved meeting transcript or recording was included in this review.";
  } else if (retainedRead) {
    read = `Read ${retainedRead[1]} saved transcript passages across ${retainedRead[2]} parts of the meeting.`;
  } else {
    read = "The sources used for this report are listed below.";
  }

  const savedStories = `${storyCount} ${storyCount === 1 ? "story draft was" : "story drafts were"} saved.`;
  const actions = actionCount
    ? `${actionCount} meeting ${actionCount === 1 ? "action was" : "actions were"} recorded.`
    : "No meeting actions were recorded.";

  let stillToCheck: string;
  if (noRetainedTape) {
    stillToCheck = "The meeting record was not reviewed, so the coverage check did not pass.";
  } else if (!report.coverageComplete || report.runStatus === "PARTIAL") {
    stillToCheck = "The coverage check did not pass. Review the gaps listed below.";
  } else if (report.runStatus === "FAILED") {
    stillToCheck = "The report did not finish. Check the technical details and try again.";
  } else {
    stillToCheck = "The coverage check passed. Review the claims and draft before using them.";
  }

  const nextAction = noRetainedTape
    ? "Start a follow-up run below and add the official recording or meeting packet link."
    : report.runStatus === "FAILED"
      ? "Use the reporting form above to start again."
      : !report.coverageComplete
        ? "Start a follow-up run below to check the gaps listed here."
        : "Review the linked claims and draft before publishing.";

  return {
    read,
    established: `${savedStories} ${actions}`,
    stillToCheck,
    nextAction,
    label:
      report.runStatus === "COMPLETE"
        ? "The review is complete"
        : report.runStatus === "FAILED"
          ? "The report did not finish"
          : "This report has gaps",
    tone: report.runStatus === "COMPLETE" ? "ok" : report.runStatus === "FAILED" ? "err" : "warn",
  };
}
