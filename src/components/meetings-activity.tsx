import { useState } from "react";
import { agendaTitle, meetingAudioIntegrityNotice, meetingYoutubeBlockedLine } from "@/lib/news/desk-copy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, SecHead } from "@/components/desk-chrome";
import { listMeetingActivity, type MeetingActivityRow } from "@/lib/news/meeting-activity";
import { meetingStatusLabel } from "@/lib/news/meeting-activity-label";
import { captureAudioAgain } from "@/lib/news/meeting-manual-run";
import { PAPER, formatListDate, formatListDateTime } from "@/lib/paper";
import { isYoutubeRateLimit, nextYoutube429Retry } from "@/lib/news/meeting-capture-retry";

function captureTime(value: string): string {
  // A date-only publication is a calendar day, not an instant to shift between zones.
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatListDate(`${value}T12:00:00Z`, "UTC")
    : formatListDateTime(value, PAPER.timezone);
}

function savedAudio(format: string, bytes: number | null): string {
  const size = bytes == null ? "size not recorded" : bytes >= 1_000_000
    ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `Saved audio: ${format.toUpperCase()}, ${size}`;
}

function captureFailure(reason: string | null): string {
  if (/no (?:subtitles|captions)|captions unavailable/i.test(reason ?? "")) return "The capture failed: captions are unavailable.";
  if (/private|unavailable|removed|not available/i.test(reason ?? "")) return "The capture failed: the recording is unavailable.";
  if (/timed? ?out|ECONN|network|socket|connection/i.test(reason ?? "")) return "The capture failed: the connection was interrupted.";
  if (/duration|too long/i.test(reason ?? "")) return "The capture failed: the recording exceeds the time limit.";
  if (/size|too large/i.test(reason ?? "")) return "The capture failed: the recording exceeds the size limit.";
  return "The capture failed: the recording could not be saved.";
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function toneClass(tone: "ok" | "warn" | "bad"): string {
  if (tone === "bad") return "text-red-800";
  if (tone === "warn") return "text-amber-800";
  return "text-ink";
}

function MeetingCard({ row }: { row: MeetingActivityRow }) {
  const label = meetingStatusLabel(row);
  const queryClient = useQueryClient();
  const [captureProblem, setCaptureProblem] = useState("");
  const recapture = useMutation({
    mutationFn: async () => {
      const result = await captureAudioAgain({ data: { videoId: row.videoId } });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => {
      setCaptureProblem("");
      await queryClient.invalidateQueries({ queryKey: ["meeting-activity"] });
    },
    onError: () => setCaptureProblem("The new audio capture did not finish."),
  });
  return (
    <article className="border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{row.title}</h3>
        <span className={`text-sm font-medium ${toneClass(label.tone)}`}>{label.text}</span>
      </div>
      <p className="meta">
        {captureTime(row.published)}
        {row.forcedRecapture ? " · forced re-capture" : ""}
      </p>

      {row.audioIntegrityStatus === "hash-mismatch" ? (
        <div className="mt-2">
          <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {meetingAudioIntegrityNotice}
          </p>
          {row.canCaptureAgain ? (
            <button
              type="button"
              className="mt-2 min-h-11 rounded border border-rule px-4 text-sm font-medium"
              disabled={recapture.isPending}
              onClick={() => recapture.mutate()}
            >
              {recapture.isPending ? "Capturing…" : "Capture again"}
            </button>
          ) : null}
          {captureProblem ? <p className="mt-2 text-sm text-red-800" role="status">{captureProblem}</p> : null}
        </div>
      ) : null}

      {row.status === "failed" && isYoutubeRateLimit(row.failureReason ?? "") ? (
        <p role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {meetingYoutubeBlockedLine(row.youtubeRetryAt ?? nextYoutube429Retry({}, new Date()).at)}
        </p>
      ) : null}

      {row.status === "failed" && !isYoutubeRateLimit(row.failureReason ?? "") && (
        <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {captureFailure(row.failureReason)}
        </p>
      )}

      {row.status === "captured" && (
        <>
          {/*
            Unit R. A transcript this newsroom produced by listening to the
            recording is not the city's own record, and the difference matters
            to anyone citing it. Said where the transcript's hashes are shown,
            so it cannot be missed by scrolling past it.
          */}
          {row.captionFormat === "textflowkit-json" && (
            <p className="mt-2 text-sm">
              Saved transcript: speech-to-text, not official captions
            </p>
          )}
          {row.audioFormat ? <p className="mt-2 text-sm">{savedAudio(row.audioFormat, row.audioBytes)}</p>
            : row.artifactFormat && /^(mp4|m4a|opus|mp3|webm|wav)$/i.test(row.artifactFormat)
              ? <p className="mt-2 text-sm">{savedAudio(row.artifactFormat, row.artifactBytes)}</p> : null}
          {row.captionFormat && row.captionFormat !== "textflowkit-json" ? <p className="mt-2 text-sm">Saved transcript: YouTube captions</p> : null}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer">Details</summary>
            {row.captionFormat === "textflowkit-json" ? <p>Speech-to-text engine {row.transcriptionEngine ?? "not recorded"}; model {row.transcriptionModel ?? "not recorded"}</p> : null}
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <div><dt className="meta">Transcript format</dt><dd>{row.captionFormat ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="meta">Transcript hash</dt><dd className="break-all">{row.captionSha256 ?? "—"}</dd></div>
              {row.artifactSha256 ? <div className="col-span-2"><dt className="meta">Saved copy hash</dt><dd className="break-all">{row.artifactSha256}</dd></div> : null}
              <div><dt className="meta">Recording</dt><dd><a href={`https://www.youtube.com/watch?v=${row.videoId}`}>Open on YouTube</a></dd></div>
              <div><dt className="meta">Capture state</dt><dd>{row.captureDisposition === "provisional" ? "Awaiting final captions" : "Complete"}</dd></div>
              <div><dt className="meta">Transcript updates</dt><dd>{row.revisionCount}</dd></div>
            </dl>
          </details>
        </>
      )}

      {row.aligned !== null && (
        <p className={`mt-2 text-sm ${row.aligned ? "" : "text-amber-800"}`}>
          {row.aligned ? "Transcript matched to agenda items." : "The transcript could not be matched to agenda items."}
        </p>
      )}
      {row.aligned && row.chunks.length > 0 && (
        <ul className="mt-1 text-sm">
          {row.chunks.map((c) => (
            <li key={`${c.item}-${c.startSeconds}`}>item {c.item}: {agendaTitle(c.title)} ({fmtTime(c.startSeconds)}–{fmtTime(c.endSeconds)})</li>
          ))}
        </ul>
      )}

      {/*
        What the meeting produced for the desk.

        A capture that transcribed perfectly and produced no story is a different
        outcome from one that produced a draft waiting to be read. Showing only the
        transcription state left the editor unable to tell those apart.
      */}
      {row.status === "captured" && (
        <p className="mt-2 text-sm">
          {row.draftId ? (
            <>
              Draft #{row.draftId} ready to review
              {row.citationCount > 0 ? ` · ${row.citationCount} cited moment${row.citationCount === 1 ? "" : "s"}` : ""}
              {" · "}
              <a href={`/desk/story/${row.leadId}`}>Open the story</a>
            </>
          ) : row.leadId ? (
            <>
              Filed as a lead{row.leadStatus ? ` (${row.leadStatus})` : ""} · no draft yet
              {" · "}
              <a href={`/desk/story/${row.leadId}`}>Open the story</a>
            </>
          ) : row.aligned === false ? (
            <span className="text-amber-800">
              No story filed: the transcript could not be aligned to agenda items.
            </span>
          ) : row.aligned === true ? (
            <span className="text-amber-800">
              Aligned to agenda items but no story filed yet. The capture pass files a lead when it aligns.
            </span>
          ) : null}
        </p>
      )}

      {row.votes.some((v) => v.mover || v.tally) && (
        <ul className="mt-2 text-sm">
          {row.votes.filter((v) => v.mover || v.tally).map((v) => (
            <li key={v.item}>
              Vote item {v.item}: {v.mover ?? "?"} moved, seconded by {v.seconder ?? "?"}, tally {v.tally ?? "?"}, {v.result}, source {v.source ?? "?"}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function MeetingsActivity() {
  const q = useQuery({ queryKey: ["meeting-activity"], queryFn: () => listMeetingActivity() });
  if (q.isPending) return <Busy label="Loading captured meetings" />;
  if (q.isError) return <p role="alert" className="text-red-800">Could not load captured meetings. Try again.</p>;
  const rows = q.data ?? [];
  return (
    <section className="mt-12">
      <SecHead title="Captured meetings" count={rows.length} sub="What meeting capture has done for this newsroom." />
      {rows.length === 0 ? (
        <p className="wire-sum">No meetings captured yet. Configure channels in Server → Meeting capture, then run a pass.</p>
      ) : (
        <div>{rows.map((r) => <MeetingCard key={r.videoId} row={r} />)}</div>
      )}
    </section>
  );
}
