import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setFetchImplForTests } from "./fetch-url.ts";
import { setOcrImpl, type OcrOptions } from "./ingest.ts";
import { defaultFetch } from "./investigate.ts";
import { productionOcr } from "./ocr.ts";
import { singleRenderedPdfFixture } from "./pdf-test-fixture.ts";
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
    new Response(singleRenderedPdfFixture(), {
      headers: { "content-type": "application/pdf" },
    }),
  );
}

describe("ordinary public-document OCR model routing", () => {
  it("keeps Automatic OCR on its established availability order before the writing ladder", async () => {
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
          anthropic: async (_image, _timeoutMs, model) => {
            assert.ok(model);
            selected.push(model);
            return OCR_TEXT;
          },
          codex: async () => {
            throw new Error("Codex must not run after the first available OCR path");
          },
          "claude-code": async () => {
            throw new Error("Claude Code must not run after the first available OCR path");
          },
        },
      });
      assert.match(result.text, /water contract was approved/);
      assert.deepEqual(selected, [{ transport: "anthropic", model: "claude-sonnet" }]);
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

  it("fails clearly for explicit Grok OCR without invoking a fallback", async () => {
    let grokCalls = 0;
    const result = await productionOcr(singleRenderedPdfFixture(), {
      provider: "grok-oauth",
      adapters: {
        "xai-oauth": async () => {
          grokCalls++;
          throw new Error("Grok OCR must not be attempted");
        },
      },
    });
    assert.equal(result.text, "");
    assert.equal(grokCalls, 0);
    assert.equal(
      result.reason,
      "Grok (SuperGrok) is a text-only connection in TownReporter and cannot read scan images. Choose Anthropic, Codex, Claude Code, or a local model marked · vision for OCR.",
    );
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
