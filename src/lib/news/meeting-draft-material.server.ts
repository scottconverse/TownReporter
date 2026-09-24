import type { Sql } from "../db.ts";
import { meetingClock, meetingEvidenceBlock } from "./meeting-draft-input.ts";

export type LoadedMeetingDraftMaterial = {
  evidence: string;
  meeting: { videoId: string; title: string; date: string | null; artifactId: number };
  citations: {
    item: string;
    segmentIndex: number;
    timestampSeconds: number;
    excerpt: string;
    captionSha256: string;
  }[];
};

type ChunkRow = {
  item: string;
  title: string;
  start_seconds: number | string;
  segment_indexes: string;
};

type SegmentRow = {
  segment_index: number;
  start_seconds: number | string;
  excerpt: string;
  caption_sha256: string;
};

function indexes(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
      : [];
  } catch {
    return [];
  }
}

/**
 * Rebuild the meeting writer input from the immutable meeting tables.
 *
 * Meeting transcripts are retained evidence, not a reporter's scratch note.
 * Carrying them through `leads.notes_json` silently clipped the record to 8 KB,
 * then the generic 16 KB note packer could drop the meeting identity and all
 * citation candidates after drafting. The database already has the canonical
 * artifact, chunks, segments, and vote records, so every draft and redraft reads
 * those rows directly instead of relying on a lossy memo copy.
 */
export async function loadMeetingDraftMaterial(
  sql: Sql,
  input: {
    newsroomId: number;
    artifactId: number;
    videoId: string;
    fallbackTitle: string;
    videoUrl?: string;
  },
): Promise<LoadedMeetingDraftMaterial> {
  const artifacts = await sql.query<{ id: number; video_id: string; sha256: string }>(
    `select id,video_id,sha256 from meeting_transcript_artifacts
      where id=$1 and newsroom_id=$2 and video_id=$3 and artifact_type='transcript'`,
    [input.artifactId, input.newsroomId, input.videoId],
  );
  const artifact = artifacts[0];
  if (!artifact) throw new Error("The meeting transcript artifact for this lead is missing.");

  const captures = await sql.query<{ title: string | null; published: string | null }>(
    `select title,published from meeting_capture_records
      where newsroom_id=$1 and video_id=$2 limit 1`,
    [input.newsroomId, input.videoId],
  );
  const chunks = await sql.query<ChunkRow>(
    `select item,title,start_seconds,segment_indexes from meeting_agenda_chunks
      where newsroom_id=$1 and video_id=$2 and artifact_id=$3 order by start_seconds,id`,
    [input.newsroomId, input.videoId, input.artifactId],
  );
  const segments = await sql.query<SegmentRow>(
    `select segment_index,start_seconds,excerpt,caption_sha256
      from meeting_transcript_segments where artifact_id=$1 order by segment_index`,
    [input.artifactId],
  );
  if (!segments.length) throw new Error("The meeting transcript has no stored segments.");

  const segmentByIndex = new Map(segments.map((segment) => [Number(segment.segment_index), segment]));
  const itemByIndex = new Map<number, string>();
  const items = chunks.map((chunk) => {
    const chunkSegments = indexes(chunk.segment_indexes)
      .map((index) => {
        itemByIndex.set(index, chunk.item);
        return segmentByIndex.get(index);
      })
      .filter((segment): segment is SegmentRow => Boolean(segment));
    return {
      item: chunk.item,
      title: chunk.title,
      startSeconds: Number(chunk.start_seconds),
      excerpt: chunkSegments
        .map(
          (segment) =>
            `[${meetingClock(Number(segment.start_seconds))}; segment ${segment.segment_index}] ${segment.excerpt}`,
        )
        .join("\n"),
    };
  });
  if (!items.length) throw new Error("The meeting transcript has no aligned agenda-item spans.");

  const votes = await sql.query<{
    item: string;
    established: boolean;
    motion: string | null;
    mover: string | null;
    seconder: string | null;
    tally: string | null;
    result: string | null;
    source: string | null;
  }>(
    `select item,established,motion,mover,seconder,tally,result,source
      from meeting_structured_votes where newsroom_id=$1 and video_id=$2 order by item`,
    [input.newsroomId, input.videoId],
  );
  const capture = captures[0];
  const title = capture?.title?.trim() || input.fallbackTitle;
  const date = capture?.published ? String(capture.published).slice(0, 10) : null;
  const videoUrl = input.videoUrl || `https://www.youtube.com/watch?v=${input.videoId}`;
  const evidence = meetingEvidenceBlock({
    title,
    meetingDate: date,
    videoUrl,
    items,
    votes,
  });
  const citations = segments
    .map((segment) => {
      const item = itemByIndex.get(Number(segment.segment_index));
      return item
        ? {
            item,
            segmentIndex: Number(segment.segment_index),
            timestampSeconds: Number(segment.start_seconds),
            excerpt: segment.excerpt,
            captionSha256: segment.caption_sha256 || artifact.sha256,
          }
        : null;
    })
    .filter((citation): citation is NonNullable<typeof citation> => Boolean(citation));

  return {
    evidence,
    meeting: { videoId: input.videoId, title, date, artifactId: input.artifactId },
    citations,
  };
}
