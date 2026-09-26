import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";
import {
  collectStoryDates,
  type StoryDateItem,
  type StoryDateSource,
} from "../story-dates.ts";
import type { ProvenanceItem } from "./findings.ts";

/**
 * The two dated-item reads. See `story-dates.ts` for what a dated item is and
 * why only published stories are read; this file is the database side.
 *
 * Both panels read the same thing -- `articles.provenance_json` on printed
 * stories -- so there is one query and two windows over it: the front page
 * asks for the next seven days, the article page asks for everything the one
 * story carries.
 */

/**
 * How many of the newest printed stories the panels read through.
 *
 * "This week" has no story to hang off, so it has to sweep the paper, and a
 * sweep with no bound is a full table read on every front-page load. Sixty is
 * several weeks of this paper's output, which is far more than a week of dated
 * items can be hiding behind; a paper that prints faster than that would want
 * the window pushed into SQL rather than this number raised.
 */
const SOURCE_LIMIT = 60;
/** How many days ahead the front page's panel looks, on the paper's own calendar. */
export const WEEK_DAYS = 7;
/** How many rows a panel prints before it stops. */
const ROW_LIMIT = 12;

/** The paper's own calendar day for an instant -- the day a reader is living in. */
function localDay(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/**
 * The stored provenance array, or nothing.
 *
 * `articles.provenance_json` is `text`, written by the desk and by imports, and
 * it is not a column the database validates. A malformed value has to degrade
 * to "this story carries no records" rather than take down the front page, so
 * it is parsed here and not cast to `jsonb` in the query.
 */
function recordsOf(raw: string | null): ProvenanceItem[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? (parsed as ProvenanceItem[]) : [];
  } catch {
    return [];
  }
}

async function readSources(slug: string | null): Promise<{
  sources: StoryDateSource[];
  today: string;
}> {
  if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return { sources: [], today: "" };
  const config = await getPaperConfig(DEFAULT_NEWSROOM_ID);
  const today = localDay(config.timezone, new Date());
  const sql = await getSql();
  const rows =
    slug === null
      ? await sql<{ slug: string; topic: string | null; provenance_json: string | null }>`
          select slug, topic, provenance_json from articles
          where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published'
          order by published_at desc, id desc limit ${SOURCE_LIMIT}`
      : await sql<{ slug: string; topic: string | null; provenance_json: string | null }>`
          select slug, topic, provenance_json from articles
          where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published' and slug=${slug}
          limit 1`;
  return {
    today,
    sources: rows.map((row) => ({
      slug: row.slug,
      section: row.topic ?? "",
      records: recordsOf(row.provenance_json).map((item) => ({
        title: String(item.title ?? ""),
        organization: String(item.organization ?? ""),
        document_date: String(item.document_date ?? ""),
      })),
    })),
  };
}

/**
 * "This week" on the front page: the dated records printed stories carry for
 * the next seven days, oldest first.
 *
 * Usually empty, and that is the honest reading rather than a failure: most
 * stories carry records that bear a past date, and the ones that bear a future
 * one are the agendas, notices and filings captured ahead of the meeting they
 * describe. The panel says so in its own words instead of printing a calendar
 * this schema does not have.
 */
export async function listThisWeekDates(): Promise<StoryDateItem[]> {
  const { sources, today } = await readSources(null);
  if (!today) return [];
  return collectStoryDates(sources, { from: today, days: WEEK_DAYS, limit: ROW_LIMIT });
}

/**
 * "Dates in this story": every dated record the one printed story carries,
 * oldest first, past and future.
 *
 * The window is deliberately open here -- a reader who has opened the story
 * wants the dates that story is about, not the ones that happen to fall in the
 * coming week. A story whose records carry no structured date gets the panel's
 * empty state, and its sources are still listed in full, with their dates as
 * written, under "How we reported this".
 */
export async function listStoryDates(slug: string): Promise<StoryDateItem[]> {
  const { sources, today } = await readSources(slug);
  if (!today || sources.length === 0) return [];
  return collectStoryDates(sources, { limit: ROW_LIMIT });
}
