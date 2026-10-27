// Guard for Scott's rule 24 (Oct 24 2026, G25-EF-1: "The paper's DeepSeek:
// deepseek-v4.1-flash:1017-cloud, effort NONE"; it replaced D168's "Low
// EVERYWHERE"): DeepSeek v4.1 Flash 1017 runs with effort NONE unless the
// editor picks another by hand. For every job that offers DeepSeek, the
// resolved effort must be "none" and the Ollama request must carry
// reasoning_effort "none".
//
// Known failure until the release/h-deepseek-effort PR merges: the resolver or
// the request path may still omit the field for some job. A failure here names
// the job, so the cause is visible in the CI log.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grokChat } from "./ai.ts";
import { MODEL_JOB_KEYS, isOfferedForJob, resolveJobModel } from "./model-assignments.ts";

// The eight jobs the rule names. OCR reads images, so DeepSeek is not offered there.
const DEEPSEEK_JOBS = [
  "story-draft",
  "opinion",
  "scan",
  "dark",
  "follow-up",
  "headlines",
  "evidence-check",
  "lead-score",
];

const DEEPSEEK_EXACT_MODEL = "deepseek-v4.1-flash:cloud";
const DEEPSEEK_LOCAL = { baseUrl: "http://127.0.0.1:11434/v1", id: DEEPSEEK_EXACT_MODEL };

async function withCleanEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["LLM_REASONING_EFFORT", "LLM_BASE_URL", "LLM_MODEL", "TOWNREPORTER_CLAUDE_CODE"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.TOWNREPORTER_CLAUDE_CODE = "0";
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("DeepSeek effort is None by default (Scott, rule 24, G25-EF-1)", () => {
  it("covers exactly the eight jobs that offer DeepSeek", () => {
    const offered = MODEL_JOB_KEYS.filter((key) => isOfferedForJob(key, "deepseek-flash"));
    assert.deepEqual([...offered].sort(), [...DEEPSEEK_JOBS].sort(),
      "a job that offers DeepSeek must be in this guard, or its effort is not checked");
  });

  for (const jobKey of DEEPSEEK_JOBS) {
    it(`${jobKey}: a DeepSeek pick with no explicit effort resolves to none`, () => {
      const resolved = resolveJobModel({
        jobKey,
        explicit: "deepseek-flash",
        exactModel: DEEPSEEK_EXACT_MODEL,
      });
      assert.equal(resolved.providerId, "deepseek-flash");
      assert.equal(resolved.effort, "none", `${jobKey} resolved DeepSeek effort to ${resolved.effort}`);
    });

    it(`${jobKey}: the Ollama request asks for no thinking (none)`, async () => {
      const resolved = resolveJobModel({
        jobKey,
        explicit: "deepseek-flash",
        exactModel: DEEPSEEK_EXACT_MODEL,
      });
      const bodies: Array<Record<string, unknown>> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ model: DEEPSEEK_EXACT_MODEL, choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        );
      };
      try {
        await withCleanEnv(async () => {
          const result = await grokChat("S", "U", 8, {
            choice: "local-model",
            localModel: DEEPSEEK_LOCAL,
            reasoningEffort: resolved.effort,
          }, { findClaudeCli: async () => null });
          assert.equal(result.ok, true, `${jobKey}: request failed`);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      assert.equal(bodies.length, 1);
      assert.equal(
        bodies[0]!.reasoning_effort,
        "none",
        `${jobKey}: Ollama body must carry reasoning_effort "none", got ${JSON.stringify(bodies[0]!.reasoning_effort)}`,
      );
    });
  }
});
