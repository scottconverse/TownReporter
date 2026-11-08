import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../db.ts";
import { parseUrlList } from "../paper.ts";
import { deskMiddleware } from "./desk-auth.ts";

function room(context: { newsroomId?: number }): number {
  if (context.newsroomId === undefined) {
    throw new Error("No newsroom.");
  }
  return context.newsroomId;
}

export type WaitingRoundup = {
  id: number;
  slug: string;
  headline: string;
  channel: "today" | "weekend" | "deadlines";
  issueDate: string;
  createdAt: string;
};

type WaitingRoundupRow = {
  id: number;
  slug: string;
  headline: string;
  channel: "today" | "weekend" | "deadlines";
  issue_date: string;
  created_at: string | Date;
};

export async function listWaitingRoundupsFor(sql: Sql, room: number): Promise<WaitingRoundup[]> {
  const rows = await sql.query<WaitingRoundupRow>(
    `select a.id, a.slug, a.headline, p.channel, p.issue_date::text as issue_date, a.published_at as created_at
     from routine_notice_publications p join articles a on a.id=p.article_id and a.newsroom_id=p.newsroom_id
     where p.newsroom_id=$1 and a.status='waiting' order by p.issue_date desc, p.id desc`,
    [room],
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    headline: row.headline,
    channel: row.channel,
    issueDate: row.issue_date,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function publishWaitingRoundupFor(
  sql: Sql,
  room: number,
  articleId: number,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const rows = await sql.query<{ slug: string }>(
    `update articles a set status='published', published_at=now()
     where a.id=$1 and a.newsroom_id=$2 and a.status='waiting'
       and exists (select 1 from routine_notice_publications p where p.article_id=a.id and p.newsroom_id=a.newsroom_id)
     returning a.slug`,
    [articleId, room],
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "This roundup is not waiting any more. Reload the page." };
  }
  return { ok: true, slug: row.slug };
}

/**
 * The roundup as the editor reads it on the desk before publishing: the same
 * words the public page would print, not a preview of a draft. Only a roundup
 * still waiting in this newsroom can be read -- a published story is on the
 * public page, and another room's article is not this editor's.
 */
export type WaitingRoundupDetail = {
  id: number;
  headline: string;
  dek: string;
  body: string;
  sourceUrls: string[];
};

export async function getWaitingRoundupFor(
  sql: Sql,
  room: number,
  articleId: number,
): Promise<WaitingRoundupDetail | null> {
  const rows = await sql.query<{
    id: number;
    headline: string;
    dek: string | null;
    body: string;
    source_urls: string | null;
  }>(
    `select a.id, a.headline, a.dek, a.body, a.source_urls
     from articles a
     where a.id=$1 and a.newsroom_id=$2 and a.status='waiting'
       and exists (select 1 from routine_notice_publications p where p.article_id=a.id and p.newsroom_id=a.newsroom_id)`,
    [articleId, room],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    headline: row.headline,
    dek: row.dek ?? "",
    body: row.body,
    sourceUrls: parseUrlList(row.source_urls),
  };
}

/**
 * Take a waiting roundup out of the list so it never prints.
 *
 * Nothing is deleted: the row's status becomes 'killed', which is the same
 * word the lead lifecycle uses for "the editor decided this does not run".
 * The worker's edition update only rewrites an article whose status is
 * 'published' or 'waiting' (routine-notice-worker.server.ts), so a killed
 * roundup is also left alone on the next run instead of being recreated.
 *
 * The update and the audit row are one statement, so the receipt cannot exist
 * without the kill or the other way round.
 */
export async function killWaitingRoundupFor(
  sql: Sql,
  room: number,
  articleId: number,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await sql.query<{ id: number }>(
    `with killed as (
       update articles a set status='killed'
       where a.id=$1 and a.newsroom_id=$2 and a.status='waiting'
         and exists (select 1 from routine_notice_publications p where p.article_id=a.id and p.newsroom_id=a.newsroom_id)
       returning a.id, a.slug, a.headline
     ), audited as (
       insert into audit_events (user_id, action, detail, newsroom_id, subject_kind, subject_id)
       select $3, 'kill', json_build_object('slug', killed.slug, 'headline', killed.headline)::text, $2, 'articles', killed.id
       from killed
       returning 1
     )
     select id from killed`,
    [articleId, room, userId],
  );
  if (!rows[0]) {
    return { ok: false, error: "This roundup is not waiting any more. Reload the page." };
  }
  return { ok: true };
}

export const listWaitingRoundups = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => listWaitingRoundupsFor(await getSql(), room(context)));

export const publishWaitingRoundup = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => {
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
      return raw;
    }
    throw new Error("Bad roundup id.");
  })
  .handler(async ({ context, data }) =>
    publishWaitingRoundupFor(await getSql(), room(context), data),
  );

export const getWaitingRoundup = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => {
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
      return raw;
    }
    throw new Error("Bad roundup id.");
  })
  .handler(async ({ context, data }) =>
    getWaitingRoundupFor(await getSql(), room(context), data),
  );

export const killWaitingRoundup = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((raw: unknown) => {
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
      return raw;
    }
    throw new Error("Bad roundup id.");
  })
  .handler(async ({ context, data }) =>
    killWaitingRoundupFor(await getSql(), room(context), data, context.userId),
  );
