import assert from "node:assert/strict";
import test from "node:test";
import {
  collapseEvents,
  eventArea,
  eventMatchKey,
  eventTown,
  rowsToRemove,
  type RoutineEventRow,
} from "./routine-events.ts";
import {
  eligibleRoutineNotices,
  planRoutineEditions,
  type EligibleRoutineNotice,
} from "./routine-notice-editions.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";

const notice = (
  id: string,
  title: string,
  start: string,
  venue = "Park",
): StructurallyValidRoutineNotice => ({
  formatKey: "community-arts-event-logistics",
  variant: "event",
  provenance: {
    newsroomId: 1,
    sourceId: 1,
    sourceUrl: `https://source.example/${id}`,
    policyRevision: 1,
    captureEventId: 1,
    artifactVersionId: 1,
    contentHash: "hash",
    externalId: id,
  },
  provenanceVerification: "unverified",
  fields: {
    issuer: { value: "Arts", locator: "issuer" },
    title: { value: title, locator: "title" },
    start: { value: start, locator: "start" },
    venue: { value: venue, locator: "venue" },
  },
  normalizedFields: { issuer: "Arts", title, start, venue },
  fingerprintMaterial: id,
});

const row = (overrides: Partial<RoutineEventRow> & Pick<RoutineEventRow, "id" | "sourceId">): RoutineEventRow => ({
  newsroomId: 1,
  eventKey: `event-${overrides.id}`,
  candidateKey: `candidate-${overrides.id}`,
  matchKey: "same|2026-09-08|540|park",
  title: "Concert",
  startsAt: null,
  endsAt: null,
  localDate: "2026-09-08",
  startMinutes: 540,
  allDay: false,
  place: "Park",
  town: "Longmont",
  area: "longmont",
  sourceUrl: `https://source.example/${overrides.sourceId}`,
  link: null,
  sourceIssuer: "Arts",
  sourceTitle: "Calendar",
  fields: {},
  ...overrides,
});

function withArea(
  rows: StructurallyValidRoutineNotice[],
  placement: Record<string, { area: "longmont" | "nearby"; town: string }>,
): EligibleRoutineNotice[] {
  return eligibleRoutineNotices(rows, "2026-09-08", "America/Denver").eligible.map((item) => ({
    ...item,
    ...(placement[item.notice.provenance.externalId ?? ""] ?? {}),
  }));
}

test("normalizes case, entities, punctuation and place for one event match key", () => {
  const first = eventMatchKey({
    title: "Stay &amp; Play — Friday!",
    localDate: "2026-09-08",
    startMinutes: 18 * 60,
    allDay: false,
    place: "Stone Cup, 442 High St, Lyons, CO",
  });
  const second = eventMatchKey({
    title: "stay & play friday",
    localDate: "2026-09-08",
    startMinutes: 18 * 60,
    allDay: false,
    place: "stone cup 442 high st lyons co",
  });
  assert.equal(first, second);
  assert.notEqual(
    eventMatchKey({ title: "Concert", localDate: "2026-09-08", startMinutes: 540, allDay: false }),
    eventMatchKey({
      title: "Concert",
      localDate: "2026-09-08",
      startMinutes: 540,
      allDay: false,
      place: "Park",
    }),
    "an empty place matches only another empty place",
  );
});

test("known venue town wins over the source locality, and area follows the paper city", () => {
  const known = ["Longmont", "Lyons", "Niwot"];
  assert.equal(
    eventTown("Stone Cup, 442 High St, Lyons, CO", "Longmont", known),
    "Lyons",
  );
  assert.equal(eventTown("A hall in Berthoud, CO", "Longmont", known), "Longmont");
  assert.equal(eventArea("LYONS", "Longmont"), "nearby");
  assert.equal(eventArea(" longmont ", "Longmont"), "longmont");
  assert.equal(eventArea("Lyons", ""), "longmont", "no paper city keeps today's home behavior");
});

test("collapsing keeps one line, the organizer's link and every source credit", () => {
  const rows = [
    row({ id: 10, sourceId: 10, place: "Stone Cup", sourceTitle: "Stone Cup", link: "https://organizer.example/show" }),
    row({ id: 20, sourceId: 3, place: "Stone Cup", sourceTitle: "Area calendar", link: "https://aggregator.example/show" }),
  ];
  const collapsed = collapseEvents(rows);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]!.link, "https://organizer.example/show");
  assert.deepEqual(collapsed[0]!.sourceUrls, [
    "https://source.example/10",
    "https://source.example/3",
  ]);
  assert.equal(collapsed[0]!.rows.length, 2);
});

test("an organizer tie, or no organizer match, picks the lowest source id", () => {
  const tie = collapseEvents([
    row({ id: 1, sourceId: 8, sourceTitle: "Stone Cup", link: "https://source.example/8" }),
    row({ id: 2, sourceId: 4, sourceTitle: "Stone Cup", link: "https://source.example/4" }),
  ]);
  assert.equal(tie[0]!.sourceId, 4);
  assert.equal(tie[0]!.link, "https://source.example/4");
});

test("a full read removes only unseen rows inside its window", () => {
  const insideSeen = row({ id: 1, sourceId: 1, eventKey: "seen" });
  const insideUnseen = row({ id: 2, sourceId: 1, eventKey: "gone" });
  const outsideUnseen = row({
    id: 3,
    sourceId: 1,
    eventKey: "later",
    localDate: "2026-09-16",
  });
  const seen = new Set([`${insideSeen.eventKey}\u0000${insideSeen.localDate}`]);
  assert.deepEqual(
    rowsToRemove(
      [insideSeen, insideUnseen, outsideUnseen],
      seen,
      { start: "2026-09-08", end: "2026-09-15" },
      true,
    ).map((event) => event.id),
    [2],
  );
  assert.deepEqual(
    rowsToRemove(
      [insideUnseen],
      [],
      { start: "2026-09-08", end: "2026-09-15" },
      false,
    ),
    [],
    "a partial or refused read removes nothing",
  );
});

test("Today prints Longmont first and names each Nearby town in time order", () => {
  const rows = withArea(
    [
      notice("home-noon", "Longmont noon", "2026-09-08T12:00:00-06:00"),
      notice("home-morning", "Longmont morning", "2026-09-08T09:00:00-06:00"),
      notice("lyons", "Lyons lunch", "2026-09-08T11:00:00-06:00", "Stone Cup"),
      notice("niwot", "Niwot breakfast", "2026-09-08T08:00:00-06:00", "Niwot Cafe"),
    ],
    {
      "home-noon": { area: "longmont", town: "Longmont" },
      "home-morning": { area: "longmont", town: "Longmont" },
      lyons: { area: "nearby", town: "Lyons" },
      niwot: { area: "nearby", town: "Niwot" },
    },
  );
  const [plan] = planRoutineEditions(rows, "2026-09-08", {
    timezone: "America/Denver",
    town: "Longmont",
  });
  const body = plan!.body;
  assert.match(plan!.dek!, /^4 events /);
  assert.ok(body.indexOf("Longmont morning") < body.indexOf("## Nearby"));
  assert.ok(body.indexOf("Longmont noon") < body.indexOf("## Nearby"));
  assert.ok(body.indexOf("Niwot breakfast (Niwot)") < body.indexOf("Lyons lunch (Lyons)"));
  assert.match(body, /Niwot breakfast \(Niwot\)/);
  assert.match(body, /Lyons lunch \(Lyons\)/);
});

test("with no paper city every entry stays home and the body matches the old layout byte for byte", () => {
  const rows = withArea(
    [
      notice("concert", "Concert", "2026-09-08T18:00:00-06:00"),
      notice("reading", "Reading", "2026-09-08T19:00:00-06:00"),
    ],
    {
      concert: { area: "longmont", town: "Longmont" },
      reading: { area: "longmont", town: "Longmont" },
    },
  );
  const [plan] = planRoutineEditions(rows, "2026-09-08", {
    timezone: "America/Denver",
    sourceNames: new Map([["https://source.example/concert", "Events"]]),
  });
  assert.equal(
    plan!.body,
    [
      "Here is what is on the public calendars for Tuesday, Sept. 8.",
      "**6 p.m.**\nConcert\nPark",
      "**7 p.m.**\nReading\nPark",
      "Source: [Events](https://source.example/concert)\nSource: [source.example](https://source.example/reading)",
    ].join("\n\n"),
  );
  assert.doesNotMatch(plan!.body, /## Nearby/);
});