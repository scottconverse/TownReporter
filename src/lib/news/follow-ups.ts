import { getSql } from "../db.ts";
import { parseNotes, packNotes } from "./notes.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import type { FollowUpRow } from "./types.ts";

/**
 * The Follow-ups object (Direction A, stage 1: docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md).
 *
 * Written with relative imports only (no `@/...` aliases) on purpose, the
 * same reason model-request-commit.server.ts is: desk.ts pulls in modules
 * that plain `node --test` cannot resolve (see lead-queue-order.test.ts's
 * docstring), so this file lives apart from it and desk.ts's
 * `createServerFn` wrappers import these `perform*` functions rather than
 * defining the logic inline. That is also what lets follow-ups.test.ts and
 * schema-parity.test.ts import this file directly.
 *
 * `ensureFollowUpsSchema` mirrors migrations/0042_follow_ups.sql column-for-
 * column so the schema-parity test can diff the two sides; called at the top
 * of every `perform*` function below the same way desk.ts's
 * `ensureDraftMemoColumn` is, so a plain `node --test` run (no Vite
 * migration glob) and a fresh PGLite preview both have the table before it's
 * queried.
 */
export async function ensureFollowUpsSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists follow_ups (
      id serial primary key,
      newsroom_id integer not null default 1,
      user_id text not null,
      lead_id integer,
      article_id integer,
      who text not null,
      what text not null,
      due_on date,
      status text not null default 'open' check (status in ('open', 'answered', 'dropped')),
      nudged_at timestamptz,
      answered_at timestamptz,
      reply_text text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await sql.query(
    "create index if not exists follow_ups_newsroom_status_due on follow_ups (newsroom_id, status, due_on)",
  );
}

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

export async function performListFollowUps(
  context: { userId: string; newsroomId?: number },
  input: { status?: "open" | "answered" | "dropped"; limit?: number } = {},
): Promise<FollowUpRow[]> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const rows = input.status
    ? await sql<FollowUpRow>`
        select f.id, f.lead_id, f.article_id, f.who, f.what, f.due_on, f.status,
               f.nudged_at, f.answered_at, f.reply_text, f.created_at,
               l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
        from follow_ups f
        left join leads l on l.id = f.lead_id
        left join articles a on a.id = f.article_id
        where f.newsroom_id = ${owned(context)} and f.status = ${input.status}
        order by (f.due_on is null), f.due_on asc, f.created_at desc
        limit ${limit}
      `
    : await sql<FollowUpRow>`
        select f.id, f.lead_id, f.article_id, f.who, f.what, f.due_on, f.status,
               f.nudged_at, f.answered_at, f.reply_text, f.created_at,
               l.headline as lead_headline, a.slug as article_slug, a.headline as article_headline
        from follow_ups f
        left join leads l on l.id = f.lead_id
        left join articles a on a.id = f.article_id
        where f.newsroom_id = ${owned(context)}
        order by (f.status = 'open') desc, (f.due_on is null), f.due_on asc, f.created_at desc
        limit ${limit}
      `;
  return rows;
}

export async function performCreateFollowUp(
  context: { userId: string; newsroomId?: number },
  input: { leadId?: number | null; articleId?: number | null; who: string; what: string; dueOn?: string | null },
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const who = input.who.trim().slice(0, 200);
  const what = input.what.trim().slice(0, 400);
  if (!who || !what) return { ok: false as const, error: "Who and what are both required." };
  const sql = await getSql();
  const rows = await sql<{ id: number }>`
    insert into follow_ups (user_id, newsroom_id, lead_id, article_id, who, what, due_on)
    values (
      ${context.userId}, ${owned(context)}, ${input.leadId ?? null}, ${input.articleId ?? null},
      ${who}, ${what}, ${input.dueOn ?? null}
    )
    returning id
  `;
  return { ok: true as const, id: rows[0]!.id };
}

export async function performRecordFollowUpReply(
  context: { userId: string; newsroomId?: number },
  input: { id: number; replyText: string; repliedOn?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureFollowUpsSchema();
  const replyText = input.replyText.trim().slice(0, 2000);
  if (!replyText) return { ok: false as const, error: "Add what they said before saving." };
  const sql = await getSql();
  const rows = await sql<{ id: number; lead_id: number | null; who: string }>`
    update follow_ups
    set status = 'answered', answered_at = now(), reply_text = ${replyText}, updated_at = now()
    where id = ${input.id} and newsroom_id = ${owned(context)}
    returning id, lead_id, who
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "That follow-up is gone." };
  if (row.lead_id) {
    const when = input.repliedOn ?? new Date().toISOString().slice(0, 10);
    const leadRows = await sql<{ notes_json: string | null }>`
      select notes_json from leads where id = ${row.lead_id} and newsroom_id = ${owned(context)}
    `;
    if (leadRows[0]) {
      const notes = parseNotes(leadRows[0].notes_json);
      notes.found.push({ t: `Reply from ${row.who} (${when}): ${replyText}` });
      await sql`
        update leads set notes_json = ${packNotes(notes)}
        where id = ${row.lead_id} and newsroom_id = ${owned(context)}
      `;
    }
  }
  return { ok: true as const };
}

export async function performNudgeFollowUp(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  await sql`
    update follow_ups set nudged_at = now(), updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)} and status = 'open'
  `;
  return { ok: true as const };
}

export async function performDropFollowUp(
  context: { userId: string; newsroomId?: number },
  id: number,
): Promise<{ ok: true }> {
  await ensureFollowUpsSchema();
  const sql = await getSql();
  await sql`
    update follow_ups set status = 'dropped', updated_at = now()
    where id = ${id} and newsroom_id = ${owned(context)}
  `;
  return { ok: true as const };
}
