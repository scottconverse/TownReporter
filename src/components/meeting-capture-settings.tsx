import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, Field, InkButton, SecHead, inputClass } from "@/components/desk-chrome";
import {
  getMeetingSettingsFn,
  saveMeetingSettingsFn,
  type MeetingRetentionMode,
} from "@/lib/news/meeting-settings";

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
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Hydrate local edit state from the server exactly once.
  if (settings.data && channels === null) {
    setChannels(settings.data.channels);
    setStorageRoot(settings.data.storageRoot ?? "");
    setRetentionMode(settings.data.retentionMode);
    setEnabled(settings.data.enabled);
  }

  const save = useMutation({
    mutationFn: () =>
      saveMeetingSettingsFn({
        data: {
          channels: channels ?? [],
          storageRoot: (storageRoot ?? "").trim() || null,
          retentionMode: retentionMode ?? "transcript-only",
          enabled: enabled ?? false,
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
      </div>
    </section>
  );
}
