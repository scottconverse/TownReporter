import type { Sql } from "../db.ts";

/* ------------------------------------------------------------------ *
 * The meeting record, read whole.
 *
 * WHY THIS FILE EXISTS. A reporting run that treats the editor's first seed
 * URL as "the meeting record" is wrong in a way that is hard to see from the
 * outside: on the real prepared assignment the first seed is a budget PDF,
 * while the meeting itself is a 5,908-segment retained transcript on the
 * lead's own artifact. This module resolves the meeting from the SCOPED lead
 * artifact -- never from seeds[0] -- and reads the WHOLE tape in bounded
 * windows, so late-meeting coverage is not silently dropped at a character
 * cap. Everything it cannot read becomes an explicit, itemised gap.
 *
 * The tape is untrusted evidence: nothing here treats transcript or packet
 * words as instructions, and nothing invents a timestamp, page or tally.
 * ------------------------------------------------------------------ */

/** How much tape one bounded window carries. Chosen so a window is a unit a
 * single pass can actually read, and so a 1.45 MB transcript is a handful of
 * windows rather than one truncated blob. */
export const TAPE_WINDOW_SEGMENTS = 400;
export const TAPE_WINDOW_CHARS = 24_000;

export type MeetingIdentity = {
  /** The recording's video id, when the scoped lead names one. */
  videoId: string;
  /** The retained transcript artifact id, when the scoped lead names one. */
  artifactId: number | null;
  title: string;
  date: string | null;
  videoUrl: string;
  /** "lead-artifact" when resolved from the scoped lead; "none" otherwise. */
  source: "lead-artifact" | "none";
  reason: string;
};

export type TapeSegment = {
  index: number;
  seconds: number;
  text: string;
  item: string;
  itemTitle: string;
};

export type TapeWindow = {
  windowIndex: number;
  /** "h:mm:ss" of the first and last segment in the window. */
  startClock: string;
  endClock: string;
  firstIndex: number;
  lastIndex: number;
  segments: TapeSegment[];
  chars: number;
  /** The agenda items this window's segments were aligned to, de-duped. */
  items: { item: string; title: string }[];
};

export type WholeRecord = {
  identity: MeetingIdentity;
  /** Every retained segment, in chronological order. Empty when none. */
  segments: TapeSegment[];
  /** The same segments, split into bounded windows. */
  windows: TapeWindow[];
  /** The agenda-item alignment the capture recorded, de-duped. */
  agenda: { item: string; title: string }[];
  /** The structured vote rows the capture recorded for this meeting. */
  votes: { item: string; motion: string; tally: string; result: string; established: boolean }[];
  /** Total retained characters across every segment actually read. */
  totalChars: number;
  /** A one-line true ledger of what was read: windows, segment range, chars. */
  coverageLedger: string;
  /** Explicit gaps: what could NOT be read, with the exact reason. */
  gaps: string[];
  /** True only when a non-empty tape was read end to end with no gap. */
  complete: true | false;
};

/** Seconds as "h:mm:ss", or "unknown" when the capture stored no clock. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? h + ":" + two(m) + ":" + two(s) : m + ":" + two(s);
}

function strOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function indexes(raw: unknown): number[] {
  if (typeof raw !== "string") return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
      : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Resolving WHICH meeting.
 *
 * The scoped lead is the authority: `leads.meeting_video_id` /
 * `leads.meeting_artifact_id` are written when the newsroom captured the
 * session. Seeds are the editor's reading list, and a seed can be a packet or
 * a budget PDF -- so a seed is NEVER treated as the meeting identity. When the
 * lead names no artifact, the request is a direct assignment and this returns
 * source "none" with a precise reason, and the caller records a gap rather
 * than pretending the first seed was the recording.
 * ------------------------------------------------------------------ */
export async function resolveMeetingIdentity(
  sql: Sql,
  input: {
    newsroomId: number;
    leadId: number | null;
    seedUrls: string[];
    fallbackTitle: string;
  },
): Promise<MeetingIdentity> {
  const seeds = (input.seedUrls ?? []).map(strOf).filter(Boolean);
  if (input.leadId) {
    const rows = await sql<{
      video_id: string | null;
      artifact_id: number | null;
      headline: string | null;
      purpose: string | null;
    }>`
      select meeting_video_id as video_id, meeting_artifact_id as artifact_id,
             headline, meeting_lead_purpose as purpose
      from leads where id = ${input.leadId} and newsroom_id = ${input.newsroomId} limit 1
    `;
    const lead = rows[0];
    const videoId = strOf(lead?.video_id);
    const artifactId = lead?.artifact_id == null ? null : Number(lead.artifact_id);
    if (videoId && artifactId && Number.isInteger(artifactId)) {
      const capture = await sql<{ title: string | null; published: string | null; video_url: string | null }>`
        select title, published from meeting_capture_records where newsroom_id = ${input.newsroomId} and video_id = ${videoId} limit 1
      `;
      const title = strOf(capture[0]?.title) || strOf(lead?.headline) || input.fallbackTitle;
      const date = capture[0]?.published ? String(capture[0].published).slice(0, 10) : null;
      return {
        videoId,
        artifactId,
        title,
        date,
        videoUrl: canonicalMeetingUrl(videoId, seeds),
        source: "lead-artifact",
        reason: "",
      };
    }
    return {
      videoId,
      artifactId,
      title: strOf(lead?.headline) || input.fallbackTitle,
      date: null,
      videoUrl: canonicalMeetingUrl(videoId, seeds),
      source: "none",
      reason:
        "The scoped lead names no retained meeting artifact" +
        (videoId ? " (video " + videoId + " has no artifact id)." : "."),
    };
  }
  return {
    videoId: "",
    artifactId: null,
    title: input.fallbackTitle,
    date: null,
    videoUrl: "",
    source: "none",
    reason: "This is a direct assignment with no lead, so no retained meeting artifact is scoped yet.",
  };
}

/**
 * THE RECORDING URL IS BOUND TO THE RETAINED ARTIFACT'S OWN VIDEO, NOT TO A SEED.
 *
 * WHY THIS IS NOT `seeds.find(isYouTube)`. The real assignment proves the
 * hazard: the retained artifact (39) is video `zMglXtVlIMA`, while the editor
 * also supplied the OFFICIAL recording of the same meeting, `fWMTQj830Ho` --
 * a different upload whose recording start and time offsets differ. The tape
 * timestamps the coverage ledger reports are artifact 39's own, so pointing the
 * coverage `recordingUrl` at the first YouTube seed would staple one recording's
 * clock onto another recording's URL. That is wrong evidence.
 *
 * So the retained `videoId` is the authority. A seed URL is used ONLY when its
 * own video id IS the retained video id (the same video, however it was linked);
 * otherwise the canonical watch URL for the retained video is built. A seed that
 * names a different video never replaces the artifact's own identity.
 */
function canonicalMeetingUrl(videoId: string, seeds: string[]): string {
  const retained = strOf(videoId);
  if (!retained) return "";
  const sameVideo = seeds.find((url) => videoIdOfSeed(url) === retained);
  return sameVideo || "https://www.youtube.com/watch?v=" + retained;
}

/** The 11-char YouTube id from a watch/short/embed/live URL, or "" if none. */
export function videoIdOfSeed(url: string): string {
  const value = strOf(url);
  if (!value) return "";
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * Reading the WHOLE tape.
 *
 * Every retained segment is read, in index order, and split into bounded
 * windows so a caller can give the model one window at a time. Nothing is
 * sliced at an arbitrary character cap: the ledger states the exact segment
 * range and window count that were read, so "late-meeting coverage" is a
 * countable fact rather than an assumption.
 * ------------------------------------------------------------------ */
export async function loadWholeRecord(
  sql: Sql,
  input: {
    newsroomId: number;
    identity: MeetingIdentity;
    windowSegments?: number;
    windowChars?: number;
  },
): Promise<WholeRecord> {
  const windowSegments = input.windowSegments ?? TAPE_WINDOW_SEGMENTS;
  const windowChars = input.windowChars ?? TAPE_WINDOW_CHARS;
  const gaps: string[] = [];
  const identity = input.identity;

  if (!identity.artifactId) {
    gaps.push(identity.reason || "No meeting artifact is scoped, so the tape could not be read.");
    return {
      identity,
      segments: [],
      windows: [],
      agenda: [],
      votes: [],
      totalChars: 0,
      coverageLedger: "No retained tape: " + (identity.reason || "no artifact scoped."),
      gaps,
      complete: false,
    };
  }

  /*
    The segment row's OWN `item` column is the tape's first-hand label -- the
    one the capture stamped on the line, ahead of any later agenda alignment.
    Selecting it here (rather than inferring the item from the agenda chunks
    alone) keeps a line labelled PROC or 7B from being silently relabelled by
    whatever chunk happens to overlap it, which is how a procedural tally once
    inherited a policy item's record.
  */
  const segmentRows = await sql<{ segment_index: number; start_seconds: number | string; excerpt: string; item: string | null }>`
    select segment_index, start_seconds, excerpt, item from meeting_transcript_segments
    where artifact_id = ${identity.artifactId} order by segment_index
  `;
  if (!segmentRows.length) {
    gaps.push(
      "The scoped meeting artifact " + identity.artifactId + " has no retained transcript segments.",
    );
    return {
      identity,
      segments: [],
      windows: [],
      agenda: [],
      votes: [],
      totalChars: 0,
      coverageLedger: "Scoped artifact " + identity.artifactId + " carries no segments.",
      gaps,
      complete: false,
    };
  }

  const chunkRows = await sql<{ item: string; title: string; segment_indexes: string }>`
    select item, title, segment_indexes from meeting_agenda_chunks
    where newsroom_id = ${input.newsroomId} and artifact_id = ${identity.artifactId}
    order by start_seconds, id
  `;
  const itemByIndex = new Map<number, { item: string; title: string }>();
  const agenda: { item: string; title: string }[] = [];
  const agendaSeen = new Set<string>();
  for (const chunk of chunkRows) {
    const entry = { item: strOf(chunk.item), title: strOf(chunk.title) };
    const key = entry.item + "\u0000" + entry.title;
    if (entry.item && !agendaSeen.has(key)) {
      agendaSeen.add(key);
      agenda.push(entry);
    }
    for (const index of indexes(chunk.segment_indexes)) {
      if (!itemByIndex.has(index)) itemByIndex.set(index, entry);
    }
  }

  const segments: TapeSegment[] = segmentRows.map((row) => {
    const aligned = itemByIndex.get(Number(row.segment_index));
    const seconds = Number(row.start_seconds);
    // The line's own label wins; the agenda alignment fills in only when the
    // tape did not stamp an item on the line.
    const ownItem = strOf(row.item);
    const item = ownItem || aligned?.item || "";
    const itemTitle = aligned && aligned.item === item ? aligned.title : ownItem ? aligned?.title ?? "" : "";
    return {
      index: Number(row.segment_index),
      seconds: Number.isFinite(seconds) ? seconds : 0,
      text: strOf(row.excerpt),
      item,
      itemTitle,
    };
  });

  // Windows are cut by SEGMENT COUNT and CHARACTER BUDGET together: a window
  // never exceeds either, so one long segment cannot make a window unreadable,
  // and no segment is ever dropped.
  const windows: TapeWindow[] = [];
  let current: TapeSegment[] = [];
  let chars = 0;
  const flush = () => {
    if (!current.length) return;
    const items: { item: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const segment of current) {
      if (!segment.item) continue;
      const key = segment.item + "\u0000" + segment.itemTitle;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ item: segment.item, title: segment.itemTitle });
    }
    windows.push({
      windowIndex: windows.length,
      startClock: formatClock(current[0]!.seconds),
      endClock: formatClock(current[current.length - 1]!.seconds),
      firstIndex: current[0]!.index,
      lastIndex: current[current.length - 1]!.index,
      segments: current,
      chars,
      items,
    });
    current = [];
    chars = 0;
  };
  for (const segment of segments) {
    const size = segment.text.length + 24;
    if (current.length && (current.length >= windowSegments || chars + size > windowChars)) flush();
    current.push(segment);
    chars += size;
  }
  flush();

  const votes = (
    await sql<{ item: string; motion: string | null; tally: string | null; result: string | null; established: boolean }>`
      select item, motion, tally, result, established from meeting_structured_votes
      where newsroom_id = ${input.newsroomId} and video_id = ${identity.videoId} order by item
    `
  ).map((row) => ({
    item: strOf(row.item),
    motion: strOf(row.motion),
    tally: strOf(row.tally),
    result: strOf(row.result),
    established: Boolean(row.established),
  }));

  const totalChars = segments.reduce((sum, segment) => sum + segment.text.length, 0);
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const coverageLedger =
    "Read " +
    segments.length +
    " of " +
    segments.length +
    " retained segments (" +
    windows.length +
    " windows, " +
    totalChars +
    " chars), " +
    formatClock(first.seconds) +
    " to " +
    formatClock(last.seconds) +
    ", artifact " +
    identity.artifactId +
    ", video " +
    (identity.videoId || "unknown") +
    ".";

  return {
    identity,
    segments,
    windows,
    agenda,
    votes,
    totalChars,
    coverageLedger,
    gaps,
    complete: gaps.length === 0,
  };
}

/** The tape text of one window, each segment prefixed with its clock and item. */
export function windowBlock(window: TapeWindow): string {
  return window.segments
    .map((segment) => {
      const clock = formatClock(segment.seconds);
      const item = segment.item ? " [" + segment.item + (segment.itemTitle ? " " + segment.itemTitle : "") + "]" : "";
      return clock + item + " " + segment.text;
    })
    .join("\n");
}

/** Item-specific evidence for a moment: the clock, the item, and its excerpt. */
export function evidenceAt(record: WholeRecord, seconds: number): string {
  let near: TapeSegment | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const segment of record.segments) {
    const gap = Math.abs(segment.seconds - seconds);
    if (gap < distance) {
      distance = gap;
      near = segment;
    }
  }
  if (!near) return "";
  return (
    formatClock(near.seconds) +
    (near.item ? " item " + near.item : "") +
    ": " +
    near.text.slice(0, 240)
  );
}
