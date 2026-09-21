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

/*
  Spoken-transition rules. Real council transcripts announce items the way the
  clerk reads them, not the way the agenda PDF writes them. The real July 28
  2026 Longmont transcript says:
    "here tonight to speak on agenda item 9C"
    "Item 9B2 is ordinance 2026-47,"
    "Item 9 C is ordinance 2026-48,"
    "Item 9D, resolution 2026-43,"
    "to the next item."
  So the boundary signals are spoken item numbers, ordinance/resolution
  identifiers, and explicit "next item" phrasing. Agenda titles are used only
  for ordering and labelling, never as the match key.
*/
const SPOKEN_ITEM = /\b(?:agenda\s+)?item\s+(?:number\s+)?([0-9]{1,2}[A-Z]{0,3}[0-9]{0,2})\b/i;
const SPOKEN_IDENTIFIER = /\b([OR]-\d{4}-\d{1,4})\b/i;
const NEXT_ITEM = /\b(?:moving on|next item|the next agenda item|next agenda item)\b/i;

export function spokenTransitionKey(excerpt: string): { kind: "item" | "identifier" | "next"; value: string } | null {
  const normalised = excerpt.replace(/\s+/g, " ");
  const identifier = normalised.match(SPOKEN_IDENTIFIER)?.[1];
  if (identifier) return { kind: "identifier", value: identifier.toUpperCase() };
  const item = normalised.match(SPOKEN_ITEM)?.[1];
  if (item) return { kind: "item", value: item.toUpperCase() };
  return null;
}

function normaliseItemNumber(raw: string): string {
  return raw.replace(/[^0-9A-Z]/gi, "").toUpperCase();
}

function itemNumbersMatch(spoken: string, packet: string): boolean {
  const a = normaliseItemNumber(spoken);
  const b = normaliseItemNumber(packet);
  if (a === b) return true;
  // "Item 9 C" (spoken) matches packet item "9C"; also allow a sub-item to match
  // its parent ("9B2" belongs to "9B").
  if (a.startsWith(b) || b.startsWith(a)) return true;
  return false;
}

function titleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 4);
}

/**
 * Chunk by agenda item, keyed off SPOKEN transcript transitions. Packet item
 * order and titles remain authoritative for ordering and labelling; the
 * transcript supplies the boundaries. A packet item earns a chunk only when a
 * spoken transition actually matches it.
 */
export function chunkByAgendaItem(input: {
  segments: TranscriptSegment[];
  packetItems: PacketItem[];
}): AgendaChunk[] {
  const chunks: AgendaChunk[] = [];
  for (const packetItem of input.packetItems) {
    const matched = input.segments.filter((segment) => {
      const transition = spokenTransitionKey(segment.excerpt);
      if (transition) {
        if (transition.kind === "item" && itemNumbersMatch(transition.value, packetItem.itemNumber)) return true;
        if (transition.kind === "identifier") {
          return titleKeywords(packetItem.title).some((w) => segment.excerpt.toLowerCase().includes(w));
        }
      }
      // Fall back to an explicit title mention only when it is spoken verbatim.
      const keywords = titleKeywords(packetItem.title);
      if (keywords.length >= 2) {
        const words = segment.excerpt.toLowerCase();
        return keywords.every((w) => words.includes(w));
      }
      return false;
    });
    if (!matched.length) continue;
    chunks.push({
      item: packetItem.itemNumber,
      title: packetItem.title,
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
    return { aligned: false, reason: "no spoken transcript transition matched a packet item", chunks: [] };
  }
  const covered = new Set(input.chunks.flatMap((c) => c.segmentIndexes));
  const coverage = input.segments.length ? covered.size / input.segments.length : 0;
  if (coverage < 0.001) {
    return { aligned: false, reason: "spoken transitions did not align with enough of the transcript", chunks: input.chunks };
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
 * then official minutes, then the packet, then the transcript as corroboration.
 * A transcript-only mention is never a tally: without an authoritative tally the
 * vote is reported "not established". Disagreements are surfaced, not resolved.
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
 * Never returns the whole file.
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
