/** Presentation only: imported and stored evidence remains intact. */
export function darkScreenText(text: string): string {
  return text
    .replace(/\bartifacts?\b/gi, (word) => word.toLowerCase().endsWith("s") ? "records" : "record")
    .replace(/\bhops?\b/gi, (word) => word.toLowerCase().endsWith("s") ? "steps" : "step")
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
