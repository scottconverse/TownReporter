/*
  G26-MR-1 (Oct 26 2026): a skill-written story's receipt names the model that
  ran. The four-pass and batch paths already wrote `actualModelId` from the
  model the provider reported; the report-local-news skill paths (news lead and
  whole meeting) did not, so the receipt could only show the model asked for
  (rule 16: the model shown is the model that ran).

  Two halves, both with fakes only:
  - the CLI agent run reads the model the Claude Code CLI says answered off its
    own stream (a temp fake CLI script), and names none when the CLI named none;
  - the desk writes that model to the job receipt's `actualModelId` on both
    skill paths, and writes no `actualModelId` at all when the run named none
    (the asked-for model is never copied in).
*/
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { MeetingSkillWriterRunner } from "./meeting-skill-writer.server.ts";
import { claudeCodeAgentRun, resetClaudeCliCache } from "./ai-claude-code.server.ts";

const ASKED = "deepseek-v4.1-flash:1017-cloud";
const SERVED = "deepseek-v4.1-flash:1017-cloud-served-by-the-cli";

const dirs: string[] = [];
let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftWork: typeof import("./desk.ts").performDraftWork;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-skill-served-model-${process.pid}`),
    server: { middlewareMode: true, hmr: { port: 0 } },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});
after(async () => {
  await vite?.close();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** A throwaway fake Claude CLI that prints `events` as stream-json lines and exits 0. */
async function fakeAgentCli(events: unknown[]): Promise<{ cli: string; workDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tr-skill-served-"));
  dirs.push(dir);
  const cli = join(dir, "fake-claude.mjs");
  const lines = events.map((event) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(event)}\n`)});`);
  await writeFile(cli, `${lines.join("\n")}\n`, "utf8");
  const workDir = join(dir, "work");
  await (await import("node:fs/promises")).mkdir(workDir);
  return { cli, workDir };
}

async function agentRunWith(events: unknown[]) {
  const { cli, workDir } = await fakeAgentCli(events);
  const previous = process.env.CLAUDE_CLI_PATH;
  process.env.CLAUDE_CLI_PATH = cli;
  resetClaudeCliCache();
  try {
    return await claudeCodeAgentRun({ workDir, prompt: "Write the story.", model: ASKED, timeoutMs: 20_000 });
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = previous;
    resetClaudeCliCache();
  }
}

describe("G26-MR-1: the CLI agent run reports the model the CLI says answered", () => {
  it("reads the served model off the stream's assistant messages", async () => {
    const result = await agentRunWith([
      { type: "system", subtype: "init", model: ASKED },
      { type: "assistant", message: { model: SERVED, content: [{ type: "text", text: "Reading the lead." }] } },
      { type: "result", subtype: "success", result: "RUN-DONE" },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.servedModel, SERVED);
  });

  it("falls back to the result event's own model report when no assistant message named one", async () => {
    const result = await agentRunWith([
      { type: "result", subtype: "success", result: "RUN-DONE", modelUsage: { [SERVED]: { outputTokens: 10 } } },
    ]);
    assert.equal(result.servedModel, SERVED);
  });

  it("names no model, and never the asked-for one, when the CLI named none", async () => {
    const result = await agentRunWith([
      // The init line repeats the model the CLI was TOLD to use; that is the ask, not a report.
      { type: "system", subtype: "init", model: ASKED },
      { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "hi" }] } },
      { type: "result", subtype: "success", result: "RUN-DONE" },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.servedModel, undefined);
  });
});

const NEWS_STORY = [
  "Longmont approves the housing plan",
  "",
  "The council voted 6-1 Tuesday for the plan.",
  "",
  "The City Council approved the housing plan on Tuesday night after a short debate.",
  "",
  "CLAIMS AND SOURCES",
  "",
  "Claim: The council approved the housing plan.",
  "Source (primary record): Ordinance 2026-14. https://records.example.gov/ordinance-2026-14",
  "",
  "EDITOR FILE: NOT FOR PUBLICATION",
  "",
  "Check the tally.",
].join("\n");

const MEETING_STORY = [
  "Longmont approves the housing plan",
  "",
  "The council voted 6-1 Tuesday for the plan.",
  "",
  "The City Council approved the housing plan on Tuesday night after a short debate.",
  "",
  "CLAIMS AND SOURCES",
  "",
  "Claim: The council approved the housing plan.",
  "Source (primary record): Meeting video. https://www.youtube.com/watch?v=served00001",
  "",
  "EDITOR FILE: NOT FOR PUBLICATION",
  "",
  "Check the tally.",
].join("\n");

/** A fake agent: writes the story a real run writes, and reports `servedModel` (or none). */
function writer(story: string, servedModel?: string): MeetingSkillWriterRunner {
  return async (input) => {
    writeFileSync(join(input.workDir, "story.txt"), story, "utf8");
    writeFileSync(join(input.workDir, "CHECK-FIRST.txt"), "Check the tally.\n", "utf8");
    return {
      ok: true, exitCode: 0, timedOut: false, durationMs: 77, lastText: "RUN-DONE",
      ...(servedModel ? { servedModel } : {}),
    };
  };
}

async function room(id: number) {
  await ensureJobsSchema();
  const sql = await getSql();
  const user = `served-model-editor-${id}`;
  const storageRoot = mkdtempSync(join(tmpdir(), "tr-served-model-run-"));
  dirs.push(storageRoot);
  await sql.query("insert into newsrooms(id,name) values($1,'Served model room') on conflict(id) do nothing", [id]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, id]);
  await sql.query(
    "insert into meeting_capture_settings(newsroom_id,storage_root) values($1,$2) on conflict(newsroom_id) do update set storage_root=excluded.storage_root",
    [id, storageRoot],
  );
  return { sql, user };
}

async function draftJob(sql: Awaited<ReturnType<typeof getSql>>, id: number, user: string, leadId: number): Promise<DeskJob> {
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token)
     values($1,$2,'draft',$3,'deepseek-flash','editor','public','default','running','Writing',$4)
     returning id`,
    [user, id, leadId, `served-model-claim-${id}`],
  );
  return {
    id: jobRow!.id, user_id: user, newsroom_id: id, kind: "draft", subject_id: leadId,
    model_choice: "deepseek-flash", model_choice_source: "editor", research_scope: "public",
    lane: "default", status: "running", stage: "Writing", claim_token: `served-model-claim-${id}`,
  } as DeskJob;
}

async function newsDraft(id: number, servedModel?: string) {
  const { sql, user } = await room(id);
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json)
     values($1,$2,'Longmont weighs the housing plan','A vote is scheduled','housing','new',$3,'Staff report',1,'{}')
     returning id`,
    [user, id, JSON.stringify(["https://records.example.gov/ordinance-2026-14"])],
  );
  const job = await draftJob(sql, id, user, lead!.id);
  await performDraftWork(job, {
    readStoryDocuments: async () => "",
    newsWriterRun: writer(NEWS_STORY, servedModel),
    reportAndDraft: async () => {
      throw new Error("the four-pass writer must not run when the skill wrote the story");
    },
    newsSourceCopy: {
      ingest: async (url) => ({ url, title: "Saved page", text: "Page text", extras: [] }),
      capture: async () => ({ version_id: 1, capture_event_id: 2 }),
    },
    setJobStage: async () => undefined,
    setJobFailoverNote: async () => undefined,
  });
  return readBack(sql, id, lead!.id, job.id);
}

async function meetingDraft(id: number, servedModel?: string) {
  const { sql, user } = await room(id);
  const videoId = `served${id}`;
  const [artifact] = await sql.query<{ id: number }>(
    `insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode)
     values($1,$2,'fixture.vtt','vtt',$3,'captions','transcript-only') returning id`,
    [id, videoId, `sha-served-${id}-${Date.now()}`],
  );
  await sql.query(
    `insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256)
     values ($1,0,0,60,'4','The council approved the housing plan.','cap0')`,
    [artifact!.id],
  );
  await sql.query(
    `insert into meeting_agenda_chunks(newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes)
     values ($1,$2,$3,'4','Housing plan',0,60,'[0]')`,
    [id, videoId, artifact!.id],
  );
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,
                       meeting_video_id,meeting_artifact_id,meeting_lead_purpose)
     values ($1,$2,'Longmont meets','Why','council','new','[]','',1,'{}',$3,$4,'transcript-story')
     returning id`,
    [user, id, videoId, artifact!.id],
  );
  const job = await draftJob(sql, id, user, lead!.id);
  await performDraftWork(job, {
    readStoryDocuments: async () => "",
    meetingWriterRun: writer(MEETING_STORY, servedModel),
    meetingPacketUrl: async () => null,
    setJobStage: async () => undefined,
    setJobFailoverNote: async () => undefined,
  });
  return readBack(sql, id, lead!.id, job.id);
}

async function readBack(sql: Awaited<ReturnType<typeof getSql>>, id: number, leadId: number, jobId: number) {
  const [draft] = await sql.query<{ run_stats: Record<string, unknown> | null; body: string }>(
    "select run_stats, body from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1",
    [id, leadId],
  );
  const [row] = await sql.query<{ result_json: string | null }>("select result_json from desk_jobs where id=$1", [jobId]);
  return { draft: draft!, receipt: JSON.parse(row?.result_json || "{}") as Record<string, unknown> };
}

describe("G26-MR-1: a skill-written story's receipt names the model that ran", () => {
  const withRelay = async <T>(work: () => Promise<T>) => {
    // The writer builds a DeepSeek relay endpoint for the tested model; the injected runner never dials it.
    process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
    try {
      return await work();
    } finally {
      delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
    }
  };

  it("a news-lead skill run stores the CLI's served model as actualModelId", async () => {
    const { draft, receipt } = await withRelay(() => newsDraft(88_771, SERVED));
    assert.equal(receipt.actualModelId, SERVED);
    assert.equal(draft.run_stats?.model, ASKED, "run_stats still says what was asked for");
    assert.equal(draft.body.includes(SERVED), false, "nothing is added to the story text");
  });

  it("a news-lead skill run whose CLI named no model leaves actualModelId empty, never the asked-for model", async () => {
    const { draft, receipt } = await withRelay(() => newsDraft(88_772));
    assert.equal("actualModelId" in receipt, false, JSON.stringify(receipt));
    assert.equal(draft.run_stats?.model, ASKED);
  });

  it("a whole-meeting skill run stores the CLI's served model as actualModelId", async () => {
    const { draft, receipt } = await withRelay(() => meetingDraft(88_773, SERVED));
    assert.equal(receipt.actualModelId, SERVED);
    assert.equal(draft.run_stats?.model, ASKED);
    assert.equal(draft.body.includes(SERVED), false, "nothing is added to the story text");
  });

  it("a whole-meeting skill run whose CLI named no model leaves actualModelId empty", async () => {
    const { receipt } = await withRelay(() => meetingDraft(88_774));
    assert.equal("actualModelId" in receipt, false, JSON.stringify(receipt));
  });
});
