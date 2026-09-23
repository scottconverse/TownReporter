import { createServerFn } from "@tanstack/react-start";

/* N-5: an in-flight manual meeting pass can be stopped. One controller per newsroom. */
const runningPasses = new Map<number, AbortController>();
export function requestStopMeetingPass(newsroomId: number): boolean {
  const c = runningPasses.get(newsroomId);
  if (!c) return false;
  c.abort();
  return true;
}
export function isMeetingPassRunning(newsroomId: number): boolean { return runningPasses.has(newsroomId); }
import { authMiddleware } from "../auth/middleware.ts";
import { getSql, withTransaction, type Sql } from "../db.ts";
import { requireEditor, ForbiddenError } from "./membership.ts";
import { runMeetingAwareness, recheckProvisionalMeetings, resumeStoppedMeetings, type MeetingAwarenessResult } from "./meeting-capture.ts";
import { storeMeetingTranscriptArtifact } from "./meeting-transcript-artifacts.ts";
import { captureMeetingCaptions } from "./meeting-capture-ytdlp.ts";
import { meetingCaptionDir, meetingArchivePath } from "./meeting-capture.ts";

export type MeetingManualRunResult =
  | {
      ok: true;
      scanRunId: number;
      found: number;
      captured: number;
      failed: number;
      failures: string[];
      coverageLine: string;
      forced: boolean;
    }
  | { ok: false; error: string };

/**
 * The shared meeting pass. It runs the SAME meeting step the scheduler runs
 * (runMeetingAwareness + provisional recheck) and writes the counts, the
 * coverage line, and the named failures to the scan_runs row it owns. The
 * caller supplies the row (scheduled or manual) so provenance is the caller's.
 *
 * This is a real code path, not a harness: the manual control and the scheduler
 * both reach runMeetingAwareness through production code.
 */
export async function runMeetingPassWritesRow(
  sql: Sql,
  input: { newsroomId: number; runId: number; signal?: AbortSignal },
): Promise<MeetingAwarenessResult> {
  let awareness: MeetingAwarenessResult;
  const failures: string[] = [];
  try {
    awareness = await runMeetingAwareness(sql, input.newsroomId, { captureMeeting: (ci) => captureMeetingCaptions({ ...ci, signal: input.signal }) });
    const recheck = await recheckProvisionalMeetings(sql, input.newsroomId);
    if (recheck.failures.length) {
      awareness.failures.push(...recheck.failures);
      awareness.coverageLine = `${awareness.coverageLine} (recheck: ${recheck.checked} checked, ${recheck.revised} revised, ${recheck.settled} settled)`;
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    awareness = {
      configured: true, found: [], uncaptured: [], captured: [], failed: [],
      coverageLine: "", failures: [reason], archivePath: null,
    };
    failures.push(reason);
  }
  await sql.query(
    `update scan_runs set
       finished_at = now(),
       meetings_found = $1, meetings_captured = $2, meetings_failed = $3,
       meeting_failures = $4,
       summary = $5
     where id = $6 and newsroom_id = $7`,
    [
      awareness.found.length,
      awareness.captured.filter((r) => r.status === "captured").length,
      awareness.failed.length,
      JSON.stringify(awareness.failures).slice(0, 32000),
      awareness.coverageLine || "meetings: 0 found, 0 captured, 0 failed",
      input.runId, input.newsroomId,
    ],
  );
  return awareness;
}

async function ownedNewsroomId(userId: string): Promise<number> {
  const me = await requireEditor(userId);
  if (me.role !== "owner") throw new ForbiddenError("Only the owner can run meeting capture.");
  return me.newsroomId;
}

/**
 * N-2: run a meeting-capture pass on demand. No daily reservation is touched:
 * the row is execution_origin='manual' with daily_reservation_id NULL, and the
 * pass runs synchronously so the operator sees the finished row immediately.
 * Idempotent by default (the DB-authoritative no-recapture property holds).
 */
export const runMeetingsNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<MeetingManualRunResult> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    const sql = await getSql();

    const settings = await sql.query<{ enabled: boolean | null }>(
      "select enabled from meeting_capture_settings where newsroom_id=$1", [newsroomId],
    );
    if (!settings.length || settings[0]!.enabled !== true) {
      return { ok: false, error: "Meeting capture is turned off. Enable it in Server settings before running." };
    }

    const rows = await sql.query<{ id: number }>(
      `insert into scan_runs(user_id,newsroom_id,execution_origin,daily_reservation_id,forced_recapture)
       values($1,$2,'manual',null,false) returning id`,
      [context.userId, newsroomId],
    );
    const runId = rows[0]!.id;

    const controller = new AbortController();
    runningPasses.set(newsroomId, controller);
    try {
      const awareness = await runMeetingPassWritesRow(sql, { newsroomId, runId, signal: controller.signal });
      return {
        ok: true, scanRunId: runId,
        found: awareness.found.length,
        captured: awareness.captured.filter((r) => r.status === "captured").length,
        failed: awareness.failed.length,
        failures: awareness.failures,
        coverageLine: awareness.coverageLine,
        forced: false,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await sql.query("update scan_runs set finished_at=now(), error=$1 where id=$2", [error, runId]);
      return { ok: false, error };
    } finally {
      runningPasses.delete(newsroomId);
    }
  });

/** N-5: stop an in-flight manual meeting pass. Records that it was stopped. */
export const stopMeetingsNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: boolean; stopped: boolean }> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    const stopped = requestStopMeetingPass(newsroomId);
    return { ok: true, stopped };
  });

/**
 * N-5 Continue: resume meeting captures the operator STOPPED.
 *
 * A stopped capture is not terminal. yt-dlp left a partial behind and will
 * continue it, and the capture record is unique per (newsroom, video), so a
 * resume updates that existing row rather than creating a second one.
 *
 * Records with no resumable partial are reported as skipped with a named
 * reason instead of being offered as a resume that has nothing behind it.
 */
export const resumeStoppedMeetingsNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: boolean; resumed: number; skipped: number; failures: string[]; coverageLine: string }> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    const sql = await getSql();
    const result = await resumeStoppedMeetings(sql, newsroomId);
    return { ok: true, ...result };
  });

/**
 * N-2: force a re-capture of ONE specific meeting. This overwrites the stored
 * transcript; the prior caption hash is preserved on the record so the overwrite
 * is visible, and forced_recapture is recorded on both the run and the record.
 */
export const forceRecaptureMeeting = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((raw: unknown): { videoId: string; channelUrl: string; title: string; published: string } => {
    const d = (raw ?? {}) as Record<string, unknown>;
    return {
      videoId: String(d.videoId ?? "").trim(),
      channelUrl: String(d.channelUrl ?? "").trim(),
      title: String(d.title ?? "").trim(),
      published: String(d.published ?? "").trim(),
    };
  })
  .handler(async ({ context, data }): Promise<MeetingManualRunResult> => {
    const newsroomId = await ownedNewsroomId(context.userId);
    if (!/^[\w-]{11}$/.test(data.videoId)) {
      return { ok: false, error: "A valid YouTube video id is required." };
    }
    const sql = await getSql();

    const rows = await sql.query<{ id: number }>(
      `insert into scan_runs(user_id,newsroom_id,execution_origin,daily_reservation_id,forced_recapture)
       values($1,$2,'manual',null,true) returning id`,
      [context.userId, newsroomId],
    );
    const runId = rows[0]!.id;

    const prior = await sql.query<{ caption_sha256: string | null }>(
      "select caption_sha256 from meeting_capture_records where newsroom_id=$1 and video_id=$2",
      [newsroomId, data.videoId],
    );
    const priorSha = prior[0]?.caption_sha256 ?? null;

    const outputDir = meetingCaptionDir(newsroomId);
    const archivePath = meetingArchivePath(newsroomId);
    try {
      const result = await captureMeetingCaptions({ videoId: data.videoId, outputDir: `${outputDir}/${data.videoId}`, archivePath });
      if (!result.ok) {
        await sql.query("update scan_runs set finished_at=now(), error=$1, meetings_found=1, meetings_failed=1, meeting_failures=$2 where id=$3",
          [result.reason, JSON.stringify([`${data.title}: ${result.reason}`]), runId]);
        return { ok: false, error: result.reason };
      }
      await withTransaction(async (tx) => {
        await tx.query(
          `insert into meeting_capture_records(newsroom_id,video_id,channel_url,title,published,status,captured_at,
             caption_path,caption_format,caption_sha256,caption_captured_at,failure_reason,
             forced_recapture,forced_recapture_at,prior_caption_sha256)
           values($1,$2,$3,$4,$5,'captured',now(),$6,$7,$8,now(),null,true,now(),$9)
           on conflict(newsroom_id,video_id) do update set
             status='captured',captured_at=now(),caption_path=excluded.caption_path,
             caption_format=excluded.caption_format,caption_sha256=excluded.caption_sha256,
             caption_captured_at=now(),failure_reason=null,
             forced_recapture=true,forced_recapture_at=now(),
             prior_caption_sha256=$9,updated_at=now()`,
          [newsroomId, data.videoId, data.channelUrl, data.title, data.published,
           result.parsed.sourcePath, result.parsed.format, result.parsed.sha256, priorSha],
        );
        await storeMeetingTranscriptArtifact(tx, { newsroomId, videoId: data.videoId, parsed: result.parsed, infoSourcePath: result.infoPath });
        await tx.query(
          "update scan_runs set finished_at=now(), meetings_found=1, meetings_captured=1, meetings_failed=0, meeting_failures='[]', summary=$1 where id=$2",
          [`meetings: 1 found, 1 captured, 0 failed (forced re-capture)`, runId],
        );
      });
      return { ok: true, scanRunId: runId, found: 1, captured: 1, failed: 0, failures: [], coverageLine: "meetings: 1 found, 1 captured, 0 failed", forced: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await sql.query("update scan_runs set finished_at=now(), error=$1 where id=$2", [error, runId]);
      return { ok: false, error };
    }
  });

