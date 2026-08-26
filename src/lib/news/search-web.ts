import { assertHttpUrl, fetchPublicHttp } from "./fetch-url.ts";
import { classifySearchHtml, type SearchState } from "./fetch-outcome.ts";

export type WebHit = { title: string; url: string; snippet: string };

export type SearchAttempt = {
  state: SearchState;
  hits: WebHit[];
  provider: string;
  error?: string;
  lineage?: SearchAttempt[];
};

export function parseDdgHtml(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const re =
    /uddg=([^&"]+)[^>]*>[\s\S]{0,40}?(?:class="result__a"[^>]*>)?([^<]{0,180})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let url = "";
    try {
      url = decodeURIComponent(m[1]!);
    } catch {
      continue;
    }
    const title = m[2]!.replace(/<[^>]+>/g, "").trim();
    if (!url.startsWith("http")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    hits.push({ title: title || url, url, snippet: "" });
    if (hits.length >= 8) break;
  }
  if (hits.length === 0) {
    const hrefs = html.matchAll(/href="(https?:\/\/[^"]+)"/gi);
    for (const h of hrefs) {
      const url = h[1]!;
      if (/duckduckgo\.com|javascript:/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      hits.push({ title: url, url, snippet: "" });
      if (hits.length >= 8) break;
    }
  }
  return hits.filter((h) => {
    try {
      assertHttpUrl(h.url);
      return true;
    } catch {
      return false;
    }
  });
}

export function parseWaybackCdx(raw: string): string[] {
  const out: string[] = [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return out;
    for (const row of data.slice(1, 8)) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const ts = String(row[1] ?? "");
      const original = String(row[2] ?? "");
      if (ts && original) out.push(`https://web.archive.org/web/${ts}/${original}`);
    }
  } catch {
    const lines = raw.split("\n").filter(Boolean);
    for (const line of lines.slice(0, 6)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) out.push(`https://web.archive.org/web/${parts[1]}/${parts[2]}`);
    }
  }
  return out.filter((u) => {
    try {
      assertHttpUrl(u);
      return true;
    } catch {
      return false;
    }
  });
}

export function parseWikipediaOpenSearch(raw: string): WebHit[] {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length < 4) return [];
    const titles = data[1] as unknown[];
    const snippets = data[2] as unknown[];
    const urls = data[3] as unknown[];
    const hits: WebHit[] = [];
    for (let i = 0; i < urls.length && hits.length < 8; i++) {
      const url = String(urls[i] ?? "");
      if (!url.startsWith("http")) continue;
      try {
        assertHttpUrl(url);
      } catch {
        continue;
      }
      hits.push({
        title: String(titles[i] ?? url),
        url,
        snippet: String(snippets[i] ?? ""),
      });
    }
    return hits;
  } catch {
    return [];
  }
}

async function searchDdg(query: string): Promise<SearchAttempt> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  try {
    const res = await fetchPublicHttp(url);
    const html = await res.text();
    const hits = parseDdgHtml(html);
    const state = classifySearchHtml(res.status, html, hits.length);
    return { state, hits: state.startsWith("SEARCH_SUCCESS") ? hits : [], provider: "ddg-html" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    const timeout = /timeout|aborted/i.test(msg);
    return {
      state: timeout ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
      hits: [],
      provider: "ddg-html",
      error: msg,
    };
  }
}

async function searchDdgLite(query: string): Promise<SearchAttempt> {
  const url = new URL("https://lite.duckduckgo.com/lite/");
  url.searchParams.set("q", query);
  try {
    const res = await fetchPublicHttp(url);
    const html = await res.text();
    const hits = parseDdgHtml(html);
    const state = classifySearchHtml(res.status, html, hits.length);
    return { state, hits: state.startsWith("SEARCH_SUCCESS") ? hits : [], provider: "ddg-lite" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    const timeout = /timeout|aborted/i.test(msg);
    return {
      state: timeout ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
      hits: [],
      provider: "ddg-lite",
      error: msg,
    };
  }
}

async function searchWikipedia(query: string): Promise<SearchAttempt> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("format", "json");
  try {
    const res = await fetchPublicHttp(url);
    if (!res.ok) {
      return {
        state: "SEARCH_FAILED_PROVIDER",
        hits: [],
        provider: "wikipedia",
        error: `HTTP ${res.status}`,
      };
    }
    const raw = await res.text();
    const hits = parseWikipediaOpenSearch(raw);
    if (hits.length) return { state: "SEARCH_SUCCESS_RESULTS", hits, provider: "wikipedia" };
    if (!raw.trim()) return { state: "SEARCH_FAILED_PARSE", hits: [], provider: "wikipedia" };
    return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "wikipedia" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    return { state: "SEARCH_FAILED_NETWORK", hits: [], provider: "wikipedia", error: msg };
  }
}

export function pickSearchResult(attempts: SearchAttempt[]): SearchAttempt {
  if (!attempts.length) {
    return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "none", lineage: [] };
  }
  const results = attempts.find((a) => a.state === "SEARCH_SUCCESS_RESULTS");
  if (results) return { ...results, lineage: attempts };
  const zero = attempts.find((a) => a.state === "SEARCH_SUCCESS_ZERO_RESULTS");
  if (zero) return { ...zero, lineage: attempts };
  return { ...attempts[attempts.length - 1]!, lineage: attempts };
}

/** DDG HTML, then DDG lite, then Wikipedia. Failures fall through. Zero on one provider still tries the next. */
export async function searchWithFallback(query: string): Promise<SearchAttempt> {
  const q = query.trim().slice(0, 180);
  if (!q) return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "none", lineage: [] };
  const lineage: SearchAttempt[] = [];
  for (const fn of [searchDdg, searchDdgLite, searchWikipedia]) {
    const attempt = await fn(q);
    lineage.push(attempt);
    if (attempt.state === "SEARCH_SUCCESS_RESULTS") return { ...attempt, lineage };
  }
  return pickSearchResult(lineage);
}

export async function webSearch(query: string): Promise<WebHit[]> {
  const attempt = await searchWithFallback(query);
  return attempt.hits;
}

export async function waybackCopies(target: string): Promise<string[]> {
  try {
    const api = new URL("https://web.archive.org/cdx/search/cdx");
    api.searchParams.set("url", target);
    api.searchParams.set("output", "json");
    api.searchParams.set("limit", "5");
    api.searchParams.set("filter", "statuscode:200");
    const res = await fetchPublicHttp(api);
    if (!res.ok) return [];
    return parseWaybackCdx(await res.text());
  } catch {
    return [];
  }
}
