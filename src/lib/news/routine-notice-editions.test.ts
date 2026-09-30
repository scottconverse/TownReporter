import assert from "node:assert/strict";
import test from "node:test";
import { eligibleRoutineNotices, plainField, planRoutineEditions } from "./routine-notice-editions.ts";
import { validateRoutineNotice, type StructurallyValidRoutineNotice } from "./routine-notice-types.ts";
const n = (
  formatKey: StructurallyValidRoutineNotice["formatKey"],
  fields: Record<string, string>,
  id: string,
): StructurallyValidRoutineNotice => ({
  formatKey,
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
  fields: Object.fromEntries(
    Object.entries(fields).map(([k, value]) => [k, { value, locator: k }]),
  ),
  normalizedFields: fields,
  fingerprintMaterial: id,
});
/*
  The patterns `StoryBody` applies when `publicReading` is on
  (src/components/story-body.tsx): `[text](https://…)`, `**bold**`,
  `*em*` / `_em_`, and a bare `https://…`. A routine edition publishes with no
  editor, so nothing outside its owner-approved `Source:` lines may trip one.
*/
const PUBLIC_READING =
  /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(.+?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*|(?<![A-Za-z0-9])_([^\s_](?:[^_\n]*[^\s_])?)_(?![A-Za-z0-9])|(https?:\/\/[^\s<>]+)/g;
function assertNoReaderMarkup(body: string) {
  for (const line of body.split("\n")) {
    if (line.startsWith("Source: ")) continue;
    PUBLIC_READING.lastIndex = 0;
    assert.doesNotMatch(line, PUBLIC_READING, `reader markup reached the body: ${line}`);
  }
}
test("plans bounded Today, Friday weekend, and approaching-deadline editions without filler", () => {
  const notices = [
    n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: "Concert", start: "2026-09-08T18:00:00-06:00", venue: "Park" },
      "a",
    ),
    n(
      "parks-recreation-notice",
      { issuer: "Parks", program: "Walk", start: "2026-09-11T09:00:00-06:00", location: "Trail" },
      "b",
    ),
    n(
      "registration-deadline",
      {
        issuer: "College",
        program: "EMT",
        deadline: "2026-09-12",
        registrationUrl: "https://college.example/apply",
      },
      "c",
    ),
  ];
  const result = eligibleRoutineNotices(notices, "2026-09-08", "America/Denver");
  assert.deepEqual(
    result.eligible.map((x) => x.channel),
    ["today", "weekend", "deadlines"],
  );
  const plans = planRoutineEditions(result.eligible, "2026-09-08");
  assert.equal(plans.length, 3);
  assert.match(plans[0]!.body, /Source: https:\/\/source\.example\/a/);
  assert.equal(planRoutineEditions([], "2026-09-08").length, 0);
});
test("assigns offset timestamps by the configured newsroom local day", () => {
  const notice = n(
    "community-arts-event-logistics",
    { issuer: "Arts", title: "Late concert", start: "2026-09-09T01:30:00Z", venue: "Park" },
    "late",
  );
  assert.equal(
    eligibleRoutineNotices([notice], "2026-09-08", "America/Denver").eligible[0]?.channel,
    "today",
  );
  assert.equal(eligibleRoutineNotices([notice], "2026-09-08", "UTC").eligible.length, 0);
});
test("includes Friday notices in Friday's weekend edition", () => {
  const notice = n("community-arts-event-logistics", { issuer: "Arts", title: "Friday concert", start: "2026-09-11T18:00:00-06:00", venue: "Park" }, "fri");
  assert.deepEqual(eligibleRoutineNotices([notice], "2026-09-11", "America/Denver").eligible.map((item) => item.channel), ["today", "weekend"]);
});

test("keeps a multi-day collection range and source instructions in the edition", () => {
  const notice = n(
    "waste-recycling-schedule",
    {
      issuer: "City of Longmont",
      service: "Fall leaf collection",
      area: "North of 9th Avenue",
      serviceDate: "2026-10-26",
      endDate: "2026-10-30",
      collectionInstructions: "Bags before 7 AM Monday; leave them out all week.",
    },
    "fall-leaf-north",
  );
  notice.variant = "regular";
  const Wednesday = eligibleRoutineNotices([notice], "2026-10-28", "America/Denver");
  assert.deepEqual(Wednesday.eligible.map((item) => item.channel), ["today", "weekend"]);
  assert.equal(Wednesday.eligible[0]!.channel, "today");
  assert.match(Wednesday.eligible[0]!.line, /Oct 26, 2026.*Oct 30, 2026/);
  assert.match(Wednesday.eligible[0]!.line, /Bags before 7 AM Monday; leave them out all week/);

  const Friday = eligibleRoutineNotices([notice], "2026-10-30", "America/Denver");
  assert.deepEqual(
    Friday.eligible.map((item) => item.channel),
    ["today", "weekend"],
  );
});
test("converts named-zone wall times into the newsroom day and labels the source zone", () => {
  const notice = n("registration-deadline", { issuer: "City", program: "Permit", deadline: "2026-09-09T00:30:00", registrationUrl: "https://city.example/apply", timezone: "America/New_York" }, "zone");
  const result = eligibleRoutineNotices([notice], "2026-09-08", "America/Denver");
  assert.equal(result.eligible[0]?.channel, "deadlines");
  assert.match(result.eligible[0]!.line, /Sep 8, 2026 at 10:30 PM America\/Denver/);
});
test("routes allegation-like free text to review and never renders it", () => {
  const risky = n(
    "community-arts-event-logistics",
    {
      issuer: "Arts",
      title: "Fraud allegation hearing",
      start: "2026-09-08T18:00:00-06:00",
      venue: "Hall",
    },
    "risk",
  );
  const result = eligibleRoutineNotices([risky], "2026-09-08");
  assert.equal(result.eligible.length, 0);
  assert.equal(result.review.length, 1);
});
test("routes explicit cancellation and non-scheduled event statuses to review", () => {
  for (const fields of [
    { issuer: "Arts", title: "Concert", start: "2026-09-08T18:00:00-06:00", venue: "Park", eventStatus: "EventCancelled" },
    { issuer: "Arts", title: "Concert", start: "2026-09-08T18:00:00-06:00", venue: "Park", cancellation: "postponed" },
  ]) {
    const result = eligibleRoutineNotices([n("community-arts-event-logistics", fields as unknown as Record<string, string>, "cancel")], "2026-09-08", "America/Denver");
    assert.equal(result.eligible.length, 0);
    assert.equal(result.review.length, 1);
  }
});
test("uses the validator's normalized scheduled status while retaining cancelled review", () => {
  const base = n("community-arts-event-logistics", { issuer: "Arts", title: "Concert", start: "2026-09-08T18:00:00-06:00", venue: "Park" }, "validated-status");
  for (const [status, expected] of [["EventScheduled", 1], ["EventCancelled", 0]] as const) {
    const validation = validateRoutineNotice({ ...base, fields: { ...base.fields, eventStatus: { value: status, locator: "eventStatus" } } });
    assert.equal(validation.valid, true);
    if (!validation.valid) continue;
    const result = eligibleRoutineNotices([validation.notice], "2026-09-08", "America/Denver");
    assert.equal(result.eligible.length, expected);
    assert.equal(result.review.length, expected ? 0 : 1);
  }
});

test("renders decoded titles and newsroom-local human dates", () => {
  const notice = n(
    "community-arts-event-logistics",
    {
      issuer: "City",
      title: "All Ages Stay &amp; Play Friday",
      start: "2026-09-11T16:30:00Z",
      venue: "Longmont Public Library",
    },
    "decoded-title",
  );
  const result = eligibleRoutineNotices([notice], "2026-09-11", "America/Denver");
  assert.match(result.eligible[0]!.line, /All Ages Stay & Play Friday/);
  assert.match(result.eligible[0]!.line, /Sep 11, 2026 at 10:30 AM/);
  assert.doesNotMatch(result.eligible[0]!.line, /&amp;|2026-09-11T16:30:00Z/);
});

test("does not shift date-only deadline values across timezones", () => {
  const notice = n(
    "registration-deadline",
    {
      issuer: "City",
      program: "Permit",
      deadline: "2026-09-12",
      registrationUrl: "https://city.example/apply",
    },
    "date-only-display",
  );
  const result = eligibleRoutineNotices([notice], "2026-09-12", "America/Los_Angeles");
  assert.match(result.eligible[0]!.line, /Sep 12, 2026/);
  assert.doesNotMatch(result.eligible[0]!.line, /Sep 11, 2026/);
});

test("sends a notice whose text carries a web address or a markdown link to review and publishes none of it", () => {
  const attacker = n(
    "community-arts-event-logistics",
    {
      issuer: "Arts",
      title: "Free concert [claim tickets](https://evil.example/login) **today**",
      start: "2026-09-08T18:00:00-06:00",
      venue: "Park https://evil2.example/x",
    },
    "attacker",
  );
  const result = eligibleRoutineNotices([attacker], "2026-09-08", "America/Denver");
  assert.equal(result.eligible.length, 0);
  assert.deepEqual(
    result.review.map((x) => x.provenance.externalId),
    ["attacker"],
  );
  const plans = planRoutineEditions(result.eligible, "2026-09-08");
  assert.equal(plans.length, 0);
  for (const plan of plans) assert.doesNotMatch(plan.body, /evil/);
});

test("publishes emphasis characters as plain words, never as reader formatting", () => {
  const notice = n(
    "community-arts-event-logistics",
    {
      issuer: "Arts",
      title: "**Storytime** _today_",
      start: "2026-09-08T18:00:00-06:00",
      venue: "Park",
    },
    "plain-storytime",
  );
  const result = eligibleRoutineNotices([notice], "2026-09-08", "America/Denver");
  assert.equal(result.review.length, 0);
  assert.equal(result.eligible.length, 1);
  assert.match(result.eligible[0]!.line, /^Storytime today: /);
  assert.doesNotMatch(result.eligible[0]!.line, /[*_`#[\]<>]/);
});

test("sends an over-long source field to review instead of truncating what would publish", () => {
  const notice = (title: string, id: string) =>
    n(
      "community-arts-event-logistics",
      { issuer: "Arts", title, start: "2026-09-08T18:00:00-06:00", venue: "Park" },
      id,
    );
  assert.equal(
    eligibleRoutineNotices([notice("L".repeat(160), "at-limit")], "2026-09-08", "America/Denver")
      .eligible.length,
    1,
  );
  const tooLong = eligibleRoutineNotices(
    [notice("L".repeat(161), "too-long")],
    "2026-09-08",
    "America/Denver",
  );
  assert.equal(tooLong.eligible.length, 0);
  assert.deepEqual(
    tooLong.review.map((x) => x.provenance.externalId),
    ["too-long"],
  );
});

test("publishes plain text only for every routine format's line", () => {
  const notices = [
    n(
      "library-notice",
      {
        issuer: "Library",
        branch: "Main Library",
        effectiveDate: "2026-09-08",
        hours: "9 AM–5 PM (closed 12–1); call 303-555-0100.",
      },
      "plain-hours",
    ),
    n(
      "parks-recreation-notice",
      {
        issuer: "Parks",
        program: "Fall trail walk",
        start: "2026-09-08T09:00:00-06:00",
        location: "Rogers Grove (south lot)",
      },
      "plain-parks",
    ),
    n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: "**Storytime** _today_", start: "2026-09-08T18:00:00-06:00", venue: "Park" },
      "plain-arts",
    ),
    n(
      "registration-deadline",
      {
        issuer: "College",
        program: "EMT certification",
        deadline: "2026-09-12",
        registrationUrl: "https://college.example/apply",
      },
      "plain-deadline",
    ),
    n(
      "waste-recycling-schedule",
      {
        issuer: "City",
        service: "Leaf collection",
        area: "North of 9th Ave",
        serviceDate: "2026-09-08",
        collectionInstructions: "Bags `out` by 7 AM; #3 cans, please.",
      },
      "plain-waste",
    ),
    n(
      "public-meeting-logistics",
      {
        issuer: "City",
        title: "City Council [regular session]",
        start: "2026-09-08T19:00:00-06:00",
        venue: "Civic Center",
        agendaUrl: "https://city.example/agenda",
      },
      "plain-meeting",
    ),
  ];
  notices[4]!.variant = "regular";
  const result = eligibleRoutineNotices(notices, "2026-09-08", "America/Denver");
  assert.equal(result.review.length, 0);
  assert.equal(result.eligible.length, notices.length);
  for (const entry of result.eligible) {
    assert.doesNotMatch(entry.line, /[*_`#[\]<>]/, `formatting character survived: ${entry.line}`);
  }
  // Ordinary punctuation is not collateral damage.
  assert.match(
    result.eligible.find((x) => x.line.includes("9 AM"))!.line,
    /9 AM–5 PM \(closed 12–1\); call 303-555-0100\./,
  );
  // The pattern set is live: the uncleaned attacker line does trip it.
  PUBLIC_READING.lastIndex = 0;
  assert.match(
    "Free concert [claim tickets](https://evil.example/login) **today**",
    PUBLIC_READING,
  );
  const plans = planRoutineEditions(result.eligible, "2026-09-08");
  assert.equal(plans.length, 2);
  for (const plan of plans) assertNoReaderMarkup(plan.body);
});

/*
  Source text that reads as an ordinary field until `plainField` decodes its
  entities and drops its markup characters — at which point it is a live URL in
  the published line. Detection that only inspects the raw value sees none of
  these; detection on the cleaned value sees all of them.
*/
const SOURCE_FIELD_EXPLOITS = [
  "&#104;ttps://evil.example/login",
  "h&#116;tps://evil.example",
  "https&colon;//evil.example",
  "ht*tps://evil.example",
  "ht_tps://evil.example/x",
  "htt[]ps://evil.example",
];
// Every source-field value these tests feed through `plainField`, including the
// punctuation the edition must keep.
const PLAIN_FIELD_VALUES = [
  ...SOURCE_FIELD_EXPLOITS,
  "**Storytime** _today_",
  "All Ages Stay &amp; Play Friday",
  "9 AM–5 PM (closed 12–1); call 303-555-0100.",
  "Bags `out` by 7 AM; #3 cans, please.",
  "Bags before 7 AM Monday; leave them out all week.",
  "City Council [regular session]",
  "Rogers Grove (south lot)",
  "North of 9th Avenue",
  "Main Library",
  "Civic Center",
  "L".repeat(160),
  "L".repeat(161),
];
test("sends source text that only reads as a web address after cleaning to review", () => {
  for (const [index, exploit] of SOURCE_FIELD_EXPLOITS.entries()) {
    // The raw value evades a raw-text check, and the cleaned value is a URL.
    assert.doesNotMatch(exploit, /https?:\/\/|www\.|\]\(/i, `raw text already looked like a URL: ${exploit}`);
    assert.match(plainField(exploit), /:\/\//, `not a URL once cleaned: ${exploit}`);
    const inProgram = n(
      "parks-recreation-notice",
      { issuer: "Parks", program: exploit, start: "2026-09-30T10:00:00-06:00", location: "Trail" },
      `evade-program-${index}`,
    );
    const program = eligibleRoutineNotices([inProgram], "2026-09-30", "America/Denver");
    assert.equal(program.eligible.length, 0, `program published: ${exploit}`);
    assert.deepEqual(
      program.review.map((x) => x.provenance.externalId),
      [`evade-program-${index}`],
      `program not reviewed: ${exploit}`,
    );
    const inTitle = n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: exploit, start: "2026-09-30T18:00:00-06:00", venue: "Park" },
      `evade-title-${index}`,
    );
    const title = eligibleRoutineNotices([inTitle], "2026-09-30", "America/Denver");
    assert.equal(title.eligible.length, 0, `title published: ${exploit}`);
    assert.equal(title.review.length, 1, `title not reviewed: ${exploit}`);
    const inVenue = n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: "Storytime", start: "2026-09-30T18:00:00-06:00", venue: exploit },
      `evade-venue-${index}`,
    );
    const venue = eligibleRoutineNotices([inVenue], "2026-09-30", "America/Denver");
    assert.equal(venue.eligible.length, 0, `venue published: ${exploit}`);
    assert.equal(venue.review.length, 1, `venue not reviewed: ${exploit}`);
  }
});
test("publishes no edition body from evasive source text", () => {
  const notices = SOURCE_FIELD_EXPLOITS.flatMap((exploit, index) => [
    n(
      "parks-recreation-notice",
      { issuer: "Parks", program: exploit, start: "2026-09-30T10:00:00-06:00", location: "Trail" },
      `body-program-${index}`,
    ),
    n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: exploit, start: "2026-09-30T18:00:00-06:00", venue: "Park" },
      `body-title-${index}`,
    ),
    n(
      "community-arts-event-logistics",
      { issuer: "Arts", title: "Storytime", start: "2026-09-30T18:00:00-06:00", venue: exploit },
      `body-venue-${index}`,
    ),
  ]);
  const result = eligibleRoutineNotices(notices, "2026-09-30", "America/Denver");
  assert.equal(result.eligible.length, 0);
  assert.equal(result.review.length, notices.length);
  const plans = planRoutineEditions(result.eligible, "2026-09-30");
  assert.equal(plans.length, 0);
  for (const plan of plans) {
    assert.doesNotMatch(plan.body, /evil/);
    assertNoReaderMarkup(plan.body);
  }
});
test("cleaning a source field is idempotent, so detection sees the published text", () => {
  for (const value of PLAIN_FIELD_VALUES) {
    assert.equal(
      plainField(plainField(value)),
      plainField(value),
      `plainField is not idempotent for: ${value}`,
    );
  }
});
