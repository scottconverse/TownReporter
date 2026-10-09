import type { Sql } from "../db.ts";
import { primeGovDocumentsForTitle, type PrimeGovMeeting } from "./primegov.ts";
import { primeGovOriginForNewsroom } from "./primegov-source.ts";
import { packetItemsForMeeting } from "./meeting-agenda-items.ts";
import {
  fetchStructuredVotesForDate,
  NO_STRUCTURED_VOTE_SOURCE,
  type StructuredVoteFetchResult,
} from "./meeting-vote-sources.ts";
import { structuredVoteBaseUrlForNewsroom } from "./structured-vote-source.ts";
import {
  alignMeeting,
  chunkByAgendaItem,
  extractStructuredVote,
  resolveItemCitation,
  type PacketItem,
  type StructuredVote,
  type TranscriptSegment,
} from "./meeting-story-section5.ts";
import { persistSection5, unalignedMeetingLead } from "./meeting-story-section5-persist.ts";
import { meetingClock } from "./meeting-draft-input.ts";
import { primeGovVoteRecordsForMeeting, type PrimeGovVoteDocuments } from "./primegov-vote-documents.ts";

export type Section5Deps = {
  packetForTitle?: typeof primeGovDocumentsForTitle;
  packetItemsForMeeting?: typeof packetItemsForMeeting;
  /** Test seam: which portal this newsroom watches. See ./primegov-source.ts. */
  primeGovOrigin?: typeof primeGovOriginForNewsroom;
  /** Test seam: which structured vote source this paper configured. See ./structured-vote-source.ts. */
  structuredVoteBaseUrl?: typeof structuredVoteBaseUrlForNewsroom;
  /** Test seam: the structured vote read itself, so a test never reaches a real council site. */
  structuredVotesForDate?: typeof fetchStructuredVotesForDate;
  /** Test seam: the portal's own minutes and packet vote records. */
  voteRecordsForMeeting?: typeof primeGovVoteRecordsForMeeting;
};

export type Section5Result = {
  aligned: boolean;
  alignmentReason: string | null;
  chunkCount: number;
  voteCount: number;
  unalignedLead: ReturnType<typeof unalignedMeetingLead> | null;
  citations: ReturnType<typeof resolveItemCitation>[];
  /*
    What the lead and the drafting input need, carried out of this function
    rather than re-queried. Section 5 already has the chunks and the votes in
    hand; a caller that has to re-read them from the database is a second source
    of truth for the same meeting, and the two can disagree.
  */
  items: { item: string; title: string; startSeconds: number; excerpt: string }[];
  votes: StructuredVote[];
  /*
    Why the structured vote read ended the way it did -- including "this paper
    has no structured vote source configured", which is the whole of what
    happened in that case. Carried out rather than swallowed: a run that read no
    vote record must be able to say whether the record was missing or the paper
    never pointed at one.
  */
  structuredVoteReason: string;
};

/**
 * Real section-5 integration. Runs after a transcript artifact is stored, on
 * capture and on revision.
 *
 * Loads the stored artifact + segments from the database (not a caller-passed
 * mock), reuses the existing PrimeGov packet lookup for the item list, chunks by
 * agenda item, aligns, extracts structured votes, persists all three artifacts,
 * and resolves item citations through the stored segment path.
 */
export async function runSection5ForArtifact(
  sql: Sql,
  input: { newsroomId: number; videoId: string; title: string; artifactId: number; meetingDate?: string; },
  deps: Section5Deps = {},
): Promise<Section5Result> {
  const artifactRows = await sql.query<{ id: number; storage_path: string; sha256: string }>(
    "select id,storage_path,sha256 from meeting_transcript_artifacts where id=$1 and newsroom_id=$2",
    [input.artifactId, input.newsroomId],
  );
  const artifact = artifactRows[0];
  if (!artifact) throw new Error("Meeting transcript artifact not found for section 5.");

  const segmentRows = await sql.query<{
    segment_index: number; start_seconds: number; end_seconds: number; excerpt: string; caption_sha256: string;
  }>(
    "select segment_index,start_seconds,end_seconds,excerpt,caption_sha256 from meeting_transcript_segments where artifact_id=$1 order by segment_index",
    [input.artifactId],
  );
  const segments: TranscriptSegment[] = segmentRows.map((s) => ({
    segmentIndex: s.segment_index,
    startSeconds: Number(s.start_seconds),
    endSeconds: Number(s.end_seconds),
    excerpt: s.excerpt,
    captionSha256: s.caption_sha256,
  }));

  const packetLookup = deps.packetForTitle ?? primeGovDocumentsForTitle;
  let packetItems: PacketItem[] = [];
  let portalOrigin: string | null = null;
  let portalMeeting: PrimeGovMeeting | null = null;
  try {
    /*
      The portal to ask comes out of this newsroom's own watch list. It used to
      be a constant (Longmont's) inside the lookup, so every other city's tape
      was matched against Longmont's meetings; with no portal configured there
      is no lookup at all, which is the honest answer and not a fallback.
    */
    portalOrigin = await (deps.primeGovOrigin ?? primeGovOriginForNewsroom)(sql, input.newsroomId);
    if (portalOrigin) {
      const packet = await packetLookup(input.title, portalOrigin);
      if (packet?.meeting) {
        portalMeeting = packet.meeting;
        // Real item list comes from the compiled agenda document via the parser,
        // not from documentList template names ("Agenda"/"Packet").
        packetItems = await (deps.packetItemsForMeeting ?? packetItemsForMeeting)(packet.meeting, portalOrigin);
      }
    }
  } catch {
    packetItems = [];
  }

  const chunks = chunkByAgendaItem({ segments, packetItems });
  const alignment = alignMeeting({ segments, chunks, packetItems });

  /*
    The structured vote source comes out of this paper's own settings, the same
    way the PrimeGov portal comes out of its watch list. It used to be a
    constant inside the fetch adapter (Longmont's council site), so every
    paper's section 5 read Longmont's motions; with no structured source
    configured there is no lookup at all, and the result says so.

    What comes back is the paper's whole setting -- path included -- not just
    its host, so a site that publishes under a path is read under that path.
    See ./structured-vote-source.ts.
  */
  const voteBase = await (deps.structuredVoteBaseUrl ?? structuredVoteBaseUrlForNewsroom)(
    sql,
    input.newsroomId,
  ).catch(() => null);
  const structured: StructuredVoteFetchResult = voteBase
    ? await (deps.structuredVotesForDate ?? fetchStructuredVotesForDate)(
        input.meetingDate ?? "",
        voteBase,
      ).catch(() => ({
        found: false,
        reason: `structured vote lookup failed at ${voteBase}`,
        records: [],
        url: "",
      }))
    : NO_STRUCTURED_VOTE_SOURCE;
  let voteDocuments: PrimeGovVoteDocuments = { minutes: [], packet: [] };
  if (portalMeeting && portalOrigin) {
    try {
      voteDocuments = await (deps.voteRecordsForMeeting ?? primeGovVoteRecordsForMeeting)(portalMeeting, portalOrigin);
    } catch {
      voteDocuments = { minutes: [], packet: [] };
    }
  }
  // Structured records are keyed by ordinance/resolution id (O-2026-46), while
  // chunks are keyed by agenda item number (9). Attach a record to the chunk
  // whose transcript span actually mentions that identifier or motion text.
  const chunkText = (chunk: (typeof chunks)[number]) =>
    segments.filter((s) => chunk.segmentIndexes.includes(s.segmentIndex)).map((s) => s.excerpt).join(" ");
  const recordMatchesChunk = (record: { item: string; motion: string }, chunk: (typeof chunks)[number], text: string) => {
    if (record.item.toLowerCase() === chunk.item.toLowerCase()) return true;
    const bare = record.item.replace(/^[A-Z]-/i, "").toLowerCase();
    if (text.includes(record.item.toLowerCase()) || (bare.length > 4 && text.includes(bare))) return true;
    const head = record.motion.slice(0, 40).toLowerCase();
    return head.length > 10 && text.includes(head);
  };
  const votes: StructuredVote[] = chunks.map((chunk) => {
    const text = chunkText(chunk).toLowerCase();
    const matched = structured.records.find((record) => recordMatchesChunk(record, chunk, text)) ?? null;
    const minutes = voteDocuments.minutes.find((record) => recordMatchesChunk(record, chunk, text)) ?? null;
    const packet = voteDocuments.packet.find((record) => recordMatchesChunk(record, chunk, text)) ?? null;
    return extractStructuredVote({
      item: chunk.item,
      structuredRecord: matched,
      minutes,
      packet,
      transcript: { excerpt: chunkText(chunk), source: "transcript" },
    });
  });

  await persistSection5(sql, {
    newsroomId: input.newsroomId,
    videoId: input.videoId,
    artifactId: input.artifactId,
    chunks: alignment.chunks,
    alignment,
    votes,
  });

  let unalignedLead: ReturnType<typeof unalignedMeetingLead> | null = null;
  if (!alignment.aligned) {
    unalignedLead = unalignedMeetingLead({
      videoId: input.videoId,
      title: input.title,
      reason: alignment.reason ?? "alignment not established",
    });
  }

  const segmentByIndex = new Map(segments.map((segment) => [segment.segmentIndex, segment]));
  const citations = alignment.chunks.flatMap((chunk) =>
    chunk.segmentIndexes.flatMap((segmentIndex) => {
      const segment = segmentByIndex.get(segmentIndex);
      return segment
        ? [{
            item: chunk.item,
            segmentIndex: segment.segmentIndex,
            timestampSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            excerpt: segment.excerpt,
            captionSha256: segment.captionSha256 || artifact.sha256,
            storagePath: artifact.storage_path,
          }]
        : [];
    }),
  );

  return {
    aligned: alignment.aligned,
    alignmentReason: alignment.reason,
    chunkCount: alignment.chunks.length,
    voteCount: votes.filter((v) => v.established).length,
    unalignedLead,
    citations,
    items: alignment.chunks.map((chunk) => ({
      item: chunk.item,
      title: chunk.title,
      startSeconds: chunk.startSeconds,
      excerpt: chunk.segmentIndexes
        .map((segmentIndex) => {
          const segment = segmentByIndex.get(segmentIndex);
          return segment
            ? `[${meetingClock(segment.startSeconds)}; segment ${segment.segmentIndex}] ${segment.excerpt}`
            : "";
        })
        .filter(Boolean)
        .join("\n"),
    })),
    votes,
    structuredVoteReason: structured.reason,
  };
}
