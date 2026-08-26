import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, areaClass } from "@/components/desk-chrome";
import { BusyLine, EmptyState, ListSkeleton, Notice } from "@/components/states";
import {
  continueInvestigation,
  getInvestigation,
  listDarkPromises,
  listDarkRuns,
  listDarkSignals,
  listInvestigations,
  runDarkDesk,
  sendDarkSignalToQueue,
} from "@/lib/news/dark";
import { formatDate, formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/dark")({
  component: DarkPage,
});

function DarkPage() {
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [queuedLead, setQueuedLead] = useState<number | null>(null);
  const signals = useQuery({ queryKey: ["dark-signals"], queryFn: () => listDarkSignals() });
  const runs = useQuery({ queryKey: ["dark-runs"], queryFn: () => listDarkRuns() });
  const promises = useQuery({ queryKey: ["dark-promises"], queryFn: () => listDarkPromises() });
  const investigations = useQuery({
    queryKey: ["investigations"],
    queryFn: () => listInvestigations(),
  });
  const detail = useQuery({
    queryKey: ["investigation", openId],
    queryFn: () => getInvestigation({ data: openId! }),
    enabled: openId != null,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["dark-signals"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
    void qc.invalidateQueries({ queryKey: ["dark-promises"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    if (openId != null) void qc.invalidateQueries({ queryKey: ["investigation", openId] });
  };

  const run = useMutation({
    mutationFn: () => runDarkDesk({ data: { paste } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice("error" in res ? String(res.error) : "Dark desk failed");
        return;
      }
      setNotice(null);
      setOpenId(res.investigationId);
      invalidate();
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : "Dark desk failed");
    },
  });

  const cont = useMutation({
    mutationFn: (id: number) => continueInvestigation({ data: id }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      setNotice(null);
      setOpenId(res.investigationId);
      invalidate();
    },
    onError: (err) => {
      setNotice(err instanceof Error ? err.message : "Continue failed");
    },
  });

  const toQueue = useMutation({
    mutationFn: (id: number) => sendDarkSignalToQueue({ data: id }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (res.ok) {
        setQueuedLead(res.leadId);
        setNotice(`In the working queue as lead ${res.leadId}.`);
      } else {
        setNotice(res.error);
      }
    },
  });

  return (
    <DeskShell night title="Dark desk" kicker="Lane 3 — investigative engine">
      <div className="max-w-2xl border border-ink-2 bg-ink-2 p-4">
        <p>
          Search broadly. Dig recursively. Preserve evidence. Challenge
          conclusions. The watch list is a starting point, not a fence. Five
          hops per run; continue if the frontier is still open. Publication is a
          separate human action.
        </p>
      </div>
      <label className="mt-6 block space-y-1.5">
        <span className="text-[11px] tracking-[0.14em] text-paper-2 uppercase">
          Paste minutes, a packet, a name, a contract number — optional seed
        </span>
        <textarea
          className={areaClass + " min-h-36"}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Transcript, staff report, an LLC, an RFP number…"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <InkButton tone="invert" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Digging…" : "Start investigation"}
        </InkButton>
      </div>
      {run.isPending && (
        <div className="enter-fade-fast mt-6 border border-ink-2 bg-ink-2 p-4">
          <BusyLine
            night
            label="Recursive search — several hops. Stay on this page."
          />
        </div>
      )}
      {run.data?.ok && (
        <div className="enter-fade-fast mt-6 border border-paper-2 bg-ink-2 p-4">
          <p className="font-medium">
            Investigation {run.data.investigationId} · {run.data.hops} hops ·{" "}
            {run.data.artifacts} artifacts · {run.data.frontier} frontier
            {run.data.paused ? " · paused with work remaining" : ""}
          </p>
          {run.data.summary && (
            <p className="mt-2 whitespace-pre-wrap text-paper-2">{run.data.summary}</p>
          )}
        </div>
      )}
      {cont.isPending && (
        <div className="enter-fade-fast mt-6 border border-ink-2 bg-ink-2 p-4">
          <BusyLine night label="Continuing the trail. Stay on this page." />
        </div>
      )}
      {cont.data?.ok && (
        <div className="enter-fade-fast mt-6 border border-paper-2 bg-ink-2 p-4">
          <p className="font-medium">
            Continued investigation {cont.data.investigationId} · {cont.data.hops} hops ·{" "}
            {cont.data.artifacts} artifacts · {cont.data.frontier} frontier
            {cont.data.paused ? " · still open" : ""}
          </p>
          {cont.data.summary && (
            <p className="mt-2 whitespace-pre-wrap text-paper-2">{cont.data.summary}</p>
          )}
        </div>
      )}
      {(notice || (run.data && !run.data.ok)) && (
        <Notice kind="err" night>
          {notice}
        </Notice>
      )}
      {queuedLead != null && (
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(queuedLead) }}
            className="text-rust transition-[color] duration-150 ease-out hover:text-paper"
          >
            Open the lead
          </Link>
          <Link
            to="/desk/queue"
            className="text-paper-2 transition-[color] duration-150 ease-out hover:text-paper"
          >
            Working queue
          </Link>
        </p>
      )}

      {(investigations.isPending && !(investigations.data ?? []).length) ? (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Investigations</h2>
          <ListSkeleton rows={3} night />
        </section>
      ) : (investigations.data ?? []).length > 0 ? (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Investigations</h2>
          <ul className="mt-3 divide-y divide-ink-2 border border-ink-2">
            {(investigations.data ?? []).map((inv) => (
              <li key={inv.id} className="px-4 py-3">
                <button
                  type="button"
                  className="min-h-11 text-left"
                  onClick={() => setOpenId(inv.id)}
                >
                  <p className="font-medium">
                    #{inv.id} {inv.title}
                  </p>
                  <p className="text-sm text-paper-2">
                    {inv.status} · {inv.hops} hops · {formatShortDate(inv.updated_at)}
                  </p>
                  {inv.pause_reason ? (
                    <p className="mt-1 text-sm text-paper-2">{inv.pause_reason}</p>
                  ) : null}
                </button>
                {inv.status === "paused" || inv.status === "open" || inv.status === "investigating" ? (
                  <div className="mt-2">
                    <InkButton
                      tone="invert"
                      disabled={cont.isPending}
                      onClick={() => {
                        setOpenId(inv.id);
                        cont.mutate(inv.id);
                      }}
                    >
                      {cont.isPending && openId === inv.id
                        ? "Continuing…"
                        : "Continue digging"}
                    </InkButton>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.data && (
        <section className="mt-10 space-y-8">
          <h2 className="font-display text-2xl">
            Investigation {detail.data.investigation.id}
          </h2>
          <p className="whitespace-pre-wrap text-paper-2">
            {detail.data.investigation.summary}
          </p>
          {detail.data.investigation.pause_reason ? (
            <p className="text-sm text-paper-2">{detail.data.investigation.pause_reason}</p>
          ) : null}
          <BlockList
            title="Frontier"
            items={detail.data.frontier.map(
              (f) =>
                `${f.status} ${f.priority} ${f.kind}: ${f.label} — ${f.why}${f.prior_status ? ` (was ${f.prior_status})` : ""}${f.closed_reason ? ` [${f.closed_reason}]` : ""}`,
            )}
          />
          <BlockList
            title="Artifacts"
            items={detail.data.artifacts.map(
              (a) =>
                `${a.fetch_outcome ?? a.fetch_status ?? "?"} v${a.version_id ?? "—"} ${a.title} ${a.url}`,
            )}
          />
          <BlockList
            title="Entities"
            items={detail.data.entities.map((e) => `${e.kind}: ${e.name} — ${e.why}`)}
          />
          <BlockList
            title="Historical matches"
            items={(detail.data.historicalEntities ?? []).map(
              (e) =>
                `inv ${e.investigation_id}${e.verdict ? ` ${e.verdict}` : ""}: ${e.kind}: ${e.name} — ${e.why}`,
            )}
          />
          <BlockList
            title="Relationships"
            items={detail.data.relationships.map(
              (r) =>
                `${r.from_name} —[${r.kind}]→ ${r.to_name} (${r.evidence})${r.version_id != null ? ` v${r.version_id}` : ""}${r.capture_event_id != null ? ` c${r.capture_event_id}` : ""}${r.provenance_status === "unresolved" ? " provenance unresolved" : ""}`,
            )}
          />
          <BlockList
            title="Claims"
            items={detail.data.claims.map(
              (c) =>
                `${c.kind}${c.confidence != null ? ` ${c.confidence}` : ""}${c.version_id != null ? ` v${c.version_id}` : ""}${c.capture_event_id != null ? ` c${c.capture_event_id}` : ""}${c.provenance_status === "unresolved" ? " provenance unresolved" : ""}: ${c.body}`,
            )}
          />
          <BlockList
            title="Hypotheses"
            items={(detail.data.hypotheses ?? []).map(
              (h) => `[${h.status}] ${h.body}`,
            )}
          />
          <BlockList
            title="Anomalies"
            items={detail.data.anomalies.map((a) => `${a.kind}: ${a.summary}`)}
          />
          <BlockList
            title="Dead ends"
            items={detail.data.deadEnds.map(
              (d) => `${d.hypothesis} — ${d.dismissed_because}`,
            )}
          />
          <BlockList
            title="Searches"
            items={detail.data.searches.map(
              (s) => `${s.state ?? "unknown"} hop ${s.hop}${s.provider ? ` ${s.provider}` : ""}: ${s.query}`,
            )}
          />
        </section>
      )}

      {(promises.data ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Promise ledger</h2>
          <ul className="mt-3 divide-y divide-ink-2 border border-ink-2">
            {(promises.data ?? []).map((p) => (
              <li key={p.id} className="px-4 py-3">
                <p className="font-medium">
                  {p.who_promised} — {p.what}
                </p>
                <p className="text-sm text-paper-2">
                  {p.status}
                  {p.when_due ? ` · due ${p.when_due}` : ""}
                  {p.source_cite ? ` · ${p.source_cite}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="font-display text-2xl">Signals</h2>
        {(signals.isPending && !(signals.data ?? []).length) ? (
          <ListSkeleton rows={2} night />
        ) : (signals.data ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState
              night
              kicker="Lane 3"
              title="No signals yet"
              body="Start an investigation. Dark desk searches broadly, preserves evidence, and never prints on its own."
            />
          </div>
        ) : null}
        <ul className="stagger-in mt-4 space-y-4">
          {(signals.data ?? []).map((s) => (
            <li key={s.id} className="border border-ink-2 bg-ink-2 p-4">
              <p className="text-[11px] tracking-[0.14em] text-rust uppercase">
                {s.posture} · {s.signal_type} · strength {s.strength} ·
                confidence {Number(s.confidence).toFixed(2)} · {s.handoff}
                {s.investigation_id != null ? ` · inv ${s.investigation_id}` : ""}
              </p>
              <h3 className="mt-1 font-display text-xl">{s.name}</h3>
              <Block label="Observation" text={s.observation} />
              <Block label="Pattern" text={s.pattern} />
              <Block label="Linkage" text={s.linkage_map} />
              <Block label="Alternatives" text={s.alternatives} />
              <Block label="Counter-narrative" text={s.counter_narrative} />
              <Block label="What would kill this" text={s.what_would_kill} />
              <Block label="Pathway" text={s.pathway} />
              <Block label="Privacy" text={s.privacy_review} />
              <div className="mt-3 flex flex-wrap gap-2">
                {(s.handoff === "FOR VERIFICATION" ||
                  s.handoff === "FINDING" ||
                  s.handoff === "CONTINUE") && (
                  <InkButton
                    tone="invert"
                    disabled={toQueue.isPending}
                    onClick={() => toQueue.mutate(s.id)}
                  >
                    Send to working queue
                  </InkButton>
                )}
                <span className="self-center text-sm text-paper-2">
                  {formatShortDate(s.created_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {(runs.data ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl">Previous runs</h2>
          <ul className="mt-3 divide-y divide-ink-2 border border-ink-2">
            {(runs.data ?? []).map((r) => (
              <li key={r.id} className="px-4 py-3">
                <p className="text-sm text-paper-2">{formatDate(r.started_at)}</p>
                {r.error && <p className="text-danger">{r.error}</p>}
                {r.summary && (
                  <p className="mt-1 whitespace-pre-wrap text-paper-2">{r.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toQueue.isSuccess && (
        <p className="mt-4 text-sm text-paper-2">
          In the working queue with provenance.{" "}
          <Link to="/desk/queue" className="text-rust">
            Open the queue
          </Link>
        </p>
      )}
    </DeskShell>
  );
}

function Block({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] tracking-[0.14em] text-paper-2 uppercase">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-paper-2">{text}</p>
    </div>
  );
}

function BlockList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="font-display text-xl">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-paper-2">
        {items.map((t, i) => (
          <li key={i} className="break-all">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
