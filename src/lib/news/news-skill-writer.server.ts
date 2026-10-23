/*
  Run the report-local-news skill on an ORDINARY news lead -- SERVER ONLY
  (`.server.ts`).

  THE SHAPE OF A RUN. The same folder-per-draft arrangement the meeting writer
  uses (`runMeetingSkillWriter`), under the same storage root but its own tree:

      <root>/news-runs/newsroom-<newsroomId>/job-<jobId>/
          SKILL.md          the agent's only instructions, copied in
          scripts/audit.py  the audit the skill tells it to run, copied in
          LEAD.md           the lead: headline, why, topic, sources, evidence, notes
          story.txt         what the agent writes: the story and the editor file
          audit-final.txt   the audit script's last run
          CHECK-FIRST.txt   the items the editor must check before publishing
          RUN-NOTES.md      which records were opened, what was missed

  THE DIFFERENCE FROM THE MEETING WRITER. There is no transcript and no packet:
  the lead is the whole assignment, and the agent is told to research it from
  public records itself (that is the assignment the blind test measured). And
  the body is returned EXACTLY as the skill wrote it -- no sources line is
  appended, because a reader of a news story must see nothing new (D234).

  THE FOLDER IS BUILT HERE AND NOT BY THE AGENT, for the same reason as the
  meeting run: everything the run depends on is placed before the agent starts,
  so a failure is always attributable.
*/
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import {
  REPORT_LOCAL_NEWS_REQUIRED_FILES,
  resolveReportLocalNewsDir,
  readReportLocalNewsVersion,
} from "./report-local-news.server.ts";
import { claudeCodeAgentRun } from "./ai-claude-code.server.ts";
import { newsAssignmentPrompt, newsLeadFile, parseCheckFirst, parseSkillStory } from "./meeting-skill-writer.ts";
import { MEETING_SKILL_WRITER_TIMEOUT_MS, meetingRunRoot } from "./meeting-skill-writer.server.ts";
import type {
  MeetingSkillWriterFailure,
  MeetingSkillWriterRunner,
  MeetingSkillWriterSuccess,
} from "./meeting-skill-writer.server.ts";
import type { ModelEffort } from "./provider-registry.ts";

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

/** The lead's own `source_urls` column, read the way the harness read it. */
function sourceUrlsFromColumn(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string") : [];
  } catch {
    return [];
  }
}

/**
 * One run of the writer on one news lead.
 *
 * `run` is the agent call, injected exactly as the meeting runner's is, so the
 * folder, the lead file, the prompt and the output parsing can all be tested
 * without a login, a network call or a 45-minute wait.
 */
export async function runNewsSkillWriter(input: {
  sql: Sql;
  newsroomId: number;
  jobId: number | string;
  lead: {
    id: number | string;
    headline: string;
    why: string | null;
    topic: string | null;
    sourceUrls: string | null;
    evidence: string | null;
    notesJson: string | null;
  };
  model: string;
  deepSeek?: { baseUrl: string; apiKey?: string };
  reasoningEffort?: ModelEffort | null;
  onStage?: (text: string) => void;
  run?: MeetingSkillWriterRunner;
  /** Injected for tests: today's date as the desk would say it. */
  today?: string;
  env?: Record<string, string | undefined>;
}): Promise<MeetingSkillWriterSuccess | MeetingSkillWriterFailure> {
  const skill = resolveReportLocalNewsDir(input.env ?? process.env);
  if (!skill.complete) {
    return {
      ok: false,
      error: `The news writer's skill folder is missing: ${skill.missing.join(", ")}.`,
    };
  }

  /*
    The folder is built before the agent starts. A storage root the app cannot
    write to (a stale setting pointing at a file, a full disk, a permission
    change) used to throw out of this function, past the desk's fallback, which
    only answers a RETURNED failure. It returns one now.
  */
  let workDir: string;
  let skillVersion: string;
  try {
    const root = await meetingRunRoot(input.sql, input.newsroomId, input.env ?? process.env);
    workDir = join(root, "news-runs", `newsroom-${input.newsroomId}`, `job-${input.jobId}`);
    mkdirSync(join(workDir, "scripts"), { recursive: true });
    // Copied, never linked: the agent must not be able to edit the shipped copy.
    for (const file of REPORT_LOCAL_NEWS_REQUIRED_FILES) {
      copyFileSync(join(skill.dir, file), join(workDir, file));
    }
    skillVersion = readReportLocalNewsVersion(skill.dir);
  } catch (error) {
    return {
      ok: false,
      error: `The writer could not set up its folder: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const headline = String(input.lead.headline ?? "");
  const topic = String(input.lead.topic ?? "");
  writeFileSync(
    join(workDir, "LEAD.md"),
    newsLeadFile({
      id: input.lead.id,
      headline,
      why: String(input.lead.why ?? ""),
      topic,
      sourceUrls: sourceUrlsFromColumn(input.lead.sourceUrls),
      evidence: String(input.lead.evidence ?? ""),
      notesJson: input.lead.notesJson,
    }),
    "utf8",
  );

  const prompt = newsAssignmentPrompt({
    headline,
    topic,
    today: input.today ?? new Date().toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "short", day: "numeric", timeZone: "America/Denver",
    }),
  });

  const run = input.run ?? claudeCodeAgentRun;
  let result;
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
      error: !result.ok
        ? result.error ?? "The writer failed."
        : "The writer finished without a story.",
      workDir,
    };
  }

  const story = parseSkillStory(storyText);
  if (!story.ok) return { ok: false, error: story.error, workDir };

  return {
    ok: true,
    headline: story.headline,
    dek: story.dek,
    // D234: the body is the skill's own text. No sources line is appended --
    // a news story's reader sees exactly what the 4-pass writer's reader sees.
    body: story.body,
    claims: story.claims,
    editorFile: story.claims ? `${story.editorFile}\n\n${story.claims}` : story.editorFile,
    checks: parseCheckFirst(readOptional(workDir, "CHECK-FIRST.txt")),
    skillVersion,
    workDir,
    durationMs: result.durationMs,
    runNotes: readOptional(workDir, "RUN-NOTES.md"),
  };
}
