import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractRoutineIcs } from "./routine-notice-feeds.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";

const provenance = {
  newsroomId: 1,
  sourceId: 2,
  sourceUrl: "https://example.test/calendar.ics",
  policyRevision: 3,
  captureEventId: 4,
  artifactVersionId: 5,
  contentHash: "abc",
};
const context = {
  provenance,
  issuer: "Firehouse Art Center",
  locality: "Longmont",
  timezone: "America/Denver",
};
const fixedNow = new Date("2026-10-29T23:00:00Z");

function calendar(events: string[]) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR`;
}
function vevent(lines: string[]) {
  return `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT`;
}
function extract(raw: string, windowStart: string, windowEnd: string) {
  return extractRoutineIcs(raw, "event", context, { now: fixedNow, windowStart, windowEnd });
}
function notices(results: ReturnType<typeof extract>): StructurallyValidRoutineNotice[] {
  return results.flatMap((result) =>
    result.status === "parsed" && result.validation.valid ? [result.validation.notice] : [],
  );
}
function starts(results: ReturnType<typeof extract>) {
  return notices(results).map((notice) => notice.normalizedFields.start);
}
function title(results: ReturnType<typeof extract>, title: string) {
  return notices(results).filter((notice) => notice.normalizedFields.title === title);
}

test("expands weekly events at the same wall time across the 2026 DST change", () => {
  const raw = calendar([
    vevent([
      "UID:dst-weekly",
      "DTSTART;TZID=America/Denver:20261018T190000",
      "DTEND;TZID=America/Denver:20261018T203000",
      "RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261110T015959Z",
      "SUMMARY:Sunday concert",
      "LOCATION:Downtown plaza",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-10-25", "2026-11-09")), [
    "2026-10-25T19:00:00-06:00",
    "2026-11-01T19:00:00-07:00",
    "2026-11-08T19:00:00-07:00",
  ]);
});

test("EXDATE removes one occurrence and RDATE adds a different local time", () => {
  const raw = calendar([
    vevent([
      "UID:rdate-exdate",
      "DTSTART;TZID=America/Denver:20261018T190000",
      "DTEND;TZID=America/Denver:20261018T200000",
      "RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261116T015959Z",
      "EXDATE;TZID=America/Denver:20261101T190000",
      "RDATE;TZID=America/Denver:20261103T183000",
      "SUMMARY:Workshop",
      "LOCATION:Studio",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-10-31", "2026-11-05")), ["2026-11-03T18:30:00-07:00"]);
});

test("RECURRENCE-ID moves one date and a cancelled override removes another", () => {
  const raw = calendar([
    vevent([
      "UID:override-series",
      "DTSTART;TZID=America/Denver:20261020T180000",
      "DTEND;TZID=America/Denver:20261020T190000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4",
      "SUMMARY:Weekly class",
      "LOCATION:Main room",
    ]),
    vevent([
      "UID:override-series",
      "RECURRENCE-ID;TZID=America/Denver:20261103T180000",
      "DTSTART;TZID=America/Denver:20261103T193000",
      "DTEND;TZID=America/Denver:20261103T203000",
      "SUMMARY:Moved class",
      "LOCATION:Upstairs room",
    ]),
    vevent([
      "UID:override-series",
      "RECURRENCE-ID;TZID=America/Denver:20261110T180000",
      "DTSTART;TZID=America/Denver:20261110T180000",
      "DTEND;TZID=America/Denver:20261110T190000",
      "STATUS:CANCELLED",
      "SUMMARY:Cancelled class",
      "LOCATION:Main room",
    ]),
  ]);
  const results = extract(raw, "2026-10-27", "2026-11-11");
  assert.deepEqual(starts(results), ["2026-10-27T18:00:00-06:00", "2026-11-03T19:30:00-07:00"]);
  const moved = title(results, "Moved class")[0]!;
  assert.equal(moved.normalizedFields.venue, "Upstairs room");
  assert.equal(moved.provenance.externalId, "override-series#2026-11-03");
});

test("MONTHLY BYDAY ordinals honor COUNT and UNTIL stops", () => {
  const raw = calendar([
    vevent([
      "UID:monthly-count",
      "DTSTART;TZID=America/Denver:20260113T180000",
      "DTEND;TZID=America/Denver:20260113T190000",
      "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3",
      "SUMMARY:Second Tuesday count",
      "LOCATION:Room A",
    ]),
    vevent([
      "UID:monthly-until",
      "DTSTART;TZID=America/Denver:20260109T120000",
      "DTEND;TZID=America/Denver:20260109T130000",
      "RRULE:FREQ=MONTHLY;BYDAY=2FR;UNTIL=20260313T185959Z",
      "SUMMARY:Second Friday until",
      "LOCATION:Room B",
    ]),
    vevent([
      "UID:monthly-last-friday",
      "DTSTART;TZID=America/Denver:20260130T160000",
      "DTEND;TZID=America/Denver:20260130T170000",
      "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=2",
      "SUMMARY:Last Friday",
      "LOCATION:Room C",
    ]),
  ]);
  const results = extract(raw, "2026-01-01", "2026-04-01");
  assert.deepEqual(starts(results), [
    "2026-01-13T18:00:00-07:00",
    "2026-02-10T18:00:00-07:00",
    "2026-03-10T18:00:00-06:00",
    "2026-01-09T12:00:00-07:00",
    "2026-02-13T12:00:00-07:00",
    "2026-03-13T12:00:00-06:00",
    "2026-01-30T16:00:00-07:00",
    "2026-02-27T16:00:00-07:00",
  ]);
});

test("uses WKST to anchor an every-other-week rule", () => {
  const raw = calendar([
    vevent([
      "UID:wkst-series",
      "DTSTART;TZID=America/Denver:20261025T180000",
      "DTEND;TZID=America/Denver:20261025T190000",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,MO;COUNT=4",
      "SUMMARY:Every other week",
      "LOCATION:Room A",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-10-25", "2026-11-10")), [
    "2026-10-25T18:00:00-06:00",
    "2026-10-26T18:00:00-06:00",
    "2026-11-08T18:00:00-07:00",
    "2026-11-09T18:00:00-07:00",
  ]);
});

test("supports DAILY interval/count, negative BYMONTHDAY, and YEARLY BYMONTH", () => {
  const raw = calendar([
    vevent([
      "UID:daily-interval",
      "DTSTART;TZID=America/Denver:20261029T090000",
      "DTEND;TZID=America/Denver:20261029T100000",
      "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=4",
      "SUMMARY:Every other day",
      "LOCATION:Room A",
    ]),
    vevent([
      "UID:last-day",
      "DTSTART;TZID=America/Denver:20261031T120000",
      "DTEND;TZID=America/Denver:20261031T130000",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=2",
      "SUMMARY:Last day",
      "LOCATION:Room B",
    ]),
    vevent([
      "UID:yearly-month",
      "DTSTART;TZID=America/Denver:20251101T140000",
      "DTEND;TZID=America/Denver:20251101T150000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1;COUNT=2",
      "SUMMARY:Annual event",
      "LOCATION:Room C",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-10-01", "2026-12-01")), [
    "2026-10-29T09:00:00-06:00",
    "2026-10-31T09:00:00-06:00",
    "2026-11-02T09:00:00-07:00",
    "2026-11-04T09:00:00-07:00",
    "2026-10-31T12:00:00-06:00",
    "2026-11-30T12:00:00-07:00",
    "2026-11-01T14:00:00-07:00",
  ]);
});

test("YEARLY BYMONTH expands every selected month from the start day", () => {
  const raw = calendar([
    vevent([
      "UID:yearly-months",
      "DTSTART;TZID=America/Denver:20260101T100000",
      "DTEND;TZID=America/Denver:20260101T110000",
      "RRULE:FREQ=YEARLY;BYMONTH=1,6;COUNT=3",
      "SUMMARY:January and June",
      "LOCATION:Room D",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-01-01", "2027-01-01")), [
    "2026-01-01T10:00:00-07:00",
    "2026-06-01T10:00:00-06:00",
  ]);
});
test("uses a seven-day local window across the DST change", () => {
  const raw = calendar([
    vevent([
      "UID:seven-day-window",
      "DTSTART;TZID=America/Denver:20261018T190000",
      "DTEND;TZID=America/Denver:20261018T203000",
      "RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=5",
      "SUMMARY:Seven-day window concert",
      "LOCATION:Downtown plaza",
    ]),
  ]);
  assert.deepEqual(starts(extract(raw, "2026-10-29", "2026-11-05")), ["2026-11-01T19:00:00-07:00"]);
});
test("all-day dates and UTC timestamps keep their own representations", () => {
  const raw = calendar([
    vevent([
      "UID:all-day",
      "DTSTART;VALUE=DATE:20261101",
      "DTEND;VALUE=DATE:20261102",
      "SUMMARY:Open house",
      "LOCATION:Main gallery",
    ]),
    vevent([
      "UID:utc-time",
      "DTSTART:20261101T150000Z",
      "DTEND:20261101T170000Z",
      "SUMMARY:UTC workshop",
    ]),
    vevent([
      "UID:cancelled-single",
      "DTSTART;TZID=America/Denver:20261102T120000",
      "DTEND;TZID=America/Denver:20261102T130000",
      "STATUS:CANCELLED",
      "SUMMARY:Cancelled single event",
      "LOCATION:Room 2",
    ]),
  ]);
  const result = notices(extract(raw, "2026-11-01", "2026-11-03"));
  assert.deepEqual(
    result.map((notice) => ({
      id: notice.provenance.externalId,
      start: notice.normalizedFields.start,
      end: notice.normalizedFields.end,
      allDay: notice.normalizedFields.allDay,
      timezone: notice.normalizedFields.timezone,
    })),
    [
      {
        id: "all-day#2026-11-01",
        start: "2026-11-01",
        end: "2026-11-02",
        allDay: "true",
        timezone: undefined,
      },
      {
        id: "utc-time#2026-11-01",
        start: "2026-11-01T15:00:00Z",
        end: "2026-11-01T17:00:00Z",
        allDay: undefined,
        timezone: "UTC",
      },
    ],
  );
  assert.equal(result[0]?.formatKey, "community-arts-event-logistics");
  assert.equal(result[0]?.variant, "event");
  assert.equal(result[0]?.fields.issuer.value, "Firehouse Art Center");
  assert.equal(result[0]?.fields.venue.value, "Main gallery");
  assert.equal(result[0]?.fields.venue.locator, "VEVENT[0].LOCATION");
  assert.equal(result[1]?.fields.venue.value, "Longmont");
  assert.equal(result[1]?.fields.venue.locator, "VEVENT[1].OWNER_LOCALITY");
});

test("reads the Gravity fixture with recurring and all-day events", () => {
  const raw = readFileSync(
    new URL("./fixtures/routine-notice/gravity-events.ics", import.meta.url),
    "utf8",
  );
  const results = extract(raw, "2026-10-29", "2026-11-05");
  const parsed = notices(results);
  assert.equal(parsed.length, 20);
  assert.equal(
    results.some((result) => result.status === "refused"),
    false,
  );
  assert.deepEqual(
    parsed
      .filter((notice) => notice.normalizedFields.title === "Happy Hour")
      .map((notice) => notice.normalizedFields.start),
    [
      "2026-10-29T15:00:00-06:00",
      "2026-10-30T15:00:00-06:00",
      "2026-11-02T15:00:00-07:00",
      "2026-11-03T15:00:00-07:00",
      "2026-11-04T15:00:00-07:00",
    ],
  );
  const halloween = parsed.find((notice) => notice.normalizedFields.title === "Halloween Party")!;
  assert.equal(halloween.normalizedFields.start, "2026-10-31");
  assert.equal(halloween.normalizedFields.allDay, "true");
});

test("refuses an unsupported recurrence part instead of guessing", () => {
  const raw = calendar([
    vevent([
      "UID:unsupported-rule",
      "DTSTART;TZID=America/Denver:20261103T180000",
      "DTEND;TZID=America/Denver:20261103T190000",
      "RRULE:FREQ=MONTHLY;BYDAY=1TU;BYSETPOS=-1",
      "SUMMARY:Complicated series",
      "LOCATION:Room A",
    ]),
  ]);
  const [result] = extract(raw, "2026-10-01", "2026-12-01");
  assert.equal(result?.status, "refused");
  if (result?.status === "refused") assert.equal(result.code, "unsupported-recurrence");
});

test("reads the 1.37 MB Firehouse feed and expands its dated window", () => {
  const raw = readFileSync(
    new URL("./fixtures/routine-notice/firehouse-google.ics", import.meta.url),
    "utf8",
  );
  const results = extract(raw, "2026-10-29", "2026-11-05");
  const parsed = notices(results);
  assert.equal(parsed.length, 21);
  assert.equal(
    results.some((result) => result.status === "refused" && result.code === "content-too-large"),
    false,
  );
  const gallery = parsed.find(
    (notice) => notice.normalizedFields.title === "GALLERY HOURS- 12PM-5PM",
  )!;
  assert.equal(gallery.normalizedFields.start, "2026-10-29T12:00:00-06:00");
  assert.equal(gallery.normalizedFields.end, "2026-10-29T17:00:00-06:00");
  const market = parsed.find(
    (notice) => notice.normalizedFields.title === "Farmers Market- Market craft booth",
  )!;
  assert.equal(market.normalizedFields.start, "2026-10-31T08:00:00-06:00");
  assert.match(market.normalizedFields.venue!, /Boulder County Fairgrounds/);
  const films = parsed.find((notice) =>
    notice.normalizedFields.title.includes("Filmmakers Meetup"),
  )!;
  assert.equal(films.normalizedFields.start, "2026-11-04T02:00:00Z");
});
