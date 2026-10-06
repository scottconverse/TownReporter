import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import type { LocalModelOverride } from "./ai.ts";
import { ensureReportingSchema } from "./civic-reporting.server.ts";
import {
  answerReportingFollowUp,
  type AuthenticatedEditor,
} from "./civic-reporting-commit.server.ts";
import { ensureJobsSchema } from "./jobs.ts";

await applyMigrationsToTestPglite();

const NEWSROOM = 1_800_000_000 + Math.floor(Math.random() * 100_000_000);
const EDITOR: AuthenticatedEditor = { userId: `follow-up-pin-${randomUUID()}`, newsroomId: NEWSROOM };
const ORIGINAL_SEEDS = ["https://example.gov/original-packet.pdf", "https://example.gov/minutes"];
const ORIGINAL_LOCAL: LocalModelOverride = {
  baseUrl: "http://127.0.0.1:11434/v1",
  id: "deepseek-v4.1-flash:cloud",
};
const CURRENT_PICKER_MODEL: LocalModelOverride = {
  baseUrl: "http://127.0.0.1:1234/v1",
  id: "a-different-current-model",
};

before(async () => {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  await ensureJobsSchema();
  await sql`
    insert into paper_settings (newsroom_id, onboarded) values (${NEWSROOM}, true)
    on conflict (newsroom_id) do update set onboarded = true
  `;
});

async function seedParent(input: {
  modelChoice: string;
  receipt: unknown;
  researchScope: "public" | "supplied";
  seedUrls?: string[];
  resultJson?: string;
}): Promise<number> {
  const sql = await getSql();
  const [request] = await sql<{ id: number }>`
    insert into reporting_requests
      (user_id, newsroom_id, request_kind, lead_id, parent_request_id, action, assignment,
       seed_urls, model_choice, method_version, model_receipt, run_status)
    values
      (${EDITOR.userId}, ${NEWSROOM}, ${"assignment"}, ${null}, ${null}, ${"Report an issue"},
       ${"Original reporting assignment"}, ${JSON.stringify(input.seedUrls ?? ORIGINAL_SEEDS)}::jsonb,
       ${input.modelChoice}, ${"2.6.0"}, ${JSON.stringify(input.receipt)}::jsonb, ${"COMPLETE"})
    returning id
  `;
  const requestId = Number(request!.id);
  await sql`
    insert into desk_jobs
      (newsroom_id, user_id, kind, subject_id, model_choice, model_choice_source,
       research_scope, lane, status, stage, result_json)
    values
      (${NEWSROOM}, ${EDITOR.userId}, ${"reporting"}, ${requestId}, ${input.modelChoice}, ${"editor"},
       ${input.researchScope}, ${"default"}, ${"done"}, ${"Done"}, ${input.resultJson ?? "{}"})
  `;
  return requestId;
}

function changedPickerProbe() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    probe: async () => {
      calls += 1;
      return {
        ok: true as const,
        label: "Changed current picker selection",
        choice: "local-model" as const,
        localModel: CURRENT_PICKER_MODEL,
      };
    },
  };
}

function parsed<T = unknown>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

describe("civic reporting follow-up model inheritance", () => {
  it("continues the finished legacy pin, seeds and job scope without probing the changed picker", async () => {
    const sql = await getSql();
    const parentReceipt = {
      requested: "local-model",
      effective: "local-model",
      label: "LLM",
      effort: "none",
      localModel: ORIGINAL_LOCAL,
    };
    const parentId = await seedParent({
      modelChoice: "local-model",
      receipt: parentReceipt,
      researchScope: "public",
    });
    const picker = changedPickerProbe();
    const followUpInput = {
      parentRequestId: parentId,
      assignment: "Check the original packet's cost line",
      seedUrls: "   ",
      modelEffort: null,
    };

    const result = await answerReportingFollowUp(
      EDITOR,
      followUpInput,
      { probe: picker.probe, kick: false },
    );

    assert.ok(result.ok, result.ok ? undefined : result.error);
    assert.notEqual(result.requestId, parentId);
    assert.equal(picker.calls, 0, "an omitted choice must not probe the currently selected local model");

    const repeated = await answerReportingFollowUp(
      EDITOR,
      followUpInput,
      { probe: picker.probe, kick: false },
    );
    assert.ok(repeated.ok, repeated.ok ? undefined : repeated.error);
    assert.equal(repeated.requestId, result.requestId, "an identical open follow-up reuses its request");
    assert.equal(repeated.jobId, result.jobId, "an identical open follow-up reuses its job");
    assert.equal(picker.calls, 0);
    const [dedupCounts] = await sql<{ requests: number; jobs: number }>`
      select
        (select count(*)::int from reporting_requests
         where newsroom_id = ${NEWSROOM} and parent_request_id = ${parentId}) as requests,
        (select count(*)::int from desk_jobs j
         join reporting_requests r on r.id = j.subject_id and r.newsroom_id = j.newsroom_id
         where r.newsroom_id = ${NEWSROOM} and r.parent_request_id = ${parentId} and j.kind = 'reporting') as jobs
    `;
    assert.deepEqual(dedupCounts, { requests: 1, jobs: 1 });

    const [request] = await sql<{
      parent_request_id: number | null;
      model_choice: string;
      model_receipt: unknown;
      seed_urls: unknown;
    }>`
      select parent_request_id, model_choice, model_receipt, seed_urls
      from reporting_requests where id = ${result.requestId} and newsroom_id = ${NEWSROOM}
    `;
    assert.equal(Number(request!.parent_request_id), parentId);
    assert.equal(request!.model_choice, "local-model");
    assert.deepEqual(parsed(request!.seed_urls), ORIGINAL_SEEDS);
    const receipt = parsed<Record<string, unknown>>(request!.model_receipt);
    assert.equal(receipt.actualRuntime, "local-model");
    assert.equal(receipt.modelEffort, "none");
    assert.deepEqual(receipt.localModel, ORIGINAL_LOCAL);

    const [job] = await sql<{ research_scope: string; result_json: unknown }>`
      select research_scope, result_json from desk_jobs
      where newsroom_id = ${NEWSROOM} and kind = 'reporting' and subject_id = ${result.requestId}
      order by id desc limit 1
    `;
    assert.equal(job!.research_scope, "public");
    assert.deepEqual(parsed<Record<string, unknown>>(job!.result_json).localModel, ORIGINAL_LOCAL);
  });

  it("inherits canonical initial receipts and the parent's supplied scope", async () => {
    const sql = await getSql();
    const canonicalLocal: LocalModelOverride = {
      baseUrl: "http://127.0.0.1:11435/v1",
      id: "qwen3.8-proof",
    };
    const parentReceipt = initialModelRuntimeReceipt({
      requestedRuntime: "local-model",
      requestedEffort: "high",
      actualRuntime: "local-model",
      actualEffort: "high",
      localModel: canonicalLocal,
    });
    const parentId = await seedParent({
      modelChoice: "local-model",
      receipt: parentReceipt,
      researchScope: "supplied",
      resultJson: JSON.stringify({ requestId: 1001 }),
    });
    const picker = changedPickerProbe();

    const result = await answerReportingFollowUp(
      EDITOR,
      { parentRequestId: parentId, assignment: "Verify the supplied document's amount" },
      { probe: picker.probe, kick: false },
    );

    assert.ok(result.ok, result.ok ? undefined : result.error);
    assert.equal(picker.calls, 0);
    const [request] = await sql<{ model_receipt: unknown }>`
      select model_receipt from reporting_requests
      where id = ${result.requestId} and newsroom_id = ${NEWSROOM}
    `;
    const receipt = parsed<Record<string, unknown>>(request!.model_receipt);
    assert.equal(receipt.actualRuntime, "local-model");
    assert.equal(receipt.modelEffort, "high");
    assert.deepEqual(receipt.localModel, canonicalLocal);
    const [job] = await sql<{ research_scope: string }>`
      select research_scope from desk_jobs
      where newsroom_id = ${NEWSROOM} and kind = 'reporting' and subject_id = ${result.requestId}
      order by id desc limit 1
    `;
    assert.equal(job!.research_scope, "supplied");
  });

  it("refuses an ambiguous local parent pin instead of falling back to Automatic", async () => {
    const sql = await getSql();
    const parentId = await seedParent({
      modelChoice: "local-model",
      receipt: { requested: "local-model", effective: "local-model", effort: "none" },
      researchScope: "public",
    });
    const before = await sql<{ requests: number; jobs: number }>`
      select
        (select count(*)::int from reporting_requests where parent_request_id = ${parentId}) as requests,
        (select count(*)::int from desk_jobs where kind = 'reporting' and subject_id in
          (select id from reporting_requests where parent_request_id = ${parentId})) as jobs
    `;
    const picker = changedPickerProbe();

    const result = await answerReportingFollowUp(
      EDITOR,
      { parentRequestId: parentId, assignment: "Continue incomplete parent pin" },
      { probe: picker.probe, kick: false },
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /saved model pin is incomplete/i);
    assert.equal(picker.calls, 0);
    const after = await sql<{ requests: number; jobs: number }>`
      select
        (select count(*)::int from reporting_requests where parent_request_id = ${parentId}) as requests,
        (select count(*)::int from desk_jobs where kind = 'reporting' and subject_id in
          (select id from reporting_requests where parent_request_id = ${parentId})) as jobs
    `;
    assert.deepEqual(after[0], before[0], "a refused continuation writes no request or job");
  });

  it("keeps explicit model, effort, seed and scope overrides available", async () => {
    const sql = await getSql();
    const parentId = await seedParent({
      modelChoice: "local-model",
      receipt: {
        requested: "local-model",
        effective: "local-model",
        effort: "none",
        localModel: ORIGINAL_LOCAL,
      },
      researchScope: "public",
    });
    const picker = changedPickerProbe();
    const explicitSeeds = "https://example.gov/follow-up-source.pdf";

    const result = await answerReportingFollowUp(
      EDITOR,
      {
        parentRequestId: parentId,
        assignment: "Use the newly selected model and source",
        modelChoice: "local-model",
        modelEffort: "high",
        seedUrls: explicitSeeds,
        researchScope: "supplied",
      },
      { probe: picker.probe, kick: false },
    );

    assert.ok(result.ok, result.ok ? undefined : result.error);
    assert.equal(picker.calls, 1, "an explicit new model choice still follows normal preflight");
    const [request] = await sql<{ model_receipt: unknown; seed_urls: unknown }>`
      select model_receipt, seed_urls from reporting_requests
      where id = ${result.requestId} and newsroom_id = ${NEWSROOM}
    `;
    const receipt = parsed<Record<string, unknown>>(request!.model_receipt);
    assert.equal(receipt.modelEffort, "high");
    assert.deepEqual(receipt.localModel, CURRENT_PICKER_MODEL);
    assert.deepEqual(parsed(request!.seed_urls), [explicitSeeds]);
    const [job] = await sql<{ research_scope: string }>`
      select research_scope from desk_jobs
      where newsroom_id = ${NEWSROOM} and kind = 'reporting' and subject_id = ${result.requestId}
      order by id desc limit 1
    `;
    assert.equal(job!.research_scope, "supplied");
  });
});

after(async () => {
  const sql = await getSql();
  await sql`delete from desk_jobs where newsroom_id = ${NEWSROOM} and user_id = ${EDITOR.userId}`;
  await sql`
    delete from reporting_requests
    where newsroom_id = ${NEWSROOM} and user_id = ${EDITOR.userId} and parent_request_id is not null
  `;
  await sql`delete from reporting_requests where newsroom_id = ${NEWSROOM} and user_id = ${EDITOR.userId}`;
  await sql`delete from desk_rate where newsroom_id = ${NEWSROOM} and user_id = ${EDITOR.userId}`;
  await sql`delete from paper_settings where newsroom_id = ${NEWSROOM}`;
});
