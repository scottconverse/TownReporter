/** Presentation only: imported and stored evidence remains intact. */
export function darkStoredDates(text: string, timestamp: (iso: string) => string, day: (iso: string) => string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?\b/g,
    (iso) => (iso.includes("T") ? timestamp(iso) : day(`${iso}T12:00:00Z`)) || iso);
}

export function darkScreenText(text: string): string {
  return text
    .replace(/\b(?:(a|an)\s+)?(artifacts?|hops?)\b/gi, (_match, article: string | undefined, word: string) => {
      const replacement = /^artifact/i.test(word) ? "record" : "step";
      const plural = word.toLowerCase().endsWith("s") ? "s" : "";
      const prefix = article ? `${article[0] === "A" ? "A" : "a"} ` : "";
      return `${prefix}${replacement}${plural}`;
    })
    .replace(/\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|[kmb]\b))?/gi, "[amount omitted]")
    .replace(/\$/g, "");
}

/** Clone display data, preserving identifiers, links, state and saved JSON. */
export function darkScreenData<T>(value: T): T {
  if (value instanceof Date) return value;
  if (typeof value === "string") return darkScreenText(value) as T;
  if (Array.isArray(value)) return value.map((item) => darkScreenData(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    typeof item === "string"
      ? /(?:url|href|_json|_at|^id$|^kind$|^status$|model|effort|^scope$|^limit_key$)/i.test(key) ? item : darkScreenText(item)
      : darkScreenData(item),
  ])) as T;
}
