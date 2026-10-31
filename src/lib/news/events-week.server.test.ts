import assert from "node:assert/strict";
import test from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { readEventsWeek } from "./events-week.server.ts";

await applyMigrationsToTestPglite();

const room = 9827;
const owner = "events-week-owner";
const today = "2026-10-30";
const dates = [
  "2026-10-30",
  "2026-10-31",
  "2026-11-01",
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
];

async function seedSource(url: string, title: string) {
  const sql = await getSql();
  const [source] = await sql.query<{ id: number; url: string }>(
    "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,$4,'accepted') returning id,url",
    [owner, room, url, title],
  );
  return source!;
}

async function seedEvent(
  source: { id: number; url: string },
  input: {
    key: string;
    matchKey: string;
    title: string;
    date: string;
    fields?: Record<string, { value: string; locator: string }>;
  },
) {
  const sql = await getSql();
  await sql.query(
    `insert into routine_events(
       newsroom_id,source_id,event_key,candidate_key,match_key,title,local_date,start_minutes,
       all_day,place,town,area,source_url,source_issuer,source_title,fields
     ) values($1,$2,$3,$4,$5,$6,$7,540,false,'Civic Center','Longmont','longmont',$8,'Arts','Calendar',$9::jsonb)`,
    [
      room,
      source.id,
      input.key,
      `candidate-${input.key}`,
      input.matchKey,
      input.title,
      input.date,
      source.url,
      JSON.stringify(input.fields ?? {}),
    ],
  );
}

test("the seven-day read keeps allowed event sources, excludes other formats, and collapses repeats", async () => {
  const sql = await getSql();
  await sql.query("delete from routine_events where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_automation_sources where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_automations where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_approvals where newsroom_id=$1", [room]);
  await sql.query("delete from routine_notice_policies where newsroom_id=$1", [room]);
  await sql.query("delete from sources where newsroom_id=$1", [room]);
  await sql.query("delete from newsrooms where id=$1", [room]);

  await sql.query("insert into newsrooms(id,name) values($1,'Events week test')", [room]);
  const organizer = await seedSource("https://events.example/organizer", "Organizer calendar");
  const duplicate = await seedSource("https://events.example/duplicate", "Area calendar");
  const other = await seedSource("https://events.example/library", "Library notices");

  await sql.query(
    "insert into routine_notice_policies(newsroom_id,paused,revision) values($1,false,1)",
    [room],
  );
  await sql.query(
    "insert into routine_notice_automations(newsroom_id,enabled,revision,timezone,local_time,today_section,weekend_section,deadlines_section) values($1,true,1,'America/Denver','06:15','news','events','deadlines')",
    [room],
  );
  for (const [source, format] of [
    [organizer, "community-arts-event-logistics"],
    [duplicate, "community-arts-event-logistics"],
    [other, "library-notice"],
  ] as const) {
    await sql.query(
      "insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) values($1,$2,$3,$4)",
      [room, source.id, source.url, format],
    );
    await sql.query(
      "insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality) values($1,$2,$3,$4,$4,'Arts','Longmont')",
      [room, source.id, format, source.url],
    );
  }

  for (const [index, date] of dates.entries()) {
    await seedEvent(organizer, {
      key: `day-${index}`,
      matchKey: `day ${index}|${date}|540|civic center`,
      title: `Day ${index} event`,
      date,
      fields:
        index === 0
          ? {
              description: {
                value: "Doors open at 5 p.m.",
                locator: "events[0].description",
              },
              eventUrl: {
                value: "https://events.example/day-0-event",
                locator: "events[0].url",
              },
            }
          : undefined,
    });
  }
  await seedEvent(duplicate, {
    key: "duplicate-day-2",
    matchKey: `day 2|${dates[2]}|540|civic center`,
    title: "Day 2 event",
    date: dates[2]!,
  });
  await seedEvent(other, {
    key: "not-an-event",
    matchKey: `library closed|${dates[3]}|540|civic center`,
    title: "Library closed",
    date: dates[3]!,
  });

  const week = await readEventsWeek(sql, room, today);

  assert.deepEqual(
    week.days.map((day) => day.date),
    dates,
  );
  assert.deepEqual(
    week.days.map((day) => day.events.length),
    [1, 1, 1, 1, 1, 1, 1],
    "one allowed line per day; the duplicate is one line and the non-event source is gone",
  );
  assert.equal(
    week.days.flatMap((day) => day.events).some((event) => event.title === "Library closed"),
    false,
  );
  assert.equal(week.todayStorySlug, null);
  assert.equal(week.days[0]!.events[0]!.description, "Doors open at 5 p.m.");
  assert.equal(week.days[0]!.events[0]!.sourceName, "Calendar");
  assert.equal(week.days[0]!.events[0]!.eventUrl, "https://events.example/day-0-event");
  assert.deepEqual(JSON.parse(JSON.stringify(week)), week, "the server result is plain JSON");
});
