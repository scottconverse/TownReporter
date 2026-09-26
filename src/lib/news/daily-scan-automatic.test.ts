/**
 * Unit AA (0.6.64): the daily scan can run on Automatic.
 *
 * Until this unit a scheduled run could not: `DailyScanRuntime` excluded
 * "auto" and Automatic's own rungs, and a scheduled run that failed failed
 * over along `FORCED_FAILOVER_LADDER` (Codex Terra, then Claude Sonnet),
 * never onto the ladder stories walk. This file pins the four behaviours the
 * unit asks for, in the order they matter:
 *
 *   1. an Automatic policy resolves to the first rung, DeepSeek v4.1 Flash;
 *   2. a rung that has to be loaded and is not is SKIPPED, with the reason
 *      recorded, and the ladder moves on to the next ready rung;
 *   3. a run already pinned to a rung still fails over mid-run, one hop, with
 *      the same reason phrase and switch note a story gets;
 *   4. a policy with no runtime reads as Automatic, the scan policy schema
 *      accepts "auto", and a hand pick keeps today's behaviour (the
 *      Automatic rungs are still not reachable by a stored hand pick).
 *
 * Real models are never called: the HTTP endpoints are stubbed at
 * `globalThis.fetch`, and the last rung of the ladder is the fake Codex CLI
 * (`scripts/fakes/fake-codex-cli.mjs`), exactly as ai.test.ts does it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { probeProvider } from "./ai.ts";
import { validateDailyRuntime } from "./daily-scan.server.ts";
import { cleanDailyScanPolicyInput, dailyScanRuntime } from "./daily-scan.ts";
import { validateForcedRuntime } from "./forced-runtime.server.ts";
import { runScanChatWithFailover } from "./scan-model-run.ts";
import { resetLocalCatalogCacheForTests } from "./local-models.ts";

async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>) {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    "XAI_API_KEY",
    "GROK_API_KEY",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "XAI_MODEL",
    "XAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_EFFORT",
    "TOWNREPORTER_CLAUDE_CODE",
    "TOWNREPORTER_CODEX",
    "TOWNREPORTER_LOCAL",
    "CLAUDE_CLI_PATH",
    "TOWNREPORTER_DEEPSEEK",
    "TOWNREPORTER_QWEN",
    "TOWNREPORTER_DEEPSEEK_BASE_URL",
    "TOWNREPORTER_QWEN_BASE_URL",
    "TOWNREPORTER_DEEPSEEK_MODEL",
    "TOWNREPORTER_QWEN_MODEL",
    "CODEX_CLI_PATH",
    "FAKE_CODEX_SIGNED_IN",
    // The local catalog walk is part of test 3's second half; an ambient
    // "0" in the shell would silently empty it.
    "TOWNREPORTER_LOCAL_DISCOVERY",
  ];
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** No keys, no local CLI: every provider but the one under test is a failure. */
const BARE = { TOWNREPORTER_CLAUDE_CODE: "0" };

/**
 * The Codex rung's own stand-in, so "the ladder reached Codex Terra" can be
 * told apart from "this test started a real agent CLI on the machine".
 */
const FAKE_CODEX = fileURLToPath(
  new URL("../../../scripts/fakes/fake-codex-cli.mjs", import.meta.url),
);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** The exact shape `discoverLocalModels` reads from LM Studio. */
const LM_STUDIO_CATALOG = {
  servers: [
    {
      kind: "lmstudio",
      baseUrl: "http://127.0.0.1:1234/v1",
      reachable: true,
      models: [
        { id: "halo/qwen3.6-35b-a3b", label: "Qwen 3.6 35B", loaded: true },
      ],
    },
  ],
};

/**
 * Answer only the URLs this test knows; every other local port refuses to
 * connect, which is what a machine with nothing listening does.
 */
function stubFetch(respond: (url: string) => Response | null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = respond(url);
    if (!response) throw new TypeError(`fetch failed: ${url}`);
    return response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("daily scan on Automatic", () => {
  it("resolves an Automatic policy to DeepSeek v4.1 Flash, the ladder's first rung", async () => {
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK_BASE_URL: "http://127.0.0.1:11434/v1",
        CODEX_CLI_PATH: FAKE_CODEX,
      },
      async () => {
        const restore = stubFetch((url) =>
          url === "http://127.0.0.1:11434/v1/models"
            ? json({ data: [{ id: "deepseek-v4.1-flash:cloud" }] })
            : null,
        );
        try {
          const receipt = await validateDailyRuntime(1, "auto", null);
          assert.equal(receipt.requestedRuntime, "auto");
          // Automatic's own default effort, the one the policy row stores.
          assert.equal(receipt.requestedEffort, "medium");
          assert.equal(receipt.resolvedRuntime, "deepseek-flash");
          assert.equal(receipt.modelChoice, "deepseek-flash");
          assert.equal(receipt.transport, "local");
          // The rung's endpoint, not LLM_BASE_URL: this is what lets the run
          // actually reach DeepSeek on the Ollama port.
          assert.deepEqual(receipt.localModel, {
            baseUrl: "http://127.0.0.1:11434/v1",
            id: "deepseek-v4.1-flash:cloud",
          });
          // DeepSeek's own effort default is thinking off ("none"), which is
          // the effort the run record shows as resolved.
          assert.equal(receipt.modelEffort, "none");
          assert.equal(receipt.switchReason, null);
          assert.equal(receipt.switchNote, null);
        } finally {
          restore();
        }
      },
    );
  });

  it("skips a rung that is not loaded, records why, and lands on Codex Terra", async () => {
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK: "0",
        CODEX_CLI_PATH: FAKE_CODEX,
        FAKE_CODEX_SIGNED_IN: "1",
      },
      async () => {
        const { resolveAutomaticForcedRuntime } = (await import(
          "./forced-runtime.server.ts"
        )) as unknown as {
          resolveAutomaticForcedRuntime?: (
            newsroomId: number,
            effort?: null,
            deps?: { probe?: (rung: string) => Promise<unknown> },
          ) => Promise<{ modelChoice: string; transport: string; skippedRungs?: string[] }>;
        };
        assert.equal(typeof resolveAutomaticForcedRuntime, "function");
        const notLoaded = {
          servers: [
            {
              kind: "lmstudio",
              baseUrl: "http://127.0.0.1:1234/v1",
              reachable: true,
              models: [
                { id: "halo/qwen3.6-35b-a3b", label: "Qwen 3.6 35B", loaded: false },
              ],
            },
          ],
        };
        const restore = stubFetch(() => null);
        const probed: string[] = [];
        try {
          const snapshot = await resolveAutomaticForcedRuntime!(1, null, {
            probe: async (rung: string) => {
              probed.push(rung);
              return probeProvider(
                rung,
                1,
                { resolveLocalCatalog: async () => notLoaded } as never,
                "forced",
              );
            },
          });
          assert.deepEqual(probed, ["deepseek-flash", "qwen-local", "codex-balanced"]);
          assert.equal(snapshot.modelChoice, "codex-balanced");
          assert.equal(snapshot.transport, "codex");
          /*
            0.6.69 (Unit AL item 4): the rung names no model of its own, so the
            skip says the rung's own words -- nothing loaded in LM Studio -- not
            a model id. The catalog above still lists the model as downloaded
            (`loaded: false`), which is exactly the case that has to skip.
          */
          assert.deepEqual(snapshot.skippedRungs, [
            "Local model skipped: nothing loaded in LM Studio",
          ]);
        } finally {
          restore();
        }
      },
    );
  });

  it("moves one rung mid-run on a usage limit and records the switch", async () => {
    resetLocalCatalogCacheForTests();
    await withEnvAsync(
      {
        ...BARE,
        TOWNREPORTER_DEEPSEEK_BASE_URL: "http://127.0.0.1:11434/v1",
        // A rung is enabled by its own base URL or by a discovery probe, and a
        // test process has no discovery cache -- the same reason ai.test.ts
        // names the Qwen endpoint whenever its rung is the one under test.
        TOWNREPORTER_QWEN_BASE_URL: "http://127.0.0.1:1234/v1",
        CODEX_CLI_PATH: FAKE_CODEX,
      },
      async () => {
        const restore = stubFetch((url) => {
          if (url === "http://127.0.0.1:1234/api/v0/models")
            return json({
              data: [{ id: "halo/qwen3.6-35b-a3b", state: "loaded", type: "llm" }],
            });
          if (url === "http://127.0.0.1:1234/v1/models")
            return json({ data: [{ id: "halo/qwen3.6-35b-a3b" }] });
          return null;
        });
        try {
          const calls: string[] = [];
          /*
            A holder rather than two `let`s: both are written from inside the
            `onSwitch` callback below, which control-flow analysis cannot see,
            so a `let` initialised to null would still read as null here and
            `assert.ok` would narrow it to `never`. Property reads carry the
            declared type instead.
          */
          const seen: {
            receipt?: {
              previousChoice: string;
              nextChoice: string;
              previousLabel: string;
              nextLabel: string;
              nextEffort: unknown;
              reason: string;
              switchReason: string;
              switchNote: string;
            };
            resolved?: Awaited<ReturnType<typeof validateForcedRuntime>>;
          } = {};
          const reply = await runScanChatWithFailover({
            job: { id: 7, model_choice: "deepseek-flash", model_choice_source: "scheduled" },
            newsroomId: 1,
            system: "You are the desk.",
            user: "Read the sources.",
            maxTokens: 100,
            timeoutMs: () => 1000,
            grokChat: (async (
              _system: string,
              _user: string,
              _maxTokens: number,
              options: { choice?: string } | undefined,
            ) => {
              calls.push(String(options?.choice));
              return options?.choice === "deepseek-flash"
                ? { ok: false, error: "DeepSeek v4.1 Flash is rate limited (429)." }
                : { ok: true, text: '{"claims":[]}' };
            }) as never,
            probe: (choice) =>
              probeProvider(
                choice,
                1,
                { resolveLocalCatalog: async () => LM_STUDIO_CATALOG } as never,
                "scan",
              ),
            setModelChoice: async () => {},
            setStage: async () => {},
            // The first half of the real `runDailyScanWork` closure: the hop
            // names a rung, and the desk re-validates it into the snapshot the
            // stored reservation and run record are written from. The DB
            // persist itself is not exercised here (it needs a live PGlite
            // schema and belongs to the browser walk).
            onSwitch: async (next) => {
              seen.receipt = next as unknown as typeof seen.receipt;
              seen.resolved = await validateForcedRuntime(
                1,
                next.nextChoice as never,
                next.nextEffort,
                { automaticRung: true },
              );
            },
          });
          assert.deepEqual(calls, ["deepseek-flash", "qwen-local"]);
          const receipt = seen.receipt;
          assert.ok(receipt);
          assert.equal(receipt.previousChoice, "deepseek-flash");
          assert.equal(receipt.previousLabel, "DeepSeek v4.1 Flash");
          assert.equal(receipt.nextChoice, "qwen-local");
          /*
            The probe is the real one here, so the label is the one it reports
            for a rung that picks at call time: the picked model by name (0.6.69,
            Unit AL item 4). The switch note therefore names the model that will
            actually be asked, not just the rung.
          */
          assert.equal(receipt.nextLabel, "Local model (halo/qwen3.6-35b-a3b)");
          assert.equal(receipt.reason, "quota");
          assert.match(
            receipt.switchNote,
            /moved to Local model \(halo\/qwen3\.6-35b-a3b\) because DeepSeek v4\.1 Flash reached its usage limit/i,
          );
          const resolved = seen.resolved;
          assert.ok(resolved);
          assert.equal(resolved.modelChoice, "qwen-local");
          assert.equal(resolved.transport, "local");
          assert.deepEqual(resolved.localModel, {
            baseUrl: "http://127.0.0.1:1234/v1",
            id: "halo/qwen3.6-35b-a3b",
          });
          assert.equal(reply.ok, true);
        } finally {
          restore();
          resetLocalCatalogCacheForTests();
        }
      },
    );
  });

  it("reads a policy with no runtime as Automatic, and leaves a hand pick alone", async () => {
    // The read path `readDailyScanPolicy` uses for a newsroom with no row yet
    // (`dailyScanRuntime(p?.runtime)`), and the fallback for anything stored
    // that this build no longer offers.
    assert.equal(dailyScanRuntime(undefined), "auto");
    assert.equal(dailyScanRuntime(null), "auto");
    assert.equal(dailyScanRuntime("auto"), "auto");
    assert.equal(dailyScanRuntime("grok-oauth"), "auto");
    // A stored hand pick is NOT rewritten: the legacy names keep their own
    // meanings, so an existing policy keeps the model it names.
    assert.equal(dailyScanRuntime("local"), "local-model");
    assert.equal(dailyScanRuntime("codex-terra"), "codex-balanced");
    assert.equal(dailyScanRuntime("claude-frontier"), "claude-frontier");
    assert.equal(dailyScanRuntime("custom:gemini"), "custom:gemini");

    const base = {
      enabled: true,
      localTime: "06:00",
      sourceCap: 1,
      selectedSourceIds: [],
      expectedRevision: 0,
    };
    const automatic = cleanDailyScanPolicyInput({ ...base, runtime: "auto" });
    assert.equal(automatic.runtime, "auto");
    assert.equal(automatic.invalidError, undefined);
    // A rung is what Automatic resolved to on the day, never a value an editor
    // can store on the policy.
    assert.ok(cleanDailyScanPolicyInput({ ...base, runtime: "deepseek-flash" }).invalidError);

    /*
      The hand pick's own failover is unchanged: it walks
      FORCED_FAILOVER_LADDER. `fakeValidate` would happily accept
      "deepseek-flash", so resolving to Codex Terra proves the rung was never
      a candidate -- exactly today's behaviour, kept on purpose.
    */
    const calls: string[] = [];
    const fakeValidate = async (
      _newsroomId: number,
      runtime: string,
      _effort?: unknown,
    ) => {
      calls.push(runtime);
      if (runtime === "codex-balanced")
        return {
          runtime: "codex-balanced",
          modelChoice: "codex-balanced",
          transport: "codex" as const,
          model: "gpt-5.2-codex",
        };
      if (runtime === "deepseek-flash")
        return {
          runtime: "deepseek-flash",
          modelChoice: "deepseek-flash",
          transport: "local" as const,
        };
      throw new Error(`${runtime} is unavailable`);
    };
    const kept = await validateDailyRuntime(1, "claude-sonnet", "max", fakeValidate as never);
    assert.equal(kept.requestedRuntime, "claude-sonnet");
    assert.equal(kept.resolvedRuntime, "codex-balanced");
    assert.equal(calls.includes("deepseek-flash"), false);
  });
});
