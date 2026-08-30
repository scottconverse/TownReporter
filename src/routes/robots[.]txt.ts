import { createFileRoute } from "@tanstack/react-router";

/**
 * robots.txt, addressed to whoever is actually serving.
 *
 * This was a static file in `public/`, and its last line read
 * `Sitemap: https://townreporter.org/sitemap.xml`. Harmless on the paper it
 * was written for; wrong on every other copy. A gate audit filed it as QA-01:
 * a self-hoster in another town shipped a robots.txt telling search engines to
 * go and index somebody else's newspaper, and their own archive -- the whole
 * reason the sitemap exists -- was advertised nowhere at all.
 *
 * It is now a route for the same reason `sitemap.xml` is one: only the running
 * server knows its own address. `PUBLIC_SITE_URL` when set, otherwise the host
 * the request arrived on, which is right behind a tunnel or a proxy that sets
 * the forwarded headers.
 *
 * The rules themselves are unchanged, minus one: the newsletter confirmation
 * path was disallowed here long after the newsletter itself was removed. A
 * disallow for a route that does not exist is not dangerous, but it is a claim
 * about the product that stopped being true, and this file is read by people
 * as well as crawlers.
 */
function siteOrigin(request: Request): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = siteOrigin(request);
        const body = [
          `# TownReporter`,
          `#`,
          `# The paper is meant to be indexed. The desk is not: it is the editor's`,
          `# working area, and drafts, leads and reporting notes live behind sign-in.`,
          `# Blocking it here keeps unfinished work out of search results even if a`,
          `# link leaks.`,
          ``,
          `User-agent: *`,
          `Allow: /`,
          ``,
          `# Editor-only areas.`,
          `Disallow: /desk`,
          `Disallow: /desk/`,
          `Disallow: /login`,
          ``,
          `# Internals. Nothing here is a page.`,
          `Disallow: /api/`,
          `Disallow: /_serverFn/`,
          ``,
          `# Every published story, with its date. The front page lists only the`,
          `# newest, so without this the archive is reachable only by following links.`,
          `Sitemap: ${origin}/sitemap.xml`,
          ``,
        ].join(String.fromCharCode(10));

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            // Crawlers re-read this often; an hour is long enough to be polite
            // and short enough that changing the address is not a day-long wait.
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
