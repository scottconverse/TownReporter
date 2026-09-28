import { meetingClock } from "./meeting-draft-input.ts";

/**
 * Reading the whole tape, not just the lines the draft happened to quote.
 *
 * The desk already showed an editor the twenty excerpts a meeting draft drew
 * from -- and nothing else. The transcript itself was a 1.35 MB `.srv3` on a
 * path the story page never printed, so "is this excerpt fair to what was
 * said?" could not be answered from the desk at all: the editor could see the
 * citation but not the sentence before or after it. The owner's report was
 * exactly that, and the remedy is a page that prints every segment in order,
 * each one linked to that second of the video.
 *
 * The text comes from `meeting_transcript_segments`, not from re-parsing the
 * stored file. Three reasons, in order of weight:
 *
 * 1. It is the same text. `storeMeetingTranscriptArtifact` writes the parser's
 *    own segment excerpts verbatim when the parser produced segments (and
 *    `parseTranscriptSegments` otherwise), so the stored rows and a re-parse of
 *    the file agree by construction -- `meeting-draft-material.server.ts:134`
 *    reads those same rows to build the citation candidates the draft cites.
 *    The page an editor checks quotes against must be the copy the citations
 *    resolve against, or the check is against a different document.
 * 2. It is the text citations are RESOLVED against. `resolveTranscriptCitation`
 *    and the revision re-check both match on `segment_index` into this table.
 *    Re-parsing could mint a different index numbering for the same bytes and
 *    silently move every citation.
 * 3. It also works for a speech-to-text artifact. A `textflowkit-json` run has
 *    no caption syntax to re-parse at all; only the segment rows exist.
 *
 * The original file is still served, byte for byte, by the download link -- it
 * is the retained evidence, and the reader of this page may want it. But the
 * readable page is the transcription record, not a second parse of it.
 */

/** One caption segment, as the editor reads it. */
export type TranscriptViewLine = {
  segmentIndex: number;
  startSeconds: number;
  excerpt: string;
};

/**
 * Everything the transcript page prints about the artifact it is showing.
 *
 * `storagePath`, `sha256`, `capturedAt` and `byteSize` are printed to the
 * editor rather than kept server-side: the point of the page is to let someone
 * satisfy themselves that the words on screen came from the file they think
 * they came from, which needs the path, the hash, and when it was captured.
 */
export type TranscriptView = {
  artifactId: number;
  videoId: string;
  title: string | null;
  meetingDate: string | null;
  storagePath: string;
  sha256: string;
  format: string;
  byteSize: number;
  capturedAt: string;
  lines: TranscriptViewLine[];
};

/**
 * Why the desk refused to show a transcript.
 *
 * Both refusals are deliberate and both are tested. They are not the same
 * refusal wearing one word:
 *
 * - `path-from-request`: the request carried a filesystem path. The server
 *   reads the path recorded on the artifact row and nothing else; a path in the
 *   request is an attempt to point the reader at a different file, so it is
 *   refused outright with 403 rather than ignored.
 * - `other-newsroom`: the artifact id exists, or does not, outside this
 *   newsroom. Answered as 404 -- the same answer as an id that does not exist
 *   anywhere -- so that a probe cannot use this route to learn that another
 *   newsroom's artifact is there.
 */
export type TranscriptRefusalReason = "path-from-request" | "other-newsroom";

export class TranscriptViewRefused extends Error {
  readonly reason: TranscriptRefusalReason;
  readonly status: number;
  constructor(reason: TranscriptRefusalReason, message: string) {
    super(message);
    this.name = "TranscriptViewRefused";
    this.reason = reason;
    this.status = reason === "path-from-request" ? 403 : 404;
  }
}

/** The desk page that shows a stored transcript. */
export function transcriptViewPath(artifactId: number): string {
  return `/desk/transcript/${Math.trunc(artifactId)}`;
}

/** The route that serves the stored artifact's own bytes, under its own name. */
export function transcriptDownloadUrl(artifactId: number): string {
  return `/api/transcript-file?artifactId=${Math.trunc(artifactId)}`;
}

/**
 * One line of the readable transcript: `[hh:mm:ss] excerpt`.
 *
 * The clock is `meetingClock`, the same function the notes pane and the writer
 * input use, so the timestamp an editor copies out of the reader matches the
 * timestamp the draft was given.
 */
export function transcriptLineText(line: Pick<TranscriptViewLine, "startSeconds" | "excerpt">): string {
  return `[${transcriptStamp(line.startSeconds)}] ${line.excerpt}`;
}

/** Just the bracket, `[hh:mm:ss]`, which is what the per-line link shows. */
export function transcriptStamp(seconds: number): string {
  return meetingClock(seconds);
}

/** The whole transcript as plain text, which is what "Copy all" puts on the clipboard. */
export function transcriptPlainText(view: Pick<TranscriptView, "lines">): string {
  return view.lines.map(transcriptLineText).join("\n");
}

/**
 * The video at one second, which is what every timestamp on the page links to.
 *
 * Same URL shape as `meetingCitationUrl` in the notes pane; kept here so the
 * transcript page has no dependency on a component module.
 */
export function transcriptSegmentUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${Math.max(0, Math.floor(seconds))}s`;
}

/** Bytes as the editor reads them, for the "captured" line. */
export function transcriptByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
