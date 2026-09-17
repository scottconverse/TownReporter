import assert from "node:assert/strict";
import test from "node:test";
import { eligibleRoutineNotices, planRoutineEditions } from "./routine-notice-editions.ts";
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
    const result = eligibleRoutineNotices([n("community-arts-event-logistics", fields, "cancel")], "2026-09-08", "America/Denver");
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
