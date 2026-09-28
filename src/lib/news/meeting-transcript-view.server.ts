import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Sql } from "../db.ts";
import {
  TranscriptViewRefused,
  type TranscriptView,
  type TranscriptViewLine,
} from "./meeting-transcript-view.ts";

/**
 * The server half of the transcript page: which file is read, and who may read it.
 *
 * Three rules, and each one is load-bearing:
 *
 * 1. The path comes from the artifact ROW, never from the request. The handler
 *    reads `?path=` for exactly one purpose -- to refuse it. A path supplied by
 *    the caller is how a reader of transcript A gets pointed at transcript B,
 *    or at `/etc/passwd`, and "we would never do that" is not a check. The
 *    refusal is wired and tested (see `meeting-transcript-view.server.test.ts`).
 * 2. The row is scoped by `newsroom_id`. `loadTranscriptCitation` in
 *    `meeting-transcript-artifacts.ts:331` selects `where id=$1` with no
 *    newsroom filter, which is fine for an internal writer that already knows
 *    which newsroom it is working in, and wrong for an HTTP surface. Here the
 *    id alone is never enough.
 * 3. The bytes are verified against the row's recorded SHA-256 before they are
 *    served or shown. The whole value of the "Stored at" line and the hash
 *    printed beside it is that they describe the file, so serving a file that
 *    no longer matches its own hash would make that line a lie.
 */

type ArtifactRow = {
  id: number;
  video_id: string;
  storage_path: string;
  sha256: string;
  format: string;
  byte_size: number | string;
  captured_at: string;
};

/**
 * Refuse a filesystem path supplied by the caller.
 *
 * Exported so the test can call it on its own, and so the rule is one readable
 * function rather than a condition buried in the loader. An absent or blank
 * value is not a path and is allowed through; anything else is a request to
 * read a file this route does not choose.
 */
export function assertNoRequestPath(requestedPath: unknown): void {
  if (requestedPath == null) return;
  if (typeof requestedPath === "string" && !requestedPath.trim()) return;
  throw new TranscriptViewRefused(
    "path-from-request",
    "The transcript file is read from the stored artifact record. A path in the request is refused.",
  );
}

/**
 * Resolve the artifact this newsroom may read.
 *
 * `artifact_type='transcript'` is part of the identity, not decoration: the
 * table is keyed to hold other artifact kinds later, and a view that shows
 * "the transcript" must not be satisfiable by a row that is not one.
 */
export async function resolveTranscriptArtifact(
  sql: Sql,
  input: { newsroomId: number; artifactId: number; requestedPath?: unknown },
): Promise<ArtifactRow> {
  assertNoRequestPath(input.requestedPath);
  const rows = await sql.query<ArtifactRow>(
    `select id,video_id,storage_path,sha256,format,byte_size,captured_at::text as captured_at
       from meeting_transcript_artifacts
      where id=$1 and newsroom_id=$2 and artifact_type='transcript'`,
    [input.artifactId, input.newsroomId],
  );
  const row = rows[0];
  if (!row) {
    /*
      One answer for "no such artifact" and for "another newsroom's artifact".
      Distinguishing them would turn this route into an oracle: an editor of
      newsroom 1 could learn, by status code alone, which ids exist in
      newsroom 2. The message does not name the id either.
    */
    throw new TranscriptViewRefused(
      "other-newsroom",
      "No transcript artifact with that id belongs to this newsroom.",
    );
  }
  return row;
}

/**
 * The whole transcript, in order, with the artifact facts the page prints.
 *
 * Reads `meeting_transcript_segments` rather than re-parsing the stored file --
 * see the note at the top of `meeting-transcript-view.ts` for why (short form:
 * the rows are the same text by construction, they are the text citations are
 * resolved against, and they are the only text a speech-to-text artifact has).
 */
export async function loadTranscriptView(
  sql: Sql,
  input: { newsroomId: number; artifactId: number; requestedPath?: unknown },
): Promise<TranscriptView> {
  const artifact = await resolveTranscriptArtifact(sql, input);
  const segments = await sql.query<{
    segment_index: number;
    start_seconds: number | string;
    excerpt: string;
  }>(
    `select segment_index,start_seconds,excerpt from meeting_transcript_segments
      where artifact_id=$1 order by segment_index`,
    [artifact.id],
  );
  const lines: TranscriptViewLine[] = segments.map((segment) => ({
    segmentIndex: Number(segment.segment_index),
    startSeconds: Number(segment.start_seconds),
    excerpt: segment.excerpt,
  }));
  const captures = await sql.query<{ title: string | null; published: string | null }>(
    `select title,published from meeting_capture_records
      where newsroom_id=$1 and video_id=$2 limit 1`,
    [input.newsroomId, artifact.video_id],
  );
  const capture = captures[0];
  return {
    artifactId: Number(artifact.id),
    videoId: artifact.video_id,
    title: capture?.title?.trim() || null,
    meetingDate: capture?.published ? String(capture.published).slice(0, 10) : null,
    storagePath: artifact.storage_path,
    sha256: artifact.sha256,
    format: artifact.format,
    byteSize: Number(artifact.byte_size ?? 0),
    capturedAt: artifact.captured_at,
    lines,
  };
}

export type TranscriptOriginal = {
  filename: string;
  /** Backed by a plain `ArrayBuffer`, so it is directly a `BodyInit` body part. */
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  storagePath: string;
};

/**
 * The stored file's own bytes, under the name it was stored with.
 *
 * The filename is the basename of the ROW's path, never a name from the
 * request, and the response header built from it strips quotes and backslashes
 * so a path containing them cannot break out of the `filename="..."` value.
 */
export async function readTranscriptOriginal(
  sql: Sql,
  input: { newsroomId: number; artifactId: number; requestedPath?: unknown },
): Promise<TranscriptOriginal> {
  const artifact = await resolveTranscriptArtifact(sql, input);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    // Copied into a plain ArrayBuffer-backed view: `readFileSync` returns a
    // Buffer, whose type admits a SharedArrayBuffer, which a response body does
    // not accept. The hash below is over these same bytes either way.
    bytes = new Uint8Array(readFileSync(artifact.storage_path));
  } catch {
    throw new Error(
      `The stored transcript file is not readable at the recorded path for artifact ${artifact.id}.`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== artifact.sha256) {
    throw new Error(
      `The stored transcript file no longer matches the hash recorded for artifact ${artifact.id}.`,
    );
  }
  return {
    filename: basename(artifact.storage_path),
    bytes,
    sha256,
    storagePath: artifact.storage_path,
  };
}

/** A filename safe to place inside `Content-Disposition: attachment; filename="..."`. */
export function attachmentFilename(filename: string): string {
  const cleaned = filename.replace(/["\\\r\n]/g, "").trim();
  return cleaned || "transcript";
}

/**
 * GET /api/transcript-file?artifactId=N -- the stored transcript, as a download.
 *
 * Editor-only, and guarded in the same order every other desk surface is:
 * same-site (a scripted sibling origin cannot ride the session cookie), then a
 * session, then a role in this newsroom. `requireEditor` returns the newsroom
 * the artifact is then scoped to, so the artifact a download can reach is
 * decided by who is asking, not by the id in the URL.
 *
 * A top-level GET navigation passes `assertSameSiteRequest` (it carries
 * `sec-fetch-site: same-origin` here, and a cross-site top-level GET navigation
 * is allowed by design -- see isolation.server.ts:41-50).
 */
export async function transcriptFileHandler(request: Request): Promise<Response> {
  try {
    /*
      The auth chain is imported inside the handler rather than at the top of
      this module, for the same reason `getSql` is: `verify.server.ts` reaches
      `@tanstack/react-start/server`, and this module is imported by a plain
      `node --test` unit test that must be able to exercise the two refusals
      and the file read without a request context. The rules are unchanged --
      same-site, then session, then role -- and they still run first, before
      any row is read.
    */
    const { assertSameSiteRequest } = await import("../auth/isolation.server.ts");
    const { requireUserId } = await import("../auth/verify.server.ts");
    const { requireEditor } = await import("./membership.ts");
    assertSameSiteRequest();
    const userId = await requireUserId();
    const editor = await requireEditor(userId);
    const url = new URL(request.url);
    const artifactId = Number(url.searchParams.get("artifactId"));
    if (!Number.isInteger(artifactId) || artifactId <= 0) {
      return new Response("A transcript artifact id is required.", { status: 400 });
    }
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const file = await readTranscriptOriginal(sql, {
      newsroomId: editor.newsroomId,
      artifactId,
      // Read for exactly one reason: to refuse it.
      requestedPath: url.searchParams.get("path"),
    });
    return new Response(new Blob([file.bytes]), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(file.bytes.byteLength),
        "content-disposition": `attachment; filename="${attachmentFilename(file.filename)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof TranscriptViewRefused) {
      return new Response(error.message, { status: error.status });
    }
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    return new Response(error instanceof Error ? error.message : "The transcript could not be read.", {
      status,
    });
  }
}
