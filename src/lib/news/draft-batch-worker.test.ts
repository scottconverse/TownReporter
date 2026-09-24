import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";
import { singleRenderedPdfFixture } from "./pdf-test-fixture.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let setFetchImplForTests: typeof import("./fetch-url.ts").setFetchImplForTests;
let ensureStoryDocuments: typeof import("./story-documents.server.ts").ensureStoryDocuments;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ setFetchImplForTests } = await vite.ssrLoadModule("/src/lib/news/fetch-url.ts"));
  ({ ensureStoryDocuments } = await vite.ssrLoadModule("/src/lib/news/story-documents.server.ts"));
});
after(async () => vite.close());

const reported = {
  headline: "Batch draft",
  dek: "A bounded batch draft.",
  body: "The council met Tuesday.",
  topic: "council",
  source_urls: [],
  integrity_notes: "",
  memory_entities: [],
  form: "news",
  provenance: [],
  found_note: "[]",
  findings: [],
  unanswered: [],
  claims: [],
  research_memo: {},
} as unknown as ReportedDraftResult;

async function fixture(newsroomId: number) {
  const sql = await getSql();
  const userId = "batch-worker-" + newsroomId;
  await sql.query(
    "insert into newsrooms(id,name) values($1,'Batch worker test') on conflict(id) do nothing",
    [newsroomId],
  );
  await sql.query("delete from audit_events where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from desk_jobs where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from draft_batches where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from leads where newsroom_id=$1", [newsroomId]);
  await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
    userId,
    newsroomId,
  ]);
  const [lead] = await sql.query<{ id: number }>(
    "insert into leads(user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness,notes_json) values($1,$2,'Batch lead','Why','council','new','[]','',1,'{}') returning id",
    [userId, newsroomId],
  );
  const snapshot = {
    runtime: "claude-sonnet",
    modelChoice: "claude-sonnet",
    transport: "claude-code",
    model: "selected-claude",
  };
  const [batch] = await sql.query<{ id: number }>(
    "insert into draft_batches(newsroom_id,user_id,runtime_snapshot) values($1,$2,$3::jsonb) returning id",
    [newsroomId, userId, JSON.stringify(snapshot)],
  );
  const [row] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token,draft_batch_id) values($1,$2,'draft',$3,'claude-sonnet','editor','public','default','running','Drafting','batch-claim',$4) returning id",
    [userId, newsroomId, lead.id, batch.id],
  );
  const job = {
    id: row.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "claude-sonnet",
    model_choice_source: "editor",
    research_scope: "public",
    draft_batch_id: batch.id,
    lane: "default",
    status: "running",
    stage: "Drafting",
    failover_note: "",
    error: null,
    created_at: "",
    updated_at: "",
    started_at: null,
    finished_at: null,
    claim_token: "batch-claim",
  } as DeskJob;
  return { sql, userId, job };
}

it("actual draft worker uses only the persisted forced transport", async () => {
  const { sql, userId, job } = await fixture(99201);
  await sql.query("update desk_jobs set result_json=$1 where id=$2", [
    JSON.stringify({ requestId: "retained" }),
    job.id,
  ]);
  const calls: string[] = [];
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "must-not-be-used";
  setFetchImplForTests(
    async () => new Response(Buffer.from(singleRenderedPdfFixture()), { headers: { "content-type": "application/pdf" } }),
  );
  try {
    await performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        const document = await deps!.ingest?.("https://93.184.216.34/scan.pdf");
        assert.match(document?.text ?? "", /OCR passage/);
        const capture = await deps!.capture?.(userId, document!);
        assert.ok(capture?.version_id);
        assert.ok(capture?.capture_event_id);
        const answer = await deps!.chat?.("system", "user", 100, "codex-frontier", { timeoutMs: 12_345 });
        assert.equal(answer?.ok, true);
        return {
          ...reported,
          integrity_notes:
            "Evidence reconciliation not completed within the available edit pass. Draft retained.",
        };
      },
      batchChatAdapters: {
        claude: async (input) => {
          assert.equal(input.noTools, true);
          assert.equal(input.timeoutMs, 12_345);
          calls.push("claude:" + input.model);
          return { ok: true, text: "answer" };
        },
        codex: async () => {
          calls.push("codex");
          return { ok: true, text: "wrong" };
        },
        local: async () => {
          calls.push("local");
          return { ok: true, text: "wrong" };
        },
      },
      batchOcrAdapters: {
        anthropic: async () => {
          calls.push("anthropic-ocr");
          return "wrong";
        },
        "claude-code": async () => {
          calls.push("claude-ocr");
          return "OCR passage retained from the selected subscription CLI transport.";
        },
      },
      probe: async () => {
        throw new Error("forced jobs never probe");
      },
      setJobStage: async () => undefined,
    });
  } finally {
    setFetchImplForTests(null);
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
  assert.deepEqual(calls, ["claude-ocr", "claude:selected-claude"]);
  const [persisted] = await sql.query<{ status: string; drafts: number; result_json: string; draft_id: number }>(
    "select j.status,j.result_json,(select count(*)::int from drafts d where d.lead_id=j.subject_id) drafts,(select id from drafts d where d.lead_id=j.subject_id order by id desc limit 1) draft_id from desk_jobs j where j.id=$1",
    [job.id],
  );
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.drafts, 1);
  const completion = JSON.parse(persisted.result_json);
  assert.equal(completion.requestId, "retained");
  assert.equal(completion.version, 2);
  assert.equal(completion.draftId, persisted.draft_id);
  assert.equal(completion.finalDraftId, persisted.draft_id);
  assert.equal(completion.quality.evidenceCheckIncomplete, true);
  assert.equal(completion.quality.reviewRequired, true);
  const [captureScope] = await sql.query<{ owned: number; default_room: number }>(
    "select count(*) filter (where newsroom_id=$1)::int owned,count(*) filter (where newsroom_id=1)::int default_room from capture_events where source_url=$2",
    [job.newsroom_id, "https://93.184.216.34/scan.pdf"],
  );
  assert.deepEqual(captureScope, { owned: 1, default_room: 0 });
});

it("actual Story worker keeps the preflighted local model after the saved preference changes", async () => {
  const { sql, job } = await fixture(99208);
  const selected = { baseUrl: "https://ollama-at-enqueue.example/v1", id: "qwen3.5:397b-cloud" };
  const changed = { baseUrl: "http://127.0.0.1:1234/v1", id: "lm-studio-after-queue" };
  await sql.query("update desk_jobs set draft_batch_id=null,model_choice='local-model',result_json=$1 where id=$2", [
    JSON.stringify({ requestedRuntime: "local-model", actualRuntime: "local-model", localModelSnapshotVersion: 1, localModel: selected }),
    job.id,
  ]);
  job.draft_batch_id = null;
  job.model_choice = "local-model";
  job.result_json = JSON.stringify({ requestedRuntime: "local-model", actualRuntime: "local-model", localModelSnapshotVersion: 1, localModel: selected });
  await sql.query(`create table if not exists newsroom_local_model_choices (
    newsroom_id integer not null, scope text not null, base_url text not null, model_id text not null,
    updated_at timestamptz not null default now(), primary key(newsroom_id,scope)
  )`);
  await sql.query("insert into newsroom_local_model_choices(newsroom_id,scope,base_url,model_id) values($1,'story',$2,$3) on conflict(newsroom_id,scope) do update set base_url=excluded.base_url,model_id=excluded.model_id", [job.newsroom_id, changed.baseUrl, changed.id]);
  const used: Array<{ baseUrl: string | undefined; id: string | undefined }> = [];
  let documentProbeModel: unknown;
  try {
    await performDraftWork(job, {
      readStoryDocuments: async (_room, _lead, _choice, _assignment, _stage, _urls, _user, _suppliedOnly, _requestId, routing) => {
        assert.deepEqual(routing?.localModel, selected, "uploaded-document reading must keep the queued model");
        const result = await routing?.probe?.("local-model");
        assert.equal(result?.ok, true);
        return "";
      },
      probe: async (choice, _room, _adapters, scope, exactLocalModel) => {
        assert.equal(choice, "local-model");
        assert.equal(scope, "story");
        documentProbeModel = exactLocalModel;
        return { ok: true as const, label: "Local model", choice: "local-model", localModel: exactLocalModel };
      },
      reportAndDraft: async (input, deps) => {
        assert.deepEqual(input.providerOverrides?.["local-model"]?.localModel, selected,
          "the queued snapshot must override the changed current preference before draft setup");
        const answer = await deps!.chat?.("system", "user", 100, "local-model");
        assert.equal(answer?.ok, true);
        return reported;
      },
      chat: async (_system, _user, _tokens, options) => {
        used.push({ baseUrl: options?.localModel?.baseUrl, id: options?.localModel?.id });
        return { ok: true, text: "drafted with the queued model" };
      },
      setJobStage: async () => undefined,
    });
    assert.deepEqual(used, [selected], "the actual provider call must use the queued endpoint and model");
    assert.deepEqual(documentProbeModel, selected, "the document-stage readiness check must verify the queued endpoint/model");
  } finally {
    await sql.query("delete from newsroom_local_model_choices where newsroom_id=$1 and scope='story'", [job.newsroom_id]);
  }
});

it("forced Story batch reads uploaded documents and writes with its pinned local model after the preference changes", async () => {
  const { sql, userId, job } = await fixture(99209);
  await ensureStoryDocuments(sql);
  const selected = { baseUrl: "http://127.0.0.1:11434/v1", id: "qwen3.5:397b-cloud" };
  const changed = { baseUrl: "http://127.0.0.1:1234/v1", id: "lm-studio-after-queue" };
  const batchSnapshot = {
    runtime: "local",
    modelChoice: "local-model",
    transport: "local",
    localModel: selected,
    modelEffort: "none",
  };
  await sql.query("update draft_batches set runtime_snapshot=$1::jsonb where id=$2", [
    JSON.stringify(batchSnapshot),
    job.draft_batch_id,
  ]);
  await sql.query("update desk_jobs set model_choice='local-model',result_json='{}' where id=$1", [job.id]);
  job.model_choice = "local-model";
  job.result_json = "{}";
  await sql.query(`create table if not exists newsroom_local_model_choices (
    newsroom_id integer not null, scope text not null, base_url text not null, model_id text not null,
    updated_at timestamptz not null default now(), primary key(newsroom_id,scope)
  )`);
  const [previousPreference] = await sql.query<{ base_url: string; model_id: string }>(
    "select base_url,model_id from newsroom_local_model_choices where newsroom_id=$1 and scope='story'",
    [job.newsroom_id],
  );
  const documentId = `batch-local-document-${job.newsroom_id}`;
  await sql.query(
    "insert into story_documents(id,newsroom_id,user_id,lead_id,filename,mime,original) values($1,$2,$3,$4,'packet.txt','text/plain',$5)",
    [documentId, job.newsroom_id, userId, job.subject_id, Buffer.from("The packet records the selected local-model snapshot." )],
  );
  await sql.query(
    "insert into newsroom_local_model_choices(newsroom_id,scope,base_url,model_id) values($1,'story',$2,$3) on conflict(newsroom_id,scope) do update set base_url=excluded.base_url,model_id=excluded.model_id",
    [job.newsroom_id, changed.baseUrl, changed.id],
  );

  const documentCalls: Array<{ baseUrl?: string; id?: string }> = [];
  const writerCalls: Array<{ baseUrl?: string; id?: string }> = [];
  const preflightCalls: Array<{ baseUrl: string; id: string } | undefined> = [];
  try {
    await performDraftWork(job, {
      probe: async (choice, newsroomId, _adapters, scope, exactLocalModel) => {
        assert.equal(choice, "local-model");
        assert.equal(newsroomId, job.newsroom_id);
        assert.equal(scope, "story");
        preflightCalls.push(exactLocalModel);
        return { ok: true as const, label: "Local model", choice: "local-model", localModel: exactLocalModel };
      },
      chat: async (_system, _user, _tokens, options) => {
        assert.ok(options?.localModel, "document reader must receive its resolved local model");
        documentCalls.push(options.localModel);
        return { ok: true as const, text: "The uploaded packet was read by the queued model." };
      },
      reportAndDraft: async (input, deps) => {
        assert.ok(input.documentEvidence, "the uploaded packet must be read before writing");
        assert.match(input.documentEvidence, /uploaded packet was read by the queued model/i);
        assert.deepEqual(input.providerOverrides?.["local-model"]?.localModel, selected,
          "the forced writer's budgets must also use the batch endpoint, not the changed Story preference");
        const answer = await deps!.chat?.("system", "user", 100, "local-model");
        assert.equal(answer?.ok, true);
        return reported;
      },
      batchChatAdapters: {
        local: async (_system, _user, _tokens, options) => {
          assert.ok(options?.localModel, "batch writer must receive its resolved local model");
          writerCalls.push(options.localModel);
          return { ok: true as const, text: "The story was written by the queued model." };
        },
      },
      setJobStage: async () => undefined,
    });
    assert.deepEqual(preflightCalls, [selected], "document preflight must verify the batch's saved endpoint/model");
    assert.deepEqual(documentCalls, [selected], "document reading must call the batch's saved endpoint/model");
    assert.deepEqual(writerCalls, [selected], "the writer and document reader must use the same batch endpoint/model");
  } finally {
    await sql.query("delete from story_documents where id=$1 and newsroom_id=$2", [documentId, job.newsroom_id]);
    if (previousPreference) {
      await sql.query(
        "update newsroom_local_model_choices set base_url=$2,model_id=$3 where newsroom_id=$1 and scope='story'",
        [job.newsroom_id, previousPreference.base_url, previousPreference.model_id],
      );
    } else {
      await sql.query("delete from newsroom_local_model_choices where newsroom_id=$1 and scope='story'", [job.newsroom_id]);
    }
  }
});

it("withdrawn membership immediately before capture leaves no persisted capture", async () => {
  const { sql, userId, job } = await fixture(99205);
  await assert.rejects(
    performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        await sql.query("delete from newsroom_members where newsroom_id=$1 and user_id=$2", [
          job.newsroom_id,
          userId,
        ]);
        await deps!.capture?.(userId, {
          url: "https://example.com/withdrawn-capture",
          title: "Withdrawn",
          text: "This captured passage is long enough to be useful to a draft.",
          extras: [],
        });
        return reported;
      },
      setJobStage: async () => undefined,
    }),
    /permission or job lease was withdrawn/,
  );
  const [counts] = await sql.query<{ versions: number; captures: number }>(
    "select (select count(*)::int from artifact_versions where url=$1) versions,(select count(*)::int from capture_events where source_url=$1) captures",
    ["https://example.com/withdrawn-capture"],
  );
  assert.deepEqual(counts, { versions: 0, captures: 0 });
});

for (const selected of ["codex-terra", "codex-sol", "local"] as const) {
  it("actual draft worker pins " + selected + " across restart dispatch", async () => {
    const newsroomId =
      selected === "codex-terra" ? 99205 : selected === "codex-sol" ? 99206 : 99207;
    const { sql, job } = await fixture(newsroomId);
    const snapshot =
      selected === "local"
        ? {
            runtime: "local",
            modelChoice: "local-model",
            transport: "local",
            localModel: { baseUrl: "http://127.0.0.1:1234", id: "selected-local" },
          }
        : {
            runtime: selected,
            modelChoice: selected === "codex-terra" ? "codex-balanced" : "codex-frontier",
            transport: "codex",
            model: "selected-" + selected,
          };
    await sql.query("update draft_batches set runtime_snapshot=$1::jsonb where id=$2", [
      JSON.stringify(snapshot),
      job.draft_batch_id,
    ]);
    await sql.query("update desk_jobs set model_choice=$1 where id=$2", [
      snapshot.modelChoice,
      job.id,
    ]);
    job.model_choice = snapshot.modelChoice;
    const calls: string[] = [];
    await performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        const answer = await deps!.chat?.("system", "user", 100);
        assert.equal(answer?.ok, true);
        return reported;
      },
      batchChatAdapters: {
        claude: async () => {
          calls.push("claude");
          return { ok: true, text: "wrong" };
        },
        codex: async (input) => {
          calls.push("codex:" + input.model);
          return { ok: true, text: "answer" };
        },
        local: async (_system, _user, _tokens, options) => {
          calls.push("local:" + options!.localModel?.id);
          return { ok: true, text: "answer" };
        },
      },
      setJobStage: async () => undefined,
    });
    assert.deepEqual(
      calls,
      selected === "local" ? ["local:selected-local"] : ["codex:selected-" + selected],
    );
  });
}

for (const boundary of ["membership", "lease"] as const) {
  it("does no model call after " + boundary + " is withdrawn", async () => {
    const { sql, userId, job } = await fixture(boundary === "membership" ? 99202 : 99203);
    let calls = 0;
    await assert.rejects(
      performDraftWork(job, {
        reportAndDraft: async (_input, deps) => {
          if (boundary === "membership") {
            await sql.query("delete from newsroom_members where newsroom_id=$1 and user_id=$2", [
              job.newsroom_id,
              userId,
            ]);
          } else {
            await sql.query("update desk_jobs set claim_token='replacement' where id=$1", [job.id]);
          }
          await deps!.chat?.("system", "user", 100);
          return reported;
        },
        batchChatAdapters: {
          claude: async () => {
            calls += 1;
            return { ok: true, text: "must not run" };
          },
          codex: async () => {
            calls += 1;
            return { ok: true, text: "must not run" };
          },
          local: async () => {
            calls += 1;
            return { ok: true, text: "must not run" };
          },
        },
        setJobStage: async () => undefined,
      }),
      /withdrawn|lease/i,
    );
    assert.equal(calls, 0);
  });
}

it("fails over only after a technical selected-transport failure", async () => {
  const { sql, job } = await fixture(99204);
  const calls: string[] = [];
  await performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        const answer = await deps!.chat?.("system", "user", 100);
        return answer?.ok ? reported : { error: answer?.error ?? "failed" };
      },
      batchChatAdapters: {
        claude: async () => {
          calls.push("claude");
          return { ok: false, error: "429 subscription quota" };
        },
        codex: async () => {
          calls.push("codex");
          return { ok: true, text: "fallback answer" };
        },
        local: async () => {
          calls.push("local");
          return { ok: true, text: "must not run" };
        },
      },
      probe: async (choice) =>
        choice === "codex-balanced"
          ? { ok: true as const, label: "Codex Terra", choice: "codex-balanced" as const }
          : { ok: false as const, error: `${choice} unavailable` },
      validateBatchRuntime: async (_room, choice) => ({
        runtime: "codex-terra" as const,
        modelChoice: choice,
        transport: "codex" as const,
        model: "selected-terra",
        modelEffort: "medium" as const,
      }) as any,
      setJobStage: async () => undefined,
    });
  assert.deepEqual(calls, ["claude", "codex"]);
  const [batch] = await sql.query<{ runtime_snapshot: { modelChoice: string } }>(
    "select runtime_snapshot from draft_batches where id=$1",
    [job.draft_batch_id],
  );
  assert.equal(batch.runtime_snapshot.modelChoice, "codex-balanced");
});

it("a corrupt persisted runtime fails closed before report work", async () => {
  const { sql, job } = await fixture(99208);
  await sql.query("update draft_batches set runtime_snapshot='{}'::jsonb where id=$1", [
    job.draft_batch_id,
  ]);
  let reportCalls = 0;
  await assert.rejects(
    performDraftWork(job, {
      reportAndDraft: async () => {
        reportCalls += 1;
        return reported;
      },
      setJobStage: async () => undefined,
    }),
    /runtime snapshot is invalid/,
  );
  assert.equal(reportCalls, 0);
});
