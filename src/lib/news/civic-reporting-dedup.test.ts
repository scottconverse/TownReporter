import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDbSource, getSql, withTransaction, type Sql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureReportingSchema } from "./civic-reporting.server.ts";
import { ensureJobsSchema } from "./jobs.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import type { EffectiveProviderChoice } from "./ai.ts";
import {
  findOpenMatchingReportingRequest,
  reportingModelPin,
  startReportingForAuthenticatedEditor,
  type AuthenticatedEditor,
  type ReportingSubmissionIdentity,
} from "./civic-reporting-commit.server.ts";

/*
  The editor's double press, AT THE REAL ENTRY PATH.

  WHAT IS PROVEN HERE, AND WHAT IS NOT.

  The bug this file guards was an ordering bug, not a predicate bug. Every press
  used to insert its `reporting_requests` row in one transaction and then queue
  the `desk_jobs` row in a SECOND one. The lookup that the second press ran
  joined `desk_jobs`, so a second caller could take the newsroom lock after the
  first request had committed but before its job had, find no job, and open a
  duplicate request and run.

  The tests below call `startReportingForAuthenticatedEditor` itself -- the real
  entry path, with the model probe injected, so there is no model, no network and
  no rate-limit unit spent -- and assert the ids and row counts of a real double
  press. They show that an identical press returns the FIRST press's request and
  job, and that a press whose pinned runtime differs is a distinct run.

  What this file does NOT show is two sessions running at once. PGlite is one
  connection and cannot hold two transactions open simultaneously, so the
  serialization claim ("the second concurrent caller blocks on the newsroom lock,
  then sees the first caller's job") needs two live Postgres sessions. That proof
  is the coordinator's gated two-session Postgres run, not this file.
*/
await applyMigrationsToTestPglite();

const NEWSROOM = 964_021;
const EDITOR: AuthenticatedEditor = { userId: "editor-first-dedup-test", newsroomId: NEWSROOM };

const SEED_ASSIGNMENT = "Report the Sept. 29 council meeting, votes accounted for separately.";
const SEED_URL = "https://example.gov/agenda";

let leadId: number;
type ProviderProbe = typeof import("./ai.ts").probeProvider;

before(async () => {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  await ensureJobsSchema();
  /* This newsroom is set up: the preflight gate must let the press through. */
  await sql`
    insert into paper_settings (newsroom_id, onboarded) values (${NEWSROOM}, true)
    on conflict (newsroom_id) do update set onboarded = true
  `;
  /*
    A lead-anchored press ("Report this meeting") re-reads the lead and refuses
    when it is missing or belongs to another newsroom, so the real entry path
    needs a real lead row in this newsroom.
  */
  const [lead] = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status)
    values (${EDITOR.userId}, ${NEWSROOM}, 'Sept. 29 council meeting', 'Votes and budget were decided.', 'council', 'new')
    returning id
  `;
  leadId = Number(lead.id);
  // Load the provider module in setup without invoking it.
  await import("./ai.ts");
});

/*
  The injectable probe `pinReportingModel` accepts. It never reaches a provider.
  A `readyProbe` answers "this runtime is ready" for one choice, optionally
  naming the exact local server and model a local run pinned.
*/
function readyProbe(choice: EffectiveProviderChoice, localModel?: { baseUrl: string; id: string }) {
  return async () => ({
    ok: true as const,
    label: choice,
    choice,
    ...(localModel ? { localModel } : {}),
  });
}

/** The submission identity `startReportingForAuthenticatedEditor` builds. */
function identity(over: Partial<ReportingSubmissionIdentity> = {}): ReportingSubmissionIdentity {
  return {
    userId: EDITOR.userId,
    newsroomId: NEWSROOM,
    requestKind: "meeting",
    leadId,
    parentRequestId: null,
    actionLabel: "Report this meeting",
    assignment: SEED_ASSIGNMENT,
    seedUrls: [SEED_URL],
    /*
      Built through the REAL serializer, not a hand-written object: the pin the
      lookup compares must be the exact string `initialModelRuntimeReceipt`
      stores on the request, or the test would be checking a schema that does
      not exist.
    */
    modelPin: reportingModelPin(
      initialModelRuntimeReceipt({
        requestedRuntime: "codex-balanced",
        requestedEffort: null,
        actualRuntime: "codex-balanced",
        actualEffort: "none",
        localModel: null,
      }),
    ),
    researchScope: "public",
    ...over,
  };
}

async function seedRun(
  id: ReportingSubmissionIdentity,
  status: "queued" | "running" | "finished",
  runStatus = "PENDING",
): Promise<number> {
  const sql = await getSql();
  /*
    The request's `model_receipt` is written the way production writes it --
    through `initialModelRuntimeReceipt` -- so the stored key/values match what
    the lookup and the runner will actually read.
  */
  const receipt = initialModelRuntimeReceipt({
    requestedRuntime: "codex-balanced",
    requestedEffort: null,
    actualRuntime: "codex-balanced",
    actualEffort: "none",
    localModel: null,
  });
  const [request] = await sql<{ id: number }>`
    insert into reporting_requests
      (user_id, newsroom_id, request_kind, lead_id, parent_request_id, action, assignment,
       seed_urls, model_choice, method_version, model_receipt, run_status)
    values
      (${id.userId}, ${id.newsroomId}, ${id.requestKind}, ${id.leadId}, ${id.parentRequestId},
       ${id.actionLabel}, ${id.assignment}, ${JSON.stringify(id.seedUrls)}::jsonb,
       ${"codex-balanced"}, ${"2.6.0"}, ${JSON.stringify(receipt)}::jsonb, ${runStatus})
    returning id
  `;
  await sql`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, lane, status, stage)
    values (${id.newsroomId}, ${id.userId}, ${"reporting"}, ${request.id}, ${"codex-balanced"}, ${"editor"},
            ${id.researchScope}, ${"default"}, ${status === "finished" ? "done" : status}, ${"Queued"})
  `;
  return Number(request.id);
}

/** One press of "Report this meeting" through the real entry path. */
async function press(
  over: Partial<Parameters<typeof startReportingForAuthenticatedEditor>[1]> = {},
  probeImpl: ProviderProbe = readyProbe("codex-balanced"),
) {
  return startReportingForAuthenticatedEditor(
    EDITOR,
    {
      action: "report-meeting",
      leadId,
      assignment: SEED_ASSIGNMENT,
      seedUrls: SEED_URL,
      modelChoice: "codex-balanced",
      modelEffort: null,
      researchScope: "public",
      ...over,
    },
    /* `kick: false`: no drain, so no fixture ever reaches a real model. */
    { probe: probeImpl, kick: false },
  );
}

describe("reporting submission dedup", () => {
  it("coalesces two identical presses of the real entry path into one request and one job", async () => {
    const sql = await getSql();
    const before = await sql<{ requests: number; jobs: number }>`
      select
        (select count(*)::int from reporting_requests where assignment = ${SEED_ASSIGNMENT}) as requests,
        (select count(*)::int from desk_jobs j join reporting_requests r on r.id = j.subject_id and j.kind = 'reporting'
           where r.assignment = ${SEED_ASSIGNMENT}) as jobs
    `;
    const first = await press();
    const second = await press();
    assert.ok(first.ok && second.ok);
    assert.equal(second.requestId, first.requestId, "the second press reuses the first request");
    assert.equal(second.jobId, first.jobId, "the second press reuses the first job");
    const after = await sql<{ requests: number; jobs: number }>`
      select
        (select count(*)::int from reporting_requests where assignment = ${SEED_ASSIGNMENT}) as requests,
        (select count(*)::int from desk_jobs j join reporting_requests r on r.id = j.subject_id and j.kind = 'reporting'
           where r.assignment = ${SEED_ASSIGNMENT}) as jobs
    `;
    assert.equal(after[0]!.requests - before[0]!.requests, 1, "exactly one request row was added");
    assert.equal(after[0]!.jobs - before[0]!.jobs, 1, "exactly one job row was added");
    /* The request insert and the job insert shared one commit: the job exists. */
    const [linked] = await sql<{ n: number }>`
      select count(*)::int as n from desk_jobs
      where kind = 'reporting' and subject_id = ${first.requestId}
    `;
    assert.equal(linked!.n, 1, "the request has exactly its one job, never a request without a job");
  });

  it("treats the same pinned local model at two efforts as two runs", async () => {
    /*
      The pin carries the resolved REASONING EFFORT, not just the choice name.
      Two otherwise-identical presses against the SAME local server and model,
      one at no reasoning and one at high, are two runs: the second is a
      deliberate re-run at a different depth. A local model is used so the
      fixture exercises an exact endpoint/model pin; its none and high effort
      values are both retained in the run identity.
    */
    const sql = await getSql();
    const local = { baseUrl: "http://127.0.0.1:1234/v1", id: "qwen2.5-7b-instruct" };
    const none = await press(
      { assignment: "Effort none.", modelChoice: "local-model", modelEffort: "none" },
      readyProbe("local-model", local),
    );
    const high = await press(
      { assignment: "Effort none.", modelChoice: "local-model", modelEffort: "high" },
      readyProbe("local-model", local),
    );
    assert.ok(none.ok && high.ok);
    const [noneRow] = await sql<{ model_receipt: { modelEffort?: string | null } }>`
      select model_receipt from reporting_requests where id = ${none.requestId}
    `;
    const [highRow] = await sql<{ model_receipt: { modelEffort?: string | null } }>`
      select model_receipt from reporting_requests where id = ${high.requestId}
    `;
    assert.equal(noneRow!.model_receipt.modelEffort, "none", "the first press pinned no reasoning");
    assert.equal(highRow!.model_receipt.modelEffort, "high", "the second press pinned high reasoning");
    assert.notEqual(high.requestId, none.requestId, "a different reasoning effort is a new run");
  });

  it("treats a different pinned local runtime as a different run even when model_choice is the same", async () => {
    const sql = await getSql();
    const local = { baseUrl: "http://127.0.0.1:1234/v1", id: "qwen2.5-7b-instruct" };
    const first = await press(
      { assignment: "Local pin.", modelChoice: "local-model" },
      readyProbe("local-model", local),
    );
    assert.ok(first.ok);
    /* Same model_choice, a different loaded model on the same server. */
    const second = await press(
      { assignment: "Local pin.", modelChoice: "local-model" },
      readyProbe("local-model", { baseUrl: local.baseUrl, id: "llama-3.1-8b" }),
    );
    assert.ok(second.ok);
    assert.notEqual(second.requestId, first.requestId, "a changed local model is a new run");
    /* The saved receipt still records the exact server/model the first run pinned. */
    const [row] = await sql<{ model_receipt: { localModel?: { id?: string } } }>`
      select model_receipt from reporting_requests where id = ${first.requestId}
    `;
    assert.equal(row?.model_receipt?.localModel?.id, local.id);
  });

  it("does not reuse a run that has already finished", async () => {
    const id = identity({ assignment: "A run that finished." });
    await seedRun(id, "finished", "COMPLETE");
    const sql = await getSql();
    const found = await findOpenMatchingReportingRequest(sql, id);
    assert.equal(found, null);
  });

  it("treats a different assignment, parent or seed set as a different run", async () => {
    const sql = await getSql();
    const id = identity({ assignment: "The original ask." });
    await seedRun(id, "running");
    assert.equal(await findOpenMatchingReportingRequest(sql, { ...id, assignment: "A follow-up ask." }), null);
    assert.equal(await findOpenMatchingReportingRequest(sql, { ...id, parentRequestId: 7 }), null);
    assert.equal(
      await findOpenMatchingReportingRequest(sql, { ...id, seedUrls: ["https://example.gov/minutes"] }),
      null,
    );
  });

  it("reads and writes inside the caller's transaction, so a request insert and its lookup commit together", async () => {
    await getSql();
    const id = identity({ assignment: "Committed only with its job." });
    const seen = await withTransaction(async (tx) => {
      const [created] = await tx<{ id: number }>`
        insert into reporting_requests
          (user_id, newsroom_id, request_kind, lead_id, parent_request_id, action, assignment,
           seed_urls, model_choice, method_version, model_receipt, run_status)
        values
          (${id.userId}, ${id.newsroomId}, ${id.requestKind}, ${id.leadId}, ${id.parentRequestId},
           ${id.actionLabel}, ${id.assignment}, ${JSON.stringify(id.seedUrls)}::jsonb,
           ${"codex-balanced"}, ${"2.6.0"}, ${JSON.stringify({
             actualRuntime: "codex-balanced", modelEffort: "none", localModel: null,
           })}::jsonb, ${"PENDING"})
        returning id
      `;
      await tx`
        insert into desk_jobs (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source, research_scope, lane, status, stage)
        values (${id.newsroomId}, ${id.userId}, ${"reporting"}, ${created.id}, ${"codex-balanced"}, ${"editor"}, ${"public"}, ${"default"}, ${"queued"}, ${"Queued"})
      `;
      /* Inside the transaction the request and its job are both visible. */
      return findOpenMatchingReportingRequest(tx as unknown as Sql, id);
    });
    assert.ok(seen, "the lookup must find the request and job its own transaction just wrote");
  });
});

/*
  The two-session concurrency proof belongs to the coordinator's gated Postgres
  run, not here: PGlite is one connection and cannot hold two transactions at
  once. This test only records whether such a run is even reachable on THIS
  machine, so the gap is visible rather than assumed.
*/
describe("reporting submission concurrency (deferred)", () => {
  it("records whether a real Postgres integration lane is opted in", () => {
    const optedIn = Boolean(process.env.TEST_POSTGRES_ADMIN_URL?.trim());
    if (getDbSource() !== "neon") {
      assert.equal(Boolean(process.env.DATABASE_URL?.trim()), false, "the offline backend must not have an app Postgres URL configured");
      return;
    }
    assert.equal(optedIn, true, "the neon lane requires TEST_POSTGRES_ADMIN_URL");
  });
});

after(async () => {
  const sql = await getSql();
  await sql`delete from desk_jobs where newsroom_id = ${NEWSROOM}`;
  await sql`delete from reporting_requests where newsroom_id = ${NEWSROOM}`;
  await sql`delete from leads where newsroom_id = ${NEWSROOM}`;
});
