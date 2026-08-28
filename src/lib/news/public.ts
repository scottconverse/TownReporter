import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import type { ArticleRow, CorrectionRow } from "./types";
import { unpackStoredDraft } from "./coerce-draft";
import { stripReporterNotebook } from "./strip-draft";
import { parseUrlList } from "@/lib/paper";
import { provenanceFromUrls, parseFindings, resolvePublicFindings, type ProvenanceItem, type StoryFinding } from "./findings";
import { collapsePrintedDuplicates } from "./desk-copy";
import { DEFAULT_NEWSROOM_ID } from "./membership";

function publicArticle(
  row: ArticleRow,
): ArticleRow & { provenance: ProvenanceItem[]; findings: StoryFinding[] } {
  const u = unpackStoredDraft({
    headline: row.headline,
    dek: row.dek,
    body: row.body,
    topic: row.topic,
  });
  u.body = stripReporterNotebook(u.body);
  let provenance: ProvenanceItem[] = [];
  try {
    const stored = JSON.parse(row.provenance_json || "[]") as ProvenanceItem[];
    if (Array.isArray(stored) && stored.length) provenance = stored;
  } catch {
    provenance = [];
  }
  if (!provenance.length) provenance = provenanceFromUrls(parseUrlList(row.source_urls));
  const findings = resolvePublicFindings(parseFindings(row.found_note), provenance);
  return { ...row, ...u, provenance, findings };
}

export const listPublishedArticles = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const sql = await getSql();
      return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
      order by published_at desc
      limit 30
    `.then((rows) => collapsePrintedDuplicates(rows.map(publicArticle)));
    } catch (err) {
      console.error("[paper] listPublishedArticles failed", err);
      return [] as ArticleRow[];
    }
  },
);

export const getPublishedArticle = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    try {
      const sql = await getSql();
      const rows = await sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where slug = ${slug} and status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
      limit 1
    `;
      if (!rows[0]) return null;
      const article = publicArticle(rows[0]);
      const corrs = await sql<{ body: string; created_at: string }>`
        select body, created_at from corrections
        where article_id = ${rows[0].id}
        order by created_at asc
      `;
      return {
        ...article,
        corrections: corrs.map((c) => ({ date: c.created_at, body: c.body })),
      };
    } catch (err) {
      console.error("[paper] getPublishedArticle failed", err);
      return null;
    }
  });

export const listPublishedByTopic = createServerFn({ method: "GET" })
  .validator((topic: string) => topic)
  .handler(async ({ data: topic }) => {
    try {
      const sql = await getSql();
      return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID} and topic = ${topic}
      order by published_at desc
      limit 30
    `.then((rows) => collapsePrintedDuplicates(rows.map(publicArticle)));
    } catch (err) {
      console.error("[paper] listPublishedByTopic failed", err);
      return [] as ArticleRow[];
    }
  });

export const searchPublished = createServerFn({ method: "GET" })
  .validator((q: string) => q.trim().slice(0, 80))
  .handler(async ({ data: q }) => {
    if (!q) return [] as ArticleRow[];
    try {
      const sql = await getSql();
      const like = `%${q}%`;
      return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
        and (headline ilike ${like} or dek ilike ${like} or body ilike ${like})
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
    } catch (err) {
      console.error("[paper] searchPublished failed", err);
      return [] as ArticleRow[];
    }
  });

export const listPublicCorrections = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const sql = await getSql();
      return sql<CorrectionRow & { slug: string | null }>`
      select c.id, c.body, c.created_at, a.headline, a.slug
      from corrections c
      left join articles a on a.id = c.article_id
      where c.newsroom_id = ${DEFAULT_NEWSROOM_ID}
         or a.newsroom_id = ${DEFAULT_NEWSROOM_ID}
      order by c.created_at desc
      limit 50
    `;
    } catch (err) {
      console.error("[paper] listPublicCorrections failed", err);
      return [] as CorrectionRow[];
    }
  },
);
