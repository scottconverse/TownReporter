/** Keep fetched attachments in the bounded scan excerpt, with their own URLs.
 * This is discovery context, not a claim that the whole document was read. */
export function scanSourceExcerpt(
  text: string,
  extras: { url: string; text: string }[],
  maxChars: number,
): string {
  if (!extras.length) return text.slice(0, maxChars);
  const parts = [{ heading: "PAGE EXCERPT:\n", text }];
  const notice = "[Partial excerpts; read original documents before drafting.]\n";
  let headers = notice.length + parts[0]!.heading.length;
  for (const extra of extras.slice(0, 4)) {
    const heading = `\n\nDOCUMENT ${extra.url}\nEXCERPT:\n`;
    // Retain complete attribution and enough space for text in every part.
    if (headers + heading.length + (parts.length + 1) * 80 > maxChars) continue;
    parts.push({ heading, text: extra.text });
    headers += heading.length;
  }
  if (parts.length === 1) return text.slice(0, maxChars);
  let remaining = maxChars - headers;
  const sizes = parts.map(() => 0);
  // Short excerpts release their unused share to the longer page/documents.
  const order = parts
    .map((_, i) => i)
    .sort((a, b) => parts[a]!.text.length - parts[b]!.text.length);
  for (const [position, i] of order.entries()) {
    const take = Math.min(parts[i]!.text.length, Math.floor(remaining / (parts.length - position)));
    sizes[i] = take;
    remaining -= take;
  }
  return notice + parts.map((part, i) => part.heading + part.text.slice(0, sizes[i])).join("");
}
