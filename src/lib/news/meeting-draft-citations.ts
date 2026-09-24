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

export type FocusedCitationInput = {
  candidates: CandidateCitation[];
  /** Segment IDs present in the exact focused evidence supplied to the writer. */
  visibleSegmentIndexes: number[];
  /** Validated focus/outcome anchors; ignored unless also visible to the writer. */
  anchorSegmentIndexes: number[];
  headline: string;
  dek: string;
  body: string;
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

function stem(word: string): string {
  if (word.length > 7 && word.endsWith("tion")) return word.slice(0, -4);
  if (word.length > 7 && word.endsWith("ment")) return word.slice(0, -4);
  if (word.length > 6 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3).replace(/(.)\1$/, "$1");
  if (word.length > 5 && word.endsWith("ed")) return word.slice(0, -2).replace(/(.)\1$/, "$1");
  if (word.length > 6 && word.endsWith("al")) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w))
    .map(stem);
}

function uniqueWords(text: string): Set<string> {
  return new Set(meaningfulWords(text));
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
  const draftWords = uniqueWords(text);
  const selected = new Map<number, CandidateCitation>();
  const scores = new Map<number, number>();

  for (const candidate of input.candidates) {
    if (citationWasUsed(candidate, text)) {
      selected.set(candidate.segmentIndex, candidate);
      scores.set(candidate.segmentIndex, 100 + [...uniqueWords(candidate.excerpt)].filter((word) => draftWords.has(word)).length);
    }
  }

  /*
    Auto-captions arrive as tiny fragments, often only two or three spoken words.
    A finished sentence routinely paraphrases a fact spread across several adjacent
    fragments, so no individual fragment can satisfy the conservative matcher above.
    Evaluate a bounded local window as one passage, then retain only the fragments in
    that passage that share meaningful words with the finished prose. This preserves
    the governing rule (derive from the finished draft) without treating every
    transcript fragment made available to the writer as evidence it used.
  */
  for (let center = 0; center < input.candidates.length; center += 1) {
    const anchor = input.candidates[center]!;
    const passage = input.candidates.filter(
      (candidate) =>
        candidate.item === anchor.item &&
        Math.abs(candidate.segmentIndex - anchor.segmentIndex) <= 4,
    );
    if (passage.length < 2) continue;

    const passageWords = uniqueWords(passage.map((candidate) => candidate.excerpt).join(" "));
    const shared = [...passageWords].filter((word) => draftWords.has(word));
    const minimum = passageWords.size <= 12 ? 3 : 4;
    if (shared.length < minimum || shared.length / passageWords.size < 0.2) continue;

    const ranked = passage
      .map((candidate) => ({
        candidate,
        score: [...uniqueWords(candidate.excerpt)].filter((word) => draftWords.has(word)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.candidate.segmentIndex - b.candidate.segmentIndex)
      .slice(0, 3);
    for (const { candidate, score } of ranked) {
      selected.set(candidate.segmentIndex, candidate);
      scores.set(candidate.segmentIndex, Math.max(scores.get(candidate.segmentIndex) ?? 0, shared.length * 10 + score));
    }
  }

  const bounded: CandidateCitation[] = [];
  for (const candidate of [...selected.values()].sort(
    (a, b) => (scores.get(b.segmentIndex) ?? 0) - (scores.get(a.segmentIndex) ?? 0) || a.segmentIndex - b.segmentIndex,
  )) {
    if (bounded.some((kept) => kept.item === candidate.item && Math.abs(kept.segmentIndex - candidate.segmentIndex) <= 1)) continue;
    bounded.push(candidate);
    if (bounded.length === 50) break;
  }

  return bounded
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
    .map((candidate) => ({
      segmentIndex: candidate.segmentIndex,
      captionSha256: candidate.captionSha256,
    }));
}

function voteOutcome(text: string): "carried" | "failed" | null {
  if (/\b(fails|failed|rejected|denied)\b/i.test(text) || /\bvoted\s+(?:\d{1,2}\s*(?:-|to)\s*\d{1,2}\s+)?(?:to\s+)?(?:reject|deny|kill)\b/i.test(text)) return "failed";
  if (/\b(carries|carried|passed|passes|approved|adopted)\b/i.test(text) || /\bvoted\s+\d{1,2}\s*(?:-|to)\s*\d{1,2}[^\n]{0,90}?\bto\s+(?:direct|approve|adopt|advance|revive|authorize|refer|send|return)\b/i.test(text)) return "carried";
  return null;
}

function voteTally(text: string): string | null {
  const digits = text.toLowerCase()
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (word) => String(
      ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"].indexOf(word),
    ));
  const match = digits.match(/\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\b/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function anchorClaimAppears(candidate: CandidateCitation, draftText: string): boolean {
  if (citationWasUsed(candidate, draftText)) return true;
  const citedDockets = docketIdentifiers(candidate.excerpt);
  if (citedDockets.some((identifier) => docketIdentifiers(draftText).includes(identifier))) return true;
  const evidenceOutcome = voteOutcome(candidate.excerpt);
  const draftOutcome = voteOutcome(draftText);
  if (!evidenceOutcome || evidenceOutcome !== draftOutcome) return false;
  const evidenceTally = voteTally(candidate.excerpt);
  return evidenceTally ? voteTally(draftText) === evidenceTally : true;
}

function strongDirectMatchLength(candidate: CandidateCitation, draftText: string): number {
  const longestRun = (source: string[], draft: string[]): number => {
    let longest = 0;
    for (let start = 0; start < source.length; start += 1) {
      for (let draftStart = 0; draftStart < draft.length; draftStart += 1) {
        let matched = 0;
        while (start + matched < source.length && draftStart + matched < draft.length && source[start + matched] === draft[draftStart + matched]) matched += 1;
        longest = Math.max(longest, matched);
      }
    }
    return longest;
  };
  const meaningfulRun = longestRun(meaningfulWords(candidate.excerpt), meaningfulWords(draftText));
  const rawSource = candidate.excerpt.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const rawDraft = draftText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const exactRun = longestRun(rawSource, rawDraft);
  // A verbatim phrase containing stopwords can still be conclusive, but require
  // five contiguous words; semantic matching alone must offer three strong words.
  if (exactRun >= 5) return exactRun;
  // Shared topic words scattered across paragraphs are not a direct citation.
  return meaningfulRun >= 3 ? meaningfulRun : 0;
}

function docketIdentifiers(text: string): string[] {
  const identifiers: string[] = [];
  const expression = /\b(?:ordinance|ord\.?|resolution|bill)\s+(?:(?:um|uh|no\.?)\s+)*((?:o\s*)?20\d{2}\s*[-–]?\s*\d{1,3})\b/gi;
  for (const match of text.matchAll(expression)) {
    const normalized = match[1]!.replace(/^o\s*/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (normalized) identifiers.push(normalized);
  }
  return [...new Set(identifiers)];
}

function nextDocketBoundary(input: {
  candidates: CandidateCitation[];
  earliestAnchorIndex: number;
  headline: string;
  dek: string;
  body: string;
}): number | null {
  // Prefer the docket named in the headline/dek, then the first docket named in
  // the story. If the story omits it, infer the target from the earliest visible
  // focused passage that names a docket. Never guess from a later agenda item.
  const target = docketIdentifiers(`${input.headline}\n${input.dek}`)[0]
    ?? docketIdentifiers(input.body)[0]
    ?? input.candidates
      .filter((candidate) => candidate.segmentIndex >= input.earliestAnchorIndex)
      .sort((a, b) => a.segmentIndex - b.segmentIndex)
      .flatMap((candidate) => docketIdentifiers(candidate.excerpt))[0];
  if (!target) return null;

  const ordered = [...input.candidates].sort((a, b) => a.segmentIndex - b.segmentIndex);
  const targetPassage = ordered.find((candidate) =>
    candidate.segmentIndex >= input.earliestAnchorIndex && docketIdentifiers(candidate.excerpt).includes(target),
  );
  if (!targetPassage) return null;

  const boundary = ordered.find((candidate) =>
    candidate.segmentIndex > targetPassage.segmentIndex &&
    docketIdentifiers(candidate.excerpt).some((identifier) => identifier !== target),
  );
  return boundary?.segmentIndex ?? null;
}

/**
 * Derive links only from transcript positions present in the writer's focused
 * packet. Caller-supplied focus/outcome anchors are gated by visibility and by
 * the draft asserting the claim/result. This is separate from broad-meeting
 * derivation used by older flows.
 */
export function deriveFocusedUsedCitations(input: FocusedCitationInput): { segmentIndex: number; captionSha256: string }[] {
  const visible = new Set(input.visibleSegmentIndexes.filter(Number.isInteger));
  const visibleCandidates = input.candidates.filter((candidate) => visible.has(candidate.segmentIndex));
  if (!visibleCandidates.length) return [];
  const visibleAnchors = input.anchorSegmentIndexes.filter((index) => visible.has(index));
  const earliestVisibleAnchor = visibleAnchors.length ? Math.min(...visibleAnchors) : Math.min(...visibleCandidates.map((candidate) => candidate.segmentIndex));
  const boundary = nextDocketBoundary({
    candidates: visibleCandidates,
    earliestAnchorIndex: earliestVisibleAnchor,
    headline: input.headline,
    dek: input.dek,
    body: input.body,
  });
  const eligible = visibleCandidates.filter((candidate) => boundary === null || candidate.segmentIndex < boundary);
  if (!eligible.length) return [];
  const text = [input.headline, input.dek, input.body].join("\n");
  const byIndex = new Map(eligible.map((candidate) => [candidate.segmentIndex, candidate]));
  const selected = new Map<number, CandidateCitation>();

  const assertedAnchorIndexes = new Set<number>();
  for (const index of new Set(input.anchorSegmentIndexes)) {
    const candidate = byIndex.get(index);
    if (candidate && anchorClaimAppears(candidate, text)) {
      selected.set(index, candidate);
      assertedAnchorIndexes.add(index);
    }
  }

  // Ordinary links must sit close to a validated focus/outcome anchor and in
  // the same agenda item. This stops broad, same-section fuzzy windows from
  // attributing minutes or procedural chatter to a later policy action.
  const anchorCandidates = [...assertedAnchorIndexes].map((index) => byIndex.get(index)!).filter(Boolean);
  const anchorItems = new Set(anchorCandidates.map((candidate) => candidate.item));
  const centerIndexes = [...assertedAnchorIndexes];
  const earliestAnchorIndex = Math.min(...centerIndexes);
  const localCandidates = eligible.filter((candidate) =>
    anchorItems.has(candidate.item) && candidate.segmentIndex >= earliestAnchorIndex - 2 && centerIndexes.some((index) => Math.abs(candidate.segmentIndex - index) <= 20),
  );
  const distantDirectCandidates = eligible.filter((candidate) =>
    anchorItems.has(candidate.item) && candidate.segmentIndex >= earliestAnchorIndex - 2 && strongDirectMatchLength(candidate, text) > 0,
  );
  const directIndexes = new Set([...localCandidates, ...distantDirectCandidates].filter((candidate) => citationWasUsed(candidate, text)).map((candidate) => candidate.segmentIndex));
  const usedIndexes = new Set(deriveUsedCitations({
    candidates: [...new Map([...localCandidates, ...distantDirectCandidates].map((candidate) => [candidate.segmentIndex, candidate])).values()],
    headline: input.headline,
    dek: input.dek,
    body: input.body,
  }).map((citation) => citation.segmentIndex));
  const regularCandidates = [...new Map([...localCandidates, ...distantDirectCandidates].map((candidate) => [candidate.segmentIndex, candidate])).values()];
  const regular = regularCandidates.filter((candidate) =>
    (usedIndexes.has(candidate.segmentIndex) || strongDirectMatchLength(candidate, text) > 0) && !assertedAnchorIndexes.has(candidate.segmentIndex),
  ).sort((a, b) => {
    const directA = strongDirectMatchLength(a, text);
    const directB = strongDirectMatchLength(b, text);
    if (directA !== directB) return directB - directA;
    const distanceA = Math.min(...centerIndexes.map((index) => Math.abs(a.segmentIndex - index)));
    const distanceB = Math.min(...centerIndexes.map((index) => Math.abs(b.segmentIndex - index)));
    return distanceA - distanceB || Number(directIndexes.has(b.segmentIndex)) - Number(directIndexes.has(a.segmentIndex)) || a.segmentIndex - b.segmentIndex;
  });
  const anchors = anchorCandidates.sort((a, b) =>
    Number(Boolean(voteOutcome(b.excerpt))) - Number(Boolean(voteOutcome(a.excerpt))) || a.segmentIndex - b.segmentIndex,
  );
  const bounded = [...anchors, ...regular].slice(0, 20);
  return bounded.sort((a, b) => a.segmentIndex - b.segmentIndex).map((candidate) => ({
    segmentIndex: candidate.segmentIndex,
    captionSha256: candidate.captionSha256,
  }));
}

