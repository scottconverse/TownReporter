import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibleRoutineNotices,
  planRoutineEditions,
  readerDate,
  routineNoticeLabel,
} from "./routine-notice-editions.ts";
import { extractJsonLdEvents, refusalLabel } from "./routine-notice-extract.ts";
import { routineRefusalWhy } from "./routine-notice-checks.server.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";
import { collectStoryDates, routineLineParts, storyDateRows } from "../story-dates.ts";

/*
  G24-R2-1 and G24-R2-2 (Oct. 25 2026): the run card said "4 need review" with
  no reason, the routine headline printed "2026-10-25", and the story's
  "Dates in this story" box said it had no dates.
*/

const n = (fields: Record<string, string>, id: string): StructurallyValidRoutineNotice => ({
  formatKey: "community-arts-event-logistics",
  variant: "event",
  provenance: {
    newsroomId: 1,
    sourceId: 1,
    sourceUrl: `https://source.example/${id}`,
    policyRevision: 1,
    captureEventId: 1,
    artifactVersionId: 1,
    contentHash: "h",
    externalId: id,
  },
  provenanceVerification: "unverified",
  fields: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value, locator: k }])),
  normalizedFields: fields,
  fingerprintMaterial: id,
});

test("a routine headline gives the date the way a reader says it", () => {
  assert.equal(readerDate("2026-10-25"), "Sunday, Oct. 25");
  assert.equal(readerDate("2026-09-04"), "Friday, Sept. 4");
  assert.equal(readerDate("2026-03-02"), "Monday, March 2");
  const notice = n({ issuer: "Arts", title: "Concert", start: "2026-10-25T18:00:00-06:00", venue: "Park" }, "a");
  const { eligible } = eligibleRoutineNotices([notice], "2026-10-25", "America/Denver");
  const [plan] = planRoutineEditions(eligible, "2026-10-25");
  assert.equal(plan?.headline, "Today in town — Sunday, Oct. 25");
});

test("every notice sent to review comes with a plain reason and a name", () => {
  const notices = [
    n({ issuer: "Arts", title: "Fraud hearing", start: "2026-10-25T18:00:00-06:00", venue: "Hall" }, "risk"),
    n({ issuer: "Arts", title: "Talk", start: "2026-10-25T18:00:00-06:00", venue: "See https://x.example" }, "url"),
    n({ issuer: "Arts", title: "Dance", start: "2026-10-25T18:00:00-06:00", venue: "Park", eventStatus: "EventCancelled" }, "off"),
    n({ issuer: "Arts", title: "Concert", start: "2026-10-25T18:00:00-06:00", venue: "Park" }, "ok"),
  ];
  const result = eligibleRoutineNotices(notices, "2026-10-25", "America/Denver");
  assert.equal(result.review.length, 3);
  assert.equal(result.reviewWhy.length, result.review.length);
  assert.match(result.reviewWhy[0]!, /word an editor must check/);
  assert.match(result.reviewWhy[1]!, /web address/);
  assert.match(result.reviewWhy[2]!, /cancelled/);
  assert.match(routineNoticeLabel(result.review[2]!, "America/Denver"), /^Dance, Oct 25, 2026/);
});

test("a refused source item keeps its name, and the reason is in plain words", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "Event",
    "@id": "https://town.example/event/no-start",
    name: "Pumpkin  Painting",
    location: { name: "Longmont Public Library" },
  })}</script>`;
  const [result] = extractJsonLdEvents(html, {
    formatKey: "library-notice",
    provenance: {
      newsroomId: 1,
      sourceId: 1,
      sourceUrl: "https://town.example/events",
      policyRevision: 1,
      captureEventId: 1,
      artifactVersionId: 1,
      contentHash: "h",
    },
    ownerIssuer: { value: "City of Longmont", locator: "OWNER_ISSUER" },
  });
  assert.equal(result?.status, "refused");
  if (result?.status !== "refused") return;
  assert.equal(result.label, "Pumpkin Painting");
  assert.equal(routineRefusalWhy(result), "the source gives no start date or time");
  assert.match(
    routineRefusalWhy({ code: "structurally-invalid", locator: "script[1].$[0].visible-card", validation: { valid: true } as never }),
    /does not show it at that date and time/,
  );
  assert.equal(routineRefusalWhy({ code: "missing-stable-identity", locator: "x" }), "it has no link or ID we can track");
});

test("a refused item's name gives its start the way an editor reads it", () => {
  assert.equal(
    refusalLabel({ name: "Toddler Storytime", startDate: "2026-10-27T10:00:00-06:00" }),
    "Toddler Storytime, Oct 27, 2026 at 10:00 AM",
  );
  assert.equal(
    refusalLabel({ name: "Teen Night", startDate: "2026-10-30T18:30:00-06:00" }),
    "Teen Night, Oct 30, 2026 at 6:30 PM",
  );
  assert.equal(refusalLabel({ name: "Book Sale", startDate: "2026-11-02" }), "Book Sale, Nov 2, 2026");
  assert.equal(refusalLabel({ name: "Open Mic", startDate: "next Friday" }), "Open Mic, next Friday");
});

test("a routine story's box lists each printed line, not just the headline day", () => {
  assert.deepEqual(
    routineLineParts(
      "Monsters, Myths, and Alien Invasions: an Afternoon with Dr. Lau: Oct 25, 2026 at 2:30 PM at Longmont Museum",
    ),
    { what: "Monsters, Myths, and Alien Invasions: an Afternoon with Dr. Lau", note: "2:30 PM at Longmont Museum" },
  );
  assert.deepEqual(routineLineParts("Permit: applications close Oct 27, 2026 at 5:00 PM"), {
    what: "Permit",
    note: "applications close 5:00 PM",
  });
  assert.deepEqual(routineLineParts("A line with no date"), { what: "A line with no date" });

  const items = collectStoryDates([
    {
      slug: "routine-today-2026-10-25-1",
      section: "today",
      records: [],
      headline: "Today in town — Sunday, Oct. 25",
      dek: "Logistics from approved public sources.",
      published_on: "2026-10-25",
      lines: [
        { date: "2026-10-25", what: "Kids’ Creative Movement Class", note: "2:00 PM at Longmont Public Library" },
        { date: "2026-10-25", what: "Story Time", note: "10:00 AM at Longmont Public Library" },
        { date: "2026-10-25", what: "Story Time", note: "11:00 AM at Longmont Public Library" },
      ],
    },
  ]);
  assert.deepEqual(
    items.map((item) => [item.date, item.what, item.note]),
    [
      ["2026-10-25", "Kids’ Creative Movement Class", "2:00 PM at Longmont Public Library"],
      ["2026-10-25", "Story Time", "10:00 AM at Longmont Public Library"],
      ["2026-10-25", "Story Time", "11:00 AM at Longmont Public Library"],
    ],
  );
  const rows = storyDateRows(items, "routine-today-2026-10-25-1");
  assert.equal(rows.length, 3);
  assert.equal(rows[0]?.slug, undefined);
});

test("a story with no printed lines reads its dates as before", () => {
  const items = collectStoryDates([
    {
      slug: "council",
      section: "council",
      records: [],
      headline: "Council votes on budget Oct. 28",
      published_on: "2026-10-25",
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.date, "2026-10-28");
});
