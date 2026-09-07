import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton, SecHead } from "@/components/desk-chrome";
import { getDarkDials, saveDarkDials } from "@/lib/news/dark";
import { type ResearchPreferences } from "@/lib/news/dark-preferences";
import {
  PRESETS,
  SCOPE_LABEL,
  describeDials,
  estimateMinutes,
  stanceFor,
  type DarkDials,
  type DarkScope,
} from "@/lib/news/dark-dials";

/**
 * How hard the desk digs, as two sliders an editor can reach.
 *
 * The sentence under the controls is the point of the whole panel. "Dig 7,
 * nerve 8" tells nobody what is about to happen; "up to eight hops, one account
 * is enough to open a file, it will say what it thinks is happening" does. It
 * is computed from the same pure functions the server uses, so what the panel
 * promises and what the run does cannot drift apart.
 */
const SCOPES: DarkScope[] = ["city", "county", "region", "adjacent"];

export function DarkDialsPanel() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DarkDials | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [preferences, setPreferences] = useState<ResearchPreferences | null>(null);

  const q = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });

  // Adopt the stored dials once, then leave the editor's drag alone.
  useEffect(() => {
    if (q.data?.dials && !draft) setDraft(q.data.dials);
    if (q.data?.preferences && !preferences) setPreferences(q.data.preferences);
  }, [q.data, draft, preferences]);

  const save = useMutation({
    mutationFn: (d: DarkDials) => saveDarkDials({ data: { ...d, preferences: preferences! } }),
    onSuccess: (res) => {
      setSaved(res?.ok ? "Saved. The next round uses this." : "Could not save.");
      if (res?.ok) {
        setDraft(res.dials);
        setPreferences(res.preferences);
      }
      void qc.invalidateQueries({ queryKey: ["dark-dials"] });
      window.setTimeout(() => setSaved(""), 4000);
    },
    onError: (error) =>
      setSaved(
        `Could not confirm the save: ${error.message.replace(/\.$/, "")}. Reload the page to check the saved settings.`,
      ),
  });

  const d = draft ?? q.data?.dials ?? null;
  const dirty =
    d && q.data?.dials
      ? d.dig !== q.data.dials.dig ||
        d.nerve !== q.data.dials.nerve ||
        d.scope !== q.data.dials.scope ||
        JSON.stringify(preferences) !== JSON.stringify(q.data.preferences)
      : false;

  if (q.isError)
    return (
      <section className="mt-8 border border-rule p-4">
        <p role="alert">
          Could not read the saved investigative settings. No default settings were substituted.
        </p>
        <InkButton onClick={() => void q.refetch()}>Retry settings</InkButton>
      </section>
    );
  if (!d || !preferences) return null;

  const set = (patch: Partial<DarkDials>) => setDraft({ ...d, ...patch });
  const setPreference = (patch: Partial<ResearchPreferences>) => {
    setPreferences({ ...preferences, ...patch });
    setSaved("");
  };

  return (
    <section className="mt-8 border border-rule p-4">
      <SecHead
        title="How hard to dig"
        aside={
          <InkButton tone="quiet" small onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Change"}
          </InkButton>
        }
        sub={describeDials(q.data?.dials ?? d)}
      />
      <p className="mt-2 text-sm">
        Saved search preference:{" "}
        {q.data?.preferences.mode === "range"
          ? `${q.data.preferences.startDate} through ${q.data.preferences.endDate}`
          : `last ${q.data?.preferences.lookbackDays ?? 90} UTC calendar days`}
        . Verify up to {q.data?.preferences.verificationLimit ?? 6} signals per round. Dates guide
        searches; they do not certify source dates or completeness.
      </p>

      {open ? (
        <div className="mt-4 space-y-6">
          <div>
            <label
              className="block text-[11px] tracking-[0.14em] text-muted uppercase"
              htmlFor="dig"
            >
              Dig — how far it chases · {d.dig}/10
            </label>
            <input
              id="dig"
              type="range"
              min={1}
              max={10}
              value={d.dig}
              onChange={(e) => set({ dig: Number(e.target.value) })}
              className="mt-2 w-full"
            />
            <p className="text-sm text-muted">
              Hops, searches, whether it leaves the watch list, how far it follows a name into a
              company, a parcel, a contract.
            </p>
          </div>

          <div>
            <label
              className="block text-[11px] tracking-[0.14em] text-muted uppercase"
              htmlFor="nerve"
            >
              Nerve — how speculative · {d.nerve}/10
            </label>
            <input
              id="nerve"
              type="range"
              min={1}
              max={10}
              value={d.nerve}
              onChange={(e) => set({ nerve: Number(e.target.value) })}
              className="mt-2 w-full"
            />
            <p className="text-sm text-muted">
              How sure it has to be before it writes a signal down —{" "}
              {stanceFor(d).minConfidence <= 0
                ? "no floor at all"
                : `${Math.round(stanceFor(d).minConfidence * 100)}% at this setting`}{" "}
              — and whether it may propose a theory or only ask a question. Always labelled, always
              with what would kill it.
            </p>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Map</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <InkButton
                  key={s}
                  tone={d.scope === s ? "solid" : "quiet"}
                  small
                  onClick={() => set({ scope: s })}
                >
                  {s}
                </InkButton>
              ))}
            </div>
            <p className="mt-1 text-sm text-muted">{SCOPE_LABEL[d.scope]}</p>
          </div>

          <div>
            <label className="f">
              <span>Search date preference</span>
              <select
                aria-label="Search date preference"
                value={preferences.mode}
                onChange={(e) =>
                  setPreference({ mode: e.target.value as ResearchPreferences["mode"] })
                }
              >
                <option value="lookback">Look back a number of UTC calendar days</option>
                <option value="range">Use a date range</option>
              </select>
            </label>
            {preferences.mode === "lookback" ? (
              <label className="f mt-3">
                <span>Lookback (1–3650 UTC calendar days)</span>
                <input
                  aria-label="Lookback in UTC calendar days"
                  type="number"
                  min={1}
                  max={3650}
                  value={preferences.lookbackDays}
                  onChange={(e) => setPreference({ lookbackDays: Number(e.target.value) })}
                />
              </label>
            ) : (
              <div className="mt-3 space-y-3">
                <label className="f">
                  <span>Start date</span>
                  <input
                    aria-label="Start date"
                    type="date"
                    value={preferences.startDate ?? ""}
                    onChange={(e) => setPreference({ startDate: e.target.value || null })}
                  />
                </label>
                <label className="f">
                  <span>End date</span>
                  <input
                    aria-label="End date"
                    type="date"
                    value={preferences.endDate ?? ""}
                    onChange={(e) => setPreference({ endDate: e.target.value || null })}
                  />
                </label>
              </div>
            )}
            <label className="f mt-3">
              <span>Signals to verify per round (1–24)</span>
              <input
                aria-label="Signals to verify per round"
                type="number"
                min={1}
                max={24}
                value={preferences.verificationLimit}
                onChange={(e) => setPreference({ verificationLimit: Number(e.target.value) })}
              />
            </label>
            <p className="mt-2 text-sm">
              A larger limit can take longer and use more model calls. Signals beyond the limit
              remain unverified and are counted as deferred. Every attempted signal still faces all
              four gates. These preferences are saved with the other controls; presets below change
              only dig, nerve and map.
            </p>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Presets</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <InkButton key={p.id} tone="quiet" small onClick={() => setDraft(p.dials)}>
                  {p.name}
                </InkButton>
              ))}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {PRESETS.map((p) => (
                <li key={p.id}>
                  <span className="text-ink-2">{p.name}</span> — {p.blurb}
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-rule pt-4">
            <p className="text-ink-2">{describeDials(d)}</p>
            <p className="mt-1 text-sm text-muted">
              A round at this setting takes roughly {estimateMinutes(d)} minute
              {estimateMinutes(d) === 1 ? "" : "s"}.
            </p>
            <p className="mt-2 text-sm text-muted">
              Nerve never relaxes the three floors: no invented claims of paid deception, no
              dossiers on private residents who are not materially involved, and every claim keeps
              its label. Nothing here publishes — the desk hands off, and the record is what prints.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <InkButton
                tone="solid"
                small
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(d)}
              >
                {save.isPending ? "Saving…" : "Save"}
              </InkButton>
              {dirty ? (
                <InkButton
                  tone="quiet"
                  small
                  onClick={() => {
                    setDraft(q.data?.dials ?? null);
                    setPreferences(q.data?.preferences ?? null);
                    setSaved("");
                  }}
                >
                  Reset
                </InkButton>
              ) : null}
              {saved ? (
                <span role="status" className="text-sm text-muted">
                  {saved}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
