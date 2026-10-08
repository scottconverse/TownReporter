import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { getPaperConfig } from "./paper-settings.ts";
import { ingestDocument, type IngestDocument } from "./ingest.ts";
import {
  searchWithFallback,
  type SearchAttempt,
  type SearchProgressEvent,
  type WebHit,
} from "./search-web.ts";
import { dropListingUrls, namedSubjects, preferPrimaryUrls } from "./extract.ts";
import { researchScopeOf } from "./research-scope.ts";
import { sanitizePublicUrls } from "./schema.ts";
import {
  appendScratch,
  formatPullDump,
  packNotes,
  parseNotes,
  selectExcerpt,
  toggleTodo,
  type NoteTodo,
  type ReportingNotes,
} from "./notes.ts";
import {
  docCandidateHosts,
  docIndexPages,
  isOnSubject,
  pullQueries,
  siteOwnDocLinks,
} from "./pull-plan.ts";
import { officialDomainsEvery } from "./absence-gate.ts";
import { pullFailureCopy } from "./desk-copy.ts";
import {
  finalPullText,
  isPullTodoReason,
  providerFailureNotes,
  pullTodoReason,
  type ProviderFailure,
  type ProviderFailureNote,
} from "./pull-outcome.ts";
import { audit } from "./ops.ts";
import { pctFor, progressReporterFor, throwIfJobCancelled, type DeskJob } from "./jobs.ts";

export const PULL_RUN_DEADLINE_MS = 120_000;

export type PullCounters = {
  searchesAttempted: number;
  providersAttempted: number;
  indexPagesChecked: number;
  documentsOpened: number;
  documentsSaved: number;
  offSubject: number;
  failures: number;
};

export type PulledDocument = { title: string; url: string; excerpt: string };

export type PullCheckpoint = {
  city: string;
  state: string;
  subjects: string[];
  queries: string[];
  queryIndex: number;
  /** Results are written before the cursor advances, so a crash between the
   * network response and the cursor update does not repeat a completed search. */
  queryResults?: Array<WebHit[] | null>;
  hits: WebHit[];
  storyUrls: string[];
  /**
   * The paper's own official or registered hosts (`absence-gate`'s
   * `officialDomains` over the watch list), the only non-government hosts an
   * index page may be guessed on. See `isOfficialDocHost`.
   */
  officialHosts?: string[];
  indexPagesPrepared: boolean;
  indexPages: string[];
  indexPageIndex: number;
  /** Same two-phase checkpoint as queryResults, for official index pages. */
  indexPageResults?: Array<string[] | null>;
  indexedUrls: string[];
  rankedPrepared: boolean;
  rankedUrls: string[];
  documentIndex: number;
  /** A terminal outcome prevents a candidate fetch from being repeated after
   * its result was durably recorded. The saved document itself remains the
   * source of truth for the `saved` outcome. */
  documentOutcomes?: Array<"saved" | "off-subject" | "failed" | null>;
  documents: PulledDocument[];
};

export type PullReceipt = {
  type: "pull";
  version: 1;
  attemptId: string;
  leadId: number;
  todoIndex: number | null;
  /**
   * 0.6.74: the one page a claim's Pull reads. When it is set the run opens
   * exactly this URL instead of searching, so `todoIndex` is null and
   * `finishPullTodo` is skipped -- a claim lives in `notes.found`, not in the
   * reporting lines, and there is no to-do to strike.
   */
  sourceUrl?: string | null;
  query: string;
  status: "queued" | "running" | "completed" | "stopped" | "deadline" | "failed";
  stage: string;
  stopRequested: boolean;
  counters: PullCounters;
  errors: string[];
  /**
   * Point 1: which providers refused and why, kept in the shape the editor's
   * words are made from. The raw strings stay in `errors` for support; this is
   * what the closing sentence and the Still-to-pull mark are computed from.
   */
  providerFailures?: ProviderFailure[];
  /** True once a provider really answered a query, even with zero results. */
  searchAnswered?: boolean;
  /** Source reads that failed; kept apart from searches that ran and found nothing. */
  readFailures?: Array<{ url: string; reason: string }>;
  checkpoint?: PullCheckpoint;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type PullRunView = {
  jobId: number;
  leadId: number;
  todoIndex: number | null;
  /** The claim's source page for a 0.6.74 claim Pull, else null. */
  sourceUrl: string | null;
  query: string;
  jobStatus: "queued" | "running" | "completed" | "failed";
  status: PullReceipt["status"];
  stage: string;
  stopRequested: boolean;
  counters: PullCounters;
  errors: string[];
  /** Plain-words provider reasons for the run box (point 1). */
  providerNotes: ProviderFailureNote[];
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

const EMPTY_COUNTERS: PullCounters = {
  searchesAttempted: 0,
  providersAttempted: 0,
  indexPagesChecked: 0,
  documentsOpened: 0,
  documentsSaved: 0,
  offSubject: 0,
  failures: 0,
};

export function newPullReceipt(input: {
  leadId: number;
  todoIndex?: number;
  sourceUrl?: string | null;
  query: string;
  attemptId?: string;
}): PullReceipt {
  const now = new Date().toISOString();
  return {
    type: "pull",
    version: 1,
    attemptId: input.attemptId ?? crypto.randomUUID(),
    leadId: input.leadId,
    todoIndex: typeof input.todoIndex === "number" ? input.todoIndex : null,
    sourceUrl: input.sourceUrl ?? null,
    query: input.query.trim().slice(0, 240),
    status: "queued",
    stage: "Queued",
    stopRequested: false,
    counters: { ...EMPTY_COUNTERS },
    errors: [],
    providerFailures: [],
    searchAnswered: false,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
  };
}

export function parsePullReceipt(raw: string | null | undefined): PullReceipt | null {
  try {
    const value = JSON.parse(raw || "{}") as Partial<PullReceipt>;
    if (value.type !== "pull" || value.version !== 1 || !Number.isInteger(value.leadId))
      return null;
    const base = newPullReceipt({
      leadId: Number(value.leadId),
      todoIndex: typeof value.todoIndex === "number" ? value.todoIndex : undefined,
      query: String(value.query ?? ""),
      attemptId:
        typeof value.attemptId === "string" && value.attemptId
          ? value.attemptId
          : `legacy-${Number(value.leadId)}-${String(value.updatedAt ?? "unknown")}`,
    });
    return {
      ...base,
      ...value,
      counters: { ...EMPTY_COUNTERS, ...(value.counters ?? {}) },
      errors: Array.isArray(value.errors) ? value.errors.map(String).slice(-16) : [],
      providerFailures: Array.isArray(value.providerFailures)
        ? value.providerFailures
            .map((row) => ({
              provider: String(row?.provider ?? ""),
              state: String(row?.state ?? ""),
              error: row?.error == null ? undefined : String(row.error),
            }))
            .filter((row) => row.provider)
            .slice(-16)
        : [],
      searchAnswered: value.searchAnswered === true,
      readFailures: Array.isArray(value.readFailures)
        ? value.readFailures
            .map((row) => ({ url: String(row?.url ?? ""), reason: String(row?.reason ?? "") }))
            .filter((row) => row.url && row.reason)
            .slice(-16)
        : [],
      sourceUrl: typeof value.sourceUrl === "string" && value.sourceUrl ? value.sourceUrl : null,
    } as PullReceipt;
  } catch {
    return null;
  }
}

function addFailure(receipt: PullReceipt, message: string) {
  const clean = message.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return;
  receipt.errors = [...receipt.errors, clean].slice(-16);
  receipt.counters.failures += 1;
}

function addReadFailure(receipt: PullReceipt, url: string, reason: string) {
  const clean = reason.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return;
  receipt.readFailures = [...(receipt.readFailures ?? []), { url, reason: clean }].slice(-16);
}

class PullDeadlineError extends Error {}

async function withinDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number,
  now: () => number,
) {
  const remaining = deadlineAt - now();
  if (remaining <= 0) throw new PullDeadlineError("Pull reached its two-minute limit.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new PullDeadlineError("Pull reached its two-minute limit."));
          controller.abort("Pull reached its two-minute limit.");
        }, remaining);
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type PullPipelineDeps = {
  now?: () => number;
  deadlineMs?: number;
  search: (
    query: string,
    progress: (event: SearchProgressEvent) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<SearchAttempt>;
  ingest: (url: string, signal?: AbortSignal) => Promise<IngestDocument>;
  saveReceipt: (receipt: PullReceipt) => Promise<void>;
  /*
    Mirrors the receipt's stage onto the JOB row. Without it a Pull's `beat_at`
    is written once when the queue claims the row and never again, so every pull
    longer than a minute reads as stalled (redesign phase 3) -- the receipt
    stage exists at these boundaries already and the desk just was not being
    told about it. Optional so the pipeline's own tests need not supply a job.
  */
  /**
   * FB1: the second argument is the pull's percentage. Optional, so every
   * existing stub and caller keeps compiling and working unchanged.
   */
  reportStage?: (stage: string, pct?: number | null) => Promise<void>;
  /*
    The desk's Cancel, as a check the caller owns: this pipeline has no job row
    of its own to read (`runPullPipeline` is driven by receipts, and its tests
    build no job), so `performPullWork` supplies `throwIfJobCancelled`. Called
    at each query boundary -- the same place `stopRequested` is, and distinct
    from it: that one ends a finished pull, this one ends a stopped job.
  */
  assertNotCancelled?: () => Promise<void>;
  stopRequested: () => Promise<boolean>;
  saveDocument: (document: PulledDocument, receipt: PullReceipt) => Promise<void>;
};

/**
 * Resumable mechanical Pull pipeline. Every index is advanced only after its
 * network step has returned, and the receipt is saved at each boundary. A new
 * job can therefore continue the same receipt without repeating completed
 * searches, index pages, or candidate documents.
 */
export async function runPullPipeline(
  receipt: PullReceipt & { checkpoint: PullCheckpoint },
  deps: PullPipelineDeps,
): Promise<PullReceipt> {
  const now = deps.now ?? Date.now;
  const deadlineAt = now() + (deps.deadlineMs ?? PULL_RUN_DEADLINE_MS);
  receipt.readFailures = [];
  receipt.status = "running";
  receipt.startedAt = receipt.startedAt ?? new Date(now()).toISOString();
  let terminal = false;

  const save = async (stage: string, pct?: number | null) => {
    // A provider callback can arrive after withinDeadline() has returned.
    // Never let that late callback overwrite a terminal deadline/stop receipt.
    if (terminal) return;
    receipt.stage = stage;
    receipt.updatedAt = new Date(now()).toISOString();
    await deps.saveReceipt(receipt);
    await deps.reportStage?.(stage, pct);
  };
  /*
    FB1: Pull already knew every denominator -- it prints "Searching 2 of 6" on
    the step line -- so the percentage is read off the same numbers rather than
    a second count kept alongside them.

    Three phases, each a third of the bar: the searches, the official document
    pages, then the candidate documents. `within` is capped at 1 so a phase that
    runs past its own list (a resumed run, a break at the 12-page cap) cannot
    push the bar into the next phase's territory, and the phases run in a fixed
    order, so the bar only ever moves forwards.
  */
  const phasePct = (phase: 0 | 1 | 2, done: number, total: number) =>
    pctFor(phase + (total > 0 ? Math.min(1, done / total) : 0), 3);
  const checkpoint = receipt.checkpoint;
  const queryResults = (checkpoint.queryResults ??= []);
  const indexPageResults = (checkpoint.indexPageResults ??= []);
  const documentOutcomes = (checkpoint.documentOutcomes ??= []);
  const fillMarkers = <T>(markers: Array<T | null>, length: number) => {
    while (markers.length < length) markers.push(null);
  };
  fillMarkers(queryResults, checkpoint.queries.length);
  const addUnique = (target: string[], values: string[]) => {
    const seen = new Set(target);
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value);
        target.push(value);
      }
    }
  };
  const shouldStop = async () => {
    if (await deps.stopRequested()) {
      receipt.stopRequested = true;
      return true;
    }
    return false;
  };
  const stoppedStage = (reason: "editor" | "deadline") =>
    `${reason === "deadline" ? "Stopped after 2 minutes" : "Stopped by editor"} · ` +
    `${receipt.counters.searchesAttempted} searches attempted · ` +
    `${receipt.counters.indexPagesChecked} index pages checked · ` +
    `${receipt.counters.documentsOpened} documents opened · ` +
    `${receipt.checkpoint.documents.length} documents saved`;
  const finish = async (status: "completed" | "stopped" | "deadline" | "failed", stage: string) => {
    terminal = true;
    receipt.status = status;
    receipt.stage = stage;
    receipt.counters.documentsSaved = receipt.checkpoint.documents.length;
    receipt.finishedAt = new Date(now()).toISOString();
    receipt.updatedAt = receipt.finishedAt;
    await deps.saveReceipt(receipt);
    return receipt;
  };

  /*
    0.6.74: a claim's Pull names one page, so there is no search to run, no
    candidate to rank and nothing for the two-minute deadline to cut short
    beyond the single fetch. This branch reads exactly the page the editor
    pointed at and finishes.

    Two deliberate differences from the search path. `isOnSubject` is not
    applied: the editor aimed at this page, and a claim's support is the page
    itself, not a subject match the desk guessed. And `deps.ingest` is still
    `ingestDocument`, so the URL guard, the redirect handling and the OCR
    refusal are the same code an ordinary Pull runs -- a claim Pull can no more
    reach a private address than a search Pull can.
  */
  if (receipt.sourceUrl) {
    const sourceUrl = receipt.sourceUrl;
    await save("Opening the source page");
    /*
      B8B item 2: the claim branch had no cancel check at all.

      The search path asks at every durable boundary (the loop below), but a
      claim's Pull names exactly one page and finishes, so the boundary it
      needed was this one -- and it was the only one there is. An editor who
      pressed Cancel on a claim Pull watched the fetch open the page anyway,
      and a Cancel that arrives before the first byte was answered with a
      document rather than with "Cancelled by the editor".

      Outside the `try` on purpose: the catch below turns a thrown error into a
      failure line against the source, which would file a cancellation as "could
      not open <url>" -- the silent failure this unit exists to remove. Here the
      JobCancelledError leaves the pipeline and `performPullWork`'s caller ends
      the row cancelled, with the reason the desk wrote.
    */
    await deps.assertNotCancelled?.();
    try {
      const got = await withinDeadline((signal) => deps.ingest(sourceUrl, signal), deadlineAt, now);
      receipt.counters.documentsOpened += 1;
      if (!got.text || got.text.trim().length < 40) {
        const reason = `${got.outcome || "no usable text"}${got.status ? ` (HTTP ${got.status})` : ""}`;
        addFailure(receipt, `${sourceUrl}: ${reason}`);
        if (["fetch-failed", "parse-failed", "needs-ocr"].includes(got.outcome))
          addReadFailure(receipt, sourceUrl, reason);
      } else {
        const document = {
          title: (got.title || sourceUrl).slice(0, 160),
          url: sourceUrl,
          excerpt: selectExcerpt(got.text, receipt.query),
        };
        await deps.saveDocument(document, receipt);
        receipt.checkpoint.documents.push(document);
        receipt.counters.documentsSaved = receipt.checkpoint.documents.length;
      }
    } catch (error) {
      if (error instanceof PullDeadlineError) return finish("deadline", stoppedStage("deadline"));
      const reason = error instanceof Error ? error.message : "could not open";
      addFailure(receipt, `${sourceUrl}: ${reason}`);
      addReadFailure(receipt, sourceUrl, reason);
    }
    if (!receipt.checkpoint.documents.length && receipt.readFailures?.length) {
      const failed = receipt.readFailures[0]!;
      return finish("failed", pullFailureCopy(failed.reason, failed.url));
    }
    return finish(
      "completed",
      receipt.checkpoint.documents.length
        ? "Finished · the source page is in the box under the story"
        : "Finished · the source page gave no usable text",
    );
  }

  await save("Preparing the searches");
  await save(`Preparing ${receipt.checkpoint.queries.length} searches`);
  try {
    await save("Searching the public record", phasePct(0, 0, receipt.checkpoint.queries.length));
    while (receipt.checkpoint.queryIndex < receipt.checkpoint.queries.length) {
      if (await shouldStop()) {
        return finish("stopped", stoppedStage("editor"));
      }
      await deps.assertNotCancelled?.();
      const current = receipt.checkpoint.queryIndex;
      const query = receipt.checkpoint.queries[current]!;
      if (queryResults[current] != null) {
        receipt.checkpoint.queryIndex += 1;
        await save(`Resumed after search ${current + 1} of ${receipt.checkpoint.queries.length}`);
        continue;
      }
      receipt.counters.searchesAttempted += 1;
      await save(
        `Searching ${current + 1} of ${receipt.checkpoint.queries.length}`,
        phasePct(0, current + 1, receipt.checkpoint.queries.length),
      );
      try {
        const attempt = await withinDeadline(
          (signal) =>
            deps.search(
              query,
              async (event) => {
                if (terminal) return;
                if (event.phase === "started") {
                  receipt.counters.providersAttempted += 1;
                  await save(
                    `Searching ${current + 1} of ${receipt.checkpoint!.queries.length} · ${event.provider}`,
                  );
                } else if (event.phase === "skipped") {
                  // Inside its cooldown: no request was made, and the run line
                  // says which provider and how long ago it was blocked. It is
                  // still a provider that could not be asked, so it is recorded
                  // with the other failures -- otherwise a pull that skipped
                  // every provider would close as if the searches had run.
                  receipt.providerFailures = [
                    ...(receipt.providerFailures ?? []),
                    {
                      provider: event.provider,
                      state: "SEARCH_BLOCKED",
                      error: event.error ?? "blocked a moment ago",
                    },
                  ].slice(-16);
                  await save(
                    `Searching ${current + 1} of ${receipt.checkpoint!.queries.length} · ${event.provider} skipped, ${event.error ?? "blocked a moment ago"}`,
                  );
                } else if (
                  event.state === "SEARCH_TIMEOUT" ||
                  event.state === "SEARCH_FAILED_NETWORK" ||
                  event.state === "SEARCH_FAILED_PARSE" ||
                  event.state === "SEARCH_BLOCKED" ||
                  event.state === "SEARCH_FAILED_PROVIDER"
                ) {
                  /*
                    Two records of one failure. `errors` is the support copy,
                    raw ("exa-mcp: HTTP 429"); `providerFailures` is what the
                    editor's sentence is built from, so a pull that only failed
                    cannot close with "no relevant public document found".
                  */
                  addFailure(receipt, `${event.provider}: ${event.error || event.state}`);
                  receipt.providerFailures = [
                    ...(receipt.providerFailures ?? []),
                    { provider: event.provider, state: event.state ?? "", error: event.error },
                  ].slice(-16);
                  await save(
                    `Searching ${current + 1} of ${receipt.checkpoint!.queries.length} · ${event.provider} failed, trying the next source`,
                  );
                } else if (event.state?.startsWith("SEARCH_SUCCESS")) {
                  receipt.searchAnswered = true;
                }
              },
              signal,
            ),
          deadlineAt,
          now,
        );
        receipt.checkpoint.hits.push(...attempt.hits);
        // Persist the completed result while queryIndex still points at this
        // query. A restart can recognize the result and advance without
        // calling the provider again.
        queryResults[current] = attempt.hits;
        await save(`Saved search ${current + 1} of ${receipt.checkpoint.queries.length}`);
        /*
          Every provider is cooling, so the next query would ask the same
          blocked providers again and the index pages below would fetch pages
          for a search that never ran. Finish now, with the same honest
          sentence, and make no further request.
        */
        if (attempt.allProvidersCooling) {
          return finish(
            "failed",
            finalPullText({
              documents: 0,
              failures: providerFailureNotes(receipt.providerFailures ?? []),
              answered: receipt.searchAnswered === true,
            }),
          );
        }
      } catch (error) {
        if (error instanceof PullDeadlineError) throw error;
        addFailure(
          receipt,
          `Search ${current + 1}: ${error instanceof Error ? error.message : "failed"}`,
        );
        queryResults[current] = [];
        await save(`Saved failed search ${current + 1} of ${receipt.checkpoint.queries.length}`);
      }
      receipt.checkpoint.queryIndex += 1;
      await save(`Finished search ${current + 1} of ${receipt.checkpoint.queries.length}`);
    }

    if (!receipt.checkpoint.indexPagesPrepared) {
      const registered = receipt.checkpoint.officialHosts ?? [];
      const hosts = docCandidateHosts(
        receipt.checkpoint.hits.map((hit) => hit.url),
        receipt.checkpoint.storyUrls,
        registered,
      );
      receipt.checkpoint.indexPages = docIndexPages(hosts, 3, registered);
      receipt.checkpoint.indexPagesPrepared = true;
      fillMarkers(indexPageResults, receipt.checkpoint.indexPages.length);
      await save("Checking official document pages", phasePct(1, 0, receipt.checkpoint.indexPages.length));
      /*
        Nothing official to read. Say so rather than reporting "0 of 0" as if
        pages had been tried and come back empty -- the story, not the search,
        is why no page was guessed.
      */
      await save(
        receipt.checkpoint.indexPages.length
          ? `Checking official document pages · 0 of ${receipt.checkpoint.indexPages.length}`
          : "Checking official document pages · none — the story names no official site, so no pages were guessed",
      );
    }
    fillMarkers(indexPageResults, receipt.checkpoint.indexPages.length);

    while (receipt.checkpoint.indexPageIndex < receipt.checkpoint.indexPages.length) {
      if (receipt.checkpoint.indexedUrls.length >= 12) break;
      if (await shouldStop()) {
        return finish("stopped", stoppedStage("editor"));
      }
      const current = receipt.checkpoint.indexPageIndex;
      const page = receipt.checkpoint.indexPages[current]!;
      if (indexPageResults[current] != null) {
        addUnique(receipt.checkpoint.indexedUrls, indexPageResults[current] ?? []);
        receipt.checkpoint.indexPageIndex += 1;
        await save(
          `Resumed after official document page ${current + 1} of ${receipt.checkpoint.indexPages.length}`,
        );
        continue;
      }
      receipt.counters.indexPagesChecked += 1;
      await save(
        `Checking official document pages · ${current + 1} of ${receipt.checkpoint.indexPages.length}`,
        phasePct(1, current + 1, receipt.checkpoint.indexPages.length),
      );
      try {
        const got = await withinDeadline((signal) => deps.ingest(page, signal), deadlineAt, now);
        const links = siteOwnDocLinks(got.extras, page);
        indexPageResults[current] = links;
        addUnique(receipt.checkpoint.indexedUrls, links);
        if (!got.ok && got.outcome !== "fetched") {
          addFailure(receipt, `${page}: ${got.outcome}${got.status ? ` (${got.status})` : ""}`);
          if (["fetch-failed", "parse-failed", "needs-ocr"].includes(got.outcome))
            addReadFailure(receipt, page, `${got.outcome}${got.status ? ` (HTTP ${got.status})` : ""}`);
        }
      } catch (error) {
        if (error instanceof PullDeadlineError) throw error;
        addFailure(
          receipt,
          `${page}: ${error instanceof Error ? error.message : "could not open"}`,
        );
        addReadFailure(receipt, page, error instanceof Error ? error.message : "could not open");
        indexPageResults[current] = [];
      }
      await save(
        `Saved official document page ${current + 1} of ${receipt.checkpoint.indexPages.length}`,
      );
      receipt.checkpoint.indexPageIndex += 1;
      await save(
        `Checked official document page ${current + 1} of ${receipt.checkpoint.indexPages.length}`,
      );
    }

    if (!receipt.checkpoint.rankedPrepared) {
      receipt.checkpoint.rankedUrls = preferPrimaryUrls(
        [
          ...new Set([
            ...receipt.checkpoint.indexedUrls,
            ...receipt.checkpoint.hits.map((hit) => hit.url),
          ]),
        ],
        receipt.checkpoint.subjects,
      ).slice(0, 8);
      receipt.checkpoint.rankedPrepared = true;
      fillMarkers(documentOutcomes, receipt.checkpoint.rankedUrls.length);
      await save("Opening candidate documents", phasePct(2, 0, receipt.checkpoint.rankedUrls.length));
      await save(`Opening candidate documents · 0 of ${receipt.checkpoint.rankedUrls.length}`);
    }
    fillMarkers(documentOutcomes, receipt.checkpoint.rankedUrls.length);

    while (
      receipt.checkpoint.documentIndex < receipt.checkpoint.rankedUrls.length &&
      receipt.checkpoint.documents.length < 4
    ) {
      if (await shouldStop()) {
        return finish("stopped", stoppedStage("editor"));
      }
      const current = receipt.checkpoint.documentIndex;
      const url = receipt.checkpoint.rankedUrls[current]!;
      if (documentOutcomes[current] != null) {
        receipt.checkpoint.documentIndex += 1;
        await save(
          `Resumed after candidate ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
        );
        continue;
      }
      receipt.counters.documentsOpened += 1;
      await save(
        `Opening candidate document · ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
        phasePct(2, current + 1, receipt.checkpoint.rankedUrls.length),
      );
      try {
        const got = await withinDeadline((signal) => deps.ingest(url, signal), deadlineAt, now);
        await save(
          got.extractionMethod
            ? `Extracted ${got.extractionMethod} · candidate ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`
            : `Read candidate document ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
        );
        if (!got.text || got.text.trim().length < 40) {
          const reason = `${got.outcome || "no usable text"}${got.status ? ` (HTTP ${got.status})` : ""}`;
          addFailure(receipt, `${url}: ${reason}`);
          if (["fetch-failed", "parse-failed", "needs-ocr"].includes(got.outcome))
            addReadFailure(receipt, url, reason);
          documentOutcomes[current] = "failed";
        } else if (
          !isOnSubject(
            got.text,
            receipt.checkpoint.subjects,
            receipt.checkpoint.city,
            receipt.checkpoint.state,
          )
        ) {
          receipt.counters.offSubject += 1;
          documentOutcomes[current] = "off-subject";
        } else {
          const document = {
            title: (got.title || url).slice(0, 160),
            url,
            excerpt: selectExcerpt(got.text, receipt.query),
          };
          await deps.saveDocument(document, receipt);
          receipt.checkpoint.documents.push(document);
          receipt.counters.documentsSaved = receipt.checkpoint.documents.length;
          documentOutcomes[current] = "saved";
          await save(
            `Saved ${receipt.counters.documentsSaved} relevant document${receipt.counters.documentsSaved === 1 ? "" : "s"}`,
          );
        }
      } catch (error) {
        if (error instanceof PullDeadlineError) throw error;
        const reason = error instanceof Error ? error.message : "could not open";
        addFailure(receipt, `${url}: ${reason}`);
        addReadFailure(receipt, url, reason);
        documentOutcomes[current] = "failed";
      }
      await save(
        `Saved candidate result ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
      );
      receipt.checkpoint.documentIndex += 1;
      await save(`Checked candidate ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`);
    }

    // The last arrival: everything the pull found is written under the story
    // here, and on a slow disk that is long enough to be worth a chip.
    await save("Saving the documents", phasePct(2, 1, 1));
    /*
      The closing sentence is computed from what the providers actually did. A
      pull where nothing answered and providers refused is "search is
      unavailable", not "no relevant public document found" -- the old sentence
      told three of Scott's pulls that the record did not exist when in fact
      nobody had been asked.
    */
    const providerNotes = providerFailureNotes(receipt.providerFailures ?? []);
    if (!receipt.checkpoint.documents.length && receipt.readFailures?.length) {
      const failed = receipt.readFailures[0]!;
      const failedUrls = new Set(receipt.readFailures.map((failure) => failure.url));
      const failedIndex = checkpoint.indexPages.findIndex((url) => failedUrls.has(url));
      if (failedIndex >= 0) {
        checkpoint.indexPageIndex = failedIndex;
        checkpoint.indexPages.forEach((url, index) => {
          if (failedUrls.has(url)) indexPageResults[index] = null;
        });
        // A retried index may discover candidates missing from the previous ranking.
        checkpoint.rankedPrepared = false;
        checkpoint.documentIndex = 0;
        checkpoint.rankedUrls = [];
        documentOutcomes.length = 0;
      } else {
        const failedDocument = documentOutcomes.indexOf("failed");
        if (failedDocument >= 0) {
          checkpoint.documentIndex = failedDocument;
          documentOutcomes.forEach((outcome, index) => {
            if (outcome === "failed") documentOutcomes[index] = null;
          });
        }
      }
      return finish("failed", pullFailureCopy(failed.reason, failed.url));
    }
    const hasSearchFailure = providerNotes.length > 0;
    return finish(
      hasSearchFailure && !receipt.checkpoint.documents.length ? "failed" : "completed",
      finalPullText({
        documents: receipt.checkpoint.documents.length,
        failures: providerNotes,
        answered: receipt.searchAnswered === true,
      }),
    );
  } catch (error) {
    if (error instanceof PullDeadlineError) {
      return finish("deadline", stoppedStage("deadline"));
    }
    throw error;
  }
}

/**
 * ACCESS EXCLUSIVE on `leads` when it runs, so once per database rather than
 * once per pull; see `paper-settings-read-lock.test.ts`.
 */
export async function ensurePullLeadMemoSchema(): Promise<void> {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "pull-lead-memo-column", [
    "alter table leads add column if not exists notes_json text not null default '{}'",
  ]);
}

async function loadPullContext(job: DeskJob, receipt: PullReceipt): Promise<PullCheckpoint> {
  const sql = await getSql();
  await ensurePullLeadMemoSchema();
  const rows = await sql<{ notes_json: string | null; headline: string; source_urls: string }>`
    select notes_json, headline, source_urls from leads
    where id = ${receipt.leadId} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  if (!rows[0]) throw new Error("Lead not found");
  const paper = await getPaperConfig(job.newsroom_id);
  const memo = parseNotes(rows[0].notes_json);
  const subjects = namedSubjects(
    [rows[0].headline, memo.news, memo.angle, memo.why, receipt.query].filter(Boolean).join("\n"),
    researchScopeOf(paper),
  );
  const watched = await sql<{ url: string; tier: string | null }>`
    select url, tier from sources where newsroom_id = ${job.newsroom_id}
  `;
  /*
    The hosts a guessed index page may be fetched from, beyond government
    addresses: the paper's own registered sources. The Sources desk's Tier A
    rows are taken at their word, and anything else has to be a `.gov`/`.us`
    address carrying the city's name (see `officialDomains`'s note; the local
    newspaper is not the city).

    `officialDomainsEvery`, not `officialDomains`: the latter ends in
    `.slice(0, 4)`, which is right for the claims-of-absence ladder and wrong
    here. On a newsroom with more than four Tier A sources the fifth host was
    rejected as a document candidate even though the operator had registered it.
    Every registered host is eligible; the separate three-host cap on the pages
    actually fetched stays where it is, in `docIndexPages`.
  */
  const officialHosts = officialDomainsEvery(
    paper.city,
    watched.map((row) => row.url),
    watched.filter((row) => (row.tier ?? "").toUpperCase() === "A").map((row) => row.url),
  );
  const draft = await sql<{ source_urls: string }>`
    select source_urls from drafts
    where lead_id = ${receipt.leadId} and user_id = ${job.user_id}
    order by updated_at desc limit 1
  `;
  const storyUrls: string[] = [];
  for (const raw of [draft[0]?.source_urls, rows[0].source_urls]) {
    if (!raw) continue;
    try {
      storyUrls.push(
        ...dropListingUrls(
          sanitizePublicUrls(JSON.parse(raw)),
          watched.map((row) => row.url),
          true,
        ),
      );
    } catch {
      // A malformed legacy URL list contributes nothing; the pull still runs.
    }
  }
  return {
    city: paper.city,
    state: paper.state,
    subjects,
    queries: pullQueries(receipt.query, subjects, paper.city),
    queryIndex: 0,
    hits: [],
    storyUrls,
    officialHosts,
    indexPagesPrepared: false,
    indexPages: [],
    indexPageIndex: 0,
    indexPageResults: [],
    indexedUrls: [],
    rankedPrepared: false,
    rankedUrls: [],
    documentIndex: 0,
    documentOutcomes: [],
    documents: [],
  };
}

async function saveJobReceipt(job: DeskJob, receipt: PullReceipt) {
  const sql = await getSql();
  await sql.query(
    `update desk_jobs
     set result_json = jsonb_set($1::jsonb, '{stopRequested}', coalesce(result_json::jsonb -> 'stopRequested', 'false'::jsonb))::text,
         stage = $2, updated_at = now()
     where id = $3 and claim_token = $4 and status = 'running'`,
    [JSON.stringify(receipt), receipt.stage.slice(0, 500), job.id, job.claim_token],
  );
}

async function jobStopRequested(job: DeskJob) {
  const sql = await getSql();
  const rows = await sql<{ stop: boolean }>`
    select coalesce((result_json::jsonb ->> 'stopRequested')::boolean, false) as stop
    from desk_jobs where id = ${job.id} limit 1
  `;
  return Boolean(rows[0]?.stop);
}

/**
 * A Pull can outlive the process that started it: the job runner may reclaim a
 * stale row while the old worker is still unwinding a fetch. Hold the lead row
 * and the job row together while mutating newsroom notes, and require both the
 * active claim and current editor membership. This keeps a stale worker from
 * appending documents or striking a reporting line after its lease is gone.
 */
async function withClaimedLeadMutation<T>(
  job: Pick<DeskJob, "id" | "newsroom_id" | "user_id" | "claim_token">,
  leadId: number,
  run: (sql: Sql, notesJson: string | null) => Promise<T>,
): Promise<T> {
  if (!job.claim_token) throw new Error("Pull job has no active claim.");
  return withTransaction(async (sql) => {
    const [ownedJob] = await sql<{ id: number }>`
      select id from desk_jobs
      where id = ${job.id} and newsroom_id = ${job.newsroom_id}
        and status = 'running' and claim_token = ${job.claim_token}
      for update
    `;
    if (!ownedJob) throw new Error("Pull job lease was lost before notes could be saved.");
    const [member] = await sql<{ user_id: string }>`
      select user_id from newsroom_members
      where newsroom_id = ${job.newsroom_id} and user_id = ${job.user_id}
        and role in ('owner', 'editor')
      for share
    `;
    if (!member) throw new Error("Pull permission was withdrawn before notes could be saved.");
    const [lead] = await sql<{ notes_json: string | null }>`
      select notes_json from leads
      where id = ${leadId} and newsroom_id = ${job.newsroom_id}
      for update
    `;
    if (!lead) throw new Error("Lead not found while saving Pull results.");
    return run(sql, lead.notes_json);
  });
}

export function appendPulledDocument(
  notes: ReportingNotes,
  query: string,
  document: PulledDocument,
): ReportingNotes {
  const marker = `Pulled for: ${query}\n\n${formatPullDump(query, [document])}`.trim();
  if (notes.scratch.includes(marker)) return notes;
  const withExcerpt = appendScratch(notes, marker);
  return {
    ...withExcerpt,
    opened: [{ url: document.url, title: document.title, for: query }, ...withExcerpt.opened]
      .filter((row, index, all) => all.findIndex((other) => other.url === row.url) === index)
      .slice(0, 24),
  };
}

async function savePulledDocument(job: DeskJob, receipt: PullReceipt, document: PulledDocument) {
  await withClaimedLeadMutation(job, receipt.leadId, async (sql, notesJson) => {
    const prior = parseNotes(notesJson);
    const notes = appendPulledDocument(prior, receipt.query, document);
    if (notes === prior) return;
    await sql`
      update leads set notes_json = ${packNotes(notes)}
      where id = ${receipt.leadId} and newsroom_id = ${job.newsroom_id}
    `;
  });
}

/**
 * The mark one finished Pull leaves on one to-do row.
 *
 * Extracted from `finishPullTodo` (PULL1b finding 3) so the rule is testable
 * without a database -- the rule is the whole point, and it is:
 *
 *  - a document was found: strike the line, and clear any of our own
 *    "found nothing" words and their stamp, so a line the editor later restores
 *    starts clean rather than carrying a stale time;
 *  - nothing was found: write the reason in plain words with the moment it
 *    happened (`triedAt`, ISO UTC), and leave the line un-struck. The time is
 *    stored beside the reason precisely because a later retry must not be able
 *    to lend it a newer one.
 *
 * The stamp is what tells our reason from the gate's "searched ..." summary and
 * from a detail line an editor typed; a row written by a build before the stamp
 * existed is recognised by `isPullTodoReason`'s shapes instead. Nothing else on
 * the row is touched.
 */
export function markPulledTodo(
  notes: ReportingNotes,
  index: number,
  outcome: { documentFound: boolean; reason?: string; at?: string },
): ReportingNotes {
  const row = notes.todo[index];
  if (!row) return notes;
  if (!outcome.documentFound) {
    return {
      ...notes,
      todo: notes.todo.map((r, i) =>
        i === index ? { ...r, done: false, q: outcome.reason, triedAt: outcome.at } : r,
      ),
    };
  }
  const cleared = clearPullReason(row);
  const next = { ...notes, todo: notes.todo.map((r, i) => (i === index ? cleared : r)) };
  return next.todo[index]!.done ? next : toggleTodo(next, index);
}

/** Drop `q`/`triedAt` when they are a Pull's own words; leave anything else. */
function clearPullReason(row: NoteTodo): NoteTodo {
  if (!row.triedAt && !isPullTodoReason(row.q ?? "")) return row;
  const next: NoteTodo = { t: row.t, done: row.done, src: row.src };
  if (row.queries?.length) next.queries = row.queries;
  return next;
}

async function finishPullTodo(job: DeskJob, receipt: PullReceipt) {
  await withClaimedLeadMutation(job, receipt.leadId, async (sql, notesJson) => {
    let notes = parseNotes(notesJson);
    let index = receipt.todoIndex ?? -1;
    if (notes.todo[index]?.t !== receipt.query)
      index = notes.todo.findIndex((row) => row.t === receipt.query);
    if (index < 0 || !notes.todo[index]) return;
    notes = markPulledTodo(
      notes,
      index,
      receipt.checkpoint?.documents.length
        ? { documentFound: true }
        : {
            documentFound: false,
            /*
              Point 3: the mark an editor reads on the line. Plain words, and no
              count of our own bookkeeping -- a failure tally said nothing about
              whether pressing Pull again was worth a minute of their morning.
              The route prints the time in front of this, from `triedAt`.
            */
            reason: pullTodoReason({
              status: receipt.status,
              failures: providerFailureNotes(receipt.providerFailures ?? []),
              answered: receipt.searchAnswered === true,
              failureReason: receipt.readFailures?.[0]
                ? pullFailureCopy(receipt.readFailures[0].reason, receipt.readFailures[0].url)
                : receipt.status === "failed" && !(receipt.providerFailures?.length) && receipt.errors.at(-1)
                  ? pullFailureCopy(receipt.errors.at(-1))
                  : undefined,
            }),
            // The run's own finish -- the moment this reason is written. A
            // crash path that got here without one still stamps the write.
            at: receipt.finishedAt ?? new Date().toISOString(),
          },
    );
    await sql`
      update leads set notes_json = ${packNotes(notes)}
      where id = ${receipt.leadId} and newsroom_id = ${job.newsroom_id}
    `;
  });
}

export async function performPullWork(job: DeskJob) {
  const sql = await getSql();
  const stored = await sql<{ result_json: string }>`
    select result_json from desk_jobs where id = ${job.id} limit 1
  `;
  const receipt = parsePullReceipt(stored[0]?.result_json);
  if (!receipt) throw new Error("Pull job is missing its saved request");
  /*
    FB1: Pull had the best progress text on the desk and no card to draw it on.
    The reporter carries both halves now -- the sentence (which resolves against
    JOB_STAGE_LISTS.pull, so the arrival phrases light their chips) and the
    percentage -- through the one seam the pipeline already reports on.
  */
  const reportPull = progressReporterFor(job);
  try {
    receipt.checkpoint ??= await loadPullContext(job, receipt);
    const final = await runPullPipeline(receipt as PullReceipt & { checkpoint: PullCheckpoint }, {
      // Pull opts into the block cooldown: three pulls in a row must not ask a
      // provider that answered 429 to the first one (see search-cooldown.ts).
      // Every other caller of `searchWithFallback` keeps its current behaviour.
      search: (query, progress, signal) =>
        searchWithFallback(query, undefined, undefined, progress, signal, {
          respectCooldowns: true,
        }),
      // Pull is a mechanical public-record reader. A scanned PDF stays
      // `needs-ocr` for the editor instead of silently spending any model.
      ingest: (url, signal) => ingestDocument(url, { allowModelOcr: false }, signal),
      saveReceipt: (next) => saveJobReceipt(job, next),
      // Every receipt boundary is also a beat: the search loop, the index
      // pages and the document fetches all pass through `save`.
      reportStage: (stage, pct) => reportPull(stage, pct),
      // The editor's Cancel ends the job with "Cancelled by the editor" like
      // every other kind, so the card shows one state for one act.
      assertNotCancelled: () => throwIfJobCancelled(job.id),
      stopRequested: () => jobStopRequested(job),
      saveDocument: (document, next) => savePulledDocument(job, next, document),
    });
    // A claim Pull has no reporting line to strike (receipt.sourceUrl is a
    // claim's source, and claims live in `notes.found`), so the to-do
    // bookkeeping is skipped rather than run against a query that never
    // matched a to-do.
    if (!final.sourceUrl) await finishPullTodo(job, final);
    await audit(
      job.user_id,
      "pull",
      `${final.status}: ${final.query.slice(0, 180)}; ${final.counters.documentsSaved} saved`,
      job.newsroom_id,
      { kind: "lead", id: final.leadId },
    );
  } catch (error) {
    receipt.status = "failed";
    receipt.stage = pullFailureCopy(error instanceof Error ? error.message : "Pull failed");
    receipt.finishedAt = new Date().toISOString();
    addFailure(receipt, error instanceof Error ? error.message : "Pull failed");
    await saveJobReceipt(job, receipt);
    if (!receipt.sourceUrl) await finishPullTodo(job, receipt);
    throw error;
  }
}
