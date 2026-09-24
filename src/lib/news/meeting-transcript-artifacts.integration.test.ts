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

  it("routes capture success through the locked canonical transaction and records the immutable artifact path", () => {
    const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");
    const helperStart = source.indexOf("export async function applyCapturedMeetingTranscript");
    const helperEnd = source.indexOf("export async function recheckProvisionalMeetings", helperStart);
    const helper = source.slice(helperStart, helperEnd);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, "canonical capture helper exists");
    assert.match(helper, /return runTransaction\(async \(tx\) => \{/);
    assert.match(helper, /await lockMeetingRevisionForCapture\(tx,/);
    assert.match(helper, /const stored = await storeTranscript\(tx,/);
    assert.match(helper, /caption_path=\$4/);
    assert.match(helper, /stored\.storagePath/,
      "capture record points at the immutable stored artifact, not the mutable downloader file");

    const awarenessStart = source.indexOf("export async function runMeetingAwareness");
    const awarenessEnd = source.indexOf("export function meetingCoverageJson", awarenessStart);
    const awareness = source.slice(awarenessStart, awarenessEnd);
    assert.match(awareness, /const applied = await applyCaptured\(sql,/,
      "the ordinary first-capture path must use the same canonical helper as revisions and manual capture");
    assert.doesNotMatch(awareness, /recordCaptureSuccess/,
      "the old mutable-path capture writer must not return");
  });
});
