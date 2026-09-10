import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  inferCapabilities,
  decryptApiKey,
  encryptApiKey,
  normalizeConnectionInput,
  parseDiscoveredModels,
  publicConnection,
  deleteCustomAiConnection,
  listCustomAiConnections,
  resolveCustomAiChoice,
  saveCustomAiConnection,
  setCustomAiConnectionEnabled,
  testConnection,
} from "./custom-ai-connections.server.ts";

describe("custom OpenAI-compatible connection contract", () => {
  it("normalizes a base URL without changing selection or making a request", () => {
    const value = normalizeConnectionInput({
      name: "  Town GPU  ",
      baseUrl: "https://llm.example.test/v1/",
      apiKey: "server-secret",
      modelId: " reporter-large ",
    });
    assert.deepEqual(value, {
      name: "Town GPU",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "server-secret",
      modelId: "reporter-large",
    });
  });

  it("rejects credentials embedded in the URL", () => {
    assert.throws(
      () => normalizeConnectionInput({ name: "Bad", baseUrl: "https://key@example.test/v1" }),
      /must not include credentials/i,
    );
  });

  it("never exposes the stored secret", () => {
    const visible = publicConnection({
      id: "conn-1",
      newsroomId: 7,
      name: "Town GPU",
      baseUrl: "https://llm.example.test/v1",
      encryptedApiKey: "ciphertext-secret",
      modelId: "reporter-large",
      enabled: true,
    });
    assert.deepEqual(visible, {
      id: "conn-1",
      name: "Town GPU",
      baseUrl: "https://llm.example.test/v1",
      modelId: "reporter-large",
      enabled: true,
      hasApiKey: true,
    });
    assert.equal(JSON.stringify(visible).includes("ciphertext-secret"), false);
  });

  it("accepts only distinct model ids from an OpenAI-compatible models response", () => {
    assert.deepEqual(
      parseDiscoveredModels({
        data: [{ id: "b" }, { id: "a" }, { id: "b" }, { id: "" }, { nope: 1 }],
      }),
      ["a", "b"],
    );
  });

  it("reports only capabilities demonstrated by the explicit test response", () => {
    assert.deepEqual(
      inferCapabilities({ choices: [{ message: { content: "TOWNREPORTER_OK" } }] }),
      { chatCompletions: true, responses: null, modelDiscovery: null },
    );
    assert.deepEqual(
      inferCapabilities({
        output: [{ content: [{ type: "output_text", text: "TOWNREPORTER_OK" }] }],
      }),
      { chatCompletions: false, responses: null, modelDiscovery: null },
    );
  });

  it("encrypts a server-side API key without retaining plaintext", () => {
    const prior = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "test-only-secret-with-enough-entropy";
    try {
      const encrypted = encryptApiKey("sk-private-value");
      assert.doesNotMatch(encrypted, /sk-private-value/);
      assert.equal(decryptApiKey(encrypted), "sk-private-value");
    } finally {
      if (prior === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prior;
    }
  });

  it("requires actual assistant text before an explicit connection test succeeds", async () => {
    const connection = { baseUrl: "https://api.example.test/v1", modelId: "writer" };
    const empty = await testConnection(connection, "private-key", (async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer private-key");
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);
    assert.equal(empty.ok, false);
    assert.match(empty.message, /did not return assistant text/i);

    const answered = await testConnection(
      connection,
      null,
      (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "TOWNREPORTER_OK" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );
    assert.equal(answered.ok, true);
    assert.equal(answered.capabilities.chatCompletions, true);
  });
});

describe("persistent custom AI connections", () => {
  before(async () => {
    process.env.BETTER_AUTH_SECRET = "custom-api-persistence-test-secret";
    await ensureNewsroomSchema();
    const sql = await getSql();
    await sql.query(
      "insert into newsrooms(id,name) values(71,'Alpha'),(72,'Beta') on conflict(id) do nothing",
    );
    await sql.query(
      "insert into newsroom_members(user_id,role,newsroom_id) values('custom-alpha','editor',71),('custom-beta','editor',72) on conflict(user_id) do update set newsroom_id=excluded.newsroom_id,role=excluded.role",
    );
  });
  beforeEach(async () => {
    const sql = await getSql();
    await sql
      .query("delete from custom_ai_connections where newsroom_id in (71,72)")
      .catch(() => undefined);
  });

  it("persists CRUD within one newsroom and never lists another newsroom's row", async () => {
    const alpha = await saveCustomAiConnection("custom-alpha", {
      name: "Alpha API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "alpha-key",
      modelId: "alpha-model",
    });
    await saveCustomAiConnection("custom-beta", {
      name: "Beta API",
      baseUrl: "https://beta.example/v1",
      modelId: "beta-model",
    });
    assert.deepEqual(
      (await listCustomAiConnections("custom-alpha")).map((x) => x.name),
      ["Alpha API"],
    );
    assert.equal(alpha.hasApiKey, true);
    await deleteCustomAiConnection("custom-alpha", alpha.id);
    assert.deepEqual(await listCustomAiConnections("custom-alpha"), []);
    assert.deepEqual(
      (await listCustomAiConnections("custom-beta")).map((x) => x.name),
      ["Beta API"],
    );
  });

  it("keeps a stored key on blank-key edit and removes it only when explicitly requested", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "keep-me",
      modelId: "m1",
    });
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "Renamed",
      baseUrl: "https://alpha.example/v1",
      apiKey: "",
      modelId: "m2",
    });
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "keep-me");
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "Renamed",
      baseUrl: "https://alpha.example/v1",
      modelId: "m2",
      removeApiKey: true,
    });
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, null);
  });

  it("refuses resolving another newsroom's enabled connection without fallback", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "Alpha private API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "alpha-private-key",
      modelId: "alpha-model",
    });
    await assert.rejects(
      resolveCustomAiChoice(72, row.id),
      /will not fall back automatically/i,
    );
    assert.equal((await resolveCustomAiChoice(71, row.id)).modelId, "alpha-model");
  });

  it("refuses disabled, deleted, and model-less explicit choices", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      modelId: "m1",
    });
    await setCustomAiConnectionEnabled("custom-alpha", row.id, false);
    await assert.rejects(resolveCustomAiChoice(71, row.id), /will not fall back automatically/i);
    await setCustomAiConnectionEnabled("custom-alpha", row.id, true);
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "API",
      baseUrl: "https://alpha.example/v1",
      modelId: "",
    });
    await assert.rejects(resolveCustomAiChoice(71, row.id), /will not fall back automatically/i);
    await deleteCustomAiConnection("custom-alpha", row.id);
    await assert.rejects(resolveCustomAiChoice(71, row.id), /will not fall back automatically/i);
  });
});
