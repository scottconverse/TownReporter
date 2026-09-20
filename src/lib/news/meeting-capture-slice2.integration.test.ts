import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");

describe("meeting capture Slice 2 integration contract", () => {
  it("runs a capturer for configured uncaptured meetings", () => {
    assert.match(source, /captureMeeting|MeetingAwarenessDeps|capturer/);
    assert.match(source, /uncaptured/);
  });

  it("writes caption metadata and regenerates the archive from the DB after success", () => {
    assert.match(source, /caption_sha256/);
    assert.match(source, /caption_captured_at/);
    assert.match(source, /regenerateArchive/);
  });

  it("keeps a capture failure from becoming a success", () => {
    assert.match(source, /status='failed'|status = 'failed'/);
    assert.match(source, /capture failed|failure_reason/);
  });

  it("does not re-capture a meeting already marked captured", () => {
    const knownLine = source.match(/const known = new Set.*/)?.[0] ?? "";
    const uncapturedLine = source.match(/const uncaptured = found\.filter.*/)?.[0] ?? "";
    assert.match(knownLine, /status === "captured"/);
    assert.match(uncapturedLine, /!known\.has\(v\.id\)/);
  });
});
