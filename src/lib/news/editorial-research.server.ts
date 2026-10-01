/**
 * The desk-run research pass, for the Opinion writers that have no web tools.
 *
 * UNIT U30. Opinion's Automatic starts on DeepSeek v4.1 Flash, and its picker
 * offers the local model and the newsroom's saved connections. All three speak
 * the OpenAI-compatible protocol, which has no WebSearch/WebFetch tool loop on
 * the wire (see `providerRunsToolPass`), so the two-pass flow the subscription
 * writers use cannot run for them: there is no second pass to give the web
 * tools to. Unit U29 answered that by writing in one call from the material the
 * editor supplied and recording "no gathering pass ran" — honest, and a piece
 * that was never researched.
 *
 * This module is the other half. The desk does the searching, the fetching and
 * the capturing; the model only plans the queries and reads what the desk
 * captured. That keeps SEC-3 intact in both directions:
 *
 *   - the research calls here never hold the private voice. Their system text
 *     is `DESK_PLANNER_INSTRUCTIONS` / `DESK_READER_INSTRUCTIONS`, and the
 *     packs they are handed are the desk's material and captured public pages;
 *   - the writing call still gets no tools of any kind, because its transport
 *     has none. Nothing about this pass changes that call's shape.
 *
 * WHY THIS IS NOT `researchLoop` ITSELF. `researchLoop` is the Dark Desk's
 * engine and it is written against an investigation: `investigationNewsroom`
 * (investigate.ts) throws "Investigation not found in this newsroom" before it
 * runs a hop, and a round writes `frontier_items`, `search_log` and
 * investigation-scoped `artifacts` rows. An editorial is not an investigation —
 * filing one would put the Opinion desk's research into the Dark Desk's files
 * and its frontier, and give every editorial a file the editor never opened.
 * So this pass reuses the Dark Desk's machinery rather than its driver, which
 * is what the pieces below are:
 *
 *   searchWithFallback + the relevance contract   ./search-web.ts
 *   junkQueryReason                               ./extract.ts
 *   boilerplatePageReason                         ./result-quality.ts
 *   readableCapture                               ./html-text.ts
 *   rememberCapture (the artifact tables)         ./investigate.ts
 *   the newsroom's research window                ./dark-preferences.ts
 *   official domains / the paper's place          ./absence-paper.ts
 *   onStage + `throwIfCancelled` (the U25 seam)   ./jobs.ts
 *
 * The capture write is the same one `checkEditorialNames` already makes for an
 * editorial's own name check: `investigationId: null`, `triggerKind:
 * "editorial"`, `autoWatch: false`. `capture_events.editorial_request_id`
 * (migrations/0113) is what makes the pages a given editorial was written from
 * readable back from the request that produced it.
 *
 * No schema is created at runtime here. New schema in this repository lives in
 * `migrations/*.sql` -- `src/lib/news/no-runtime-ddl.test.ts` fails any module
 * under `src/` that issues DDL, and `server/middleware/00-schema-current.ts`
 * refuses to serve a database that is behind those files, so the column this
 * pass writes is guaranteed to exist before any request reaches it.
 */

import { getSql } from "../db.ts";
import {
  resolveResearchPreferences,
  queryWithResearchWindow,
  type ResearchSnapshot,
} from "./dark-preferences.ts";
import {
  DESK_PLANNER_INSTRUCTIONS,
  DESK_READER_INSTRUCTIONS,
  buildDeskFindingsPack,
  buildDeskPlanPack,
  type DeskCapture,
} from "./editorial.ts";
import { junkQueryReason } from "./extract.ts";
import { sha256 } from "./fetch-url.ts";
import { readableCapture } from "./html-text.ts";
import { ingestDocument, type PdfPage } from "./ingest.ts";
import { rememberCapture } from "./investigate.ts";
import { boilerplatePageReason } from "./result-quality.ts";
import { searchWithFallback, type SearchRelevanceAssessment, type WebHit } from "./search-web.ts";

/*
  ---------------------------------------------------------------------------
  The budget
  ---------------------------------------------------------------------------

  Small on purpose, and the numbers are the whole of the argument. Dark Desk
  rounds are unbounded work on an open file; this is a piece of writing the
  editor is waiting on, and the editorial's own timeout is already generous
  because the VOICE decides how much to go and read. A no-tool writer has no
  such appetite to budget for, so the desk takes a fixed, small look:

    2 hops         one round of searches, then one round that chases what the
                   first did not settle
    3 queries/hop  six searches at most, which is what the budget allows whole
    8 pages        read and captured at most, across both hops

  A hop is model-planned, so 2 hops is also the model-call ceiling for
  planning: at most three research model calls (plan, plan, read) before the
  writing call. Past that the marginal page stops paying for itself, and the
  honest thing for an editorial's claims-and-sources appendix is a short list of
  pages the desk actually read over a long list it skimmed.
*/
export const DESK_RESEARCH_HOPS = 2;
export const DESK_RESEARCH_SEARCHES = 6;
export const DESK_QUERIES_PER_HOP = 3;
export const DESK_RESEARCH_PAGES = 8;

/** How much of one captured page the reading call is shown. */
export const DESK_PAGE_TEXT_CAP = 6_000;
/** How much captured text the reading call is shown in total, in page order. */
export const DESK_TOTAL_TEXT_CAP = 48_000;

/**
 * The arrival sentence, and it is spelled here so the job's stage list and this
 * pass cannot drift apart: `JOB_STAGE_LISTS.editorial` (./jobs.ts) carries the
 * same words, and `stageIndexFor` lights that chip on this exact string. Every
 * sentence below that names a search or a page is detail -- it moves the
 * card's "Now:" line and leaves the chip where the arrival put it, which is the
 * pattern the stage list's own comment describes.
 */
export const DESK_RESEARCH_STAGE = "Researching with the desk";

/** A search, as the loop needs it: hits plus the relevance contract's answer. */
export type DeskSearchAttempt = {
  hits: WebHit[];
  /** `searchWithFallback`'s own verdict on whether these hits answer the query. */
  decision?: SearchRelevanceAssessment["decision"];
  /** Why that verdict was reached, for the run's record. */
  reason?: string;
};

export type DeskSearchFn = (query: string) => Promise<DeskSearchAttempt>;

/** One page the desk opened, in the shape `ingestDocument` already answers. */
export type DeskFetchedPage = {
  ok: boolean;
  status: number;
  outcome: string;
  title: string;
  text: string;
  pages: PdfPage[];
  extractionMethod: string;
};

export type DeskFetchFn = (url: string) => Promise<DeskFetchedPage>;

export type DeskCaptureFn = (page: {
  url: string;
  title: string;
  text: string;
  status: number;
  outcome: string;
  pages: PdfPage[];
  extractionMethod: string;
}) => Promise<{ captureEventId: number | null; versionId: number | null }>;

/** One no-tool model call: a system instruction and a pack, nothing else. */
export type DeskModelFn = (
  system: string,
  user: string,
) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;

export type DeskResearchDeps = {
  search?: DeskSearchFn;
  fetch?: DeskFetchFn;
  capture?: DeskCaptureFn;
  plan?: DeskModelFn;
  read?: DeskModelFn;
  /**
   * The editor's research window for this newsroom, or null when they have
   * never set one. Null is not "no preferences": it is the honest answer that
   * nobody has said, which is why no date operator is written into a query and
   * the planner is not told to honour a window that does not exist.
   */
  readWindow?: (newsroomId: number) => Promise<ResearchSnapshot | null>;
  /** The U25 Stop seam. It THROWS; a stopped run leaves the hop loop. */
  throwIfCancelled?: () => Promise<void>;
  onStage?: (stage: string) => Promise<void>;
  now?: () => Date;
};

export type DeskResearchInput = {
  userId: string;
  newsroomId: number;
  subject: string;
  askedFor?: string;
  /** The desk material pack the two-pass flow already builds for this piece. */
  researchPack: string;
  /**
   * The paper's place and its own official hosts, for locality and ranking.
   *
   * `officialHosts` is the city's own site, read from the newsroom's settings
   * by `officialSiteHost` -- the same helper the dig uses to build its
   * `site:`-scoped strategies (./research-scope.ts). `officialDomains` is the
   * .gov list derived from the editor's own pointers. Both are handed to
   * `searchWithFallback`'s relevance contract, so a hit on the city's own site
   * ranks first, and both are named in the planning pack so the model can scope
   * a query to one of them.
   */
  paper?: {
    city?: string;
    state?: string;
    officialDomains?: string[];
    officialHosts?: string[];
  };
  /** The queued editorial request this research belongs to, when there is one. */
  requestId?: number | null;
};

export type DeskResearchOutcome = {
  /** The reading pass's findings, for the writing pack. "" when there are none. */
  findings: string;
  searches: number;
  pages: number;
  captures: DeskCapture[];
  /** The editor's research window in words, when one applied to this run. */
  window: string | null;
  /** Why nothing usable was found, or null when something was. */
  nothingFoundReason: string | null;
};

/**
 * The editor's search-date preference, read from the newsroom's own settings.
 *
 * `dark_settings.research_preferences` is where the editor sets the window the
 * desk searches within (see ./dark-preferences.ts), and an editorial researched
 * by the desk is the same desk searching the same beat. A newsroom with no row
 * -- or a database that has not created the table -- answers null, and null
 * means no window rather than a default one: inventing a 90-day lookback the
 * editor never chose would quietly hide the older record an editorial about a
 * long-running promise is usually about.
 */
async function defaultReadWindow(newsroomId: number, now: Date): Promise<ResearchSnapshot | null> {
  const sql = await getSql();
  try {
    const rows = await sql<{ research_preferences: string | null }>`
      select research_preferences from dark_settings where newsroom_id = ${newsroomId} limit 1
    `;
    const raw = rows[0]?.research_preferences;
    if (!raw) return null;
    return resolveResearchPreferences(JSON.parse(raw), now);
  } catch {
    return null;
  }
}

/**
 * Pull the queries out of the planner's answer.
 *
 * Written tolerantly on purpose: a small local model asked for JSON returns
 * JSON inside a fenced block about as often as it returns bare JSON, and a
 * refusal to parse is a whole hop spent on nothing. Anything that is not a
 * usable query is dropped by `junkQueryReason` afterwards -- this function's
 * only job is to find the strings.
 */
export function parseDeskQueries(raw: string): string[] {
  const text = String(raw ?? "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { queries?: unknown };
      if (Array.isArray(parsed.queries)) {
        return parsed.queries.filter((q): q is string => typeof q === "string");
      }
    } catch {
      /* fall through to the shape below */
    }
  }
  // The array on its own, which is the other shape a small model answers with.
  const listStart = text.indexOf("[");
  const listEnd = text.lastIndexOf("]");
  if (listStart >= 0 && listEnd > listStart) {
    try {
      const parsed = JSON.parse(text.slice(listStart, listEnd + 1)) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((q): q is string => typeof q === "string");
      }
    } catch {
      /* fall through to one query per line */
    }
  }
  // Or one query per line, which is what a model that ignored the JSON ask
  // produces and is still perfectly usable.
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").replace(/^["'\s]+|["',\s]+$/g, ""))
    .filter((line) => line && !/^[[\]{}]+$/.test(line));
}

/**
 * The queries one hop will actually run: usable, bounded, windowed, and not
 * already asked. `junkQueryReason` decides what is usable -- the same rule the
 * dig's fallback path uses, and the reason the desk does not spend one of its
 * six searches on a page title or a scraped fragment.
 */
export function boundedDeskQueries(
  raw: readonly string[],
  input: { tried: Set<string>; cap: number; window?: ResearchSnapshot | null },
): string[] {
  const out: string[] = [];
  for (const candidate of raw) {
    if (out.length >= input.cap) break;
    const clean = candidate.replace(/\s+/g, " ").trim();
    if (!clean || junkQueryReason(clean)) continue;
    const key = clean.toLowerCase();
    if (input.tried.has(key)) continue;
    input.tried.add(key);
    out.push(input.window ? queryWithResearchWindow(clean, input.window) : clean);
  }
  return out;
}

/** The window in words, in the form the writing pack prints. */
function windowWords(window: ResearchSnapshot): string {
  return `${window.startDate} through ${window.endDate}`;
}

/**
 * The desk's research pass. Never throws for a research failure: a search
 * provider that answers nothing, a page that will not open, a planner that
 * returns prose -- each of those is a smaller `captures` list and an honest
 * "found nothing usable" in the writing pack, because the piece still has to be
 * written from what the editor supplied.
 *
 * It DOES throw when the editor pressed Stop: `throwIfCancelled` is the U25
 * seam and it throws `JobCancelledError`, which has to leave this loop rather
 * than be mistaken for a run that finished with nothing.
 */
export async function runDeskResearch(
  input: DeskResearchInput,
  deps: DeskResearchDeps = {},
): Promise<DeskResearchOutcome> {
  const now = deps.now?.() ?? new Date();
  const onStage = deps.onStage ?? (async () => {});
  const throwIfCancelled = deps.throwIfCancelled ?? (async () => {});
  const officialDomains = [
    ...new Set([...(input.paper?.officialHosts ?? []), ...(input.paper?.officialDomains ?? [])]),
  ];
  const localityStopwords = [input.paper?.city ?? "", input.paper?.state ?? ""].filter(Boolean);

  const window = deps.readWindow
    ? await deps.readWindow(input.newsroomId)
    : await defaultReadWindow(input.newsroomId, now);

  const search: DeskSearchFn =
    deps.search ??
    (async (query) => {
      const attempt = await searchWithFallback(query, undefined, {
        officialDomains,
        localityStopwords,
      });
      return {
        hits: attempt.hits,
        decision: attempt.relevance?.decision,
        reason: attempt.relevance?.reason,
      };
    });

  const fetchPage: DeskFetchFn =
    deps.fetch ??
    ((url) =>
      // `allowModelOcr: false`: a PDF the desk cannot read natively is skipped,
      // not transcribed. The budget above is pages read, and a hidden OCR model
      // call per scanned PDF is spending the editor never asked for.
      ingestDocument(url, { allowModelOcr: false }));

  const capture: DeskCaptureFn = deps.capture ?? (async (page) => {
    const sql = await getSql();
    const record = await rememberCapture({
      sql,
      userId: input.userId,
      newsroomId: input.newsroomId,
      // An editorial is not an investigation: no file, no frontier, and the
      // artifact mirror the Dark Desk reads stays untouched (investigate.ts
      // guards that insert on a non-null id). Same posture as
      // `checkEditorialNames`' own editorial capture.
      investigationId: null,
      url: page.url,
      title: page.title || page.url,
      text: page.text.slice(0, 2_000_000),
      hash: await sha256(page.text || page.url),
      status: page.status,
      outcome: page.outcome,
      classification: "discovered",
      triggerKind: "editorial",
      pages: page.pages,
      extractionMethod: page.extractionMethod,
      autoWatch: false,
    });
    /*
      The link back to the request that caused this capture
      (`capture_events.editorial_request_id`, migrations/0113). It is a
      separate statement because `rememberCapture` is the Dark Desk's own write
      and takes no argument for it -- and because a capture written by any other
      path must keep the column null.
    */
    if (input.requestId != null) {
      await sql`
        update capture_events set editorial_request_id = ${input.requestId}
        where id = ${record.captureEventId} and editorial_request_id is null
      `;
    }
    return { captureEventId: record.captureEventId, versionId: record.versionId };
  });

  const captures: (DeskCapture & { text: string })[] = [];
  const tried = new Set<string>();
  const degraded: string[] = [];
  let searches = 0;

  // The arrival, once, in the exact words the job's stage list carries.
  await onStage(DESK_RESEARCH_STAGE);

  for (let hop = 1; hop <= DESK_RESEARCH_HOPS; hop++) {
    if (searches >= DESK_RESEARCH_SEARCHES || captures.length >= DESK_RESEARCH_PAGES) break;
    await throwIfCancelled();

    const planned = await deps.plan?.(
      DESK_PLANNER_INSTRUCTIONS,
      buildDeskPlanPack({
        researchPack: input.researchPack,
        hop,
        hops: DESK_RESEARCH_HOPS,
        tried: [...tried],
        captured: captures.map((c) => ({ title: c.title, url: c.url })),
        officialDomains,
        window: window ? windowWords(window) : null,
      }),
    );
    if (!planned || !planned.ok) break;

    const queries = boundedDeskQueries(parseDeskQueries(planned.text), {
      tried,
      cap: Math.min(DESK_QUERIES_PER_HOP, DESK_RESEARCH_SEARCHES - searches),
      window,
    });
    if (!queries.length) break;

    for (const query of queries) {
      if (searches >= DESK_RESEARCH_SEARCHES || captures.length >= DESK_RESEARCH_PAGES) break;
      await throwIfCancelled();
      searches += 1;
      await onStage(`${DESK_RESEARCH_STAGE}: search ${searches} of ${DESK_RESEARCH_SEARCHES}`);

      let attempt: DeskSearchAttempt;
      try {
        attempt = await search(query);
      } catch {
        // A provider that failed is a search that found nothing, not a piece
        // that cannot be written.
        continue;
      }
      if (attempt.decision === "degraded" && attempt.reason) degraded.push(attempt.reason);

      for (const hit of attempt.hits) {
        if (captures.length >= DESK_RESEARCH_PAGES) break;
        // The same refusal list the dig runs (`searchWithFallback` applies it
        // to provider hits already; an injected or gateway search may not).
        if (boilerplatePageReason(hit.url)) continue;
        await throwIfCancelled();

        let page: DeskFetchedPage;
        try {
          page = await fetchPage(hit.url);
        } catch {
          continue;
        }
        // A blocked page is a paywall notice or an error shell, not evidence:
        // the same bar `retrievePack` holds captures to before a model reads
        // them (Dark Desk F6).
        const readable = readableCapture({
          text: page?.text ?? "",
          extractionMethod: page?.extractionMethod,
          status: page?.status,
          outcome: page?.outcome,
          title: page?.title,
        });
        if (!page?.ok || readable.kind !== "ok") continue;

        await onStage(
          `${DESK_RESEARCH_STAGE}: reading ${captures.length + 1} of ${DESK_RESEARCH_PAGES}`,
        );
        try {
          const record = await capture({
            url: hit.url,
            title: page.title || hit.title || hit.url,
            text: page.text,
            status: page.status,
            outcome: page.outcome,
            pages: page.pages ?? [],
            extractionMethod: page.extractionMethod ?? "",
          });
          captures.push({
            url: hit.url,
            title: page.title || hit.title || hit.url,
            captureEventId: record.captureEventId,
            versionId: record.versionId,
            text: readable.body.slice(0, DESK_PAGE_TEXT_CAP),
          });
        } catch {
          // A page the desk cannot record is a page it cannot stand behind:
          // dropped rather than cited from a copy nobody can open.
          continue;
        }
      }
    }
  }

  await throwIfCancelled();

  /*
    The reading pass. It gets the captures and nothing else, and it is the only
    research call that sees page text -- which is exactly why the voice is not
    in it (see `DESK_READER_INSTRUCTIONS`).
  */
  let findings = "";
  if (captures.length && deps.read) {
    const budgeted: typeof captures = [];
    let used = 0;
    for (const capture of captures) {
      if (used >= DESK_TOTAL_TEXT_CAP) break;
      const text = capture.text.slice(0, Math.min(DESK_PAGE_TEXT_CAP, DESK_TOTAL_TEXT_CAP - used));
      used += text.length;
      budgeted.push({ ...capture, text });
    }
    const read = await deps.read(
      DESK_READER_INSTRUCTIONS,
      buildDeskFindingsPack({ subject: input.subject, askedFor: input.askedFor, captures: budgeted }),
    );
    findings = read.ok ? read.text.trim() : "";
  }

  const reason = nothingFound(captures.length, searches, degraded);
  /*
    Say it on the row the editor is watching. A piece with a thin appendix is
    otherwise indistinguishable from a desk that never looked, and the writing
    pack's own "nothing usable" sentence goes to the model, not to them. The
    sentence is a detail, not an arrival: the chip stays where the desk pass put
    it.
  */
  if (reason) await onStage(`${DESK_RESEARCH_STAGE}: nothing usable was found for this piece`);

  return {
    findings,
    searches,
    pages: captures.length,
    captures: captures.map(({ url, title, captureEventId, versionId }) => ({
      url,
      title,
      captureEventId,
      versionId,
    })),
    window: window ? windowWords(window) : null,
    nothingFoundReason: reason,
  };
}

/**
 * The honest sentence for a run that read nothing usable, or null.
 *
 * Two cases are genuinely different and the desk's record says which: no search
 * ran at all (the planner produced nothing usable), or searches ran and not one
 * of their results survived the desk's own readability bar -- in which case the
 * relevance contract's complaint about the last result set is carried along,
 * because "nothing matched the question" and "the pages would not open" are
 * different problems with different fixes.
 */
export function nothingFound(pages: number, searches: number, degraded: string[]): string | null {
  if (pages > 0) return null;
  if (searches === 0) return "The desk planned no usable search for this piece.";
  const plural = searches === 1 ? "search" : "searches";
  const base = `The desk ran ${searches} ${plural} and read no page it could use for this piece.`;
  return degraded.length ? `${base} ${degraded[0]}` : base;
}
