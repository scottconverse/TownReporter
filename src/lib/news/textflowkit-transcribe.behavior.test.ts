import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

/*
  Unit R, end to end on PGlite.

  Every test here drives the REAL job machinery -- `enqueueMissingTranscriptions`
  then `drainQueuedJobs`, which claims, heartbeats, and completes a row exactly
  as a scan does -- with two things swapped: the CLI is a fake that writes the
  measured 0.1.6 JSON shape, and section 5 is inert. Section 5 is stubbed
  because it reaches PrimeGov and longmontcitycouncil.org on every run; that is
  a fact about alignment, not about speech-to-text, and a test for this unit has
  no business making outbound requests.

  What is NOT stubbed is the store: the revision goes through the same
  `applyCapturedMeetingTranscript` a caption capture uses, into the same
  content-addressed artifact table.
*/

let vite: Awaited<ReturnType<typeof createServer>>;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let drainQueuedJobs: typeof import("./jobs.ts").drainQueuedJobs;
let __setJobWorkForTest: typeof import("./jobs.ts").__setJobWorkForTest;
let findOpenJob: typeof import("./jobs.ts").findOpenJob;
let enqueueMissingTranscriptions: typeof import("./textflowkit-transcribe.server.ts").enqueueMissingTranscriptions;
let performAudioTranscribeWork: typeof import("./textflowkit-transcribe.server.ts").performAudioTranscribeWork;
let storeMeetingAudioArtifact: typeof import("./meeting-audio-artifacts.ts").storeMeetingAudioArtifact;
let applyCapturedMeetingTranscript: typeof import("./meeting-capture.ts").applyCapturedMeetingTranscript;
let loadTranscriptCitation: typeof import("./meeting-transcript-artifacts.ts").loadTranscriptCitation;
let transcribeAudioWithTextflowkit: typeof import("./textflowkit-cli.server.ts").transcribeAudioWithTextflowkit;

const FAKE_CLI = join(process.cwd(), "scripts", "fakes", "fake-textflowkit.mjs");
const MISSING_CLI = join(tmpdir(), `textflowkit-not-here-${process.pid}.exe`);

let storageRoot = "";
const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string) {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

/** The config the worker is handed. The child's own environment comes from the allow-list. */
function cliEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { TEXTFLOWKIT_CLI_PATH: FAKE_CLI, TEXTFLOWKIT_MODEL: "small", TEXTFLOWKIT_LANGUAGE: "en", ...extra };
}

/**
 * Queue the worker under test in place of the real dispatch, then drain for
 * real. This is the same seam jobs.test.ts uses for a long editorial: the
 * claim, the heartbeat, the lane and the terminal write are all production
 * code, only the work itself is chosen by the test.
 */
function runWorkerWith(env: NodeJS.ProcessEnv) {
  __setJobWorkForTest(async (job) => {
    await performAudioTranscribeWork(job, {
      env,
      applyTranscript: (sql, input) =>
        applyCapturedMeetingTranscript(sql, input, {
          runSection5: async () => ({
            aligned: false,
            alignmentReason: "test: alignment is not part of the speech-to-text unit",
            chunkCount: 0,
            voteCount: 0,
            unalignedLead: null,
            citations: [],
            items: [],
            votes: [],
          }),
        }),
    });
  });
}

type JobRow = { id: number; status: string; error: string | null; result_json: string };

async function jobRows(sql: Awaited<ReturnType<typeof getSql>>, room: number): Promise<JobRow[]> {
  return await sql.query<JobRow>(
    "select id,status,error,result_json from desk_jobs where newsroom_id=$1 and kind='audio-transcribe' order by id",
    [room],
  );
}

/**
 * `enqueueJob` kicks a drain on a zero-delay timer, so a row this test drains
 * explicitly can be claimed by either pass -- and `drainLane` refuses to run a
 * lane that is already draining, so the explicit `drainQueuedJobs` returns
 * `{ran: 0}` while the kicked pass is still working. The row leaving
 * `queued`/`running` is the only signal that says the transcription is over;
 * a fixed sleep is a bet on how long a spawned process and a handful of PGlite
 * writes take, and that bet is what made this file flaky.
 */
async function waitForJobSettled(
  sql: Awaited<ReturnType<typeof getSql>>,
  room: number,
  timeoutMs = 30_000,
): Promise<JobRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await jobRows(sql, room);
    const last = rows[rows.length - 1];
    if (last && last.status !== "queued" && last.status !== "running") return rows;
    if (Date.now() > deadline) {
      throw new Error(`the transcription job did not settle within ${timeoutMs}ms (status ${last?.status ?? "no row"})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function seedCapturedMeeting(sql: Awaited<ReturnType<typeof getSql>>, room: number, opts: {
  videoId: string;
  audio: Buffer;
  durationSeconds: number;
}) {
  const user = `stt-${room}-${Date.now()}`;
  await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [room, `Speech-to-text room ${room}`]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'owner')", [user, room]);
  const root = join(storageRoot, `room-${room}`);
  mkdirSync(root, { recursive: true });
  await sql.query(
    `insert into meeting_capture_settings(newsroom_id,storage_root,retention_mode)
     values($1,$2,'media')
     on conflict(newsroom_id) do update set storage_root=excluded.storage_root,retention_mode=excluded.retention_mode`,
    [room, root],
  );
  const sourcePath = join(root, `${opts.videoId}.opus`);
  writeFileSync(sourcePath, opts.audio);
  const audio = await storeMeetingAudioArtifact(sql, {
    newsroomId: room,
    videoId: opts.videoId,
    audioSourcePath: sourcePath,
    format: "opus",
    triggerReason: "captions unavailable for this meeting",
  });
  await sql.query(
    `insert into meeting_capture_records
       (newsroom_id,video_id,channel_url,title,published,status,failure_reason,
        audio_path,audio_format,audio_sha256,audio_bytes,audio_captured_at,duration_seconds)
     values($1,$2,'https://www.youtube.com/@citycouncil','City Council Regular Meeting','2026-09-15',
        'failed','captions unavailable for this meeting',$3,'opus',$4,$5,now(),$6)
     on conflict(newsroom_id,video_id) do nothing`,
    [room, opts.videoId, audio.storagePath, audio.sha256, opts.audio.byteLength, opts.durationSeconds],
  );
  return { room, user, videoId: opts.videoId, audioArtifactId: audio.id, audioPath: audio.storagePath, audioSha256: audio.sha256, root };
}

async function transcriptArtifacts(sql: Awaited<ReturnType<typeof getSql>>, room: number, videoId: string) {
  return await sql.query<{
    id: number; storage_path: string; format: string; sha256: string; source_method: string; provenance_json: string | null;
  }>(
    "select id,storage_path,format,sha256,source_method,provenance_json from meeting_transcript_artifacts where newsroom_id=$1 and video_id=$2 and artifact_type='transcript'",
    [room, videoId],
  );
}

async function captureRecord(sql: Awaited<ReturnType<typeof getSql>>, room: number, videoId: string) {
  return (await sql.query<{
    status: string; caption_format: string | null; caption_path: string | null; caption_sha256: string | null;
    audio_path: string | null; audio_sha256: string | null; duration_seconds: number | null;
  }>(
    "select status,caption_format,caption_path,caption_sha256,audio_path,audio_sha256,duration_seconds from meeting_capture_records where newsroom_id=$1 and video_id=$2",
    [room, videoId],
  ))[0]!;
}

before(async () => {
  storageRoot = mkdtempSync(join(tmpdir(), "textflowkit-behavior-"));
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-textflowkit-${process.pid}`),
    server: { middlewareMode: true, hmr: { port: 0 } },
    appType: "custom",
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema, drainQueuedJobs, __setJobWorkForTest, findOpenJob } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ enqueueMissingTranscriptions, performAudioTranscribeWork } = await vite.ssrLoadModule("/src/lib/news/textflowkit-transcribe.server.ts"));
  ({ storeMeetingAudioArtifact } = await vite.ssrLoadModule("/src/lib/news/meeting-audio-artifacts.ts"));
  ({ applyCapturedMeetingTranscript } = await vite.ssrLoadModule("/src/lib/news/meeting-capture.ts"));
  ({ loadTranscriptCitation } = await vite.ssrLoadModule("/src/lib/news/meeting-transcript-artifacts.ts"));
  ({ transcribeAudioWithTextflowkit } = await vite.ssrLoadModule("/src/lib/news/textflowkit-cli.server.ts"));
  await ensureJobsSchema();
});

after(async () => {
  __setJobWorkForTest(undefined);
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await vite.close();
  rmSync(storageRoot, { recursive: true, force: true });
});

test("textflowkit absent: the meeting stays audio-only and nothing is queued or recorded as a failure", async () => {
  const sql = await getSql();
  const audio = Buffer.from("opus-bytes-for-the-not-installed-case");
  const seed = await seedCapturedMeeting(sql, 97101, { videoId: "stt-no-tool-1", audio, durationSeconds: 780 });
  const env: NodeJS.ProcessEnv = { TEXTFLOWKIT_CLI_PATH: MISSING_CLI };

  const first = await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env });
  assert.deepEqual(first, { withAudio: 1, queued: 0, alreadyQueued: 0, notInstalled: true });
  const open = await findOpenJob({ newsroomId: seed.room, kind: "audio-transcribe", subjectId: seed.audioArtifactId });
  assert.equal(open, null, "an uninstalled optional tool queues no work");

  await drainQueuedJobs();
  const jobs = await sql.query<{ id: number }>("select id from desk_jobs where newsroom_id=$1 and kind='audio-transcribe'", [seed.room]);
  assert.equal(jobs.length, 0);

  // The product's behaviour before this unit: same capture record, same audio, no transcript.
  const record = await captureRecord(sql, seed.room, seed.videoId);
  assert.equal(record.status, "failed");
  assert.equal(record.caption_format, null);
  assert.equal(record.caption_sha256, null);
  assert.equal(readFileSync(seed.audioPath).equals(audio), true, "the retained audio is untouched");
  assert.equal((await transcriptArtifacts(sql, seed.room, seed.videoId)).length, 0);
});

test("textflowkit installed: the audio becomes a content-addressed revision with provenance and segments", async () => {
  const sql = await getSql();
  const audio = Buffer.from("opus-bytes-for-the-transcribed-case");
  const seed = await seedCapturedMeeting(sql, 97102, { videoId: "stt-tool-1", audio, durationSeconds: 15 });
  const env = cliEnv();
  runWorkerWith(env);

  assert.equal((await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env })).queued, 1);
  // A second scan coalesces onto the row that is already open.
  assert.deepEqual(
    await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env }),
    { withAudio: 1, queued: 0, alreadyQueued: 1, notInstalled: false },
  );
  await drainQueuedJobs();
  // The job row is the receipt: if the worker stopped, its own sentence says why.
  const jobs = await waitForJobSettled(sql, seed.room);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.status, "completed", jobs[0]!.error ?? "the transcription job did not complete");

  const rows = await transcriptArtifacts(sql, seed.room, seed.videoId);
  assert.equal(rows.length, 1, "one revision, stored once");
  const artifact = rows[0]!;
  assert.equal(artifact.format, "textflowkit-json");
  assert.equal(artifact.source_method, "textflowkit-json");

  const provenance = JSON.parse(artifact.provenance_json ?? "{}") as Record<string, unknown>;
  assert.equal(provenance.sourceMethod, "textflowkit-json");
  assert.equal(provenance.tool, "textflowkit");
  assert.equal(provenance.toolVersion, "0.1.6");
  assert.equal(provenance.model, "small");
  assert.equal(provenance.device, "cpu");
  assert.equal(provenance.language, "en");
  assert.equal(provenance.audioArtifactId, seed.audioArtifactId);
  assert.equal(provenance.audioSha256, seed.audioSha256, "the provenance names the audio these words came from");
  assert.equal(provenance.wordCount, 28, "the per-word timings the 0.1.6 JSON carries are counted, not dropped");

  const segments = await sql.query<{ segment_index: number; start_seconds: string; end_seconds: string; excerpt: string; caption_sha256: string }>(
    "select segment_index,start_seconds,end_seconds,excerpt,caption_sha256 from meeting_transcript_segments where artifact_id=$1 order by segment_index",
    [artifact.id],
  );
  assert.deepEqual(
    segments.map((s) => [s.segment_index, Number(s.start_seconds), Number(s.end_seconds), s.excerpt]),
    [
      [0, 0, 4.5, "Good evening, the council will come to order."],
      [1, 4.5, 9.25, "Item one is the minutes of the last meeting."],
      [2, 9.25, 15, "All in favour of adopting the minutes, please raise your hand."],
    ],
  );
  for (const segment of segments) assert.equal(segment.caption_sha256, artifact.sha256);

  // The stored artifact IS the tool's own JSON, byte for byte, at a path named by its hash.
  const storedBytes = readFileSync(artifact.storage_path);
  assert.equal(createHash("sha256").update(storedBytes).digest("hex"), artifact.sha256);
  // The capture storage layout the caption path already uses, not a new one:
  // <storage root>/newsroom-<id>/<video id>/transcript-<sha>.json.
  const videoDir = join(seed.root, `newsroom-${seed.room}`, seed.videoId);
  assert.equal(artifact.storage_path, join(videoDir, `transcript-${artifact.sha256}.json`));
  const storedJson = JSON.parse(storedBytes.toString("utf8")) as { metadata: { model: string }; segments: unknown[] };
  assert.equal(storedJson.metadata.model, "small");
  assert.equal(storedJson.segments.length, 3, "per-word timings survive inside the retained JSON");

  const record = await captureRecord(sql, seed.room, seed.videoId);
  assert.equal(record.status, "captured");
  assert.equal(record.caption_format, "textflowkit-json");
  assert.equal(record.caption_sha256, artifact.sha256);
  assert.equal(record.caption_path, artifact.storage_path);
  assert.equal(record.audio_path, seed.audioPath, "the recording is kept beside the transcript");
  assert.equal(readFileSync(seed.audioPath).equals(audio), true);

  // Evidence retrieval accepts the revision: a citation resolves to the segment
  // and the timestamp, exactly as it does for a caption revision.
  const citation = await loadTranscriptCitation(sql, { artifactId: artifact.id, timestampSeconds: 5 });
  assert.equal(citation.segmentIndex, 1);
  assert.equal(citation.timestampSeconds, 4.5);
  assert.equal(citation.excerpt, "Item one is the minutes of the last meeting.");
  assert.equal(citation.captionSha256, artifact.sha256);

  // The job row carries the receipt, and the scratch directory is not left behind.
  const job = await findOpenJob({ newsroomId: seed.room, kind: "audio-transcribe", subjectId: seed.audioArtifactId });
  assert.equal(job, null, "a completed job is not open");
  const receipt = JSON.parse(jobs[0]!.result_json) as Record<string, unknown>;
  assert.equal(receipt.revisionArtifactId, artifact.id);
  assert.equal(receipt.toolVersion, "0.1.6");
  assert.equal(receipt.model, "small");
  assert.equal(readdirSync(videoDir).some((name) => name.startsWith("textflowkit-")), false, "the scratch directory is removed");
});

test("a textflowkit failure names the reason, keeps the audio, and can be retried", async () => {
  const sql = await getSql();
  const audio = Buffer.from("opus-bytes-for-the-failure-case");
  const seed = await seedCapturedMeeting(sql, 97103, { videoId: "stt-tool-fail-1", audio, durationSeconds: 15 });
  const env = cliEnv({ FAKE_TEXTFLOWKIT_MESSAGE: "ffmpeg could not decode the audio stream" });
  setEnv("FAKE_TEXTFLOWKIT_MODE", "fail");
  runWorkerWith(env);

  assert.equal((await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env })).queued, 1);
  await drainQueuedJobs();
  const failed = await waitForJobSettled(sql, seed.room);
  assert.equal(failed[0]!.status, "failed");
  assert.match(failed[0]!.error ?? "", /ffmpeg could not decode the audio stream/);

  assert.equal((await transcriptArtifacts(sql, seed.room, seed.videoId)).length, 0, "a failed run stores no revision");
  const record = await captureRecord(sql, seed.room, seed.videoId);
  assert.equal(record.status, "failed");
  assert.equal(record.caption_format, null);
  assert.equal(record.audio_path, seed.audioPath);
  assert.equal(readFileSync(seed.audioPath).equals(audio), true, "the audio is kept so a retry is a retry, not a re-download");

  // Retry: the failure is not an open job, so the next scan queues the work again.
  setEnv("FAKE_TEXTFLOWKIT_MODE", "ok");
  assert.equal((await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env })).queued, 1);
  await drainQueuedJobs();
  const all = await waitForJobSettled(sql, seed.room);
  const rows = await transcriptArtifacts(sql, seed.room, seed.videoId);
  assert.equal(rows.length, 1);
  assert.equal((await captureRecord(sql, seed.room, seed.videoId)).caption_format, "textflowkit-json");
  assert.deepEqual(all.map((row) => row.status), ["failed", "completed"], "the retry is a second row, not a rewritten first one");
});

test("a restart adopts the stale running row and runs the transcription once", async () => {
  const sql = await getSql();
  const audio = Buffer.from("opus-bytes-for-the-restart-case");
  const seed = await seedCapturedMeeting(sql, 97104, { videoId: "stt-restart-1", audio, durationSeconds: 15 });
  const env = cliEnv();
  runWorkerWith(env);
  const receipt = JSON.stringify({ audioArtifactId: seed.audioArtifactId, videoId: seed.videoId });

  // A worker that claimed this row and then the process died: running, with a
  // heartbeat older than the reclaim window.
  await sql.query(
    `insert into desk_jobs(newsroom_id,user_id,kind,subject_id,lane,status,stage,claim_token,result_json,started_at,updated_at)
     values($1,$2,'audio-transcribe',$3,'default','running','Working…','claim-from-the-dead-process',$4,now() - interval '2 hours',now() - interval '2 hours')`,
    [seed.room, seed.user, seed.audioArtifactId, receipt],
  );

  // The orphan is still open, so a scan coalesces onto it instead of adding a second row.
  assert.deepEqual(
    await enqueueMissingTranscriptions(sql, { newsroomId: seed.room, userId: seed.user, env }),
    { withAudio: 1, queued: 0, alreadyQueued: 1, notInstalled: false },
  );

  await drainQueuedJobs();
  const jobs = await waitForJobSettled(sql, seed.room);
  assert.equal(jobs.length, 1, "the restart reclaims the row it found rather than duplicating it");
  assert.equal(jobs[0]!.status, "completed");
  const rows = await transcriptArtifacts(sql, seed.room, seed.videoId);
  assert.equal(rows.length, 1, "the adopted job produced one revision, not one per attempt");
});

test("the transcription child sees the allow-list and no secrets", async () => {
  const sql = await getSql();
  const seed = await seedCapturedMeeting(sql, 97105, { videoId: "stt-env-1", audio: Buffer.from("opus-bytes-for-the-env-case"), durationSeconds: 15 });
  const dumpPath = join(storageRoot, "child-env.json");
  setEnv("FAKE_TEXTFLOWKIT_MODE", "ok");
  setEnv("FAKE_TEXTFLOWKIT_ENV_DUMP", dumpPath);
  setEnv("BETTER_AUTH_SECRET", "stt-secret-that-must-not-travel");
  setEnv("ANTHROPIC_API_KEY", "sk-ant-must-not-reach-a-transcriber");

  const outputDir = join(storageRoot, "env-case-output");
  mkdirSync(outputDir, { recursive: true });
  const run = await transcribeAudioWithTextflowkit({
    audioPath: seed.audioPath,
    outputDir,
    durationSeconds: 15,
    env: cliEnv(),
  });
  assert.equal(run.ok, true, run.ok ? "" : run.reason);

  const childEnv = JSON.parse(readFileSync(dumpPath, "utf8")) as Record<string, string>;
  assert.equal("BETTER_AUTH_SECRET" in childEnv, false, "an auth secret must not reach the child");
  assert.equal("ANTHROPIC_API_KEY" in childEnv, false, "a provider key must not reach the child");
  assert.equal("DATABASE_URL" in childEnv, false, "the paper's database credentials must not reach the child");
  assert.equal(typeof childEnv.PATH, "string", "the allow-list still hands over what a process needs to start");
  assert.equal(childEnv.FAKE_TEXTFLOWKIT_MODE, "ok", "the harness prefix passes, so this proves the allow-list and not an empty environment");
  assert.equal(statSync(join(outputDir, readdirSync(outputDir)[0]!)).size > 0, true, "the fake really ran and wrote its JSON");
});
