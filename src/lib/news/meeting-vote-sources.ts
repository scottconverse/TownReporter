import { fetchPublicHttp } from "./fetch-url.ts";
import type { VoteRecord, VoteSource } from "./meeting-story-section5.ts";

export type VoteSourceAvailability = {
  structuredRecord: string;
  minutes: string;
  packet: string;
  transcript: string;
};

/** `example.org` from `https://example.org/meetings/`. The origin itself when it does not parse. */
export function voteSourceHost(origin: string): string {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

/**
 * Explicit per-source availability. A source that is not available for a given
 * meeting is reported by name rather than silently omitted -- including the
 * case where the paper has configured no structured vote source at all, which
 * is why the lookup never happened (`structuredSource` is the configured
 * source's host, or null).
 */
export function voteSourceAvailability(input: {
  /** The structured vote source this paper configured, by host. Null when it has none. */
  structuredSource: string | null;
  structuredRecordFound: boolean;
  minutesFound: boolean;
  packetFound: boolean;
  transcriptFound: boolean;
}): VoteSourceAvailability {
  return {
    structuredRecord: !input.structuredSource
      ? "not available: this paper has no structured vote source configured"
      : input.structuredRecordFound
        ? `available: ${input.structuredSource} structured record`
        : `not available: no ${input.structuredSource} record for this meeting`,
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

/**
 * Parse a council-votes meeting page into structured vote records. The page is
 * server-rendered HTML with one block per motion carrying the item number,
 * motion text, mover, seconder, result, and tally.
 *
 * The parser reads the page's shape, not its host: whichever paper's structured
 * source points here supplies the URL (./structured-vote-source.ts).
 */
export type ParsedVoteRecord = VoteRecord & { item: string };

export function parseStructuredVotePage(html: string): ParsedVoteRecord[] {
  const out: ParsedVoteRecord[] = [];
  const itemRe = /<span class="ord-num">([A-Z]-\d{4}-\d{1,4})<\/span>/g;
  const marks: { item: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html))) marks.push({ item: m[1]!, index: m.index });
  if (!marks.length) return out;

  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.index;
    const stop = i + 1 < marks.length ? marks[i + 1]!.index : html.length;
    const block = html.slice(start, stop);
    const item = marks[i]!.item;

    // Result badge: "badge-passed" / "badge-failed".
    const result = /badge-passed/i.test(block) ? "Passed" : /badge-failed/i.test(block) ? "Failed" : "";

    // Motion text: "NAME moved, seconded by NAME, to <action>".
    const motionMatch = block.match(/<p[^>]*>\s*([^<]*?moved,?\s*seconded by[^<]*?)<\/p>/i);
    const motionText = motionMatch ? motionMatch[1]!.replace(/\s+/g, " ").trim() : "";
    const mover = motionText.match(/^([A-Z][^,]*?)\s+moved/i)?.[1]?.trim() ?? "";
    const seconder = motionText.match(/seconded by\s+([A-Z][^,]*?),/i)?.[1]?.trim() ?? "";

    // Tally from the tally-yes / tally-no spans, in order.
    const yes = Number(block.match(/<span class="tally-yes">\s*(\d+)\s*<\/span>/)?.[1] ?? "");
    const no = Number(block.match(/<span class="tally-no">\s*(\d+)\s*<\/span>/)?.[1] ?? "");
    const hasTally = Number.isFinite(yes) && Number.isFinite(no) && block.includes("tally-yes");
    const tally = hasTally ? `${yes}-${no}` : "";

    if (!tally && !motionText) continue;
    out.push({
      item,
      motion: motionText || item,
      mover,
      seconder,
      tally,
      result: result || "not established",
      source: "structured-record" as VoteSource,
    });
  }
  return out;
}

/** The meeting page for a date, at the origin the paper's own setting names. */
export function structuredVoteMeetingUrl(origin: string, date: string): string {
  const iso = date.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!iso) return `${origin}/meetings/`;
  return `${origin}/meetings/${iso[1]}-${iso[2]}-${iso[3]}/`;
}

export type StructuredVoteFetchResult = {
  found: boolean;
  reason: string;
  records: ParsedVoteRecord[];
  url: string;
};

/** No source configured: the honest result a caller records instead of a lookup. */
export const NO_STRUCTURED_VOTE_SOURCE: StructuredVoteFetchResult = {
  found: false,
  reason: "no structured vote source configured for this paper",
  records: [],
  url: "",
};

/**
 * Fetch structured vote records for a meeting date from the origin this paper
 * configured. Returns an explicit reason when the record does not exist (a
 * council site typically trails by weeks), never an invented vote.
 *
 * There is no built-in origin. The caller passes the one its newsroom's setting
 * names, and a newsroom with none passes nothing at all
 * (./structured-vote-source.ts).
 */
export async function fetchStructuredVotesForDate(
  date: string,
  origin: string,
): Promise<StructuredVoteFetchResult> {
  const host = voteSourceHost(origin);
  const url = structuredVoteMeetingUrl(origin, date);
  try {
    const res = await fetchPublicHttp(new URL(url));
    if (!res.ok) {
      return { found: false, reason: `${host} returned HTTP ${res.status} for ${url}`, records: [], url };
    }
    const records = parseStructuredVotePage(await res.text());
    if (!records.length) {
      return { found: false, reason: `${host} page had no structured motion records: ${url}`, records: [], url };
    }
    return { found: true, reason: "structured vote records found", records, url };
  } catch (error) {
    return {
      found: false,
      reason: `${host} fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      records: [],
      url,
    };
  }
}
