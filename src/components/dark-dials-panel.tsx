import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton, SecHead } from "@/components/desk-chrome";
import { getDarkDials, saveDarkDials } from "@/lib/news/dark";
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

  const q = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });

  // Adopt the stored dials once, then leave the editor's drag alone.
  useEffect(() => {
    if (q.data?.dials && !draft) setDraft(q.data.dials);
  }, [q.data, draft]);

  const save = useMutation({
    mutationFn: (d: DarkDials) => saveDarkDials({ data: d }),
    onSuccess: (res) => {
      setSaved(res?.ok ? "Saved. The next round uses this." : "Could not save.");
      void qc.invalidateQueries({ queryKey: ["dark-dials"] });
      window.setTimeout(() => setSaved(""), 4000);
    },
    onError: () => setSaved("Could not save."),
  });

  const d = draft ?? q.data?.dials ?? null;
  const dirty =
    d && q.data?.dials
      ? d.dig !== q.data.dials.dig || d.nerve !== q.data.dials.nerve || d.scope !== q.data.dials.scope
      : false;

  if (!d) return null;

  const set = (patch: Partial<DarkDials>) => setDraft({ ...d, ...patch });

  return (
    <section className="mt-8 border border-rule p-4">
      <SecHead
        title="How hard to dig"
        aside={
          <InkButton tone="quiet" small onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Change"}
          </InkButton>
        }
        sub={describeDials(d)}
      />

      {open ? (
        <div className="mt-4 space-y-6">
          <div>
            <label className="block text-[11px] tracking-[0.14em] text-muted uppercase" htmlFor="dig">
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
              Hops, searches, whether it leaves the watch list, how far it follows a
              name into a company, a parcel, a contract.
            </p>
          </div>

          <div>
            <label className="block text-[11px] tracking-[0.14em] text-muted uppercase" htmlFor="nerve">
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
              — and whether it may propose a theory or only ask a question.
              Always labelled, always with what would kill it.
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
              Nerve never relaxes the three floors: no invented claims of paid
              deception, no dossiers on private residents who are not materially
              involved, and every claim keeps its label. Nothing here publishes —
              the desk hands off, and the record is what prints.
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
                <InkButton tone="quiet" small onClick={() => setDraft(q.data?.dials ?? null)}>
                  Reset
                </InkButton>
              ) : null}
              {saved ? <span className="text-sm text-muted">{saved}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
