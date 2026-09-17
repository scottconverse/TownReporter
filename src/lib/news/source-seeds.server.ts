import { withTransaction, type Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";

/** Seed only the configured, onboarded newsroom that owns this editor action. */
export async function ensureNewsroomSources(userId: string, newsroomId = DEFAULT_NEWSROOM_ID) {
  if (!(await isOnboarded(newsroomId))) return;
  const config = await getPaperConfig(newsroomId);
  await withTransaction(async (sql) => {
    // Serialize seeding for this newsroom without requiring a new uniqueness
    // constraint that historical duplicate rows could not satisfy.
    const room = await sql<{ newsroom_id: number }>`
      select newsroom_id
      from paper_settings
      where newsroom_id=${newsroomId}
      for update
    `;
    if (!room.length) return;

    for (const source of config.seedSources)
      await sql`
        insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
        select ${userId},${newsroomId},${source.url},${source.title},${source.kind},${source.tier},'accepted'
        where not exists (
          select 1
          from sources
          where newsroom_id=${newsroomId} and url=${source.url}
        )
        on conflict(user_id,newsroom_id,url) do nothing
      `;
  });
}

export async function saveAcceptedNewsroomSource(input: {
  userId: string;
  newsroomId: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
}) {
  return withTransaction(async (sql) => {
    await sql`select newsroom_id from paper_settings where newsroom_id=${input.newsroomId} for update`;
    const existing = await sql<{ id: number }>`select id from sources where newsroom_id=${input.newsroomId} and url=${input.url} order by id limit 1`;
    const rows = existing[0]
      ? await sql`update sources set title=${input.title},kind=${input.kind},tier=${input.tier},status='accepted' where id=${existing[0].id} and newsroom_id=${input.newsroomId} returning *`
      : await sql`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${input.userId},${input.newsroomId},${input.url},${input.title},${input.kind},${input.tier},'accepted') on conflict(user_id,newsroom_id,url) do update set title=excluded.title,kind=excluded.kind,tier=excluded.tier,status='accepted' returning *`;
    return rows[0] ?? null;
  });
}

export async function insertProposedNewsroomSource(sql: Sql, input: {
  userId: string;
  newsroomId: number;
  url: string;
  title: string;
}): Promise<boolean> {
  await sql`select newsroom_id from paper_settings where newsroom_id=${input.newsroomId} for update`;
  const rows = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    select ${input.userId},${input.newsroomId},${input.url},${input.title},'discovered','unclassified','proposed'
    where not exists (select 1 from sources where newsroom_id=${input.newsroomId} and url=${input.url})
    on conflict(user_id,newsroom_id,url) do nothing
    returning id
  `;
  return rows.length === 1;
}
