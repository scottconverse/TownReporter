import { getSql, type Sql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPublicPaperConfig } from "./paper-settings.ts";
import { collapseEvents } from "./routine-events.ts";
import { eventsForRange } from "./routine-events.server.ts";
import { buildEventsWeek, paperLocalDate, weekDates, type EventsWeekData } from "./events-week.ts";

/**
 * The one public read behind the front page's events box.
 *
 * The date comes from the paper's configured zone, not the server's. The rows
 * come through `eventsForRange`, which applies the same approved event-source
 * filter as `eventsForDay`; repeats are collapsed by match key before they are
 * split into the seven days. A missing "Today in town" story leaves the box's
 * own in-place expansion as the reader's full list.
 */
export async function readEventsWeek(
  sql: Sql,
  newsroomId: number,
  today: string,
): Promise<EventsWeekData> {
  const dates = weekDates(today);
  if (!dates.length) return { days: [], todayStorySlug: null };
  const rows = await eventsForRange(sql, newsroomId, dates[0]!, dates.at(-1)!);
  const days = buildEventsWeek(dates, collapseEvents(rows));
  const stories = await sql.query<{ slug: string }>(
    `select a.slug
       from routine_notice_publications p
       join articles a on a.id=p.article_id and a.newsroom_id=p.newsroom_id
      where p.newsroom_id=$1 and p.channel='today' and p.issue_date=$2
        and a.status='published'
      order by p.id desc
      limit 1`,
    [newsroomId, today],
  );
  return { days, todayStorySlug: stories[0]?.slug ?? null };
}

/** Resolve the paper's local today, then read its visible week. */
export async function readFrontEventsWeek(now: Date = new Date()): Promise<EventsWeekData> {
  const paper = await getPublicPaperConfig(DEFAULT_NEWSROOM_ID);
  const today = paperLocalDate(now, paper.timezone);
  return readEventsWeek(await getSql(), DEFAULT_NEWSROOM_ID, today);
}
