import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";

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
import { getSql, type Sql } from "../db.ts";
import { requireEditor, ForbiddenError } from "./membership.ts";
import type { MeetingAwarenessResult } from "./meeting-capture.ts";

/*
  No `node:` import may reach this module's top level.

  `components/meeting-capture-settings.tsx` is a client component and imports
  the four `createServerFn` handles below, so this module is in the browser
  graph. The meeting engine (`./meeting-capture.ts`, `./meeting-capture-ytdlp.ts`)
  is Node-only -- it reads and writes files and hashes bytes -- and importing it
  statically here dragged seven modules and fifteen `node:` builtins into the
  client, where Vite externalizes them and the first property read throws while
  `/desk/ops` is loading:

    Module "node:path" has been externalized for browser compatibility.
    Cannot access "node:path.isAbsolute" in client code.

  A server function's handler body becomes an RPC stub in the client build, so
  `await import()` inside one never pulls the engine into the browser. Same
  repair as the 0.6.61 `node:child_process` fix.

  0.6.63: the loop below is not a handler, so its `await import()` of the engine
  was resolved in the client build after all -- and the engine now reaches a
  `.server` module (the allow-listed python runner), which import-protection
  refuses. The shared pass loads the engine through `loadMeetingEngine` instead:
  a body handed to createServerOnlyFn is a boundary the client build prunes, so
  this file keeps its one engine loading point and the browser sees none of it.
*/

/** The meeting engine, loaded only ever on the server: see the note above. */
const loadMeetingEngine = createServerOnlyFn(async () => {
  const { runMeetingAwareness, recheckProvisionalMeetings } = await import("./meeting-capture.ts");
  const { captureMeetingCaptions } = await import("./meeting-capture-ytdlp.ts");
  return { runMeetingAwareness, recheckProvisionalMeetings, captureMeetingCaptions };
});

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
  input: { newsroomId: number; userId: string; runId: number; signal?: AbortSignal },
): Promise<MeetingAwarenessResult> {
  let awareness: MeetingAwarenessResult;
  const failures: string[] = [];
  try {
    // Loaded through the server-only boundary above: see the note at the top.
    const { runMeetingAwareness, recheckProvisionalMeetings, captureMeetingCaptions } = await loadMeetingEngine();
    awareness = await runMeetingAwareness(sql, input.newsroomId, { captureMeeting: (ci) => captureMeetingCaptions({ ...ci, signal: input.signal }) });
    const recheck = await recheckProvisionalMeetings(sql, input.newsroomId);
    if (recheck.failures.length) {
      awareness.failures.push(...recheck.failures);
      awareness.coverageLine = `${awareness.coverageLine} (recheck: ${recheck.checked} checked, ${recheck.revised} revised, ${recheck.settled} settled)`;
    }
    /*
      Speech-to-text (unit R), queued for the same reason the scheduler queues
      it: this pass is what discovers a meeting that ended at audio, and the
      transcription itself is durable work the desk drains. Wrapped so an
      optional external tool can add a named line but never fail a capture pass.
    */
    try {
      const { enqueueMissingTranscriptions } = await import("./textflowkit-transcribe.server.ts");
      const speech = await enqueueMissingTranscriptions(sql, { newsroomId: input.newsroomId, userId: input.userId });
      if (speech.queued > 0) {
        awareness.coverageLine = `${awareness.coverageLine} (speech-to-text: ${speech.queued} queued)`;
      }
    } catch (e) {
      awareness.failures.push(`speech-to-text: ${e instanceof Error ? e.message : String(e)}`);
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
      const awareness = await runMeetingPassWritesRow(sql, { newsroomId, userId: context.userId, runId, signal: controller.signal });
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
    const { resumeStoppedMeetings } = await import("./meeting-capture.ts");
    const result = await resumeStoppedMeetings(sql, newsroomId);
    return { ok: true, ...result };
  });

/**
 * N-2: force a re-capture of ONE specific meeting. This uses the canonical
 * immutable revision path: prior bytes and provenance remain available, the
 * current artifact moves under the shared publication lock, and affected drafts
 * or published stories receive review work. The forced action is recorded on
 * both the run and the capture record.
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

    // Loaded here, not at module scope: see the note at the top of this file.
    const { prepareMeetingCapturePaths, applyCapturedMeetingTranscript } = await import("./meeting-capture.ts");
    const { captureMeetingCaptions } = await import("./meeting-capture-ytdlp.ts");

    const { outputDir, archivePath } = prepareMeetingCapturePaths(newsroomId, data.videoId);
    try {
      const result = await captureMeetingCaptions({ videoId: data.videoId, outputDir, archivePath });
      if (!result.ok) {
        await sql.query("update scan_runs set finished_at=now(), error=$1, meetings_found=1, meetings_failed=1, meeting_failures=$2 where id=$3",
          [result.reason, JSON.stringify([`${data.title}: ${result.reason}`]), runId]);
        return { ok: false, error: result.reason };
      }
      const applied = await applyCapturedMeetingTranscript(sql, {
        newsroomId,
        userId: context.userId,
        video: { id: data.videoId, channelUrl: data.channelUrl, title: data.title, published: data.published },
        result,
        forced: true,
      });
      const coverageLine = `meetings: 1 found, 1 captured, 0 failed (forced re-capture${applied.revised ? ", revision recorded" : ""})`;
      await sql.query(
        "update scan_runs set finished_at=now(), meetings_found=1, meetings_captured=1, meetings_failed=0, meeting_failures=$1, summary=$2 where id=$3",
        [JSON.stringify(applied.warnings), coverageLine, runId],
      );
      return { ok: true, scanRunId: runId, found: 1, captured: 1, failed: 0, failures: applied.warnings, coverageLine, forced: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await sql.query("update scan_runs set finished_at=now(), error=$1 where id=$2", [error, runId]);
      return { ok: false, error };
    }
  });

