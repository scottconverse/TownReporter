/*
  How the desk WORDS a reporting package, apart from the markup that draws it.

  WHY THIS IS ITS OWN .ts. The story page renders the package beside the copy,
  and the rules that decide what an editor is told -- is a claim shown as
  verified, is a run shown as finished, is a vote shown as a tally -- are the
  rules this repo most needs a test on, and a .tsx component cannot be loaded
  by node --test. Keeping the wording here means the sentences and the honesty
  gates around them are unit-testable without a browser, the same split
  job-card-state.ts makes for the job card.

  WHAT IT MUST NOT DO. parseClaimStatus already refuses to turn an unknown into
  VERIFIED at the parse boundary; nothing here may re-upgrade it for display.
  A COMPLETE run status is the method own coverage gate having passed
  (coverageGatePassed, civic-reporting.ts), not a promise that the copy is
  published-ready -- so the run-status line states the gate AND says what
  readiness still owes. An empty ledger is nothing-was-read, never a filled-in
  one.
*/
import { formatListDateTime } from "../paper.ts";
import {
  CIVIC_SCANNER_METHOD_VERSION,
  type CoverageAction,
  type PackageClaim,
  type PackageHeld,
  type PackageScore,
  type PackageSource,
  type PackageStory,
  type ReportingPackage,
} from "./civic-reporting.ts";

/*
  The run-status sentence. Three states, three sentences, and a COMPLETE one
  that still says what the readiness tier leaves open. runNote is the run own
  one-line reason for a PARTIAL/FAILED run and is quoted verbatim, never
  paraphrased into something calmer.
*/
export type ReportingRequestView = {
  requestId: number;
  status: string;
  error: string | null;
  finishedAt: string | null;
  modelLabel: string;
  assignment: string;
};

export function reportingNotice(
  result: { ok: boolean } | null | undefined,
  latestStatus: string | null | undefined,
): "none" | "started" | "failed" {
  if (latestStatus === "FAILED") return "failed";
  if (latestStatus === "COMPLETE" || latestStatus === "PARTIAL") return "none";
  return result?.ok ? "started" : "none";
}

export function reportingRunState(report: ReportingPackage | ReportingRequestView, timeZone?: string): {
  tone: "ok" | "warn" | "err";
  label: string;
  detail: string;
} {
  if ("status" in report) {
    if (report.status === "FAILED") {
      return {
        tone: "err",
        label: "The reporting request failed.",
        detail: [
          report.error || "No reason was saved.",
          report.finishedAt ? `Ended: ${formatListDateTime(report.finishedAt, timeZone)}.` : "No end time was saved.",
          `Model: ${report.modelLabel || "No model was saved"}.`,
          "Use the reporting form to start again.",
        ].join(" "),
      };
    }
    return {
      tone: "ok",
      label: report.status === "PENDING" ? "Reporting started" : "The reporting request ended.",
      detail:
        report.status === "PENDING"
          ? "The package will appear here when it is done."
          : "Check the package below.",
    };
  }
  switch (report.runStatus) {
    case "COMPLETE":
      return {
        tone: "ok",
        label: "The run finished and its coverage check passed",
        detail:
          report.runNote ||
          "Every action carries a disposition. That is the method own gate, not a promise that this copy is ready to publish -- see the readiness line below.",
      };
    case "FAILED":
      return {
        tone: "err",
        label: "The run did not finish",
        detail: report.runNote || "No package was filed for this run.",
      };
    case "PARTIAL":
    default:
      return {
        tone: "warn",
        label: "The run finished with gaps",
        detail: report.runNote || "Some of the record below is incomplete. Check the gaps listed.",
      };
  }
}

/*
  The readiness line. The tier is the reporter own 0..3 label (civic-
  reporting.ts), NOT a score, and it is stated as a tier with its name rather
  than as a number an editor might read as three-out-of-five.
*/
export function readinessLabel(tier: number): string {
  switch (tier) {
    case 1:
      return "Tier 1 -- a reporting lead";
    case 2:
      return "Tier 2 -- reported, not ready to print";
    case 3:
      return "Tier 3 -- ready for an editor read";
    default:
      return "No readiness tier was set";
  }
}

/*
  A claim badge. VERIFIED is shown as the reporter recorded verification, never
  as a fact: the badge names the status the package recorded, and a claim with
  no resolving Tier A source is drawn as a gap even if the parser said VERIFIED.
  This reads the sources in THIS package only, so a source id that does not
  resolve here is not counted as evidence.
*/
export function claimBadge(claim: PackageClaim, story: PackageStory): {
  status: string;
  tone: "ok" | "warn" | "err";
  note: string;
} {
  const tierA = claim.sourceIds.some((id) => {
    const source = story.sources.find((s) => s.id === id);
    return source?.tier === "A";
  });
  if (claim.status === "VERIFIED" && !tierA) {
    return {
      status: "Marked verified, but no Tier A source travels with it",
      tone: "warn",
      note: claim.nextCheck || "Add the document, page or recording this rests on.",
    };
  }
  switch (claim.status) {
    case "VERIFIED":
      return { status: "Verified against a linked source", tone: "ok", note: claim.nextCheck };
    case "CONTESTED":
      return {
        status: "Contested",
        tone: "err",
        note: claim.nextCheck || "The record disagrees about this. Resolve before publishing.",
      };
    default:
      return {
        status: "Not verified",
        tone: "warn",
        note: claim.nextCheck || "No source in this package resolves this claim yet.",
      };
  }
}

/*
  The score, in the drawing own four words. Null means the run did not score,
  which is drawn as not-scored -- never as a row of low numbers, because a zero
  here is not-measured, not measured-at-zero.
*/
export const SCORE_COMPONENTS: ReadonlyArray<{ key: keyof PackageScore; label: string }> = [
  { key: "immediacy", label: "Immediacy" },
  { key: "impact", label: "Impact" },
  { key: "conflict", label: "Conflict" },
  { key: "novelty", label: "Novelty" },
];

export function scoreLine(score: PackageScore | null): string {
  if (!score) return "Not scored";
  return score.total + "/20";
}

export function reportingScoreLabel(score: PackageScore | null): string {
  return `Reporting score ${scoreLine(score)}`;
}

export function readinessQuestion(tier: number): string {
  return `Ready to print? ${readinessLabel(tier)}`;
}

export function reportingPackageHistory<
  TCurrent extends { requestId: number },
  TOlder extends { requestId: number },
>(
  current: TCurrent,
  earlier: readonly TOlder[],
): { current: TCurrent; earlier: TOlder[] } {
  return { current, earlier: earlier.filter((item) => item.requestId !== current.requestId) };
}

/*
  A source one-line locator: URL and, when the package recorded one, the page,
  agenda item or recording time that makes it checkable. An empty URL with an
  offline reference prints the reference instead of a dead link.
*/
export function sourceLocator(source: PackageSource): string {
  const parts: string[] = [];
  if (source.url) parts.push(source.url);
  else if (source.offlineReference) parts.push(source.offlineReference);
  if (source.locator) parts.push(source.locator);
  return parts.join(" | ");
}

/*
  A coverage action one-line evidence + disposition, for the ledger. A row with
  neither is drawn as a gap by the caller, not as a completed action.
*/
export function actionEvidenceLine(action: CoverageAction): string {
  const parts: string[] = [];
  if (action.evidence) parts.push(action.evidence);
  if (action.disposition) parts.push(action.disposition);
  return parts.join(" -- ");
}

/*
  The method line: which instructions produced the work, and whether the host
  had live research tools. A run with no research tools says so, so a thin
  package is not read as the method having failed.
*/
export function methodLine(report: ReportingPackage): string {
  const version = report.receipt.methodVersion || CIVIC_SCANNER_METHOD_VERSION;
  const tools = report.receipt.researchToolsAvailable
    ? ""
    : " - no live research tools were available to this run";
  const modelId = report.receipt.modelId || report.receipt.localModel?.id || "";
  const endpoint = report.receipt.modelEndpoint || report.receipt.localModel?.baseUrl || "";
  const model = report.receipt.modelLabel || modelId;
  const provider = report.receipt.runtimeProvider;
  const effort = report.receipt.modelEffort;
  const exactRuntime = model
    ? " - Model " + model +
      (modelId ? " [" + modelId + "]" : "") +
      (provider ? " via " + provider : "") +
      (endpoint ? " at " + endpoint : "") +
      (effort ? " · effort " + effort + (effort === "none" ? " (off)" : "") : "")
    : "";
  return "Method " + version + " - " + report.receipt.mode + exactRuntime + tools;
}

/*
  The plain summary at the top of the panel (walk row C20).

  WHY. The owner's walk read "Method 2.6.0 - full-pipeline", "warm 0 / cold 0
  actions", "coverage gate" and "no retained tape" with no explanation, so the
  panel opened on the method's private vocabulary. This reads the package's OWN
  fields -- the run note it saved, the actions it filed, the stories it saved,
  whether its coverage gate passed -- and says, in four lines, what was read,
  what was established, what still needs checking, and the next press.

  NOTHING IS UPGRADED. A run note that says no tape was scoped is reported as
  no tape read; an empty ledger is nothing-was-read, never a filled-in one; a
  gate that did not pass is not called a pass.
*/
export type PackagePlainSummary = {
  /** One word set for a screen-reader heading, and shown as the section note. */
  heading: string;
  read: string;
  established: string;
  stillToCheck: string;
  nextAction: string;
};

/** The two mechanical passes, in ordinary words (walk row C20). */
export const WARM_PASS_PLAIN = "the first read of the meeting record";

export function warmColdPlainLine(actions: readonly unknown[]): string {
  return `Warm and cold passes: the meeting record is read twice — first to find the actions (${
    WARM_PASS_PLAIN
  }), then again as a check that misses nothing. This run recorded ${
    actions.length
  } ${actions.length === 1 ? "action" : "actions"} in both passes together.`;
}

export function packagePlainSummary(report: ReportingPackage): PackagePlainSummary {
  const note = report.runNote || "";
  const noTape = /no retained tape was scoped/i.test(note);
  const suppliedOnly = /supplied-sources-only/i.test(note);
  const retainedRead = /read\s+(\d+)\s+retained segments in\s+(\d+)\s+windows/i.exec(note);
  const storyCount = report.stories.length;
  const actionCount = report.actions.length;

  let read: string;
  if (noTape) {
    read = suppliedOnly
      ? "No saved meeting recording or transcript was included. The run used only the links supplied with this assignment; no public search was run."
      : "No saved meeting recording or transcript was included, so there was no tape to read.";
  } else if (retainedRead) {
    read = `Read ${retainedRead[1]} saved transcript passages across ${retainedRead[2]} parts of the meeting.`;
  } else if (actionCount) {
    read = `${actionCount} ${actionCount === 1 ? "action" : "actions"} read from the meeting record.`;
  } else {
    read = "The sources this run used are listed below.";
  }

  const established =
    `${storyCount} ${storyCount === 1 ? "story draft" : "story drafts"} saved. ` +
    (actionCount
      ? `${actionCount} meeting ${actionCount === 1 ? "action" : "actions"} recorded.`
      : "No meeting actions were recorded.");

  let stillToCheck: string;
  if (report.runStatus === "FAILED") {
    stillToCheck = "The run did not finish, so the record below is incomplete.";
  } else if (noTape) {
    stillToCheck = "The meeting record was not read, so the coverage check did not pass.";
  } else if (!report.coverageComplete || report.runStatus === "PARTIAL") {
    stillToCheck = "The coverage check did not pass. Review the gaps listed below.";
  } else {
    stillToCheck = "The coverage check passed. Review the claims and draft before using them.";
  }

  const nextAction =
    report.runStatus === "FAILED"
      ? "Start the reporting run again from the form above."
      : noTape
        ? "Start a follow-up run below and add the official recording or meeting packet link."
        : !report.coverageComplete
          ? "Start a follow-up run below to check the gaps listed here."
          : "Review the linked claims and draft before publishing.";

  return {
    heading:
      report.runStatus === "COMPLETE"
        ? "The reporting run finished"
        : report.runStatus === "FAILED"
          ? "The reporting run did not finish"
          : "The reporting run finished with gaps",
    read,
    established,
    stillToCheck,
    nextAction,
  };
}

/*
  The gaps the panel must state, in one list. Each entry is a thing the package
  does NOT settle, drawn from its own fields -- never invented.
*/
export function packageGaps(report: ReportingPackage): string[] {
  const gaps: string[] = [];
  if (!report.coverageComplete) {
    gaps.push(
      report.actions.length
        ? "Some actions below have no disposition yet."
        : "No coverage ledger was filed -- nothing was read from the record.",
    );
  }
  for (const unknown of report.unknowns) gaps.push(unknown);
  for (const held of report.held) gaps.push(held.headline + ": " + held.reason);
  return gaps;
}

/*
  Whether the panel has anything to draw at all. A package that parsed but is
  entirely empty is still drawn -- as the-run-filed-nothing, which is a real
  state -- so this returns true whenever a report exists.
*/
export function hasReportingPackage(report: ReportingPackage | null): report is ReportingPackage {
  return report !== null;
}

/** The held/Black-Desk rows, as the panel words them. */
export function heldLine(held: PackageHeld): string {
  return held.unverified ? held.headline + " (unresolved)" : held.headline;
}
