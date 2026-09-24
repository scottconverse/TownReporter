import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("N-1 meeting channel URL validation", () => {
  it("accepts the recognizable YouTube channel forms", async () => {
    const { youtubeChannelRejectionReason } = await import("./meeting-settings.ts");
    for (const ok of [
      "https://www.youtube.com/@CityofLongmont",
      "https://youtube.com/@CityofLongmont",
      "https://www.youtube.com/channel/UCabc123",
      "https://www.youtube.com/c/SomeName",
      "https://www.youtube.com/user/someuser",
    ]) {
      assert.equal(youtubeChannelRejectionReason(ok), null, `expected accept: ${ok}`);
    }
  });

  it("rejects non-YouTube and non-channel URLs with a stated reason", async () => {
    const { youtubeChannelRejectionReason } = await import("./meeting-settings.ts");
    const bad = [
      "https://example.com/@somebody",
      "https://vimeo.com/channels/123",
      "not a url",
      "",
      "https://www.youtube.com/watch?v=L1AnMLsLwtk",
    ];
    for (const b of bad) {
      const reason = youtubeChannelRejectionReason(b);
      assert.ok(reason, `expected a rejection reason for: ${JSON.stringify(b)}`);
      assert.equal(typeof reason, "string");
    }
    assert.match(youtubeChannelRejectionReason("https://example.com/@x")!, /YouTube/i);
    assert.match(youtubeChannelRejectionReason("https://www.youtube.com/watch?v=abc")!, /video URL/i);
  });
});

describe("N-1 storage root validation", () => {
  it("rejects a relative path with a stated absolute-path error", async () => {
    const { storageRootRejectionReason } = await import("./storage-root.server.ts");
    const reason = storageRootRejectionReason("meetings/root");
    assert.ok(reason);
    assert.match(reason!, /absolute/i);
  });

  it("accepts an absolute path (including a different drive)", async () => {
    const { storageRootRejectionReason } = await import("./storage-root.server.ts");
    assert.equal(storageRootRejectionReason("D:\\TownReporter\\meetings"), null);
    assert.equal(storageRootRejectionReason("/mnt/data/meetings"), null);
  });

  it("verifies writability by an actual write and reports the failure path", async () => {
    const { assertStorageRootWritable } = await import("./storage-root.server.ts");
    const good = mkdtempSync(join(tmpdir(), "n1-writable-"));
    assert.equal(assertStorageRootWritable(good).ok, true);
    // An impossible path under a file (not a directory) must fail and name the path.
    const notADir = join(good, "iam-a-file");
    const fs = await import("node:fs");
    fs.writeFileSync(notADir, "x");
    const bad = assertStorageRootWritable(join(notADir, "child"));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not writable|Could not create/i);
  });
});

// Schema-level: the migration must add an `enabled` column, additive, default false.
describe("N-1 migration 0074", () => {
  it("adds meeting_capture_settings.enabled idempotently with default false", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../../migrations/0074_meeting_settings_enabled.sql", import.meta.url), "utf8");
    assert.match(sql, /alter table meeting_capture_settings/i);
    assert.match(sql, /add column if not exists enabled boolean not null default false/i);
  });
});
