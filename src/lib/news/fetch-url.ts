import { assertHttpUrl, isBlockedAddress, isIP, sha256 } from "./url-guard.ts";
import { htmlToPlainText } from "./html-text.ts";

export { assertHttpUrl, isBlockedAddress, sha256, sha256Bytes } from "./url-guard.ts";

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

export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;

let fetchOverride: FetchLike | null = null;

/**
 * Test seam. Outbound requests go through undici's `fetch` (see
 * `resolveFetch`), so replacing `globalThis.fetch` no longer intercepts them —
 * a test that stubs the global would silently make real network calls instead.
 * Pass `null` to restore normal behaviour.
 */
export function setFetchImplForTests(impl: FetchLike | null) {
  fetchOverride = impl;
}

export class BlockedAddressError extends Error {
  constructor(address: string) {
    super(`That host is not fetchable (resolved to ${address})`);
    this.name = "BlockedAddressError";
  }
}

type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * `dns.lookup` with a private-range rejection welded on, for use as the
 * connector's own lookup.
 *
 * `assertPublicHttpUrl` resolves a hostname, checks the addresses, and then
 * hands the HOSTNAME to fetch — which resolves it a SECOND time. A hostile
 * authoritative server can answer those two lookups differently and land the
 * connection on a private address. That is DNS rebinding, and this desk is
 * exposed to it because the scan pipeline follows URLs the model extracted from
 * source text, unattended. Checking inside the connector removes the second
 * lookup: the address approved here is the address connected to.
 */
export async function guardedLookup(
  hostname: string,
  options: Record<string, unknown>,
  callback: LookupCb,
): Promise<void> {
  const spec = "node:dns";
  const dns = (await import(/* @vite-ignore */ spec)) as typeof import("node:dns");
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) {
      callback(err, address as string, family);
      return;
    }
    const list = Array.isArray(address)
      ? address
      : [{ address: address as string, family: family as number }];
    for (const entry of list) {
      if (isBlockedAddress(entry.address)) {
        callback(new BlockedAddressError(entry.address), "", undefined);
        return;
      }
    }
    callback(null, address as string, family);
  });
}

let guardedFetchImpl: FetchLike | null | undefined;

/**
 * A fetch that re-checks the resolved address at connect time.
 *
 * Uses **undici's** fetch, not the global one: Node bundles its own copy of
 * undici and rejects a dispatcher built from the standalone package (it fails
 * with `invalid onRequestStart method` rather than honouring the guard), so
 * both halves have to come from the same package.
 *
 * The specifier is a variable behind `@vite-ignore` — the same trick this
 * codebase uses for Playwright in `render-fetch.ts` — so undici is never traced
 * into the client bundle. `fetch-url` is reachable from client code, and a
 * `.server.ts` module is rejected outright by TanStack's import protection.
 */
async function buildGuardedFetch(): Promise<FetchLike | null> {
  try {
    const spec = "undici";
    const undici = (await import(/* @vite-ignore */ spec)) as typeof import("undici");
    const agent = new undici.Agent({
      connect: { lookup: guardedLookup as unknown as undefined },
      // Hops are re-validated one by one below; keep sockets short-lived so a
      // pooled connection cannot long outlive its DNS check.
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 30_000,
    });
    return async (url, init) =>
      (await undici.fetch(url, {
        ...(init as Record<string, unknown>),
        dispatcher: agent,
      } as Parameters<typeof undici.fetch>[1])) as unknown as Response;
  } catch {
    return null;
  }
}

/**
 * The guarded fetch, or plain `fetch` when it cannot be built — still guarded
 * by `assertPublicHttpUrl`, just without the rebinding protection.
 */
export async function resolveFetch(): Promise<FetchLike> {
  if (fetchOverride) return fetchOverride;
  if (typeof window !== "undefined") return (u, i) => fetch(u, i);
  if (guardedFetchImpl === undefined) guardedFetchImpl = await buildGuardedFetch();
  return guardedFetchImpl ?? ((u, i) => fetch(u, i));
}

export async function fetchPublicHttpTracked(url: URL, hops = 4): Promise<TrackedFetch> {
  const chain: string[] = [url.toString()];
  const doFetch = await resolveFetch();
  async function go(u: URL, left: number): Promise<Response> {
    await assertPublicHttpUrl(u.toString());
    const res = await doFetch(u, {
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
