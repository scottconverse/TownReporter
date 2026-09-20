import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeArchive, parseArchive, reconcileArchive, archiveCorrupt } from "./meeting-capture.ts";

const records = [
  { videoId: "aaaaaaaaaaa", channelUrl: "https://youtube.com/@city", title: "Council 1", published: "2026-01-01", status: "captured" as const },
  { videoId: "bbbbbbbbbbb", channelUrl: "https://youtube.com/@city", title: "Board 1", published: "2026-01-02", status: "not-captured" as const },
];

describe("meeting capture archive is a regenerable cache", () => {
  it("database wins when the file says captured but the record says not captured", () => {
    const r = reconcileArchive("youtube bbbbbbbbbbb\n", records);
    assert.equal(r.capturedIds.has("bbbbbbbbbbb"), false);
  });

  it("database wins when the record says captured and the file omits it", () => {
    const r = reconcileArchive("youtube ccccccccccc\n", records);
    assert.equal(r.capturedIds.has("aaaaaaaaaaa"), true);
    assert.match(r.rewritten, /^youtube aaaaaaaaaaa$/m);
    assert.doesNotMatch(r.rewritten, /bbbbbbbbbbb/);
  });

  it("regenerates after deliberate corruption and is idempotent", () => {
    const corrupted = "not an archive\n\x00\x00truncated";
    const first = reconcileArchive(corrupted, records);
    const second = reconcileArchive(first.rewritten, records);
    assert.equal(first.rewritten, serializeArchive(records));
    assert.equal(second.rewritten, first.rewritten);
    assert.equal(second.changed, false);
    assert.equal(archiveCorrupt(corrupted, records), true);
    assert.deepEqual([...parseArchive(first.rewritten)], ["aaaaaaaaaaa"]);
  });

  it("never treats an archive-only video as captured", () => {
    const r = reconcileArchive("youtube zzzzzzzzzzz\n", records);
    assert.equal(r.capturedIds.has("zzzzzzzzzzz"), false);
  });
});
