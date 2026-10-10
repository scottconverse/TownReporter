import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { ensureNewsroomSchema } from "./membership.ts";
import {
  inferCapabilities,
  connectionReadinessError,
  decryptApiKey,
  discoverConnectionModels,
  discoverCustomAiModels,
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
  testCustomAiConnection,
} from "./custom-ai-connections.server.ts";
import { ForbiddenError, ONLY_OWNER_CHANGES_MODEL_CONNECTIONS } from "./membership.ts";

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

  it("strips Google Gemini model resource prefixes only for Google's OpenAI endpoint", () => {
    const body = { data: [{ id: "models/gemini-3.8-flash" }, { id: "models/gemini-2.5-flash" }] };
    assert.deepEqual(
      parseDiscoveredModels(body, "https://generativelanguage.googleapis.com/v1beta/openai"),
      ["gemini-2.5-flash", "gemini-3.8-flash"],
    );
    assert.deepEqual(parseDiscoveredModels(body, "https://other.example/v1"), [
      "models/gemini-2.5-flash",
      "models/gemini-3.8-flash",
    ]);
  });

  it("normalizes a manually entered Gemini resource id before it can reach the picker", () => {
    assert.equal(
      normalizeConnectionInput({
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: "test-gemini-key",
        modelId: "models/gemini-2.5-flash",
      }).modelId,
      "gemini-2.5-flash",
    );
  });

  it("applies the Gemini normalization to provider discovery", async () => {
    const models = await discoverConnectionModels(
      { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
      null,
      (async () =>
        new Response(JSON.stringify({ data: [{ id: "models/gemini-3.8-flash" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );
    assert.deepEqual(models, ["gemini-3.8-flash"]);
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

  it("explains a restored Gemini key encrypted under a different server secret", () => {
    const prior = process.env.BETTER_AUTH_SECRET;
    try {
      process.env.BETTER_AUTH_SECRET = "original-server-secret";
      const encrypted = encryptApiKey("private-gemini-key");
      process.env.BETTER_AUTH_SECRET = "restored-dev-server-secret";
      assert.throws(() => decryptApiKey(encrypted), /cannot be decrypted.*Re-enter/);
      const error = connectionReadinessError({ id: "gemini", newsroomId: 1, name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", modelId: "gemini-3.5-flash", encryptedApiKey: encrypted, enabled: true });
      assert.match(error!, /cannot be decrypted.*before drafting/);
      assert.doesNotMatch(error!, /private-gemini-key|original-server-secret|restored-dev-server-secret/);
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

  it("uses enough output budget for the explicit Gemini-compatible probe", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await testConnection(
      {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelId: "gemini-3.8-flash",
      },
      null,
      (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "GEMINI_CONNECTION_OK" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }) as typeof fetch,
    );
    assert.equal(result.ok, true);
    assert.equal(requestBody?.max_tokens, 128);
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
    /*
      'custom-alpha' and 'custom-beta' are the OWNERS of newsrooms 71 and 72:
      every write in this file is an owner action since the connection's address
      and its stored key are the same decision (an editor gets a 403). The one
      editor, 'custom-editor', is here to prove the refusal.
    */
    await sql.query(
      "insert into newsroom_members(user_id,role,newsroom_id) values('custom-alpha','owner',71),('custom-beta','owner',72),('custom-editor','editor',71) on conflict(user_id) do update set newsroom_id=excluded.newsroom_id,role=excluded.role",
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

  it("translates a duplicate connection name into editor guidance", async () => {
    await saveCustomAiConnection("custom-alpha", {
      name: "Duplicate name",
      baseUrl: "https://alpha.example/v1",
      modelId: "alpha-model",
    });
    await assert.rejects(
      saveCustomAiConnection("custom-alpha", {
        name: "Duplicate name",
        baseUrl: "https://other.example/v1",
        modelId: "other-model",
      }),
      /already exists.*different name.*edit the existing connection/i,
    );
  });

  it("does not save a Gemini endpoint without its required server-side key", async () => {
    await assert.rejects(
      saveCustomAiConnection("custom-alpha", {
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelId: "gemini-2.5-flash",
      }),
      /Gemini requires an API key/i,
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
    await assert.rejects(resolveCustomAiChoice(72, row.id), /try the next ready model/i);
    assert.equal((await resolveCustomAiChoice(71, row.id)).modelId, "alpha-model");
  });

  it("refuses disabled, deleted, and model-less explicit choices", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      modelId: "m1",
    });
    await setCustomAiConnectionEnabled("custom-alpha", row.id, false);
    await assert.rejects(resolveCustomAiChoice(71, row.id), /try the next ready model/i);
    await setCustomAiConnectionEnabled("custom-alpha", row.id, true);
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "API",
      baseUrl: "https://alpha.example/v1",
      modelId: "",
    });
    await assert.rejects(resolveCustomAiChoice(71, row.id), /try the next ready model/i);
    await deleteCustomAiConnection("custom-alpha", row.id);
    await assert.rejects(resolveCustomAiChoice(71, row.id), /try the next ready model/i);
  });
});

/*
  A connection is an address the desk POSTs prompts to AND the place a stored
  provider key is spent: `discoverCustomAiModels` sends the decrypted key as a
  bearer token, `testCustomAiConnection` sends it with a real prompt, and a run
  sends it with the newsroom's reporting. An editor who could re-point the
  address and then press Discover would be spending the owner's key at an
  address of their choosing -- so every write and every key-using action is the
  owner's, refused on the server, not merely hidden in the page.
*/
describe("a model connection is the owner's to change and to spend", () => {
  const REFUSED = ONLY_OWNER_CHANGES_MODEL_CONNECTIONS;

  beforeEach(async () => {
    process.env.BETTER_AUTH_SECRET = "custom-api-persistence-test-secret";
    const sql = await getSql();
    await sql.query("insert into newsrooms(id,name) values(71,'Alpha') on conflict(id) do nothing");
    await sql.query(
      "insert into newsroom_members(user_id,role,newsroom_id) values('custom-alpha','owner',71),('custom-editor','editor',71) on conflict(user_id) do update set newsroom_id=excluded.newsroom_id,role=excluded.role",
    );
    await sql.query("delete from custom_ai_connections where newsroom_id = 71").catch(() => undefined);
  });

  /** A fetch that must never run: the refusal happens before any request. */
  const mustNotBeCalled = (async () => {
    throw new Error("the key must never leave the building for this caller");
  }) as typeof fetch;

  function isRefusal(err: unknown): boolean {
    return err instanceof ForbiddenError && err.message === REFUSED;
  }

  it("refuses an editor's save, enable, delete, discover and test, and changes nothing", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "Alpha API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "alpha-key",
      modelId: "alpha-model",
    });

    await assert.rejects(
      saveCustomAiConnection("custom-editor", {
        id: row.id,
        name: "Re-pointed",
        baseUrl: "https://attacker.example/v1",
        modelId: "alpha-model",
      }),
      isRefusal,
    );
    await assert.rejects(
      saveCustomAiConnection("custom-editor", {
        name: "Second",
        baseUrl: "https://attacker.example/v1",
        modelId: "other",
      }),
      isRefusal,
    );
    await assert.rejects(setCustomAiConnectionEnabled("custom-editor", row.id, false), isRefusal);
    await assert.rejects(deleteCustomAiConnection("custom-editor", row.id), isRefusal);
    // The two key-using actions: the stored key is decrypted and sent, so the
    // editor never gets as far as the request.
    await assert.rejects(discoverCustomAiModels("custom-editor", row.id, mustNotBeCalled), isRefusal);
    await assert.rejects(testCustomAiConnection("custom-editor", row.id, mustNotBeCalled), isRefusal);

    // Nothing was written, and nothing was sent.
    const rows = await listCustomAiConnections("custom-alpha");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "Alpha API");
    assert.equal(rows[0]?.baseUrl, "https://alpha.example/v1");
    assert.equal(rows[0]?.enabled, true);
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "alpha-key");

    /*
      And the read stays open to the editor, which is the point of the split:
      knowing a connection exists is not a way to change it -- and the listing
      carries no key (`publicConnection` strips `encryptedApiKey`).
    */
    const visible = await listCustomAiConnections("custom-editor");
    assert.deepEqual(visible.map((c) => c.name), ["Alpha API"]);
    assert.equal(visible[0]?.hasApiKey, true);
    assert.equal("encryptedApiKey" in (visible[0] ?? {}), false);
    assert.equal(JSON.stringify(visible).includes("alpha-key"), false);
  });

  it("still lets the owner save, enable, disable, discover, test and delete", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "Alpha API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "alpha-key",
      modelId: "alpha-model",
    });
    await setCustomAiConnectionEnabled("custom-alpha", row.id, false);
    assert.equal((await listCustomAiConnections("custom-alpha"))[0]?.enabled, false);
    await setCustomAiConnectionEnabled("custom-alpha", row.id, true);
    assert.equal((await listCustomAiConnections("custom-alpha"))[0]?.enabled, true);

    const models = await discoverCustomAiModels(
      "custom-alpha",
      row.id,
      (async (_url, init) => {
        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer alpha-key");
        return new Response(JSON.stringify({ data: [{ id: "alpha-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    );
    assert.deepEqual(models, ["alpha-model"]);

    const tested = await testCustomAiConnection(
      "custom-alpha",
      row.id,
      (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "TOWNREPORTER_OK" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    );
    assert.equal(tested.ok, true);

    await deleteCustomAiConnection("custom-alpha", row.id);
    assert.deepEqual(await listCustomAiConnections("custom-alpha"), []);
  });

  it("clears the stored key when the address changes and no new key is given", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "keep-me-only-at-alpha",
      modelId: "m1",
    });
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "keep-me-only-at-alpha");

    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "API",
      baseUrl: "https://moved.example/v1",
      modelId: "m1",
    });
    // The key was entered for alpha.example. Re-pointing the address without a
    // new key must not carry it to the new host.
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, null);
    const listed = (await listCustomAiConnections("custom-alpha"))[0];
    assert.equal(listed?.baseUrl, "https://moved.example/v1");
    assert.equal(listed?.hasApiKey, false);
  });

  it("stores a new key when one is supplied with the new address, and keeps the old key when the address does not move", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "first-key",
      modelId: "m1",
    });
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "API",
      baseUrl: "https://moved.example/v1",
      apiKey: "second-key",
      modelId: "m1",
    });
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "second-key");

    // Same address, no new key: a rename keeps the key it was stored with.
    await saveCustomAiConnection("custom-alpha", {
      id: row.id,
      name: "Renamed",
      baseUrl: "https://moved.example/v1",
      modelId: "m2",
    });
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "second-key");
  });

  it("still refuses a Gemini address that has no key, including one reached by moving the address", async () => {
    const row = await saveCustomAiConnection("custom-alpha", {
      name: "API",
      baseUrl: "https://alpha.example/v1",
      apiKey: "first-key",
      modelId: "m1",
    });
    await assert.rejects(
      saveCustomAiConnection("custom-alpha", {
        id: row.id,
        name: "API",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelId: "gemini-2.5-flash",
      }),
      /Gemini requires an API key/i,
    );
    // The refused save changed nothing.
    assert.equal((await resolveCustomAiChoice(71, row.id)).baseUrl, "https://alpha.example/v1");
    assert.equal((await resolveCustomAiChoice(71, row.id)).apiKey, "first-key");
  });
});
