import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import { enqueueJob, findOpenJob, type DeskJob } from "./jobs.ts";
import { probeTextflowkit, transcribeAudioWithTextflowkit } from "./textflowkit-cli.server.ts";
import { TEXTFLOWKIT_SOURCE_METHOD, resolveTextflowkitConfig } from "./textflowkit.ts";
import type { CaptionCaptureResult } from "./meeting-capture-ytdlp.ts";

/*
  The transcription job (unit R) -- SERVER ONLY.

  Meetings that have no captions currently end at audio. This turns that audio
  into a transcript revision through the SAME path a caption capture takes
  (`applyCapturedMeetingTranscript`), so lead filing, alignment, citations with
  timestamps, draft notices and the publish guard's hash checks all accept it
  without a second code path that could disagree with the first.
*/

export type AudioTranscribeReceipt = {
  /** The retained audio artifact this run reads. Also the job's `subject_id`. */
  audioArtifactId: number;
  videoId: string;
};

/**
 * One transcription at a time, per process.
 *
 * Whisper on CPU is the most expensive thing this app can be asked to do, and
 * two of them on one machine simply take twice as long while starving the
 * editorial lane of CPU. The `default` lane runs two workers; this makes the
 * second one WAIT rather than refuse, so a busy machine slows the queue down
 * instead of failing a capture it could have finished.
 *
 * `Symbol.for` mirrors the job lane's own `draining` flag: the background entry
 * and the SSR entry can each bundle this module, and two bundled copies with
 * module-local state would open two transcriptions at once.
 */
const TRANSCRIBE_LOCK_KEY = Symbol.for("townreporter:textflowkit-transcription-slot");
const lockGlobal = globalThis as typeof globalThis & { [TRANSCRIBE_LOCK_KEY]?: Promise<void> };

async function acquireTranscriptionSlot(): Promise<() => void> {
  const previous = lockGlobal[TRANSCRIBE_LOCK_KEY] ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
  const queued = previous.then(() => held);
  lockGlobal[TRANSCRIBE_LOCK_KEY] = queued;
  await previous;
  return () => {
    release();
    // Only clear our own tail; a later waiter has already replaced it.
    if (lockGlobal[TRANSCRIBE_LOCK_KEY] === queued) {
      lockGlobal[TRANSCRIBE_LOCK_KEY] = Promise.resolve();
    }
  };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Queue a transcription for every captured meeting that has audio and no
 * transcript anywhere -- no captions, and no earlier speech-to-text revision
 * either.
 *
 * Called after a capture pass rather than inside it: a scan must not fail, or
 * slow down, because an optional external tool is missing or because the job
 * table is unhappy. `enqueueJob` itself coalesces, so calling this on every
 * scan costs one query per meeting and never doubles a pending job.
 *
 * When textflowkit is not installed this returns immediately with nothing
 * queued. That is the product's behaviour before unit R: a meeting without
 * captions stays audio-only, and nothing is recorded as a failure.
 */
export async function enqueueMissingTranscriptions(
  sql: Sql,
  input: { newsroomId: number; userId: string; env?: NodeJS.ProcessEnv },
): Promise<{ withAudio: number; queued: number; alreadyQueued: number; notInstalled: boolean }> {
  const rows = await sql.query<{ video_id: string; audio_artifact_id: number }>(
    `select r.video_id, a.id as audio_artifact_id
       from meeting_capture_records r
       join meeting_transcript_artifacts a
         on a.newsroom_id = r.newsroom_id and a.video_id = r.video_id and a.artifact_type = 'audio'
      where r.newsroom_id = $1
        and r.audio_path is not null
        and not exists (
          select 1 from meeting_transcript_artifacts t
           where t.newsroom_id = r.newsroom_id and t.video_id = r.video_id
             and t.artifact_type = 'transcript'
        )
      order by a.id asc`,
    [input.newsroomId],
  );
  if (!rows.length) return { withAudio: 0, queued: 0, alreadyQueued: 0, notInstalled: false };

  const probe = await probeTextflowkit({ env: input.env });
  if (!probe.installed) {
    return { withAudio: rows.length, queued: 0, alreadyQueued: 0, notInstalled: true };
  }

  let queued = 0;
  let alreadyQueued = 0;
  for (const row of rows) {
    /*
      Asked separately rather than inferred from the job `enqueueJob` hands
      back: a coalesced open job can still read `status = 'queued'`, so the
      returned status cannot tell "I created this" from "somebody else already
      had it open". `alreadyQueued` is what a test asserts to prove two scans in
      a row do not double up, so it has to mean the thing it says.
    */
    const open = await findOpenJob({ newsroomId: input.newsroomId, kind: "audio-transcribe", subjectId: row.audio_artifact_id });
    if (open) { alreadyQueued += 1; continue; }
    const receipt: AudioTranscribeReceipt = { audioArtifactId: row.audio_artifact_id, videoId: row.video_id };
    await enqueueJob({
      userId: input.userId,
      newsroomId: input.newsroomId,
      kind: "audio-transcribe",
      subjectId: row.audio_artifact_id,
      resultJson: JSON.stringify(receipt),
    });
    queued += 1;
  }
  return { withAudio: rows.length, queued, alreadyQueued, notInstalled: false };
}

export type AudioTranscribeDeps = {
  probe?: typeof probeTextflowkit;
  transcribe?: typeof transcribeAudioWithTextflowkit;
  applyTranscript?: typeof import("./meeting-capture.ts").applyCapturedMeetingTranscript;
  env?: NodeJS.ProcessEnv;
};

/**
 * The worker behind `kind = "audio-transcribe"`.
 *
 * Its contract is deliberately narrow: read one retained audio artifact, turn
 * it into a transcript revision, or throw a sentence that names what stopped
 * it. A throw lands in `desk_jobs.error`, which is what the desk shows and
 * what an editor reads before deciding to retry -- so "textflowkit is not
 * installed" and "textflowkit timed out after 1,790s" must survive as written,
 * not collapse into a stack trace.
 *
 * Nothing here deletes or rewrites the audio. A failed transcription leaves
 * the recording exactly where the capture put it, which is what makes a retry
 * a retry rather than a re-download.
 */
export async function performAudioTranscribeWork(job: DeskJob, deps: AudioTranscribeDeps = {}): Promise<void> {
  const { getSql } = await import("../db.ts");
  const sql = await getSql();
  const env = deps.env ?? process.env;

  let receipt: AudioTranscribeReceipt;
  try {
    receipt = JSON.parse(job.result_json || "{}") as AudioTranscribeReceipt;
  } catch {
    throw new Error("This transcription request is unreadable; nothing was transcribed.");
  }
  if (!Number.isInteger(receipt.audioArtifactId) || receipt.audioArtifactId !== job.subject_id) {
    throw new Error("This transcription request does not match the retained audio it names.");
  }

  const audioRows = await sql.query<{
    storage_path: string; sha256: string; info_path: string | null; video_id: string;
  }>(
    `select storage_path, sha256, info_path, video_id from meeting_transcript_artifacts
      where id=$1 and newsroom_id=$2 and artifact_type='audio'`,
    [receipt.audioArtifactId, job.newsroom_id],
  );
  const audio = audioRows[0];
  if (!audio) throw new Error("The retained audio for this meeting is no longer recorded; nothing was transcribed.");
  if (!existsSync(audio.storage_path)) {
    throw new Error(`The retained audio file is missing from disk: ${audio.storage_path}`);
  }
  /*
    Read the bytes we recorded, not whatever is at that path now. A transcript
    whose provenance names an audio hash must be a transcript OF those bytes --
    otherwise a citation's hash and the recording behind it disagree and the
    publish guard's whole premise is gone.
  */
  const actualSha256 = sha256File(audio.storage_path);
  if (actualSha256 !== audio.sha256) {
    throw new Error(`The retained audio no longer matches its recorded hash (expected ${audio.sha256}, found ${actualSha256}); nothing was transcribed.`);
  }

  const captureRows = await sql.query<{
    video_id: string; channel_url: string; title: string; published: string; duration_seconds: number | null;
  }>(
    "select video_id,channel_url,title,published,duration_seconds from meeting_capture_records where newsroom_id=$1 and video_id=$2",
    [job.newsroom_id, receipt.videoId],
  );
  const capture = captureRows[0];
  if (!capture) throw new Error("The capture record for this meeting is gone; nothing was transcribed.");

  const probe = await (deps.probe ?? probeTextflowkit)({ env });
  if (!probe.installed) {
    throw new Error(probe.detail ?? "textflowkit is not installed; the audio is kept and this can be retried after installing it.");
  }

  const config = resolveTextflowkitConfig(env);
  const settingsRows = await sql.query<{ storage_root: string | null }>(
    "select storage_root from meeting_capture_settings where newsroom_id=$1", [job.newsroom_id],
  );
  const storageRoot = settingsRows[0]?.storage_root ?? null;
  if (!storageRoot) throw new Error("Meeting transcript storage root is not configured; refusing to write inside the app directory.");

  /*
    Scratch space INSIDE the capture storage, not the system temp directory:
    the tool's own JSON is the artifact that gets stored, and keeping it on the
    same volume as the storage root makes the copy that stores it a same-volume
    copy rather than a cross-device one. Removed in the `finally` either way.
  */
  const tempDir = join(storageRoot, `newsroom-${job.newsroom_id}`, receipt.videoId, `textflowkit-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  /*
    The claim guard, in the shape `performArtifactOcrWork` uses it. Transcription
    can hold the one slot for the better part of an hour; if the heartbeat lapses
    and a second worker adopts this row, the adopting worker is the one whose
    result should stand. Without this, a slow run that comes good at minute 59
    would write its revision over the work the replacement already finished.
  */
  const assertClaim = async () => {
    const owns = await sql.query<{ id: number }>(
      `select id from desk_jobs where id=$1 and newsroom_id=$2 and status='running' and claim_token=$3 limit 1`,
      [job.id, job.newsroom_id, job.claim_token ?? null],
    );
    if (!owns[0]) throw new Error("This transcription was replaced by a newer worker; stopping without storing a revision.");
  };

  const release = await acquireTranscriptionSlot();
  try {
    await assertClaim();
    const run = await (deps.transcribe ?? transcribeAudioWithTextflowkit)({
      audioPath: audio.storage_path,
      outputDir: tempDir,
      durationSeconds: capture.duration_seconds,
      config,
    });
    if (!run.ok) {
      // The reason is the operator-facing sentence. It is thrown, not logged,
      // so it survives on the job row after this process is gone.
      throw new Error(run.reason);
    }
    await assertClaim();

    const ownerUserId = (await sql.query<{ user_id: string }>(
      "select user_id from newsroom_members where newsroom_id=$1 and role='owner' limit 1",
      [job.newsroom_id],
    ))[0]?.user_id ?? "";
    const applied = await (deps.applyTranscript ?? (await import("./meeting-capture.ts")).applyCapturedMeetingTranscript)(
      sql,
      {
        newsroomId: job.newsroom_id,
        userId: ownerUserId,
        video: {
          id: capture.video_id,
          channelUrl: capture.channel_url,
          title: capture.title,
          published: capture.published ?? "",
        },
        // Shaped as the caption path's own success value so the revision rules
        // -- hash comparison, revision rows, post-publication review -- apply
        // here unchanged. `info` carries what textflowkit itself reported.
        result: {
          ok: true,
          parsed: run.parsed,
          infoPath: audio.info_path,
          info: {
            durationSeconds: run.durationSeconds ?? capture.duration_seconds,
            videoTimestamp: null,
            captionRevisionTimestamp: null,
          },
          argv: run.argv,
          stdout: run.stdout,
          stderr: run.stderr,
        } satisfies Extract<CaptionCaptureResult, { ok: true }>,
        sourceMethod: TEXTFLOWKIT_SOURCE_METHOD,
        provenance: {
          tool: "textflowkit",
          toolVersion: probe.version,
          model: run.model ?? config.model,
          device: run.device,
          language: config.language,
          audioArtifactId: receipt.audioArtifactId,
          audioSha256: audio.sha256,
          wordCount: run.wordCount,
          argv: run.argv,
        },
      },
    );
    await sql.query(
      `update desk_jobs set result_json=$1, stage=$2, updated_at=now()
        where id=$3 and newsroom_id=$4 and claim_token=$5 and status='running'`,
      [

        JSON.stringify({
          ...receipt,
          revisionArtifactId: applied.artifactId,
          revised: applied.revised,
          settled: applied.settled,
          toolVersion: probe.version,
          model: run.model ?? config.model,
          device: run.device,
        }),
        applied.warnings.length ? applied.warnings.join(" ") : "Transcript stored",
        job.id,
        job.newsroom_id,
        job.claim_token ?? null,
      ],
    );
  } finally {
    release();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* scratch only */ }
  }
}
