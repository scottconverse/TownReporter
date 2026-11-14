/**
 * A lead's newsworthiness in four parts (civic-scanner's rubric, SKILL.md
 * "Score each lead"): immediacy, impact, conflict and novelty, each an integer
 * from 1 to 5, each with one short reason. The model gives the parts; the desk
 * adds them. The total (4 to 20) is the lead's `newsworthiness`, so the Queue's
 * sort, its warm/hot colors (10 and 14) and every priority floor keep working
 * unchanged, and the parts travel in `leads.score_parts` (migration 0164).
 *
 * Why parts instead of one number (Scott's 20-lead test, Nov 13 2026, the scan
 * model, 3 runs per lead): one 0-20 number moved 1.6 points between runs on
 * average and kept the same ADVANCE/HOLD/DEMOTE band on 14 of 20 leads; the
 * four parts moved 0.75 points and kept the band on 19 of 20, and they say why.
 *
 * A reply without valid parts is not forced into them: the caller falls back
 * to a plain `newsworthiness` number when the model sent one, exactly as before.
 */

export const SCORE_PARTS = ["immediacy", "impact", "conflict", "novelty"] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

export type ScoreParts = {
  immediacy: number;
  impact: number;
  conflict: number;
  novelty: number;
  /** One short reason per part; "" when the model gave none. */
  reasons: Record<ScorePart, string>;
};

/** The question each part answers, word for word from civic-scanner. */
export const SCORE_PART_QUESTIONS: Record<ScorePart, string> = {
  immediacy: "Why now? What changed?",
  impact: "Who gets hit? How many people? How much money?",
  conflict: "Is there a fight? Opposing sides?",
  novelty: "Is this new, or routine recurrence?",
};

const LABEL: Record<ScorePart, string> = {
  immediacy: "Immediacy",
  impact: "Impact",
  conflict: "Conflict",
  novelty: "Novelty",
};

/** The prompt sentence that asks for the parts. The scan and "Research and score it" both use it. */
export function scorePartsInstruction(field: string): string {
  return (
    `${field} rates the lead on four parts, each an integer from 1 to 5: ` +
    SCORE_PARTS.map((p) => `${p} (${SCORE_PART_QUESTIONS[p]})`).join(", ") +
    `. Give each part one short reason in ${SCORE_PARTS.map((p) => `${p}_why`).join(", ")}. ` +
    "1 means little or none, 3 means some, 5 means the most a local lead gets. " +
    "Most local notices have no fight, so conflict is 1 unless the text shows opposing sides. " +
    "The desk adds the four parts into the lead's newsworthiness (4 to 20)."
  );
}

/** The JSON example for the parts, as the model should send it. */
export const SCORE_PARTS_EXAMPLE = {
  immediacy: 3,
  immediacy_why: "one short reason",
  impact: 3,
  impact_why: "one short reason",
  conflict: 1,
  conflict_why: "one short reason",
  novelty: 3,
  novelty_why: "one short reason",
};

/** A 1-5 integer, or null. A string that IS such an integer counts; nothing else does. */
function part(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function reason(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

/**
 * The four parts out of a model's object, or null when any part is missing or
 * not an integer from 1 to 5. Half a score is no score: the caller keeps its
 * old behavior instead of guessing the missing part.
 */
export function readScoreParts(raw: unknown): ScoreParts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const [immediacy, impact, conflict, novelty] = SCORE_PARTS.map((p) => part(o[p]));
  if (immediacy == null || impact == null || conflict == null || novelty == null) return null;
  return {
    immediacy,
    impact,
    conflict,
    novelty,
    reasons: {
      immediacy: reason(o.immediacy_why),
      impact: reason(o.impact_why),
      conflict: reason(o.conflict_why),
      novelty: reason(o.novelty_why),
    },
  };
}

export function scoreTotal(p: ScoreParts): number {
  return p.immediacy + p.impact + p.conflict + p.novelty;
}

/** Parts as stored in `leads.score_parts`, or null for a row scored the old way or not at all. */
export function parseStoredScoreParts(raw: unknown): ScoreParts | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const reasons = (o.reasons && typeof o.reasons === "object" ? o.reasons : {}) as Record<string, unknown>;
  return readScoreParts({
    ...o,
    immediacy_why: reasons.immediacy,
    impact_why: reasons.impact,
    conflict_why: reasons.conflict,
    novelty_why: reasons.novelty,
  });
}

/** The tooltip on the Queue's score: the total, the four parts, then each reason on its own line. */
export function scoreTooltip(total: number, parts: ScoreParts | null): string {
  const head = `Newsworthiness ${total}/20`;
  if (!parts) return head;
  const line = SCORE_PARTS.map((p) => `${LABEL[p]} ${parts[p]}`).join(" · ");
  const why = SCORE_PARTS.filter((p) => parts.reasons[p]).map((p) => `${LABEL[p]}: ${parts.reasons[p]}`);
  return [head, line, ...why].join("\n");
}
