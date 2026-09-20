export type TranscriptSegment = {
  segmentIndex: number;
  startSeconds: number;
  endSeconds: number;
  excerpt: string;
  captionSha256: string;
};

export type PacketItem = { itemNumber: string; title: string };

export type AgendaChunk = {
  item: string;
  title: string;
  segmentIndexes: number[];
  startSeconds: number;
  endSeconds: number;
};

export type AlignmentResult = {
  aligned: boolean;
  reason: string | null;
  chunks: AgendaChunk[];
};

const ITEM_TRANSITION = /\bitem\s+(?:number\s+)?([A-Z]?-?\d{1,3})\b/i;
const ORDINANCE_OR_RESOLUTION = /\b([OR]-\d{4}-\d{1,4})\b/i;

function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 3);
}

function itemKey(segment: TranscriptSegment): string | null {
  return segment.excerpt.match(ORDINANCE_OR_RESOLUTION)?.[1] ?? segment.excerpt.match(ITEM_TRANSITION)?.[1] ?? null;
}

/**
 * Chunk by agenda item. The packet item list is authoritative for order and
 * titles; transcript transitions ("Item N", ordinance/resolution numbers) mark
 * where each item begins. This is deliberately not a time-window chunker: a
 * chunk exists only when a packet item maps to a transcript transition.
 */
export function chunkByAgendaItem(input: {
  segments: TranscriptSegment[];
  packetItems: PacketItem[];
}): AgendaChunk[] {
  const chunks: AgendaChunk[] = [];
  for (const item of input.packetItems) {
    const keys = new Set([item.itemNumber.toLowerCase(), ...significantWords(item.title)]);
    const matched = input.segments.filter((segment) => {
      const key = itemKey(segment)?.toLowerCase();
      if (key && key === item.itemNumber.toLowerCase()) return true;
      const words = significantWords(segment.excerpt);
      return words.some((w) => keys.has(w));
    });
    if (!matched.length) continue;
    chunks.push({
      item: item.itemNumber,
      title: item.title,
      segmentIndexes: matched.map((s) => s.segmentIndex),
      startSeconds: Math.min(...matched.map((s) => s.startSeconds)),
      endSeconds: Math.max(...matched.map((s) => s.endSeconds)),
    });
  }
  return chunks;
}

export function alignMeeting(input: {
  segments: TranscriptSegment[];
  chunks: AgendaChunk[];
  packetItems: PacketItem[];
}): AlignmentResult {
  if (!input.packetItems.length) {
    return { aligned: false, reason: "no packet item list available for alignment", chunks: [] };
  }
  if (!input.chunks.length) {
    return { aligned: false, reason: "no packet item could be aligned to a transcript span", chunks: [] };
  }
  const covered = new Set(input.chunks.flatMap((c) => c.segmentIndexes));
  const coverage = input.segments.length ? covered.size / input.segments.length : 0;
  if (coverage < 0.2) {
    return { aligned: false, reason: "packet items did not align with enough of the transcript", chunks: input.chunks };
  }
  return { aligned: true, reason: null, chunks: input.chunks };
}

export type VoteSource = "longmontcitycouncil.org" | "minutes" | "packet" | "transcript";

export type VoteRecord = {
  motion: string;
  mover: string;
  seconder: string;
  tally: string;
  result: string;
  source: VoteSource;
};

export type StructuredVote = {
  item: string;
  established: boolean;
  motion: string | null;
  mover: string | null;
  seconder: string | null;
  tally: string | null;
  result: string;
  source: VoteSource | null;
  provenance: { source: VoteSource; locator: string | null }[];
  disagreements: string[];
};

const SOURCE_ORDER: VoteSource[] = ["longmontcitycouncil.org", "minutes", "packet", "transcript"];

/**
 * Structured vote extraction. Source precedence is the structured vote record,
 * then official minutes, then the packet, then the transcript. A transcript-only
 * mention is corroboration, never a tally: without a structured record the vote
 * is reported "not established".
 */
export function extractStructuredVote(input: {
  item: string;
  structuredRecord: VoteRecord | null;
  minutes: VoteRecord | null;
  packet: VoteRecord | null;
  transcript: { excerpt: string; source: VoteSource } | null;
}): StructuredVote {
  const candidates: VoteRecord[] = [];
  if (input.structuredRecord) candidates.push(input.structuredRecord);
  if (input.minutes) candidates.push(input.minutes);
  if (input.packet) candidates.push(input.packet);
  const authoritative = candidates.filter((c) => c.tally && c.tally.trim());
  const disagreements: string[] = [];
  for (let i = 0; i < authoritative.length; i += 1) {
    for (let j = i + 1; j < authoritative.length; j += 1) {
      const a = authoritative[i]!;
      const b = authoritative[j]!;
      if (a.tally !== b.tally || a.result !== b.result) {
        disagreements.push(`${a.source} says ${a.result} ${a.tally}; ${b.source} says ${b.result} ${b.tally}`);
      }
    }
  }
  const chosen = [...authoritative].sort(
    (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
  )[0];
  if (!chosen) {
    return {
      item: input.item,
      established: false,
      motion: null,
      mover: null,
      seconder: null,
      tally: null,
      result: "not established",
      source: null,
      provenance: input.transcript
        ? [{ source: input.transcript.source, locator: input.transcript.excerpt.slice(0, 160) }]
        : [],
      disagreements,
    };
  }
  const provenance = [{ source: chosen.source, locator: null as string | null }];
  if (input.transcript) provenance.push({ source: input.transcript.source, locator: input.transcript.excerpt.slice(0, 160) });
  return {
    item: input.item,
    established: true,
    motion: chosen.motion,
    mover: chosen.mover,
    seconder: chosen.seconder,
    tally: chosen.tally,
    result: chosen.result,
    source: chosen.source,
    provenance,
    disagreements,
  };
}

export type ItemCitation = {
  item: string;
  segmentIndex: number;
  timestampSeconds: number;
  endSeconds: number;
  excerpt: string;
  captionSha256: string;
  storagePath: string;
};

/**
 * Resolve a citation to item + timestamp + verbatim excerpt + caption hash.
 * Never returns the whole file: the excerpt is the matched segment's verbatim
 * caption text, and the hash is the caption file hash that produced it.
 */
export function resolveItemCitation(input: {
  item: string;
  timestampSeconds: number;
  segments: TranscriptSegment[];
  captionSha256: string;
  storagePath: string;
}): ItemCitation {
  const segment =
    input.segments.find((s) => input.timestampSeconds >= s.startSeconds && input.timestampSeconds < s.endSeconds) ??
    [...input.segments].reverse().find((s) => input.timestampSeconds >= s.startSeconds);
  if (!segment) throw new Error("No transcript segment matches that citation.");
  return {
    item: input.item,
    segmentIndex: segment.segmentIndex,
    timestampSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    excerpt: segment.excerpt,
    captionSha256: segment.captionSha256 || input.captionSha256,
    storagePath: input.storagePath,
  };
}
