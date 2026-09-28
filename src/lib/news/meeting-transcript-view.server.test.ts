import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import {
  assertNoRequestPath,
  attachmentFilename,
  loadTranscriptView,
  readTranscriptOriginal,
  resolveTranscriptArtifact,
} from "./meeting-transcript-view.server.ts";
import { TranscriptViewRefused, transcriptPlainText } from "./meeting-transcript-view.ts";

const scratch = mkdtempSync(join(tmpdir(), "co-transcript-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function artifactFile(name: string, text: string): { path: string; sha256: string; bytes: Buffer } {
  const path = join(scratch, name);
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(path, bytes);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

type Row = Record<string, unknown>;

/** A Sql that answers the artifact select with whatever rows the caller allows. */
function fakeSql(rows: Row[]): { sql: Sql; calls: { text: string; params: unknown[] }[] } {
  const calls: { text: string; params: unknown[] }[] = [];
  const sql = {
    async query<T>(text: string, params?: unknown[]): Promise<T[]> {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params: params ?? [] });
      if (/from meeting_transcript_artifacts/.test(text)) return rows as T[];
      if (/from meeting_transcript_segments/.test(text)) {
        return [
          { segment_index: 0, start_seconds: 0, excerpt: "The meeting was called to order." },
          { segment_index: 1, start_seconds: 75, excerpt: "Councilmember Diaz moved to adopt the budget." },
        ] as T[];
      }
      if (/from meeting_capture_records/.test(text)) {
        return [{ title: "City Council Regular Meeting", published: "2026-09-22T03:00:00Z" }] as T[];
      }
      return [] as T[];
    },
  } as unknown as Sql;
  return { sql, calls };
}

describe("meeting transcript view", () => {
  it("refuses a filesystem path supplied in the request, without touching the database", async () => {
    const { sql, calls } = fakeSql([]);
    await assert.rejects(
      () =>
        loadTranscriptView(sql, {
          newsroomId: 1,
          artifactId: 7,
          requestedPath: "C:/somewhere/else/transcript.srv3",
        }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptViewRefused);
        assert.equal(error.reason, "path-from-request");
        assert.equal(error.status, 403);
        return true;
      },
    );
    // The refusal is the FIRST thing that happens: no artifact row was read, so
    // a request that names a path can never have one honoured even briefly.
    assert.deepEqual(calls, []);
    // The same rule on its own, including the shapes a query string can take.
    assert.doesNotThrow(() => assertNoRequestPath(null));
    assert.doesNotThrow(() => assertNoRequestPath("   "));
    assert.throws(() => assertNoRequestPath("/etc/passwd"));
    assert.throws(() => assertNoRequestPath(["a", "b"]));
  });

  it("refuses another newsroom's artifact, scoping the row by newsroom and answering as a missing id", async () => {
    // Newsroom 2 asks for newsroom 1's artifact: the row is filtered out by the
    // predicate, so there is nothing to return.
    const { sql, calls } = fakeSql([]);
    await assert.rejects(
      () => resolveTranscriptArtifact(sql, { newsroomId: 2, artifactId: 7 }),
      (error: unknown) => {
        assert.ok(error instanceof TranscriptViewRefused);
        assert.equal(error.reason, "other-newsroom");
        // 404, not 403: an id that is not this newsroom's must be
        // indistinguishable from an id that does not exist.
        assert.equal(error.status, 404);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.text, /where id=\$1 and newsroom_id=\$2 and artifact_type='transcript'/);
    assert.deepEqual(calls[0]!.params, [7, 2]);

    // And the same predicate is what lets the owning newsroom in.
    const owned = fakeSql([
      {
        id: 7,
        video_id: "abc123",
        storage_path: "D:/captures/newsroom-1/abc123/transcript-x.srv3",
        sha256: "a".repeat(64),
        format: "srv3",
        byte_size: 42,
        captured_at: "2026-09-22 03:10:00+00",
      },
    ]);
    const row = await resolveTranscriptArtifact(owned.sql, { newsroomId: 1, artifactId: 7 });
    assert.equal(row.id, 7);
    assert.deepEqual(owned.calls[0]!.params, [7, 1]);
  });

  it("serves the file the artifact row names, under the name it was stored with", async () => {
    const file = artifactFile("transcript-9f.srv3", "<timedtext>captions</timedtext>");
    const { sql } = fakeSql([
      {
        id: 4,
        video_id: "abc123",
        storage_path: file.path,
        sha256: file.sha256,
        format: "srv3",
        byte_size: file.bytes.byteLength,
        captured_at: "2026-09-22 03:10:00+00",
      },
    ]);
    const original = await readTranscriptOriginal(sql, { newsroomId: 1, artifactId: 4 });
    assert.equal(original.filename, "transcript-9f.srv3");
    assert.deepEqual(Buffer.from(original.bytes), file.bytes);
    assert.equal(original.storagePath, file.path);
  });

  it("refuses to serve bytes that no longer match the hash recorded on the row", async () => {
    const file = artifactFile("transcript-moved.srv3", "the file was replaced after capture");
    const { sql } = fakeSql([
      {
        id: 4,
        video_id: "abc123",
        storage_path: file.path,
        // A hash of something else: the row says one thing, the disk says another.
        sha256: "b".repeat(64),
        format: "srv3",
        byte_size: file.bytes.byteLength,
        captured_at: "2026-09-22 03:10:00+00",
      },
    ]);
    await assert.rejects(
      () => readTranscriptOriginal(sql, { newsroomId: 1, artifactId: 4 }),
      /no longer matches the hash/,
    );
    assert.equal(attachmentFilename('odd"name\\here.srv3'), "oddnamehere.srv3");
    assert.equal(attachmentFilename(""), "transcript");
  });

  it("prints every stored segment in order, with the artifact facts", async () => {
    const { sql } = fakeSql([
      {
        id: 12,
        video_id: "vid-42",
        storage_path: "D:/captures/newsroom-1/vid-42/transcript-ab.srv3",
        sha256: "c".repeat(64),
        format: "srv3",
        byte_size: 1_351_168,
        captured_at: "2026-09-22 03:10:00+00",
      },
    ]);
    const view = await loadTranscriptView(sql, { newsroomId: 1, artifactId: 12 });
    assert.deepEqual(view.lines.map((line) => line.segmentIndex), [0, 1]);
    assert.deepEqual(view.lines.map((line) => line.startSeconds), [0, 75]);
    assert.equal(view.title, "City Council Regular Meeting");
    assert.equal(view.meetingDate, "2026-09-22");
    assert.equal(view.sha256, "c".repeat(64));
    assert.equal(view.videoId, "vid-42");
    assert.equal(
      transcriptPlainText(view),
      "[00:00:00] The meeting was called to order.\n[00:01:15] Councilmember Diaz moved to adopt the budget.",
    );
  });
});
