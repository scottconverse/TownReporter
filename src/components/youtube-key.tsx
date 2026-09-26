import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, Field, InkButton, SecHead } from "@/components/desk-chrome";
import { inputClass } from "@/components/desk-chrome-utils";
import {
  getYouTubeKeyStateFn,
  removeYouTubeApiKeyFn,
  saveYouTubeApiKeyFn,
  testYouTubeApiKeyFn,
  type YouTubeKeyState,
} from "@/lib/news/youtube-data-settings";
import { redactSecret, youtubeUsageLine } from "@/lib/news/youtube-data-api";

/*
  The YouTube key box (0.6.70, Unit AN).

  Scott makes a YouTube Data API v3 key in Google Cloud and pastes it here. The
  key is encrypted on the server with the same helper the custom AI connections
  use and is WRITE-ONLY: this component never receives it back, so the box
  cannot re-display it, and no message on this page can quote it.

  Four things an editor needs, and nothing else:

    - whether a key is set, and whether it came from the app's environment
    - a box to paste one into, with Save
    - Remove, for taking it back out
    - Test, which spends one channels.list call and says whether Google
      accepted the key -- for a pasted key before saving it, or for the saved
      one after.

  The Test button is the only place the desk ever learns a key is wrong, and it
  says so in Google's plain words (see youtube-data-api.ts) rather than a status
  code.
*/

const YOUTUBE_KEY_QUERY_KEY = ["youtube-api-key"] as const;

function keyStateLine(state: YouTubeKeyState | undefined): string {
  if (!state) return "Checking for a key…";
  if (state.source === "env") return "A key is saved in the app's environment (YOUTUBE_API_KEY).";
  return state.hasKey ? "A key is saved." : "No key.";
}

export function YoutubeKeySettings() {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: YOUTUBE_KEY_QUERY_KEY,
    queryFn: () => getYouTubeKeyStateFn(),
  });

  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const keep = (next: YouTubeKeyState) => {
    qc.setQueryData<YouTubeKeyState | undefined>(YOUTUBE_KEY_QUERY_KEY, next);
  };
  // Any message an editor is about to read has the paste scrubbed out of it
  // first, and the draft is cleared on both success and failure -- a box that
  // still holds the key after a failed save is the one case where the value
  // would sit on screen in plain text for as long as the page is open.
  const explain = (err: unknown, fallback: string) =>
    redactSecret(err instanceof Error ? err.message : String(err), draft) || fallback;

  const save = useMutation({
    mutationFn: () => saveYouTubeApiKeyFn({ data: { apiKey: draft } }),
    onSuccess: (next) => {
      setDraft("");
      keep(next);
      setResult({ ok: true, text: "Key saved. The desk will use the official API from the next scan." });
    },
    onError: (err) => {
      setDraft("");
      setResult({ ok: false, text: explain(err, "The desk could not save that key.") });
    },
  });

  const remove = useMutation({
    mutationFn: () => removeYouTubeApiKeyFn(),
    onSuccess: (next) => {
      keep(next);
      setResult({
        ok: true,
        text: "Key removed. YouTube is read from the public feed again.",
      });
    },
    onError: (err) =>
      setResult({ ok: false, text: explain(err, "The desk could not remove the key.") }),
  });

  const test = useMutation({
    mutationFn: () => testYouTubeApiKeyFn({ data: { apiKey: draft } }),
    onSuccess: (r) => {
      setResult({ ok: r.ok, text: redactSecret(r.message, draft) });
      // A test spends a unit, so the meter beside the box is stale now.
      void qc.invalidateQueries({ queryKey: YOUTUBE_KEY_QUERY_KEY });
    },
    onError: (err) =>
      setResult({ ok: false, text: explain(err, "The desk could not reach Google to test the key.") }),
  });

  if (state.isPending) return <Busy label="Checking for a YouTube key" />;
  if (state.isError) {
    return (
      <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
        The desk could not read the YouTube key setting. Reload the page to try again — the saved key
        is unchanged.
      </p>
    );
  }

  const busy = save.isPending || remove.isPending || test.isPending;

  return (
    <section className="mt-10" aria-label="YouTube key">
      <SecHead
        title="YouTube key"
        sub="Give the desk a YouTube Data API v3 key and it finds videos with Google's official service instead of reading the public pages. Without one — or when Google refuses — the desk reads the public feed as before."
      />

      <p className="mt-3 text-sm text-ink-2">{keyStateLine(state.data)}</p>
      <p className="mt-1 font-mono text-sm text-ink-2">
        {youtubeUsageLine(state.data?.unitsToday ?? 0, state.data?.unitsLimit)}
      </p>
      {state.data?.quotaBlockedToday ? (
        <p role="status" className="mt-2 text-sm text-ink-2">
          Google refused today's calls for quota, so the desk is reading the public feed. It will ask
          the official API again after midnight Pacific.
        </p>
      ) : null}

      <div className="mt-4 space-y-5">
        <Field
          label="YouTube API key"
          hint="Paste the key from Google Cloud. It is encrypted before it is stored and is never shown again — not here, not in the scan history, not in a log line."
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label="YouTube API key"
            placeholder="AIza…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>

        {result ? (
          <p
            role="status"
            className={`rounded border px-3 py-2 text-sm ${
              result.ok
                ? "border-rule bg-paper-2 text-ink"
                : "border-red-300 bg-red-50 text-red-800"
            }`}
          >
            {result.text}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <InkButton
            type="button"
            ariaLabel="Save YouTube key"
            disabled={busy || !draft.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save key"}
          </InkButton>
          <InkButton
            type="button"
            ariaLabel="Test YouTube key"
            tone="quiet"
            disabled={busy}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing…" : "Test"}
          </InkButton>
          <InkButton
            type="button"
            ariaLabel="Remove the saved YouTube key"
            tone="quiet-danger"
            disabled={busy || !state.data?.hasKey}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </InkButton>
        </div>

        <p className="text-sm text-ink-2">
          Test spends one of the day's 10,000 units and asks Google about the first channel the desk
          watches. Typing a key and pressing Test checks it without saving it.
        </p>
      </div>
    </section>
  );
}
