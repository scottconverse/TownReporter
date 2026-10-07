import { it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { grokChat } from "./ai.ts";
import { setLocalDiscoveryReachable } from "./provider-registry.ts";
import { enqueueJob, executeJob, __setJobWorkForTest, type JobKind } from "./jobs.ts";

it("saved exact-model receipts survive terminal writes across model-running job paths", async () => {
  const selected = { baseUrl: "http://127.0.0.1:11434/v1", id: "qwen3-coder:30b-a3b-q4_K_M" };
  const sql = await getSql();
  for (const kind of ["draft", "dark", "follow-up", "reporting"] as JobKind[]) {
    const job = await enqueueJob({
      userId: "round2-receipt",
      newsroomId: 99208,
      kind,
      subjectId: 208,
      modelChoice: "local-model",
      kick: false,
      resultJson: JSON.stringify({ localModel: selected, requestedRuntime: "local-model" }),
    });
    __setJobWorkForTest(async (claimed) => {
      const reply = await grokChat(
        "Write a sentence",
        "A test club meets Tuesday.",
        30,
        { choice: "local-model", localModel: selected },
        { openai: async () => ({ ok: true, text: "A test club meets Tuesday." }) },
      );
      assert.equal(reply.ok, true);
      // A terminal worker replaces its input receipt with result/quality data.
      await sql`update desk_jobs set result_json=${JSON.stringify({ finalDraftId: 208, quality: { reviewRequired: true } })} where id=${claimed.id}`;
    });
    try {
      assert.equal(await executeJob(job), true);
      const [stored] = await sql<{
        status: string;
        result_json: string;
      }>`select status,result_json from desk_jobs where id=${job.id}`;
      assert.equal(stored.status, "completed");
      const receipt = JSON.parse(stored.result_json);
      assert.equal(receipt.modelId, selected.id, kind);
      assert.equal(receipt.modelEndpoint, selected.baseUrl, kind);
      assert.equal(receipt.finalDraftId, 208);
      assert.equal(receipt.quality.reviewRequired, true);
      assert.equal(receipt.executedModels[0].runtime, "local-model");
    } finally {
      __setJobWorkForTest();
    }
  }
});

it("Automatic receipts name the responding rung and transport model, not a stale local pick", async () => {
  setLocalDiscoveryReachable(true);
  const sql = await getSql();
  const job = await enqueueJob({
    userId: "round2-automatic",
    newsroomId: 99209,
    kind: "draft",
    subjectId: 209,
    modelChoice: "deepseek-flash",
    modelChoiceSource: "auto",
    kick: false,
    resultJson: JSON.stringify({
      requestedRuntime: "auto",
      localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "old-model" },
    }),
  });
  __setJobWorkForTest(async () => {
    const reply = await grokChat(
      "Write",
      "A short test.",
      30,
      { choice: "deepseek-flash" },
      {
        openai: async () => ({
          ok: true,
          text: "A short test.",
          meta: {
            provider: "openai-compatible",
            model: "deepseek-v4.1-flash:cloud",
            endpoint: "http://127.0.0.1:11434/v1",
            durationMs: 1,
            timedOut: false,
          },
        }),
      },
    );
    assert.equal(reply.ok, true);
  });
  try {
    assert.equal(await executeJob(job), true);
    const [stored] = await sql<{
      result_json: string;
    }>`select result_json from desk_jobs where id=${job.id}`;
    const receipt = JSON.parse(stored.result_json);
    assert.equal(receipt.requestedRuntime, "auto");
    assert.equal(receipt.modelId, "deepseek-v4.1-flash:cloud");
    assert.equal(receipt.modelEndpoint, "http://127.0.0.1:11434/v1");
    assert.equal(receipt.executedModels[0].runtime, "deepseek-flash");
  } finally {
    __setJobWorkForTest();
    setLocalDiscoveryReachable(false);
  }
});
