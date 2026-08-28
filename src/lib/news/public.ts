import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import type { ArticleRow, CorrectionRow } from "./types.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { createHash, randomBytes } from "node:crypto";
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

/** Per-address ceiling per hour. Stops one address being hammered. */
export const SUBSCRIBE_PER_EMAIL_HOURLY = 5;
/**
 * Site-wide backstop per hour. Deliberately far above any real signup rate:
 * the old code capped at 40 and counted `subscribers` rows, so ~41 throwaway
 * addresses locked every genuine visitor out for an hour. A global limit can
 * only ever be a spam ceiling, never the primary control.
 */
export const SUBSCRIBE_GLOBAL_HOURLY = 300;

/** Attempts are keyed by hash — the rate table has no reason to hold addresses. */
function emailKey(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

export type SubscribeResult =
  | { ok: true; confirmPath: string }
  | { ok: false; error: string };

/**
 * The signup itself, callable without the server-function wrapper so it can be
 * tested directly (`createServerFn` handlers need the Start request context).
 */
export async function subscribeEmail(raw: string): Promise<SubscribeResult> {
  const email = raw.trim().toLowerCase();
  {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false as const, error: "That does not look like an email." };
    }
    const sql = await getSql();
    await sql.query(`
      alter table subscribers add column if not exists status text not null default 'pending'
    `);
    await sql.query(`
      alter table subscribers add column if not exists confirm_token text
    `);
    // Every attempt lands here, including repeats of an address that already
    // exists. Counting `subscribers` instead meant a re-subscribe took the
    // UPDATE branch, wrote no new row, and was never rate limited at all.
    await sql.query(`
      create table if not exists newsletter_attempts (
        id serial primary key,
        email_key text not null,
        created_at timestamptz not null default now()
      )
    `);
    await sql.query(`
      create index if not exists newsletter_attempts_recent_idx
        on newsletter_attempts (created_at desc)
    `);

    const key = emailKey(email);
    await sql`insert into newsletter_attempts (email_key) values (${key})`;

    const mine = await sql<{ c: number }>`
      select count(*)::int as c from newsletter_attempts
      where email_key = ${key} and created_at > now() - interval '1 hour'
    `;
    if ((mine[0]?.c ?? 0) > SUBSCRIBE_PER_EMAIL_HOURLY) {
      return { ok: false as const, error: "Too many signup attempts. Try later." };
    }
    const all = await sql<{ c: number }>`
      select count(*)::int as c from newsletter_attempts
      where created_at > now() - interval '1 hour'
    `;
    if ((all[0]?.c ?? 0) > SUBSCRIBE_GLOBAL_HOURLY) {
      return { ok: false as const, error: "Too many signup attempts. Try later." };
    }

    const token = randomBytes(24).toString("hex");
    const existing = await sql<{ id: number }>`
      select id from subscribers where email = ${email} limit 1
    `;
    if (existing[0]) {
      await sql`
        update subscribers set confirm_token = ${token}, status = 'pending'
        where id = ${existing[0].id}
      `;
    } else {
      await sql`
        insert into subscribers (email, status, confirm_token)
        values (${email}, 'pending', ${token})
      `;
    }
    // One response shape for every address. Returning `confirmPath: null` for
    // an already-confirmed subscriber turned this public form into a
    // "is this person subscribed?" oracle. Re-confirming is harmless, so an
    // existing subscriber simply gets a fresh link like anyone else.
    return { ok: true as const, confirmPath: `/newsletter/confirm?token=${token}` };
  }
}

export const subscribeNewsletter = createServerFn({ method: "POST" })
  .validator((email: string) => email.trim().toLowerCase())
  .handler(async ({ data: email }) => subscribeEmail(email));

export const confirmNewsletter = createServerFn({ method: "GET" })
  .validator((token: string) => token.trim())
  .handler(async ({ data: token }) => {
    if (token.length < 16) return { ok: false as const };
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      select id from subscribers where confirm_token = ${token} limit 1
    `;
    if (!rows[0]) return { ok: false as const };
    await sql`
      update subscribers set status = 'confirmed', confirm_token = null
      where id = ${rows[0].id}
    `;
    return { ok: true as const };
  });

