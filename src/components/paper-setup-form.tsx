/*
  CITY-SETUP final slice: the first-run setup form, shared by the gate route
  (src/routes/desk.setup.tsx, shown once right after the owner claims a
  fresh desk) and the Server page's "Paper setup" section (so a mistake
  during first-run is fixable later without touching a file).
*/
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { InkButton, inputClass } from "@/components/desk-chrome";
import { completeFirstRunSetup } from "@/lib/news/paper-settings";
import type { PaperConfig } from "@/lib/news/paper-settings";

type WatchRow = { url: string; title: string };

const EMPTY_ROW: WatchRow = { url: "", title: "" };

export function PaperSetupForm({
  initial,
  onDone,
  firstRun = false,
  submitLabel = "Save and open the desk",
}: {
  initial?: Partial<PaperConfig>;
  onDone?: () => void;
  /** First-run setup, so the watch list starts empty rather than Longmont's. */
  firstRun?: boolean;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "America/Denver");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [councilVotesUrl, setCouncilVotesUrl] = useState(
    firstRun ? "" : (initial?.councilVotesUrl ?? ""),
  );
  /*
    On a first run the watch list starts EMPTY.

    `initial` comes from getPaperConfig, which falls back to the shipped
    Longmont constants when nothing is configured -- so a brand-new city in
    Ohio was handed eleven Longmont URLs to delete before it could type its
    own. Re-editing later on the Server page still shows what is configured,
    which is the whole point there.
  */
  const [rows, setRows] = useState<WatchRow[]>(
    !firstRun && initial?.seedSources?.length
      ? initial.seedSources.map((s) => ({ url: s.url, title: s.title }))
      : [{ ...EMPTY_ROW }],
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: () =>
      completeFirstRunSetup({
        data: {
          name: name.trim(),
          city: city.trim(),
          state: state.trim(),
          timezone: timezone.trim(),
          tagline: tagline.trim(),
          councilVotesUrl,
          watchlist: rows
            .filter((r) => r.url.trim())
            .map((r) => ({
              url: r.url.trim(),
              title: r.title.trim() || r.url.trim(),
              kind: "official" as const,
              tier: "A" as const,
            })),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setSavedAt(Date.now());
      onDone?.();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "That did not save."),
  });

  function updateRow(i: number, patch: Partial<WatchRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <form
      className="mt-4 max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || !city.trim() || !state.trim() || !timezone.trim()) {
          setError("Paper name, city, state and timezone are required.");
          return;
        }
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Paper name
          <input
            className={inputClass + " mt-1 w-full"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Riverbend Record"
            required
          />
        </label>
        <label className="block text-sm">
          Tagline
          <input
            className={inputClass + " mt-1 w-full"}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="The river town's paper of record."
          />
        </label>
        <label className="block text-sm">
          Council votes site <span className="text-ink-2">(optional)</span>
          <input
            className={inputClass + " mt-1 w-full"}
            value={councilVotesUrl}
            onChange={(e) => setCouncilVotesUrl(e.target.value)}
            placeholder="https://yourcitycouncil.org/"
          />
          <span className="mt-1 block text-xs text-ink-2">
            Linked from the paper's nav. Leave it blank and the link is not shown --
            better than sending your readers to another town's council.
          </span>
        </label>
        <label className="block text-sm">
          City
          <input
            className={inputClass + " mt-1 w-full"}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Riverbend"
            required
          />
        </label>
        <label className="block text-sm">
          State
          <input
            className={inputClass + " mt-1 w-full"}
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="Ohio"
            required
          />
        </label>
        <label className="block text-sm">
          Timezone (IANA)
          <input
            className={inputClass + " mt-1 w-full"}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
            required
          />
        </label>
      </div>

      <div>
        <p className="text-sm font-medium">Starting watch list</p>
        <p className="mt-1 text-sm text-muted">
          A few pages worth watching for stories -- the city site, the council
          page, a local paper. You can add more later from Sources.
        </p>
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 min-w-[14rem] text-sm">
                URL
                <input
                  className={inputClass + " mt-1 w-full"}
                  value={r.url}
                  onChange={(e) => updateRow(i, { url: e.target.value })}
                  placeholder="https://example.gov/"
                />
              </label>
              <label className="block flex-1 min-w-[10rem] text-sm">
                Title
                <input
                  className={inputClass + " mt-1 w-full"}
                  value={r.title}
                  onChange={(e) => updateRow(i, { title: e.target.value })}
                  placeholder="City of Riverbend"
                />
              </label>
              <InkButton
                type="button"
                tone="quiet"
                small
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
              >
                Remove
              </InkButton>
            </div>
          ))}
        </div>
        <div className="mt-2">
          <InkButton
            type="button"
            tone="quiet"
            small
            onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
          >
            Add another
          </InkButton>
        </div>
      </div>

      {error ? <p className="text-sm text-rust">{error}</p> : null}
      {savedAt && !onDone ? <p className="text-sm text-ink-2">Saved.</p> : null}

      <InkButton type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : submitLabel}
      </InkButton>
    </form>
  );
}
