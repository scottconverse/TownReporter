import assert from "node:assert/strict";
import test from "node:test";
import {
  apTimeRange,
  eligibleRoutineNotices,
  planRoutineEditions,
  type RoutineEditionOptions,
} from "./routine-notice-editions.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";

/*
  The "Today in town" story (Scott, Oct. 25 and 26 2026): events in time order,
  one block each (AP time, name, place, Free / Sign up), a dek and a first
  sentence, Morning / Afternoon / Evening headings from six events up, and a
  named source link. These tests build plans from sample notices and read the
  story the plan would print.
*/

const ZONE = "America/Denver";
const LIBRARY_CALENDAR = "https://longmontcolorado.gov/events/category/library/";
const notice = (
  formatKey: StructurallyValidRoutineNotice["formatKey"],
  fields: Record<string, string>,
  id: string,
  sourceUrl = LIBRARY_CALENDAR,
): StructurallyValidRoutineNotice => ({
  formatKey,
  variant: "event",
  provenance: {
    newsroomId: 1,
    sourceId: 1,
    sourceUrl,
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
const arts = (title: string, start: string, venue: string, id: string, more: Record<string, string> = {}) =>
  notice("community-arts-event-logistics", { issuer: "City", title, start, venue, ...more }, id);
const options: RoutineEditionOptions = {
  timezone: ZONE,
  town: "Longmont",
  sourceNames: new Map([[LIBRARY_CALENDAR, "City of Longmont library events calendar"]]),
};
function today(notices: StructurallyValidRoutineNotice[], day: string, opts: RoutineEditionOptions = options) {
  const { eligible, review } = eligibleRoutineNotices(notices, day, ZONE);
  assert.equal(review.length, 0, "the sample notices should all be printable");
  const plan = planRoutineEditions(eligible, day, opts).find((p) => p.channel === "today");
  assert.ok(plan, "a Today in town plan");
  return plan;
}

test("a two-event day prints the design's story: dek, first sentence, timed blocks, named source", () => {
  const plan = today(
    [
      arts(
        "Monsters, Myths, and Alien Invasions: an Afternoon with Astrobiologist Dr. Graham Lau",
        "2026-10-25T14:30:00-06:00",
        "Longmont Museum",
        "talk",
        { end: "2026-10-25T16:00:00-06:00" },
      ),
      notice(
        "library-notice",
        {
          issuer: "City",
          program: "Kids' Creative Movement Class",
          start: "2026-10-25T14:00:00-06:00",
          location: "Longmont Public Library",
        },
        "kids",
      ),
    ],
    "2026-10-25",
  );
  assert.equal(plan.headline, "Today in town — Sunday, Oct. 25");
  assert.equal(plan.dek, "2 events on Longmont's public calendars today.");
  assert.equal(
    plan.body,
    [
      "Here is what is on Longmont's public calendars for Sunday, Oct. 25.",
      "**2 p.m.**\nKids' Creative Movement Class\nLongmont Public Library",
      "**2:30 to 4 p.m.**\nMonsters, Myths, and Alien Invasions: an Afternoon with Astrobiologist Dr. Graham Lau\nLongmont Museum",
      `Source: [City of Longmont library events calendar](${LIBRARY_CALENDAR})`,
    ].join("\n\n"),
  );
});

test("events are in start-time order, not name order, and the order does not depend on the input order", () => {
  const sample = [
    arts("Zumba", "2026-10-25T09:00:00-06:00", "Rec Center", "z"),
    arts("Art walk", "2026-10-25T18:00:00-06:00", "Main Street", "a"),
    arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m"),
  ];
  const forward = today(sample, "2026-10-25");
  const backward = today([...sample].reverse(), "2026-10-25");
  const names = [...forward.body.matchAll(/^\*\*(.+)\*\*\n(.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(names, ["9 a.m. Zumba", "1:15 p.m. Music", "6 p.m. Art walk"]);
  assert.equal(forward.body, backward.body);
  assert.equal(forward.fingerprint, backward.fingerprint);
  assert.equal(forward.headline, backward.headline);
});

test("a corrected day still corrects: a changed time or a new event changes the fingerprint", () => {
  const base = today([arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m")], "2026-10-25");
  const moved = today([arts("Music", "2026-10-25T13:45:00-06:00", "Bandshell", "m")], "2026-10-25");
  const grown = today(
    [
      arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m"),
      arts("Zumba", "2026-10-25T09:00:00-06:00", "Rec Center", "z"),
    ],
    "2026-10-25",
  );
  assert.notEqual(moved.fingerprint, base.fingerprint);
  assert.notEqual(grown.fingerprint, base.fingerprint);
  assert.equal(
    today([arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m")], "2026-10-25").fingerprint,
    base.fingerprint,
  );
});

test("one event says '1 event'; a paper with no town names none instead of guessing one", () => {
  const one = today([arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m")], "2026-10-25");
  assert.equal(one.dek, "1 event on Longmont's public calendars today.");
  const noTown = today([arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m")], "2026-10-25", {
    timezone: ZONE,
  });
  assert.equal(noTown.dek, "1 event on the public calendars today.");
  assert.match(noTown.body, /^Here is what is on the public calendars for Sunday, Oct\. 25\.\n\n/);
  assert.doesNotMatch(noTown.body, /Longmont/);
});

test("clock times come out in AP style, in the newsroom's zone", () => {
  assert.equal(apTimeRange(14 * 60), "2 p.m.");
  assert.equal(apTimeRange(14 * 60 + 30), "2:30 p.m.");
  assert.equal(apTimeRange(14 * 60 + 30, 16 * 60), "2:30 to 4 p.m.");
  assert.equal(apTimeRange(11 * 60, 13 * 60), "11 a.m. to 1 p.m.");
  assert.equal(apTimeRange(9 * 60 + 30, 10 * 60 + 45), "9:30 to 10:45 a.m.");
  assert.equal(apTimeRange(12 * 60), "12 p.m.");
  assert.equal(apTimeRange(12 * 60, 13 * 60), "12 to 1 p.m.");
  assert.equal(apTimeRange(0), "12 a.m.");
  assert.equal(apTimeRange(14 * 60, null), "2 p.m.");
  assert.equal(apTimeRange(14 * 60, 14 * 60), "2 p.m.");

  // A UTC instant and a wall time in another zone are both read as Denver time.
  const utc = today([arts("Late", "2026-10-26T01:30:00Z", "Park", "utc")], "2026-10-25");
  assert.match(utc.body, /\*\*7:30 p\.m\.\*\*\nLate\nPark/);
  const eastern = today(
    [arts("Eastern", "2026-10-25T16:00:00", "Hall", "east", { timezone: "America/New_York" })],
    "2026-10-25",
  );
  assert.match(eastern.body, /\*\*2 p\.m\.\*\*\nEastern\nHall/);
});

test("an end time is shown only when the data has one on the same day, after the start", () => {
  const body = (extra: Record<string, string>) =>
    today([arts("Talk", "2026-10-25T14:30:00-06:00", "Museum", "t", extra)], "2026-10-25").body;
  assert.match(body({}), /\*\*2:30 p\.m\.\*\*\nTalk/);
  assert.match(body({ end: "2026-10-25T16:00:00-06:00" }), /\*\*2:30 to 4 p\.m\.\*\*\nTalk/);
  assert.match(body({ end: "2026-10-25T20:00:00-06:00" }), /\*\*2:30 to 8 p\.m\.\*\*\nTalk/);
  assert.match(body({ end: "2026-10-25T10:00:00-06:00" }), /\*\*2:30 p\.m\.\*\*\nTalk/);
  assert.match(body({ end: "2026-10-26" }), /\*\*2:30 p\.m\.\*\*\nTalk/);
  assert.match(body({ end: "2026-10-26T01:00:00-06:00" }), /\*\*2:30 p\.m\.\*\*\nTalk/);
});

test("the place line: the venue, 'Online' only with an online link and no place", () => {
  const online = today(
    [
      notice(
        "community-arts-event-logistics",
        { issuer: "City", title: "Webinar", start: "2026-10-25T10:00:00-06:00", onlineUrl: "https://meet.example/x" },
        "web",
      ),
    ],
    "2026-10-25",
  );
  assert.match(online.body, /\*\*10 a\.m\.\*\*\nWebinar\nOnline\n\n/);
  assert.doesNotMatch(online.body, /meet\.example/);
  const both = today(
    [
      notice(
        "community-arts-event-logistics",
        {
          issuer: "City",
          title: "Hybrid talk",
          start: "2026-10-25T10:00:00-06:00",
          venue: "Library",
          onlineUrl: "https://meet.example/x",
        },
        "hybrid",
      ),
    ],
    "2026-10-25",
  );
  assert.match(both.body, /\nHybrid talk\nLibrary\n\n/);
  assert.doesNotMatch(both.body, /Online/);
});

test("line four appears only when the data has it: Free for free admission, Sign up with the registration link", () => {
  const sample = today(
    [
      arts("Concert", "2026-10-25T10:00:00-06:00", "Park", "free", { admission: "Free" }),
      arts("Gala", "2026-10-25T11:00:00-06:00", "Hall", "paid", { admission: "$25 at the door" }),
      notice(
        "parks-recreation-notice",
        {
          issuer: "Parks",
          program: "Pottery",
          start: "2026-10-25T12:00:00-06:00",
          location: "Art Center",
          registrationUrl: "https://parks.example/register/pottery",
          registrationRequired: "true",
        },
        "pottery",
      ),
      notice(
        "parks-recreation-notice",
        {
          issuer: "Parks",
          program: "Open gym",
          start: "2026-10-25T13:00:00-06:00",
          location: "Rec Center",
          registrationUrl: "https://parks.example/register/gym",
          registrationRequired: "false",
        },
        "gym",
      ),
      arts("Plain talk", "2026-10-25T14:00:00-06:00", "Museum", "plain"),
    ],
    "2026-10-25",
  );
  const blocks = sample.body.split("\n\n");
  assert.equal(blocks[1], "**10 a.m.**\nConcert\nPark\nFree");
  assert.equal(blocks[2], "**11 a.m.**\nGala\nHall");
  assert.equal(blocks[3], "**12 p.m.**\nPottery\nArt Center\nSign up: https://parks.example/register/pottery");
  assert.equal(blocks[4], "**1 p.m.**\nOpen gym\nRec Center");
  assert.equal(blocks[5], "**2 p.m.**\nPlain talk\nMuseum");
});

test("a day with six or more events goes under Morning, Afternoon and Evening, with no empty heading", () => {
  const sample = [
    arts("Evening B", "2026-10-25T19:00:00-06:00", "Hall", "e2", { end: "2026-10-25T21:00:00-06:00" }),
    arts("Noon", "2026-10-25T12:00:00-06:00", "Cafe", "noon"),
    arts("Morning A", "2026-10-25T09:00:00-06:00", "Rec Center", "m1"),
    arts("Five pm", "2026-10-25T17:00:00-06:00", "Plaza", "e1"),
    arts("Before five", "2026-10-25T16:59:00-06:00", "Library", "a2"),
    arts("Late morning", "2026-10-25T11:59:00-06:00", "Park", "m2"),
    arts("Open all day", "2026-10-25", "Fairgrounds", "allday"),
  ];
  const plan = today(sample, "2026-10-25");
  assert.equal(plan.dek, "7 events on Longmont's public calendars today.");
  assert.equal(
    plan.body,
    [
      "Here is what is on Longmont's public calendars for Sunday, Oct. 25.",
      "## All day",
      "Open all day\nFairgrounds",
      "## Morning",
      "**9 a.m.**\nMorning A\nRec Center",
      "**11:59 a.m.**\nLate morning\nPark",
      "## Afternoon",
      "**12 p.m.**\nNoon\nCafe",
      "**4:59 p.m.**\nBefore five\nLibrary",
      "## Evening",
      "**5 p.m.**\nFive pm\nPlaza",
      "**7 to 9 p.m.**\nEvening B\nHall",
      `Source: [City of Longmont library events calendar](${LIBRARY_CALENDAR})`,
    ].join("\n\n"),
  );

  const allAfternoon = today(
    ["12:30", "13:30", "14:30", "15:30", "16:30", "16:45"].map((time, i) =>
      arts(`Event ${i}`, `2026-10-25T${time}:00-06:00`, "Hall", `afternoon-${i}`),
    ),
    "2026-10-25",
  );
  const headings = allAfternoon.body.split("\n\n").filter((block) => block.startsWith("## "));
  assert.deepEqual(headings, ["## Afternoon"]);
});

test("five events or fewer carry no headings", () => {
  const five = today(
    ["a", "b", "c", "d", "e"].map((id, i) => arts(`Event ${id}`, `2026-10-25T${String(i + 6).padStart(2, "0")}:00:00-06:00`, "Hall", id)),
    "2026-10-25",
  );
  assert.doesNotMatch(five.body, /^## /m);
  assert.match(five.dek!, /^5 events/);
});

test("the source line is a named link, one per source, and never a raw address as the link text", () => {
  const other = "https://museum.example/whats-on";
  const plan = today(
    [
      arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m"),
      arts("Tour", "2026-10-25T10:00:00-06:00", "Museum", "t", {}),
    ].map((item, i) => (i === 1 ? { ...item, provenance: { ...item.provenance, sourceUrl: other } } : item)),
    "2026-10-25",
    {
      ...options,
      sourceNames: new Map([
        [LIBRARY_CALENDAR, "City of Longmont library events calendar"],
        [other, "https://museum.example/whats-on"],
      ]),
    },
  );
  const lines = plan.body.split("\n\n").at(-1)!.split("\n").sort();
  assert.deepEqual(lines, [
    `Source: [City of Longmont library events calendar](${LIBRARY_CALENDAR})`,
    "Source: [museum.example](https://museum.example/whats-on)",
  ]);
  assert.doesNotMatch(plan.body, /\n(?:Source: )?https?:\/\//);
  assert.deepEqual([...plan.sourceUrls].sort(), [LIBRARY_CALENDAR, other].sort());

  // A name with markup in it cannot turn into other formatting or another link.
  const hostile = today([arts("Music", "2026-10-25T13:15:00-06:00", "Bandshell", "m")], "2026-10-25", {
    ...options,
    sourceNames: new Map([[LIBRARY_CALENDAR, "Events [click](https://evil.example) **now**"]]),
  });
  assert.doesNotMatch(hostile.body, /evil|\*\*now/);
});

test("no description, no filler, and nothing the data does not have", () => {
  const plan = today(
    [
      arts("Monsters, Myths, and Alien Invasions", "2026-10-25T14:30:00-06:00", "Longmont Museum", "talk"),
    ],
    "2026-10-25",
  );
  const lines = plan.body.split("\n").filter(Boolean);
  assert.deepEqual(lines, [
    "Here is what is on Longmont's public calendars for Sunday, Oct. 25.",
    "**2:30 p.m.**",
    "Monsters, Myths, and Alien Invasions",
    "Longmont Museum",
    `Source: [City of Longmont library events calendar](${LIBRARY_CALENDAR})`,
  ]);
  assert.doesNotMatch(`${plan.dek}\n${plan.body}`, /\b(?:AI|artificial|automated|generated|algorithm)\b/i);
});

test("notices with no clock time (hours, closures, collection days) list first, with their own facts", () => {
  const plan = today(
    [
      arts("Concert", "2026-10-25T18:00:00-06:00", "Park", "c"),
      notice(
        "library-notice",
        { issuer: "City", branch: "Main Library", effectiveDate: "2026-10-25", hours: "9 AM–5 PM" },
        "hours",
      ),
      notice(
        "waste-recycling-schedule",
        {
          issuer: "City",
          service: "Leaf collection",
          area: "North of 9th Avenue",
          serviceDate: "2026-10-24",
          endDate: "2026-10-30",
          collectionInstructions: "Bags before 7 AM.",
        },
        "leaves",
      ),
    ],
    "2026-10-25",
  );
  const blocks = plan.body.split("\n\n").slice(1, -1);
  assert.deepEqual(blocks, [
    "Leaf collection\nNorth of 9th Avenue\nThrough Friday, Oct. 30\nBags before 7 AM.",
    "Main Library\n9 AM–5 PM",
    "**6 p.m.**\nConcert\nPark",
  ]);
});

test("This weekend and Deadlines approaching keep their bullet list and raw Source line", () => {
  const friday = "2026-10-30";
  const { eligible } = eligibleRoutineNotices(
    [
      arts("Concert", "2026-10-31T18:00:00-06:00", "Park", "sat"),
      notice(
        "registration-deadline",
        {
          issuer: "College",
          program: "EMT",
          deadline: "2026-11-02",
          registrationUrl: "https://college.example/apply",
        },
        "emt",
        "https://college.example/dates",
      ),
    ],
    friday,
    ZONE,
  );
  const plans = planRoutineEditions(eligible, friday, options);
  assert.deepEqual(
    plans.map((p) => p.channel),
    ["weekend", "deadlines"],
  );
  assert.equal(
    plans[0]!.body,
    `- Concert: Oct 31, 2026 at 6:00 PM at Park\n\nSource: ${LIBRARY_CALENDAR}`,
  );
  assert.equal(
    plans[1]!.body,
    "- EMT: applications close Nov 2, 2026\n\nSource: https://college.example/dates",
  );
  assert.equal(plans[0]!.dek, undefined);
  assert.equal(plans[1]!.dek, undefined);
});

test("a day with no events plans no Today in town story", () => {
  assert.equal(planRoutineEditions([], "2026-10-25", options).length, 0);
});
