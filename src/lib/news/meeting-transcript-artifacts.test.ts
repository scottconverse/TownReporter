import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";

const modulePath = new URL("./meeting-transcript-artifacts.ts", import.meta.url);

describe("meeting transcript artifacts Slice 3", () => {
  it("requires an absolute configured storage root and never falls back to the app directory", async () => {
    assert.equal(existsSync(modulePath), true, "meeting-transcript-artifacts.ts must exist");
    const { resolveMeetingStorageRoot } = await import("./meeting-transcript-artifacts.ts");
    assert.throws(() => resolveMeetingStorageRoot(null), /storage root/i);
    assert.throws(() => resolveMeetingStorageRoot("relative/root"), /absolute/i);
    const resolved = resolveMeetingStorageRoot("C:\\TownReporterData\\meetings");
    assert.equal(resolved, "C:\\TownReporterData\\meetings");
  });

  it("parses caption bytes into timestamped segments with verbatim excerpts", async () => {
    const { parseTranscriptSegments } = await import("./meeting-transcript-artifacts.ts");
    const segments = parseTranscriptSegments("Hello council.\nThen the vote passed.", "abc123");
    assert.equal(segments.length, 2);
    assert.equal(segments[0]?.segmentIndex, 0);
    assert.equal(segments[0]?.excerpt, "Hello council.");
    assert.equal(segments[0]?.captionSha256, "abc123");
    assert.equal(typeof segments[0]?.startSeconds, "number");
    assert.equal(typeof segments[1]?.startSeconds, "number");
    assert.ok(segments[1]!.startSeconds >= segments[0]!.startSeconds);
  });

  it("persists the real caption cue times when the parser provides them", async () => {
    const { parseCaptionFile } = await import("./caption-parse.ts");
    const { storeMeetingTranscriptArtifact } = await import("./meeting-transcript-artifacts.ts");
    const root = mkdtempSync(join(tmpdir(), "townreporter-real-caption-times-"));
    try {
      const raw = '<?xml version="1.0"?><timedtext><body><p t="1250" d="2750">Opening</p><p t="8500" d="1500">Vote called</p></body></timedtext>';
      const sourcePath = join(root, "timed.srv3");
      writeFileSync(sourcePath, raw, "utf8");
      const insertedSegments: unknown[][] = [];
      const sql = (async () => [] as never[]) as unknown as Sql;
      sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        if (/select storage_root/i.test(text)) return [{ storage_root: root }] as T[];
        if (/select retention_mode/i.test(text)) return [{ retention_mode: "transcript-only" }] as T[];
        if (/insert into meeting_transcript_artifacts/i.test(text)) return [{ id: 1, captured_at: "2026-09-23T00:00:00Z" }] as T[];
        if (/insert into meeting_transcript_segments/i.test(text)) { insertedSegments.push(params); return [] as T[]; }
        throw new Error(`unexpected query: ${text}`);
      };

      await storeMeetingTranscriptArtifact(sql, {
        newsroomId: 1,
        videoId: "timed-video",
        parsed: parseCaptionFile(raw, sourcePath),
      });

      assert.deepEqual(insertedSegments.map((params) => [params[2], params[3], params[5]]), [
        [1.25, 4, "Opening"],
        [8.5, 10, "Vote called"],
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a citation by segment index and by timestamp to item, timestamp, excerpt, hash, path", async () => {
    const { resolveTranscriptCitation } = await import("./meeting-transcript-artifacts.ts");
    const artifact = { id: 7, storagePath: "C:\\data\\meet.srv3", sha256: "abc123" };
    const segments = [
      { segmentIndex: 0, startSeconds: 0, endSeconds: 4, item: null, excerpt: "First", captionSha256: "abc123" },
      { segmentIndex: 1, startSeconds: 12, endSeconds: 20, item: "Item 3", excerpt: "The vote passed 6-1.", captionSha256: "abc123" },
    ];
    const byIndex = resolveTranscriptCitation({ artifact, segments, segmentIndex: 1 });
    assert.equal(byIndex.item, "Item 3");
    assert.equal(byIndex.timestampSeconds, 12);
    assert.equal(byIndex.excerpt, "The vote passed 6-1.");
    assert.equal(byIndex.captionSha256, "abc123");
    assert.equal(byIndex.storagePath, "C:\\data\\meet.srv3");
    const byTime = resolveTranscriptCitation({ artifact, segments, timestampSeconds: 14 });
    assert.equal(byTime.segmentIndex, 1);
    assert.equal(byTime.excerpt, "The vote passed 6-1.");
  });

  it("retention modes are operator-configured behavior and no mode deletes automatically", async () => {
    const { retentionPlan } = await import("./meeting-transcript-artifacts.ts");
    for (const mode of ["media", "audio-only", "transcript-only"] as const) {
      const plan = retentionPlan(mode);
      assert.equal(plan.retentionMode, mode);
      assert.equal(plan.keepsTranscript, true);
      assert.equal(plan.automaticDeletion, false);
    }
    assert.deepEqual(retentionPlan("media").allows, ["media", "audio-only", "transcript-only"]);
    assert.deepEqual(retentionPlan("transcript-only").allows, ["transcript-only"]);
  });

  it("preserves different caption and info revisions as separately hash-addressed files", async () => {
    const { storeMeetingTranscriptArtifact } = await import("./meeting-transcript-artifacts.ts");
    const root = mkdtempSync(join(tmpdir(), "townreporter-meeting-artifacts-"));
    try {
      const captionA = "WEBVTT\n\n00:00.000 --> 00:04.000\nOriginal words\n";
      const captionB = "WEBVTT\n\n00:00.000 --> 00:04.000\nCorrected words\n";
      const infoA = JSON.stringify({ id: "meeting-1", duration: 60, revision: 1 });
      const infoB = JSON.stringify({ id: "meeting-1", duration: 61, revision: 2 });
      const captionAPath = join(root, "capture-a.vtt");
      const captionBPath = join(root, "capture-b.vtt");
      const infoAPath = join(root, "capture-a.info.json");
      const infoBPath = join(root, "capture-b.info.json");
      writeFileSync(captionAPath, captionA, "utf8");
      writeFileSync(captionBPath, captionB, "utf8");
      writeFileSync(infoAPath, infoA, "utf8");
      writeFileSync(infoBPath, infoB, "utf8");

      const inserted: Array<{ storagePath: string; infoPath: string | null; sha256: string; infoSha256: string | null }> = [];
      let nextId = 1;
      const sql = (async () => [] as never[]) as unknown as Sql;
      sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        if (/select storage_root/i.test(text)) return [{ storage_root: root }] as T[];
        if (/select retention_mode/i.test(text)) return [{ retention_mode: "transcript-only" }] as T[];
        if (/insert into meeting_transcript_artifacts/i.test(text)) {
          inserted.push({
            storagePath: String(params[2]),
            sha256: String(params[4]),
            infoPath: params[7] == null ? null : String(params[7]),
            infoSha256: params[8] == null ? null : String(params[8]),
          });
          return [{ id: nextId++, captured_at: "2026-09-22T00:00:00.000Z" }] as T[];
        }
        if (/insert into meeting_transcript_segments/i.test(text)) return [] as T[];
        throw new Error(`unexpected query: ${text}`);
      };

      const shaA = createHash("sha256").update(captionA).digest("hex");
      const shaB = createHash("sha256").update(captionB).digest("hex");
      const storedA = await storeMeetingTranscriptArtifact(sql, {
        newsroomId: 7,
        videoId: "meeting-1",
        parsed: { text: "Original words", format: "vtt", sha256: shaA, sourcePath: captionAPath },
        infoSourcePath: infoAPath,
      });
      const storedB = await storeMeetingTranscriptArtifact(sql, {
        newsroomId: 7,
        videoId: "meeting-1",
        parsed: { text: "Corrected words", format: "vtt", sha256: shaB, sourcePath: captionBPath },
        infoSourcePath: infoBPath,
      });

      assert.notEqual(storedA.storagePath, storedB.storagePath, "different caption hashes must never share a path");
      assert.equal(readFileSync(storedA.storagePath, "utf8"), captionA, "storing B must not change A's bytes");
      assert.equal(readFileSync(storedB.storagePath, "utf8"), captionB);
      assert.equal(createHash("sha256").update(readFileSync(storedA.storagePath)).digest("hex"), shaA);
      assert.equal(createHash("sha256").update(readFileSync(storedB.storagePath)).digest("hex"), shaB);

      assert.equal(inserted.length, 2);
      assert.notEqual(inserted[0]!.infoPath, inserted[1]!.infoPath, "different info hashes must never share a path");
      assert.equal(readFileSync(inserted[0]!.infoPath!, "utf8"), infoA, "storing B must not change A's sidecar");
      assert.equal(readFileSync(inserted[1]!.infoPath!, "utf8"), infoB);
      assert.match(storedA.storagePath, new RegExp(shaA));
      assert.match(storedB.storagePath, new RegExp(shaB));
      assert.match(inserted[0]!.infoPath!, new RegExp(inserted[0]!.infoSha256!));
      assert.match(inserted[1]!.infoPath!, new RegExp(inserted[1]!.infoSha256!));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /*
    The load path, which is the ONLY path production uses.

    `resolveTranscriptCitation` was well covered and always passed, because the
    test handed it a segment that already carried an `item`. Every row production
    actually writes has `item = null`, because nothing in the codebase ever
    populates that column -- so a citation named a timestamp and never the agenda
    item it sat under, silently, and the suite stayed green.

    This binds to `loadTranscriptCitation` against a stub SQL handle that returns
    exactly the shape the database returns: segments with a null item, and chunks
    that know which segments belong to which item. It fails against the old
    implementation and passes against the fix.
  */
  it("resolves the agenda item on the load path, from the chunks, not from segment.item", async () => {
    const { loadTranscriptCitation } = await import("./meeting-transcript-artifacts.ts");

    const calls: string[] = [];
    const sql = {
      query: async (text: string, params?: unknown[]) => {
        calls.push(text);
        if (/from meeting_transcript_artifacts/.test(text)) {
          return [{ id: 13, storage_path: "C:\\data\\m.srv3", sha256: "abc123", video_id: "vid1" }];
        }
        if (/from meeting_transcript_segments/.test(text)) {
          return [
            { segment_index: 0, start_seconds: 0, end_seconds: 10, item: null, excerpt: "agenda opened", caption_sha256: "abc123" },
            { segment_index: 1, start_seconds: 18448, end_seconds: 18452, item: null, excerpt: "And that is all uh city manager remarks.", caption_sha256: "abc123" },
            { segment_index: 2, start_seconds: 18452, end_seconds: 18456, item: null, excerpt: "next item", caption_sha256: "abc123" },
          ];
        }
        if (/from meeting_agenda_chunks/.test(text)) {
          assert.deepEqual(params, ["vid1"], "the chunk lookup must be scoped to this artifact's video");
          /*
            `segment_indexes` is a TEXT column holding JSON, not a jsonb column
            and not a Postgres array -- the live database returns "[2442]", a
            string. Passing arrays here would exercise the Array.isArray branch,
            which production never takes, and would prove the wrong path. The
            malformed row below is included because a bad value must not throw
            away the items it sits beside.
          */
          return [
            { item: "5", segment_indexes: "[0]" },
            { item: "8", segment_indexes: "[1,2]" },
            { item: "9", segment_indexes: "not json" },
          ];
        }
        throw new Error("unexpected query: " + text);
      },
    };

    const byTime = await loadTranscriptCitation(sql as unknown as import("../db.ts").Sql, { artifactId: 13, timestampSeconds: 18450 });
    assert.equal(byTime.item, "8", "a citation must name the agenda item it sits under");
    assert.equal(byTime.segmentIndex, 1);
    assert.equal(byTime.excerpt, "And that is all uh city manager remarks.");
    assert.equal(byTime.captionSha256, "abc123");

    const byIndex = await loadTranscriptCitation(sql as unknown as import("../db.ts").Sql, { artifactId: 13, segmentIndex: 0 });
    assert.equal(byIndex.item, "5");

    // The second index of a multi-index chunk must also resolve.
    const seg2 = await loadTranscriptCitation(sql as unknown as import("../db.ts").Sql, { artifactId: 13, segmentIndex: 2 });
    assert.equal(seg2.item, "8", "every index in a chunk must resolve, not just the first");

    assert.ok(calls.some((q) => /meeting_agenda_chunks/.test(q)), "the item must come from the chunk table");
  });

  it("draft evidence token covers transcriptCitations so a stale citation cannot publish", async () => {
    const { evidenceReviewToken } = await import("./draft-evidence.ts");
    const base = { id: 1, headline: "H", dek: "D", topic: "T", body: "B", source_urls: "[]", provenance_json: "[]", found_note: "", unanswered: "[]", research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 1, captionSha256: "abc" }] }) };
    const changed = { ...base, research_json: JSON.stringify({ transcriptCitations: [{ artifactId: 7, segmentIndex: 2, captionSha256: "abc" }] }) };
    assert.notEqual(evidenceReviewToken(base), evidenceReviewToken(changed));
  });
});
