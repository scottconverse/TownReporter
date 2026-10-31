import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractCommunityEventFeed,
  routineEventReaderKind,
  type EventFeedReaderKind,
} from "./routine-notice-event-readers.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";

const provenance = {
  newsroomId: 1,
  sourceId: 2,
  sourceUrl: "https://events.example/calendar",
  policyRevision: 3,
  captureEventId: 4,
  artifactVersionId: 5,
  contentHash: "abc",
};
const context = {
  provenance,
  issuer: "Test Arts Council",
  locality: "Longmont",
  timezone: "America/Denver",
};
const fixedNow = new Date("2026-10-29T23:00:00Z");

function fixture(name: string) {
  return readFileSync(new URL(`./fixtures/routine-notice/event-readers/${name}`, import.meta.url), "utf8");
}
function extract(raw: string, kind: EventFeedReaderKind) {
  return extractCommunityEventFeed(raw, kind, context, { now: fixedNow });
}
function notices(results: ReturnType<typeof extract>): StructurallyValidRoutineNotice[] {
  return results.flatMap((result) =>
    result.status === "parsed" && result.validation.valid ? [result.validation.notice] : [],
  );
}
function byTitle(results: ReturnType<typeof extract>, title: string) {
  return notices(results).find((notice) => notice.normalizedFields.title === title);
}

test("Tribe Longmont JSON reads only the fixed seven-day window", () => {
  const results = extract(fixture("tribe-longmont.json"), "tribe");
  assert.equal(notices(results).length, 6);

  const discovery = byTitle(results, "Discovery Days Art")!;
  assert.equal(discovery.normalizedFields.start, "2026-10-29T09:15:00-06:00");
  assert.equal(discovery.normalizedFields.venue, "Longmont Museum");
  assert.equal(
    discovery.normalizedFields.onlineUrl,
    "https://longmontcolorado.gov/event/discovery-days-art-8/2026-10-29/",
  );
  assert.match(discovery.normalizedFields.description!, /early childhood program/i);
  assert.equal(discovery.normalizedFields.eventUrl, discovery.normalizedFields.onlineUrl);
  assert.equal(discovery.fields.description!.locator, "events[0].excerpt");
  assert.equal(discovery.fields.eventUrl!.locator, "events[0].url");

  const storytime = byTitle(results, "Craft Storytime")!;
  assert.equal(storytime.normalizedFields.start, "2026-10-29T10:00:00-06:00");
  assert.equal(storytime.normalizedFields.venue, "Longmont Public Library");
  assert.equal(
    storytime.normalizedFields.onlineUrl,
    "https://longmontcolorado.gov/event/craft-storytime-7/2026-10-29/",
  );
  assert.equal(discovery.provenance.externalId, "10009054#2026-10-29");
});

test("Tribe Dairy JSON keeps HTML entities out of titles and venues", () => {
  const results = extract(fixture("tribe-dairy.json"), "tribe");
  assert.equal(notices(results).length, 6);

  const first = byTitle(results, "Boulder Jewish Film Festival: Once Upon My Mother")!;
  assert.equal(first.normalizedFields.start, "2026-10-29T12:00:00-06:00");
  assert.equal(first.normalizedFields.venue, "Grace Gamm Theatre");
  assert.equal(
    first.normalizedFields.onlineUrl,
    "https://thedairy.org/event/boulder-jewish-film-festival-once-upon-my-mother-2/",
  );

  const second = byTitle(results, "Boulder Jewish Film Festival: To Kill a Nazi")!;
  assert.equal(second.normalizedFields.start, "2026-10-29T15:00:00-06:00");
  assert.equal(second.normalizedFields.venue, "Grace Gamm Theatre");
  assert.equal(
    second.normalizedFields.onlineUrl,
    "https://thedairy.org/event/boulder-jewish-film-festival-to-kill-a-nazi/",
  );
  assert.equal(second.provenance.externalId, "69008#2026-10-29");
  assert.ok(notices(results).every((notice) => !/[<>]/.test(notice.normalizedFields.title ?? "")));
});

test("Squarespace St. Vrain Cidery JSON joins event paths to the source origin", () => {
  const results = extract(fixture("squarespace-stvrain-cidery.json"), "squarespace");
  assert.equal(notices(results).length, 3);

  const matt = byTitle(results, "MUSIC | matt johnson")!;
  assert.equal(matt.normalizedFields.start, "2026-10-30T18:30:00-06:00");
  assert.equal(matt.normalizedFields.venue, "St. Vrain Cidery, 350 Terry Street");
  assert.equal(matt.normalizedFields.onlineUrl, "https://events.example/events/music-trevin-nelson");
  assert.equal(matt.normalizedFields.description, "NO COVER");
  assert.equal(matt.normalizedFields.eventUrl, matt.normalizedFields.onlineUrl);

  const squirrel = byTitle(results, "MUSIC | SQUIRREL JUNCTION")!;
  assert.equal(squirrel.normalizedFields.start, "2026-10-31T18:30:00-06:00");
  assert.equal(squirrel.normalizedFields.venue, "St. Vrain Cidery, 350 Terry Street");
  assert.equal(squirrel.normalizedFields.onlineUrl, "https://events.example/events/music-squirrel-junction-4yzlh");
  assert.equal(squirrel.provenance.externalId, "6ac13109fcdbcf364905e5bf#2026-10-31");
});

test("Squarespace BMOCA JSON decodes entities and ignores an out-of-window event", () => {
  const results = extract(fixture("squarespace-bmoca.json"), "squarespace");
  assert.equal(notices(results).length, 1);

  const reception = byTitle(results, "Día de los Muertos Reception")!;
  assert.equal(reception.normalizedFields.start, "2026-11-01T14:00:00-07:00");
  assert.equal(reception.normalizedFields.venue, "Boulder Museum of Contemporary Art, 1750 13th Street");
  assert.equal(
    reception.normalizedFields.onlineUrl,
    "https://events.example/events/dia-de-los-muertos-reception-2026",
  );
  assert.equal(reception.provenance.externalId, "6a909c07415c85288718bd60#2026-11-01");
  assert.equal(byTitle(results, "Guided Mural Tour"), undefined);
});

test("LibCal RSS reads timed and all-day events in the fixed window", () => {
  const results = extract(fixture("libcal-lafayette.xml"), "libcal");
  assert.equal(notices(results).length, 12);

  const allDay = byTitle(results, "Vote Center - OPEN 8am-6pm")!;
  assert.equal(allDay.normalizedFields.start, "2026-10-30");
  assert.equal(allDay.normalizedFields.end, "2026-10-31");
  assert.equal(allDay.normalizedFields.allDay, "true");
  assert.equal(allDay.normalizedFields.venue, "Voting Entrance - North End of Parking Lot");
  assert.equal(allDay.normalizedFields.onlineUrl, "https://lafayettepubliclibrary.libcal.com/event/17220580");
  assert.match(allDay.normalizedFields.description!, /Vote Center/i);
  assert.equal(allDay.normalizedFields.eventUrl, allDay.normalizedFields.onlineUrl);

  const storytime = byTitle(results, "Halloween Storytime with Mountain Buddies")!;
  assert.equal(storytime.normalizedFields.start, "2026-10-30T10:30:00-06:00");
  assert.equal(storytime.normalizedFields.end, "2026-10-30T11:00:00-06:00");
  assert.equal(storytime.normalizedFields.venue, "Kid Zone");
  assert.equal(storytime.normalizedFields.onlineUrl, "https://lafayettepubliclibrary.libcal.com/event/17651750");
  assert.equal(storytime.provenance.externalId, "17651750#2026-10-30");
});

test("CivicPlus RSS uses the event date, not pubDate, and can read a missing time as all-day", () => {
  const raw = fixture("civicplus-frederick.xml");
  const results = extract(raw, "civicplus");
  assert.equal(notices(results).length, 3);

  const neighborhood = byTitle(
    results,
    "Neighborhood Meeting - 3766 Eureka Way Car Sales Conditional Use",
  )!;
  assert.equal(neighborhood.normalizedFields.start, "2026-11-02T17:00:00-07:00");
  assert.equal(neighborhood.normalizedFields.venue, "Longmont");
  assert.equal(neighborhood.normalizedFields.onlineUrl, "https://www.frederickco.gov/Calendar.aspx?EID=4404");
  assert.match(neighborhood.normalizedFields.description!, /Event date/i);
  assert.equal(neighborhood.normalizedFields.eventUrl, neighborhood.normalizedFields.onlineUrl);
  assert.equal(neighborhood.provenance.externalId, "4404#2026-11-02");

  const workSession = byTitle(results, "Board of Trustees Work Session")!;
  assert.equal(workSession.normalizedFields.start, "2026-11-04T17:30:00-07:00");
  assert.equal(workSession.normalizedFields.end, "2026-11-04T18:30:00-07:00");
  assert.equal(workSession.normalizedFields.venue, "Longmont");
  assert.equal(workSession.normalizedFields.onlineUrl, "https://www.frederickco.gov/Calendar.aspx?EID=4311");

  const withoutTime = raw.replace(
    /<calendarEvent:EventTimes>[^<]*<\/calendarEvent:EventTimes>/,
    "",
  );
  const allDay = byTitle(extract(withoutTime, "civicplus"), "Neighborhood Meeting - 3766 Eureka Way Car Sales Conditional Use")!;
  assert.equal(allDay.normalizedFields.start, "2026-11-02");
  assert.equal(allDay.normalizedFields.end, "2026-11-03");
  assert.equal(allDay.normalizedFields.allDay, "true");
});

test("each reader refuses one malformed item with a code and keeps the good items", () => {
  const cases: Array<{ kind: EventFeedReaderKind; raw: string; refusedCode: string; baselineFile: string }> = [];
  {
    const value = JSON.parse(fixture("tribe-longmont.json"));
    value.events.push({ id: 999, title: "Broken tribe item", start_date: "not-a-date", all_day: false });
    cases.push({ kind: "tribe", raw: JSON.stringify(value), refusedCode: "unreadable-time", baselineFile: "tribe-longmont.json" });
  }
  {
    const value = JSON.parse(fixture("squarespace-stvrain-cidery.json"));
    value.upcoming.push({ id: "broken", title: "Broken Squarespace item", startDate: "not-epoch" });
    cases.push({ kind: "squarespace", raw: JSON.stringify(value), refusedCode: "missing-date", baselineFile: "squarespace-stvrain-cidery.json" });
  }
  {
    const raw = fixture("libcal-lafayette.xml");
    cases.push({
      kind: "libcal",
      raw: raw.replace("</channel>", "<item><title>Broken LibCal item</title><link>https://example.test/bad</link><libcal:eventid>999</libcal:eventid><libcal:date>not-a-date</libcal:date><libcal:start>10:00:00</libcal:start><libcal:end>11:00:00</libcal:end></item></channel>"),
      refusedCode: "missing-date",
      baselineFile: "libcal-lafayette.xml",
    });
  }
  {
    const raw = fixture("civicplus-frederick.xml");
    cases.push({
      kind: "civicplus",
      raw: raw.replace("</channel>", '<item><title>Broken CivicPlus item</title><link>https://www.frederickco.gov/Calendar.aspx?EID=999</link><calendarEvent:EventDates>not-a-date</calendarEvent:EventDates><calendarEvent:EventTimes>05:00 PM - 06:00 PM</calendarEvent:EventTimes></item></channel>'),
      refusedCode: "unreadable-date",
      baselineFile: "civicplus-frederick.xml",
    });
  }

  for (const item of cases) {
    const baseline = notices(extract(fixture(item.baselineFile), item.kind)).length;
    const results = extract(item.raw, item.kind);
    assert.equal(notices(results).length, baseline, `${item.kind} kept its good items`);
    assert.ok(
      results.some((result) => result.status === "refused" && result.code === item.refusedCode),
      `${item.kind} returned ${item.refusedCode}`,
    );
    assert.ok(
      results.some((result) => result.status === "refused" && /Broken/.test(result.label ?? "")),
      `${item.kind} labels the refused item`,
    );
  }
});

test("content signatures choose one reader and leave plain RSS for the JSON-LD fallback", () => {
  assert.equal(routineEventReaderKind(fixture("tribe-longmont.json")), "tribe");
  assert.equal(routineEventReaderKind(fixture("squarespace-bmoca.json")), "squarespace");
  assert.equal(routineEventReaderKind(fixture("libcal-lafayette.xml")), "libcal");
  assert.equal(routineEventReaderKind(fixture("civicplus-frederick.xml")), "civicplus");
  assert.equal(
    routineEventReaderKind('<?xml version="1.0"?><rss><channel><item><title>Plain RSS</title></item></channel></rss>'),
    null,
  );
  assert.equal(
    routineEventReaderKind("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR"),
    "ics",
  );
});
