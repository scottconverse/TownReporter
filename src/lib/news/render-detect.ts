const JS_HOST =
  /(^|\.)(municode\.com|ecode360\.com|amlegal\.com|qcode\.us|granicus\.com|granicusondemand\.com|legistar\.com|civicclerk\.com|boarddocs\.com|civicplus\.com|granicusideas\.com|primegov\.com)$/i;

export function hostNeedsRendering(url: URL): boolean {
  const host = url.hostname.replace(/^www\./i, "");
  return JS_HOST.test(host);
}

export function looksLikeAppShell(stripped: string, html = ""): boolean {
  const t = stripped.replace(/\s+/g, " ").trim();
  if (
    /internet explorer 9 and below|no longer supported\. please use a different browser|please enable javascript|javascript is required|this site requires javascript|this application requires javascript/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length < 400 && /id=["'](?:root|app|__next|municode|main-app)["']/i.test(html)) return true;
  if (t.length < 220 && /<script/i.test(html) && /react|angular|vue|next/i.test(html)) return true;
  return false;
}

/**
 * Dark Desk F2: `extractedLength`, when given, is the length of the
 * POST-extraction article text (see `article-extract.ts`), not the raw
 * tag-stripped page. A host on `JS_HOST` or showing an explicit
 * "enable javascript" shell still renders immediately (fast path, no
 * extraction needed to know). Everything else now ALSO renders when the
 * extracted article comes up empty/near-empty — this is what catches
 * non-allowlisted app-shell/CMS pages (e.g. a gov CMS or reddit) that strip
 * down to plenty of nav but little or no real article body, without
 * hardcoding any specific host here.
 */
export function needsRenderedFetch(
  url: URL,
  stripped: string,
  html = "",
  extractedLength?: number,
): boolean {
  if (hostNeedsRendering(url)) return true;
  if (looksLikeAppShell(stripped, html)) return true;
  if (extractedLength !== undefined && extractedLength < 40) return true;
  return false;
}
