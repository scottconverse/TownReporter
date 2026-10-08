import type { PackageClaim } from "./civic-reporting.ts";

export type StoryReadinessState = "checking" | "verified" | "to-check" | "not-ready";

export type StoryReadiness = {
  state: StoryReadinessState;
  openCount: number;
  totalCount: number;
  reason: string;
};

export function storyReadiness(input: {
  headline: string;
  body: string;
  claims: readonly Pick<PackageClaim, "text" | "status">[];
  checking?: boolean;
}): StoryReadiness {
  const open = input.claims.filter((claim) => claim.status !== "VERIFIED");
  const firstParagraph = input.body.split(/\r?\n\s*\r?\n/)[0] ?? input.body;
  const leadText = `${input.headline} ${firstParagraph}`;
  const openLeadCount = open.filter((claim) => claimTouchesLead(claim.text, leadText)).length;
  const openCount = open.length;
  if (input.checking) return {
    state: "checking",
    openCount,
    totalCount: input.claims.length,
    reason: "The AI is checking the story's claims against the meeting record.",
  };
  if (openCount === 0) return {
    state: "verified",
    openCount,
    totalCount: input.claims.length,
    reason: `${input.claims.length} of ${input.claims.length} facts matched to the meeting record.`,
  };
  if (openLeadCount > 0 || openCount >= 4) return {
    state: "not-ready",
    openCount,
    totalCount: input.claims.length,
    reason: openLeadCount > 0
      ? "A headline or first-paragraph fact is still open."
      : `${input.claims.length - openCount} of ${input.claims.length} facts matched to the meeting record; ${openCount} remain open.`,
  };
  return {
    state: "to-check",
    openCount,
    totalCount: input.claims.length,
    reason: `${openCount} fact${openCount === 1 ? "" : "s"} need${openCount === 1 ? "s" : ""} checking.`,
  };
}

function claimTouchesLead(claim: string, lead: string): boolean {
  const normalizedLead = lead.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = claim.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
  const leadTokens = new Set(normalizedLead.split(/\s+/));
  const numbers = claim.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const leadNumbers = (lead.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((value) => value.replace(/\D/g, ""));
  if (numbers.some((value) => leadNumbers.includes(value.replace(/\D/g, "")))) return true;

  const names = claim.match(/\b[A-Z][a-z]{2,}\b/g)?.slice(1) ?? [];
  if (names.some((name) => leadTokens.has(name.toLowerCase()))) return true;

  const ignored = new Set([
    "about", "after", "against", "also", "been", "being", "both", "could", "from", "into", "more",
    "over", "said", "says", "that", "their", "there", "these", "this", "through", "under", "were", "which",
    "will", "with", "would",
  ]);
  const facts = [...new Set(tokens.filter((token) => token.length >= 4 && !ignored.has(token)))];
  if (facts.length < 2) return facts.some((token) => leadTokens.has(token));
  const hits = facts.filter((token) => leadTokens.has(token)).length;
  return hits >= 2 && hits / facts.length >= 0.55;
}
