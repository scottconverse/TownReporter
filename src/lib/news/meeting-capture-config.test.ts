import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");

const source = readFileSync(new URL("./meeting-capture.ts", import.meta.url), "utf8");

describe("meeting Slice 1 configuration and honest coverage", () => {
  it("reads priority from the per-newsroom configuration table, not a code list", () => {
    assert.match(source, /from meeting_channel_priority/);
    assert.match(source, /order by position,id/);
    assert.match(source, /saveMeetingPriority/);
  });

  it("names meetings as their own coverage class with failures named", () => {
    assert.match(source, /meetings: \$\{found\.length\} found/);
    assert.match(source, /captured, \$\{failed\.length\} failed/);
    assert.match(desk, /meeting_failures/);
  });

  it("keeps both channel-listing and capture failures, named and deduplicated", async () => {
    const { namedMeetingFailures } = await import("./meeting-capture.ts");
    const failures = namedMeetingFailures(
      ["City channel: listing timed out", "City channel: listing timed out"],
      [{
        videoId: "abcdefghijk",
        channelUrl: "https://www.youtube.com/@CityofLongmont",
        title: "Planning and Zoning Commission",
        published: "2026-09-16",
        status: "failed",
        failureReason: "captions unavailable",
      }],
    );
    assert.deepEqual(failures, [
      "City channel: listing timed out",
      "Planning and Zoning Commission: captions unavailable",
    ]);
  });

  it("uses kind meeting-video semantics rather than a page-hash path", () => {
    assert.match(source, /meeting-video|runMeetingAwareness/);
    assert.doesNotMatch(source, /last_hash/);
  });
});
