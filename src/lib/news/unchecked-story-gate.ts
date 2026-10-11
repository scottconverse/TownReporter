import { EVIDENCE_REVIEW_VERSION_KEY, evidenceReviewToken } from "./draft-evidence.ts";
import { topicConfirmationFingerprint } from "./notes.ts";
import type { DraftRow } from "./types.ts";

/**
 * The zero-recorded-claims gate.
 *
 * The publish gate counted only claims the evidence check RAISED and nobody had
 * judged, so a story whose check produced NO claims printed with no gate at all
 * -- even when no check had ever run against a body carrying a dollar figure, a
 * date or a vote. When a draft has zero recorded claims, no completed check
 * covering this version, no acknowledgement for it, and a checkable body, it is
 * unchecked: one exact sentence refuses Publish and readiness reads
 * `not-checked`. Pure, deterministic and model-free, so the page and the server
 * decide it the same way.
 */

/** The one sentence the blocker, the refusal and the readiness reason all use. */
export const UNCHECKED_STORY_REASON =
  "No claims were recorded for this story, so nothing has been checked. Run the evidence check, or read it against your sources and press 'I checked this story myself'.";

const MONTHS =
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b/i;
const WEEKDAYS = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;
const VOTE_WORDS =
  /\b(?:unanimous|unanimously|approve|approved|approves|adopt|adopted|adopts|vote|voted|votes|pass|passed|passes|authorize|authorized|enact|enacted|ratify|ratified|reject|rejected|tabled)\b/i;

/**
 * A body fact a person would check: a digit, a month or day name, a percent or
 * dollar sign, or a vote word. A small floor, not a fact extractor.
 */
export function bodyHasCheckableFact(body: string): boolean {
  const text = String(body ?? "");
  if (!text.trim()) return false;
  if (/\d/.test(text)) return true;
  if (text.includes("%") || text.includes("$")) return true;
  if (MONTHS.test(text)) return true;
  if (WEEKDAYS.test(text)) return true;
  if (VOTE_WORDS.test(text)) return true;
  return false;
}

function memo(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const normalized = (text: string | null | undefined) => String(text ?? "").replace(/\s+/g, " ").trim();

/**
 * Does a completed evidence check cover the EXACT draft version in hand?
 *
 * A completed run writes `research_json.evidenceReviewVersion`, the same
 * `topic + evidenceReviewToken` identity the section confirmation and the claims
 * acceptance use; the token excludes the derived style record and this stamp, so
 * writing it never moves the identity. Runs completed before the stamp carry only
 * `evidenceReconciledAt` plus a matching `aiEvidenceReview.checkedText`; those
 * still clear (decision 5), and `draft-edit.server.ts` stamps the stale identity on
 * any changed save so a headline/dek edit takes that legacy completion back too.
 */
export function evidenceCheckCoversCurrentVersion(draft: Partial<DraftRow>): boolean {
  const research = memo(draft.research_json);
  const identity = topicConfirmationFingerprint(evidenceReviewToken(draft));
  /* A present stamp decides alone: falling through on a mismatch would clear the
     gate for a headline-only edit, whose checkedText still equals the body. */
  if (EVIDENCE_REVIEW_VERSION_KEY in research) {
    return research[EVIDENCE_REVIEW_VERSION_KEY] === identity;
  }
  const reconciledAt = research.evidenceReconciledAt;
  if (typeof reconciledAt !== "string" || !reconciledAt.trim()) return false;
  const ai = research.aiEvidenceReview as { checkedText?: unknown } | undefined;
  return Boolean(
    ai &&
      typeof ai.checkedText === "string" &&
      normalized(ai.checkedText) === normalized(draft.body ?? ""),
  );
}

export type UncheckedStoryDecision = {
  /** Is Publish refused for this reason? */
  blocked: boolean;
  /** The exact sentence, when `blocked`. */
  reason: string;
};

/**
 * The one decision the blocker, the readiness chip and `performPublish` read.
 * `recordedClaims` is the run's output (any recorded claim is the ordinary claims
 * gate's business); `exempt` is reserved for the standalone editorial.
 */
export function uncheckedStoryNeedsCheck(input: {
  recordedClaims: number;
  evidenceCheckedCurrentVersion: boolean;
  body: string;
  acknowledgedForVersion: boolean;
  exempt: boolean;
}): UncheckedStoryDecision {
  if (input.exempt) return { blocked: false, reason: "" };
  if (input.recordedClaims > 0) return { blocked: false, reason: "" };
  if (input.evidenceCheckedCurrentVersion) return { blocked: false, reason: "" };
  if (input.acknowledgedForVersion) return { blocked: false, reason: "" };
  if (!bodyHasCheckableFact(input.body)) return { blocked: false, reason: "" };
  return { blocked: true, reason: UNCHECKED_STORY_REASON };
}
