/*
  Run the council-meeting writer: Scott's report-local-news skill, worked by an
  agent in its own folder -- SERVER ONLY (`.server.ts`).

  THE SHAPE OF A RUN. One new folder per run, under the newsroom's meeting storage
  root (the suffix is random, so a reused job id never reuses a folder):

      <root>/meeting-runs/newsroom-<newsroomId>/job-<jobId>-<random>/
          SKILL.md          the agent's only instructions, copied in
          scripts/audit.py  the audit the skill tells it to run, copied in
          transcript.txt    the whole meeting, one line per caption
          story.txt         what the agent writes: the story and the editor file
          audit-final.txt   the audit script's last run
          CHECK-FIRST.txt   the items the editor must check before publishing
          RUN-NOTES.md      which records were opened, what was missed

  The folder is KEPT after the run -- it is the evidence for the story, and the
  editor may need to see the transcript the writer actually read. The next run
  removes job folders older than 14 days, except one a saved draft points to
  (pruneOldMeetingRunFolders).

  WHY THE FOLDER IS BUILT HERE AND NOT BY THE AGENT. Everything the run depends
  on is placed before the agent starts, so a failure is always attributable: if
  `story.txt` is missing afterwards, nothing in the run's inputs was missing.
*/
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Sql } from "../db.ts";
import {
  REPORT_LOCAL_NEWS_REQUIRED_FILES,
  resolveReportLocalNewsDir,
  readReportLocalNewsVersion,
} from "./report-local-news.server.ts";
import { claudeCodeAgentRun, type ClaudeAgentRunResult } from "./ai-claude-code.server.ts";
import {
  assignmentPrompt,
  formatTranscript,
  meetingSourcesLine,
  meetingStamp,
  parseCheckFirst,
  parseSkillStory,
} from "./meeting-skill-writer.ts";
import { resolveMeetingStorageRoot } from "./meeting-transcript-artifacts.ts";
import type { ModelEffort } from "./provider-registry.ts";

/** One agent run may not take longer than this (Scott, D200). */
export const MEETING_SKILL_WRITER_TIMEOUT_MS = 45 * 60_000;

export type MeetingSkillWriterSuccess = {
  ok: true;
  headline: string;
  dek: string;
  body: string;
  /** The skill's CLAIMS AND SOURCES block, kept for `source_urls` (D217). */
  claims: string;
  /** The editor file plus the claims block: what `drafts.meeting_notes` holds. */
  editorFile: string;
  /** Items the editor must check before publishing. Empty when none were written. */
  checks: string[];
  /** The skill version this draft was written under, e.g. "3.1". */
  skillVersion: string;
  workDir: string;
  durationMs: number;
  /** The agent's own notes, when it wrote them. */
  runNotes: string;
  /** Tool names and counts from the agent's stream (TXB-2). Never inputs or results. */
  toolExecutions?: Record<string, number>;
};

export type MeetingSkillWriterFailure = {
  ok: false;
  /** A plain sentence for the editor. */
  error: string;
  /** Where the run's files are, when a folder was made. */
  workDir?: string;
};

export type MeetingSkillWriterResult = MeetingSkillWriterSuccess | MeetingSkillWriterFailure;

/** The runner this module calls. Injected in tests; the real one spawns the CLI. */
export type MeetingSkillWriterRunner = (input: {
  workDir: string;
  prompt: string;
  model: string;
  deepSeek?: { baseUrl: string; apiKey?: string };
  reasoningEffort?: ModelEffort | null;
  timeoutMs: number;
  onEvent?: (text: string) => void;
}) => Promise<ClaudeAgentRunResult>;

/**
 * The meeting's packet document URL, or null when there is none to cite.
 *
 * D217: the story closes with one sources line, and its packet link must be
 * THIS meeting's packet. The lookup is a parameter so a test never reaches the
 * portal; production's is `primeGovPacketUrlForMeeting`.
 */
export type MeetingPacketLookup = (input: {
  sql: Sql;
  newsroomId: number;
  title: string;
}) => Promise<string | null>;

/** How long the sources line will wait for the portal before going unlinked. */
export const MEETING_PACKET_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * The packet this meeting's portal lists, as a document URL.
 *
 * Only a document whose template name says "packet" counts, and a real Packet
 * PDF is preferred over the portal's `HTML Packet` viewer: the reader is being
 * given a record they can open and read, not a JavaScript shell. The origin is
 * the newsroom's own watched portal -- a city with no PrimeGov source gets no
 * link rather than a link to somebody else's city.
 */
export async function primeGovPacketUrlForMeeting(input: {
  sql: Sql;
  newsroomId: number;
  title: string;
}): Promise<string | null> {
  const { primeGovOriginForNewsroom } = await import("./primegov-source.ts");
  const { compiledDocumentUrl, primeGovDocumentsForTitle } = await import("./primegov.ts");
  const origin = await primeGovOriginForNewsroom(input.sql, input.newsroomId);
  if (!origin) return null;
  const found = await primeGovDocumentsForTitle(input.title, origin);
  const packets = (found?.meeting.documentList ?? []).filter((doc) => /packet/i.test(doc.templateName));
  if (!packets.length) return null;
  const chosen = packets.find((doc) => !/html\s*packet/i.test(doc.templateName)) ?? packets[0]!;
  return compiledDocumentUrl(origin, chosen);
}

/** A lookup bounded in time and forgiving of failure: no packet is a bare label. */
async function packetUrlOrNull(input: {
  lookup: MeetingPacketLookup;
  sql: Sql;
  newsroomId: number;
  title: string;
}): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.lookup({ sql: input.sql, newsroomId: input.newsroomId, title: input.title }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), MEETING_PACKET_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // The portal is a nicety on this line: a timeout, a refused read or a
    // changed page leaves the words "council packet" and no link. It never
    // invents one.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Where a run's folder goes: the newsroom's meeting storage, else a data root. */
export async function meetingRunRoot(
  sql: Sql,
  newsroomId: number,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const rows = await sql.query<{ storage_root: string | null }>(
    "select storage_root from meeting_capture_settings where newsroom_id=$1",
    [newsroomId],
  );
  const configured = rows[0]?.storage_root ?? null;
  if (configured && configured.trim()) return resolveMeetingStorageRoot(configured);
  const dataRoot = env.TOWNREPORTER_DATA_ROOT?.trim() || env.TOWNREPORTER_DATA_DIR?.trim();
  if (dataRoot) return dataRoot;
  return join(process.cwd(), ".townreporter-data");
}

/** Run folders older than this are cleaned up at the start of the next run. */
export const MEETING_RUN_KEEP_DAYS = 14;

/** `job-<id>-<six random characters>`, the exact shape mkdtemp gives a run folder. */
const RUN_FOLDER_NAME = /^job-[A-Za-z0-9_.-]+-[A-Za-z0-9]{6}$/;

function samePath(a: string, b: string): boolean {
  const norm = (value: string) => {
    const full = resolve(value);
    return process.platform === "win32" ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}

/**
 * G24-T3-1: every run made a new folder and nothing removed the old ones.
 *
 * Deletes the `job-<id>-XXXXXX` folders directly under `runsRoot` that were last
 * written more than `keepDays` days ago, except a folder a saved draft points to
 * (`drafts.run_stats.workDir`: the evidence for that story). Only folders whose
 * name has the run-folder shape are touched, only directly under `runsRoot`, and
 * a link is never followed. If the saved records cannot be read, nothing is
 * deleted. It never throws: a cleanup that fails is logged and the run goes on.
 */
export async function pruneOldMeetingRunFolders(input: {
  sql: Sql;
  runsRoot: string;
  keepDays?: number;
  now?: number;
  log?: (message: string) => void;
}): Promise<{ deleted: string[]; keptForRecords: string[]; failed: string[] }> {
  const result = { deleted: [] as string[], keptForRecords: [] as string[], failed: [] as string[] };
  const log = input.log ?? ((message: string) => console.warn(`[meeting-runs] ${message}`));
  try {
    const cutoff = (input.now ?? Date.now()) - (input.keepDays ?? MEETING_RUN_KEEP_DAYS) * 86_400_000;
    const root = resolve(input.runsRoot);
    if (!existsSync(root)) return result;
    const old: string[] = [];
    for (const name of readdirSync(root)) {
      if (!RUN_FOLDER_NAME.test(name)) continue;
      const path = join(root, name);
      try {
        const info = lstatSync(path);
        if (info.isSymbolicLink() || !info.isDirectory()) continue;
        if (info.mtimeMs < cutoff) old.push(path);
      } catch (error) {
        log(`could not look at ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!old.length) return result;
    // Which of them does a saved draft point to? Unreadable records mean "do not know", so nothing goes.
    const rows = await input.sql.query<{ work_dir: string | null }>(
      "select run_stats->>'workDir' as work_dir from drafts where run_stats->>'workDir' is not null",
      [],
    );
    const pointedTo = rows.map((row) => row.work_dir ?? "").filter(Boolean);
    for (const path of old) {
      if (!path.startsWith(root + sep)) continue;
      if (pointedTo.some((saved) => samePath(saved, path))) {
        result.keptForRecords.push(path);
        continue;
      }
      try {
        rmSync(path, { recursive: true, force: true });
        result.deleted.push(path);
      } catch (error) {
        result.failed.push(path);
        log(`could not delete ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (result.deleted.length) log(`removed ${result.deleted.length} run folder(s) older than ${input.keepDays ?? MEETING_RUN_KEEP_DAYS} days from ${root}`);
  } catch (error) {
    log(`old-run cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

/**
 * Write the meeting's caption segments out as the transcript the agent reads.
 *
 * Same rows, same order, same query as the retired whole-meeting writer used
 * (`loadWholeMeetingInput`): the transcript the writer sees is the transcript
 * the desk stored, nothing re-summarised on the way.
 */
async function writeTranscript(
  sql: Sql,
  input: { artifactId: number; title: string; meetingDate: string; videoId: string; workDir: string },
): Promise<{ lineCount: number; firstStamp: string; lastStamp: string } | { error: string }> {
  const segments = await sql.query<{ segment_index: number; start_seconds: number; excerpt: string }>(
    `select segment_index,start_seconds,excerpt from meeting_transcript_segments
      where artifact_id=$1 order by segment_index`,
    [input.artifactId],
  );
  if (!segments.length) {
    return { error: "This meeting has no stored captions, so there is nothing for the writer to read." };
  }
  const lines = segments.map((segment) => ({ startSeconds: Number(segment.start_seconds), excerpt: segment.excerpt }));
  writeFileSync(
    join(input.workDir, "transcript.txt"),
    formatTranscript(input.title, input.meetingDate, input.videoId, lines),
    "utf8",
  );
  return {
    lineCount: lines.length,
    firstStamp: meetingStamp(lines[0]!.startSeconds),
    lastStamp: meetingStamp(lines[lines.length - 1]!.startSeconds),
  };
}

/** A file in the run folder, or "" when the agent did not write it. */
function readOptional(workDir: string, name: string): string {
  const path = join(workDir, name);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * One run of the writer.
 *
 * `run` is the agent call. It is a parameter rather than a direct call so the
 * whole module -- folder, transcript, prompt, output parsing -- can be tested
 * without a login, a network, or a nine-minute wait.
 */
export async function runMeetingSkillWriter(input: {
  sql: Sql;
  newsroomId: number;
  jobId: number | string;
  artifactId: number;
  videoId: string;
  title: string;
  meetingDate: string;
  model: string;
  deepSeek?: { baseUrl: string; apiKey?: string };
  reasoningEffort?: ModelEffort | null;
  onStage?: (text: string) => void;
  run?: MeetingSkillWriterRunner;
  /** Injected for tests: today's date as the desk would say it. */
  today?: string;
  /** Injected for tests: this meeting's packet document URL. */
  packetUrlForMeeting?: MeetingPacketLookup;
  env?: Record<string, string | undefined>;
}): Promise<MeetingSkillWriterResult> {
  const skill = resolveReportLocalNewsDir(input.env ?? process.env);
  if (!skill.complete) {
    return {
      ok: false,
      error: `The meeting writer's skill folder is missing: ${skill.missing.join(", ")}.`,
    };
  }

  const root = await meetingRunRoot(input.sql, input.newsroomId, input.env ?? process.env);
  // D205: every run gets a folder of its own. A database restore can hand out a
  // job id that an older run already used, and reusing that folder would read
  // the older run's story.txt, CHECK-FIRST.txt and RUN-NOTES.md as this run's
  // output. mkdtemp makes a new, empty folder and never one that already exists.
  const runsRoot = join(root, "meeting-runs", `newsroom-${input.newsroomId}`);
  mkdirSync(runsRoot, { recursive: true });
  // G24-T3-1: old run folders go at the start of a run (never fails the run).
  await pruneOldMeetingRunFolders({ sql: input.sql, runsRoot });
  const workDir = mkdtempSync(join(runsRoot, `job-${input.jobId}-`));
  mkdirSync(join(workDir, "scripts"), { recursive: true });
  // The skill is copied in, never linked: the agent must not be able to edit the
  // shipped copy, and the run must stay readable after the app is rebuilt.
  for (const file of REPORT_LOCAL_NEWS_REQUIRED_FILES) {
    copyFileSync(join(skill.dir, file), join(workDir, file));
  }
  const skillVersion = readReportLocalNewsVersion(skill.dir);

  const transcript = await writeTranscript(input.sql, {
    artifactId: input.artifactId,
    title: input.title,
    meetingDate: input.meetingDate,
    videoId: input.videoId,
    workDir,
  });
  if ("error" in transcript) return { ok: false, error: transcript.error, workDir };

  const prompt = assignmentPrompt({
    title: input.title,
    date: input.meetingDate,
    videoId: input.videoId,
    lineCount: transcript.lineCount,
    firstStamp: transcript.firstStamp,
    lastStamp: transcript.lastStamp,
    today: input.today ?? new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: "America/Denver",
    }),
  });

  const run = input.run ?? claudeCodeAgentRun;
  let result: ClaudeAgentRunResult;
  try {
    result = await run({
      workDir,
      prompt,
      model: input.model,
      deepSeek: input.deepSeek,
      reasoningEffort: input.reasoningEffort,
      timeoutMs: MEETING_SKILL_WRITER_TIMEOUT_MS,
      onEvent: input.onStage,
    });
  } catch (error) {
    return {
      ok: false,
      error: `The writer could not start: ${error instanceof Error ? error.message : String(error)}`,
      workDir,
    };
  }

  const storyPath = join(workDir, "story.txt");
  const storyText = readOptional(workDir, "story.txt");
  if (!existsSync(storyPath) || !storyText.trim()) {
    return {
      ok: false,
      // A run that failed says why; a run that ended politely and wrote nothing
      // is a different fault and gets its own sentence.
      error: !result.ok
        ? result.error ?? "The writer failed."
        : "The writer finished without a story.",
      workDir,
    };
  }

  const story = parseSkillStory(storyText);
  if (!story.ok) return { ok: false, error: story.error, workDir };

  /*
    D217: one sources line closes the story, and the claims block moves to the
    editor's notes. The reader is told where the story came from in a sentence;
    the 48-line claim-by-claim list stays in the editor file, where the editor
    checking the story can see every one of them and nothing is lost.
  */
  const packetUrl = await packetUrlOrNull({
    lookup: input.packetUrlForMeeting ?? primeGovPacketUrlForMeeting,
    sql: input.sql,
    newsroomId: input.newsroomId,
    title: input.title,
  });
  const body = [
    story.body,
    meetingSourcesLine({
      date: input.meetingDate,
      videoId: input.videoId,
      title: input.title,
      packetUrl,
    }),
  ].join("\n\n");

  return {
    ok: true,
    headline: story.headline,
    dek: story.dek,
    body,
    claims: story.claims,
    editorFile: story.claims ? `${story.editorFile}\n\n${story.claims}` : story.editorFile,
    checks: parseCheckFirst(readOptional(workDir, "CHECK-FIRST.txt")),
    skillVersion,
    workDir,
    durationMs: result.durationMs,
    runNotes: readOptional(workDir, "RUN-NOTES.md"),
    ...(result.toolExecutions ? { toolExecutions: result.toolExecutions } : {}),
  };
}
