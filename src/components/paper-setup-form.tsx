/*
  CITY-SETUP final slice: the first-run setup form, shared by the gate route
  (src/routes/desk.setup.tsx, shown once right after the owner claims a
  fresh desk) and the Server page's "Paper setup" section (so a mistake
  during first-run is fixable later without touching a file).
*/
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { FormError } from "@/components/form-error";
import { inputClass } from "@/components/desk-chrome-utils";
import { completeFirstRunSetup } from "@/lib/news/paper-settings";
import type { PaperConfig } from "@/lib/news/paper-settings";
import { browserTimeZone } from "@/lib/timezone";

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
  const queryClient=useQueryClient();
  /*
    Every identity field starts blank on a first run, not just the council
    link and the watch list. `initial` falls back to the shipped Longmont
    constants, so the City box arrived reading "Longmont" as a real value --
    an operator who accepted the form got a paper whose database says
    Longmont, Colorado. The third release walkthrough caught it, in the one
    set of fields the first two rounds of this exact fix did not touch.
    Timezone keeps a working default: it is a machine string, not a town.
  */
  const [name, setName] = useState(firstRun ? "" : (initial?.name ?? ""));
  const [city, setCity] = useState(firstRun ? "" : (initial?.city ?? ""));
  const [state, setState] = useState(firstRun ? "" : (initial?.state ?? ""));
  /*
    F12: a first run offers the BROWSER's own zone, not America/Denver.

    `initial?.timezone` on a first run is the shipped Longmont constant, so
    the box arrived pre-filled "America/Denver" as a real value while the
    example text in the same box read "America/New_York" -- an operator in
    Ohio had to know their IANA name and retype it. The zone is a machine
    string, not a town, so unlike city/state it is filled in -- from the
    machine the setup is being run on.

    Set in an effect, never during render: the server has no browser zone,
    so a render-time value would differ between the server pass and the
    client's first pass and React would flag a hydration mismatch. The
    placeholder is seeded neutral for the same reason and only then updated.
  */
  const [timezone, setTimezone] = useState(firstRun ? "" : (initial?.timezone ?? ""));
  const [timezoneHint, setTimezoneHint] = useState("Continent/City");
  useEffect(() => {
    const zone = browserTimeZone();
    setTimezoneHint(zone);
    // Only a first run fills it: an onboarded paper keeps the zone it saved.
    if (firstRun) setTimezone((current) => current || zone);
  }, [firstRun]);
  const [tagline, setTagline] = useState(firstRun ? "" : (initial?.tagline ?? ""));
  const [councilVotesUrl, setCouncilVotesUrl] = useState(
    firstRun ? "" : (initial?.councilVotesUrl ?? ""),
  );
  const [editorEmail, setEditorEmail] = useState(
    firstRun ? "" : (initial?.editorEmail ?? ""),
  );
  const [youtubeChannels, setYoutubeChannels] = useState(
    firstRun ? "" : (initial?.youtubeChannels ?? []).join("\n"),
  );
  const [meetingKeywords, setMeetingKeywords] = useState(
    (initial?.meetingKeywords ?? []).join("\n"),
  );
  const [electedOfficials, setElectedOfficials] = useState(
    initial?.electedOfficials ?? "",
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
          editorEmail,
          youtubeChannels: youtubeChannels
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
          meetingKeywords: meetingKeywords
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
          electedOfficials: electedOfficials.trim(),
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
    onSuccess: async (res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setSavedAt(Date.now());
      // Settle the saved configuration before another route mounts its form
      // from cached data. Do not reset an already-mounted editor's unsaved fields.
      await queryClient.invalidateQueries({queryKey:["paper-config-for-setup"],refetchType:"all"});
      await queryClient.invalidateQueries({queryKey:["paper-config-for-invite"]});
      // The install is onboarded now, so the Server page's "Paper setup" panel
      // must stop starting blank (F4). Same key the desk's gate redirect reads.
      await queryClient.invalidateQueries({queryKey:["first-run-setup"]});
      await onDone?.();
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
          Editor contact email <span className="text-ink-2">(optional)</span>
          <input
            className={inputClass + " mt-1 w-full"}
            type="email"
            value={editorEmail}
            onChange={(e) => setEditorEmail(e.target.value)}
            placeholder="editor@example.org"
          />
          <span className="mt-1 block text-xs text-ink-2">
            Shown on About and Corrections as the way to reach the editor.
            Blank shows no address at all.
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
            placeholder={timezoneHint}
            required
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Meeting video channels <span className="text-ink-2">(optional)</span>
          <textarea
            className={inputClass + " mt-1 min-h-32 w-full"}
            value={youtubeChannels}
            onChange={(e) => setYoutubeChannels(e.target.value)}
            placeholder={"https://www.youtube.com/@RiverbendCity\nhttps://www.youtube.com/@RiverbendPublicMedia"}
          />
          <span className="mt-1 block text-xs text-ink-2">
            One YouTube channel URL per line. TownReporter checks these channels
            for meeting recordings and usable transcripts.
          </span>
        </label>
        <label className="block text-sm">
          Meeting title keywords
          <textarea
            className={inputClass + " mt-1 min-h-32 w-full"}
            value={meetingKeywords}
            onChange={(e) => setMeetingKeywords(e.target.value)}
            placeholder={"city council\nplanning commission\nzoning appeals"}
          />
          <span className="mt-1 block text-xs text-ink-2">
            One phrase per line. Only recent videos whose titles contain one of
            these phrases are treated as meeting candidates.
          </span>
        </label>
      </div>

      <label className="block text-sm">
        Elected officials and staff <span className="text-ink-2">(optional)</span>
        <textarea
          className={inputClass + " mt-1 min-h-32 w-full"}
          value={electedOfficials}
          onChange={(e) => setElectedOfficials(e.target.value)}
          placeholder={
            "Susie Hidalgo-Fahring, Mayor\nDiane Crist, Council member\nHarold Dominguez, City Manager"
          }
        />
        <span className="mt-1 block text-xs text-ink-2">
          One name and title per line. Meeting captions often misspell names;
          the whole-meeting writer corrects caption names against this list
          before it writes, and flags any name it cannot match.
        </span>
      </label>

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

      {/* UX-3: a first-run form that fails silently leaves the operator stuck. */}
      {error ? <FormError className="text-sm text-rust">{error}</FormError> : null}
      {/* Persistent so a screen reader announces the change, not a node that mounts full. */}
      <p className={savedAt && !onDone ? "text-sm text-ink-2" : "sr-only"} role="status">
        {savedAt && !onDone
          ? "Saved. The front page now shows the new name, city, kicker and welcome article."
          : ""}
      </p>

      <InkButton type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : submitLabel}
      </InkButton>
    </form>
  );
}
