import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilityStatus,
  connectionSaveMessage,
  managementActionsLocked,
  removeCustomAiConnection,
  saveCustomAiConnectionAndCache,
  updateCustomAiConnectionEnabled,
  upsertCustomAiConnection,
} from "./custom-ai-settings.ts";

test("capability display distinguishes unsupported from untested", () => {
  assert.equal(capabilityStatus(true), "yes");
  assert.equal(capabilityStatus(false), "no");
  assert.equal(capabilityStatus(null), "not tested");
});

test("saving and row actions use one interaction lock", () => {
  assert.equal(managementActionsLocked(false, null), false);
  assert.equal(managementActionsLocked(true, null), true);
  assert.equal(managementActionsLocked(false, "delete-id"), true);
});

test("save status confirms persistence without changing the model choice", () => {
  const saved = {
    id: "conn-1",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelId: "gemini-2.5-flash",
    enabled: true,
    hasApiKey: true,
  };
  assert.equal(
    connectionSaveMessage(saved),
    "Gemini saved with gemini-2.5-flash. It is ready to choose in the writing model picker.",
  );
  assert.match(
    connectionSaveMessage({ ...saved, modelId: null }),
    /Choose a model in Server settings before it can be selected/i,
  );
});

test("saved connection response updates the cached list by id", () => {
  const existing = {
    id: "conn-1",
    name: "Old name",
    baseUrl: "https://old.example/v1",
    modelId: "old-model",
    enabled: true,
    hasApiKey: false,
  };
  const saved = { ...existing, name: "New name", modelId: "new-model" };
  assert.deepEqual(upsertCustomAiConnection([existing], saved), [saved]);
  assert.deepEqual(upsertCustomAiConnection(undefined, saved), [saved]);
});

test("enable and delete cache updates apply immediately by connection id", () => {
  const rows = [
    {
      id: "conn-1",
      name: "Alpha",
      baseUrl: "https://alpha.example/v1",
      modelId: "alpha-model",
      enabled: true,
      hasApiKey: false,
    },
    {
      id: "conn-2",
      name: "Beta",
      baseUrl: "https://beta.example/v1",
      modelId: "beta-model",
      enabled: true,
      hasApiKey: false,
    },
  ];
  assert.equal(updateCustomAiConnectionEnabled(rows, "conn-1", false)[0]?.enabled, false);
  assert.deepEqual(removeCustomAiConnection(rows, "conn-1"), [rows[1]]);
});

test("save callback caches the authoritative server response before reconciliation", async () => {
  const saved = {
    id: "conn-2",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelId: "gemini-3.8-flash",
    enabled: true,
    hasApiKey: true,
  };
  let cached: unknown;
  let key: readonly unknown[] | undefined;
  const outcome = await saveCustomAiConnectionAndCache(
    { name: saved.name, baseUrl: saved.baseUrl, modelId: saved.modelId },
    async () => saved,
    {
      setQueryData(_key, updater) {
        key = _key;
        cached = updater(undefined);
      },
    },
  );
  assert.deepEqual(key, ["custom-ai-connections"]);
  assert.deepEqual(cached, [saved]);
  assert.deepEqual(outcome, saved);
});
