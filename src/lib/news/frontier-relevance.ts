const LOW_SIGNAL_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "city", "council", "does", "for", "from",
  "in", "into", "is", "it", "meeting", "not", "of", "on", "or", "posts", "regular", "session", "show",
  "the", "this", "to", "town", "upcoming", "video", "was", "were", "with",
]);

const OFF_TOPIC_REASON = "off-topic: no link to the subject or the town";

/**
 * The plain line the Dark Desk prints beside a saved trail item that does not
 * belong to the question. Added next to the item; the item itself is kept.
 *
 * The town is named because it is the one thing the editor can check at a
 * glance: a lead from another country cannot share it.
 */
export function offSubjectNote(town: string): string {
  const place = town.trim() || "this paper's town";
  return `Off subject: this does not mention ${place} or the question.`;
}

function relevanceWords(value: string): Set<string> {
  return new Set(
    value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu)?.filter(
      (word) => word.length > 1 && !LOW_SIGNAL_WORDS.has(word),
    ) ?? [],
  );
}

export function gateFrontierRelevance<T extends { label: string; why: string; status?: string; closed_reason?: string }>(
  item: T,
  context: { subject: string; town: string },
): T {
  const labelWords = relevanceWords(item.label);
  const whyWords = relevanceWords(item.why);
  const subjectWords = relevanceWords(context.subject);
  const townWords = relevanceWords(context.town);
  const contextWords = new Set([...subjectWords, ...townWords]);
  const compactTown = context.town.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
  const compactLabel = item.label.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
  const isUrl = /^https?:\/\//i.test(item.label);
  const labelMatchesContext = [...labelWords].some((word) => contextWords.has(word)) ||
    (compactTown.length > 1 && compactLabel.includes(compactTown));
  const whyMatchesSubject = [...whyWords].some((word) => subjectWords.has(word));
  const whyMatchesContext = [...whyWords].some((word) => contextWords.has(word));
  if (labelMatchesContext || (isUrl ? whyMatchesSubject : whyMatchesContext)) return item;
  return { ...item, status: "closed", closed_reason: OFF_TOPIC_REASON };
}

/**
 * The off-subject marker for one already-saved trail item, or null when the
 * item belongs to the question.
 *
 * Read-only: it runs the same gate as `gateFrontierRelevance` and reports the
 * verdict, so a saved trail can be labelled without changing a single row.
 * The item's own open/closed state is left alone -- a trail the paper already
 * keeps is the editor's record, not the desk's to rewrite.
 */
export function offSubjectMarkerFor(
  item: { label: string; why: string; status?: string; closed_reason?: string },
  context: { subject: string; town: string },
): string | null {
  const gated = gateFrontierRelevance(item, context);
  return gated.status === "closed" ? offSubjectNote(context.town) : null;
}
