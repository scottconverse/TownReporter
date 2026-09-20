import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const migrationPath = new URL("../../../migrations/0069_meeting_capture_slice3.sql", import.meta.url);
const modulePath = new URL("./meeting-transcript-artifacts.ts", import.meta.url);

describe("meeting transcript artifacts Slice 3 schema and integration", () => {
  it("adds the transcript artifact, segment, and settings tables in a new migration", () => {
    assert.equal(existsSync(migrationPath), true, "migration 0069 must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /meeting_transcript_artifacts/);
    assert.match(sql, /meeting_transcript_segments/);
    assert.match(sql, /meeting_capture_settings/);
    assert.match(sql, /storage_root/);
    assert.match(sql, /retention_mode/);
    assert.match(sql, /deletion_policy/);
    assert.match(sql, /unique \(newsroom_id, video_id, artifact_type, sha256\)/i);
    assert.match(sql, /unique \(artifact_id, segment_index\)/i);
  });

  it("is a pure writer that uses the passed SQL handle and opens no transaction of its own", () => {
    assert.equal(existsSync(modulePath), true, "meeting-transcript-artifacts.ts must exist");
    const source = readFileSync(modulePath, "utf8");
    assert.doesNotMatch(source, /withTransaction/, "writer must not open its own transaction");
    assert.match(source, /meeting_transcript_artifacts/);
    assert.match(source, /meeting_transcript_segments/);
    assert.match(source, /source_method/);
    assert.match(source, /caption_sha256/);
  });

  it("wraps capture success plus artifact and segments in one transaction in runMeetingAwareness", () => {
    const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    assert.match(source, /withTransaction/);
    assert.match(source, /const runTransaction = deps\.withTransaction \?\? withTransaction/);
    const txIndex = source.indexOf("await runTransaction(async (tx) => {");
    const successIndex = source.indexOf("await recordCaptureSuccess(tx,", txIndex);
    const artifactIndex = source.indexOf("await storeTranscript(tx,", txIndex);
    assert.ok(txIndex >= 0, "single transaction boundary exists");
    assert.ok(successIndex > txIndex, "capture success writes on the transaction handle");
    assert.ok(artifactIndex > successIndex, "artifact writes on the transaction handle after capture success");
  });
});
