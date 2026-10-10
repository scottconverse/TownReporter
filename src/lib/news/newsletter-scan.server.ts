import { getSql, type Sql } from "../db.ts";

export const NEWSLETTER_SYNTHETIC_HOST = "newsletters.townreporter.invalid";
export type NewsletterScanDoc = { id: number; url: string; text: string; title: string; extras: { url: string; text: string }[] };

export function isNewsletterUrl(url: string): boolean {
  try { return new URL(url).hostname === NEWSLETTER_SYNTHETIC_HOST; } catch { return false; }
}

/** Unread captures remain queued until a successful scan batch commits. */
export async function newsletterScanDocs(newsroomId: number, sourceId: number, limit = 6, sqlInput?: Sql): Promise<NewsletterScanDoc[]> {
  const sql = sqlInput ?? await getSql();
  const rows = await sql<{ id: number; url: string; title: string; full_text: string }>`
    select m.id,av.url,av.title,av.full_text from newsletter_messages m
    join artifact_versions av on av.id=m.version_id and av.newsroom_id=m.newsroom_id
    where m.newsroom_id=${newsroomId} and m.source_id=${sourceId} and m.scanned_at is null
      and av.taken_down_at is null and length(trim(av.full_text)) > 0
    order by m.created_at,m.id limit ${limit}`;
  const docs: NewsletterScanDoc[] = [];
  for (const row of rows) {
    const attachments = await sql<{ url: string; full_text: string }>`select av.url,av.full_text
      from newsletter_attachments a join artifact_versions av on av.id=a.version_id and av.newsroom_id=a.newsroom_id
      where a.newsroom_id=${newsroomId} and a.message_id=${row.id} and av.taken_down_at is null
      order by a.id`;
    docs.push({ id: row.id, url: row.url, title: row.title, text: row.full_text,
      extras: attachments.map(a => ({ url: a.url, text: a.full_text })) });
  }
  return docs;
}

/** Synthetic citations resolve only in the caller's newsroom, without a network request. */
export async function retainedNewsletterDocument(url: string, newsroomId: number, sqlInput?: Sql) {
  if (!isNewsletterUrl(url)) return null;
  const sql = sqlInput ?? await getSql();
  const [row] = await sql<{ title: string; full_text: string; extraction_method: string }>`
    select title,full_text,extraction_method from artifact_versions
    where newsroom_id=${newsroomId} and url=${url} and taken_down_at is null
    order by captured_at desc,id desc limit 1`;
  return row ? { title: row.title, text: row.full_text, extractionMethod: row.extraction_method } : null;
}

export async function markNewsletterDocsScanned(sql: Sql, newsroomId: number, ids: number[]) {
  if (!ids.length) return;
  await sql`update newsletter_messages set scanned_at=now() where newsroom_id=${newsroomId}
    and id=any(${ids}::int[]) and scanned_at is null`;
}
