import assert from "node:assert/strict";
import test from "node:test";
import { eligibleRoutineNotices, planRoutineEditions } from "./routine-notice-editions.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";
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
