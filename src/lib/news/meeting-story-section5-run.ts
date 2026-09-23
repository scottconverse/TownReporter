import type { Sql } from "../db.ts";
import { primeGovDocumentsForTitle } from "./primegov.ts";
import { packetItemsForMeeting } from "./meeting-agenda-items.ts";
import { fetchStructuredVotesForDate } from "./meeting-vote-sources.ts";
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

export type Section5Deps = {
  packetForTitle?: typeof primeGovDocumentsForTitle;
  packetItemsForMeeting?: typeof packetItemsForMeeting;
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
  items: { item: string; title: string; startSeconds: number }[];
  votes: StructuredVote[];
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
  try {
    const packet = await packetLookup(input.title);
    if (packet?.meeting) {
      // Real item list comes from the compiled agenda document via the parser,
      // not from documentList template names ("Agenda"/"Packet").
      packetItems = await (deps.packetItemsForMeeting ?? packetItemsForMeeting)(packet.meeting);
    }
  } catch {
    packetItems = [];
  }

  const chunks = chunkByAgendaItem({ segments, packetItems });
  const alignment = alignMeeting({ segments, chunks, packetItems });

  const structured = await fetchStructuredVotesForDate(input.meetingDate ?? "").catch(() => ({ found: false, reason: "structured vote lookup failed", records: [], url: "" }));
  // Structured records are keyed by ordinance/resolution id (O-2026-46), while
  // chunks are keyed by agenda item number (9). Attach a record to the chunk
  // whose transcript span actually mentions that identifier or motion text.
  const chunkText = (chunk: (typeof chunks)[number]) =>
    segments.filter((s) => chunk.segmentIndexes.includes(s.segmentIndex)).map((s) => s.excerpt).join(" ");
  const votes: StructuredVote[] = chunks.map((chunk) => {
    const text = chunkText(chunk).toLowerCase();
    const matched = structured.records.find((r) => {
      if (r.item === chunk.item) return true;
      // The transcript says "ordinance 2026-47"; the record is "O-2026-47".
      // Compare on the numeric identity so the O/R prefix does not matter.
      const bare = r.item.replace(/^[A-Z]-/i, "").toLowerCase();
      if (text.includes(r.item.toLowerCase()) || (bare.length > 4 && text.includes(bare))) return true;
      const head = r.motion.slice(0, 40).toLowerCase();
      return head.length > 10 && text.includes(head);
    }) ?? null;
    return extractStructuredVote({
      item: chunk.item,
      structuredRecord: matched,
      minutes: null,
      packet: null,
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

  const citations = alignment.chunks.map((chunk) =>
    resolveItemCitation({
      item: chunk.item,
      timestampSeconds: chunk.startSeconds,
      segments,
      captionSha256: artifact.sha256,
      storagePath: artifact.storage_path,
    }),
  );

  return {
    aligned: alignment.aligned,
    alignmentReason: alignment.reason,
    chunkCount: alignment.chunks.length,
    voteCount: votes.filter((v) => v.established).length,
    unalignedLead,
    citations,
    items: alignment.chunks.map((c) => ({ item: c.item, title: c.title, startSeconds: c.startSeconds })),
    votes,
  };
}
