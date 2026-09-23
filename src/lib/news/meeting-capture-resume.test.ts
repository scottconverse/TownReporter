import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

/*
  N-5 Continue: a capture the operator STOPPED must be resumable.

  Stop is delivered -- the in-flight yt-dlp child is SIGKILLed and the record is
  marked `stopped`. Continue is not. Today a stopped capture is terminal: nothing
  records that a partial exists, and re-running starts from zero.

  The behavioural test below is the one that matters. The source-shape
  assertions above it would pass on a codebase that merely mentions the words,
  so they are not allowed to stand alone.
*/


/**
 * A tiny stateful fake: one stopped record with a partial on disk, plus a
 * capturer that records the input it was given.
 */
function fakeSql(rows: { video_id: string; title: string; partial_path: string | null }[]) {
  const updates: { text: string; params: unknown[] }[] = [];
  const sql = (async () => rows as never[]) as unknown as Sql;
  sql.query = async <T = unknown>(text: string, params: unknown[] = []) => {
    if (/from meeting_capture_records/i.test(text)) return rows as T[];
    if (/from meeting_channel_priority/i.test(text)) return [{ channel_url: "https://youtube.com/@city", position: 0 }] as T[];
    if (/^\s*update meeting_capture_records/i.test(text)) { updates.push({ text, params }); return [] as T[]; }
    return [] as T[];
  };
  return { sql, updates };
}

describe("N-5 Continue: resuming a stopped meeting capture", () => {
  it("resumes a stopped capture that has a partial, and moves it to captured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-resume-"));
    const partial = join(dir, "L1AnMLsLwtk.webm.part");
    writeFileSync(partial, "partial-bytes", "utf8");

    const { sql, updates } = fakeSql([
      { video_id: "L1AnMLsLwtk", title: "City Council Regular Session", partial_path: partial },
    ]);

    let capturedInput: Record<string, unknown> | null = null;
    const { resumeStoppedMeetings } = await import("./meeting-capture.ts");
    const out = await resumeStoppedMeetings(sql, 7, {
      captureMeeting: async (input) => {
        capturedInput = input as unknown as Record<string, unknown>;
        return {
          ok: true,
          parsed: { text: "Item 1.", format: "srv3" as const, sha256: "a".repeat(64), sourcePath: partial },
          infoPath: null,
          info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
          argv: [], stdout: "", stderr: "",
        };
      },
      withTransaction: (async (fn: (tx: Sql) => Promise<unknown>) => fn(sql)) as never,
    });

    assert.equal(out.resumed, 1, "one capture resumed");
    assert.equal(out.skipped, 0, "nothing skipped");
    assert.equal((capturedInput as any)?.resume, true, "the capturer was told this is a resume, not a fresh attempt");
    assert.equal((capturedInput as any)?.videoId, "L1AnMLsLwtk", "the same video was resumed");
    const moved = updates.find((u) => /status = ''captured''|status = 'captured'/.test(u.text));
    assert.ok(moved, "the existing record must be updated to captured");
    assert.equal(moved.params[0], 7, "the update targets the newsroom");
    assert.equal(moved.params[1], "L1AnMLsLwtk", "the update targets that video's existing row");
  });

  it("skips a stopped capture with nothing on disk instead of pretending to resume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-resume-empty-"));
    const gone = join(dir, "NoFile.webm.part");
    const { sql, updates } = fakeSql([
      { video_id: "NoFile", title: "Cancelled Session", partial_path: gone },
    ]);

    let captured = false;
    const { resumeStoppedMeetings } = await import("./meeting-capture.ts");
    const out = await resumeStoppedMeetings(sql, 7, {
      captureMeeting: async () => { captured = true; return { ok: false, reason: "should not run", argv: [], stderr: "" }; },
    });

    assert.equal(captured, false, "no capturer run when there is nothing to continue");
    assert.equal(out.resumed, 0);
    assert.equal(out.skipped, 1, "reported as skipped, not silently dropped");
    assert.match(out.failures.join(" "), /no resumable partial/i, "the reason is named");
    assert.equal(updates.length, 0, "a skipped resume must not touch the record");
  });
});
