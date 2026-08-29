import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import type { ArticleRow, CorrectionRow } from "./types.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { parseUrlList } from "../paper.ts";
import { provenanceFromUrls, parseFindings, resolvePublicFindings, type ProvenanceItem, type StoryFinding } from "./findings.ts";
import { collapsePrintedDuplicates } from "./desk-copy.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";

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
      order by c.created_at desc
      limit 50
    `;
    } catch (err) {
      console.error("[paper] listPublicCorrections failed", err);
      return [] as CorrectionRow[];
    }
  },
);

/*
  The newsletter lived here and is gone.

  It was dormant — no signup form anywhere in the paper — but the server
  function was still compiled and reachable, and an outside audit found three
  problems with it at once. It ran ALTER TABLE and CREATE TABLE on every call
  instead of in a migration. It inserted a rate-limit row before checking the
  ceiling, so rejected requests still wrote forever with no retention. And it
  returned the fresh confirmation token straight to the unauthenticated caller,
  which meant anyone could confirm anyone else's address without ever holding
  that mailbox.

  It also broke the documented development path. These functions were the only
  reason `node:crypto` was imported into this module, and this module is
  imported by `/`, `/articles/$slug` and `/corrections` — so Node crypto landed
  in the browser bundle and `npm run dev` died on hydration before a new
  operator could reach the sign-in form at all.

  If a newsletter is ever wanted: schema in a migration, the confirmation link
  sent to the mailbox and never returned to the caller, the rate-limit check
  before the write, and a consent record.

  Audit findings ENG-007 (Major), UIUX-01 / QA-001 (Blocker).
*/
