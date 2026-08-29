import { assertPublicHttpUrl, fetchPublicHttp, resolveFetch } from "./fetch-url.ts";
import { assertHttpUrl } from "./url-guard.ts";
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

/**
 * Exa's hosted MCP endpoint. No API key.
 *
 * First in the chain because it is the only provider measured to return the
 * primary document rather than something merely topical. On "CDOT CO 119 Hover
 * Street left turn closure" it returned CDOT's own project page; Bing returned
 * front.com and a dictionary entry for "front". On the council-minutes query it
 * returned the city clerk's agenda portal and the PrimeGov meeting pages —
 * exactly the records that story was about.
 *
 * It is built for semantic queries ("describe the ideal page, not keywords"),
 * which is how the research pass already writes its lanes.
 *
 * Scraped engines stay behind it: this is a third party seeing every query, and
 * its free tier has no documented ceiling, so the desk must still work when it
 * refuses.
 */
export const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

/** Exa returns `Title:` / `URL:` / `Highlights:` blocks separated by `---`. */
export function parseExaBlocks(text: string): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/^---$/m)) {
    const url = block.match(/^URL:\s*(\S+)\s*$/m)?.[1];
    if (!url) continue;
    try {
      assertHttpUrl(url);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const title = block.match(/^Title:\s*(.+?)\s*$/m)?.[1] ?? "";
    const highlights = block.split(/^Highlights:\s*$/m)[1] ?? "";
    hits.push({
      title: title || new URL(url).hostname,
      url,
      snippet: highlights.replace(/\.\.\./g, " ").replace(/\s+/g, " ").trim().slice(0, 400),
    });
    if (hits.length >= 8) break;
  }
  return hits;
}

/** Pull the tool payload out of an MCP server-sent-events response. */
export function readMcpSseText(raw: string): string | null {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const env = JSON.parse(line.slice(6)) as {
        result?: { isError?: boolean; content?: { type: string; text?: string }[] };
        error?: { message?: string };
      };
      if (env.error) return null;
      if (env.result?.isError) return null;
      const text = env.result?.content?.find((c) => c.type === "text")?.text;
      if (typeof text === "string") return text;
    } catch {
      /* not the data frame we want */
    }
  }
  return null;
}

async function searchExa(query: string): Promise<SearchAttempt> {
  const provider = "exa-mcp";
  try {
    const url = await assertPublicHttpUrl(EXA_MCP_URL);
    const doFetch = await resolveFetch();
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The endpoint answers as SSE; without this it may refuse.
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "web_search_exa", arguments: { query, numResults: 8 } },
      }),
      signal: AbortSignal.timeout(20_000),
    } as RequestInit);
    if (!res.ok) {
      return {
        state: res.status === 429 ? "SEARCH_BLOCKED" : "SEARCH_FAILED_PROVIDER",
        hits: [],
        provider,
        error: `HTTP ${res.status}`,
      };
    }
    const text = readMcpSseText(await res.text());
    if (text === null) {
      return { state: "SEARCH_FAILED_PARSE", hits: [], provider };
    }
    const hits = parseExaBlocks(text);
    return {
      state: hits.length ? "SEARCH_SUCCESS_RESULTS" : "SEARCH_SUCCESS_ZERO_RESULTS",
      hits,
      provider,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    return {
      state: /timeout|aborted/i.test(msg) ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
      hits: [],
      provider,
      error: msg,
    };
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

/**
 * Bing no longer links results directly. Every one is wrapped in a click
 * tracker — `https://www.bing.com/ck/a?…&u=a1<base64url>&…` — with the real
 * destination base64url-encoded in `u`, after a literal `a1` prefix.
 *
 * The parser discarded anything on `bing.com`, which after this change meant
 * every result on the page. Search returned zero for everything, silently, and
 * the desk lost the ability to find any document it was not handed. A draft
 * would ask for a board's referral resolution by name and then have no way to
 * look for it.
 */
export function unwrapBingRedirect(raw: string): string {
  if (!/bing\.com\/ck\/a/i.test(raw)) return raw;
  // The href arrives HTML-escaped, so `&amp;u=` has to become `&u=` first.
  const href = raw.replace(/&amp;/gi, "&");
  const enc = href.match(/[?&]u=a1([A-Za-z0-9_-]+)/)?.[1];
  if (!enc) return raw;
  try {
    const b64 = enc.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    return /^https?:\/\//i.test(decoded) ? decoded : raw;
  } catch {
    return raw;
  }
}

export function parseBingHtml(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const re = /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = unwrapBingRedirect(m[1]!);
    if (/bing\.com|microsoft\.com|msn\.com/i.test(url)) continue;
    if (seen.has(url)) continue;
    try {
      assertHttpUrl(url);
    } catch {
      continue;
    }
    seen.add(url);
    const title = m[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    hits.push({ title: title || url, url, snippet: "" });
    if (hits.length >= 8) break;
  }
  return hits;
}

export function parseBraveHtml(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*heading-serpresult[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = m[1]!;
    if (/brave\.com|search\.brave/i.test(url)) continue;
    if (seen.has(url)) continue;
    try {
      assertHttpUrl(url);
    } catch {
      continue;
    }
    seen.add(url);
    const title = m[2]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    hits.push({ title: title || url, url, snippet: "" });
    if (hits.length >= 8) break;
  }
  if (!hits.length) {
    const hrefs = html.matchAll(/href="(https?:\/\/[^"]+)"/gi);
    for (const h of hrefs) {
      const url = h[1]!;
      if (/brave\.com|javascript:|google\.com\/search/i.test(url)) continue;
      if (seen.has(url)) continue;
      try {
        assertHttpUrl(url);
      } catch {
        continue;
      }
      seen.add(url);
      hits.push({ title: url, url, snippet: "" });
      if (hits.length >= 8) break;
    }
  }
  return hits;
}

async function searchBing(query: string): Promise<SearchAttempt> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  try {
    const res = await fetchPublicHttp(url);
    const html = await res.text();
    const hits = parseBingHtml(html);
    const state = classifySearchHtml(res.status, html, hits.length);
    return { state, hits: state.startsWith("SEARCH_SUCCESS") ? hits : [], provider: "bing-html" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    const timeout = /timeout|aborted/i.test(msg);
    return {
      state: timeout ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
      hits: [],
      provider: "bing-html",
      error: msg,
    };
  }
}

async function searchBrave(query: string): Promise<SearchAttempt> {
  const url = new URL("https://search.brave.com/search");
  url.searchParams.set("q", query);
  try {
    const res = await fetchPublicHttp(url);
    const html = await res.text();
    const hits = parseBraveHtml(html);
    const state = classifySearchHtml(res.status, html, hits.length);
    return { state, hits: state.startsWith("SEARCH_SUCCESS") ? hits : [], provider: "brave-html" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network";
    const timeout = /timeout|aborted/i.test(msg);
    return {
      state: timeout ? "SEARCH_TIMEOUT" : "SEARCH_FAILED_NETWORK",
      hits: [],
      provider: "brave-html",
      error: msg,
    };
  }
}

/** DDG, then an independent index (Bing, Brave), then Wikipedia. A failure or zero is not "nothing exists." */
export async function searchWithFallback(query: string): Promise<SearchAttempt> {
  const q = query.trim().slice(0, 180);
  if (!q) return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "none", lineage: [] };
  const lineage: SearchAttempt[] = [];
  for (const fn of [searchExa, searchDdg, searchDdgLite, searchBing, searchBrave, searchWikipedia]) {
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
