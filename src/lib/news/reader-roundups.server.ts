import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { isOnboarded } from "./paper-settings.ts";
import { stripReaderYearNote } from "./strip-draft.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import { latestRoundups, type ReaderRoundup } from "./reader-roundups.ts";

/** Read one newest published routine story per channel for the events band. */
export async function listLatestRoundups(): Promise<ReaderRoundup[]> {
  if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return [];
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    slug: string;
    headline: string;
    dek: string;
    published_at: string;
    channel: string;
  }>`
    select distinct on (p.channel)
      a.id, a.slug, a.headline, a.dek, a.published_at, p.channel
    from routine_notice_publications p
    join articles a on a.id = p.article_id and a.newsroom_id = p.newsroom_id
    where p.newsroom_id = ${DEFAULT_NEWSROOM_ID}
      and a.status = 'published'
      and p.channel in ('today', 'weekend', 'deadlines')
    order by p.channel, a.published_at desc, a.id desc
  `;
  return latestRoundups(
    rows.map((row) => {
      const text = unpackStoredDraft({
        headline: row.headline,
        dek: row.dek,
        body: "",
        topic: "",
      });
      return {
        id: row.id,
        slug: row.slug,
        headline: stripReaderYearNote(text.headline) || text.headline,
        dek: stripReaderYearNote(text.dek),
        publishedAt: row.published_at,
        channel: row.channel,
      };
    }),
  );
}
