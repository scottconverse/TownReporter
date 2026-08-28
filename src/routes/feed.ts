import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { PAPER } from "@/lib/paper";
import { collapsePrintedDuplicates } from "@/lib/news/desk-copy";
import { DEFAULT_NEWSROOM_ID } from "@/lib/news/membership";

/** XML text escape. Used for every value that is not inside CDATA. */
function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * CDATA has exactly one terminator, and editor-written text can contain it.
 * A raw `]]>` in a headline closes the section early and the whole feed stops
 * parsing — every subscriber sees an empty feed, not one broken item. Escaping
 * is simpler to reason about than splicing CDATA sections, so use it.
 */
function xmlText(value: string): string {
  return xmlEscape(value ?? "");
}

/**
 * RSS `<link>` and `<guid>` must be absolute URLs — a reader has no base to
 * resolve `/articles/slug` against, so relative links are dead links. Prefer an
 * explicitly configured origin; otherwise trust the proxy headers (Cloudflare
 * Tunnel and any reverse proxy set them), then the request URL.
 */
function siteOrigin(request: Request): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const Route = createFileRoute("/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = siteOrigin(request);
        let rows: {
          slug: string;
          headline: string;
          dek: string;
          published_at: string;
        }[] = [];
        try {
          const sql = await getSql();
          rows = await sql<{
            slug: string;
            headline: string;
            dek: string;
            published_at: string;
          }>`
            select slug, headline, dek, published_at
            from articles
            where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
            order by published_at desc
            limit 40
          `;
        } catch (err) {
          // Match the rest of the public surface (see lib/news/public.ts): a
          // database hiccup serves an empty feed, it does not 500 the route.
          console.error("[paper] feed failed", err);
          rows = [];
        }
        const items = collapsePrintedDuplicates(rows)
          .map((r) => {
            const link = `${origin}/articles/${encodeURIComponent(r.slug)}`;
            const at = new Date(r.published_at);
            const pubDate = Number.isNaN(at.getTime()) ? "" : at.toUTCString();
            return `<item>
  <title>${xmlText(r.headline)}</title>
  <link>${xmlEscape(link)}</link>
  <guid isPermaLink="true">${xmlEscape(link)}</guid>${pubDate ? `\n  <pubDate>${pubDate}</pubDate>` : ""}
  <description>${xmlText(r.dek)}</description>
</item>`;
          })
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlText(`${PAPER.name} — ${PAPER.location}`)}</title>
  <link>${xmlEscape(origin)}</link>
  <atom:link href="${xmlEscape(`${origin}/feed`)}" rel="self" type="application/rss+xml" />
  <description>${xmlText(PAPER.tagline)}</description>
  <language>en-us</language>
  ${items}
</channel>
</rss>`;
        return new Response(xml, {
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      },
    },
  },
});
