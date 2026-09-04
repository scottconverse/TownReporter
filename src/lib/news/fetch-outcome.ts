export type FetchOutcome =
  | "fetched"
  | "not-found"
  | "removed"
  | "redirected"
  | "fetch-failed"
  | "parse-failed"
  | "soft-404"
  | "changed"
  | "unchanged"
  | "needs-ocr";

const SOFT_404 = [
  "404 not found",
  "page not found",
  "the page you requested",
  "this page cannot be found",
  "doesn't exist",
  "does not exist",
  "no longer available",
  "has been removed",
  "file not found",
  "we couldn't find",
  "cannot find the page",
  "error 404",
  "not found |",
];

export function looksLikeSoft404(title: string, text: string): boolean {
  const blob = `${title}\n${text}`.toLowerCase();
  const hits = SOFT_404.filter((n) => blob.includes(n)).length;
  if (title.toLowerCase().includes("404")) return true;
  if (/\bnot found\b/i.test(title) && text.length < 4000) return true;
  if (hits >= 1 && text.length < 2800) return true;
  if (hits >= 2) return true;
  return false;
}

export function classifyHttpStatus(status: number): FetchOutcome | null {
  if (status === 404 || status === 410) return "not-found";
  if (status === 0) return "fetch-failed";
  if (status >= 300 && status < 400) return "redirected";
  if (status >= 400) return "fetch-failed";
  return null;
}

/**
 * Minimum characters of real article body below which a 200 response is
 * treated as a failed capture ("not the article"), not a successful one.
 */
export const MIN_ARTICLE_CHARS = 40;

/**
 * Dark Desk F2: `opts.text` MUST be the EXTRACTED article body (see
 * `article-extract.ts` / `ingestDocument`), never the raw tag-stripped page.
 * The `< MIN_ARTICLE_CHARS` floor below decides "capture failed — not the
 * article", so it has to see the article, not the site's chrome: a nav-only
 * page extracts to (near) nothing and is correctly failed here even though its
 * raw stripped HTML was thousands of chars of menu, while a page with a small
 * but real article extracts to that article and is correctly kept. Soft-404
 * phrasing that lives in nav/footer is caught upstream in `ingestDocumentRaw`,
 * which runs `looksLikeSoft404` against the whole-page strip before extraction;
 * the recheck here is a secondary net on the extracted body.
 *
 * `rawText`, when supplied, is that whole-page strip and is used ONLY to widen
 * soft-404 phrase detection — never to satisfy the emptiness floor.
 */
export function classifyFetchedPage(opts: {
  status: number;
  title: string;
  text: string;
  rawText?: string;
  priorHash?: string | null;
  priorStatus?: number | null;
  newHash?: string;
}): FetchOutcome {
  const http = classifyHttpStatus(opts.status);
  if (http === "not-found") {
    return opts.priorStatus === 200 || (opts.priorHash && opts.priorHash !== "missing")
      ? "removed"
      : "not-found";
  }
  if (http) return http;
  if (looksLikeSoft404(opts.title, opts.rawText ?? opts.text)) {
    return opts.priorStatus === 200 || (opts.priorHash && opts.priorHash !== "missing")
      ? "removed"
      : "soft-404";
  }
  if (opts.text.trim().length < MIN_ARTICLE_CHARS) return "parse-failed";
  if (opts.priorHash && opts.newHash && opts.priorHash === opts.newHash) return "unchanged";
  if (opts.priorHash && opts.priorHash !== "missing" && opts.newHash && opts.priorHash !== opts.newHash) {
    return "changed";
  }
  return "fetched";
}

export function canonicalPublicUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_|^fbclid$|^gclid$|^mc_cid$|^mc_eid$/i.test(k)) u.searchParams.delete(k);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

/**
 * Query params that select a scroll position or panel inside a document
 * *viewer* rather than a different document -- Dark Desk F4. Municode's
 * code-of-ordinances viewer is the live example: the same ordinance was
 * saved 7 ways because `?nodeId=12345` (and its variants) named a spot
 * inside the same page, not a different page. `canonicalPublicUrl` alone
 * keeps these, because it only strips known tracking params -- it has no
 * opinion about a site's own in-page navigation params.
 *
 * Deliberately narrow: only the params a real "document viewer" is known to
 * use for in-page navigation, never a generic heuristic that might delete a
 * param that actually changes the document. Extend this list only when a
 * specific site's viewer param is confirmed to be scroll/anchor-only.
 */
const VIEWER_NAV_PARAMS = /^nodeid$|^node$|^anchor$|^section$/i;

/**
 * `canonicalPublicUrl`, plus stripping document-viewer navigation params
 * (see `VIEWER_NAV_PARAMS`) so the same document opened at a different
 * scroll position collapses to one dedup key. Used for frontier-lead
 * dedup (`persistDiscovery` in investigate.ts), not for capture identity --
 * a capture still records the exact URL fetched.
 */
export function canonicalFrontierUrl(raw: string): string {
  const canon = canonicalPublicUrl(raw);
  const u = new URL(canon);
  for (const k of [...u.searchParams.keys()]) {
    if (VIEWER_NAV_PARAMS.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

export type SearchState =
  | "SEARCH_SUCCESS_RESULTS"
  | "SEARCH_SUCCESS_ZERO_RESULTS"
  | "SEARCH_FAILED_NETWORK"
  | "SEARCH_FAILED_PROVIDER"
  | "SEARCH_FAILED_PARSE"
  | "SEARCH_BLOCKED"
  | "SEARCH_TIMEOUT";

export function classifySearchHtml(status: number, html: string, parsedCount: number): SearchState {
  if (status === 0) return "SEARCH_FAILED_NETWORK";
  if (status === 408 || status === 504) return "SEARCH_TIMEOUT";
  if (status === 403 || status === 429) return "SEARCH_BLOCKED";
  if (status >= 500) return "SEARCH_FAILED_PROVIDER";
  if (status >= 400) return "SEARCH_FAILED_PROVIDER";
  const low = html.toLowerCase();
  if (
    /captcha|anomaly-modal|enable javascript|please verify you are|are you a robot|cdn-cgi\/challenge/.test(
      low,
    )
  ) {
    return "SEARCH_BLOCKED";
  }
  if (parsedCount > 0) return "SEARCH_SUCCESS_RESULTS";
  if (html.trim().length < 40) return "SEARCH_FAILED_PARSE";
  if (/no results|did not match|0 results/.test(low)) return "SEARCH_SUCCESS_ZERO_RESULTS";
  if (html.length > 500 && parsedCount === 0) return "SEARCH_FAILED_PARSE";
  return "SEARCH_SUCCESS_ZERO_RESULTS";
}
