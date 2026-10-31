import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getPaperConfig, isOnboarded } from "./paper-settings.ts";
import {
  collectStoryDates,
  routineLineParts,
  type StoryDateItem,
  type StoryDateSource,
} from "../story-dates.ts";
import type { ProvenanceItem } from "./findings.ts";

/**
 * The dated-item read behind the article page's "Dates in this story" panel.
 * See `story-dates.ts` for what a dated item is and why only published stories
 * are read; this file is the database side.
 */

/** How many rows the article page's "Dates in this story" panel prints before it stops. */
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

/** The columns both reads need: the story's records, and the words it printed. */
type SourceRow = {
  slug: string;
  topic: string | null;
  headline: string | null;
  dek: string | null;
  published_at: string;
  provenance_json: string | null;
};

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

/**
 * G24-R2-2: the dated lines a routine edition printed, read from the run that
 * last wrote the story. A story that is not a routine edition, or a database
 * with no routine tables, gives no lines, and the panel reads as before.
 */
async function routineLines(slug: string): Promise<NonNullable<StoryDateSource["lines"]>> {
  const sql = await getSql();
  let rows: { channel: string; summary_json: string | null }[] = [];
  try {
    rows = await sql<{ channel: string; summary_json: string | null }>`
      select p.channel, r.summary_json from routine_notice_publications p
      join articles a on a.id=p.article_id and a.newsroom_id=p.newsroom_id
      join routine_notice_runs r on r.id=p.run_id and r.newsroom_id=p.newsroom_id
      where a.newsroom_id=${DEFAULT_NEWSROOM_ID} and a.slug=${slug} and a.status='published'
      limit 1`;
  } catch {
    return [];
  }
  const row = rows[0];
  if (!row) return [];
  let notices: unknown;
  try {
    notices = JSON.parse(row.summary_json ?? "{}")?.notices;
  } catch {
    return [];
  }
  if (!Array.isArray(notices)) return [];
  return notices.flatMap((notice) => {
    if (!notice || typeof notice !== "object") return [];
    const n = notice as Record<string, unknown>;
    if (n.status !== "published" || n.channel !== row.channel) return [];
    const date = typeof n.occurrenceDate === "string" ? n.occurrenceDate.slice(0, 10) : "";
    const line = typeof n.line === "string" ? n.line : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !line.trim()) return [];
    return [{ date, ...routineLineParts(line) }];
  });
}

async function readSources(slug: string): Promise<{
  sources: StoryDateSource[];
  today: string;
}> {
  if (!(await isOnboarded(DEFAULT_NEWSROOM_ID))) return { sources: [], today: "" };
  const config = await getPaperConfig(DEFAULT_NEWSROOM_ID);
  const today = localDay(config.timezone, new Date());
  const sql = await getSql();
  /*
    The story's own words are read as well as its records (unit BX2): on the
    live paper every `document_date` is empty, and the dates the reader is
    looking for are in the headline and the dek. `published_at` comes along
    because it is what a worded date with no year of its own is resolved
    against, and it is reduced to the paper's own calendar day here, in the
    paper's timezone, so a story filed at 11 p.m. Denver time is read on the day
    its readers were living in.
  */
  const rows = await sql<SourceRow>`
    select slug, topic, headline, dek, published_at, provenance_json from articles
    where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published' and slug=${slug}
    limit 1`;
  const lines = !rows[0] ? [] : await routineLines(rows[0].slug);
  return {
    today,
    sources: rows.map((row) => ({
      ...(lines.length ? { lines } : {}),
      slug: row.slug,
      section: row.topic ?? "",
      headline: row.headline ?? "",
      dek: row.dek ?? "",
      published_on: localDay(config.timezone, new Date(row.published_at)),
      records: recordsOf(row.provenance_json).map((item) => ({
        title: String(item.title ?? ""),
        organization: String(item.organization ?? ""),
        document_date: String(item.document_date ?? ""),
      })),
    })),
  };
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
