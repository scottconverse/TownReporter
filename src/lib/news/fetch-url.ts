import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isBlockedAddress(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (raw.startsWith("::ffff:") && raw.includes(".")) {
    return isBlockedAddress(raw.slice(raw.lastIndexOf(":") + 1));
  }
  if (raw.includes(".")) {
    const p = raw.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (raw === "::1" || raw === "::" || raw === "0:0:0:0:0:0:0:1") return true;
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
  if (raw.startsWith("fe80")) return true;
  if (raw.startsWith("ff")) return true;
  return false;
}

export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) {
    throw new Error("That host is not fetchable");
  }
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    throw new Error("That host is not fetchable");
  }
  return url;
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = assertHttpUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("That host is not fetchable");
    return url;
  }
  let records: { address: string }[];
  try {
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
          "TownReporter/1.0 (+https://grok.me; civic newspaper source fetch)",
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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "\u0026")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && !id.startsWith("@") ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    return url.searchParams.get("v");
  }
  return null;
}

function isYoutubeChannel(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "youtube.com" && host !== "m.youtube.com") return false;
  const p = url.pathname;
  return (
    p.startsWith("/@") ||
    p.startsWith("/channel/") ||
    p.startsWith("/c/") ||
    p.startsWith("/user/") ||
    p.endsWith("/videos") ||
    p.endsWith("/streams")
  );
}

async function fetchYoutubeCaptions(videoId: string): Promise<string | null> {
  const timed = new URL("https://www.youtube.com/api/timedtext");
  timed.searchParams.set("v", videoId);
  timed.searchParams.set("lang", "en");
  timed.searchParams.set("fmt", "srv3");
  const res = await fetchPublicHttp(timed);
  if (!res.ok) return null;
  const xml = await res.text();
  const text = stripHtml(xml);
  return text.length > 40 ? text : null;
}

export async function fetchSourceText(
  rawUrl: string,
): Promise<{ text: string; titleHint: string }> {
  const url = await assertPublicHttpUrl(rawUrl);
  const videoId = youtubeVideoId(url);
  if (videoId) {
    const captions = await fetchYoutubeCaptions(videoId);
    if (captions) {
      return {
        text: `YouTube captions (auto or manual; verify quotes against the video).\nVideo ${videoId}\n\n${captions}`,
        titleHint: `YouTube ${videoId}`,
      };
    }
  }
  if (isYoutubeChannel(url)) {
    const res = await fetchPublicHttp(url);
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleHint = titleMatch ? stripHtml(titleMatch[1]).slice(0, 140) : url.hostname;
    const text = stripHtml(html).slice(0, 14000);
    return {
      text: `YouTube channel/listing URL — not a single video. Captions need a watch URL with v=. Do not treat this as a transcript.\n\n${text}`,
      titleHint,
    };
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
  const text = stripHtml(html).slice(0, 14000);
  if (text.length < 40) throw new Error("Page had almost no readable text");
  return { text, titleHint };
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
