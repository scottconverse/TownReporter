import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupDisplayCaptures } from "./finding-evidence-display.ts";

const capture = (overrides = {}) => ({
  versionId: 41,
  captureEventId: null,
  url: "https://records.example.test/agenda",
  title: "Agenda",
  capturedAt: "2026-09-08T10:00:00Z",
  available: true,
  readable: true,
  excerptState: "found" as const,
  newerCapture: null,
  viewHref: "/evidence/41",
  ...overrides,
});

describe("finding evidence display groups", () => {
  it("presents one available version once while retaining its artifact and capture-event references", () => {
    const groups = groupDisplayCaptures([capture(), capture({ captureEventId: 77 })]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].artifactVersionReference, true);
    assert.deepEqual(groups[0].captureEventIds, [77]);
  });

  it("does not merge conflicting states, missing references, different versions, or metadata", () => {
    const groups = groupDisplayCaptures([
      capture(),
      capture({ captureEventId: 77, readable: false, excerptState: "no-excerpt" }),
      capture({ versionId: null, captureEventId: 78, available: false, readable: false }),
      capture({ versionId: 42, captureEventId: 79 }),
      capture({ captureEventId: 80, capturedAt: "2026-09-08T11:00:00Z" }),
    ]);

    assert.equal(groups.length, 5);
  });
});
