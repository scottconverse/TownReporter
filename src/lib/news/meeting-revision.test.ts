import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const infoPath = new URL("./meeting-capture-info.ts", import.meta.url);
const migrationPath = new URL("../../../migrations/0070_meeting_capture_slice4.sql", import.meta.url);

describe("meeting capture Slice 4 info sidecar", () => {
  it("exposes durationSeconds and captionRevisionTimestamp from the info sidecar", async () => {
    assert.equal(existsSync(infoPath), true, "meeting-capture-info.ts must exist");
    const { parseInfoSidecar } = await import("./meeting-capture-info.ts");
    const parsed = parseInfoSidecar({ duration: 24071, release_timestamp: 1785285797, timestamp: 1785310800 });
    assert.equal(parsed.durationSeconds, 24071);
    assert.equal(typeof parsed.videoTimestamp, "number");
    assert.equal(parsed.captionRevisionTimestamp, null);
  });

  it("reports captionRevisionTimestamp when the sidecar supplies one", async () => {
    const { parseInfoSidecar } = await import("./meeting-capture-info.ts");
    const parsed = parseInfoSidecar({ duration: 100, timestamp: 1000, caption_revision_timestamp: 2000 });
    assert.equal(parsed.captionRevisionTimestamp, 2000);
  });

  it("refuses to guess ended_at when the sidecar lacks duration or a timestamp", async () => {
    const { computeEndedAt } = await import("./meeting-capture-info.ts");
    assert.equal(computeEndedAt({ durationSeconds: null, videoTimestamp: 1000 }), null);
    assert.equal(computeEndedAt({ durationSeconds: 100, videoTimestamp: null }), null);
    const ended = computeEndedAt({ durationSeconds: 100, videoTimestamp: 1000 });
    assert.equal(ended, new Date(1100 * 1000).toISOString());
  });
});

describe("meeting capture Slice 4 revision handling", () => {
  it("marks provisional when the meeting ended within ~24 hours, final otherwise", async () => {
    const { captureDisposition } = await import("./meeting-revision.ts");
    const now = new Date("2026-01-02T12:00:00Z");
    assert.equal(captureDisposition({ endedAt: "2026-01-02T06:00:00Z", now }), "provisional");
    assert.equal(captureDisposition({ endedAt: "2025-12-01T06:00:00Z", now }), "final");
    assert.equal(captureDisposition({ endedAt: null, now }), "final");
  });

  it("detects revision by hash first, then revision timestamp, then duration", async () => {
    const { detectRevision } = await import("./meeting-revision.ts");
    assert.equal(detectRevision({ priorSha256: "a", nextSha256: "b", priorRevisionTimestamp: null, nextRevisionTimestamp: null, priorDuration: null, nextDuration: null }), "hash");
    assert.equal(detectRevision({ priorSha256: "a", nextSha256: "a", priorRevisionTimestamp: 1, nextRevisionTimestamp: 2, priorDuration: null, nextDuration: null }), "revision-timestamp");
    assert.equal(detectRevision({ priorSha256: "a", nextSha256: "a", priorRevisionTimestamp: null, nextRevisionTimestamp: null, priorDuration: 100, nextDuration: 200 }), "duration");
    assert.equal(detectRevision({ priorSha256: "a", nextSha256: "a", priorRevisionTimestamp: 1, nextRevisionTimestamp: 1, priorDuration: 100, nextDuration: 100 }), null);
  });

  it("ends provisional after two unchanged checks separated in time", async () => {
    const { nextCheckState } = await import("./meeting-revision.ts");
    const first = nextCheckState({ status: "provisional", consecutiveUnchanged: 0, lastCheckedAt: null, firstCapturedAt: "2026-01-01T00:00:00Z", now: new Date("2026-01-01T01:00:00Z"), changed: false });
    assert.equal(first.settled, false);
    assert.equal(first.consecutiveUnchanged, 1);
    const sameScan = nextCheckState({ status: "provisional", consecutiveUnchanged: 1, lastCheckedAt: "2026-01-01T01:00:00Z", firstCapturedAt: "2026-01-01T00:00:00Z", now: new Date("2026-01-01T01:00:05Z"), changed: false });
    assert.equal(sameScan.settled, false);
    assert.equal(sameScan.consecutiveUnchanged, 1);
    const second = nextCheckState({ status: "provisional", consecutiveUnchanged: 1, lastCheckedAt: "2026-01-01T01:00:00Z", firstCapturedAt: "2026-01-01T00:00:00Z", now: new Date("2026-01-01T04:00:00Z"), changed: false });
    assert.equal(second.settled, true);
    assert.equal(second.status, "final");
  });

  it("goes final at the 48-hour ceiling even while still changing, and records churn", async () => {
    const { nextCheckState } = await import("./meeting-revision.ts");
    const atCeiling = nextCheckState({ status: "provisional", consecutiveUnchanged: 0, lastCheckedAt: "2026-01-02T23:00:00Z", firstCapturedAt: "2026-01-01T00:00:00Z", now: new Date("2026-01-03T01:00:00Z"), changed: true });
    assert.equal(atCeiling.status, "final");
    assert.equal(atCeiling.settledUnderChurn, true);
  });

  it("records a post-final revision without re-provisioning", async () => {
    const { nextCheckState } = await import("./meeting-revision.ts");
    const postFinal = nextCheckState({ status: "final", consecutiveUnchanged: 2, lastCheckedAt: "2026-01-05T00:00:00Z", firstCapturedAt: "2026-01-01T00:00:00Z", now: new Date("2026-01-06T00:00:00Z"), changed: true });
    assert.equal(postFinal.status, "final");
    assert.equal(postFinal.revisionRecorded, true);
  });
});

describe("meeting capture Slice 4 schema and draft links", () => {
  it("adds provisional and revision fields plus the draft link table", () => {
    assert.equal(existsSync(migrationPath), true, "migration 0070 must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /provisional/);
    assert.match(sql, /settled_under_churn/);
    assert.match(sql, /revision_count/);
    assert.match(sql, /last_revision_at/);
    assert.match(sql, /meeting_draft_transcript_links/);
    assert.match(sql, /draft_id/);
    assert.match(sql, /artifact_id/);
    assert.match(sql, /ended_at/);
    assert.match(sql, /meeting_transcript_revisions/);
  });

  it("retains prior and new artifacts on revision", async () => {
    const { planRevisionStorage } = await import("./meeting-revision.ts");
    const plan = planRevisionStorage({ priorPath: "C:\\data\\old.srv3", newPath: "C:\\data\\new.srv3", revisionCount: 0 });
    assert.equal(plan.keepPrior, true);
    assert.equal(plan.revisionCount, 1);
    assert.notEqual(plan.archivedPriorPath, plan.newPath);
  });

  it("records which claims were affected by a draft revision", async () => {
    const { affectedClaims } = await import("./meeting-revision.ts");
    const affected = affectedClaims({ previousSha256: "a", nextSha256: "b", citations: [{ artifactId: 1, segmentIndex: 2, captionSha256: "a" }] });
    assert.equal(affected.length, 1);
    assert.equal(affected[0]?.segmentIndex, 2);
    assert.equal(affected[0]?.reason, "caption-hash-changed");
  });
});
