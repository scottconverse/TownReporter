import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setFetchImplForTests } from "./fetch-url.ts";
import { setOcrImpl, type OcrOptions } from "./ingest.ts";
import { defaultFetch } from "./investigate.ts";
import { OCR_TOTAL_BUDGET_MS, productionOcr } from "./ocr.ts";
import { singleRenderedPdfFixture, twoRenderedPdfFixture } from "./pdf-test-fixture.ts";
import { automaticLadder } from "./provider-registry.ts";
import { reportAndDraft } from "./report.ts";
import type { LeadRow } from "./types.ts";

const SCAN_URL = "https://93.184.216.34/council-scan.pdf";
const OCR_TEXT =
  "The scanned council packet says the water contract was approved after a public hearing.";

afterEach(() => {
  setFetchImplForTests(null);
  setOcrImpl(null);
});

function serveScan(): void {
  setFetchImplForTests(async () =>
    new Response(Buffer.from(singleRenderedPdfFixture()), {
      headers: { "content-type": "application/pdf" },
    }),
  );
}

describe("ordinary public-document OCR model routing", () => {
  it("sends only exact-model-supported effort on OpenAI-compatible OCR payloads", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Readable scanned packet text." } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const customId = "custom:11111111-1111-4111-8111-111111111111";
    const run = (modelId: string, reasoningEffort: "none" | "high" | "max") =>
      productionOcr(singleRenderedPdfFixture(), {
        provider: customId,
        newsroomId: "44",
        reasoningEffort,
        resolveCustom: async () => ({
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "not-needed",
          modelId,
        }),
      });
    try {
      await run("deepseek-v4.1-flash:cloud", "none");
      await run("deepseek-v4.1-flash:cloud", "high");
      await run("deepseek-v4.1-flash:cloud", "max");
      await run("unknown-vision-model", "high");
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(bodies[0]?.reasoning_effort, "none", "Off must explicitly disable thinking");
    assert.equal(bodies[1]?.reasoning_effort, "high");
    assert.equal(bodies[2]?.reasoning_effort, "max");
    assert.equal("reasoning_effort" in (bodies[3] ?? {}), false);
  });

  it("does not start a fallback after the shared deadline and preserves earlier pages", async () => {
    let clock = 0;
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const result = await productionOcr(twoRenderedPdfFixture(), {
      provider: "codex-balanced",
      forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
      visionFallbackPlans: [{ kind: "claude-code", model: "claude-sonnet" }],
      startedAt: 0,
      now: () => clock,
      adapters: {
        codex: async () => {
          primaryCalls += 1;
          if (primaryCalls === 1) return "The first page was retained before the deadline.";
          clock = OCR_TOTAL_BUDGET_MS;
          throw new Error("Codex request timed out after 90s, 0 bytes out");
        },
        "claude-code": async () => {
          fallbackCalls += 1;
          return "This call must never start after the shared deadline.";
        },
      },
    });
    assert.equal(primaryCalls, 2);
    assert.equal(fallbackCalls, 0);
    assert.equal(result.modelCalls, 2);
    assert.deepEqual(result.pages?.map((page) => page.page), [1]);
    assert.match(result.text, /first page was retained/);
    assert.match(result.reason ?? "", /page 2 was not read \(time limit\)/);
  });

  it("routes a forced named reader's preflight unavailability without leaving the injected transport set", async () => {
    const switches: string[] = [];
    const result = await productionOcr(singleRenderedPdfFixture(), {
      provider: "codex-balanced",
      forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
      adapters: {
        anthropic: async () => OCR_TEXT,
      },
      onProviderSwitch: async ({ transport }) => { switches.push(transport); },
    });
    assert.match(result.text, /water contract was approved/);
    assert.equal(result.provider, "Claude");
    assert.deepEqual(switches, ["anthropic"]);
  });

  it("promotes a successful fallback for later pages", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    let switches = 0;
    const result = await productionOcr(twoRenderedPdfFixture(), {
      provider: "codex-balanced",
      forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
      visionFallbackPlans: [{ kind: "claude-code", model: "sonnet" }],
      onProviderSwitch: async () => { switches += 1; },
      adapters: {
        codex: async () => {
          primaryCalls += 1;
          throw new Error("Codex request timed out after 90s, 0 bytes out");
        },
        "claude-code": async (_image, _timeout, selected) => {
          fallbackCalls += 1;
          return `Page ${fallbackCalls} read by ${selected?.model}.`;
        },
      },
    });
    assert.equal(result.pagesRead, 2);
    assert.equal(primaryCalls, 1);
    assert.equal(fallbackCalls, 2);
    assert.equal(switches, 1);
  });

  it("retries only a technically failed page on the next verified vision reader", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const result = await productionOcr(twoRenderedPdfFixture(), {
      provider: "codex-balanced",
      forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
      visionFallbackPlans: [{ kind: "claude-code", model: "sonnet" }],
      adapters: {
        codex: async () => {
          primaryCalls += 1;
          if (primaryCalls === 2) throw new Error("Codex request timed out after 90s, 0 bytes out");
          return "First page was read once.";
        },
        "claude-code": async () => {
          fallbackCalls += 1;
          return "Second page recovered by vision fallback.";
        },
      },
    });
    assert.equal(primaryCalls, 2, "the successful first page must not be repeated");
    assert.equal(fallbackCalls, 1, "only the failed second page moves to fallback");
    assert.deepEqual(result.pages?.map((page) => page.page), [1, 2]);
    assert.match(result.text, /First page was read once/);
    assert.match(result.text, /Second page recovered/);
    assert.equal(result.provider, "Codex → Claude");
  });

  it("keeps partial unread state when every verified vision fallback fails", async () => {
    let fallbackCalls = 0;
    const result = await productionOcr(twoRenderedPdfFixture(), {
      provider: "codex-balanced",
      forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
      visionFallbackPlans: [{ kind: "claude-code", model: "sonnet" }],
      adapters: {
        codex: async () => {
          throw new Error("Codex request timed out after 90s, 0 bytes out");
        },
        "claude-code": async () => {
          fallbackCalls += 1;
          throw new Error("Claude is unavailable");
        },
      },
    });
    assert.equal(fallbackCalls, 2);
    assert.equal(result.text, "");
    assert.equal(result.pagesRead, 0);
    assert.match(result.reason ?? "", /page 1 could not be read.*page 2 could not be read/i);
  });

  it("stops the fallback chain when a vision reader refuses the page", async () => {
    let laterReadyCalls = 0;
    await assert.rejects(
      productionOcr(singleRenderedPdfFixture(), {
        provider: "codex-balanced",
        forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
        visionFallbackPlans: [
          { kind: "claude-code", model: "claude-sonnet" },
          { kind: "codex", model: "gpt-6-astra" },
        ],
        adapters: {
          codex: async (_image, _timeoutMs, model) => {
            if (model!.model === "gpt-5.6-terra") {
              throw new Error("Codex request timed out after 90s, 0 bytes out");
            }
            laterReadyCalls += 1;
            return "This later provider could read the page.";
          },
          "claude-code": async () => "I cannot read or transcribe this page.",
        },
      }),
      /cannot read or transcribe/i,
    );

    assert.equal(laterReadyCalls, 0, "a refusal must terminate the provider chain");
  });

  it("never persists a primary vision reader refusal as extracted page text", async () => {
    let fallbackCalls = 0;
    await assert.rejects(
      productionOcr(singleRenderedPdfFixture(), {
        provider: "codex-balanced",
        forcedPlan: { kind: "codex", model: "gpt-5.6-terra" },
        visionFallbackPlans: [{ kind: "claude-code", model: "claude-sonnet" }],
        adapters: {
          codex: async () => "I cannot read or transcribe this page.",
          "claude-code": async () => {
            fallbackCalls += 1;
            return "This later provider could read the page.";
          },
        },
      }),
      /cannot read or transcribe/i,
    );
    assert.equal(fallbackCalls, 0, "a primary refusal must terminate the provider chain");
  });

  it("keeps Automatic OCR on Terra before Claude", async () => {
    const priorCodex = process.env.TOWNREPORTER_CODEX;
    const priorClaude = process.env.TOWNREPORTER_CLAUDE_CODE;
    const priorKey = process.env.ANTHROPIC_API_KEY;
    const priorModel = process.env.ANTHROPIC_MODEL;
    try {
      delete process.env.TOWNREPORTER_CODEX;
      delete process.env.TOWNREPORTER_CLAUDE_CODE;
      process.env.ANTHROPIC_API_KEY = "synthetic-key";
      process.env.ANTHROPIC_MODEL = "claude-sonnet";
      const selected: Array<{ transport: string; model: string }> = [];
      const result = await productionOcr(singleRenderedPdfFixture(), {
        provider: "auto",
        adapters: {
          codex: async (_image, _timeoutMs, model) => {
            assert.ok(model);
            selected.push(model);
            return OCR_TEXT;
          },
          anthropic: async () => {
            throw new Error("Claude must not run after Terra succeeds");
          },
          "claude-code": async () => {
            throw new Error("Claude Code must not run after the first available OCR path");
          },
        },
      });
      assert.match(result.text, /water contract was approved/);
      assert.deepEqual(selected, [{ transport: "codex", model: "gpt-5.6-terra" }]);
    } finally {
      if (priorCodex === undefined) delete process.env.TOWNREPORTER_CODEX;
      else process.env.TOWNREPORTER_CODEX = priorCodex;
      if (priorClaude === undefined) delete process.env.TOWNREPORTER_CLAUDE_CODE;
      else process.env.TOWNREPORTER_CLAUDE_CODE = priorClaude;
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = priorModel;
    }
  });

  it("uses the shared Automatic ladder's Claude Sonnet rung for OCR fallback", async () => {
    const priorCodex = process.env.TOWNREPORTER_CODEX;
    const priorClaude = process.env.TOWNREPORTER_CLAUDE_CODE;
    const priorKey = process.env.ANTHROPIC_API_KEY;
    const priorModel = process.env.ANTHROPIC_MODEL;
    const priorTerraModel = process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
    try {
      delete process.env.TOWNREPORTER_CODEX;
      delete process.env.TOWNREPORTER_CLAUDE_CODE;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_MODEL;
      delete process.env.TOWNREPORTER_CODEX_TERRA_MODEL;

      const selected: Array<{ transport: string; model: string }> = [];
      const result = await productionOcr(singleRenderedPdfFixture(), {
        provider: "auto",
        adapters: {
          codex: async (_image, _timeoutMs, selectedChoice) => {
            assert.ok(selectedChoice);
            selected.push({ transport: "codex", model: selectedChoice.model });
            throw new Error("Codex request timed out after 90s, 0 bytes out");
          },
          "claude-code": async (_image, _timeoutMs, selectedChoice) => {
            assert.ok(selectedChoice);
            selected.push({ transport: "claude-code", model: selectedChoice.model });
            return OCR_TEXT;
          },
        },
      });

      assert.match(result.text, /water contract was approved/);
      assert.deepEqual(selected, [
        { transport: "codex", model: "gpt-5.6-terra" },
        { transport: "claude-code", model: "sonnet" },
      ]);
    } finally {
      if (priorCodex === undefined) delete process.env.TOWNREPORTER_CODEX;
      else process.env.TOWNREPORTER_CODEX = priorCodex;
      if (priorClaude === undefined) delete process.env.TOWNREPORTER_CLAUDE_CODE;
      else process.env.TOWNREPORTER_CLAUDE_CODE = priorClaude;
      if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = priorModel;
      if (priorTerraModel === undefined) delete process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
      else process.env.TOWNREPORTER_CODEX_TERRA_MODEL = priorTerraModel;
    }
  });

  it("reaches Claude after Codex fails even though the writing ladder changed", async () => {
    const priorTerraModel = process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
    try {
      delete process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
      // The writing/research ladder exactly as 0.6.63 ships it: DeepSeek, then
      // Qwen on this computer, then Codex Terra. OCR must not follow it.
      assert.deepEqual([...automaticLadder()], ["deepseek-flash", "qwen-local", "codex-balanced"]);

      const selected: string[] = [];
      const result = await productionOcr(singleRenderedPdfFixture(), {
        provider: "auto",
        // A ready local vision model is offered as well: it must come AFTER
        // Claude, exactly as in 0.6.62, not before it as a writing-ladder rung.
        localModel: { baseUrl: "http://127.0.0.1:9500/v1", id: "qwen3-vl-32b" },
        adapters: {
          codex: async (_image, _timeoutMs, selectedChoice) => {
            assert.ok(selectedChoice);
            selected.push(selectedChoice.model);
            throw new Error("Codex request timed out after 90s, 0 bytes out");
          },
          "claude-code": async (_image, _timeoutMs, selectedChoice) => {
            assert.ok(selectedChoice);
            selected.push(selectedChoice.model);
            return OCR_TEXT;
          },
          local: async () => {
            selected.push("local");
            return OCR_TEXT;
          },
        },
      });

      assert.match(result.text, /water contract was approved/);
      assert.deepEqual(selected, ["gpt-5.6-terra", "sonnet"]);
    } finally {
      if (priorTerraModel === undefined) delete process.env.TOWNREPORTER_CODEX_TERRA_MODEL;
      else process.env.TOWNREPORTER_CODEX_TERRA_MODEL = priorTerraModel;
    }
  });

  it("routes explicit Grok OCR to a verified vision fallback", async () => {
    let grokCalls = 0;
    let codexCalls = 0;
    const result = await productionOcr(singleRenderedPdfFixture(), {
      provider: "grok-oauth",
      visionFallbackPlans: [{ kind: "codex", model: "gpt-5.6-terra" }],
      adapters: {
        "xai-oauth": async () => {
          grokCalls++;
          throw new Error("Grok OCR must not be attempted");
        },
        codex: async () => {
          codexCalls++;
          return OCR_TEXT;
        },
      },
    });
    assert.match(result.text, /water contract was approved/);
    assert.equal(grokCalls, 0);
    assert.equal(codexCalls, 1);
  });

  it("keeps every explicit Story picker choice, newsroom, and local override on the OCR read", async () => {
    const choices = [
      "codex-astra",
      "codex-frontier",
      "codex-balanced",
      "codex-luna",
      "claude-fable",
      "claude-frontier",
      "claude-sonnet",
      "claude-haiku",
      "grok-oauth",
      "custom:11111111-1111-4111-8111-111111111111",
      "local-model",
    ] as const;
    const seen: OcrOptions[] = [];
    serveScan();
    setOcrImpl(async (_bytes, options = {}) => {
      seen.push(options);
      return {
        text: OCR_TEXT,
        pages: [{ page: 1, text: OCR_TEXT }],
        provider: options.provider,
        pagesRead: 1,
        pagesTotal: 1,
      };
    });

    const lead: LeadRow = {
      id: 810,
      headline: "Council packet records water contract vote",
      why: "The public record documents a city decision.",
      topic: "council",
      status: "new",
      source_urls: JSON.stringify([SCAN_URL]),
      evidence: "",
      newsworthiness: 10,
      created_at: "2026-09-15",
    };
    for (const choice of choices) {
      const result = await reportAndDraft(
        {
          userId: "ocr-routing-story",
          newsroomId: 777,
          lead,
          urls: [SCAN_URL],
          memory: [],
          modelChoice: choice,
          providerOverrides: {
            "local-model": {
              localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "vision-local" },
            },
          },
        },
        {
          paper: async () => ({ name: "Test Paper", city: "Longmont", state: "Colorado" }),
          search: async () => [],
          capture: async () => ({ version_id: 1, capture_event_id: 2 }),
          hydrate: async () => [],
          chat: async () => ({
            ok: true,
            text: JSON.stringify({
              complete: true,
              people: [],
              news: lead.headline,
              why_it_matters: lead.why,
              angle: "The filed decision",
              form: "brief",
              fetch_urls: [],
              headline: lead.headline,
              dek: lead.why,
              body: OCR_TEXT,
              topic: lead.topic,
              source_urls: [SCAN_URL],
              integrity_notes: "",
              found: [],
              unanswered: [],
              claims: [],
              reporting_trail: [],
            }),
          }),
          budgetMs: 60_000,
        },
      );
      assert.ok(!("error" in result), "Story should finish with the scanned source");
    }

    assert.deepEqual(
      seen.map((options) => options.provider),
      choices,
    );
    assert.ok(seen.every((options) => options.newsroomId === "777"));
    assert.deepEqual(seen.at(-1)?.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "vision-local",
    });
    assert.ok(!seen.some((options) => options.provider === "auto" || options.provider?.includes("opus")));
  });

  it("uses Story Automatic's resolved rung for OCR instead of starting a hidden OCR ladder", async () => {
    const seen: OcrOptions[] = [];
    serveScan();
    setOcrImpl(async (_bytes, options = {}) => {
      seen.push(options);
      return { text: OCR_TEXT, pages: [{ page: 1, text: OCR_TEXT }] };
    });
    const lead: LeadRow = {
      id: 811,
      headline: "Council packet records water contract vote",
      why: "The public record documents a city decision.",
      topic: "council",
      status: "new",
      source_urls: JSON.stringify([SCAN_URL]),
      evidence: "",
      newsworthiness: 10,
      created_at: "2026-09-15",
    };
    const result = await reportAndDraft(
      {
        userId: "ocr-routing-auto",
        newsroomId: 778,
        lead,
        urls: [SCAN_URL],
        memory: [],
        modelChoice: "auto",
      },
      {
        probe: async () => ({ ok: true, label: "Codex Terra", choice: "codex-balanced" }),
        paper: async () => ({ name: "Test Paper", city: "Longmont", state: "Colorado" }),
        search: async () => [],
        capture: async () => ({ version_id: 1, capture_event_id: 2 }),
        hydrate: async () => [],
        chat: async () => ({
          ok: true,
          text: JSON.stringify({
            complete: true,
            people: [],
            news: lead.headline,
            why_it_matters: lead.why,
            angle: "The filed decision",
            form: "brief",
            fetch_urls: [],
            headline: lead.headline,
            dek: lead.why,
            body: OCR_TEXT,
            topic: lead.topic,
            source_urls: [SCAN_URL],
            integrity_notes: "",
            found: [],
            unanswered: [],
            claims: [],
            reporting_trail: [],
          }),
        }),
        budgetMs: 60_000,
      },
    );
    assert.ok(!("error" in result));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.provider, "codex-balanced");
    assert.equal(seen[0]?.newsroomId, "778");
  });

  it("threads the Dark Desk choice through a scanned public record, including custom newsroom scope", async () => {
    const seen: OcrOptions[] = [];
    serveScan();
    setOcrImpl(async (_bytes, options = {}) => {
      seen.push(options);
      return { text: OCR_TEXT, pages: [{ page: 1, text: OCR_TEXT }] };
    });

    const custom = "custom:22222222-2222-4222-8222-222222222222";
    const result = await defaultFetch(SCAN_URL, {
      provider: custom,
      newsroomId: "779",
      localModel: { baseUrl: "http://127.0.0.1:1234/v1", id: "vision-local" },
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /water contract was approved/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.provider, custom);
    assert.equal(seen[0]?.newsroomId, "779");
    assert.deepEqual(seen[0]?.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "vision-local",
    });
  });

  it("resolves a custom/Gemini scan inside its newsroom and calls that exact model", async () => {
    const selected: Array<{ transport: string; model: string }> = [];
    const resolved: Array<{ newsroomId: number; id: string }> = [];
    const customId = "33333333-3333-4333-8333-333333333333";
    const result = await productionOcr(singleRenderedPdfFixture(), {
      provider: `custom:${customId}`,
      newsroomId: "780",
      resolveCustom: async (newsroomId, id) => {
        resolved.push({ newsroomId, id });
        return {
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: "test-only-key",
          modelId: "gemini-2.5-flash",
        };
      },
      adapters: {
        openai: async (_image, _timeoutMs, model) => {
          assert.ok(model);
          selected.push(model);
          return OCR_TEXT;
        },
        anthropic: async () => {
          throw new Error("hidden Claude OCR must not run");
        },
        "claude-code": async () => {
          throw new Error("hidden Claude Code OCR must not run");
        },
      },
    });
    assert.deepEqual(resolved, [{ newsroomId: 780, id: customId }]);
    assert.deepEqual(selected, [{ transport: "openai", model: "gemini-2.5-flash" }]);
    assert.match(result.text, /water contract was approved/);
  });
});
