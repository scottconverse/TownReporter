/**
 * The desk-run research pass, for the Opinion writers that have no web tools.
 *
 * UNIT U30 built this; UNIT U31 changed its shape twice over.
 *
 * U30: Opinion's Automatic starts on DeepSeek v4.1 Flash, and its picker offers
 * the local model and the newsroom's saved connections. All three speak the
 * OpenAI-compatible protocol, which has no WebSearch/WebFetch tool loop on the
 * wire (see `providerRunsToolPass`), so the two-pass flow the subscription
 * writers use cannot run for them -- there is no second pass to give the web
 * tools to. The desk does the searching, the fetching and the capturing, and
 * the model only plans and reads.
 *
 * U31 (owner decision D20, "go back to how it was"): the model HOLDS THE VOICE
 * FILE while it does both. The voice contains the research protocol -- Stage L
 * local record, packet/PDF/tape/parcel/CORA rules, triangulation, the surprise
 * hunt, the local source ledger -- so a model planning searches without it is
 * planning without the protocol it is supposed to follow. The same decision
 * removed the fixed small budget: research now runs until the protocol's own
 * stopping conditions are met, as far as the desk can judge them, with a
 * generous safety ceiling instead of a research budget.
 *
 * WHY THIS IS NOT `researchLoop` ITSELF. `researchLoop` is the Dark Desk's
 * engine and it is written against an investigation: `investigationNewsroom`
 * (investigate.ts) throws "Investigation not found in this newsroom" before it
 * runs a hop, and a round writes `frontier_items`, `search_log` and
 * investigation-scoped `artifacts` rows. An editorial is not an investigation --
 * filing one would put the Opinion desk's research into the Dark Desk's files
 * and its frontier, and give every editorial a file the editor never opened.
 * So this pass reuses the Dark Desk's machinery rather than its driver:
 *
 *   searchWithFallback + the relevance contract   ./search-web.ts
 *   junkQueryReason                               ./extract.ts
 *   boilerplatePageReason                         ./result-quality.ts
 *   readableCapture                               ./html-text.ts
 *   rememberCapture (the artifact tables)         ./investigate.ts
 *   the newsroom's research window                ./dark-preferences.ts
 *   the newsroom's official hosts, and its own
 *   PrimeGov portal and captured transcripts      ./primegov.ts, ./absence-gate.ts
 *   PDF and transcript reads                      ./ingest.ts
 *   onStage + `throwIfCancelled` (the U25 seam)   ./jobs.ts
 *
 * The capture write is the same one `checkEditorialNames` already makes for an
 * editorial's own name check: `investigationId: null`, `triggerKind:
 * "editorial"`, `autoWatch: false`. `capture_events.editorial_request_id`
 * (migrations/0114) is what makes the pages a given editorial was written from
 * readable back from the request that produced it.
 *
 * No schema is created at runtime here. New schema in this repository lives in
 * `migrations/*.sql` -- `src/lib/news/no-runtime-ddl.test.ts` fails any module
 * under `src/` that issues DDL, and `server/middleware/00-schema-current.ts`
 * refuses to serve a database that is behind those files, so the column this
 * pass writes is guaranteed to exist before any request reaches it.
 */

import { getSql, type Sql } from "../db.ts";
import {
  resolveResearchPreferences,
  queryWithResearchWindow,
  type ResearchSnapshot,
} from "./dark-preferences.ts";
import type { DeskCapture } from "./editorial.ts";
import { buildDeskFindingsPack, buildDeskPlanPack } from "./editorial.ts";
import { junkQueryReason } from "./extract.ts";
import { sha256 } from "./fetch-url.ts";
import { readableCapture } from "./html-text.ts";
import { ingestDocument, type PdfPage } from "./ingest.ts";
import { rememberCapture } from "./investigate.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";
import {
  compiledDocumentUrl,
  preferredDocuments,
  readPrimeGovPortal,
  type PrimeGovPortalRead,
} from "./primegov.ts";
import { queryTokens } from "./retrieve.ts";
import { boilerplatePageReason } from "./result-quality.ts";
import { searchWithFallback, type SearchRelevanceAssessment, type WebHit } from "./search-web.ts";

/*
  ---------------------------------------------------------------------------
  The ceiling
  ---------------------------------------------------------------------------

  U31 removed the fixed budget (2 hops, 3 queries a hop, 6 searches, 8 pages).
  What replaced it is not "unbounded": it is the protocol's own stopping
  conditions, judged by the model that holds the protocol, plus a generous
  safety ceiling for the case where that judgement never comes.

  The two are different things and the difference is the whole design:

    - the STOPPING CONDITIONS are the research protocol's, and they are the
      reason to stop. The desk states them to the model and the model answers
      `stop` with a reason -- the desk cannot judge "every load-bearing claim
      has two independent sources" itself, because that is a judgement about
      the piece, not about the pages;
    - the CEILING is a safety net for a model that never says stop, a provider
      that hangs, or a subject with no bottom. Nothing about a piece that hits
      it is good: the run stops, says which ceiling it hit, and the writer is
      told how much was read.

  Both are configurable, because a slower box or a bigger paper genuinely needs
  more: `EDITORIAL_RESEARCH_CEILING_MS` (default 30 minutes, floored at a
  minute) and `EDITORIAL_RESEARCH_PAGE_CEILING` (default 80 pages, floored at
  one). The default clock sits under the editorial's own per-pass timeout so
  the writing call still has room; see `editorialTimeoutMs` in
  ./editorial.server.ts.
*/
export const DESK_RESEARCH_CEILING_DEFAULT_MS = 1_800_000;
export const DESK_RESEARCH_PAGE_CEILING_DEFAULT = 80;

/**
 * A structural backstop, NOT a research budget.
 *
 * Every hop makes at least one model call, so a planner that answers with an
 * empty query list every time would spin until the clock ran out -- and each
 * spin costs a call. This bounds the loop itself. It is deliberately far above
 * any real run (a hop is a planning call plus its searches; the protocol's own
 * stopping conditions end a real piece long before this), and it is not what
 * `EDITORIAL_RESEARCH_*` tunes.
 */
export const DESK_RESEARCH_HOP_BACKSTOP = 16;

/** How much of one captured page the reading call is shown. */
export const DESK_PAGE_TEXT_CAP = 6_000;
/** How much captured text the reading call is shown in total, in page order. */
export const DESK_TOTAL_TEXT_CAP = 120_000;

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

/** One model call: the voice as its instructions, and a pack to answer. */
export type DeskModelFn = (
  system: string,
  user: string,
) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;

/** What a planning call answers: queries to run, and whether to stop. */
export type DeskPlan = {
  queries: string[];
  /** The model's own judgement against the protocol's stopping conditions. */
  stop: boolean;
  /** Why it stopped, or what is still unsettled. Shown on the run. */
  reason: string;
};

/**
 * One thing the desk read, from wherever it came.
 *
 * U31 made the reading set heterogeneous on purpose: the protocol's first stage
 * is the LOCAL record, and a captured meeting transcript or the city's own
 * portal catalogue is not a web page with a capture id. `url` is what a reader
 * could open (the video for a transcript), and `locator` is where inside it.
 */
export type DeskReading = {
  kind: "page" | "portal" | "packet" | "transcript" | "capture";
  title: string;
  url: string | null;
  captureEventId: number | null;
  versionId: number | null;
  /** Where inside the record, when it is not the whole thing (a transcript clock). */
  locator: string | null;
  text: string;
};

export type DeskLocalRecords = {
  /** The newsroom's own record, in words, for every planning pack. */
  notes: string;
  /** What the desk read out of it, before any general web search. */
  reading: DeskReading[];
};

export type DeskLocalRecordsFn = (input: {
  newsroomId: number;
  subject: string;
  askedFor?: string;
  officialHosts: string[];
}) => Promise<DeskLocalRecords>;

export type DeskResearchDeps = {
  search?: DeskSearchFn;
  fetch?: DeskFetchFn;
  capture?: DeskCaptureFn;
  plan?: DeskModelFn;
  read?: DeskModelFn;
  /**
   * The newsroom's own record -- its PrimeGov portal, its captured meeting
   * transcripts, the pages it has already captured -- read BEFORE any general
   * web search, because that is the order the protocol puts them in.
   */
  localRecords?: DeskLocalRecordsFn;
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
  /** Test seams for the ceiling; production reads the environment once. */
  ceilingMs?: number;
  pageCeiling?: number;
};

export type DeskResearchInput = {
  userId: string;
  newsroomId: number;
  subject: string;
  askedFor?: string;
  /**
   * The operator's editorial voice file, in full (unit U31).
   *
   * It is the SYSTEM PROMPT of both research calls. The voice contains the
   * research protocol this pass exists to run, so the planning and the reading
   * are governed by it exactly as the writing call is -- which is the whole of
   * owner decision D20. `writeEditorial` reads it through
   * `readVoiceTextForLocalModel` once and hands the same text to all three
   * calls; it is never an argument and never logged.
   */
  voice: string;
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

/** Why the desk stopped, in words the run can show. */
export type DeskStopReason =
  | "protocol-satisfied"
  | "planner-failed"
  | "no-more-queries"
  | "time-ceiling"
  | "page-ceiling"
  | "hop-backstop";

export type DeskResearchOutcome = {
  /** The reading pass's findings, for the writing pack. "" when there are none. */
  findings: string;
  searches: number;
  pages: number;
  captures: DeskCapture[];
  /** The editor's research window in words, when one applied to this run. */
  window: string | null;
  /** Why the run stopped, and the model's reason when it gave one. */
  stopReason: DeskStopReason;
  stopDetail: string | null;
  /** Why nothing usable was found, or null when something was. */
  nothingFoundReason: string | null;
};

/** The clock, floored at a minute so a typo cannot make every run stop at once. */
export function deskResearchCeilingMs(): number {
  const raw = process.env.EDITORIAL_RESEARCH_CEILING_MS?.trim();
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : DESK_RESEARCH_CEILING_DEFAULT_MS;
}

/** The page ceiling, floored at one so a typo cannot forbid every read. */
export function deskResearchPageCeiling(): number {
  const raw = process.env.EDITORIAL_RESEARCH_PAGE_CEILING?.trim();
  const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DESK_RESEARCH_PAGE_CEILING_DEFAULT;
}

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
 * The whole planning answer: the queries AND the model's own stopping decision.
 *
 * U31 turned the plan into a decision, not just a query list. A model holding
 * the protocol is the only thing in this system that can judge "every
 * load-bearing claim has two independent sources" -- that is a judgement about
 * the piece -- so the loop asks it, every hop, and stops when it says stop.
 * `stop` absent reads as false: a model that answered only queries wants
 * another hop, and the ceiling is what bounds that.
 */
export function parseDeskPlan(raw: string): DeskPlan {
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let stop = false;
  let reason = "";
  let queries: string[] = [];
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        queries?: unknown;
        stop?: unknown;
        reason?: unknown;
      };
      stop = parsed.stop === true || parsed.stop === "true";
      reason = typeof parsed.reason === "string" ? parsed.reason.replace(/\s+/g, " ").trim() : "";
      if (Array.isArray(parsed.queries)) {
        queries = parsed.queries.filter((q): q is string => typeof q === "string");
      }
    } catch {
      /* the tolerant query reader below still gets the queries out */
    }
  }
  if (!queries.length) queries = parseDeskQueries(text);
  return { queries, stop, reason: reason.slice(0, 400) };
}

/**
 * The queries one hop will actually run: usable, windowed, and not already
 * asked. `junkQueryReason` decides what is usable -- the same rule the dig's
 * fallback path uses, and the reason the desk does not spend a search on a page
 * title or a scraped fragment.
 *
 * There is no cap here any more (U31 removed the six-search budget). What
 * bounds a hop is the ceiling the loop checks between searches, not a count
 * this function imposes.
 */
export function boundedDeskQueries(
  raw: readonly string[],
  input: { tried: Set<string>; window?: ResearchSnapshot | null },
): string[] {
  const out: string[] = [];
  for (const candidate of raw) {
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

/** Subject tokens, for choosing which of the newsroom's own records matter. */
function subjectTokens(subject: string, askedFor?: string): string[] {
  const tokens = [...queryTokens(subject), ...queryTokens(askedFor ?? "")]
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 3);
  return [...new Set(tokens)];
}

/** How well a piece of text answers this subject, 0 when it does not. */
function subjectScore(text: string, tokens: string[]): number {
  if (!tokens.length) return 0;
  const lowered = text.toLowerCase();
  return tokens.reduce((score, token) => score + (lowered.includes(token) ? 1 : 0), 0);
}

/**
 * The newsroom's own record, read before any general web search.
 *
 * The protocol's first stage is the local record, and the desk's version of it
 * is what this newsroom already has: the city's PrimeGov portal (agendas,
 * packets, minutes -- the PDFs, read here, which is also where OCR happens), the
 * meeting transcripts the desk captured, and any page it already captured for
 * this beat. All of it is newsroom-scoped reads and the same `fetchPage` /
 * `capture` seams everything else uses, so a test fakes it exactly like the
 * rest of the pass.
 *
 * Nothing here is fatal. A newsroom with no portal, no transcripts and no
 * captures is the ordinary case for a paper that has just been set up; the
 * phase then contributes its notes and no reading, and the web search carries
 * the run.
 *
 * Exported for the L1 test of the pre-merge audit: `DeskResearchDeps.localRecords`
 * is the seam the rest of the tests use, so the production reader -- the one
 * whose packet loop needed the clock -- had no test at all. `io.expired` is what
 * that test drives.
 */
export async function collectLocalRecords(
  input: {
    userId: string;
    newsroomId: number;
    subject: string;
    askedFor?: string;
    officialHosts: string[];
    pageCeiling: number;
  },
  io: {
    fetchPage: DeskFetchFn;
    capture: DeskCaptureFn;
    reading: DeskReading[];
    onStage: (stage: string) => Promise<void>;
    throwIfCancelled: () => Promise<void>;
    /**
     * L1 of the pre-merge audit: has the run's thirty minutes run out?
     *
     * The ceiling used to be tested per hop and per query, and the PrimeGov
     * packet reads sit inside a single query's work -- four meetings, one
     * compiled PDF each, and a scanned one is OCR'd rather than skipped. A slow
     * portal could therefore spend the whole ceiling here and hand the outer
     * loop a reading list it had already overshot. Asked per page, the same way
     * the web read loop asks it.
     */
    expired: () => boolean;
    /**
     * The portal itself, injectable for the same reason every other outside
     * world here is: the real one validates and resolves a public hostname, so
     * a test of the packet loop cannot reach it without a network. Production
     * never passes this.
     */
    readPortal?: (origin: string) => Promise<PrimeGovPortalRead>;
    sql: Sql;
  },
): Promise<DeskLocalRecords> {
  const readPortal = io.readPortal ?? readPrimeGovPortal;
  const tokens = subjectTokens(input.subject, input.askedFor);
  const notes: string[] = [];
  let portalOrigin: string | null = null;

  await io.onStage(`${DESK_RESEARCH_STAGE}: checking the newsroom's own record`);

  // 1. The city's PrimeGov portal: agendas, packets, minutes.
  try {
    portalOrigin = await primeGovOriginForNewsroom(io.sql, input.newsroomId);
  } catch {
    portalOrigin = null; // no sources table yet, or an unreadable one
  }
  if (portalOrigin) {
    try {
      const read = await readPortal(portalOrigin);
      if (read.ok || read.meetings.length) {
        const chosen = read.meetings
          .map((meeting) => ({ meeting, score: subjectScore(meeting.title, tokens) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || (a.meeting.dateTime < b.meeting.dateTime ? 1 : -1))
          .slice(0, 4);
        notes.push(
          `THE CITY'S OWN PORTAL (PrimeGov, ${portalOrigin}): ${read.meetings.length} meetings on file` +
            (read.failure ? ` (PARTIAL: ${read.failure})` : "") +
            (chosen.length
              ? `. Meetings that name this subject: ${chosen
                  .map((row) => `${row.meeting.date} ${row.meeting.title}`)
                  .join("; ")}`
              : ". No meeting title names this subject."),
        );
        // The packets and minutes themselves, read here: these are PDFs, and a
        // scanned one is transcribed rather than skipped, because a local
        // primary document is exactly what the protocol's second stopping
        // condition asks for.
        for (const { meeting } of chosen) {
          if (io.reading.length >= input.pageCeiling) break;
          if (io.expired()) break;
          await io.throwIfCancelled();
          for (const doc of preferredDocuments(meeting).slice(0, 1)) {
            if (io.reading.length >= input.pageCeiling) break;
            if (io.expired()) break;
            const url = compiledDocumentUrl(portalOrigin, doc);
            if (boilerplatePageReason(url)) continue;
            const readPage = await readAndCapture(url, doc.templateName || meeting.title, {
              ...io,
              kind: "packet",
            });
            if (readPage) io.reading.push(readPage);
          }
        }
      }
    } catch {
      // A portal that cannot be read is a note, not a failed run.
      notes.push(`THE CITY'S OWN PORTAL (PrimeGov, ${portalOrigin}): could not be read for this piece.`);
    }
  }

  // 2. The meeting transcripts this desk captured, matched on the subject.
  try {
    const artifacts = await io.sql<{ id: number; video_id: string }>`
      select id, video_id from meeting_transcript_artifacts
      where newsroom_id = ${input.newsroomId} and artifact_type = 'transcript'
      order by id desc limit 3
    `;
    if (artifacts.length) {
      const ids = artifacts.map((row) => row.id);
      const videoByArtifact = new Map(artifacts.map((row) => [row.id, row.video_id]));
      const segments = await io.sql<{
        artifact_id: number;
        segment_index: number;
        start_seconds: number | string;
        excerpt: string;
      }>`
        select artifact_id, segment_index, start_seconds, excerpt
        from meeting_transcript_segments
        where artifact_id = any(${ids}::int[])
        order by artifact_id desc, segment_index asc
        limit 600
      `;
      const matched = segments
        .map((segment) => ({ segment, score: subjectScore(segment.excerpt, tokens) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
      if (matched.length) {
        notes.push(
          `CAPTURED MEETING TRANSCRIPTS (${artifacts.length} on file, ${matched.length} passages naming this subject).`,
        );
        const videoId = videoByArtifact.get(matched[0]!.segment.artifact_id) ?? "";
        io.reading.push({
          kind: "transcript",
          title: `Captured meeting transcript ${videoId}`,
          url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
          captureEventId: null,
          versionId: null,
          // The transcript is already the newsroom's own record, so what
          // identifies the passages is the clock, not a stored page.
          locator: `${clock(Number(matched[0]!.segment.start_seconds))} (segment ${matched[0]!.segment.segment_index})`,
          text: matched
            .map(
              (row) =>
                `[${clock(Number(row.segment.start_seconds))}; segment ${row.segment.segment_index}] ${row.segment.excerpt}`,
            )
            .join("\n"),
        });
      } else {
        notes.push(`CAPTURED MEETING TRANSCRIPTS: ${artifacts.length} on file, none naming this subject.`);
      }
    }
  } catch {
    // No meeting tables in this database, or no transcripts captured.
  }

  // 3. What this desk already captured that bears on the subject.
  try {
    const rows = await io.sql<{
      url: string;
      title: string;
      full_text: string;
      capture_event_id: number | null;
      version_id: number | null;
      fetch_status: number | null;
      fetch_outcome: string | null;
    }>`
      select av.url, av.title, av.full_text, av.fetch_status, av.fetch_outcome,
             av.id as version_id, a.capture_event_id
      from artifact_versions av
      left join artifacts a on a.version_id = av.id and a.newsroom_id = av.newsroom_id
      where av.newsroom_id = ${input.newsroomId}
      order by av.id desc limit 60
    `;
    const picked = rows
      .map((row) => ({ row, score: subjectScore(`${row.title} ${row.full_text.slice(0, 2000)}`, tokens) }))
      .filter(({ row, score }) => {
        if (score <= 0) return false;
        if (boilerplatePageReason(row.url)) return false;
        return (
          readableCapture({
            text: row.full_text,
            status: row.fetch_status,
            outcome: row.fetch_outcome,
            title: row.title,
          }).kind === "ok"
        );
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    if (picked.length) {
      notes.push(
        `PAGES THIS DESK ALREADY CAPTURED on this subject: ${picked
          .map(({ row }) => `${row.title || row.url} (${row.url})`)
          .join("; ")}`,
      );
      for (const { row } of picked) {
        io.reading.push({
          kind: "capture",
          title: row.title || row.url,
          url: row.url,
          captureEventId: row.capture_event_id ?? null,
          versionId: row.version_id ?? null,
          locator: null,
          text: readableCapture({
            text: row.full_text,
            status: row.fetch_status,
            outcome: row.fetch_outcome,
            title: row.title,
          }).body,
        });
      }
    }
  } catch {
    // No artifact tables yet.
  }

  if (input.officialHosts.length) {
    notes.push(
      `THE PAPER'S OWN OFFICIAL HOSTS: ${input.officialHosts.join(", ")}. Search these before the open web.`,
    );
  }

  return { notes: notes.join("\n"), reading: io.reading };
}

/** A transcript clock, the same `hh:mm:ss` shape the meeting desk prints. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00";
  const total = Math.floor(seconds);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Open one page and record it: the fetch, the readability bar the Dark Desk
 * holds captures to (`retrievePack`, Dark Desk F6), and the capture write.
 * Returns null for anything the desk will not stand behind.
 */
async function readAndCapture(
  url: string,
  fallbackTitle: string,
  io: {
    fetchPage: DeskFetchFn;
    capture: DeskCaptureFn;
    throwIfCancelled: () => Promise<void>;
    kind: DeskReading["kind"];
  },
): Promise<DeskReading | null> {
  await io.throwIfCancelled();
  let page: DeskFetchedPage;
  try {
    page = await io.fetchPage(url);
  } catch {
    return null;
  }
  const readable = readableCapture({
    text: page?.text ?? "",
    extractionMethod: page?.extractionMethod,
    status: page?.status,
    outcome: page?.outcome,
    title: page?.title,
  });
  // A blocked page is a paywall notice or an error shell, not evidence: the
  // same bar `retrievePack` holds captures to before a model reads them.
  if (!page?.ok || readable.kind !== "ok") return null;
  const title = page.title || fallbackTitle || url;
  try {
    const record = await io.capture({
      url,
      title,
      text: page.text,
      status: page.status,
      outcome: page.outcome,
      pages: page.pages ?? [],
      extractionMethod: page.extractionMethod ?? "",
    });
    return {
      kind: io.kind,
      title,
      url,
      captureEventId: record.captureEventId,
      versionId: record.versionId,
      locator: null,
      text: readable.body.slice(0, DESK_PAGE_TEXT_CAP),
    };
  } catch {
    // A page the desk cannot record is a page it cannot stand behind: dropped
    // rather than cited from a copy nobody can open.
    return null;
  }
}

/**
 * The desk's research pass. Never throws for a research failure: a search
 * provider that answers nothing, a page that will not open, a planner that
 * returns prose -- each of those is a smaller reading set and an honest "found
 * nothing usable" in the writing pack, because the piece still has to be
 * written from what the editor supplied.
 *
 * It DOES throw when the editor pressed Stop: `throwIfCancelled` is the U25
 * seam and it throws `JobCancelledError`, which has to leave this loop rather
 * than be mistaken for a run that finished.
 */
export async function runDeskResearch(
  input: DeskResearchInput,
  deps: DeskResearchDeps = {},
): Promise<DeskResearchOutcome> {
  const startedAt = (deps.now?.() ?? new Date()).getTime();
  const nowMs = () => (deps.now?.() ?? new Date()).getTime();
  const ceilingMs = deps.ceilingMs ?? deskResearchCeilingMs();
  const pageCeiling = deps.pageCeiling ?? deskResearchPageCeiling();
  const onStage = deps.onStage ?? (async () => {});
  const throwIfCancelled = deps.throwIfCancelled ?? (async () => {});
  const officialDomains = [
    ...new Set([...(input.paper?.officialHosts ?? []), ...(input.paper?.officialDomains ?? [])]),
  ];
  const localityStopwords = [input.paper?.city ?? "", input.paper?.state ?? ""].filter(Boolean);
  /*
    Opened on first use, not on entry: a run whose search, fetch, capture and
    local-record readers are all faked never touches a database at all, which is
    what keeps the hermetic tests hermetic (and what stops them standing up a
    PGlite they have no use for).
  */
  let sqlCache: Sql | null = null;
  const sql = async () => (sqlCache ??= await getSql());

  const window = deps.readWindow
    ? await deps.readWindow(input.newsroomId)
    : await defaultReadWindow(input.newsroomId, await Promise.resolve(new Date(startedAt)));

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
      /*
        OCR is ALLOWED here, unlike the pull reader's `allowModelOcr: false`.
        `--` The protocol's local-record stage is packets, minutes and tapes,
        and a scanned packet the desk refuses to read is a local primary
        document it cannot cite; `beforeModelCall` is the Stop seam reaching
        the OCR path, so a cancelled run does not finish transcribing a packet
        nobody will read.
      */
      ingestDocument(url, { allowModelOcr: true, beforeModelCall: throwIfCancelled }));

  const capture: DeskCaptureFn = deps.capture ?? (async (page) => {
    const record = await rememberCapture({
      sql: await sql(),
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
      (`capture_events.editorial_request_id`, migrations/0114). It is a
      separate statement because `rememberCapture` is the Dark Desk's own write
      and takes no argument for it -- and because a capture written by any other
      path must keep the column null.
    */
    if (input.requestId != null) {
      const db = await sql();
      await db`
        update capture_events set editorial_request_id = ${input.requestId}
        where id = ${record.captureEventId} and editorial_request_id is null
      `;
    }
    return { captureEventId: record.captureEventId, versionId: record.versionId };
  });

  const reading: DeskReading[] = [];
  const tried = new Set<string>();
  const degraded: string[] = [];
  let searches = 0;
  let stopReason: DeskStopReason = "no-more-queries";
  let stopDetail: string | null = null;
  /*
    A ceiling reached INNERMOST has to unwind two loops. It is tracked here
    rather than read back off `stopReason`, because that is the one place the
    loops can agree on without the compiler's own narrowing of a `let` that is
    only assigned inside them getting in the way.
  */
  let hitCeiling: DeskStopReason | null = null;

  // The arrival, once, in the exact words the job's stage list carries.
  await onStage(DESK_RESEARCH_STAGE);

  /*
    THE LOCAL RECORD FIRST, in the protocol's own order. A paper's own portal,
    its captured tapes and the pages it already holds are the records a
    local-news editorial is built on, and they are read before any general web
    search rather than after it.
  */
  let local: DeskLocalRecords = { notes: "", reading: [] };
  try {
    local = deps.localRecords
      ? await deps.localRecords({
          newsroomId: input.newsroomId,
          subject: input.subject,
          askedFor: input.askedFor,
          officialHosts: input.paper?.officialHosts ?? [],
        })
      : await collectLocalRecords(
          {
            userId: input.userId,
            newsroomId: input.newsroomId,
            subject: input.subject,
            askedFor: input.askedFor,
            officialHosts: input.paper?.officialHosts ?? [],
            pageCeiling,
          },
          {
            fetchPage,
            capture,
            reading,
            onStage,
            throwIfCancelled,
            expired: () => nowMs() - startedAt >= ceilingMs,
            sql: await sql(),
          },
        );
  } catch (error) {
    if (error instanceof Error && error.name === "JobCancelledError") throw error;
    local = { notes: "", reading: [] };
  }
  // The faked path fills `reading` through its return value, not the array.
  if (deps.localRecords) reading.push(...local.reading);

  /*
    THE PAPER'S OWN OFFICIAL HOSTS, before the open web.

    The last of the protocol's local-record steps and the one that is a search
    rather than a read: the city's own site is where the record lives when the
    desk has not already captured it, so the desk searches it directly instead
    of waiting for the model to think of it. One scoped search per host, run
    before any query the model names -- "official hosts before general web
    search", in that order and in the run's own record.
  */
  const subjectWords = queryTokens(`${input.subject} ${input.askedFor ?? ""}`).slice(0, 6).join(" ");
  for (const host of (input.paper?.officialHosts ?? []).slice(0, 2)) {
    if (!subjectWords) break;
    if (reading.length >= pageCeiling) {
      hitCeiling = "page-ceiling";
      break;
    }
    if (nowMs() - startedAt >= ceilingMs) {
      hitCeiling = "time-ceiling";
      break;
    }
    await throwIfCancelled();
    const query = window
      ? queryWithResearchWindow(`site:${host} ${subjectWords}`, window)
      : `site:${host} ${subjectWords}`;
    if (junkQueryReason(query)) continue;
    tried.add(query.toLowerCase());
    searches += 1;
    await onStage(`${DESK_RESEARCH_STAGE}: search ${searches} on the paper's own site`);
    let scoped: DeskSearchAttempt;
    try {
      scoped = await search(query);
    } catch {
      continue;
    }
    for (const hit of scoped.hits) {
      if (reading.length >= pageCeiling) {
        hitCeiling = "page-ceiling";
        break;
      }
      if (boilerplatePageReason(hit.url)) continue;
      const readPage = await readAndCapture(hit.url, hit.title, {
        fetchPage,
        capture,
        throwIfCancelled,
        kind: "page",
      });
      if (readPage) reading.push(readPage);
    }
    if (hitCeiling) break;
  }

  for (let hop = 1; hop <= DESK_RESEARCH_HOP_BACKSTOP; hop++) {
    if (hitCeiling) {
      stopReason = hitCeiling;
      break;
    }
    await throwIfCancelled();
    if (reading.length >= pageCeiling) {
      stopReason = "page-ceiling";
      break;
    }
    if (nowMs() - startedAt >= ceilingMs) {
      stopReason = "time-ceiling";
      break;
    }

    const planned = deps.plan
      ? await deps.plan(
          input.voice,
          buildDeskPlanPack({
            researchPack: input.researchPack,
            localNotes: local.notes,
            hop,
            tried: [...tried],
            read: reading.map((r) => ({ title: r.title, url: r.url })),
            officialDomains,
            window: window ? windowWords(window) : null,
          }),
        )
      : null;
    if (!planned) {
      stopReason = "planner-failed";
      break;
    }
    if (!planned.ok) {
      stopReason = "planner-failed";
      stopDetail = planned.error;
      break;
    }

    const plan = parseDeskPlan(planned.text);
    const queries = boundedDeskQueries(plan.queries, { tried, window });
    await onStage(
      `${DESK_RESEARCH_STAGE}: ${reading.length} read, searching ${queries.length} more (round ${hop})`,
    );

    for (const query of queries) {
      await throwIfCancelled();
      if (reading.length >= pageCeiling) {
        hitCeiling = "page-ceiling";
        break;
      }
      if (nowMs() - startedAt >= ceilingMs) {
        hitCeiling = "time-ceiling";
        break;
      }
      searches += 1;
      await onStage(`${DESK_RESEARCH_STAGE}: search ${searches}`);

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
        if (reading.length >= pageCeiling) {
          hitCeiling = "page-ceiling";
          break;
        }
        /*
          L1 of the pre-merge audit: the clock, per PAGE and not only per
          query. One query's hit list is up to a handful of fetches, each with
          its own timeout, and on a slow day that is the ceiling spent inside a
          loop that never asked. Same variable as the page ceiling above, so the
          two loop levels unwind together.
        */
        if (nowMs() - startedAt >= ceilingMs) {
          hitCeiling = "time-ceiling";
          break;
        }
        // The same refusal list the dig runs (`searchWithFallback` applies it
        // to provider hits already; an injected or gateway search may not).
        if (boilerplatePageReason(hit.url)) continue;
        await onStage(`${DESK_RESEARCH_STAGE}: reading page ${reading.length + 1}`);
        const readPage = await readAndCapture(hit.url, hit.title, {
          fetchPage,
          capture,
          throwIfCancelled,
          kind: "page",
        });
        if (readPage) reading.push(readPage);
      }
      if (hitCeiling) break;
    }

    if (hitCeiling) {
      stopReason = hitCeiling;
      break;
    }

    /*
      THE MODEL'S OWN STOPPING DECISION, and the reason U31 exists. The protocol
      says when research is finished -- every load-bearing claim doubly sourced,
      two surprising facts with one local primary document -- and the model
      holding that protocol is the only thing here that can judge it.
    */
    if (plan.stop) {
      stopReason = "protocol-satisfied";
      stopDetail = plan.reason || null;
      break;
    }
    if (!queries.length) {
      stopReason = "no-more-queries";
      stopDetail = plan.reason || null;
      break;
    }
    if (hop === DESK_RESEARCH_HOP_BACKSTOP) {
      stopReason = "hop-backstop";
      break;
    }
  }

  await throwIfCancelled();

  /*
    The reading pass. It holds the voice too, and the captures and local records
    are all it has: the desk fetched the pages, so the model reads them.
  */
  let findings = "";
  if (reading.length && deps.read) {
    const budgeted: DeskReading[] = [];
    let used = 0;
    for (const item of reading) {
      if (used >= DESK_TOTAL_TEXT_CAP) break;
      const text = item.text.slice(0, Math.min(DESK_PAGE_TEXT_CAP, DESK_TOTAL_TEXT_CAP - used));
      used += text.length;
      budgeted.push({ ...item, text });
    }
    const read = await deps.read(
      input.voice,
      buildDeskFindingsPack({ subject: input.subject, askedFor: input.askedFor, reading: budgeted }),
    );
    findings = read.ok ? read.text.trim() : "";
  }

  const reason = nothingFound(reading.length, searches, degraded);
  /*
    Say what happened on the row the editor is watching. A piece with a thin
    appendix is otherwise indistinguishable from a desk that never looked, and
    the writing pack's own sentence goes to the model, not to them. The
    sentence is a detail, not an arrival: the chip stays where the desk pass put
    it.
  */
  await onStage(
    `${DESK_RESEARCH_STAGE}: stopped — ${stopSentence(stopReason, searches, reading.length)}`,
  );

  return {
    findings,
    searches,
    pages: reading.length,
    captures: reading.map(({ kind, url, title, captureEventId, versionId, locator }) => ({
      ...(kind === "transcript" ? { locator } : {}),
      url: url ?? "",
      title,
      captureEventId,
      versionId,
    })),
    window: window ? windowWords(window) : null,
    stopReason,
    stopDetail,
    nothingFoundReason: reason,
  };
}

/** The stop reason in one clause, for the run's stage line. */
export function stopSentence(reason: DeskStopReason, searches: number, pages: number): string {
  const counted = `${searches} ${searches === 1 ? "search" : "searches"}, ${pages} ${
    pages === 1 ? "page" : "pages"
  }`;
  switch (reason) {
    case "protocol-satisfied":
      return `the protocol's stopping conditions were met (${counted})`;
    case "time-ceiling":
      return `the research time ceiling was reached (${counted})`;
    case "page-ceiling":
      return `the page ceiling was reached (${counted})`;
    case "planner-failed":
      return `the planner could not answer (${counted})`;
    case "hop-backstop":
      return `the run's own backstop was reached (${counted})`;
    default:
      return `no further usable search was planned (${counted})`;
  }
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
