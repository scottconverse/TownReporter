import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRISIS_RECHECK_EVERY_DAYS,
  RECHECK_EVERY_DAYS,
  RECHECK_NIGHTLY_CAP,
  SOURCE_GONE_GAP_DAYS,
  classifyRecheckFailure,
  nextRecheckFailure,
  nightlyRecheckQuota,
  planRecheckSelection,
  recheckResultWords,
} from "./registry-recheck.ts";
import { parseRecheckChanges, recheckUserMessage } from "./registry-recheck-prompt.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");

test("a night rechecks about a thirtieth of the registry, never more than the cap", () => {
  assert.equal(RECHECK_EVERY_DAYS, 30);
  assert.equal(CRISIS_RECHECK_EVERY_DAYS, 7);
  assert.equal(RECHECK_NIGHTLY_CAP, 200);
  assert.equal(nightlyRecheckQuota(0), 0);
  assert.equal(nightlyRecheckQuota(30), 1);
  assert.equal(nightlyRecheckQuota(31), 2);
  assert.equal(nightlyRecheckQuota(3000), 100);
  assert.equal(nightlyRecheckQuota(12000), 200);
  assert.equal(nightlyRecheckQuota(-4), 0);
});

test("the oldest rechecks go first, never-checked before everything", () => {
  const candidates = [
    { serviceId: 1, crisis: false, robotCheckedAt: new Date(NOW - 5 * DAY).toISOString() },
    { serviceId: 2, crisis: false, robotCheckedAt: null },
    { serviceId: 3, crisis: false, robotCheckedAt: new Date(NOW - 29 * DAY).toISOString() },
  ];
  const chosen = planRecheckSelection(candidates, NOW, { cap: 2 });
  // quota = ceil(3/30) = 1, so only the never-checked entry is due tonight.
  assert.deepEqual(chosen, [2]);
  // A cap smaller than the quota still wins.
  assert.deepEqual(planRecheckSelection(candidates, NOW, { cap: 0 }), []);
});

test("crisis services are rechecked weekly and go first", () => {
  const candidates = [
    { serviceId: 1, crisis: false, robotCheckedAt: new Date(NOW - 40 * DAY).toISOString() },
    { serviceId: 2, crisis: true, robotCheckedAt: new Date(NOW - 8 * DAY).toISOString() },
    { serviceId: 3, crisis: true, robotCheckedAt: new Date(NOW - 2 * DAY).toISOString() },
  ];
  const chosen = planRecheckSelection(candidates, NOW, { cap: 2 });
  // quota = ceil(3/30) = 1; the due crisis service is chosen ahead of the
  // older ordinary one, and the crisis service rechecked two days ago is not.
  assert.deepEqual(chosen, [2]);
});

test("only a missing page counts toward source gone", () => {
  assert.equal(classifyRecheckFailure("Fetch failed (404)"), "gone");
  assert.equal(classifyRecheckFailure("Fetch failed (410)"), "gone");
  assert.equal(classifyRecheckFailure("getaddrinfo ENOTFOUND example.org"), "gone");
  assert.equal(classifyRecheckFailure("fetch failed, cause EAI_AGAIN"), "gone");
  assert.equal(classifyRecheckFailure("Fetch failed (503)"), "other");
  assert.equal(classifyRecheckFailure("This operation was aborted"), "other");
});

test("two failures at least three days apart are what unpublish; one is not", () => {
  assert.equal(SOURCE_GONE_GAP_DAYS, 3);
  const first = nextRecheckFailure({ failures: 0, firstFailureAt: null }, NOW);
  assert.deepEqual(first, {
    failures: 1,
    firstFailureAt: new Date(NOW).toISOString(),
    sourceGone: false,
  });

  const tooSoon = nextRecheckFailure({ failures: 1, firstFailureAt: new Date(NOW - 2 * DAY) }, NOW);
  assert.equal(tooSoon.failures, 2);
  assert.equal(tooSoon.sourceGone, false);
  // The gap is still measured from the FIRST failure.
  assert.equal(tooSoon.firstFailureAt, new Date(NOW - 2 * DAY).toISOString());

  const gone = nextRecheckFailure({ failures: 1, firstFailureAt: new Date(NOW - 3 * DAY) }, NOW);
  assert.equal(gone.failures, 2);
  assert.equal(gone.sourceGone, true);
});

test("each result has plain words for the desk", () => {
  assert.match(recheckResultWords("same"), /match/);
  assert.match(recheckResultWords("changed"), /changed/);
  assert.match(recheckResultWords("source_gone"), /gone/);
  assert.match(recheckResultWords("nonsense"), /not recorded/);
});

test("the recheck prompt names the entry and the page it must answer from", () => {
  const message = recheckUserMessage({
    target: {
      serviceId: 7,
      serviceName: "Food Pantry",
      serviceHsdsId: "svc-1",
      organizationName: "Helping Hands",
      crisis: false,
      robotCheckedAt: null,
      failures: 0,
      firstFailureAt: null,
      sourceId: 3,
      sourceUrl: "https://example.org/pantry",
      sourceTier: "B",
    },
    facts: {
      version: 1,
      service: { status: "active", fees: "Free", applicationProcess: null },
      organization: { name: "Helping Hands" },
      places: [],
      phones: [],
      hours: [],
      eligibility: [],
      requiredDocuments: [],
    },
    pageTitle: "Pantry",
    pageText: "The pantry is open Monday.",
  });
  assert.match(message, /Food Pantry/);
  assert.match(message, /https:\/\/example\.org\/pantry/);
  assert.match(message, /"fees": "Free"/);
  assert.match(message, /{"resource_changes":\[\]}/);
});

test("a recheck reply with no changes reads as same; an unreadable one throws", () => {
  assert.deepEqual(parseRecheckChanges('{"resource_changes":[]}'), []);
  assert.deepEqual(parseRecheckChanges('```json\n{"resource_changes":[]}\n```'), []);
  // A malformed item is dropped; a readable item beside it is kept.
  const kept = parseRecheckChanges(
    JSON.stringify({
      resource_changes: [
        { entity_type: "service", field_name: "fees", change_kind: "field_change" },
        { entity_type: "nonsense", field_name: "", change_kind: "field_change" },
      ],
    }),
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.field_name, "fees");
  assert.throws(() => parseRecheckChanges("not json at all"), /not readable JSON/);
  assert.throws(() => parseRecheckChanges('{"leads":[]}'), /did not name its changes/);
});
