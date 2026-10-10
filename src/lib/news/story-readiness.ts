import type { PackageClaim } from "./civic-reporting.ts";
import { uncheckedStoryNeedsCheck } from "./unchecked-story-gate.ts";

export type StoryReadinessState = "ready" | "checking" | "verified" | "to-check" | "not-ready" | "not-checked";

export type StoryReadiness = {
  state: StoryReadinessState;
  openCount: number;
  totalCount: number;
  reason: string;
};

/** Every story surface reads the Publish gate's current first reason. */
export function editorStoryState(blockers: readonly { key: string; kind?: string; sentence: string }[], openCount: number, acceptedCount = 0,
): StoryReadiness {
  const first = blockers.find(row => row.kind === "hard") ??
    blockers.find(row => row.key === "evidence-loading" || row.key === "reconcile-running") ??
    blockers.find(row => row.key === "unchecked") ?? blockers[0];
  return { state: first ? first.key === "evidence-loading" || first.key === "reconcile-running" ? "checking" : first.key === "unchecked" || first.key === "claims-unchecked" ? "not-checked" : "not-ready" : "ready",
    openCount, totalCount: openCount, reason: first?.sentence ?? acceptedClaimsReason(openCount, acceptedCount) ?? "Ready to publish." };
}

/** Acceptance is counted against outstanding claims, never treated as verification. */
export function acceptedClaimsReason(openCount: number, acceptedCount: number): string | null {
  return openCount > 0 && acceptedCount > 0 && acceptedCount >= openCount
    ? `You accepted ${acceptedCount} claim${acceptedCount === 1 ? "" : "s"} the AI could not confirm.` : null;
}

export function readinessWithAcceptedClaims(readiness: StoryReadiness, openCount: number, acceptedCount: number): StoryReadiness {
  const reason = acceptedClaimsReason(openCount, acceptedCount);
  const claimReason = /^(?:\d+ claims need review\.|\d+ (?:headline or first-paragraph )?facts? needs? checking\.)$/.test(readiness.reason);
  return reason && (readiness.state === "ready" || (claimReason && readiness.openCount === openCount)) && readiness.state !== "checking"
    ? { ...readiness, state: "ready", openCount, reason } : readiness;
}

/** The live review owns an AI check's claim tally, including after judgments or edits. */
export function liveClaimsOwnReadiness(raw: string | null | undefined): boolean {
  try {
    const memo = JSON.parse(raw ?? "{}");
    return Boolean(memo?.aiEvidenceReview);
  } catch {
    return false;
  }
}

/** Apply the current zero-claims decision on both the story page and Drafts. */
export function readinessWithUncheckedStory(readiness: StoryReadiness, input: Parameters<typeof uncheckedStoryNeedsCheck>[0]): StoryReadiness {
  const unchecked = uncheckedStoryNeedsCheck(input);
  if (readiness.state === "checking") return readiness;
  if (unchecked.blocked) return readiness.state === "ready" || readiness.state === "verified" || readiness.state === "not-checked"
    ? { ...readiness, state: "not-checked", reason: unchecked.reason } : readiness;
  return readiness.state === "not-checked" ? { ...readiness, state: "ready", reason: "Ready to publish." } : readiness;
}

/**
 * The route's publish filter and readiness share one decision.
 *
 * ── TWO QUESTIONS, AND UNIT OH SEPARATES THEM ─────────────────────────────
 *
 *   - WHICH reasons still stand (`blockers`): acceptance clears the
 *     `claims-unreviewed` row, and nothing else. A warning is not removed here.
 *   - IS the button on (`publishEnabled`): only a HARD reason turns it off. A
 *     warning can report the story "not-ready" (through `editorStoryState`)
 *     while still leaving the button live -- that is the whole point of the
 *     unit: an editor may print over a readiness verdict.
 *
 * A blocker with NO `kind` (an older caller, or a test that builds a list by
 * hand) is treated as HARD, so an unknown reason can never silently unlock the
 * button. That keeps every pre-OH caller's `publishEnabled` exactly what it
 * was.
 */
export function acceptedClaimsPublishState<
  T extends { key: string; kind?: string; sentence: string },
>(input: {
  blockers: readonly T[]; openCount: number; acceptedCount: number; hasAiJudgments: boolean;
}) {
  const covers = input.acceptedCount > 0 && input.acceptedCount >= input.openCount;
  const blockers = input.blockers.filter(
    (blocker) => blocker.key !== "claims-unreviewed" || !covers,
  );
  const hasHard = blockers.some((blocker) => blocker.kind !== "warning");
  return {
    blockers,
    publishEnabled: !hasHard,
    readiness: editorStoryState(blockers, input.openCount, input.acceptedCount),
  };
}

/** Read the filed state once; a missing memo is Ready, without claiming verified facts. */
export function savedStoryReadiness(raw: unknown, checking = false): StoryReadiness {
  const missing: StoryReadiness = {
    state: "ready",
    openCount: 0,
    totalCount: 0,
    reason: "No fact check has been saved for this draft.",
  };
  try {
    const memo: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    const candidate: unknown =
      memo && typeof memo === "object" && "storyReadiness" in memo ? memo.storyReadiness : memo;
    const value =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : {};
    if (
      value.version === 1 &&
      ["ready", "checking", "verified", "to-check", "not-ready", "not-checked"].includes(String(value.state)) &&
      typeof value.openCount === "number" &&
      Number.isInteger(value.openCount) &&
      value.openCount >= 0 &&
      typeof value.totalCount === "number" &&
      Number.isInteger(value.totalCount) &&
      value.totalCount >= value.openCount
    ) {
      Object.assign(missing, {
        state: value.state,
        openCount: value.openCount,
        totalCount: value.totalCount,
        reason: typeof value.reason === "string" ? value.reason : "",
      });
    }
  } catch {
    /* Legacy or unreadable memos have no recorded pass. */
  }
  return checking
    ? { ...missing, state: "checking", reason: "The AI is checking facts." }
    : missing;
}

export function storyReadinessChip(readiness: StoryReadiness): {
  text: string;
  tone: "ok" | "warn" | "quiet";
} {
  switch (readiness.state) {
    case "checking":
      return { text: "… Checking facts", tone: "quiet" };
    case "ready":
      return { text: "✓ Ready", tone: "ok" };
    case "verified":
      return { text: "✓ Verified", tone: "ok" };
    case "to-check":
      return { text: `! ${readiness.openCount} to check`, tone: "warn" };
    case "not-checked":
      /* Unit ZC: warn like "Not ready", but named for what it is. */
      return { text: "! Not checked yet", tone: "warn" };
    case "not-ready":
      return { text: "✕ Not ready", tone: "warn" };
  }
}

export function storyReadiness(input: {
  headline: string;
  body: string;
  claims: readonly Pick<PackageClaim, "text" | "status">[];
  checking?: boolean;
  held?: readonly { headline: string; reason: string }[];
  /**
   * Unit ZC: a completed evidence check covers this exact draft version. Read
   * from the caller's own record; absent means "no completion record", which is
   * the honest default and the state this gate exists for.
   */
  evidenceCheckedCurrentVersion?: boolean;
  /** Unit ZC: the one-press acknowledgement covers this version. */
  acknowledgedForVersion?: boolean;
}): StoryReadiness {
  const open = input.claims.filter((claim) => claim.status !== "VERIFIED");
  const paragraphs = input.body
    .split(/\r?\n\s*\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean);
  const leadText = `${input.headline} ${paragraphs[0] ?? input.body}`;
  const laterParagraphs = paragraphs.slice(1);
  const openLeadCount = open.filter((claim) => {
    const leadScore = claimParagraphScore(claim.text, leadText);
    const laterScore = Math.max(
      0,
      ...laterParagraphs.map((paragraph) => claimParagraphScore(claim.text, paragraph)),
    );
    return leadScore >= 0.55 && leadScore >= laterScore;
  }).length;
  const openCount = open.length;
  if (input.checking)
    return {
      state: "checking",
      openCount,
      totalCount: input.claims.length,
      reason: "The AI is checking the story's claims against the meeting record.",
    };
  if (input.held?.length)
    return {
      state: "not-ready",
      openCount,
      totalCount: input.claims.length,
      reason: input.held.map((item) => `${item.headline}: ${item.reason}`).join(" "),
    };
  /*
    UNIT ZC -- ZERO CLAIMS IS NOT "VERIFIED" WHEN A CHECKABLE FACT WAS NEVER
    CHECKED.

    Below, `openCount === 0` reads as "verified": "N of N facts matched". That is
    true of a story whose check ran and grounded every fact, and it is also true
    of a story that has NO claims at all because no check ever raised one -- a
    draft with a dollar figure in it that a person would read as given. The
    shared rule decides it, once, so this surface and the publish blocker cannot
    disagree: a zero-claim, unchecked, checkable body is `not-checked`.
  */
  const unchecked = uncheckedStoryNeedsCheck({
    recordedClaims: input.claims.length,
    evidenceCheckedCurrentVersion: input.evidenceCheckedCurrentVersion === true,
    body: input.body,
    acknowledgedForVersion: input.acknowledgedForVersion === true,
    exempt: false,
  });
  if (unchecked.blocked)
    return { state: "not-checked", openCount, totalCount: input.claims.length, reason: unchecked.reason };
  if (openCount === 0)
    return {
      state: "verified",
      openCount,
      totalCount: input.claims.length,
      reason: `${input.claims.length} of ${input.claims.length} facts matched to the meeting record.`,
    };
  if (openLeadCount > 0 || openCount >= 4)
    return {
      state: "not-ready",
      openCount,
      totalCount: input.claims.length,
      reason:
        openLeadCount > 0
          ? `${openLeadCount} headline or first-paragraph fact${openLeadCount === 1 ? "" : "s"} need checking.`
          : `${openCount} fact${openCount === 1 ? "" : "s"} need${openCount === 1 ? "s" : ""} checking.`,
    };
  return {
    state: "to-check",
    openCount,
    totalCount: input.claims.length,
    reason: `${openCount} fact${openCount === 1 ? "" : "s"} need${openCount === 1 ? "s" : ""} checking.`,
  };
}

function claimParagraphScore(claim: string, paragraph: string): number {
  const normalizedParagraph = paragraph
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = claim
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const paragraphTokens = new Set(normalizedParagraph.split(/\s+/));
  const numbers = claim.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const paragraphNumbers = (paragraph.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) =>
    value.replace(/\D/g, ""),
  );

  const ignored = new Set([
    "about",
    "after",
    "against",
    "also",
    "been",
    "being",
    "both",
    "could",
    "from",
    "into",
    "more",
    "over",
    "said",
    "says",
    "that",
    "their",
    "there",
    "these",
    "this",
    "through",
    "under",
    "were",
    "which",
    "will",
    "with",
    "would",
  ]);
  const facts = [...new Set(tokens.filter((token) => token.length >= 4 && !ignored.has(token)))];
  const totalWeight = facts.length + numbers.length * 4;
  if (totalWeight === 0) return 0;
  const factHits = facts.filter((token) => paragraphTokens.has(token)).length;
  const numberHits = numbers.filter((value) =>
    paragraphNumbers.includes(value.replace(/\D/g, "")),
  ).length;
  return (factHits + numberHits * 4) / totalWeight;
}
