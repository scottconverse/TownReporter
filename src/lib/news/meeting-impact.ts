/*
  WR1's resident-impact scoring: the four civic-scanner dimensions that decide
  which of a meeting's items is the story.

  WHY THIS EXISTS. The first WR1 runs ranked the lead by counting things -- how
  many votes an item held, how many dollar figures it named, how many minutes of
  tape it took. That is a vote-count contest, and it gets the news wrong: an item
  with three routine unanimous consent votes outranked the one decision that
  changes what a resident can do, and a long budget presentation with six figures
  outranked a short vote that raised a fee.

  The editor does not need a count. The editor needs to know, in plain words, why
  one item is worth leading on and another is not: was it decided now (immediacy),
  does it land on people who live here (local impact), is there a real fight or a
  real consequence (conflict), is it something the paper has not already said
  (novelty)? civic-scanner scores exactly those four, 1 to 5 each, total 4 to 20,
  and writes the reason beside each number so the number can be argued with.

  The one rule that overrides everything here, from civic-scanner's own editorial
  controls: every substantive action remains in the coverage ledger regardless of
  score. A low score is an editorial ranking, not permission to omit an action.
  So this module ranks; it never drops.

  A missing or malformed score is not a zero. Zero is a judgement -- "this item
  is not news" -- and the model did not make it. An item with no readable score
  is UNRANKED: it sorts after every scored item, it carries no invented dimension,
  and the editor sees it as "not scored" rather than as a low-scoring one.
*/

/**
 * The four newsworthiness dimensions, each scored 1 (least) to 5 (most).
 *
 * The dimension names and their meanings follow civic-scanner's editorial
 * controls exactly, and so do the three thresholds below, so a score computed
 * here means the same thing a score computed anywhere else in the paper does.
 */
export type ImpactScore = {
  /** How much of the decision is live now -- a vote taken, a rule that bites. */
  immediacy: number;
  /** How squarely it lands on the people who live in this town. */
  impact: number;
  /** Whether the item is contested, consequential, or both. */
  conflict: number;
  /** Whether it is new -- not routine procedure, not a repeat of a covered item. */
  novelty: number;
  /** One plain sentence for each dimension, retained so the number can be argued with. */
  immediacyReason: string;
  impactReason: string;
  conflictReason: string;
  noveltyReason: string;
  /** The four dimensions summed: 4 to 20. Convenience, recomputed on parse. */
  total: number;
};

/** The editorial decision the total supports, per civic-scanner's thresholds. */
export type ImpactDecision = "ADVANCE" | "HOLD" | "DEMOTE";

/** Each dimension runs 1 to 5; 0 or 7 is not a score, it is a broken reply. */
export const IMPACT_MIN = 1;
export const IMPACT_MAX = 5;
/** Four dimensions, so the smallest real total is 4 and the largest is 20. */
export const IMPACT_TOTAL_MIN = IMPACT_MIN * 4;
export const IMPACT_TOTAL_MAX = IMPACT_MAX * 4;
/** civic-scanner's thresholds: 10-20 advances, 7-9 watches, 4-6 demotes. */
export const IMPACT_ADVANCE_MIN = 10;
export const IMPACT_HOLD_MIN = 7;

/** The four dimensions, in the order the prompt asks for them. */
export const IMPACT_DIMENSIONS = ["immediacy", "impact", "conflict", "novelty"] as const;
export type ImpactDimension = (typeof IMPACT_DIMENSIONS)[number];

/** The reason field that belongs to each dimension. */
export function impactReasonKey(dimension: ImpactDimension): keyof ImpactScore {
  return `${dimension}Reason` as keyof ImpactScore;
}

/**
 * The decision a total earns. 10-20 advances to reporting, 7-9 goes on the watch
 * list, 4-6 is demoted -- exactly civic-scanner's editorial-controls thresholds.
 */
export function impactDecision(total: number): ImpactDecision {
  if (total >= IMPACT_ADVANCE_MIN) return "ADVANCE";
  if (total >= IMPACT_HOLD_MIN) return "HOLD";
  return "DEMOTE";
}

/**
 * Whether a score is real and complete: four dimensions, each an integer 1-5.
 * Anything else -- a missing reply, a 0, a 7, a fraction, a NaN -- is not a
 * score, and the item it describes stays unranked rather than being read as
 * "scored low".
 */
export function isRanked(impact: ImpactScore | null | undefined): impact is ImpactScore {
  if (!impact || typeof impact !== "object") return false;
  for (const dimension of IMPACT_DIMENSIONS) {
    const value = (impact as Record<string, unknown>)[dimension];
    if (typeof value !== "number" || !Number.isInteger(value)) return false;
    if (value < IMPACT_MIN || value > IMPACT_MAX) return false;
  }
  return true;
}

/** The four dimensions summed, or null when the score is not real. */
export function impactTotal(impact: ImpactScore | null | undefined): number | null {
  if (!isRanked(impact)) return null;
  return impact!.immediacy + impact!.impact + impact!.conflict + impact!.novelty;
}

/**
 * A whole number in 1-5, or null. `0` is a number but not a score, and a
 * fraction ("3.5") is a malformed reply -- rounding it would invent a precision
 * the model did not give -- so both are refused and their item stays unranked.
 */
function dimension(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number)) return null;
  if (number < IMPACT_MIN || number > IMPACT_MAX) return null;
  return number;
}

/** A dimension's reason, trimmed and capped. Empty when the model gave none. */
function reason(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Read one impact score off a model reply. Accepts the field names the rest of
 * the paper uses (`immediacy`/`impact`/`conflict`/`novelty` with a `*Reason`
 * beside each, or the terse `immediacy_reason` the JSON prompt shows). A reply
 * that is missing any dimension, or states one outside 1-5, parses to null: the
 * item stays unranked and the run does not invent the missing number.
 */
export function parseImpactScore(raw: unknown): ImpactScore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const picked: Record<string, number> = {};
  for (const dimensionName of IMPACT_DIMENSIONS) {
    // Both spellings appear in the wild: the prompt's own `immediacy` and a
    // camel/underscore variant a model sometimes returns.
    const value =
      dimension(record[dimensionName]) ??
      dimension(record[`${dimensionName}_score`]) ??
      dimension(record[`${dimensionName}Score`]);
    if (value === null) return null;
    picked[dimensionName] = value;
  }
  const total = picked.immediacy! + picked.impact! + picked.conflict! + picked.novelty!;
  return {
    immediacy: picked.immediacy!,
    impact: picked.impact!,
    conflict: picked.conflict!,
    novelty: picked.novelty!,
    immediacyReason: reason(record.immediacyReason ?? record.immediacy_reason),
    impactReason: reason(record.impactReason ?? record.impact_reason),
    conflictReason: reason(record.conflictReason ?? record.conflict_reason),
    noveltyReason: reason(record.noveltyReason ?? record.novelty_reason),
    total,
  };
}

/** The reason recorded when the model's score could not be read. */
export const IMPACT_UNSCORED_REASON = "Not scored: the model's newsworthiness reply could not be read.";

/**
 * The scoring system prompt. It is the status pass's own prompt with the count
 * replaced by the four dimensions, so the model judges the item's ACTUAL
 * evidence -- what was decided, who it lands on, what is contested, what is new
 * -- and writes the reason beside each number. The prompt carries the evidence
 * digest, not a vote count: a motion the meeting made is evidence of its
 * immediacy and impact, not a tally to be maximized.
 */
export const IMPACT_SCORE_SYSTEM = `You are the editor of a local paper, ranking what a whole city-meeting story should lead on.
You are given a numbered ledger of every item the meeting covered, with each item's own evidence -- what was said, what was decided, who it lands on.
Score each item on four newsworthiness dimensions, each 1 (least) to 5 (most):
- immediacy: how much of the decision is live now -- a vote taken tonight, a rule that starts to bite this year, versus a study or a report with no action.
- impact: how squarely the item lands on the people who live in this town -- their taxes, rents, water, safety, schools, services -- versus a vendor's contract or an internal process.
- conflict: whether the item is contested, consequential, or both -- a divided vote, a real disagreement, a decision that changes someone's options -- versus unanimous routine business.
- novelty: whether it is new -- a first decision, a fresh problem -- versus routine procedure, a ceremony, or something the paper has already reported.
For each item, also write one short sentence of justification for each dimension, in a "*Reason" field beside it.
Then choose a status for the item:
- "lead": the story should lead with it (the most consequential decision for residents). Choose at most two.
- "roundup": it belongs in a short ALSO AT THE MEETING list under the lead.
- "excluded": it is not news (routine procedure, a duplicate, an announcement already covered).
Do NOT rank by how many votes an item holds, how many dollar figures it names, or how long it ran: three routine unanimous votes are not more newsworthy than one decision that changes a resident's life, and a long presentation with a big budget number is not automatically the lead. Judge by what the decision does.
An item that holds a recorded decision is never "excluded": if the meeting decided it, it is at least roundup.
Give each item a "label": two to six plain words a reader would recognise, naming the subject and not the paperwork -- "Airport noise rules", "Library business classes", "Electrify Longmont Day", "Jim Berthold". No item numbers, no "City Council Study Session", no date, no trailing colon, no cut-off word.
Never invent an item, a vote, or a dimension you were not shown.
Return compact valid JSON only: {"items":[{"item_no":1,"status":"roundup","label":"Airport noise rules","immediacy":4,"immediacy_reason":"voted tonight","impact":5,"impact_reason":"quiets homes near the airport","conflict":3,"conflict_reason":"one dissent","novelty":4,"novelty_reason":"new rules","reason":"short why"}]}
Every item number in the ledger must appear exactly once.`;

/**
 * One line describing a score for the notes and the panel: the total, its
 * decision, and each dimension with its number and its reason. An item with no
 * readable score says so instead of showing a fabricated zero.
 */
export function describeImpact(name: string, impact: ImpactScore | null | undefined): string {
  if (!isRanked(impact)) return `${name}: not scored -- ${IMPACT_UNSCORED_REASON}`;
  const total = impactTotal(impact)!;
  const parts = IMPACT_DIMENSIONS.map((dimensionName) => {
    const value = impact![dimensionName];
    const why = String(impact![impactReasonKey(dimensionName)] ?? "").trim();
    return `${dimensionName} ${value}${why ? ` (${why})` : ""}`;
  });
  return `${name}: ${total}/20 ${impactDecision(total)} -- ${parts.join("; ")}`;
}

/**
 * The four dimensions of one item as a compact line, for the ledger digest the
 * model reads. Empty for an unscored item, so a re-score never sees a
 * half-invented one.
 */
export function impactLine(impact: ImpactScore | null | undefined): string {
  if (!isRanked(impact)) return "";
  const total = impactTotal(impact)!;
  return `score ${total}/20 (${IMPACT_DIMENSIONS.map((d) => `${d} ${impact![d]}`).join(", ")}) ${impactDecision(total)}`;
}
