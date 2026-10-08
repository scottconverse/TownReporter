import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IngestDocument } from "./ingest.ts";
import {
  appendPulledDocument,
  newPullReceipt,
  runPullPipeline,
  type PullCheckpoint,
  type PullPipelineDeps,
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
      saveDocument: async (doc) => { events.push(`document:${doc.url}`); },
      saveReceipt: async (next) => { events.push(`receipt:${next.status}:${next.stage}`); },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.counters.documentsOpened, 1);
    assert.equal(result.counters.documentsSaved, 1);
    const documentSave = events.findIndex((event) => event.startsWith("document:"));
    const completionSave = events.findIndex((event) => event.startsWith("receipt:completed:"));
    assert.ok(documentSave >= 0 && completionSave > documentSave, events.join("\n"));
  });

  // guards: a timed-out source read is mistaken for a search that found nothing
  it("marks a timed-out source read as failed", async () => {
    const result = await runPullPipeline(receipt(), {
      search: async () => assert.fail("the saved search checkpoint must not run again"),
      ingest: async () => { throw new Error("Request timed out"); },
      stopRequested: async () => false,
      saveDocument: async () => assert.fail("the timed-out source was not read"),
      saveReceipt: async () => {},
    });
    assert.equal(result.status, "failed");
    assert.match(result.stage, /timeout/i);
    assert.doesNotMatch(result.stage, /no relevant public document found/i);
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

  it("cancels a claim Pull at the boundary, before it opens the page", async () => {
    /*
      B8B item 2. A claim's Pull names one page and finishes, so "the next
      durable boundary" is the moment before the fetch -- and that moment was
      the one boundary the pipeline did not check. An editor's Cancel arriving
      here was answered by opening the page anyway.

      THE MUTATION THAT MATTERS: delete `await deps.assertNotCancelled?.()` from
      the `receipt.sourceUrl` branch of `pull.server.ts` and this case fails on
      the first assert -- `ingest` runs, and the run completes instead of
      ending cancelled.
    */
    const claim = receipt();
    claim.sourceUrl = "https://longmontcolorado.gov/record";
    await assert.rejects(
      runPullPipeline(claim, {
        search: async () => assert.fail("a claim Pull runs no search"),
        ingest: async () => assert.fail("a cancelled claim Pull must not open the page"),
        stopRequested: async () => false,
        assertNotCancelled: async () => {
          throw new Error("Cancelled by the editor.");
        },
        saveDocument: async () => assert.fail("nothing is saved after a cancel"),
        saveReceipt: async () => undefined,
      }),
      /Cancelled by the editor/,
      "the desk's own reason leaves the pipeline rather than becoming a failure line",
    );
  });

  it("stops at the query boundary when the Cancel lands after the first search", async () => {
    /*
      B8B2. The query loop asks `assertNotCancelled` at the top of every pass,
      and until now nothing in this file reached that boundary: the claim case
      below is answered before the loop starts, and every other case either
      fails the search or has its queries already completed. Delete the
      `await deps.assertNotCancelled?.()` from the loop and the whole file stays
      green -- which is the hole this case fills.

      A search Pull spends one search per question, so the boundary that matters
      is BETWEEN two of them: an editor who pressed Cancel while the first
      answer was being written must not pay for the second search.
    */
    const searched: string[] = [];
    const statuses: string[] = [];
    await assert.rejects(
      runPullPipeline(receipt({ queries: ["first question", "second question"], queryIndex: 0 }), {
        search: async (query) => {
          searched.push(query);
          return {
            state: "SEARCH_SUCCESS_ZERO_RESULTS",
            hits: [],
            provider: "fixture",
            lineage: [],
          };
        },
        ingest: async () => assert.fail("no page should be opened for a cancelled pull"),
        stopRequested: async () => false,
        // The editor's press lands while the first search is being saved.
        assertNotCancelled: async () => {
          if (searched.length >= 1) throw new Error("Cancelled by the editor");
        },
        saveDocument: async () => undefined,
        saveReceipt: async (next) => {
          statuses.push(next.status);
        },
      }),
      /Cancelled by the editor/,
      "the desk's own reason leaves the pipeline rather than becoming a failure line",
    );
    assert.deepEqual(searched, ["first question"], "the second search was never made");
    assert.equal(
      statuses.includes("completed"),
      false,
      "and nothing says Done for a pull the editor stopped",
    );
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
        saveReceipt: async (next) => { saved.push(JSON.parse(JSON.stringify(next)) as PullReceipt); },
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
    assert.equal(result.status, "failed");
    assert.equal(result.counters.providersAttempted, 1);
    assert.equal(result.counters.failures, 1);
    assert.match(result.errors[0] ?? "", /Exa: provider unavailable/);
  });
});

/*
  PULL1 point 1: the closing sentence is computed from what the providers did.

  The live report, in one fixture: three Pulls, "13 provider or page failures",
  and a final line that told Scott the record was not there. Two of those runs
  had been refused by every search provider there is.
*/
describe("what a Pull says when it comes back with nothing", () => {
  const zeroHits = (overrides: Partial<PullCheckpoint> = {}) =>
    receipt({
      queryIndex: 0,
      queryResults: [null],
      indexPagesPrepared: true,
      indexPages: [],
      indexPageIndex: 0,
      rankedPrepared: true,
      rankedUrls: [],
      ...overrides,
    });

  const refused: PullPipelineDeps["search"] = async (_query, onProgress) => {
    await onProgress({ phase: "started", provider: "Exa" });
    await onProgress({
      phase: "finished",
      provider: "exa-mcp",
      state: "SEARCH_BLOCKED",
      error: "HTTP 429",
    });
    await onProgress({ phase: "started", provider: "DuckDuckGo" });
    await onProgress({
      phase: "finished",
      provider: "ddg-html",
      state: "SEARCH_BLOCKED",
      error: "SEARCH_BLOCKED",
    });
    return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "none", lineage: [] };
  };

  it("names the providers that refused instead of saying the topic has nothing", async () => {
    const stages: string[] = [];
    const result = await runPullPipeline(zeroHits(), {
      search: refused,
      ingest: async () => assert.fail("there are no candidate documents"),
      stopRequested: async () => false,
      saveDocument: async () => assert.fail("there are no candidate documents"),
      saveReceipt: async (next) => {
        stages.push(next.stage);
      },
    });
    const final = stages.at(-1) ?? "";
    assert.equal(result.status, "failed");
    assert.match(final, /search is unavailable/i);
    assert.match(final, /Exa: rate limited/);
    assert.match(final, /DuckDuckGo: blocked this computer/);
    assert.match(final, /again/i, "the editor is told a retry will probably repeat it");
    assert.doesNotMatch(final, /no relevant public document found/i);
    // The raw lines stay on the receipt for support.
    assert.ok(result.errors.some((error) => /exa-mcp: HTTP 429/.test(error)));
  });

  it("keeps the plain sentence when the searches really ran and found nothing", async () => {
    const stages: string[] = [];
    const result = await runPullPipeline(zeroHits(), {
      search: async (_query, progress) => {
        await progress({ phase: "started", provider: "Exa" });
        await progress({ phase: "finished", provider: "exa-mcp", state: "SEARCH_SUCCESS_ZERO_RESULTS" });
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "exa-mcp", lineage: [] };
      },
      ingest: async () => assert.fail("there are no candidate documents"),
      stopRequested: async () => false,
      saveDocument: async () => assert.fail("there are no candidate documents"),
      saveReceipt: async (next) => {
        stages.push(next.stage);
      },
    });
    assert.equal(result.searchAnswered, true);
    assert.equal(stages.at(-1), "Finished · no relevant public document found");
  });

  it("mentions a failed provider when other searches did run", async () => {
    const stages: string[] = [];
    await runPullPipeline(zeroHits(), {
      search: async (_query, progress) => {
        await progress({ phase: "started", provider: "Exa" });
        await progress({
          phase: "finished",
          provider: "exa-mcp",
          state: "SEARCH_BLOCKED",
          error: "HTTP 429",
        });
        await progress({ phase: "started", provider: "DuckDuckGo" });
        await progress({ phase: "finished", provider: "ddg-html", state: "SEARCH_SUCCESS_ZERO_RESULTS" });
        return { state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "ddg-html", lineage: [] };
      },
      ingest: async () => assert.fail("there are no candidate documents"),
      stopRequested: async () => false,
      saveDocument: async () => assert.fail("there are no candidate documents"),
      saveReceipt: async (next) => {
        stages.push(next.stage);
      },
    });
    const final = stages.at(-1) ?? "";
    assert.match(final, /failed · some searches could not be completed/i);
    assert.doesNotMatch(final, /no relevant public document found/i);
    assert.match(final, /Exa: rate limited/);
  });

  it("guesses no pages when neither the story nor the hits name an official site", async () => {
    const stages: string[] = [];
    const opened: string[] = [];
    const result = await runPullPipeline(
      zeroHits({
        indexPagesPrepared: false,
        indexPages: [],
        storyUrls: ["https://en.m.wikipedia.org/wiki/Longmont", "https://m.imdb.com/title/tt1"],
        officialHosts: [],
      }),
      {
        search: async () => ({
          state: "SEARCH_SUCCESS_RESULTS",
          hits: [{ title: "Rental listings", url: "https://whitepalmapts.com/", snippet: "" }],
          provider: "exa-mcp",
        }),
        ingest: async (url) => {
          opened.push(url);
          return document(url);
        },
        stopRequested: async () => false,
        saveDocument: async () => assert.fail("no page of an unofficial host may be saved"),
        saveReceipt: async (next) => {
          stages.push(next.stage);
        },
      },
    );
    assert.deepEqual(opened, [], "Wikipedia, IMDb and the rental site are not guessed");
    assert.equal(result.counters.indexPagesChecked, 0);
    assert.ok(
      stages.some((stage) => /names no official site/.test(stage)),
      `the run says why: ${stages.join(" | ")}`,
    );
  });

  it("guesses pages on an official host from the story's own links", async () => {
    const opened: string[] = [];
    await runPullPipeline(
      zeroHits({
        indexPagesPrepared: false,
        indexPages: [],
        storyUrls: ["https://www.longmontcolorado.gov/records"],
        officialHosts: [],
      }),
      {
        search: async () => ({ state: "SEARCH_SUCCESS_ZERO_RESULTS", hits: [], provider: "exa-mcp" }),
        ingest: async (url) => {
          opened.push(url);
          return document(url);
        },
        stopRequested: async () => false,
        saveDocument: async () => assert.fail("the index pages carry no records"),
        saveReceipt: async () => undefined,
      },
    );
    assert.deepEqual(opened, [
      "https://www.longmontcolorado.gov/meetings",
      "https://www.longmontcolorado.gov/meetings/",
      "https://www.longmontcolorado.gov/board-meetings",
    ]);
  });

  it("stops immediately when every provider is cooling, and fetches nothing", async () => {
    const stages: string[] = [];
    const result = await runPullPipeline(
      zeroHits({
        indexPagesPrepared: false,
        indexPages: [],
        storyUrls: ["https://www.longmontcolorado.gov/records"],
        officialHosts: [],
      }),
      {
        search: async (_query, progress) => {
          await progress({ phase: "skipped", provider: "Exa", error: "blocked 2 minutes ago" });
          await progress({ phase: "skipped", provider: "DuckDuckGo", error: "blocked 2 minutes ago" });
          return {
            state: "SEARCH_SUCCESS_ZERO_RESULTS",
            hits: [],
            provider: "none",
            lineage: [],
            allProvidersCooling: true,
            skippedProviders: [
              { provider: "Exa", note: "blocked 2 minutes ago" },
              { provider: "DuckDuckGo", note: "blocked 2 minutes ago" },
            ],
          };
        },
        ingest: async () => assert.fail("nothing may be fetched while every provider is cooling"),
        stopRequested: async () => false,
        saveDocument: async () => assert.fail("nothing may be saved"),
        saveReceipt: async (next) => {
          stages.push(next.stage);
        },
      },
    );
    assert.equal(result.status, "failed");
    assert.match(stages.at(-1) ?? "", /search is unavailable/i);
    assert.ok(
      stages.some((stage) => /skipped, blocked 2 minutes ago/.test(stage)),
      `the run line says which provider was skipped: ${stages.join(" | ")}`,
    );
  });
});
