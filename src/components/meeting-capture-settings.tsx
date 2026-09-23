import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, Field, InkButton, SecHead, inputClass } from "@/components/desk-chrome";
import {
  getMeetingSettingsFn,
  saveMeetingSettingsFn,
  type MeetingRetentionMode,
} from "@/lib/news/meeting-settings";
import { runMeetingsNow, forceRecaptureMeeting, stopMeetingsNow, resumeStoppedMeetingsNow, type MeetingManualRunResult } from "@/lib/news/meeting-manual-run";

/*
  N-1: the meeting-capture operator configuration surface.

  It writes the real tables (meeting_channel_priority, meeting_capture_settings)
  and shows the operator exactly why a save failed. No silent success.
*/
export function MeetingCaptureSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["meeting-settings"], queryFn: () => getMeetingSettingsFn() });

  const [channels, setChannels] = useState<string[] | null>(null);
  const [storageRoot, setStorageRoot] = useState<string | null>(null);
  const [retentionMode, setRetentionMode] = useState<MeetingRetentionMode | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [durationCapHours, setDurationCapHours] = useState<number | null>(null);
  const [sizeCapMb, setSizeCapMb] = useState<number | null>(null);
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Hydrate local edit state from the server exactly once.
  if (settings.data && channels === null) {
    setChannels(settings.data.channels);
    setStorageRoot(settings.data.storageRoot ?? "");
    setRetentionMode(settings.data.retentionMode);
    setEnabled(settings.data.enabled);
    setDurationCapHours(Math.round((settings.data.durationCapSeconds / 3600) * 10) / 10);
    setSizeCapMb(Math.round(settings.data.sizeCapBytes / (1024 * 1024)));
  }

  const save = useMutation({
    mutationFn: () =>
      saveMeetingSettingsFn({
        data: {
          channels: channels ?? [],
          storageRoot: (storageRoot ?? "").trim() || null,
          retentionMode: retentionMode ?? "transcript-only",
          enabled: enabled ?? false,
          durationCapSeconds: Math.round((durationCapHours ?? 8) * 3600),
          sizeCapBytes: Math.round((sizeCapMb ?? 500) * 1024 * 1024),
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setSaved(false);
        setError(result.error);
        return;
      }
      setError("");
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ["meeting-settings"] });
    },
    onError: (e) => {
      setSaved(false);
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  if (settings.isPending) return <Busy label="Loading meeting capture settings" />;

  const list = channels ?? [];

  const addChannel = () => {
    const v = newChannel.trim();
    if (!v) return;
    setChannels([...list, v]);
    setNewChannel("");
    setSaved(false);
  };
  const removeChannel = (i: number) => {
    setChannels(list.filter((_, idx) => idx !== i));
    setSaved(false);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setChannels(next);
    setSaved(false);
  };

  return (
    <section className="mt-10">
      <SecHead
        title="Meeting capture"
        sub="Watch city YouTube channels, capture meetings, and store transcripts. These settings write immediately to this newsroom's configuration."
      />
      <div className="mt-4 space-y-5">
        <Field label="Meeting capture" hint="Turn the meetings step on or off without deleting your configuration.">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Meeting capture enabled"
              checked={enabled ?? false}
              onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
            />
            {(enabled ?? false) ? "Enabled" : "Disabled"}
          </label>
        </Field>

        <Field label="Meeting channels" hint="YouTube channel URLs in priority order. Add, remove, or reorder with the arrows.">
          <ul className="space-y-1">
            {list.map((url, i) => (
              <li key={`${url}-${i}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{url}</span>
                <button type="button" className="px-1" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="px-1" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="px-1 text-red-700" aria-label="Remove" onClick={() => removeChannel(i)}>✕</button>
              </li>
            ))}
            {!list.length && <li className="text-sm text-ink-2">No channels yet.</li>}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass}
              aria-label="New meeting channel URL"
              placeholder="https://www.youtube.com/@CityofLongmont"
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChannel(); } }}
            />
            <InkButton type="button" onClick={addChannel}>Add</InkButton>
          </div>
        </Field>

        <Field label="Storage root" hint="Absolute folder for captured artifacts. May be on a different drive (e.g. D:\\TownReporter\\meetings). Verified writable when you save.">
          <input
            className={inputClass}
            aria-label="Storage root"
            placeholder="D:\\TownReporter\\meetings"
            value={storageRoot ?? ""}
            onChange={(e) => { setStorageRoot(e.target.value); setSaved(false); }}
          />
        </Field>

        <Field label="Retention mode" hint="What is kept for each captured meeting.">
          <select
            className={inputClass}
            aria-label="Retention mode"
            value={retentionMode ?? "transcript-only"}
            onChange={(e) => { setRetentionMode(e.target.value as MeetingRetentionMode); setSaved(false); }}
          >
            <option value="transcript-only">Transcript only</option>
            <option value="audio-only">Audio only</option>
            <option value="media">Media (audio + transcript)</option>
          </select>
        </Field>

        <Field label="Capture caps" hint="A capture longer or larger than these is REFUSED with a reason, never silently truncated. Defaults: 8 hours, 500 MB (pending Scott's confirmation).">
          <div className="flex items-center gap-3">
            <label className="text-sm">Duration (hours)
              <input
                className={inputClass}
                aria-label="Duration cap hours"
                type="number"
                min={0.5}
                step={0.5}
                value={durationCapHours ?? 8}
                onChange={(e) => { setDurationCapHours(Number(e.target.value)); setSaved(false); }}
              />
            </label>
            <label className="text-sm">Size (MB)
              <input
                className={inputClass}
                aria-label="Size cap MB"
                type="number"
                min={1}
                step={1}
                value={sizeCapMb ?? 500}
                onChange={(e) => { setSizeCapMb(Number(e.target.value)); setSaved(false); }}
              />
            </label>
          </div>
        </Field>

        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {saved && !error && <p className="text-sm text-emerald-700">Saved.</p>}

        <div className="flex items-center gap-3">
          <InkButton type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save meeting capture settings"}
          </InkButton>
        </div>

        <ManualRunControls enabled={enabled ?? false} />
      </div>
    </section>
  );
}

/*
  N-2: manual run control. "Run meetings now" runs a pass on demand with no daily
  reservation limit; the result shown is read from the scan_runs row the run wrote
  (found / captured / failed / named failures), not from an in-memory summary.
  The forced re-capture control overwrites one specific meeting's stored transcript
  and records that it was forced.
*/
function ManualRunControls({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<MeetingManualRunResult | null>(null);
  const [resumeResult, setResumeResult] = useState<{ ok: boolean; resumed: number; skipped: number; failures: string[]; coverageLine: string } | null>(null);
  const [forceId, setForceId] = useState("");
  const [forceTitle, setForceTitle] = useState("");
  const [forcePublished, setForcePublished] = useState("");
  const [forceChannel, setForceChannel] = useState("");

  const run = useMutation({
    mutationFn: () => runMeetingsNow(),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ["scans"] }); },
    onError: (e) => setResult({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  });
  const force = useMutation({
    mutationFn: () => forceRecaptureMeeting({
      data: { videoId: forceId.trim(), channelUrl: forceChannel.trim(), title: forceTitle.trim(), published: forcePublished.trim() },
    }),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ["scans"] }); },
    onError: (e) => setResult({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  });

  /*
    N-5 Continue: resume captures the operator stopped. A stopped capture is
    not terminal -- yt-dlp left a partial and will continue it. Captures with
    nothing on disk are reported as skipped with a named reason rather than
    offered as a resume with nothing behind it.
  */
  const resume = useMutation({
    mutationFn: () => resumeStoppedMeetingsNow(),
    onSuccess: (r) => {
      setResumeResult(r);
      void qc.invalidateQueries({ queryKey: ["scans"] });
    },
    onError: (e) => setResumeResult({ ok: false, resumed: 0, skipped: 0, failures: [e instanceof Error ? e.message : String(e)], coverageLine: "" }),
  });

  return (
    <section className="mt-8 border-t border-rule pt-5">
      <SecHead title="Run now" sub="Run a meeting-capture pass on demand. This does not consume the daily scheduled run, and you can run it as often as you like." />
      <div className="mt-3 flex items-center gap-3">
        <InkButton
          type="button"
          ariaLabel="Run meetings now"
          disabled={!enabled || run.isPending || force.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? "Running…" : "Run meetings now"}
        </InkButton>
        {!enabled && <span className="text-sm text-ink-2">Turn meeting capture on to run.</span>}
      </div>

      {/*
        N-5 Continue. Only offered when there is something to continue: a
        stopped capture that still has a partial on disk. The result names how
        many resumed and how many were skipped, so an empty resume is never
        reported as a success.
      */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <InkButton
          type="button"
          ariaLabel="Resume stopped meeting captures"
          tone="quiet"
          disabled={!enabled || resume.isPending || run.isPending}
          onClick={() => resume.mutate()}
        >
          {resume.isPending ? "Resuming…" : "Resume stopped captures"}
        </InkButton>
        <span className="text-sm text-ink-2">
          Continues a capture you stopped, using the partial already on disk.
        </span>
      </div>

      {resumeResult && (
        <p role="status" className="mt-2 text-sm text-ink-2">
          {resumeResult.resumed > 0
            ? `Resumed ${resumeResult.resumed} capture${resumeResult.resumed === 1 ? "" : "s"}.`
            : "Nothing to resume."}
          {resumeResult.skipped > 0
            ? ` ${resumeResult.skipped} stopped capture${resumeResult.skipped === 1 ? "" : "s"} had no partial on disk and would have to start over.`
            : ""}
          {resumeResult.failures.length > 0 ? ` ${resumeResult.failures.join(" ")}` : ""}
        </p>
      )}

      {run.isPending && (
        <div role="status" className="mt-3 flex items-center gap-3 text-sm text-ink-2">
          <span>Capturing… progress shows in the scan history as it runs.</span>
          <InkButton type="button" tone="quiet-danger" ariaLabel="Stop meetings now" onClick={() => { void stopMeetingsNow(); }}>
            Stop
          </InkButton>
        </div>
      )}

      <div className="mt-5">
        <SecHead title="Force a re-capture" sub="Fetches ONE meeting again and keeps any changed transcript as a new immutable revision. The earlier recording evidence remains available." />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className={inputClass} aria-label="Force video id" placeholder="YouTube video id (11 chars)" value={forceId} onChange={(e) => setForceId(e.target.value)} />
          <input className={inputClass} aria-label="Force channel URL" placeholder="Channel URL" value={forceChannel} onChange={(e) => setForceChannel(e.target.value)} />
          <input className={inputClass} aria-label="Force meeting title" placeholder="Meeting title" value={forceTitle} onChange={(e) => setForceTitle(e.target.value)} />
          <input className={inputClass} aria-label="Force meeting date" placeholder="Published date (e.g. 2026-07-28)" value={forcePublished} onChange={(e) => setForcePublished(e.target.value)} />
        </div>
        <div className="mt-3">
          <InkButton
            type="button"
            ariaLabel="Force re-capture meeting"
            tone="quiet"
            disabled={force.isPending || run.isPending || !forceId.trim()}
            onClick={() => force.mutate()}
          >
            {force.isPending ? "Re-capturing…" : "Force re-capture and retain revision"}
          </InkButton>
        </div>
      </div>

      {result && (
        <div className="mt-5 rounded border border-rule bg-paper px-3 py-3 text-sm">
          {result.ok ? (
            <>
              <p className="font-medium">
                Run #{result.scanRunId}: {result.found} found, {result.captured} captured, {result.failed} failed{result.forced ? " (forced re-capture)" : ""}
              </p>
              <p className="text-ink-2">{result.coverageLine}</p>
              {result.failures.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-red-800">
                  {result.failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
            </>
          ) : (
            <p role="alert" className="text-red-800">{result.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
