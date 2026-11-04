/**
 * G27-MS-1 (2026-11-03, desk only): the order and the labels of "Our past
 * stories close in meaning" (DEF-1, see story-meaning-search.server.ts).
 *
 * The walk that filed this: "police staffing" put an opinion piece on the tech
 * board at the top of the list, and "school board budget" put an urban-renewal
 * opinion piece there. Both are real hits on the words -- an opinion piece
 * about budgets is close in meaning to a query about a budget -- so the
 * complaint is not that they were found. It is that a COLUMN sat in the same
 * list, in the same type, as the paper's reporting, with nothing saying which
 * was which, and it came first.
 *
 * So this module does two things and only these two:
 *
 *   - marks an opinion piece (`isOpinionTopic`, the row's `topic`), so the
 *     desk can print its own word "Opinion" beside it;
 *   - orders the list by SCORE BAND first and only then puts opinion pieces
 *     after reporting: a news story and an opinion piece within the same
 *     band of closeness (PAST_STORY_SCORE_BAND) keep the reporting first,
 *     while a clearly closer opinion piece still outranks a weaker news
 *     story. A band, rather than "opinion always last", because a near-exact
 *     opinion piece is more useful background than a distant story that
 *     happens to be reporting.
 *
 * Nothing is filtered out: the list still holds what it held (rule 25). What
 * changed is the order and the label.
 *
 * WHY THE 0.46 CUT IS UNCHANGED -- stated because the finding offered raising
 * it as an option. STORY_MEANING_MIN_SCORE (story-meaning-search.server.ts) is
 * the cut measured on the real model on Oct 24 and shared with the evidence
 * list. Nothing in the code or the tests shows that 0.46 is what let those two
 * pieces in: the two hits are TOPICALLY close (staffing/budget words), and the
 * vectors are not in the repo, so a higher cut would be a guess made without
 * evidence -- and it would also drop real news stories that score between the
 * old and new bars, which is the failure this feature exists to avoid. So the
 * cut stays at 0.46; the label and the order are what change.
 */

/** How close two hits must be to count as the same band of usefulness. A
 *  fifth of the scale: two stories 0.04 apart are "about as close", and the
 *  reporting/opinion split decides between them; 0.06 apart is not, and the
 *  closer one wins whatever it is. */
export const PAST_STORY_SCORE_BAND = 0.05;

/** The word the desk prints beside an opinion piece. */
export const OPINION_PAST_STORY_LABEL = "Opinion";

/** The `articles.topic` value the paper files an opinion piece under (the
 *  Opinion section's own key -- see opinion.ts and articles.$slug.tsx). */
export function isOpinionTopic(topic: string | null | undefined): boolean {
  return String(topic ?? "").trim().toLowerCase() === "opinion";
}

/** The band a score falls in. Rounded, with a hair of tolerance so a score
 *  sitting exactly on a boundary cannot land one band low on a float error
 *  (0.46 + 0.05 + 0.05 is not exactly 0.56 in binary). */
export function pastStoryScoreBand(score: number): number {
  return Math.floor((Number(score) || 0) / PAST_STORY_SCORE_BAND + 1e-9);
}

/**
 * Closest band first; inside a band, reporting before opinion; inside that,
 * closest first. Stable for equal scores, so the ranker's own order is kept
 * where nothing else decides.
 */
export function orderPastStories<T extends { score: number; isOpinion?: boolean }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const band = pastStoryScoreBand(b.score) - pastStoryScoreBand(a.score);
    if (band !== 0) return band;
    const opinion = (a.isOpinion ? 1 : 0) - (b.isOpinion ? 1 : 0);
    if (opinion !== 0) return opinion;
    return b.score - a.score;
  });
}
