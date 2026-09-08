import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import type { DeskJob } from "./jobs.ts";
import type { ReportedDraftResult } from "./desk-model-run.ts";

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let performDraftWork: typeof import("./desk.ts").performDraftWork;
let setFetchImplForTests: typeof import("./fetch-url.ts").setFetchImplForTests;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ performDraftWork } = await vite.ssrLoadModule("/src/lib/news/desk.ts"));
  ({ setFetchImplForTests } = await vite.ssrLoadModule("/src/lib/news/fetch-url.ts"));
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
} as ReportedDraftResult;

function scannedPdf(): Uint8Array {
  const jpeg = new Uint8Array(5000);
  jpeg.set([0xff, 0xd8, 0xff], 0);
  jpeg.set([0xff, 0xd9], jpeg.length - 2);
  const pdf = new Uint8Array(jpeg.length + 30);
  pdf.set(Buffer.from("%PDF-1.4 scanned "), 0);
  pdf.set(jpeg, 20);
  return pdf;
}

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
    runtime: "claude-cli",
    modelChoice: "claude-frontier",
    transport: "claude-code",
    model: "selected-claude",
  };
  const [batch] = await sql.query<{ id: number }>(
    "insert into draft_batches(newsroom_id,user_id,runtime_snapshot) values($1,$2,$3::jsonb) returning id",
    [newsroomId, userId, JSON.stringify(snapshot)],
  );
  const [row] = await sql.query<{ id: number }>(
    "insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage,claim_token,draft_batch_id) values($1,$2,'draft',$3,'claude-frontier','editor','public','default','running','Drafting','batch-claim',$4) returning id",
    [userId, newsroomId, lead.id, batch.id],
  );
  const job = {
    id: row.id,
    newsroom_id: newsroomId,
    user_id: userId,
    kind: "draft",
    subject_id: lead.id,
    model_choice: "claude-frontier",
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
  const calls: string[] = [];
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "must-not-be-used";
  setFetchImplForTests(
    async () => new Response(scannedPdf(), { headers: { "content-type": "application/pdf" } }),
  );
  try {
    await performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        const document = await deps.ingest?.("https://93.184.216.34/scan.pdf");
        assert.match(document?.text ?? "", /OCR passage/);
        const capture = await deps.capture?.(userId, document!);
        assert.ok(capture?.version_id);
        assert.ok(capture?.capture_event_id);
        const answer = await deps.chat?.("system", "user", 100, "codex-frontier");
        assert.equal(answer?.ok, true);
        return reported;
      },
      batchChatAdapters: {
        claude: async (input) => {
          assert.equal(input.noTools, true);
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
  const [persisted] = await sql.query<{ status: string; drafts: number }>(
    "select j.status,(select count(*)::int from drafts d where d.lead_id=j.subject_id) drafts from desk_jobs j where j.id=$1",
    [job.id],
  );
  assert.deepEqual(persisted, { status: "completed", drafts: 1 });
  const [captureScope] = await sql.query<{ owned: number; default_room: number }>(
    "select count(*) filter (where newsroom_id=$1)::int owned,count(*) filter (where newsroom_id=1)::int default_room from capture_events where source_url=$2",
    [job.newsroom_id, "https://93.184.216.34/scan.pdf"],
  );
  assert.deepEqual(captureScope, { owned: 1, default_room: 0 });
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
        await deps.capture?.(userId, {
          url: "https://example.com/withdrawn-capture",
          title: "Withdrawn",
          text: "This captured passage is long enough to be useful to a draft.",
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
        const answer = await deps.chat?.("system", "user", 100);
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
          calls.push("local:" + options.localModel?.id);
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
          await deps.chat?.("system", "user", 100);
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

it("does not fail over when the selected subscription transport fails", async () => {
  const { job } = await fixture(99204);
  let calls = 0;
  await assert.rejects(
    performDraftWork(job, {
      reportAndDraft: async (_input, deps) => {
        const answer = await deps.chat?.("system", "user", 100);
        return answer?.ok ? reported : { error: answer?.error ?? "failed" };
      },
      batchChatAdapters: {
        claude: async () => {
          calls += 1;
          return { ok: false, error: "429 subscription quota" };
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
      probe: async () => {
        throw new Error("must not probe");
      },
      setJobStage: async () => undefined,
    }),
    /429 subscription quota/,
  );
  assert.equal(calls, 1);
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
