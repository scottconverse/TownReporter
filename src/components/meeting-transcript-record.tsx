import type { TranscriptView } from "@/lib/news/meeting-transcript-view";
import { formatTranscriptDate, formatTranscriptTimestamp } from "@/lib/news/transcript-dates";

/** The meeting identity shown ahead of the transcript text. */
export function TranscriptRecordHeader({ view }: { view: TranscriptView }) {
  const meetingDate = formatTranscriptDate(view.meetingDate);
  const postedDate = formatTranscriptDate(view.postedDate);
  return (
    <>
      <h2 className="transcript-title">{view.title ?? "Meeting transcript"}</h2>
      <p className="note-one">
        <strong>Meeting date:</strong> {meetingDate ?? "Not listed in the title."}
      </p>
      {postedDate ? <p className="note-one">Video posted {postedDate}.</p> : null}
      <p className="note-one">
        <strong>Source:</strong>{" "}
        <a
          className="inline-link"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(view.videoId)}`}
          target="_blank"
          rel="noreferrer"
        >
          Open the meeting video
        </a>
      </p>
      <p className="note-one">
        {view.lines.length} caption {view.lines.length === 1 ? "line" : "lines"}. Each timestamp
        below opens the matching moment in the video so you can check what was said.
      </p>
    </>
  );
}

/** Machine storage facts are available without pushing the editor past the tape. */
export function TranscriptStorageDetails({ view }: { view: TranscriptView }) {
  const size =
    !Number.isFinite(view.byteSize) || view.byteSize < 0
      ? "unknown size"
      : view.byteSize < 1024
        ? `${view.byteSize} bytes`
        : view.byteSize < 1024 * 1024
          ? `${(view.byteSize / 1024).toFixed(1)} KB`
          : `${(view.byteSize / (1024 * 1024)).toFixed(2)} MB`;
  return (
    <details className="note-sec transcript-file-facts text-base">
      <summary className="cursor-pointer font-medium">Technical storage details</summary>
      <dl className="mt-2 space-y-2">
        <div>
          <dt className="side-label">Stored file</dt>
          <dd className="transcript-path break-all">{view.storagePath}</dd>
        </div>
        <div>
          <dt className="side-label">Recorded SHA-256</dt>
          <dd><code className="transcript-hash break-all">{view.sha256}</code></dd>
        </div>
        <div>
          <dt className="side-label">Captured</dt>
          <dd>{formatTranscriptTimestamp(view.capturedAt) ?? view.capturedAt}</dd>
        </div>
        <div>
          <dt className="side-label">File size and format</dt>
          <dd>{size} · {view.format}</dd>
        </div>
      </dl>
    </details>
  );
}
