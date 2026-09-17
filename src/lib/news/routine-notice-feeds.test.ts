import assert from "node:assert/strict";
import test from "node:test";
import {
  extractApplicationDeadlines,
  extractLibraryHours,
  extractRoutineIcs,
} from "./routine-notice-feeds.ts";
const provenance = {
  newsroomId: 1,
  sourceId: 2,
  sourceUrl: "https://example.test/feed",
  policyRevision: 3,
  captureEventId: 4,
  artifactVersionId: 5,
  contentHash: "abc",
};
test("extracts an explicit Schema.org application deadline without treating Event end dates as deadlines", () => {
  const html = `<script type="application/ld+json">{"@type":"EducationalOccupationalProgram","@id":"program-1","name":"Fall EMT program","applicationDeadline":"2026-10-01","url":"https://college.example/apply","provider":{"name":"Front Range College"}}</script><script type="application/ld+json">{"@type":"Event","@id":"event-1","name":"Open house","endDate":"2026-09-20"}</script>`;
  const rows = extractApplicationDeadlines(html, provenance);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "parsed");
  if (rows[0]?.status === "parsed" && rows[0].validation.valid)
    assert.equal(rows[0].validation.notice.normalizedFields.deadline, "2026-10-01");
});
test("extracts designated waste and deadline RFC5545 events without exposing a residential feed URL", () => {
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:pickup-1\r\nDTSTART;VALUE=DATE:20260910\r\nSUMMARY:Recycling pickup\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const waste = extractRoutineIcs(ics, "waste", {
    provenance,
    issuer: "City sanitation",
    locality: "Longmont",
    collectionArea: "North collection area",
  });
  assert.equal(waste[0]?.status, "parsed");
  if (waste[0]?.status === "parsed" && waste[0].validation.valid) {
    assert.equal(waste[0].validation.notice.normalizedFields.area, "North collection area");
    assert.equal(JSON.stringify(waste[0]).includes("feed"), true);
  }
  const deadline = extractRoutineIcs(
    ics
      .replace("Recycling pickup", "Applications close")
      .replace("pickup-1", "deadline-1")
      .replace("END:VEVENT", "URL:https://college.example/apply\r\nEND:VEVENT"),
    "deadline",
    { provenance, issuer: "City programs", locality: "Longmont" },
  );
  assert.equal(deadline[0]?.status, "parsed");
});
test("extracts dated Schema.org special hours and explicit midnight closure", () => {
  const html = `<script type="application/ld+json">{"@type":"Library","@id":"library-1","name":"Main branch","specialOpeningHoursSpecification":[{"@type":"OpeningHoursSpecification","validFrom":"2026-09-10","opens":"09:00","closes":"17:00"},{"@type":"OpeningHoursSpecification","validFrom":"2026-09-11","opens":"00:00","closes":"00:00"}]}</script>`;
  const rows = extractLibraryHours(html, {
    provenance,
    issuer: "City Library",
    branch: "Main branch",
  });
  assert.deepEqual(
    rows.map((row) =>
      row.status === "parsed" && row.validation.valid ? row.validation.notice.variant : null,
    ),
    ["planned-hours", "closure"],
  );
});
test("refuses another place, excluded weekday, date range, and invalid special-hours clocks", () => {
  const row = (parent: string, spec: string) =>
    `<script type="application/ld+json">{"@type":"${parent}","@id":"x","name":"Other branch","specialOpeningHoursSpecification":[${spec}]}</script>`;
  const base = `{"validFrom":"2026-09-10","opens":"09:00","closes":"17:00"}`;
  assert.equal(
    extractLibraryHours(row("CafeOrCoffeeShop", base), {
      provenance,
      issuer: "City",
      branch: "Main branch",
    }).length,
    0,
  );
  for (const spec of [
    `{"validFrom":"2026-09-10","dayOfWeek":"https://schema.org/Monday","opens":"09:00","closes":"17:00"}`,
    `{"validFrom":"2026-09-10","validThrough":"2026-09-12","opens":"09:00","closes":"17:00"}`,
    `{"validFrom":"2026-09-10","opens":"25:00","closes":"17:00"}`,
  ]) {
    const rows = extractLibraryHours(row("Library", spec).replace("Other branch", "Main branch"), {
      provenance,
      issuer: "City",
      branch: "Main branch",
    });
    assert.equal(rows[0]?.status, "refused");
  }
});
test("fails closed on cancelled, recurring, duplicate, nested-alarm, and unzoned local calendar events", () => {
  const base = (extra: string) =>
    `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;TZID=America/Denver:20260910T090000\r\nSUMMARY:Real service\r\nURL:https://city.example/register\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  for (const extra of [
    "STATUS:CANCELLED",
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Duplicate",
    "BEGIN:VALARM\r\nSUMMARY:Alarm text\r\nEND:VALARM",
  ]) {
    const rows = extractRoutineIcs(base(extra), "deadline", {
      provenance,
      issuer: "City",
      locality: "Longmont",
    });
    assert.equal(
      rows.some((row) => row.status === "parsed"),
      false,
    );
  }
  const methodCancelled = extractRoutineIcs(base("").replace("BEGIN:VCALENDAR", "BEGIN:VCALENDAR\r\nMETHOD:CANCEL"), "deadline", {
    provenance,
    issuer: "City",
    locality: "Longmont",
  });
  assert.equal(methodCancelled.some((row) => row.status === "parsed"), false);
  const unzoned = extractRoutineIcs(
    base("").replace("DTSTART;TZID=America/Denver:20260910T090000", "DTSTART:20260910T090000"),
    "deadline",
    {
    provenance,
    issuer: "City",
    locality: "Longmont",
    },
  );
  assert.equal(unzoned[0]?.status, "refused");
  const zoned = extractRoutineIcs(
    base(""),
    "deadline",
    { provenance, issuer: "City", locality: "Longmont" },
  );
  assert.equal(zoned[0]?.status, "parsed");
});
