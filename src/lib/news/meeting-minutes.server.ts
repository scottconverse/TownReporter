import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "../db.ts";
import { fetchPublicLargeDocument } from "./fetch-url.ts";
import {
  compiledDocumentUrl,
  dateFromTitle,
  preferredDocuments,
  primeGovDocumentsForTitle,
  readPrimeGovPortal,
  type PrimeGovDocument,
  type PrimeGovMeeting,
} from "./primegov.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";
import { minutesSectionFor, minutesVoteRecords, minutesVotesByItem, type MinutesMotion } from "./meeting-minutes.ts";
import type { VoteRecord } from "./meeting-story-section5.ts";

/*
  Where a meeting's official minutes actually are, and what they say.

  A council can publish no minutes document on the meeting itself and still
  publish that meeting's minutes, because the NEXT meeting's packet carries
  them. Longmont is the case that produced this file: the Oct 6, 2026 Regular
  Session minutes are pages 6+ of the Oct 20 packet, and the portal lists no
  "Minutes" document on any 2026 council regular session.

  So the search is: the meeting's own Minutes document if the portal lists one,
  otherwise the packets of the next three meetings of the same body inside
  forty-five days. A packet is only ever read FOR ITS MINUTES SECTION -- the
  rest of a packet is where the votes are not.
*/

/** A packet is read to page 80; minutes are at the front of one. */
const MAX_PAGES = 80;
/** Nothing a city publishes as a packet is bigger, and this is a hard stop. */
const MAX_BYTES = 400 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const LOOKAHEAD_DAYS = 45;
const LOOKAHEAD_MEETINGS = 3;

export type MinutesDeps = {
  /** The portal's meeting lists. See ./primegov.ts `readPrimeGovPortal`. */
  portalMeetings?: (origin: string) => Promise<PrimeGovMeeting[]>;
  /** The meeting itself, by the video's title. See ./primegov.ts. */
  findMeeting?: (title: string, origin: string) => Promise<{ meeting: PrimeGovMeeting; urls: string[] } | null>;
  /** Test seam: the text of a document, pages joined with a form feed. */
  documentText?: (url: URL) => Promise<string | null>;
  /**
   * One run's downloads, keyed by URL. Two meetings that read the same later
   * packet download it once. Never shared between runs.
   */
  documentCache?: Map<string, Promise<string | null>>;
};

export type MinutesRead = {
  records: (VoteRecord & { item: string })[];
  /** Where the minutes section was found, page included. Null when none was. */
  locator: string | null;
  reason: string;
};

const NO_MINUTES = "no minutes found for this meeting";

/**
 * The votes a meeting's minutes record.
 *
 * Returns the records and, when it found none, the reason in plain words so a
 * caller's log line can say whether the minutes were missing or just said
 * nothing this desk could read.
 */
export async function minutesVoteRecordsForMeeting(
  meeting: PrimeGovMeeting,
  origin: string,
  deps: MinutesDeps = {},
): Promise<MinutesRead> {
  const meetingDate =
    dateFromTitle(`${meeting.date} ${meeting.dateTime}`) ??
    dateFromTitle(meeting.date ?? "") ??
    (meeting.date ?? "");
  const bodyTitle = bodyOf(meeting.title);

  const own = preferredDocuments(meeting).find((document) => /\bminutes\b/i.test(document.templateName));
  if (own) {
    const url = documentUrl(origin, own);
    const text = await documentText(url, deps);
    if (text) {
      const records = minutesVoteRecords(minutesVotesByItem(text), url);
      if (records.length) return { records, locator: url, reason: "" };
    }
  }

  if (!meetingDate || !bodyTitle) return { records: [], locator: null, reason: NO_MINUTES };

  let later: { meeting: PrimeGovMeeting; at: number }[];
  try {
    const meetings = await (deps.portalMeetings ?? portalMeetingsAt)(origin);
    const target = Date.parse(meetingDate);
    later = meetings
      .filter((candidate) => candidate.id !== meeting.id && bodyOf(candidate.title) === bodyTitle)
      .map((candidate) => ({ meeting: candidate, at: Date.parse(candidate.dateTime || candidate.date) }))
      .filter(({ at }) => Number.isFinite(at) && at > target && at - target <= LOOKAHEAD_DAYS * 86_400_000)
      // An executive session is closed to the public and carries no minutes.
      .filter(({ meeting: candidate }) => !/\bexecutive\b/i.test(candidate.title))
      .sort((a, b) => a.at - b.at);
  } catch {
    return { records: [], locator: null, reason: NO_MINUTES };
  }

  // A council approves the previous meeting's minutes at a REGULAR session; a
  // study or work session of the same body in between is not where they land.
  // Prefer Regular Sessions. Only when the window has none at all fall back to
  // whatever non-executive meeting lists a Packet, nearest first.
  const regularSessions = later.filter(({ meeting: candidate }) => /regular session/i.test(candidate.title));
  const lookAhead = (
    regularSessions.length
      ? regularSessions
      : later.filter(({ meeting: candidate }) =>
          preferredDocuments(candidate).some((document) => /\bpacket\b/i.test(document.templateName)),
        )
  ).slice(0, LOOKAHEAD_MEETINGS);

  for (const { meeting: candidate } of lookAhead) {
    const packet = preferredDocuments(candidate).find((document) => /\bpacket\b/i.test(document.templateName));
    if (!packet) continue;
    const url = documentUrl(origin, packet);
    const text = await documentText(url, deps);
    if (!text) continue;
    const section = minutesSectionFor(text, { bodyTitle, meetingDate });
    if (!section) continue;
    const locator = `${url}#page=${section.page}`;
    const records = minutesVoteRecords(minutesVotesByItem(section.text), locator);
    if (records.length) return { records, locator, reason: "" };
  }
  return { records: [], locator: null, reason: NO_MINUTES };
}

async function portalMeetingsAt(origin: string): Promise<PrimeGovMeeting[]> {
  const read = await readPrimeGovPortal(origin);
  return read.meetings;
}

function documentUrl(origin: string, document: PrimeGovDocument): string {
  return new URL(compiledDocumentUrl(origin, document), origin).toString();
}

/**
 * A meeting title's body: everything that is not the kind of session or a date.
 * "City Council Regular Session" and "City Council Study Session" are one body.
 */
export function bodyOf(title: string): string {
  return title
    .replace(/\b(?:regular|study|special|work|executive|joint|continued)?\s*session\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}\b/gi, " ")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function documentText(url: string, deps: MinutesDeps): Promise<string | null> {
  const cache = deps.documentCache;
  if (!cache) return loadDocumentText(url, deps);
  let pending = cache.get(url);
  if (!pending) {
    pending = loadDocumentText(url, deps);
    cache.set(url, pending);
  }
  return pending;
}

async function loadDocumentText(url: string, deps: MinutesDeps): Promise<string | null> {
  if (deps.documentText) return deps.documentText(new URL(url));
  try {
    return await fetchDocumentText(url);
  } catch {
    return null;
  }
}

/**
 * Download a (possibly very large) document and extract its first pages.
 *
 * Streamed to a temp file with a byte cap and a three-minute timeout, then
 * deleted whatever happened: a packet is 190 MB in the real case, and neither
 * a memory buffer nor a leftover file is acceptable.
 */
export async function fetchDocumentText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const directory = await mkdtemp(join(tmpdir(), "townreporter-minutes-"));
  const file = join(directory, "document.pdf");
  try {
    const response = await fetchPublicLargeDocument(new URL(url), {
      maxBytes: MAX_BYTES,
      signal: controller.signal,
      hops: 4,
    });
    if (!response.ok || !response.body) throw new Error(`the minutes document answered ${response.status}`);
    const handle = await import("node:fs/promises").then((fs) => fs.open(file, "w"));
    try {
      let total = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > MAX_BYTES) throw new Error("the minutes document is larger than this reader will fetch");
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
    const bytes = new Uint8Array(await readFile(file));
    return await extractPages(bytes, MAX_PAGES);
  } finally {
    clearTimeout(timer);
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Page text, page by page, for the first `maxPages` -- never the whole file's
 * merged text: the merged form loses the page boundaries this reader records
 * in a provenance locator, and a 190 MB packet has no business being rendered
 * past the minutes.
 */
async function extractPages(bytes: Uint8Array, maxPages: number): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  try {
    const pages: string[] = [];
    const last = Math.min(pdf.numPages, maxPages);
    for (let pageNumber = 1; pageNumber <= last; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as { str?: string; hasEOL?: boolean }[])
        .filter((item) => item.str != null)
        .map((item) => item.str! + (item.hasEOL ? "\n" : ""))
        .join("");
      pages.push(text);
    }
    // The form feed is what `minutesSectionFor` counts to report a page number.
    return pages.join("\n\f\n");
  } finally {
    try {
      await (pdf as unknown as { loadingTask?: { destroy?: () => Promise<void> } }).loadingTask?.destroy?.();
    } catch {
      // The text is already in hand; a document that will not close is not fatal.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Catch-up for meetings already captured (D214 amendment)             */
/* ------------------------------------------------------------------ */

const CATCHUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CATCHUP_WINDOW_DAYS = 60;
const CATCHUP_MEETINGS = 3;

/** One run per newsroom per six hours, held for the life of the process. */
const lastCatchUp = new Map<number, number>();

export type MinutesCatchUpDeps = MinutesDeps & {
  now?: () => number;
  originFor?: (sql: Sql, newsroomId: number) => Promise<string | null>;
};

export type MinutesCatchUpEntry = {
  videoId: string;
  title: string;
  /** Rows the minutes established this run. */
  established: number;
  /** Rows that were unestablished when the run started. */
  unestablished: number;
  /** Why nothing was established, when nothing was. */
  reason: string;
};

export type MinutesCatchUpResult = { meetings: MinutesCatchUpEntry[] };

/**
 * Give already-captured meetings the votes their minutes recorded.
 *
 * Only rows that are `established = false` are touched, so a structured vote
 * record is never overwritten. At most three meetings per run, oldest first,
 * and only meetings from the last sixty days -- the window where a later
 * packet can still be expected to carry the minutes.
 */
export async function catchUpVotesFromMinutes(
  sql: Sql,
  newsroomId: number,
  deps: MinutesCatchUpDeps = {},
): Promise<MinutesCatchUpResult> {
  const now = deps.now?.() ?? Date.now();
  const prior = lastCatchUp.get(newsroomId);
  if (prior !== undefined && now - prior < CATCHUP_INTERVAL_MS) return { meetings: [] };

  const pending = await sql.query<{
    video_id: string; title: string | null; published: string | null; unestablished: number;
  }>(
    `select v.video_id as video_id, r.title as title, r.published as published, count(*)::int as unestablished
       from meeting_structured_votes v
       left join meeting_capture_records r
         on r.newsroom_id = v.newsroom_id and r.video_id = v.video_id
      where v.newsroom_id = $1 and v.established = false
      group by v.video_id, r.title, r.published`,
    [newsroomId],
  );

  const cutoff = now - CATCHUP_WINDOW_DAYS * 86_400_000;
  const meetings = pending
    .map((row) => ({
      videoId: row.video_id,
      title: row.title ?? "",
      unestablished: Number(row.unestablished),
      at: Date.parse(dateFromTitle(row.title ?? "") ?? row.published ?? ""),
    }))
    .filter((row) => Number.isFinite(row.at) && row.at >= cutoff && row.at <= now + 86_400_000)
    .sort((a, b) => a.at - b.at)
    .slice(0, CATCHUP_MEETINGS);

  if (!meetings.length) {
    lastCatchUp.set(newsroomId, now);
    return { meetings: [] };
  }

  const origin = await (deps.originFor ?? primeGovOriginForNewsroom)(sql, newsroomId);
  if (!origin) return { meetings: [] };

  // One download per packet per run: several meetings can read the same later
  // packet for their minutes, and a packet is 190 MB in the real case.
  const readDeps: MinutesDeps = { ...deps, documentCache: new Map() };

  const done: MinutesCatchUpEntry[] = [];
  for (const meeting of meetings) {
    const found = await (deps.findMeeting ?? primeGovDocumentsForTitle)(meeting.title, origin).catch(() => null);
    if (!found) {
      done.push({ videoId: meeting.videoId, title: meeting.title, established: 0, unestablished: meeting.unestablished, reason: "no minutes found (the portal does not list this meeting)" });
      continue;
    }
    const read = await minutesVoteRecordsForMeeting(found.meeting, origin, readDeps).catch(() => ({
      records: [],
      locator: null,
      reason: NO_MINUTES,
    }));
    const byKey = new Map(read.records.map((record) => [record.item.toUpperCase(), record]));
    const rows = await sql.query<{ item: string; provenance: string }>(
      "select item,provenance from meeting_structured_votes where newsroom_id=$1 and video_id=$2 and established=false",
      [newsroomId, meeting.videoId],
    );
    let established = 0;
    for (const row of rows) {
      const record = byKey.get(row.item.toUpperCase());
      if (!record) continue;
      const kept = provenanceApart(parseProvenance(row.provenance));
      const provenance = [
        { source: "minutes", locator: record.locator ?? null, excerpt: record.excerpt ?? undefined },
        ...kept,
      ];
      const updated = await sql.query(
        `update meeting_structured_votes
            set established=true, motion=$4, mover=$5, seconder=$6, tally=$7, result=$8,
                source=$9, provenance=$10, disagreements=$11
          where newsroom_id=$1 and video_id=$2 and item=$3 and established=false
          returning id`,
        [
          newsroomId,
          meeting.videoId,
          row.item,
          record.motion,
          record.mover,
          record.seconder,
          record.tally,
          record.result,
          "minutes",
          JSON.stringify(provenance),
          JSON.stringify(record.notes ?? []),
        ],
      );
      if (updated.length) established += 1;
    }
    done.push({
      videoId: meeting.videoId,
      title: meeting.title,
      established,
      unestablished: meeting.unestablished,
      reason: established ? "" : read.reason || `minutes list no motion under items ${rows.map((row) => row.item).join(", ")}`,
    });
  }

  lastCatchUp.set(newsroomId, now);
  return { meetings: done };
}

function parseProvenance(raw: string): { source?: string; locator?: string | null; excerpt?: string }[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? (parsed as { source?: string }[]) : [];
  } catch {
    return [];
  }
}

/** Provenance from any earlier read is kept; an older minutes entry is replaced. */
function provenanceApart(entries: { source?: string; locator?: string | null; excerpt?: string }[]) {
  return entries.filter((entry) => entry?.source !== "minutes");
}

/**
 * The hourly clock's entry point: catch up every newsroom's minutes votes.
 *
 * Each newsroom is independent -- a portal that is down for one must not cost
 * another its catch-up -- and one line per meeting is logged with the count, or
 * with the reason none were established.
 */
export async function tickMinutesVotes(sql: Sql): Promise<void> {
  const newsrooms = await sql.query<{ id: number }>("select id from newsrooms order by id");
  for (const newsroom of newsrooms) {
    try {
      const result = await catchUpVotesFromMinutes(sql, newsroom.id);
      for (const entry of result.meetings) {
        console.log(
          entry.established
            ? `[townreporter] minutes votes: ${entry.videoId} ${entry.title}: established ${entry.established} of ${entry.unestablished}`
            : `[townreporter] minutes votes: ${entry.videoId} ${entry.title}: established 0 of ${entry.unestablished} (${entry.reason})`,
        );
      }
    } catch (err) {
      console.error(`[townreporter] minutes votes: newsroom ${newsroom.id} catch-up failed:`, err);
    }
  }
}

export type { MinutesMotion };
