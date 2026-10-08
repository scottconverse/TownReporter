import type { PackageClaim } from "./civic-reporting.ts";

export type StoryReadinessState = "checking" | "verified" | "to-check" | "not-ready";

export type StoryReadiness = {
  state: StoryReadinessState;
  openCount: number;
  totalCount: number;
  reason: string;
};

/** Read the filed state once for Story, Drafts and Today; missing checks never imply a pass. */
export function savedStoryReadiness(raw: unknown, checking = false): StoryReadiness {
  const missing: StoryReadiness = {
    state: "not-ready",
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
      ["checking", "verified", "to-check", "not-ready"].includes(String(value.state)) &&
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
    case "verified":
      return { text: "✓ Verified", tone: "ok" };
    case "to-check":
      return { text: `! ${readiness.openCount} to check`, tone: "warn" };
    case "not-ready":
      return { text: "✕ Not ready", tone: "warn" };
  }
}

export function storyReadiness(input: {
  headline: string;
  body: string;
  claims: readonly Pick<PackageClaim, "text" | "status">[];
  checking?: boolean;
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
