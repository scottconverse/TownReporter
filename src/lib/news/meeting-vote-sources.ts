import { fetchPublicHttp } from "./fetch-url.ts";
import type { VoteRecord, VoteSource } from "./meeting-story-section5.ts";

export const STRUCTURED_VOTE_ORIGIN = "https://longmontcitycouncil.org";

export type VoteSourceAvailability = {
  structuredRecord: string;
  minutes: string;
  packet: string;
  transcript: string;
};

/**
 * Explicit per-source availability. A source that is not available for a given
 * meeting is reported by name rather than silently omitted.
 */
export function voteSourceAvailability(input: {
  structuredRecordFound: boolean;
  minutesFound: boolean;
  packetFound: boolean;
  transcriptFound: boolean;
}): VoteSourceAvailability {
  return {
    structuredRecord: input.structuredRecordFound
      ? "available: longmontcitycouncil.org structured record"
      : "not available: no longmontcitycouncil.org record for this meeting",
    minutes: input.minutesFound
      ? "available: official minutes"
      : "not available: no official minutes document for this meeting",
    packet: input.packetFound
      ? "available: PrimeGov packet vote data"
      : "not available: packet carried no structured vote data",
    transcript: input.transcriptFound
      ? "corroboration only: transcript is never used as a tally"
      : "not available: no transcript span for this item",
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function field(block: string, label: RegExp): string {
  const text = stripTags(block);
  const m = text.match(label);
  if (!m) return "";
  // Stop the captured value at the next labelled field so "Moved by: Popkin
  // Seconded by: ..." yields "Popkin", not the rest of the block.
  const raw = (m[1] ?? "").split(/\b(?:Motion|Moved by|Mover|Seconded by|Result|Tally|Item)\s*:/i)[0] ?? "";
  return raw.trim();
}

function normaliseTally(raw: string): string {
  const m = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

/**
 * Parse a longmontcitycouncil.org meeting page into structured vote records.
 * The page is server-rendered HTML with one block per motion carrying the item
 * number, motion text, mover, seconder, result, and tally.
 */
export type ParsedVoteRecord = VoteRecord & { item: string };

export function parseStructuredVotePage(html: string): ParsedVoteRecord[] {
  const out: ParsedVoteRecord[] = [];
  const blocks = html.split(/<(?:div|tr|article|li)\b[^>]*(?:class|id)="[^"]*motion[^"]*"[^>]*>/i).slice(1);
  const candidates = blocks.length ? blocks : [html];
  for (const rawBlock of candidates) {
    const block = rawBlock.split(/<\/(?:div|tr|article|li)>/i)[0] ?? rawBlock;
    const item = stripTags(block).match(/\b([OR]-\d{4}-\d{1,4})\b/i)?.[1] ?? "";
    if (!item) continue;
    const motion = field(block, /motion\s*:?\s*([^<]{5,300})/i);
    const mover = field(block, /(?:moved\s+by|mover)\s*:?\s*([A-Z][^<]{1,60})/i);
    const seconder = field(block, /seconded\s+by\s*:?\s*([A-Z][^<]{1,60})/i);
    const resultRaw = field(block, /result\s*:?\s*(Passed|Failed)/i);
    const tallyRaw = field(block, /tally\s*:?\s*([0-9]+\s*[-–]\s*[0-9]+)/i);
    const tally = normaliseTally(tallyRaw);
    if (!tally) continue;
    out.push({
      item,
      motion: motion || item,
      mover,
      seconder,
      tally,
      result: resultRaw || "not established",
      source: "longmontcitycouncil.org" as VoteSource,
    });
  }
  return out;
}

function meetingUrl(date: string): string {
  const iso = date.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!iso) return `${STRUCTURED_VOTE_ORIGIN}/meetings/`;
  return `${STRUCTURED_VOTE_ORIGIN}/meetings/${iso[1]}-${iso[2]}-${iso[3]}/`;
}

export type StructuredVoteFetchResult = {
  found: boolean;
  reason: string;
  records: ParsedVoteRecord[];
  url: string;
};

/**
 * Fetch structured vote records for a meeting date. Returns an explicit reason
 * when the record does not exist (the site trails by roughly three weeks), never
 * an invented vote.
 */
export async function fetchStructuredVotesForDate(date: string): Promise<StructuredVoteFetchResult> {
  const url = meetingUrl(date);
  try {
    const res = await fetchPublicHttp(new URL(url));
    if (!res.ok) {
      return { found: false, reason: `longmontcitycouncil.org returned HTTP ${res.status} for ${url}`, records: [], url };
    }
    const records = parseStructuredVotePage(await res.text());
    if (!records.length) {
      return { found: false, reason: `longmontcitycouncil.org page had no structured motion records: ${url}`, records: [], url };
    }
    return { found: true, reason: "structured vote records found", records, url };
  } catch (error) {
    return { found: false, reason: `longmontcitycouncil.org fetch failed: ${error instanceof Error ? error.message : String(error)}`, records: [], url };
  }
}
