import { withTransaction, type Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";
import { parseHttpUrl } from "./source-lines.ts";

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

/** The name a first-time row falls back to when the editor typed no label. */
function hostFor(url: string): string {
  const parsed = parseHttpUrl(url);
  return parsed.ok ? parsed.host : url;
}

/**
 * Save an accepted source, keyed on the newsroom's URL.
 *
 * Both add boxes -- the Sources page's and the one inside a section -- send the
 * label the editor typed, and on the Sources page that field is optional. The
 * empty label is inert: it never becomes a title, and it never overwrites one.
 *
 * It used to. The caller supplied the host name for an empty label, so
 * re-adding a URL already on watch renamed the source to its own host --
 * "City Council packets" became "www.example-city-council.test" because the
 * editor left a field blank they were told was optional. Two rules replace
 * that: a label that was given still renames the row (today's Sources-page
 * behaviour, pinned in sections.test.ts), and an empty one leaves the existing
 * title alone. Only a row that has no title yet -- a first-time source -- takes
 * the host, because a source with no name at all is not usable in the watch
 * list or in the section panels.
 *
 * The `on conflict` branch repeats the rule rather than trusting the lookup
 * above it: that branch only runs on a race, which is exactly when the row
 * exists and its title must not be clobbered.
 */
export async function saveAcceptedNewsroomSource(input: {
  userId: string;
  newsroomId: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
}) {
  const label = input.title.trim();
  return withTransaction(async (sql) => {
    await sql`select newsroom_id from paper_settings where newsroom_id=${input.newsroomId} for update`;
    const existing = await sql<{ id: number; title: string }>`select id,title from sources where newsroom_id=${input.newsroomId} and url=${input.url} order by id limit 1`;
    const rows = existing[0]
      ? await sql`update sources set title=${label || existing[0].title},kind=${input.kind},tier=${input.tier},status='accepted' where id=${existing[0].id} and newsroom_id=${input.newsroomId} returning *`
      : await sql`insert into sources(user_id,newsroom_id,url,title,kind,tier,status) values(${input.userId},${input.newsroomId},${input.url},${label || hostFor(input.url)},${input.kind},${input.tier},'accepted') on conflict(user_id,newsroom_id,url) do update set title=case when ${label}='' then sources.title else excluded.title end,kind=excluded.kind,tier=excluded.tier,status='accepted' returning *`;
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
