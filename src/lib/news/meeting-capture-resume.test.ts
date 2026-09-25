import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

/*
  The Continue path reaches `capture({ archivePath: meetingArchivePath(newsroomId) })`
  in `src/lib/news/meeting-capture.ts`, and `meetingArchivePath()` roots at
  `meetingRuntimeRoot()`: TOWNREPORTER_DATA_ROOT, else TOWNREPORTER_DATA_DIR, else
  `process.cwd()`. These tests drive it for real, so with neither variable set the
  run left `meeting-capture/newsroom-1/yt-dlp-archive.txt` in whatever directory
  the runner started in -- a stray untracked folder at the repo root. Pin the root
  to a temp dir for this file and put the environment back afterwards.
*/
let priorDataRoot: string | undefined;

before(() => {
  priorDataRoot = process.env.TOWNREPORTER_DATA_ROOT;
  process.env.TOWNREPORTER_DATA_ROOT = mkdtempSync(join(tmpdir(), "townreporter-resume-root-"));
});

after(() => {
  if (priorDataRoot === undefined) delete process.env.TOWNREPORTER_DATA_ROOT;
  else process.env.TOWNREPORTER_DATA_ROOT = priorDataRoot;
});

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
function fakeSql(rows: { video_id: string; channel_url: string; title: string; published: string; partial_path: string | null }[]) {
  const updates: { text: string; params: unknown[] }[] = [];
  const sql = (async () => rows as never[]) as unknown as Sql;
  sql.query = async <T = unknown>(text: string, params: unknown[] = []) => {
    if (/from meeting_capture_records/i.test(text)) return rows as T[];
    if (/from newsroom_members/i.test(text)) return [{ user_id: "owner-7" }] as T[];
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
      {
        video_id: "L1AnMLsLwtk", channel_url: "https://youtube.com/@city",
        title: "City Council Regular Session", published: "2026-09-15", partial_path: partial,
      },
    ]);

    let capturedInput: Record<string, unknown> | null = null;
    let appliedInput: Record<string, unknown> | null = null;
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
      applyCapturedMeetingTranscript: (async (_sql: Sql, input: Record<string, unknown>) => {
        appliedInput = input;
        return { revised: false, settled: false, artifactId: 91, warnings: [] };
      }) as never,
    });

    assert.equal(out.resumed, 1, "one capture resumed");
    assert.equal(out.skipped, 0, "nothing skipped");
    assert.equal((capturedInput as any)?.resume, true, "the capturer was told this is a resume, not a fresh attempt");
    assert.equal((capturedInput as any)?.videoId, "L1AnMLsLwtk", "the same video was resumed");
    assert.equal((capturedInput as any)?.outputDir, dir, "yt-dlp resumes in the directory that owns the .part file");
    assert.equal((appliedInput as any)?.newsroomId, 7, "the resumed bytes enter the canonical capture pipeline");
    assert.equal((appliedInput as any)?.userId, "owner-7", "the resulting lead belongs to the newsroom owner");
    assert.equal((appliedInput as any)?.video?.id, "L1AnMLsLwtk", "the canonical pipeline receives the resumed meeting");
    assert.equal((appliedInput as any)?.result?.parsed?.sha256, "a".repeat(64), "the canonical pipeline receives the captured artifact");
    const cleared = updates.find((u) => /partial_path = null/i.test(u.text));
    assert.ok(cleared, "the partial is cleared only after canonical processing succeeds");
    assert.equal(cleared.params[0], 7, "the cleanup targets the newsroom");
    assert.equal(cleared.params[1], "L1AnMLsLwtk", "the cleanup targets that video's existing row");
  });

  it("skips a stopped capture with nothing on disk instead of pretending to resume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-resume-empty-"));
    const gone = join(dir, "NoFile.webm.part");
    const { sql, updates } = fakeSql([
      {
        video_id: "NoFile", channel_url: "https://youtube.com/@city",
        title: "Cancelled Session", published: "2026-09-15", partial_path: gone,
      },
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

  it("keeps the stopped partial when canonical artifact processing fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-resume-failed-"));
    const partial = join(dir, "Failed.webm.part");
    writeFileSync(partial, "partial-bytes", "utf8");
    const { sql, updates } = fakeSql([{
      video_id: "Failed", channel_url: "https://youtube.com/@city",
      title: "Failed Session", published: "2026-09-15", partial_path: partial,
    }]);

    const { resumeStoppedMeetings } = await import("./meeting-capture.ts");
    const out = await resumeStoppedMeetings(sql, 7, {
      captureMeeting: async () => ({
        ok: true,
        parsed: { text: "Item 1.", format: "srv3", sha256: "b".repeat(64), sourcePath: partial },
        infoPath: null,
        info: { durationSeconds: null, videoTimestamp: null, captionRevisionTimestamp: null },
        argv: [], stdout: "", stderr: "",
      }),
      applyCapturedMeetingTranscript: async () => { throw new Error("artifact write failed"); },
    });

    assert.equal(out.resumed, 0, "bytes alone are not a completed resume");
    assert.match(out.failures.join(" "), /artifact write failed/);
    assert.equal(updates.some((u) => /partial_path = null/i.test(u.text)), false,
      "the partial remains available for another Continue attempt");
  });
});
