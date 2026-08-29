import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { DEFAULT_NEWSROOM_ID } from "@/lib/news/membership";

/**
 * A sitemap for the paper.
 *
 * `robots.txt` invites crawlers in and then leaves them to find the archive by
 * following links from the front page, which lists only the most recent
 * stories. Older stories were reachable only through the "also in the paper"
 * rail. This lists every published story explicitly, with its last change date,
 * so the archive is discoverable no matter how deep it gets.
 *
 * Only published articles and the handful of real reader-facing pages. The
 * desk, sign-in and the single-use newsletter link are excluded here for the
 * same reason `robots.txt` disallows them.
 */
function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Same rule as the feed: a relative URL in a sitemap resolves nowhere. */
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

const STATIC_PATHS = ["/", "/about", "/how-we-report", "/corrections"] as const;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = siteOrigin(request);
        let rows: { slug: string; published_at: string }[] = [];
        try {
          const sql = await getSql();
          rows = await sql<{ slug: string; published_at: string }>`
            select slug, published_at from articles
            where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
            order by published_at desc
            limit 5000
          `;
        } catch {
          // A sitemap that 500s tells a crawler the site is broken. An empty
          // one just says "nothing to add today".
          rows = [];
        }

        const entries = [
          ...STATIC_PATHS.map((p) => ({ loc: `${origin}${p}`, lastmod: "" })),
          ...rows.map((r) => ({
            loc: `${origin}/articles/${encodeURIComponent(r.slug)}`,
            lastmod: new Date(r.published_at).toISOString().slice(0, 10),
          })),
        ];

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${xmlEscape(e.loc)}</loc>${
        e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""
      }</url>`,
  )
  .join("\n")}
</urlset>
`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=600",
          },
        });
      },
    },
  },
});
