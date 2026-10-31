const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Decode the entities a calendar or event feed can reasonably put in text. */
export function decodeEventEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Feed text made safe for a reader: entities decoded, markup removed, whitespace flattened. */
export function plainEventText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const plain = decodeEventEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\uFFFD+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return plain || null;
}

/** A short, plain event description suitable for the front page's two-line slot. */
export function cleanEventDescription(value: unknown, maxLength = 600): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = decodeEventEntities(value)
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\uFFFD+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:description|details?|about(?: the event)?)\s*[:–—-]\s*/i, "")
    .replace(/^[\s|•·:;,\-–—_]+|[\s|•·:;,\-–—_]+$/gu, "")
    .trim();
  if (!text || text.length <= maxLength) return text;
  const limit = Math.max(1, maxLength - 1);
  const cut = text.slice(0, limit);
  const boundary = cut.search(/\s+\S*$/u);
  const body = (boundary >= Math.floor(limit / 2) ? cut.slice(0, boundary) : cut).trimEnd();
  return `${body}…`;
}

/** A source-supplied http(s) address, normalized for comparison and rendering. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Decode a captured event source. Some calendar publishers still serve
 * Windows-1252; decoding those bytes as UTF-8 turns accented letters into U+FFFD.
 */
export function decodeRoutineSourceBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
