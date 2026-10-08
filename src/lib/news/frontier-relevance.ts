const LOW_SIGNAL_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "city", "council", "does", "for", "from",
  "in", "into", "is", "it", "meeting", "not", "of", "on", "or", "posts", "regular", "session", "show",
  "the", "this", "to", "town", "upcoming", "video", "was", "were", "with",
]);

const OFF_TOPIC_REASON = "off-topic: no link to the subject or the town";

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
