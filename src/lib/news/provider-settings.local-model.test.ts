import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";
import { probeProvider } from "./ai.ts";
import { ForbiddenError, ONLY_OWNER_CHANGES_MODEL_CONNECTIONS } from "./membership.ts";
import { USE_LOADED_LOCAL_MODEL } from "./model-choice.ts";
import { MODEL_JOBS } from "./model-assignments.ts";
import { saveModelAssignments } from "./model-assignments-store.ts";
import { performCreateAiFollowUp } from "./follow-ups.ts";
import { enqueueJob } from "./jobs.ts";
import { performFollowUpRun } from "./follow-up-agents.ts";
import {
  ensureProviderSettingsSchema,
  readProviderOverrides,
  resolveLocalModelChoice,
  saveLocalModel,
} from "./provider-settings.ts";

const NEWSROOM_ID = 9001;
/**
 * The desk's owner, and a plain editor on the same desk.
 *
 * The stored local-model pick says where every local-model prompt AND the
 * operator's LLM_API_KEY go (`ai.ts`'s local gateway), so it is the owner's to
 * change -- the editor below is here to prove the refusal, not to use it.
 */
const OWNER_ID = "scoped-model-owner";
const EDITOR_ID = "scoped-model-editor";

async function storeRawLocalModel(baseUrl: string | null, id: string | null) {
  await ensureProviderSettingsSchema();
  const sql = await getSql();
  await sql.query(
    `
      insert into provider_settings (newsroom_id, provider_id, local_model_base_url, local_model_id)
      values ($1, 'local-model', $2, $3)
      on conflict (newsroom_id, provider_id) do update
        set local_model_base_url = excluded.local_model_base_url,
            local_model_id = excluded.local_model_id
    `,
    [NEWSROOM_ID, baseUrl, id],
  );
}

/** The test desk: one owner, and one editor who may look but not change. */
async function addDeskMembers() {
  const sql = await getSql();
  await sql.query(
    `insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`,
    [NEWSROOM_ID],
  );
  await sql.query(
    `insert into newsroom_members (user_id, role, newsroom_id)
     values ($1, 'owner', $2), ($3, 'editor', $2)
     on conflict (user_id) do update set newsroom_id = excluded.newsroom_id, role = excluded.role`,
    [OWNER_ID, NEWSROOM_ID, EDITOR_ID],
  );
}

/** Every address answers nothing: discovery finds no server at all. */
const fetchWithNoServer = (async () => {
  throw new Error("no local server in this test");
}) as typeof fetch;

function withFetch<T>(handler: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const OLLAMA_BASE = "http://127.0.0.1:11434/v1";
const CURRENT_MODELS = { data: [{ id: "gemma4:12b" }, { id: "gemma4:e4b" }] };
const CLOUD_MODELS = [
  "deepseek-v4.1-flash:cloud",
  "glm-5.2:cloud",
  "glm-5.3-flash:cloud",
  "qwen3.5:397b-cloud",
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchWithOllamaOnly(loadedIds: string[] = []): typeof fetch {
  return (async (input) => {
    const url = String(input);
    if (url === `${OLLAMA_BASE}/models`) return jsonResponse(CURRENT_MODELS);
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/ps`) return jsonResponse({ models: loadedIds.map((name) => ({ name })) });
    throw new Error(`unreachable: ${url}`);
  }) as typeof fetch;
}

function fetchWithModels(ids: string[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    if (url === `${OLLAMA_BASE}/models`) return jsonResponse({ data: ids.map((id) => ({ id })) });
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/ps`) return jsonResponse({ models: [] });
    if (url === `${OLLAMA_BASE.replace("/v1", "")}/api/show` && init?.method === "POST") {
      return jsonResponse({ capabilities: ["completion"] });
    }
    throw new Error(`unreachable: ${url}`);
  }) as typeof fetch;
}

describe("the per-newsroom local-model override resolves against the live catalog", () => {
  beforeEach(async () => {
    resetLocalCatalogCacheForTests();
    await storeRawLocalModel(null, null);
  });
  afterEach(async () => {
    await storeRawLocalModel(null, null);
    const sql = await getSql();
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_local_model_choices_additional where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_members where user_id in ('scoped-model-owner', 'scoped-model-editor')`);
    resetLocalCatalogCacheForTests();
  });

  it("keeps scan and story Ollama choices separate while preserving the legacy fallback", async () => {
    await addDeskMembers();
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:12b");
    assert.deepEqual(await saveLocalModel(OWNER_ID, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" }, "scan"), { ok: true });
    const result = await withFetch(fetchWithModels([...CLOUD_MODELS, "gemma4:12b", "gemma4:e4b"]), async () => ({
      scan: await readProviderOverrides(NEWSROOM_ID, "scan"),
      story: await readProviderOverrides(NEWSROOM_ID, "story"),
      picker: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.equal(result.scan["local-model"]?.localModel?.id, "gemma4:e4b");
    assert.equal(result.story["local-model"]?.localModel?.id, "gemma4:12b");
    assert.equal(result.picker.override?.id, "gemma4:e4b");
  });

  it("stores the follow-up model separately from the scan model", async () => {
    await addDeskMembers();
    const scanChoice = { baseUrl: OLLAMA_BASE, id: "scan-only" };
    const followUpChoice = { baseUrl: OLLAMA_BASE, id: "follow-up-only" };
    await withFetch(fetchWithModels([...CLOUD_MODELS, scanChoice.id, followUpChoice.id]), async () => {
      assert.deepEqual(await saveLocalModel(OWNER_ID, scanChoice, "scan"), { ok: true });
      assert.deepEqual(await saveLocalModel(OWNER_ID, followUpChoice, "follow-up"), { ok: true });
      const scan = await resolveLocalModelChoice(NEWSROOM_ID, "scan");
      const followUp = await resolveLocalModelChoice(NEWSROOM_ID, "follow-up");
      assert.deepEqual(scan.override, scanChoice);
      assert.deepEqual(followUp.override, followUpChoice);
    });
  });

  it("runs the exact local choice saved through the Models follow-up assignment surface", async () => {
    await addDeskMembers();
    const surface = MODEL_JOBS.find((job) => job.key === "follow-up")!.surface;
    const choice = { baseUrl: OLLAMA_BASE, id: "owner-picked-follow-up" };
    await withFetch(fetchWithModels([...CLOUD_MODELS, choice.id]), async () => {
      await saveLocalModel(OWNER_ID, choice, surface);
      await saveModelAssignments(NEWSROOM_ID, [{ jobKey: "follow-up", rank: 0, providerId: "local-model" }]);
      const context = { userId: OWNER_ID, newsroomId: NEWSROOM_ID };
      const created = await performCreateAiFollowUp(context, {
        what: "Has the clerk posted the notice?", agentKind: "search", schedule: "daily", modelChoice: "auto",
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const job = await enqueueJob({ ...context, kind: "follow-up", subjectId: created.id, modelChoice: "auto", kick: false });
      let judged = false;
      let received: unknown;
      await performFollowUpRun(job, {
        agents: {
          search: async () => ({ state: "SEARCH_SUCCESS_RESULTS", hits: [{ url: "https://clerk.test/notice", title: "Notice", snippet: "Notice" }], provider: "test" }),
          judge: async (input) => {
            judged = true;
            received = { provider: input.modelChoice, choice: input.localModel };
            return { ok: true, answers: false, url: "", title: "", summary: "No answer yet." };
          },
        },
      });
      assert.equal(judged, true);
      assert.deepEqual(received, { provider: "local-model", choice });
    });
  });

  it("prefers DeepSeek across scopes while every requested cloud model remains selectable", async () => {
    await addDeskMembers();
    const scopes = ["story", "scan", "follow-up", "opinion", "dark", "ocr", "forced"] as const;
    const expectedDefault: Record<(typeof scopes)[number], string> = {
      story: "deepseek-v4.1-flash:cloud",
      scan: "deepseek-v4.1-flash:cloud",
      "follow-up": "deepseek-v4.1-flash:cloud",
      opinion: "deepseek-v4.1-flash:cloud",
      dark: "deepseek-v4.1-flash:cloud",
      ocr: "deepseek-v4.1-flash:cloud",
      forced: "deepseek-v4.1-flash:cloud",
    };

    await withFetch(fetchWithModels(CLOUD_MODELS), async () => {
      for (const scope of scopes) {
        const firstRun = await resolveLocalModelChoice(NEWSROOM_ID, scope);
        assert.equal(firstRun.override?.id, expectedDefault[scope], `${scope} first-run preference`);
      }

      for (const scope of scopes) {
        for (const id of CLOUD_MODELS) {
          assert.deepEqual(await saveLocalModel(OWNER_ID, { baseUrl: OLLAMA_BASE, id }, scope), { ok: true });
          const saved = await resolveLocalModelChoice(NEWSROOM_ID, scope);
          assert.deepEqual(saved.override, { baseUrl: OLLAMA_BASE, id }, `${scope} must retain ${id}`);
          const ready = await probeProvider("local-model", NEWSROOM_ID, undefined, scope);
          assert.equal(ready.ok, true, `${scope} must preflight exact selected model ${id}`);
        }
      }
    });
  });

  it("does not replace an unavailable scoped cloud choice with the catalog default", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'deepseek-v4.1-flash:cloud')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const result = await withFetch(fetchWithOllamaOnly(), async () => ({
      scan: await readProviderOverrides(NEWSROOM_ID, "scan"),
      picker: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.equal(result.scan["local-model"]?.localModel?.id, "deepseek-v4.1-flash:cloud");
    assert.equal(result.picker.override?.id, "deepseek-v4.1-flash:cloud");
    assert.match(result.picker.notice ?? "", /not reachable or listed/);
  });

  it("preflights the scoped Ollama pick even when LM Studio is configured globally", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'gemma4:e4b')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const oldBase = process.env.LLM_BASE_URL;
    const oldModel = process.env.LLM_MODEL;
    process.env.LLM_BASE_URL = "http://127.0.0.1:1234/v1";
    process.env.LLM_MODEL = "a-local-model";
    try {
      const result = await withFetch(fetchWithOllamaOnly(), () => probeProvider("local-model", NEWSROOM_ID, undefined, "scan"));
      assert.equal(result.ok, true);
    } finally {
      if (oldBase === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBase;
      if (oldModel === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = oldModel;
    }
  });

  it("fails a saved scoped Ollama pick closed when /models returns malformed data", async () => {
    const sql = await getSql();
    await sql.query(`insert into newsrooms (id, name) values ($1, 'Scoped model test') on conflict (id) do nothing`, [NEWSROOM_ID]);
    await sql.query(`insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'deepseek-v4.1-flash:cloud')`, [NEWSROOM_ID, OLLAMA_BASE]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [{ name: "deepseek-v4.1-flash:cloud" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    try {
      const result = await probeProvider("local-model", NEWSROOM_ID, undefined, "scan");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /invalid model list.*could not verify/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the stored pick when it is still on the server's model list", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:e4b");
    const result = await withFetch(fetchWithOllamaOnly(), () => resolveLocalModelChoice(NEWSROOM_ID));
    assert.deepEqual(result.override, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" });
    assert.equal(result.notice, null);
  });

  it("falls back to the discovered default and returns a notice when the stored model vanished", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "a-model-that-was-removed");
    const result = await withFetch(fetchWithOllamaOnly(["gemma4:12b"]), () => resolveLocalModelChoice(NEWSROOM_ID));
    assert.equal(result.override?.id, "gemma4:12b"); // the loaded model is the default
    assert.match(result.notice ?? "", /a-model-that-was-removed is no longer on the server/);
    assert.match(result.notice ?? "", /using gemma4:12b/);
  });

  it("readProviderOverrides applies the same resolution for every model-calling caller", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "a-model-that-was-removed");
    const overrides = await withFetch(fetchWithOllamaOnly(["gemma4:12b"]), () => readProviderOverrides(NEWSROOM_ID));
    assert.deepEqual(overrides["local-model"]?.localModel, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
  });

  it("uses the discovered default when nothing has ever been stored", async () => {
    const result = await withFetch(fetchWithOllamaOnly(["gemma4:12b"]), async () => ({
      global: await resolveLocalModelChoice(NEWSROOM_ID),
      scan: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
    }));
    assert.deepEqual(result.global.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.equal(result.global.notice, null);
    assert.deepEqual(result.scan.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" }, "when the preferred cloud model is absent, keep the normal discovered fallback");
  });

  it("does not invent a default from available on-device models when none is loaded", async () => {
    const result = await withFetch(fetchWithOllamaOnly(), async () => ({
      global: await resolveLocalModelChoice(NEWSROOM_ID),
      scan: await resolveLocalModelChoice(NEWSROOM_ID, "scan"),
      run: await readProviderOverrides(NEWSROOM_ID),
    }));
    assert.equal(result.global.override, null);
    assert.equal(result.scan.override, null);
    assert.equal(result.run["local-model"]?.localModel ?? null, null);
    assert.equal(result.global.catalog.servers.some((server) => server.reachable), true);
  });
});

/*
  The stored pick is an ADDRESS, and `ai.ts`'s local gateway posts the full
  prompt plus the operator's LLM_API_KEY / OPENAI_API_KEY to it with a plain
  `fetch`. So the write is owner-only on the server, and the address it accepts
  is this computer (loopback) or one this computer's own discovery found --
  never a URL typed into a browser.
*/
describe("the local-model pick is the owner's, and its address must be local", () => {
  beforeEach(async () => {
    resetLocalCatalogCacheForTests();
    await storeRawLocalModel(null, null);
    await addDeskMembers();
  });
  afterEach(async () => {
    await storeRawLocalModel(null, null);
    const sql = await getSql();
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_local_model_choices_additional where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_members where user_id in ('scoped-model-owner', 'scoped-model-editor')`);
    resetLocalCatalogCacheForTests();
  });

  async function storedGlobal() {
    const sql = await getSql();
    return await sql.query(
      `select local_model_base_url, local_model_id from provider_settings where newsroom_id = $1 and provider_id = 'local-model'`,
      [NEWSROOM_ID],
    );
  }
  async function storedScoped(scope: string) {
    const sql = await getSql();
    return await sql.query(
      `select base_url, model_id from newsroom_local_model_choices where newsroom_id = $1 and scope = $2`,
      [NEWSROOM_ID, scope],
    );
  }

  it("refuses a plain editor on both paths, and writes nothing", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:12b");
    const sql = await getSql();
    await sql.query(
      `insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id) values ($1, 'scan', $2, 'gemma4:12b')`,
      [NEWSROOM_ID, OLLAMA_BASE],
    );

    for (const scope of [undefined, "scan"] as const) {
      for (const choice of [{ baseUrl: OLLAMA_BASE, id: "gemma4:e4b" }, null]) {
        await assert.rejects(
          saveLocalModel(EDITOR_ID, choice, scope),
          (err: unknown) =>
            err instanceof ForbiddenError && err.message === ONLY_OWNER_CHANGES_MODEL_CONNECTIONS,
          `an editor must be refused on the ${scope ?? "unscoped"} path`,
        );
      }
    }

    assert.deepEqual(await storedGlobal(), [
      { local_model_base_url: OLLAMA_BASE, local_model_id: "gemma4:12b" },
    ]);
    assert.deepEqual(await storedScoped("scan"), [
      { base_url: OLLAMA_BASE, model_id: "gemma4:12b" },
    ]);
    // And the editor may still READ the choice -- knowing it is not changing it.
    const visible = await withFetch(fetchWithNoServer, () => resolveLocalModelChoice(NEWSROOM_ID, "scan"));
    assert.equal(visible.override?.id, "gemma4:12b");
  });

  it("still lets the owner save and clear both paths", async () => {
    assert.deepEqual(await saveLocalModel(OWNER_ID, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" }), { ok: true });
    assert.deepEqual(await saveLocalModel(OWNER_ID, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" }, "scan"), { ok: true });
    assert.deepEqual(await storedGlobal(), [
      { local_model_base_url: OLLAMA_BASE, local_model_id: "gemma4:e4b" },
    ]);
    assert.deepEqual(await storedScoped("scan"), [{ base_url: OLLAMA_BASE, model_id: "gemma4:e4b" }]);

    assert.deepEqual(await saveLocalModel(OWNER_ID, null), { ok: true });
    assert.deepEqual(await saveLocalModel(OWNER_ID, null, "scan"), { ok: true });
    assert.deepEqual(await storedGlobal(), [{ local_model_base_url: null, local_model_id: null }]);
    assert.deepEqual(await storedScoped("scan"), []);
  });

  it("refuses an address that is not on this computer and not in the discovered catalog", async () => {
    await storeRawLocalModel(OLLAMA_BASE, "gemma4:12b");
    const refused = await withFetch(fetchWithNoServer, () =>
      saveLocalModel(OWNER_ID, { baseUrl: "https://attacker.example/v1", id: "exfiltrate" }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.error, /must be on this computer/);
    // The refusal is a refusal: the stored pick is exactly as it was.
    assert.deepEqual(await storedGlobal(), [
      { local_model_base_url: OLLAMA_BASE, local_model_id: "gemma4:12b" },
    ]);

    const refusedScoped = await withFetch(fetchWithNoServer, () =>
      saveLocalModel(OWNER_ID, { baseUrl: "https://attacker.example/v1", id: "exfiltrate" }, "scan"),
    );
    assert.equal(refusedScoped.ok, false);
    assert.deepEqual(await storedScoped("scan"), []);
  });

  it("accepts a loopback address, with or without a trailing slash, and the loaded-model sentinel", async () => {
    for (const baseUrl of [OLLAMA_BASE, `${OLLAMA_BASE}/`, "http://localhost:1234/v1", "http://[::1]:8080/v1"]) {
      assert.deepEqual(
        await withFetch(fetchWithNoServer, () => saveLocalModel(OWNER_ID, { baseUrl, id: "a-model" }, "scan")),
        { ok: true },
        `${baseUrl} is this computer`,
      );
    }
    assert.deepEqual(
      await withFetch(fetchWithNoServer, () =>
        saveLocalModel(OWNER_ID, { baseUrl: USE_LOADED_LOCAL_MODEL, id: USE_LOADED_LOCAL_MODEL }, "scan"),
      ),
      { ok: true },
    );
  });

  it("accepts an address this computer's own discovery just found", async () => {
    const LAN = "http://192.168.1.50:1234/v1";
    const oldBase = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = LAN;
    resetLocalCatalogCacheForTests();
    try {
      const result = await withFetch(
        (async (input) => {
          if (String(input) === `${LAN}/models`) return jsonResponse({ data: [{ id: "reporter-large" }] });
          throw new Error(`unreachable: ${String(input)}`);
        }) as typeof fetch,
        () => saveLocalModel(OWNER_ID, { baseUrl: LAN, id: "reporter-large" }),
      );
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(await storedGlobal(), [
        { local_model_base_url: LAN, local_model_id: "reporter-large" },
      ]);
    } finally {
      if (oldBase === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBase;
      resetLocalCatalogCacheForTests();
    }
  });
});

/*
  U7b: the SAME address rule, applied again when a stored choice is READ.

  `saveLocalModel` refuses a new address that is neither on this computer nor in
  the discovered catalog (U7), but a row can predate that check: the tables are
  plain `text` columns, and every row written before U7 -- or written by hand,
  or by a build that had no rule -- is still there. `resolveLocalModelChoice`
  and `readProviderOverrides` are the only two readers that turn those rows into
  something a model call uses (`probeProvider` asks the first; every draft,
  scan and dig asks the second), so the rule is applied at both, and the result
  is the same one a pick whose model vanished already got: the catalog's
  preferred local model, or nothing at all.

  The rows below are inserted with raw SQL on purpose. That is what a pre-fix
  row IS, and it is the case this test exists for -- not something the save path
  could still produce.
*/
describe("a stored local-model address the desk may not use is never called", () => {
  const ATTACKER = "https://attacker.example/v1";

  beforeEach(async () => {
    resetLocalCatalogCacheForTests();
    await storeRawLocalModel(null, null);
    const sql = await getSql();
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_local_model_choices_additional where newsroom_id = $1`, [NEWSROOM_ID]);
  });
  afterEach(async () => {
    await storeRawLocalModel(null, null);
    const sql = await getSql();
    await sql.query(`delete from newsroom_local_model_choices where newsroom_id = $1`, [NEWSROOM_ID]);
    await sql.query(`delete from newsroom_local_model_choices_additional where newsroom_id = $1`, [NEWSROOM_ID]);
    resetLocalCatalogCacheForTests();
  });

  /** A pre-fix row, exactly as an editor's save would have left it. */
  async function storeScoped(scope: string, baseUrl: string, id: string) {
    const sql = await getSql();
    await sql.query(
      `insert into newsroom_local_model_choices (newsroom_id, scope, base_url, model_id)
       values ($1, $2, $3, $4)
       on conflict (newsroom_id, scope) do update
         set base_url = excluded.base_url, model_id = excluded.model_id`,
      [NEWSROOM_ID, scope, baseUrl, id],
    );
  }

  /** A fetch that records every URL it is asked for, and answers the Ollama ones. */
  function recordingFetch(inner: typeof fetch) {
    const seen: string[] = [];
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      return inner(input as never, init as never);
    }) as typeof fetch;
    return { wrapped, seen };
  }

  it("refuses a stored scoped address that is not on this computer, and says why", async () => {
    await storeScoped("scan", ATTACKER, "exfiltrate");
    const { wrapped, seen } = recordingFetch(fetchWithOllamaOnly(["gemma4:12b"]));
    const result = await withFetch(wrapped, () => resolveLocalModelChoice(NEWSROOM_ID, "scan"));

    // Not the attacker's address -- the discovered Ollama model instead.
    assert.notEqual(result.override?.baseUrl, ATTACKER);
    assert.deepEqual(result.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.match(
      result.notice ?? "",
      /exfiltrate at attacker\.example is not on this computer or in the discovered list/,
    );
    assert.match(result.notice ?? "", /will not send work there/);
    assert.match(result.notice ?? "", /The owner can choose again/);
    // And nothing was ever asked of that host.
    assert.equal(seen.some((url) => url.includes("attacker.example")), false);
  });

  it("refuses the same stored scoped address on the run path, where every draft and scan reads it", async () => {
    await storeScoped("scan", ATTACKER, "exfiltrate");
    const { wrapped, seen } = recordingFetch(fetchWithOllamaOnly(["gemma4:12b"]));
    const overrides = await withFetch(wrapped, () => readProviderOverrides(NEWSROOM_ID, "scan"));

    assert.notEqual(overrides["local-model"]?.localModel?.baseUrl, ATTACKER);
    assert.deepEqual(overrides["local-model"]?.localModel, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.equal(seen.some((url) => url.includes("attacker.example")), false);
  });

  it("refuses a stored unscoped address the same way, on both readers", async () => {
    await storeRawLocalModel(ATTACKER, "exfiltrate");
    const { wrapped, seen } = recordingFetch(fetchWithOllamaOnly(["gemma4:12b"]));
    const result = await withFetch(wrapped, async () => ({
      picker: await resolveLocalModelChoice(NEWSROOM_ID),
      run: await readProviderOverrides(NEWSROOM_ID),
    }));

    assert.deepEqual(result.picker.override, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.match(result.picker.notice ?? "", /not on this computer or in the discovered list/);
    assert.notEqual(result.run["local-model"]?.localModel?.baseUrl, ATTACKER);
    assert.deepEqual(result.run["local-model"]?.localModel, { baseUrl: OLLAMA_BASE, id: "gemma4:12b" });
    assert.equal(seen.some((url) => url.includes("attacker.example")), false);
  });

  it("still keeps a stored loopback choice that is not answering right now", async () => {
    // The keep-your-choice behavior (~provider-settings.ts) survives for the
    // addresses it was written for: a server on this computer, briefly down.
    await storeScoped("scan", OLLAMA_BASE, "gemma4:e4b");
    const result = await withFetch(fetchWithNoServer, () => resolveLocalModelChoice(NEWSROOM_ID, "scan"));

    assert.deepEqual(result.override, { baseUrl: OLLAMA_BASE, id: "gemma4:e4b" });
    assert.match(result.notice ?? "", /not reachable or listed right now/);
    assert.doesNotMatch(result.notice ?? "", /not on this computer/);
  });

  it("still keeps a stored address the desk's own discovery lists, even when that model is absent", async () => {
    const LAN = "http://192.168.1.50:1234/v1";
    const oldBase = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = LAN;
    resetLocalCatalogCacheForTests();
    try {
      await storeScoped("scan", LAN, "a-model-that-is-not-loaded");
      const result = await withFetch(
        (async (input) => {
          if (String(input) === `${LAN}/models`) return jsonResponse({ data: [{ id: "reporter-large" }] });
          throw new Error(`unreachable: ${String(input)}`);
        }) as typeof fetch,
        () => resolveLocalModelChoice(NEWSROOM_ID, "scan"),
      );
      // Discovered, so it is kept -- and the notice is the reachability one,
      // not the refusal one.
      assert.deepEqual(result.override, { baseUrl: LAN, id: "a-model-that-is-not-loaded" });
      assert.match(result.notice ?? "", /not reachable or listed right now/);
      assert.doesNotMatch(result.notice ?? "", /not on this computer/);
    } finally {
      if (oldBase === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = oldBase;
      resetLocalCatalogCacheForTests();
    }
  });
});
