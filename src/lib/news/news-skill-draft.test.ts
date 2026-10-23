import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { MeetingSkillWriterRunner } from "./meeting-skill-writer.server.ts";
import { pickSourceCopyIngest, type ReportedDraftResult } from "./desk-model-run.ts";
import type { IngestOptions } from "./ingest.ts";

/*
  D234: the report-local-news skill writes NORMAL news leads, not only meetings.

  The blind test (Goals/TownReporter-WRITER-TEST-C-2026-10-22.md) graded the
  same five leads written three ways and the skill, run once as an agent, won
  five of five. These tests prove the desk's wiring for that: which writer gets
  which pick, that a news body is never given a sources line a reader did not
  have before, the fallback to the four-pass writer on the same pick, and the
  saved copies of the sources.

  The agent is the injected `run`: it writes the files a real run writes and
  returns, so no CLI, login or network is needed.
*/

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let providerEntry: typeof import("./provider-registry.ts").providerEntry;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-news-skill-draft-${process.pid}`),
    server: { middlewareMode: true, hmr: { port: 0 } },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ providerEntry } = await vite.ssrLoadModule("/src/lib/news/provider-registry.ts"));
});
after(async () => vite?.close());

const SOURCE_URLS = [
  "https://records.example.gov/ordinance-2026-14",
  "https://records.example.gov/council-agenda-oct-20",
  "https://news.example.com/housing-plan-vote",
];

const STORY = [
  "Longmont approves the housing plan",
  "",
  "The council voted 6-1 Tuesday for the plan.",
  "",
  "The City Council approved the housing plan on Tuesday night after a short debate, according to the ordinance and the agenda.",
  "",
  "CLAIMS AND SOURCES",
  "",
  "Claim: The council approved the housing plan.",
  `Source (primary record): Ordinance 2026-14. ${SOURCE_URLS[0]}`,
  `Source (primary record): Agenda, item 4. ${SOURCE_URLS[1]}`,
  `Source (secondary): The local outlet's account. ${SOURCE_URLS[2]}`,
  "",
  "EDITOR FILE: NOT FOR PUBLICATION",
  "",
  "Check the 6-1 tally against the minutes.",
].join("\n");

const CHECKS = ["Check the 6-1 tally against the minutes."];

const REPORTED = {
  headline: "Standard writer headline",
  dek: "A dek.",
  body: "The standard writer's body.",
  topic: "housing",
  source_urls: [],
  integrity_notes: "",
  memory_entities: [],
  form: "news",
  provenance: [],
  found_note: "",
  findings: [],
  unanswered: [],
  claims: [],
  research_memo: {},
} as unknown as ReportedDraftResult;

/**
 * One newsroom, one news lead (no meeting fields) and one running draft job.
 * `meeting` gives the lead a transcript story and an aligned artifact, and
 * names one agenda item in its editor notes, which is the case that keeps the
 * one-item meeting path.
 */
async function fixture(room: number, choice: string, options: { meeting?: boolean } = {}) {
  await ensureJobsSchema();
  const sql = await getSql();
  const user = `news-skill-editor-${room}`;
  const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-news-skill-run-"));
  await sql.query("insert into newsrooms(id,name) values($1,'News skill room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  await sql.query(
    "insert into meeting_capture_settings(newsroom_id,storage_root) values($1,$2) on conflict(newsroom_id) do update set storage_root=excluded.storage_root",
    [room, storageRoot],
  );
  let meetingArtifactId: number | null = null;
  const videoId = `meeting-video-${room}`;
  if (options.meeting) {
    const [artifact] = await sql.query<{ id: number }>(
      `insert into meeting_transcript_artifacts(newsroom_id,video_id,storage_path,format,sha256,source_method,retention_mode)
       values($1,$2,'C:/scratch/transcript.vtt','vtt',$3,'captions','transcript-only') returning id`,
      [room, videoId, "c".repeat(64)],
    );
    meetingArtifactId = artifact!.id;
    await sql.query(
      `insert into meeting_transcript_segments(artifact_id,segment_index,start_seconds,end_seconds,excerpt,caption_sha256)
       values($1,0,0,30,'The council takes up ordinance 2026-46.','d')`,
      [meetingArtifactId],
    );
    await sql.query(
      `insert into meeting_agenda_chunks(newsroom_id,video_id,artifact_id,item,title,start_seconds,end_seconds,segment_indexes)
       values($1,$2,$3,'9B2','Ordinance 2026-46',0,30,'[0]')`,
      [room, videoId, meetingArtifactId],
    );
  }
  const notesJson = options.meeting
    ? JSON.stringify({ editorialAssignment: { origin: "story-workspace", text: "Cover item 9B2" } })
    : "{}";
  const [lead] = await sql.query<{ id: number }>(
    `insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json,
                       meeting_video_id,meeting_artifact_id,meeting_lead_purpose)
     values($1,$2,'Longmont weighs the housing plan','A vote is scheduled','housing','new',$3,'Staff report says 700 units',1,$4,
            $5,$6,$7)
     returning id`,
    [
      user,
      room,
      JSON.stringify(SOURCE_URLS),
      notesJson,
      options.meeting ? videoId : null,
      meetingArtifactId,
      options.meeting ? "transcript-story" : null,
    ],
  );
  const [jobRow] = await sql.query<{ id: number }>(
    `insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token)
     values($1,$2,'draft',$3,$4,'editor','public','default','running','Writing',$5)
     returning id`,
    [user, room, lead.id, choice, `news-skill-claim-${room}`],
  );
  const job = {
    id: jobRow.id, user_id: user, newsroom_id: room, kind: "draft", subject_id: lead.id,
    model_choice: choice, model_choice_source: "editor", research_scope: "public",
    lane: "default", status: "running", stage: "Writing", claim_token: `news-skill-claim-${room}`,
  } as DeskJob;
  const readDraft = async () => {
    const [draft] = await sql.query<{
      headline: string; dek: string; body: string; topic: string; source_urls: string;
      meeting_notes: string | null; editor_checks: unknown; run_stats: Record<string, unknown> | null;
    }>(
      `select headline,dek,body,topic,source_urls,meeting_notes,editor_checks,run_stats
         from drafts where newsroom_id=$1 and lead_id=$2 order by id desc limit 1`,
      [room, lead.id],
    );
    return draft!;
  };
  return { sql, user, lead, job, readDraft };
}

function storyWriter(handed: Array<{ prompt: string; model: string; deepSeek?: unknown }>): MeetingSkillWriterRunner {
  return async (input) => {
    handed.push({ prompt: input.prompt, model: input.model, deepSeek: input.deepSeek });
    writeFileSync(join(input.workDir, "story.txt"), STORY, "utf8");
    writeFileSync(join(input.workDir, "CHECK-FIRST.txt"), `${CHECKS.join("\n")}\n`, "utf8");
    return { ok: true, exitCode: 0, timedOut: false, durationMs: 4242, lastText: "RUN-DONE" };
  };
}

test("a DeepSeek pick on a news lead runs the skill writer, and the story gets no added sources line", async () => {
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const { job, readDraft } = await fixture(88610, "deepseek-flash");
    const handed: Array<{ prompt: string; model: string; deepSeek?: unknown }> = [];
    const reportCalls: Array<{ modelChoice: string }> = [];
    const captured: string[] = [];
    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      newsWriterRun: storyWriter(handed),
      reportAndDraft: async (input) => {
        reportCalls.push({ modelChoice: String(input.modelChoice) });
        return REPORTED;
      },
      newsSourceCopy: {
        ingest: async (url) => ({ url, title: "Saved page", text: "Page text", extras: [] }),
        capture: async (_userId, doc) => {
          captured.push(doc.url);
          return { version_id: 1, capture_event_id: 2 };
        },
      },
      setJobStage: async () => undefined,
      setJobFailoverNote: async () => undefined,
      // D234 fix 1: saving the sources' copies is app code with no model, so
      // it must never move the job's model choice off the DeepSeek pick.
      setJobModelRuntime: async () => {
        throw new Error("a saved source copy must not switch the job's model");
      },
    });

    assert.equal(handed.length, 1, "one agent run");
    assert.equal(handed[0]!.model, "deepseek-v4.1-flash:1017-cloud");
    assert.ok(handed[0]!.deepSeek, "the DeepSeek relay the meeting writer builds");
    assert.match(handed[0]!.prompt, /Write ONE straight local news story about ONE lead/);
    assert.equal(reportCalls.length, 0, "the four-pass writer is not called");

    const draft = await readDraft();
    assert.equal(draft.headline, "Longmont approves the housing plan");
    assert.equal(draft.dek, "The council voted 6-1 Tuesday for the plan.");
    // D234 point 3: the reader sees nothing new -- no sources sentence is added.
    assert.equal(draft.body.includes("CLAIMS AND SOURCES"), false);
    assert.equal(/^Sources: /m.test(draft.body), false);
    assert.match(draft.body, /The City Council approved the housing plan on Tuesday night/);
    // The claims block and the editor file stay the editor's.
    assert.match(draft.meeting_notes ?? "", /^EDITOR FILE: NOT FOR PUBLICATION/);
    assert.match(draft.meeting_notes ?? "", /CLAIMS AND SOURCES/);
    assert.deepEqual(draft.editor_checks, CHECKS);
    assert.deepEqual(JSON.parse(draft.source_urls), SOURCE_URLS);
    assert.equal(draft.run_stats?.writer, "report-local-news");
    assert.equal(draft.run_stats?.model, "deepseek-v4.1-flash:1017-cloud");
    assert.equal(draft.run_stats?.wallMs, 4242);
    assert.deepEqual(captured, SOURCE_URLS, "every final source URL is saved once");
    const [row] = await (await getSql()).query<{ model_choice: string }>(
      "select model_choice from desk_jobs where id=$1",
      [job.id],
    );
    assert.equal(row?.model_choice, "deepseek-flash", "the receipt still names the writer's model");
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});

test("a Claude pick on a news lead runs the skill writer on that Claude model, as itself", async () => {
  const { job, readDraft } = await fixture(88611, "claude-sonnet");
  const handed: Array<{ prompt: string; model: string; deepSeek?: unknown }> = [];
  await performDraftWork(job, {
    readStoryDocuments: async () => "",
    newsWriterRun: storyWriter(handed),
    reportAndDraft: async () => {
      throw new Error("the four-pass writer must not run on a Claude pick");
    },
    newsSourceCopy: {
      ingest: async (url) => ({ url, title: "", text: "text", extras: [] }),
      capture: async () => ({ version_id: 1, capture_event_id: 2 }),
    },
    setJobStage: async () => undefined,
    setJobFailoverNote: async () => undefined,
  });

  assert.equal(handed.length, 1);
  assert.equal(handed[0]!.model, providerEntry("claude-sonnet")?.model);
  assert.equal(handed[0]!.deepSeek, undefined, "a Claude pick runs on its own CLI model");
  const draft = await readDraft();
  assert.equal(draft.run_stats?.model, providerEntry("claude-sonnet")?.model);
  assert.equal(draft.run_stats?.requestedModel, undefined, "a news lead is never a substitution");
});

test("a meeting lead whose notes name one agenda item never goes to the news writer", async () => {
  /*
    A1 (Critical): a meeting lead whose editor assignment names one item
    ("Cover item 9B2") is not a whole-meeting lead, and the news writer is told
    "This is not a meeting: there is no transcript" -- it never reads the tape.
    It must go to the one-item meeting path with the transcript evidence (D234:
    "Meetings unchanged"), on a pick that runs the news skill.
  */
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const { job, readDraft } = await fixture(88616, "deepseek-flash", { meeting: true });
    const handed: Array<{ prompt: string; model: string }> = [];
    const reportCalls: Array<{ modelChoice: string }> = [];
    const draftInputs: Array<{ extraEvidence?: unknown; extraEvidenceMode?: unknown }> = [];
    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      newsWriterRun: async (input) => {
        handed.push({ prompt: input.prompt, model: input.model });
        return { ok: true, exitCode: 0, timedOut: false, durationMs: 5, lastText: "" };
      },
      // The whole-meeting agent is not under test here; it must not start.
      meetingWriterRun: async () => {
        throw new Error("the whole-meeting writer must not run for a one-item assignment");
      },
      reportAndDraft: async (input) => {
        reportCalls.push({ modelChoice: String(input.modelChoice) });
        draftInputs.push({ extraEvidence: input.extraEvidence, extraEvidenceMode: input.extraEvidenceMode });
        return REPORTED;
      },
      setJobStage: async () => undefined,
      setJobFailoverNote: async () => undefined,
    });
    assert.equal(handed.length, 0, "the news writer must never be handed a meeting lead");
    assert.deepEqual(reportCalls, [{ modelChoice: "deepseek-flash" }], "the one-item meeting path writes it");
    // R2-ENG-2: the one-item path is handed the transcript, not just the model.
    assert.equal(draftInputs[0]?.extraEvidenceMode, "meeting-transcript");
    assert.match(
      String(draftInputs[0]?.extraEvidence),
      /The council takes up ordinance 2026-46\./,
      "the one-item meeting path reads the stored transcript",
    );
    const draft = await readDraft();
    assert.equal(draft.headline, "Standard writer headline");
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});

test("a Codex pick on a news lead keeps the four-pass writer on Codex", async () => {
  const { job, readDraft } = await fixture(88612, "codex-balanced");
  const handed: Array<{ prompt: string; model: string }> = [];
  const reportCalls: Array<{ modelChoice: string }> = [];
  await performDraftWork(job, {
    readStoryDocuments: async () => "",
    newsWriterRun: storyWriter(handed),
    reportAndDraft: async (input) => {
      reportCalls.push({ modelChoice: String(input.modelChoice) });
      return REPORTED;
    },
    setJobStage: async () => undefined,
    setJobFailoverNote: async () => undefined,
  });

  assert.equal(handed.length, 0, "the skill is not called on a pick that cannot run it");
  assert.deepEqual(reportCalls, [{ modelChoice: "codex-balanced" }]);
  const draft = await readDraft();
  assert.equal(draft.headline, "Standard writer headline");
  // No skill record is claimed: the run stats name no model because the
  // four-pass writer's own run is what the job's receipt describes.
  assert.equal(draft.run_stats, null);
  assert.equal(job.model_choice, "codex-balanced", "the pick the editor made is the pick that ran");
});

test("a failed skill run falls back to the four-pass writer on the same pick, and says so", async () => {
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const { job, readDraft } = await fixture(88613, "deepseek-flash");
    const stages: string[] = [];
    const notes: string[] = [];
    const reportCalls: Array<{ modelChoice: string }> = [];
    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      // A run that ended politely and wrote no story.txt: the failure the
      // runner reports with its own sentence.
      newsWriterRun: async () => ({ ok: true, exitCode: 0, timedOut: false, durationMs: 5, lastText: "" }),
      reportAndDraft: async (input) => {
        reportCalls.push({ modelChoice: String(input.modelChoice) });
        return REPORTED;
      },
      setJobStage: async (_id, stage) => {
        stages.push(stage);
      },
      setJobFailoverNote: async (_id, note) => {
        notes.push(note);
      },
    });

    const sentence =
      "The research writer could not finish (The writer finished without a story). The story is being written the usual way, on the same model.";
    assert.deepEqual(reportCalls, [{ modelChoice: "deepseek-flash" }], "the same pick writes the fallback");
    assert.ok(stages.includes(sentence), `stage line: ${stages.join(" | ")}`);
    assert.ok(notes.includes(sentence), `failover note: ${notes.join(" | ")}`);
    const draft = await readDraft();
    assert.equal(draft.headline, "Standard writer headline");
    assert.deepEqual(draft.run_stats, {
      writer: "standard",
      researchWriterError: "The writer finished without a story.",
    });
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});

test("three source URLs are each saved, and one that cannot be fetched does not fail the draft", async () => {
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const { job, readDraft } = await fixture(88614, "deepseek-flash");
    const handed: Array<{ prompt: string; model: string }> = [];
    const captured: Array<{ url: string; text: string }> = [];
    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      newsWriterRun: storyWriter(handed),
      reportAndDraft: async () => {
        throw new Error("the four-pass writer must not run when the skill succeeds");
      },
      newsSourceCopy: {
        ingest: async (url) => {
          if (url === SOURCE_URLS[1]) throw new Error("The page refused the read.");
          return { url, title: "Saved page", text: "Page text", extras: [] };
        },
        capture: async (_userId, doc) => {
          captured.push({ url: doc.url, text: doc.text });
          return { version_id: 1, capture_event_id: 2 };
        },
      },
      setJobStage: async () => undefined,
      setJobFailoverNote: async () => undefined,
    });

    assert.equal(captured.length, 3, "one save per final source URL");
    assert.deepEqual(captured.map((row) => row.url), SOURCE_URLS);
    // The page that could not be read is still recorded, with no text, which is
    // how `capture` writes a fetch-failed row.
    assert.equal(captured[1]!.text, "");
    const draft = await readDraft();
    assert.equal(draft.headline, "Longmont approves the housing plan", "the draft is saved anyway");
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});

test("source copies are saved three at a time, not one at a time", async () => {
  const sixUrls = Array.from({ length: 6 }, (_, index) => `https://records.example.gov/page-${index + 1}`);
  const story = [
    "Longmont approves the housing plan",
    "",
    "The council voted 6-1 Tuesday for the plan.",
    "",
    "The City Council approved the housing plan on Tuesday night after a short debate, according to the ordinance and the agenda.",
    "",
    "CLAIMS AND SOURCES",
    "",
    ...sixUrls.map((url) => `Source (primary record): Page. ${url}`),
    "",
    "EDITOR FILE: NOT FOR PUBLICATION",
    "",
    "Check the tally.",
  ].join("\n");
  process.env.TOWNREPORTER_DEEPSEEK_BASE_URL = "http://127.0.0.1:9/v1";
  try {
    const { job } = await fixture(88619, "deepseek-flash");
    let running = 0;
    let peak = 0;
    const stages: string[] = [];
    await performDraftWork(job, {
      readStoryDocuments: async () => "",
      newsWriterRun: async (input) => {
        writeFileSync(join(input.workDir, "story.txt"), story, "utf8");
        writeFileSync(join(input.workDir, "CHECK-FIRST.txt"), "Check the tally.\n", "utf8");
        return { ok: true, exitCode: 0, timedOut: false, durationMs: 1, lastText: "RUN-DONE" };
      },
      reportAndDraft: async () => {
        throw new Error("the four-pass writer must not run when the skill succeeds");
      },
      newsSourceCopy: {
        // ENG-7: a slow read per URL is what makes overlap visible. One at a
        // time gives a peak of 1; the same work three at a time gives 3.
        ingest: async (url) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 30));
          running -= 1;
          return { url, title: "Saved page", text: "Page text", extras: [] };
        },
        capture: async () => ({ version_id: 1, capture_event_id: 2 }),
      },
      setJobStage: async (_id, stage) => {
        stages.push(stage);
      },
      setJobFailoverNote: async () => undefined,
    });

    assert.ok(peak > 1, `the copies were saved one at a time (highest at once: ${peak})`);
    assert.ok(peak <= 3, `more than three copies ran at once (highest at once: ${peak})`);
    // The stage line keeps the words it had: finished count of the total.
    assert.deepEqual(
      [...stages].sort(),
      sixUrls.map((_, index) => `Saving copies of the sources (${index + 1} of 6)`).sort(),
    );
  } finally {
    delete process.env.TOWNREPORTER_DEEPSEEK_BASE_URL;
  }
});

test("a saved source copy reads the page with no model OCR, never the four-pass writer's reader", async () => {
  const asked: Array<{ url: string; options?: IngestOptions }> = [];
  const reader = pickSourceCopyIngest(undefined, 88615, async (url, options) => {
    asked.push({ url, options });
    return { url, title: "", text: "", extras: [] };
  });
  await reader(SOURCE_URLS[0]!);

  // D234 fix 1: `allowModelOcr: false` is what keeps the copy mechanical. On a
  // batch the four-pass writer's reader carries an OCR switch callback that
  // moves the job's model choice, so a DeepSeek story's receipt would name a
  // model that did not write it -- and spend model calls to do it.
  assert.deepEqual(asked, [
    { url: SOURCE_URLS[0]!, options: { allowModelOcr: false, newsroomId: "88615" } },
  ]);

  // A test's own reader still wins, and the app's reader is then never reached.
  const injected = async (url: string) => ({ url, title: "", text: "", extras: [] });
  let appReads = 0;
  const picked = pickSourceCopyIngest({ ingest: injected }, 88615, async (url, options) => {
    void options;
    appReads += 1;
    return { url, title: "", text: "", extras: [] };
  });
  assert.equal(picked, injected);
  await picked(SOURCE_URLS[0]!);
  assert.equal(appReads, 0);
});

test("a writer folder that cannot be created is a returned failure, not a thrown one", async () => {
  /*
    A4 (Major): the folder step ran outside any try. A storage root pointing at
    a file made `mkdirSync` throw out of `runNewsSkillWriter`, past the desk's
    fallback -- which only answers a RETURNED failure -- and the draft died.
    The desk must be able to fall back, so the function reports it.
  */
  const { runNewsSkillWriter } = (await vite.ssrLoadModule(
    "/src/lib/news/news-skill-writer.server.ts",
  )) as typeof import("./news-skill-writer.server.ts");
  await ensureJobsSchema();
  const sql = await getSql();
  const room = 88617;
  await sql.query("insert into newsrooms(id,name) values($1,'Blocked folder room') on conflict(id) do nothing", [room]);
  // A storage root that is an existing FILE: every mkdir beneath it fails.
  const filePath = join(mkdtempSync(join(tmpdir(), "townreporter-blocked-root-")), "not-a-folder");
  writeFileSync(filePath, "x", "utf8");
  await sql.query(
    "insert into meeting_capture_settings(newsroom_id,storage_root) values($1,$2) on conflict(newsroom_id) do update set storage_root=excluded.storage_root",
    [room, filePath],
  );

  let ran = false;
  const result = await runNewsSkillWriter({
    sql,
    newsroomId: room,
    jobId: 424242,
    lead: {
      id: 1,
      headline: "A lead",
      why: null,
      topic: null,
      sourceUrls: "[]",
      evidence: null,
      notesJson: "{}",
    },
    model: "deepseek-v4.1-flash:1017-cloud",
    run: async () => {
      ran = true;
      return { ok: true, exitCode: 0, timedOut: false, durationMs: 1, lastText: "" };
    },
  });
  assert.equal(ran, false, "the agent never starts without a folder");
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /^The writer could not set up its folder: /);
});

test("an assignment file that cannot be written is a returned failure, not a thrown one", async () => {
  /*
    R2-ENG-1 (Minor): the folder was built inside a try, but the LEAD.md write
    sat outside it, so a failure there threw past the desk's fallback. The write
    is part of the folder setup now and returns the same sentence.
  */
  const { runNewsSkillWriter } = (await vite.ssrLoadModule(
    "/src/lib/news/news-skill-writer.server.ts",
  )) as typeof import("./news-skill-writer.server.ts");
  await ensureJobsSchema();
  const sql = await getSql();
  const room = 88618;
  const jobId = 424243;
  await sql.query("insert into newsrooms(id,name) values($1,'Blocked assignment room') on conflict(id) do nothing", [room]);
  const storageRoot = mkdtempSync(join(tmpdir(), "townreporter-blocked-assignment-"));
  await sql.query(
    "insert into meeting_capture_settings(newsroom_id,storage_root) values($1,$2) on conflict(newsroom_id) do update set storage_root=excluded.storage_root",
    [room, storageRoot],
  );
  // The folder builds fine, but a DIRECTORY sits where LEAD.md must go: writeFileSync throws EISDIR.
  const workDir = join(storageRoot, "news-runs", `newsroom-${room}`, `job-${jobId}`);
  mkdirSync(join(workDir, "LEAD.md"), { recursive: true });

  let ran = false;
  const result = await runNewsSkillWriter({
    sql,
    newsroomId: room,
    jobId,
    lead: {
      id: 1,
      headline: "A lead",
      why: null,
      topic: null,
      sourceUrls: "[]",
      evidence: null,
      notesJson: "{}",
    },
    model: "deepseek-v4.1-flash:1017-cloud",
    run: async () => {
      ran = true;
      return { ok: true, exitCode: 0, timedOut: false, durationMs: 1, lastText: "" };
    },
  });
  assert.equal(ran, false, "the agent never starts without its assignment file");
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /^The writer could not set up its folder: /);
});
