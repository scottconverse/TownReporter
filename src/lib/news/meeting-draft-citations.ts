/**
 * Derive which transcript positions a finished meeting draft actually drew from.
 *
 * This is the one rule the whole design rests on: citations are always derived
 * from what the draft says, never inherited. A redraft is a new draft, so it gets
 * a new derivation. Handing the previous draft's citations to new prose is how you
 * get a draft that quotes the tape and then contradicts it.
 *
 * The derivation is deliberately conservative. A citation is kept only when the
 * draft's own text clearly uses it, so the link table describes the draft rather
 * than the material that was available to it.
 */
export type CandidateCitation = {
  item: string;
  segmentIndex: number;
  captionSha256: string;
  excerpt: string;
};

/**
 * Words that carry no evidential weight on their own. Matching on these would
 * make every citation look used, which is the same as keeping all of them.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "was", "were", "are", "has",
  "have", "had", "not", "but", "they", "their", "there", "which", "when", "what",
  "will", "would", "could", "should", "into", "than", "then", "them", "these",
  "those", "been", "being", "its", "our", "your", "his", "her", "she", "him",
  "about", "after", "before", "over", "under", "again", "also", "said", "says",
  "city", "council", "meeting", "item", "member", "members", "staff",
]);

function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w));
}

/**
 * A citation counts as used when a run of its distinctive words appears in the
 * draft. Counting single words would match almost anything on a long transcript;
 * requiring three consecutive distinctive words that actually appear is what
 * separates "the draft used this passage" from "this passage shares vocabulary
 * with the meeting".
 */
export function citationWasUsed(citation: CandidateCitation, draftText: string): boolean {
  const words = meaningfulWords(citation.excerpt);
  /*
    The threshold scales with what the excerpt actually offers.

    A fixed "three consecutive words" rule looked right and was wrong: a short
    spoken line reduces to two distinctive words once stopwords and short words
    are removed ("approved ordinance"), so a genuinely quoted passage could never
    match and its citation was silently dropped. A fixed six-word fallback had the
    same defect from the other side.

    So: require a consecutive run only when the excerpt is long enough to have one,
    and otherwise require that every distinctive word the excerpt offers appears.
  */
  if (words.length === 0) return false;
  const haystack = draftText.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  if (words.length < 3) {
    return words.every((w) => haystack.includes(w));
  }
  for (let i = 0; i + 2 < words.length; i += 1) {
    const run = words.slice(i, i + 3).join(" ");
    if (haystack.includes(run)) return true;
  }
  // A long excerpt can be paraphrased throughout; fall back to a strong
  // majority of its distinctive words rather than dropping a genuinely used one.
  const present = words.filter((w) => haystack.includes(w)).length;
  return words.length >= 6 && present / words.length >= 0.6;
}

/**
 * The citations a draft used, in the shape the link writer stores. Returns [] when
 * the draft used none, so no empty link row is written.
 */
export function deriveUsedCitations(input: {
  candidates: CandidateCitation[];
  headline: string;
  dek: string;
  body: string;
}): { segmentIndex: number; captionSha256: string }[] {
  const text = [input.headline, input.dek, input.body].join("\n");
  return input.candidates
    .filter((c) => citationWasUsed(c, text))
    .map((c) => ({ segmentIndex: c.segmentIndex, captionSha256: c.captionSha256 }));
}

