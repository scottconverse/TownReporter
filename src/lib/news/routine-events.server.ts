import type { Sql } from "../db.ts";
import type { StoryArea } from "../story-area.ts";
import type { RoutineField } from "./routine-notice-types.ts";
import {
  eventSeenKey,
  rowsToRemove,
  type EventWindow,
  type RoutineEventRow,
} from "./routine-events.ts";

export type RoutineEventInput = {
  eventKey: string;
  candidateKey: string;
  matchKey: string;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  localDate: string;
  startMinutes: number | null;
  allDay: boolean;
  place?: string | null;
  town: string;
  area: StoryArea;
  link?: string | null;
  fields: Record<string, RoutineField>;
};

type DbRow = {
  id: number;
  newsroom_id: number;
  source_id: number;
  event_key: string;
  candidate_key: string;
  match_key: string;
  title: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  local_date: string;
  start_minutes: number | null;
  all_day: boolean;
  place: string | null;
  town: string | null;
  area: StoryArea;
  source_url: string;
  link: string | null;
  source_issuer: string | null;
  source_title: string | null;
  fields: Record<string, RoutineField> | null;
};

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  const instant = value instanceof Date ? value : new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : instant.toISOString();
}

function rowFromDb(row: DbRow): RoutineEventRow {
  return {
    id: Number(row.id),
    newsroomId: Number(row.newsroom_id),
    sourceId: Number(row.source_id),
    eventKey: row.event_key,
    candidateKey: row.candidate_key,
    matchKey: row.match_key,
    title: row.title,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    localDate: String(row.local_date).slice(0, 10),
    startMinutes: row.start_minutes === null ? null : Number(row.start_minutes),
    allDay: row.all_day,
    place: row.place ?? "",
    town: row.town ?? "",
    area: row.area,
    sourceUrl: row.source_url,
    link: row.link,
    sourceIssuer: row.source_issuer ?? "",
    sourceTitle: row.source_title ?? "",
    fields: row.fields ?? {},
  };
}

export async function recordSourceRead(
  sql: Sql,
  input: {
    newsroomId: number;
    sourceId: number;
    sourceUrl: string;
    sourceIssuer: string;
    sourceTitle: string;
    localDate: string;
    window: EventWindow;
    fullRead: boolean;
    events: readonly RoutineEventInput[];
  },
): Promise<void> {
  const existing = (
    await sql.query<DbRow>(
      `select * from routine_events
        where newsroom_id=$1 and source_id=$2 and local_date between $3 and $4
        order by local_date,event_key for update`,
      [input.newsroomId, input.sourceId, input.window.start, input.window.end],
    )
  ).map(rowFromDb);

  const stored = input.events.filter(
    (event) =>
      event.localDate >= input.window.start &&
      event.localDate <= input.window.end,
  );
  for (const event of stored) {
    await sql.query(
      `insert into routine_events(
         newsroom_id,source_id,event_key,candidate_key,match_key,title,starts_at,ends_at,
         local_date,start_minutes,all_day,place,town,area,source_url,link,source_issuer,source_title,fields,last_seen_at
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,now())
       on conflict(newsroom_id,source_id,event_key,local_date) do update set
         candidate_key=excluded.candidate_key,
         match_key=excluded.match_key,
         title=excluded.title,
         starts_at=excluded.starts_at,
         ends_at=excluded.ends_at,
         start_minutes=excluded.start_minutes,
         all_day=excluded.all_day,
         place=excluded.place,
         town=excluded.town,
         area=excluded.area,
         source_url=excluded.source_url,
         link=excluded.link,
         source_issuer=excluded.source_issuer,
         source_title=excluded.source_title,
         fields=excluded.fields,
         last_seen_at=now()`,
      [
        input.newsroomId,
        input.sourceId,
        event.eventKey,
        event.candidateKey,
        event.matchKey,
        event.title,
        event.startsAt ?? null,
        event.endsAt ?? null,
        event.localDate,
        event.startMinutes,
        event.allDay,
        event.place ?? "",
        event.town,
        event.area,
        input.sourceUrl,
        event.link ?? null,
        input.sourceIssuer,
        input.sourceTitle,
        JSON.stringify(event.fields),
      ],
    );
  }

  const remove = rowsToRemove(
    existing,
    stored.map(eventSeenKey),
    input.window,
    input.fullRead,
  );
  for (const row of remove) {
    await sql.query(
      "delete from routine_events where id=$1 and newsroom_id=$2 and source_id=$3",
      [row.id, input.newsroomId, input.sourceId],
    );
  }

  await sql.query("delete from routine_events where newsroom_id=$1 and local_date < $2", [
    input.newsroomId,
    input.localDate,
  ]);
}

async function eventRowsBetween(
  sql: Sql,
  newsroomId: number,
  start: string,
  end: string,
): Promise<RoutineEventRow[]> {
  const rows = await sql.query<DbRow>(
    `select e.* from routine_events e
      where e.newsroom_id=$1 and e.local_date between $2 and $3
        and exists (
          select 1 from routine_notice_automation_sources x
           where x.newsroom_id=e.newsroom_id and x.source_id=e.source_id
             and x.format_key='community-arts-event-logistics'
        )
      order by e.local_date,e.start_minutes nulls first,e.title,e.source_id,e.event_key`,
    [newsroomId, start, end],
  );
  return rows.map(rowFromDb);
}

export function eventsForDay(
  sql: Sql,
  newsroomId: number,
  localDate: string,
): Promise<RoutineEventRow[]> {
  return eventRowsBetween(sql, newsroomId, localDate, localDate);
}

/** The front-page box reads the whole visible week in one query. */
export function eventsForRange(
  sql: Sql,
  newsroomId: number,
  start: string,
  end: string,
): Promise<RoutineEventRow[]> {
  return eventRowsBetween(sql, newsroomId, start, end);
}
