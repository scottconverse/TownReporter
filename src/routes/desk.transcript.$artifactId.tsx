import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import { EmptyState, Notice, ScreenError, WorkbenchSkeleton } from "@/components/states";
import { getTranscriptView } from "@/lib/news/desk";
import {
  transcriptByteSize,
  transcriptPlainText,
  transcriptSegmentUrl,
  transcriptStamp,
} from "@/lib/news/meeting-transcript-view";

export const Route = createFileRoute("/desk/transcript/$artifactId")({
  head: () => ({ meta: [{ title: "Transcript — TownReporter" }] }),
  /*
    WR1 phase 2: the ledger panel's timestamps link here with `?at=<seconds>`,
    so the line the editor was reading is the line the transcript opens on. The
    parameter is a plain second count; anything else reads as "no position" and
    the page opens at the top, as it always did.
  */
  validateSearch: (search: Record<string, unknown>): { at: number | null } => {
    const at = Number(search.at);
    return { at: Number.isFinite(at) && at >= 0 ? Math.floor(at) : null };
  },
  component: TranscriptPage,
});

/**
 * The whole tape behind a meeting story, as text an editor can read and copy.
 *
 * Why this page exists (owner report, story 297): a council story drafted from
 * YouTube captions cited the transcript twenty times, and the story page showed
 * the editor only those twenty excerpts. Everything else that was said -- the
 * sentence before a quote, the exchange after it, the part of the meeting the
 * draft chose not to use -- was in a 1.35 MB `.srv3` on a path the story page
 * never printed. An editor could check whether a quote was spelled right and
 * not whether it was fair, which is the check that matters.
 *
 * It is deliberately a plain page: every caption segment in order, one line
 * each, `[hh:mm:ss] text`, the timestamp linking to that second of the video.
 * Copy all puts the same text on the clipboard, Download original serves the
 * stored file byte for byte under the name it was stored with, and the path,
 * hash and capture time are printed so the words on screen can be traced back
 * to the file they came from.
 *
 * It inherits `DeskGate` from the `/desk` layout route (src/routes/desk.tsx:14,
 * `createFileRoute("/desk")({ component: DeskGate })`), which is the same guard
 * every other desk page uses: a resolved session, a newsroom membership, and
 * the paper identity, or the visitor is sent to sign in. The data comes from
 * `getTranscriptView`, which is behind `deskMiddleware` -- so both the page and
 * the server function that fills it are editor-only, and the download route
 * checks the session again on its own.
 */
function TranscriptPage() {
  const { artifactId } = Route.useParams();
  const { at } = Route.useSearch();
  const id = Number(artifactId);
  const q = useQuery({
    queryKey: ["transcript-view", id],
    queryFn: () => getTranscriptView({ data: id }),
    enabled: Number.isInteger(id) && id > 0,
  });

  const [copied, setCopied] = useState("");
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const view = q.data?.ok ? q.data.view : null;
  const plainText = useMemo(() => (view ? transcriptPlainText(view) : ""), [view]);

  /*
    The line `?at` points at: the last line that started at or before that
    second, which is the line a speaker was in the middle of. A position before
    the first line lands on the first; nothing to match leaves the page alone.
  */
  const activeIndex = useMemo(() => {
    if (at === null || !view) return null;
    let best: number | null = null;
    for (const line of view.lines) {
      if (line.startSeconds <= at) best = line.segmentIndex;
      else break;
    }
    return best ?? view.lines[0]?.segmentIndex ?? null;
  }, [at, view]);

  // Bring that line into view once it is rendered. `scrollIntoView` is absent
  // in a bare DOM; the guard keeps this a convenience, never a crash.
  useEffect(() => {
    if (activeIndex === null) return;
    document.getElementById(`transcript-line-${activeIndex}`)?.scrollIntoView?.({ block: "center" });
  }, [activeIndex]);

  /*
    Copy all, with a fallback that is part of the design rather than a
    workaround. `navigator.clipboard` needs a focused document and, in some
    browser settings, a permission the editor has not granted; when it is
    unavailable the text is selected in the read-only box below instead, which
    the editor copies with the keyboard shortcut. Either way the button does
    what it says, and the status line says which one happened -- so a failed
    clipboard write never reads as success.
  */
  const copyAll = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(`Copied all ${view.lines.length} lines.`);
      return;
    } catch {
      // Falls through to the selection path.
    }
    setFallbackOpen(true);
    setCopied(
      "This browser would not write to the clipboard. The whole transcript is in the box below and selected — copy it with Ctrl+C (⌘C on a Mac).",
    );
  };

  /*
    The selection has to happen after the box is in the DOM, so it runs as an
    effect on the flag rather than in the handler above: at the moment the
    handler runs, React has not rendered the box yet and there is nothing to
    select.
  */
  useEffect(() => {
    if (!fallbackOpen) return;
    const node = fallbackRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [fallbackOpen]);

  if (!Number.isInteger(id) || id <= 0) {
    return (
      <DeskShell title="Transcript" kicker="Editor desk">
        <EmptyState
          title="That transcript is not a transcript."
          body="The address does not name a stored transcript. Open the story and use Open transcript."
        />
      </DeskShell>
    );
  }

  if (q.isPending) {
    return (
      <DeskShell title="Transcript" kicker="Editor desk">
        <WorkbenchSkeleton />
      </DeskShell>
    );
  }

  if (q.isError) {
    return (
      <DeskShell title="Transcript" kicker="Editor desk">
        <ScreenError
          message={q.error instanceof Error ? q.error.message : "The transcript could not be opened."}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      </DeskShell>
    );
  }

  if (!q.data?.ok) {
    /*
      A refusal is stated plainly, not as a desk failure: "this is not yours"
      and "there is no such transcript" are the same answer on purpose (see
      meeting-transcript-view.server.ts), and both are things an editor can act
      on -- go back to the story, or ask which newsroom the capture ran in.
    */
    return (
      <DeskShell title="Transcript" kicker="Editor desk">
        <EmptyState
          title="That transcript is not on this desk."
          body={`${q.data?.message ?? "No stored transcript matches that id."} Ask whoever ran the capture if you expected it here.`}
          action={
            <Link to="/desk/queue" className="btn quiet small">
              Back to the queue
            </Link>
          }
        />
      </DeskShell>
    );
  }

  if (!view) return null;
  const downloadUrl = q.data.downloadUrl;
  const heading = view.title ?? "Meeting transcript";
  const meta = [
    view.meetingDate ? `Meeting of ${view.meetingDate}` : null,
    `${view.lines.length} caption ${view.lines.length === 1 ? "line" : "lines"}`,
    `video ${view.videoId}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <DeskShell
      title="Transcript"
      kicker="Editor desk"
      actions={
        <>
          <InkButton tone="ghost" small onClick={() => void copyAll()}>
            Copy all
          </InkButton>
          <a className="btn small" href={downloadUrl} download>
            Download original file
          </a>
        </>
      }
    >
      <p className="crumb">
        <Link to="/desk/queue" className="inline-link">
          ← Queue
        </Link>
      </p>

      <div className="transcript-head">
        <h2 className="transcript-title">{heading}</h2>
        <p className="note-one">{meta}</p>
        <p className="note-one">
          Every caption segment of the meeting, in order. Each timestamp opens the video at that
          second. The draft's own citations are quoted in the story's notes; this is the whole tape
          they were drawn from.
        </p>
        <p className="note-one" role="status">
          {copied}
        </p>
      </div>

      {/*
        The stored file's identity, printed so the words below can be traced to
        the bytes they came from. The path is the one on the artifact row for
        this newsroom -- the page never takes a path from anywhere else, and
        the server refuses one supplied in the request.
      */}
      <div className="note-sec transcript-file-facts">
        <p className="side-label">Stored at</p>
        <p className="transcript-path">{view.storagePath}</p>
        <p className="note-one">
          SHA-256 <code className="transcript-hash">{view.sha256}</code>
        </p>
        <p className="note-one">
          Captured {view.capturedAt} · {transcriptByteSize(view.byteSize)} · {view.format}
        </p>
      </div>

      {view.lines.length === 0 ? (
        <Notice kind="warn">
          This artifact has no stored caption lines, so there is nothing to read. The original file
          is still available above.
        </Notice>
      ) : (
        <ol className="transcript-lines">
          {view.lines.map((line) => (
            <li
              key={line.segmentIndex}
              id={`transcript-line-${line.segmentIndex}`}
              className={
                activeIndex === line.segmentIndex ? "transcript-line transcript-line-at" : "transcript-line"
              }
            >
              <a
                className="transcript-stamp inline-link"
                href={transcriptSegmentUrl(view.videoId, line.startSeconds)}
                target="_blank"
                rel="noreferrer"
              >
                [{transcriptStamp(line.startSeconds)}]
              </a>{" "}
              <span className="transcript-text">{line.excerpt}</span>
            </li>
          ))}
        </ol>
      )}

      {/*
        The clipboard fallback, rendered only when the clipboard write failed.
        It is read-only so it can never become a second, editable copy of the
        record, and it appears rather than sitting hidden because a hidden
        element cannot be seen, focused, or selected.
      */}
      {fallbackOpen ? (
        <div className="note-sec">
          <label className="side-label" htmlFor="transcript-plaintext">
            The whole transcript as plain text
          </label>
          <textarea
            id="transcript-plaintext"
            ref={fallbackRef}
            className="transcript-plaintext"
            readOnly
            value={plainText}
          />
        </div>
      ) : null}
    </DeskShell>
  );
}
