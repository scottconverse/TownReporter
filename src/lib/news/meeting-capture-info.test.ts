import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEndedAt, parseInfoSidecar } from "./meeting-capture-info.ts";
import { captureDisposition } from "./meeting-revision.ts";

describe("meeting capture info sidecar timestamps", () => {
  it("uses a completed live stream's start time, not its later upload time", () => {
    // Observed yt-dlp metadata for City Council's Sept. 22 stream:
    // the live stream started at 01:01:31Z and the upload was published at 18:53:52Z.
    const releaseTimestamp = Date.parse("2026-09-23T01:01:31Z") / 1000;
    const uploadTimestamp = Date.parse("2026-09-23T18:53:52Z") / 1000;
    const parsed = parseInfoSidecar({
      live_status: "was_live",
      duration: 14_290,
      release_timestamp: releaseTimestamp,
      timestamp: uploadTimestamp,
    });

    assert.equal(parsed.videoTimestamp, releaseTimestamp);
    assert.equal(parsed.uploadTimestamp, uploadTimestamp);
    const endedAt = computeEndedAt(parsed);
    assert.equal(endedAt, "2026-09-23T04:59:41.000Z");
    assert.equal(captureDisposition({
      endedAt,
      now: new Date("2026-09-23T05:30:00Z"),
    }), "provisional", "the real end time is inside the 24-hour provisional window");
  });
});
