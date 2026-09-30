import { createServerFn } from "@tanstack/react-start";
import { resolveSectionKey } from "./sections.server.ts";
import { getSql } from "../db.ts";
import type { ArticleRow, CorrectionRow } from "./types.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { parseUrlList } from "../paper.ts";
import { provenanceFromUrls, parseFindings, resolvePublicFindings, type ProvenanceItem, type StoryFinding } from "./findings.ts";
import { collapsePrintedDuplicates } from "./desk-copy.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { isOnboarded } from "./paper-settings.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { markRemovedCaptures, removedCapturesFor } from "./evidence.ts";
import { publicSlug, publicTopic } from "./request-input.ts";

function samePublicUrl(left: string, right: string): boolean {
  try { return canonicalPublicUrl(left) === canonicalPublicUrl(right); }
  catch { return false; }
}

/**
 * `publicArticle`, with the takedown state of every capture the story cites
 * joined in from the database (unit U11b2).
 *
 * WHY THIS IS SEPARATE FROM `publicArticle`. That function is pure -- it takes
 * a row and returns what a reader may see of it -- and it is used by the feed
 * and the topic lists as well as by the story page. The takedown flags,
 * though, cannot live in the row: `articles.provenance_json` is written when
 * the story is filed, and a takedown happens months later, so a stored copy of
 * the flags would be stale by definition. This function is the one read path
 * that joins them, and it exists as its own exported name so the join can be
 * proved against a database (see the real-Postgres proof) rather than trusted
 * because a route calls it.
 *
 * A story served with a capture whose link was removed therefore carries
 * `excerpt_removed_link_kept: false` on that provenance row, and
 * `ProvenanceBlock` renders the source as text instead of a link.
 */
export async function publicArticleForReaders<T extends ArticleRow>(
  row: T,
): Promise<T & { provenance: ProvenanceItem[]; findings: StoryFinding[] }> {
  const article = publicArticle(row);
  const removed = await removedCapturesFor(article.provenance.map((item) => item.version_id));
  const provenance = markRemovedCaptures(article.provenance, removed);
  return { ...article, provenance, provenance_json: JSON.stringify(provenance) };
}

/* Generic in the row so a caller that already selected extra columns (the
   routine-notice marker on getPublishedArticle) keeps them in the type. */
export function publicArticle<T extends ArticleRow>(
  row: T,
): T & { provenance: ProvenanceItem[]; findings: StoryFinding[] } {
  const u = unpackStoredDraft({
    headline: row.headline,
    dek: row.dek,
    body: row.body,
    topic: row.topic,
  });
  u.body = stripReporterNotebook(u.body);
  const publicUrls = parseUrlList(row.source_urls);
  let provenance: ProvenanceItem[] = [];
  try {
    const stored = JSON.parse(row.provenance_json || "[]") as ProvenanceItem[];
    if (Array.isArray(stored) && stored.length) {
      /*
        A row with no URL is a record the report NAMED and did not link.

        A pasted report cites "September 22 budget packet (Attachment G)" the
        way an editor writes in their notes -- by naming it -- so
        `provenanceFromCitations` files it with an empty `url` and no page to
        open. Matching those against `source_urls` dropped every one of them
        (an empty string is in no list), so a story that cited three documents
        and linked none printed "No separate public source records are
        attached to this story" -- over the very records the desk had
        recorded, and with `ProvenanceBlock`'s branch for a row with no page
        to open left as unreachable code.

        The fence is unchanged for rows that DO carry a URL: a provenance row
        the published edition does not cite stays private, which is what keeps
        another newsroom's corroboration off the page.
      */
      provenance = stored.filter(item =>
        item.url ? publicUrls.some(url => samePublicUrl(url, item.url)) : true,
      );
    }
  } catch {
    provenance = [];
  }
  if (!provenance.length) provenance = provenanceFromUrls(publicUrls);
  const findings = resolvePublicFindings(parseFindings(row.found_note), provenance);
  return {
    ...row,
    ...u,
    provenance_json: JSON.stringify(provenance),
    found_note: JSON.stringify(findings),
    provenance,
    findings,
  };
}

export const listPublishedArticles = createServerFn({ method: "GET" }).handler(
  async () => {
    // CITY-SETUP release-walkthrough Blocker fix: before first-run setup
    // completes, nothing published is public -- including the
    // migration-seeded Longmont welcome article (migrations/0002_newsroom.sql),
    // which used to render on a fresh install's front page.
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return [] as ArticleRow[];
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
  .validator((slug: string) => publicSlug.parse(slug))
  .handler(async ({ data: slug }) => {
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return null;
    try {
      const sql = await getSql();
      const rows = await sql<ArticleRow & { routine_notice: boolean }>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered, disclosure_text,
             /* Whether a fixed-template routine notice printed this row. The
                reader-facing disclosure line depends on it, and it cannot be
                inferred from the article's own columns: a routine notice is
                published with the same form as a reported story. */
             exists(
               select 1 from routine_notice_publications r
               where r.article_id = articles.id and r.newsroom_id = articles.newsroom_id
             ) as routine_notice
      from articles
      where slug = ${slug} and status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
      limit 1
    `;
      if (!rows[0]) return null;
      /*
        Unit U11b2: `publicArticleForReaders` marks the cited captures whose
        excerpt has been taken down, so "Current source" stops being a link
        when the link was removed with it and the captured-version link says
        what it opens. See that function for why the flags are joined here
        rather than stored in `provenance_json`.
      */
      const article = await publicArticleForReaders(rows[0]);
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
  .validator((topic: string) => publicTopic.parse(topic))
  .handler(async ({ data: topic }) => {
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return [] as ArticleRow[];
    try {
      topic = await resolveSectionKey(DEFAULT_NEWSROOM_ID, topic);
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

/**
 * The shortest query a trigram index can answer.
 *
 * pg_trgm builds three-character grams, so a one or two character pattern has
 * no gram to look up and the planner falls back to reading every row. Below
 * this length the search stays off the bodies and touches only the two short
 * columns, which bounds the work a stranger can ask for.
 */
export const SEARCH_MIN_INDEXED = 3;

export const searchPublished = createServerFn({ method: "GET" })
  .validator((q: string) => q.trim().slice(0, 80))
  .handler(async ({ data: q }) => {
    if (!q) return [] as ArticleRow[];
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return [] as ArticleRow[];
    try {
      const sql = await getSql();
      const like = `%${q}%`;
      /*
        ENG-008: this was an unindexed `ilike '%q%'` across every published
        body, reachable by anyone with no session and no rate limit -- one
        cheap request, one full read of the archive. Measured at 20,000
        stories: 220 ms and 666 buffers per request.

        Migration 0018 adds GIN trigram indexes on the three columns, which
        keeps substring matching exactly as it was and makes it a lookup: the
        same query is 0.1 ms and 34 buffers. `npm run proof:search` re-runs
        that measurement from scratch.

        Two characters or fewer cannot use those indexes at all, so a query
        that short is answered from the headline and dek only.
      */
      const wide = q.length >= SEARCH_MIN_INDEXED;
      return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published' and newsroom_id = ${DEFAULT_NEWSROOM_ID}
        and (headline ilike ${like} or dek ilike ${like}
             or (${wide} and body ilike ${like}))
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
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return [] as CorrectionRow[];
    try {
      const sql = await getSql();
      return sql<CorrectionRow & { slug: string | null }>`
      -- inner join, not left: a correction whose article is gone must not
      -- print. Deleting a story used to leave its correction detached and
      -- publicly visible under a null headline (ENG-005). The delete order is
      -- fixed, and this refuses to serve any orphan that predates the fix.
      select c.id, c.body, c.created_at, a.headline, a.slug
      from corrections c
      join articles a on a.id = c.article_id
      where a.status = 'published' and a.newsroom_id = ${DEFAULT_NEWSROOM_ID}
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
