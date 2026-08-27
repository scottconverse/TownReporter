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

export function needsRenderedFetch(url: URL, stripped: string, html = ""): boolean {
  if (hostNeedsRendering(url)) return true;
  return looksLikeAppShell(stripped, html);
}
