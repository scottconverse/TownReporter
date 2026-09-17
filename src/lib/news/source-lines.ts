/**
 * Parsing for the watch list's "add sources" box.
 *
 * Pure text-in / rows-out, kept out of `desk.ts` so it can be tested without
 * the server-function machinery (and without `desk.ts`'s `@/lib/*` aliases,
 * which bare `node --test` cannot resolve).
 *
 * Tier is editorial, not cosmetic. It is what tells the model that an official
 * record may support publication while a newspaper story is only a lead to
 * corroborate — so a mis-parsed header quietly files a competitor's reporting
 * as publication-grade evidence.
 */
import { assertHttpUrl } from "./url-guard.ts";

export type ParsedSourceLine = {
  title: string;
  url: string;
  tier: string;
  kind: string;
};

export function parseHttpUrl(
  raw: string,
): { ok: true; url: string; host: string } | { ok: false; error: string } {
  let value = raw.trim();
  if (!value) return { ok: false, error: "Empty URL" };
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const parsed = assertHttpUrl(value);
    return { ok: true, url: parsed.toString(), host: parsed.hostname };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "That is not a valid URL." };
  }
}

export function parseSourceLines(text: string): ParsedSourceLine[] {
  let currentTier: "A" | "B" | "C" = "A";
  const out: ParsedSourceLine[] = [];
  const seen = new Set<string>();
  const urlRe = /https?:\/\/[^\s<>"'\\)\]]+/gi;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // A `TIER x` prefix sets the tier for everything after it. It also applies
    // to a URL on its OWN line — previously "TIER B https://..." kept the URL
    // but left it at Tier A and used "TIER B" as the title, so a news outlet
    // was silently filed as an official record. Wrong tier is an editorial
    // error, not a cosmetic one: Tier A may support publication outright.
    const header = line.match(/^TIER\s*([ABC])\b/i);
    if (header) {
      currentTier = header[1]!.toUpperCase() as "A" | "B" | "C";
      line = line.slice(header[0].length).replace(/^[\s:|—–-]+/, "").trim();
      if (!line) continue;
    }

    urlRe.lastIndex = 0;
    let found = line.match(urlRe);
    // The text as it appeared in the line, so the title can be stripped of it.
    let matchedText = found?.[0] ?? "";

    // Accept a bare hostname — `timescall.com`, `www.dailycamera.com/news`.
    // Pasting a domain without the scheme is how people normally write one
    // down, and silently dropping the line meant a source you believed you had
    // added was simply missing from the watch list.
    //
    // Deliberately strict. Every label must begin with a letter and the TLD is
    // letters only, so prose keeps failing: "see page 4.Section two" previously
    // became `https://4.section/`.
    if (!found?.length) {
      const bare = line.match(
        /(?:^|[\s|:])((?:[a-z][a-z0-9-]*\.)+[a-z]{2,24})(\/[^\s<>"']*)?(?=$|[\s,;]|$)/i,
      );
      if (bare) {
        matchedText = `${bare[1]}${bare[2] ?? ""}`;
        found = [`https://${matchedText}`];
      }
    }
    if (!found?.length) continue;

    const first = found[0]!.replace(/[.,;:]+$/, "");
    const parsed = parseHttpUrl(first);
    if (!parsed.ok) continue;
    if (seen.has(parsed.url)) continue;
    seen.add(parsed.url);

    const title = line
      .replace(urlRe, " ")
      // Also remove a bare hostname, or it stays in the title:
      // "Colorado Sun | coloradosun.com" kept the whole line as the name.
      .split(matchedText)
      .join(" ")
      .replace(/^[\s*•\-–—\d.)]+/, "")
      .replace(/\s*\([^)]*@[^)]*\)\s*/g, " ")
      .replace(/\s*[|:]\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/[:：]\s*$/, "");

    const kind = /youtube\.com|youtu\.be/i.test(parsed.url)
      ? "youtube"
      : currentTier === "B"
        ? "news"
        : currentTier === "C"
          ? "community"
          : "official";

    out.push({
      title: title || parsed.host,
      url: parsed.url,
      tier: currentTier,
      kind,
    });
  }
  return out.slice(0, 400);
}
