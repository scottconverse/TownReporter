import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";

/** Seed only the configured, onboarded newsroom that owns this editor action. */
export async function ensureNewsroomSources(userId: string, newsroomId = DEFAULT_NEWSROOM_ID) {
  if (!(await isOnboarded(newsroomId))) return;
  const config = await getPaperConfig(newsroomId);
  const sql = await getSql();
  for (const source of config.seedSources)
    await sql`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${userId},${newsroomId},${source.url},${source.title},${source.kind},${source.tier},'accepted')
    on conflict(user_id,url) do nothing`;
}
