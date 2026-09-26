import { getSql, withTransaction, type Sql } from "../db.ts";
import { getPaperConfig } from "./paper-settings.ts";
import { ingestDocument, type IngestDocument } from "./ingest.ts";
import {
  searchWithFallback,
  type SearchAttempt,
  type SearchProgressEvent,
  type WebHit,
} from "./search-web.ts";
import { dropListingUrls, namedSubjects, preferPrimaryUrls } from "./extract.ts";
import { sanitizePublicUrls } from "./schema.ts";
import {
  appendScratch,
  formatPullDump,
  packNotes,
  parseNotes,
  selectExcerpt,
  toggleTodo,
  type ReportingNotes,
} from "./notes.ts";
import {
  docCandidateHosts,
  docIndexPages,
  isOnSubject,
  pullQueries,
  siteOwnDocLinks,
} from "./pull-plan.ts";
import { audit } from "./ops.ts";
import { setJobStage, throwIfJobCancelled, type DeskJob } from "./jobs.ts";

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
  query: string;
  status: "queued" | "running" | "completed" | "stopped" | "deadline" | "failed";
  stage: string;
  stopRequested: boolean;
  counters: PullCounters;
  errors: string[];
  checkpoint?: PullCheckpoint;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type PullRunView = {
  jobId: number;
  leadId: number;
  todoIndex: number | null;
  query: string;
  jobStatus: "queued" | "running" | "completed" | "failed";
  status: PullReceipt["status"];
  stage: string;
  stopRequested: boolean;
  counters: PullCounters;
  errors: string[];
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
    query: input.query.trim().slice(0, 240),
    status: "queued",
    stage: "Queued",
    stopRequested: false,
    counters: { ...EMPTY_COUNTERS },
    errors: [],
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
  reportStage?: (stage: string) => Promise<void>;
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
  receipt.status = "running";
  receipt.startedAt = receipt.startedAt ?? new Date(now()).toISOString();
  let terminal = false;

  const save = async (stage: string) => {
    // A provider callback can arrive after withinDeadline() has returned.
    // Never let that late callback overwrite a terminal deadline/stop receipt.
    if (terminal) return;
    receipt.stage = stage;
    receipt.updatedAt = new Date(now()).toISOString();
    await deps.saveReceipt(receipt);
    await deps.reportStage?.(stage);
  };
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
  const finish = async (status: "completed" | "stopped" | "deadline", stage: string) => {
    terminal = true;
    receipt.status = status;
    receipt.stage = stage;
    receipt.counters.documentsSaved = receipt.checkpoint.documents.length;
    receipt.finishedAt = new Date(now()).toISOString();
    receipt.updatedAt = receipt.finishedAt;
    await deps.saveReceipt(receipt);
    return receipt;
  };

  await save(`Preparing ${receipt.checkpoint.queries.length} searches`);
  try {
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
      await save(`Searching ${current + 1} of ${receipt.checkpoint.queries.length}`);
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
                } else if (
                  event.state === "SEARCH_TIMEOUT" ||
                  event.state === "SEARCH_FAILED_NETWORK" ||
                  event.state === "SEARCH_FAILED_PARSE" ||
                  event.state === "SEARCH_BLOCKED" ||
                  event.state === "SEARCH_FAILED_PROVIDER"
                ) {
                  addFailure(receipt, `${event.provider}: ${event.error || event.state}`);
                  await save(
                    `Searching ${current + 1} of ${receipt.checkpoint!.queries.length} · ${event.provider} failed, trying the next source`,
                  );
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
      const hosts = docCandidateHosts(
        receipt.checkpoint.hits.map((hit) => hit.url),
        receipt.checkpoint.storyUrls,
      );
      receipt.checkpoint.indexPages = docIndexPages(hosts);
      receipt.checkpoint.indexPagesPrepared = true;
      fillMarkers(indexPageResults, receipt.checkpoint.indexPages.length);
      await save(`Checking official document pages · 0 of ${receipt.checkpoint.indexPages.length}`);
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
      );
      try {
        const got = await withinDeadline((signal) => deps.ingest(page, signal), deadlineAt, now);
        const links = siteOwnDocLinks(got.extras, page);
        indexPageResults[current] = links;
        addUnique(receipt.checkpoint.indexedUrls, links);
        if (!got.ok && got.outcome !== "fetched") {
          addFailure(receipt, `${page}: ${got.outcome}${got.status ? ` (${got.status})` : ""}`);
        }
      } catch (error) {
        if (error instanceof PullDeadlineError) throw error;
        addFailure(
          receipt,
          `${page}: ${error instanceof Error ? error.message : "could not open"}`,
        );
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
      );
      try {
        const got = await withinDeadline((signal) => deps.ingest(url, signal), deadlineAt, now);
        await save(
          got.extractionMethod
            ? `Extracted ${got.extractionMethod} · candidate ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`
            : `Read candidate document ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
        );
        if (!got.text || got.text.trim().length < 40) {
          addFailure(receipt, `${url}: ${got.outcome || "no usable text"}`);
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
        addFailure(receipt, `${url}: ${error instanceof Error ? error.message : "could not open"}`);
        documentOutcomes[current] = "failed";
      }
      await save(
        `Saved candidate result ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`,
      );
      receipt.checkpoint.documentIndex += 1;
      await save(`Checked candidate ${current + 1} of ${receipt.checkpoint.rankedUrls.length}`);
    }

    return finish(
      "completed",
      receipt.checkpoint.documents.length
        ? `Finished · ${receipt.checkpoint.documents.length} relevant document${receipt.checkpoint.documents.length === 1 ? "" : "s"} saved`
        : "Finished · no relevant public document found",
    );
  } catch (error) {
    if (error instanceof PullDeadlineError) {
      return finish("deadline", stoppedStage("deadline"));
    }
    throw error;
  }
}

async function loadPullContext(job: DeskJob, receipt: PullReceipt): Promise<PullCheckpoint> {
  const sql = await getSql();
  await sql.query(
    "alter table leads add column if not exists notes_json text not null default '{}'",
  );
  const rows = await sql<{ notes_json: string | null; headline: string; source_urls: string }>`
    select notes_json, headline, source_urls from leads
    where id = ${receipt.leadId} and newsroom_id = ${job.newsroom_id} limit 1
  `;
  if (!rows[0]) throw new Error("Lead not found");
  const paper = await getPaperConfig(job.newsroom_id);
  const memo = parseNotes(rows[0].notes_json);
  const subjects = namedSubjects(
    [rows[0].headline, memo.news, memo.angle, memo.why, receipt.query].filter(Boolean).join("\n"),
  );
  const watched = await sql<{ url: string }>`
    select url from sources where newsroom_id = ${job.newsroom_id}
  `;
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

async function finishPullTodo(job: DeskJob, receipt: PullReceipt) {
  await withClaimedLeadMutation(job, receipt.leadId, async (sql, notesJson) => {
    let notes = parseNotes(notesJson);
    let index = receipt.todoIndex ?? -1;
    if (notes.todo[index]?.t !== receipt.query)
      index = notes.todo.findIndex((row) => row.t === receipt.query);
    if (index < 0 || !notes.todo[index]) return;
    if (receipt.checkpoint?.documents.length) {
      if (!notes.todo[index]!.done) notes = toggleTodo(notes, index);
    } else {
      const reason =
        receipt.status === "deadline"
          ? `pull reached its two-minute limit; ${receipt.counters.failures} provider or page failures`
          : receipt.status === "stopped"
            ? "pull stopped before finding a relevant document"
            : `pull found nothing; ${receipt.counters.failures} provider or page failures`;
      notes = {
        ...notes,
        todo: notes.todo.map((row, rowIndex) =>
          rowIndex === index ? { ...row, done: false, q: reason } : row,
        ),
      };
    }
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
  try {
    receipt.checkpoint ??= await loadPullContext(job, receipt);
    const final = await runPullPipeline(receipt as PullReceipt & { checkpoint: PullCheckpoint }, {
      search: (query, progress, signal) =>
        searchWithFallback(query, undefined, undefined, progress, signal),
      // Pull is a mechanical public-record reader. A scanned PDF stays
      // `needs-ocr` for the editor instead of silently spending any model.
      ingest: (url, signal) => ingestDocument(url, { allowModelOcr: false }, signal),
      saveReceipt: (next) => saveJobReceipt(job, next),
      // Every receipt boundary is also a beat: the search loop, the index
      // pages and the document fetches all pass through `save`.
      reportStage: (stage) => setJobStage(job.id, stage),
      // The editor's Cancel ends the job with "Cancelled by the editor" like
      // every other kind, so the card shows one state for one act.
      assertNotCancelled: () => throwIfJobCancelled(job.id),
      stopRequested: () => jobStopRequested(job),
      saveDocument: (document, next) => savePulledDocument(job, next, document),
    });
    await finishPullTodo(job, final);
    await audit(
      job.user_id,
      "pull",
      `${final.status}: ${final.query.slice(0, 180)}; ${final.counters.documentsSaved} saved`,
      job.newsroom_id,
      { kind: "lead", id: final.leadId },
    );
  } catch (error) {
    receipt.status = "failed";
    receipt.stage = "Pull failed; saved progress can be continued";
    receipt.finishedAt = new Date().toISOString();
    addFailure(receipt, error instanceof Error ? error.message : "Pull failed");
    await saveJobReceipt(job, receipt);
    await finishPullTodo(job, receipt);
    throw error;
  }
}
