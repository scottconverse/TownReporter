import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import type { ArticleRow, CorrectionRow } from "./types";
import { unpackStoredDraft } from "./coerce-draft";
import { randomBytes } from "node:crypto";
import { parseUrlList } from "@/lib/paper";
import { provenanceFromUrls, parseFindings, resolvePublicFindings, type ProvenanceItem, type StoryFinding } from "./report";

function publicArticle(
  row: ArticleRow,
): ArticleRow & { provenance: ProvenanceItem[]; findings: StoryFinding[] } {
  const u = unpackStoredDraft({
    headline: row.headline,
    dek: row.dek,
    body: row.body,
    topic: row.topic,
  });
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
    const sql = await getSql();
    return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published'
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
  },
);

export const getPublishedArticle = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const sql = await getSql();
    const rows = await sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where slug = ${slug} and status = 'published'
      limit 1
    `;
    return rows[0] ? publicArticle(rows[0]) : null;
  });

export const listPublishedByTopic = createServerFn({ method: "GET" })
  .validator((topic: string) => topic)
  .handler(async ({ data: topic }) => {
    const sql = await getSql();
    return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published' and topic = ${topic}
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
  });

export const searchPublished = createServerFn({ method: "GET" })
  .validator((q: string) => q.trim().slice(0, 80))
  .handler(async ({ data: q }) => {
    if (!q) return [] as ArticleRow[];
    const sql = await getSql();
    const like = `%${q}%`;
    return sql<ArticleRow>`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at,
             provenance_json, form, found_note, unanswered
      from articles
      where status = 'published'
        and (headline ilike ${like} or dek ilike ${like} or body ilike ${like})
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
  });

export const listPublicCorrections = createServerFn({ method: "GET" }).handler(
  async () => {
    const sql = await getSql();
    return sql<CorrectionRow>`
      select c.id, c.body, c.created_at, a.headline
      from corrections c
      left join articles a on a.id = c.article_id
      order by c.created_at desc
      limit 50
    `;
  },
);

export const subscribeNewsletter = createServerFn({ method: "POST" })
  .validator((email: string) => email.trim().toLowerCase())
  .handler(async ({ data: email }) => {
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
    const hour = await sql<{ c: number }>`
      select count(*)::int as c from subscribers
      where created_at > now() - interval '1 hour'
    `;
    if ((hour[0]?.c ?? 0) > 40) {
      return { ok: false as const, error: "Too many signup attempts. Try later." };
    }
    const token = randomBytes(24).toString("hex");
    const existing = await sql<{ id: number; status: string }>`
      select id, coalesce(status, 'pending') as status from subscribers where email = ${email} limit 1
    `;
    if (existing[0]?.status === "confirmed") {
      return { ok: true as const, confirmPath: null as string | null };
    }
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
    return { ok: true as const, confirmPath: `/newsletter/confirm?token=${token}` };
  });

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

