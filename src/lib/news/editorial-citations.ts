/** Machine citation markers are not source links the reader can open. */
export function stripEditorialCitations(text: string): string {
  return text.replace(
    /:chatgpt-content-reference\{[^}]*\}|(?::contentReference)?\[oaicite:[^\]]*\](?:\{[^}]*\})?|(?:cite|citeturn)[^]*|\[citeturn[^\]]*\]|\bciteturn\d+[a-z]*\d*\b/g,
    "",
  );
}
export function editorialCitationNotice(text: string): string | null {
  return stripEditorialCitations(text) === text
    ? null
    : "Source links were removed from this paste. Re-add the source links before publishing.";
}
