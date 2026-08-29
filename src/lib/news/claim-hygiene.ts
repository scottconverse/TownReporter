/**
 * Two rules that decide what a claim is allowed to be.
 *
 * Both were found by running the same real pack through Opus, Sonnet and Haiku
 * five times each. Neither is a model problem — every model did both — so
 * neither is fixed by choosing a different one.
 */

/**
 * Is this claim about the investigation rather than about the town?
 *
 * Every model, every batch, filed claims like:
 *
 *   OBSERVATION@1.0  "The literal outbound URL of submission 1oimdib remains
 *                     unmapped 20 hops after the HTML page rendered"
 *   OBSERVATION@0.95 "This hop directly invoked the WebFetch tool against two
 *                     distinct hosts"
 *   OBSERVATION@0.9  "SELF-INDICTING METHODOLOGICAL FINDING: twenty-five hops
 *                     searched for the record of a contract"
 *
 * That is the desk narrating its own progress and filing it as evidence. It is
 * a large share of every hop's claims, it crowds out real findings in the
 * brief, and none of it is a fact about Longmont.
 *
 * The frontier is where "we still have not checked X" belongs. A claim is for
 * what was found.
 */
const SELF_REFERENTIAL: RegExp[] = [
  /*
    A hop has to be COUNTED to be self-referential.

    The first version matched "hop" near any of a few common words, which ate
    "Hops are grown in the county" — a real claim about the town, deleted by a
    filter written to protect it. What makes it a note about the search is a
    number: "hop 6", "20 hops", "twenty-five hops".
  */
  /\bhops?\s*#?\d+\b/i,
  /\b\d+\s+hops?\b/i,
  /\b(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\s+hops?\b/i,
  /\bthis (hop|run|pass|investigation|search)\b/i,
  /\b(remains?|stayed|is still|has never been|have never been|was never|were never)\s+(un)?(examined|mapped|recorded|profiled|fetched|checked|verified|queried|attempted|explored)\b/i,
  /\bnever (been )?(examined|mapped|recorded|profiled|fetched|checked|queried|attempted)\b/i,
  /\b(webfetch|web_fetch|web_search|the fetch tool|the search tool|zero-auth fetch|render(ing|ed)? pipeline)\b/i,
  /\bself[- ]indicting\b|\bmethodological finding\b/i,
  /\b(search|fetch|query|queue)d? (targets?|attempts?) (have been|were) (identified|queued)\b/i,
  /\bthe (investigation|desk|planner|loop|pipeline) (has|had|did) not\b/i,
  /\bunexamined\b|\bunmapped\b|\bunqueried\b/i,
];

export function isSelfReferential(text: string): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return SELF_REFERENTIAL.some((re) => re.test(t));
}

/**
 * A FACT needs a receipt.
 *
 * FACT is the one label the confidence clamp cannot correct, because its
 * ceiling is 1.0. Across ten runs the models labelled 17–29% of claims FACT,
 * and a FACT with nothing pointing at a document is not a fact — it is an
 * inference wearing a better coat.
 *
 * Downgraded rather than dropped. The desk's own non-gating rule says weak
 * evidence keeps being investigated; it just may not be called established.
 */
export type ClaimCitation = {
  source_url?: string | null;
  artifact_version_id?: number | null;
  capture_event_id?: number | null;
};

export function hasCitation(c: ClaimCitation): boolean {
  return Boolean(
    (typeof c.source_url === "string" && /^https?:\/\//i.test(c.source_url.trim())) ||
      (typeof c.artifact_version_id === "number" && c.artifact_version_id > 0) ||
      (typeof c.capture_event_id === "number" && c.capture_event_id > 0),
  );
}

export function labelAfterCitationCheck(kind: string, c: ClaimCitation): string {
  const k = String(kind ?? "UNKNOWN").toUpperCase();
  if (k !== "FACT") return k;
  return hasCitation(c) ? "FACT" : "INFERENCE";
}

/** The prompt half. Code enforces it; this makes the model aim right. */
export const CLAIM_HYGIENE_RULES = `CLAIMS ARE ABOUT THE TOWN, NOT ABOUT THIS INVESTIGATION.
Do not file a claim about your own progress. "X remains unexamined after 20 hops", "this hop fetched two hosts", "the account has never been profiled" — none of those are findings, they are notes about the search. They belong in frontier or questions. A claim records what was FOUND.

A FACT REQUIRES A CITATION. Label a claim FACT only when you can point at the document: a source_url, an artifact_version_id, or a capture_event_id. Without one it is an INFERENCE, however sure you are. FACT is the only label whose confidence is not capped, so it is the one that has to be earned.`;
