import { useQuery } from "@tanstack/react-query";
import { Busy, SecHead } from "@/components/desk-chrome";
import { listMeetingActivity, type MeetingActivityRow } from "@/lib/news/meeting-activity";
import { meetingStatusLabel } from "@/lib/news/meeting-activity-label";

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
  return (
    <article className="border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{row.title}</h3>
        <span className={`text-sm font-medium ${toneClass(label.tone)}`}>{label.text}</span>
      </div>
      <p className="meta">
        {row.published} · {row.channelUrl} · video {row.videoId}
        {row.forcedRecapture ? " · forced re-capture" : ""}
      </p>

      {row.status === "failed" && (
        <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {row.failureReason ?? "Capture failed with no reason recorded."}
        </p>
      )}

      {row.status === "captured" && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <div><dt className="meta">Caption format</dt><dd>{row.captionFormat ?? "—"}</dd></div>
          <div className="col-span-2"><dt className="meta">Caption hash</dt><dd className="break-all">{row.captionSha256 ?? "—"}</dd></div>
          {row.artifactFormat ? (
            <>
              <div><dt className="meta">Artifact format</dt><dd>{row.artifactFormat}</dd></div>
              <div><dt className="meta">Artifact bytes</dt><dd>{row.artifactBytes ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="meta">Artifact hash</dt><dd className="break-all">{row.artifactSha256 ?? "—"}</dd></div>
            </>
          ) : null}
          {row.audioFormat ? (
            <div className="col-span-2"><dt className="meta">Audio fallback</dt><dd>{row.audioFormat}, {row.audioBytes ?? "?"} bytes — {row.audioTriggerReason ?? "reason not recorded"}</dd></div>
          ) : null}
          <div><dt className="meta">Disposition</dt><dd>{row.captureDisposition ?? "final"}</dd></div>
          <div><dt className="meta">Revisions</dt><dd>{row.revisionCount}</dd></div>
          <div><dt className="meta">Settled under churn</dt><dd>{row.settledUnderChurn ? "yes" : "no"}</dd></div>
        </dl>
      )}

      {row.aligned !== null && (
        <p className={`mt-2 text-sm ${row.aligned ? "" : "text-amber-800"}`}>
          Alignment: {row.aligned ? "aligned" : `not aligned — ${row.alignmentReason ?? "reason not recorded"}`}
        </p>
      )}
      {row.aligned && row.chunks.length > 0 && (
        <ul className="mt-1 text-sm">
          {row.chunks.map((c) => (
            <li key={`${c.item}-${c.startSeconds}`}>item {c.item}: {c.title} ({fmtTime(c.startSeconds)}–{fmtTime(c.endSeconds)})</li>
          ))}
        </ul>
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
  if (q.isError) return <p role="alert" className="text-red-800">Could not load meetings: {q.error instanceof Error ? q.error.message : "unknown error"}</p>;
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
