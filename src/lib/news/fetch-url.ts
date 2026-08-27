import { assertHttpUrl, isBlockedAddress, isIP, sha256 } from "./url-guard.ts";
import { htmlToPlainText } from "./html-text.ts";

export { assertHttpUrl, isBlockedAddress, sha256 } from "./url-guard.ts";

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = assertHttpUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new Error("That host is not fetchable");
  if (isIP(host)) return url;
  if (typeof window !== "undefined") {
    throw new Error("That host could not be resolved");
  }
  let records: { address: string }[];
  try {
    const { lookup } = await import("node:dns/promises");
    records = await lookup(host, { all: true });
  } catch {
    throw new Error("That host could not be resolved");
  }
  if (!records.length) throw new Error("That host could not be resolved");
  for (const r of records) {
    if (isBlockedAddress(r.address)) throw new Error("That host is not fetchable");
  }
  return url;
}

export type TrackedFetch = {
  response: Response;
  chain: string[];
  finalUrl: string;
};

export async function fetchPublicHttpTracked(url: URL, hops = 4): Promise<TrackedFetch> {
  const chain: string[] = [url.toString()];
  async function go(u: URL, left: number): Promise<Response> {
    await assertPublicHttpUrl(u.toString());
    const res = await fetch(u, {
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 TownReporter/1.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml,text/plain,application/pdf;q=0.8,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(10000),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (left <= 0) throw new Error("Too many redirects");
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect with no location");
      const next = new URL(loc, u);
      chain.push(next.toString());
      return go(next, left - 1);
    }
    return res;
  }
  const response = await go(url, hops);
  return { response, chain, finalUrl: chain[chain.length - 1]! };
}

export async function fetchPublicHttp(url: URL, hops = 4): Promise<Response> {
  const tracked = await fetchPublicHttpTracked(url, hops);
  return tracked.response;
}

function stripHtml(html: string) {
  return htmlToPlainText(html);
}

export async function fetchSourceText(
  rawUrl: string,
): Promise<{ text: string; titleHint: string }> {
  const url = await assertPublicHttpUrl(rawUrl);
  if (/youtube\.com|youtu\.be/i.test(url.hostname)) {
    const { ingestYoutube } = await import("./youtube.ts");
    const yt = await ingestYoutube(url);
    if (yt) return { text: yt.text, titleHint: yt.title };
  }

  const res = await fetchPublicHttp(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const ctype = res.headers.get("content-type") ?? "";
  if (/pdf|octet-stream|zip|image\//i.test(ctype)) {
    throw new Error(`Unsupported content type: ${ctype || "unknown"}`);
  }
  if (
    ctype &&
    !/text\/html|application\/xhtml|application\/xml|text\/plain|application\/json|text\/xml/i.test(
      ctype,
    )
  ) {
    throw new Error(`Unsupported content type: ${ctype}`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleHint = titleMatch ? stripHtml(titleMatch[1]).slice(0, 140) : url.hostname;
  let text = stripHtml(html).slice(0, 14000);
  if (typeof window === "undefined") {
    const { needsRenderedFetch, fetchRenderedPage } = await import("./render-fetch.ts");
    if (needsRenderedFetch(url, text, html)) {
      const rendered = await fetchRenderedPage(url.toString());
      if (rendered && rendered.text.length > Math.min(text.length, 400)) {
        return { text: rendered.text.slice(0, 14000), titleHint: rendered.title || titleHint };
      }
    }
  }
  if (text.length < 40) throw new Error("Page had almost no readable text");
  return { text, titleHint };
}
