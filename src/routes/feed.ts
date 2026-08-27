import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { PAPER } from "@/lib/paper";
import { collapsePrintedDuplicates } from "@/lib/news/desk-copy";

export const Route = createFileRoute("/feed")({
  server: {
    handlers: {
      GET: async () => {
        const sql = await getSql();
        const rows = await sql<{
          slug: string;
          headline: string;
          dek: string;
          published_at: string;
        }>`
          select slug, headline, dek, published_at
          from articles
          where status = 'published'
          order by published_at desc
          limit 40
        `;
        const items = collapsePrintedDuplicates(rows)
          .map((r) => {
            const link = `/articles/${encodeURIComponent(r.slug)}`;
            return `<item>
  <title><![CDATA[${r.headline}]]></title>
  <link>${link}</link>
  <guid>${link}</guid>
  <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
  <description><![CDATA[${r.dek}]]></description>
</item>`;
          })
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${PAPER.name} — ${PAPER.location}</title>
  <description>${PAPER.tagline}</description>
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
