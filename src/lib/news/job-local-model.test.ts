import test from "node:test";
import assert from "node:assert/strict";
import { applyJobLocalModelSnapshot, pinnedLocalModelForJob } from "./job-local-model.ts";

const selectedAtEnqueue = {
  baseUrl: "http://127.0.0.1:11434/v1",
  id: "glm-5.2:cloud",
};
const selectedLater = {
  baseUrl: "http://127.0.0.1:11434/v1",
  id: "qwen3.5:397b-cloud",
};

test("queued local job keeps the exact preflighted model after the saved preference changes", async () => {
  const job = {
    newsroom_id: 7,
    model_choice: "local-model",
    result_json: JSON.stringify({
      actualRuntime: "local-model",
      localModelSnapshotVersion: 1,
      localModel: selectedAtEnqueue,
    }),
  } as const;

  const changedOverrides = { "local-model": { localModel: selectedLater } };
  const dispatched = applyJobLocalModelSnapshot(job, changedOverrides);

  assert.deepEqual(dispatched["local-model"]?.localModel, selectedAtEnqueue);
  assert.equal(changedOverrides["local-model"].localModel, selectedLater, "the mutable newsroom preference remains unchanged");
});

test("legacy local jobs without a snapshot keep the prior preference lookup behavior", async () => {
  const job = {
    newsroom_id: 7,
    model_choice: "local-model",
    result_json: JSON.stringify({ modelEffort: "none" }),
  } as const;
  assert.equal(pinnedLocalModelForJob(job), null);
  assert.deepEqual(applyJobLocalModelSnapshot(job, { "local-model": { localModel: selectedLater } })["local-model"]?.localModel, selectedLater);
});

test("new-format local jobs fail closed on missing or malformed snapshots", async () => {
  for (const localModel of [undefined, { baseUrl: "file:///bad", id: "glm-5.2:cloud" }, { baseUrl: "http://127.0.0.1/v1", id: " " }]) {
    const job = {
      newsroom_id: 7,
      model_choice: "local-model",
      result_json: JSON.stringify({ localModelSnapshotVersion: 1, localModel }),
    } as const;
    assert.throws(() => pinnedLocalModelForJob(job), /invalid saved model snapshot/);
  }
});
