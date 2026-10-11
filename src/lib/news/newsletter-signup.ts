import { parseHTML } from "linkedom";
import { isHttpUrl } from "./newsletter-core.ts";

/** Inspect the webpage already fetched by a scan; never fetch or submit a signup link. */
export function detectedNewsletterSignup(html: string, pageUrl: string): string | undefined {
  const { document } = parseHTML(html);
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const label = anchor.textContent ?? "";
    if (!/newsletter|subscribe|sign[ -]?up/i.test(label) || /unsub|opt.?out/i.test(label)) continue;
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", pageUrl).toString();
      if (isHttpUrl(url)) return url;
    } catch { /* Malformed signup links are ignored. */ }
  }
  return undefined;
}
