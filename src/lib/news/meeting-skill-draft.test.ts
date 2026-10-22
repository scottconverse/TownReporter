import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { MeetingSkillWriterRunner } from "./meeting-skill-writer.server.ts";

/*
  MS-WIRE W1: the Draft path for a whole-meeting lead runs the report-local-news
  skill writer, and what it returns becomes the saved draft row.

  The agent itself is the injected `run`: it writes the two files a real run
  writes (`story.txt`, `CHECK-FIRST.txt`) into the run folder and returns, so
  this test proves the desk's wiring -- which artifact and meeting it hands
  over, model choice, and the three columns the editor-only record lands in --
  with no CLI, login or network.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftWork: typeof import("./desk.ts").performDraftWork;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-meeting-skill-draft-${process.pid}`),
    server: { middlewareMode: true, hmr: { port: 0 } },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
});
after(async () => vite?.close());

const STORY = [
  "Longmont approves the housing plan",
  "",
  "The council voted 6-1 Tuesday for the plan.",
  "",
  "The City Council approved the housing plan on Tuesday night after a short debate.",
  "",
  "ALSO AT THE MEETING",
  "",
  "The council proclaimed October Arts Month.",
  "",
  "CLAIMS AND SOURCES",
  "",
  "Claim: The council approved the housing plan.",
  "Source (primary record): Meeting video, vote at 0:01:12. https://www.youtube.com/watch?v=mskill00001",
  "Source (primary record): Council packet, item 4. https://www.youtube.com/watch?v=mskill00001",
  "",
  "EDITOR FILE: NOT FOR PUBLICATION",
  "",
  "Check the 6-1 tally against the recording.",
  "The parking figure is read off a slide.",
].join("\n");

const CHECKS = [
  "Check the 6-1 tally against the recording.",
  "The parking figure is read off a slide.",
];

test("a whole-meeting draft is the skill writer's story, with its editor file and checks saved", async () => {
  await ensureJobsSchema();
  const sql = await getSql();
  const room = 88510;
  const user = "meeting-skill-editor";
  const videoId = "mskill00001";
  const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-meeting-skill-run-"));
  // The writer builds a DeepSeek relay endpoint for the tested model; naming one
  // keeps the resolution deterministic. The injected runner never dials it.
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    await sql.query("insert into newsrooms(id,name) values($1,'Meeting skill room') on conflict(id) do nothing", [room]);
    await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
    await sql.query("insert into meeting_capture_settings(newsroom_id,storage_root) values($1,$2) on conflict(newsroom_id) do update set storage_root=excluded.storage_root", [room, storageRoot]);
    const [artifact] = await sql.query<{ id: number }>(
      `insert into meeting_transcript_artifacts
         (newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode)
       values ($1,$2,'fixture.vtt','vtt',$3,'captions','transcript-only')
       returning id`,
      [room, videoId, `sha-${Date.now()}`],
    );
    await sql.query(
      `insert into meeting_transcript_segments
         (artifact_id,segment_index,start_seconds,end_seconds,item,excerpt,caption_sha256)
       values ($1,0,0,60,'4',$2,'cap0'), ($1,1,60,132,'4',$3,'cap1')`,
      [artifact.id, "The council approved the housing plan.", "The parking figure is 700 spaces."],
    );
    await sql.query(
      `insert into meeting_agenda_chunks(newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes)
       values ($1,$2,$3,'4','Housing plan',0,132,'[0,1]')`,
      [room, videoId, artifact.id],
    );
    const [lead] = await sql.query<{ id: number }>(
      `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,
                         meeting_video_id,meeting_artifact_id,meeting_lead_purpose)
       values ($1,$2,'Longmont meets','Why','council','new','[]','',1,'{}',$3,$4,'transcript-story')
       returning id`,
      [user, room, videoId, artifact.id],
    );
    const [jobRow] = await sql.query<{ id: number }>(
      `insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token)
       values ($1,$2,'draft',$3,'deepseek-flash','editor','public','default','running','Writing','meeting-skill-claim')
       returning id`,
      [user, room, lead.id],
    );
    const job = {
      id: jobRow.id, user_id: user, newsroom_id: room, kind: "draft", subject_id: lead.id,
      model_choice: "deepseek-flash", model_choice_source: "editor", research_scope: "public",
      lane: "default", status: "running", stage: "Writing", claim_token: "meeting-skill-claim",
    } as DeskJob;

    const handed: Array<{ prompt: string; model: string; workDir: string }> = [];
    const run: MeetingSkillWriterRunner = async (input) => {
      handed.push({ prompt: input.prompt, model: input.model, workDir: input.workDir });
      writeFileSync(join(input.workDir, "story.txt"), STORY, "utf8");
      writeFileSync(join(input.workDir, "CHECK-FIRST.txt"), `${CHECKS.join("\n")}\n`, "utf8");
      return { ok: true, exitCode: 0, timedOut: false, durationMs: 1234, lastText: "RUN-DONE" };
    };

    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      meetingWriterRun: run,
      meetingPacketUrl: async () => "https://example.gov/Public/CompiledDocument?meetingTemplateId=4",
      setJobStage: async () => undefined,
      setJobFailoverNote: async () => undefined,
    });

    assert.equal(handed.length, 1, "one agent run");
    assert.equal(handed[0]!.model, "deepseek-v4.1-flash:1017-cloud");
    assert.match(handed[0]!.prompt, /Cover the whole meeting/);
    const [draft] = await sql.query<{
      headline: string; dek: string; body: string; topic: string; source_urls: string;
      model_body: string | null; meeting_notes: string | null; editor_checks: unknown;
      run_stats: Record<string, unknown> | null;
    }>(
      `select headline,dek,body,topic,source_urls,model_body,meeting_notes,editor_checks,run_stats
         from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1`,
      [room, lead.id],
    );
    assert.equal(draft!.headline, "Longmont approves the housing plan");
    assert.equal(draft!.dek, "The council voted 6-1 Tuesday for the plan.");
    assert.match(draft!.body, /ALSO AT THE MEETING/);
    // D217: the claims list is not in the published body; one sources line is.
    assert.equal(draft!.body.includes("CLAIMS AND SOURCES"), false);
    assert.equal(
      draft!.body.endsWith(
        // No capture record names a date or a council, so the line says
        // "meeting video" and "meeting packet" (D217).
        "Sources: [meeting video](https://www.youtube.com/watch?v=mskill00001) and [meeting packet](https://example.gov/Public/CompiledDocument?meetingTemplateId=4).",
      ),
      true,
    );
    assert.equal(draft!.topic, "council");
    assert.equal(draft!.model_body, draft!.body, "the model's own body is filed beside the editor's");
    assert.deepEqual(JSON.parse(draft!.source_urls), ["https://www.youtube.com/watch?v=mskill00001"]);
    assert.match(draft!.meeting_notes ?? "", /^EDITOR FILE: NOT FOR PUBLICATION/);
    // The editor's notes keep the claims block the reader no longer sees.
    assert.match(draft!.meeting_notes ?? "", /CLAIMS AND SOURCES/);
    assert.deepEqual(draft!.editor_checks, CHECKS);
    assert.equal(draft!.run_stats?.writer, "report-local-news");
    assert.equal(draft!.run_stats?.model, "deepseek-v4.1-flash:1017-cloud");
    assert.equal(draft!.run_stats?.wallMs, 1234);
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});
