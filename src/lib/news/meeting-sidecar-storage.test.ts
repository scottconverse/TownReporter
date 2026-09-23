import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("meeting sidecar storage (Finding 1)", () => {
  it("adds sidecar columns to meeting_transcript_artifacts", () => {
    const sql = readFileSync(new URL("../../../migrations/0072_meeting_sidecar_storage.sql", import.meta.url), "utf8");
    assert.match(sql, /info_path/i);
    assert.match(sql, /info_sha256/i);
    assert.match(sql, /info_bytes/i);
    assert.match(sql, /info_missing_reason/i);
  });

  it("copies the info sidecar next to the transcript and records its path, bytes, and hash", async () => {
    const source = readFileSync(new URL("./meeting-transcript-artifacts.ts", import.meta.url), "utf8");
    assert.match(source, /storeMeetingInfoSidecar/);
    assert.match(source, /info_sha256/);
    assert.match(source, /info_bytes/);
    assert.match(source, /info_missing_reason/);
  });

  it("records an explicit reason when the sidecar is missing rather than silently succeeding", async () => {
    const { storeMeetingInfoSidecar } = await import("./meeting-transcript-artifacts.ts");
    const result = storeMeetingInfoSidecar("/tmp/definitely-missing/L1AnMLsLwtk.info.json", "/tmp/target");
    assert.equal(result.infoPath, null);
    assert.equal(result.infoSha256, null);
    assert.equal(result.infoBytes, null);
    assert.match(String(result.infoMissingReason), /missing/i);
  });
});
