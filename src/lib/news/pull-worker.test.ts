import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IngestDocument } from "./ingest.ts";
import {
  appendPulledDocument,
  newPullReceipt,
  runPullPipeline,
  type PullCheckpoint,
  type PullReceipt,
} from "./pull.server.ts";
import { emptyNotes } from "./notes.ts";

function document(
  url: string,
  text = "Longmont City Council official record with enough useful text to extract for this reporting task.",
): IngestDocument {
  return {
    ok: true,
    status: 200,
    outcome: "fetched",
    text,
    title: `Record at ${url}`,
    extras: [],
    contentType: "text/html",
    needsOcr: false,
    redirectChain: [url],
    extractionMethod: "readability",
    pages: [],
    notices: [],
  };
}

function receipt(overrides: Partial<PullCheckpoint> = {}) {
  const base = newPullReceipt({
    leadId: 12,
    todoIndex: 2,
    query: "Longmont City Council contract",
  });
  base.checkpoint = {
    city: "Longmont",
    state: "Colorado",
    subjects: ["Longmont City Council"],
    queries: ["Longmont City Council contract"],
    queryIndex: 1,
    hits: [],
    storyUrls: [],
    indexPagesPrepared: true,
    indexPages: [],
    indexPageIndex: 0,
    indexedUrls: [],
    rankedPrepared: true,
    rankedUrls: ["https://longmontcolorado.gov/record"],
    documentIndex: 0,
    documents: [],
    ...overrides,
  };
  return base as PullReceipt & { checkpoint: PullCheckpoint };
}

describe("durable Pull pipeline", () => {
  it("keeps a separate excerpt when two questions use the same public document", () => {
    const shared = {
      title: "Council packet",
      url: "https://longmontcolorado.gov/packet.pdf",
      excerpt: "The packet answers both questions in separate passages.",
    };
    const first = appendPulledDocument(emptyNotes(), "What was approved?", shared);
    const second = appendPulledDocument(first, "What did it cost?", shared);
    const duplicateRetry = appendPulledDocument(second, "What did it cost?", shared);
    assert.match(second.scratch, /Pulled for: What was approved\?/);
    assert.match(second.scratch, /Pulled for: What did it cost\?/);
    assert.equal(second.opened.length, 1);
    assert.equal(duplicateRetry, second);
  });

  it("saves each relevant document before the run completes", async () => {
    const events: string[] = [];
    const result = await runPullPipeline(receipt(), {
      search: async () => assert.fail("completed search checkpoint must not run again"),
      ingest: async (url) => document(url),
      stopRequested: async () => false,
      saveDocument: async (doc) => events.push(`document:${doc.url}`),
      saveReceipt: async (next) => events.push(`receipt:${next.status}:${next.stage}`),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.counters.documentsOpened, 1);
    assert.equal(result.counters.documentsSaved, 1);
    const documentSave = events.findIndex((event) => event.startsWith("document:"));
    const completionSave = events.findIndex((event) => event.startsWith("receipt:completed:"));
    assert.ok(documentSave >= 0 && completionSave > documentSave, events.join("\n"));
  });

  it("stops at the next durable boundary and keeps the reporting item unresolved", async () => {
    let networkCalls = 0;
    const result = await runPullPipeline(receipt(), {
      search: async () => assert.fail("search must not run"),
      ingest: async (url) => {
        networkCalls += 1;
        return document(url);
      },
      stopRequested: async () => true,
      saveDocument: async () => assert.fail("no document should be saved after an early stop"),
      saveReceipt: async () => undefined,
    });
    assert.equal(result.status, "stopped");
    assert.equal(networkCalls, 0);
    assert.equal(result.counters.documentsSaved, 0);
  });

  it("continues from checkpoint indexes without repeating completed documents", async () => {
    const prior = {
      title: "Already saved",
      url: "https://longmontcolorado.gov/one",
      excerpt: "prior",
    };
    const next = "https://longmontcolorado.gov/two";
    const opened: string[] = [];
    const result = await runPullPipeline(
      receipt({
        rankedUrls: [prior.url, next],
        documentIndex: 1,
        documents: [prior],
      }),
      {
        search: async () => assert.fail("completed search checkpoint must not run again"),
        ingest: async (url) => {
          opened.push(url);
          return document(url);
        },
        stopRequested: async () => false,
        saveDocument: async () => undefined,
        saveReceipt: async () => undefined,
      },
    );
    assert.deepEqual(opened, [next]);
    assert.equal(result.checkpoint?.documents.length, 2);
    assert.equal(result.counters.documentsSaved, 2);
  });

  it("skips completed searches and index pages recorded before a cursor advance", async () => {
    const indexed = "https://longmontcolorado.gov/packet.pdf";
    const opened: string[] = [];
    const result = await runPullPipeline(
      receipt({
        queryIndex: 0,
        queryResults: [[{ title: "prior search", url: indexed, snippet: "" }]],
        hits: [{ title: "prior search", url: indexed, snippet: "" }],
        indexPagesPrepared: true,
        indexPages: ["https://longmontcolorado.gov/meetings"],
        indexPageIndex: 0,
        indexPageResults: [[indexed]],
        indexedUrls: [indexed],
        rankedUrls: [indexed],
        documentIndex: 0,
        documentOutcomes: [null],
      }),
      {
        search: async () => assert.fail("a durably recorded search must not run again"),
        ingest: async (url) => {
          opened.push(url);
          return document(url);
        },
        stopRequested: async () => false,
        saveDocument: async () => undefined,
        saveReceipt: async () => undefined,
      },
    );
    assert.deepEqual(opened, [indexed]);
    assert.equal(result.counters.searchesAttempted, 0);
    assert.equal(result.counters.indexPagesChecked, 0);
    assert.equal(result.counters.documentsOpened, 1);
    assert.equal(result.status, "completed");
  });

  it("enforces the whole-run deadline and preserves its checkpoint", async () => {
    let aborted = false;
    const result = await runPullPipeline(receipt(), {
      deadlineMs: 5,
      search: async () => assert.fail("completed search checkpoint must not run again"),
      ingest: async (_url, signal) =>
        new Promise<IngestDocument>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
      stopRequested: async () => false,
      saveDocument: async () => assert.fail("timed-out document must not be saved"),
      saveReceipt: async () => undefined,
    });
    assert.equal(result.status, "deadline");
    assert.equal(result.checkpoint?.documentIndex, 0);
    assert.match(result.stage, /Stopped after 2 minutes/);
    assert.equal(aborted, true);
  });

  it("ignores provider progress that arrives after the whole-run deadline", async () => {
    const saved: PullReceipt[] = [];
    const result = await runPullPipeline(
      receipt({
        queryIndex: 0,
        queryResults: [null],
        indexPagesPrepared: true,
        rankedPrepared: true,
        rankedUrls: [],
      }),
      {
        deadlineMs: 5,
        search: async (_query, progress) => {
          setTimeout(() => void progress({ phase: "started", provider: "late provider" }), 20);
          return new Promise(() => undefined);
        },
        ingest: async () => assert.fail("the timed-out search must stop the pipeline"),
        stopRequested: async () => false,
        saveDocument: async () => assert.fail("the timed-out search must save no document"),
        saveReceipt: async (next) => saved.push(JSON.parse(JSON.stringify(next)) as PullReceipt),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(result.status, "deadline");
    assert.equal(result.counters.providersAttempted, 0);
    assert.equal(saved.at(-1)?.status, "deadline");
    assert.equal(saved.at(-1)?.counters.providersAttempted, 0);
  });

  it("retains provider-unavailable failures while continuing the mechanical search", async () => {
    const result = await runPullPipeline(
      receipt({
        queryIndex: 0,
        queryResults: [null],
        indexPagesPrepared: true,
        rankedPrepared: true,
        rankedUrls: [],
      }),
      {
        search: async (_query, progress) => {
          await progress({ phase: "started", provider: "Exa" });
          await progress({
            phase: "finished",
            provider: "Exa",
            state: "SEARCH_FAILED_PROVIDER",
            error: "provider unavailable",
          });
          return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "none", lineage: [] };
        },
        ingest: async () => assert.fail("there are no candidate documents"),
        stopRequested: async () => false,
        saveDocument: async () => assert.fail("there are no candidate documents"),
        saveReceipt: async () => undefined,
      },
    );
    assert.equal(result.status, "completed");
    assert.equal(result.counters.providersAttempted, 1);
    assert.equal(result.counters.failures, 1);
    assert.match(result.errors[0] ?? "", /Exa: provider unavailable/);
  });
});
