import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "../db.ts";
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
