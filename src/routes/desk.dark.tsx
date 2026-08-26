import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton, areaClass } from "@/components/desk-chrome";
import { BusyLine, EmptyState, ListSkeleton, Notice } from "@/components/states";
import {
  continueInvestigation,
  findSomethingToDigInto,
  getInvestigation,
  listDarkPromises,
  listDarkRuns,
  listDarkSignals,
  listInvestigations,
  listWorthALook,
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
  const worth = useQuery({ queryKey: ["worth-a-look"], queryFn: () => listWorthALook() });
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
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    if (openId != null) void qc.invalidateQueries({ queryKey: ["investigation", openId] });
  };

  function onRunOk(res: {
    ok: boolean;
    investigationId?: number;
    error?: string;
  }) {
    if (!res.ok) {
      setNotice("error" in res ? String(res.error) : "Dark desk failed");
      return;
    }
    setNotice(null);
    if (res.investigationId) setOpenId(res.investigationId);
    invalidate();
  }

  const run = useMutation({
    mutationFn: (seed?: string) => runDarkDesk({ data: { paste: seed ?? paste } }),
    onSuccess: onRunOk,
    onError: (err) => setNotice(err instanceof Error ? err.message : "Dark desk failed"),
  });

  const find = useMutation({
    mutationFn: () => findSomethingToDigInto(),
    onSuccess: onRunOk,
    onError: (err) => setNotice(err instanceof Error ? err.message : "Find failed"),
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
    onError: (err) => setNotice(err instanceof Error ? err.message : "Continue failed"),
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

  const digging = run.isPending || find.isPending || cont.isPending;
  const active = (investigations.data ?? []).filter(
    (inv) => inv.status === "paused" || inv.status === "open" || inv.status === "investigating",
  );

  return (
    <DeskShell night title="Dark desk" kicker="Lane 3 — investigative engine">
      <p className="max-w-2xl text-paper-2">
        What deserves a closer look today? Dark Desk already sees changes,
        disappearances, late reports, scanner leads and unfinished trails. Paste
        is one way to begin — not the only way. It does not print.
      </p>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl">Worth a look</h2>
          <InkButton tone="invert" disabled={digging} onClick={() => find.mutate()}>
            {find.isPending ? "Looking…" : "Find something to dig into"}
          </InkButton>
        </div>
        {worth.isPending && !(worth.data ?? []).length ? (
          <ListSkeleton rows={3} night />
        ) : (worth.data ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-paper-2">
            No alerts queued. Find something still searches the latest snapshots
            and beat memory.
          </p>
        ) : (
          <ul className="stagger-in mt-4 space-y-3">
            {(worth.data ?? []).map((item) => (
              <li key={item.id} className="border border-ink-2 bg-ink-2 p-4">
                <p className="text-[11px] tracking-[0.14em] text-rust uppercase">
                  {item.kind}
                </p>
                <h3 className="mt-1 font-display text-xl">{item.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-paper-2">{item.happened}</p>
                <p className="mt-2 text-sm text-paper-2">{item.why}</p>
                {item.source_url ? (
                  <p className="mt-1 break-all text-sm text-paper-2">{item.source_url}</p>
                ) : null}
                <p className="mt-2 text-sm italic text-paper-2">First question: {item.question}</p>
                <div className="mt-3">
                  <InkButton
                    tone="invert"
                    disabled={digging}
                    onClick={() => run.mutate(item.seed)}
                  >
                    Start digging
                  </InkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">Investigate a lead</h2>
          <p className="mt-1 text-sm text-paper-2">
            Paste a URL, minutes, name, company, contract number, question or
            tip.
          </p>
          <label className="mt-3 block space-y-1.5">
            <span className="sr-only">Seed</span>
            <textarea
              className={areaClass + " min-h-32"}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Transcript, staff report, an LLC, an RFP number…"
            />
          </label>
          <div className="mt-3">
            <InkButton tone="invert" disabled={digging} onClick={() => run.mutate(paste)}>
              {run.isPending ? "Digging…" : "Start digging"}
            </InkButton>
          </div>
        </div>
        <div>
          <h2 className="font-display text-2xl">Continue an investigation</h2>
          {investigations.isPending && !active.length ? (
            <ListSkeleton rows={3} night />
          ) : active.length === 0 ? (
            <p className="mt-3 text-sm text-paper-2">No open investigations yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-2 border border-ink-2">
              {active.map((inv) => (
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
                    {inv.summary ? (
                      <p className="mt-1 line-clamp-2 text-sm text-paper-2">{inv.summary}</p>
                    ) : null}
                    {inv.pause_reason ? (
                      <p className="mt-1 text-sm text-paper-2">{inv.pause_reason}</p>
                    ) : null}
                  </button>
                  <div className="mt-2">
                    <InkButton
                      tone="invert"
                      disabled={digging}
                      onClick={() => {
                        setOpenId(inv.id);
                        cont.mutate(inv.id);
                      }}
                    >
                      {cont.isPending && openId === inv.id ? "Continuing…" : "Keep digging"}
                    </InkButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {digging && (
        <div className="enter-fade-fast mt-6 border border-ink-2 bg-ink-2 p-4">
          <BusyLine
            night
            label="Recursive search — several hops. Stay on this page."
          />
        </div>
      )}
      {(run.data?.ok || find.data?.ok) && (
        <div className="enter-fade-fast mt-6 border border-paper-2 bg-ink-2 p-4">
          <p className="font-medium">
            Investigation {(run.data?.ok ? run.data : find.data)?.investigationId} ·{" "}
            {(run.data?.ok ? run.data : find.data)?.hops} hops ·{" "}
            {(run.data?.ok ? run.data : find.data)?.artifacts} artifacts ·{" "}
            {(run.data?.ok ? run.data : find.data)?.frontier} frontier
            {(run.data?.ok ? run.data : find.data)?.paused ? " · paused with work remaining" : ""}
          </p>
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
          {(detail.data.investigation.status === "paused" ||
            detail.data.investigation.status === "open" ||
            detail.data.investigation.status === "investigating") && (
            <InkButton
              tone="invert"
              disabled={digging}
              onClick={() => cont.mutate(detail.data!.investigation.id)}
            >
              Keep digging
            </InkButton>
          )}
          <BlockList
            title="What we know"
            items={detail.data.claims
              .filter((c) => c.kind === "FACT" || c.kind === "OBSERVATION")
              .map(
                (c) =>
                  `${c.kind}: ${c.body}${c.provenance_status === "unresolved" ? " — provenance unresolved" : ""}`,
              )}
          />
          <BlockList
            title="What we're testing"
            items={(detail.data.hypotheses ?? []).map(
              (h) => `[${h.status}] ${h.body}${h.supporting ? ` · pro: ${h.supporting}` : ""}${h.contradicting ? ` · con: ${h.contradicting}` : ""}`,
            )}
          />
          <BlockList
            title="What Dark Desk found"
            items={[
              ...detail.data.anomalies.map((a) => `${a.kind}: ${a.summary}`),
              ...detail.data.entities.map((e) => `${e.kind}: ${e.name} — ${e.why}`),
              ...detail.data.relationships.map(
                (r) => `${r.from_name} —[${r.kind}]→ ${r.to_name}${r.evidence ? ` (${r.evidence})` : ""}`,
              ),
              ...detail.data.artifacts.slice(0, 12).map(
                (a) => `${a.title} ${a.url} (${a.fetch_outcome ?? "captured"})`,
              ),
            ]}
          />
          <BlockList
            title="Research trail"
            items={detail.data.searches.map(
              (s) => `${s.state ?? "unknown"} hop ${s.hop}: ${s.query}`,
            )}
          />
          <BlockList
            title="Open questions"
            items={openQuestionsFrom(detail.data)}
          />
          <BlockList
            title="Leads to follow"
            items={detail.data.frontier
              .filter((f) => f.status === "open" || f.status === "investigating" || f.status === "reopened")
              .map(
                (f) =>
                  `${f.status} ${f.kind}: ${f.label} — ${f.why}${f.prior_status ? ` (was ${f.prior_status})` : ""}`,
              )}
          />
          <BlockList
            title="Dead ends"
            items={detail.data.deadEnds.map(
              (d) => `${d.hypothesis} — ${d.dismissed_because}`,
            )}
          />
          <BlockList
            title="Evidence"
            items={detail.data.artifacts.map(
              (a) =>
                `${a.fetch_outcome ?? a.fetch_status ?? "?"} v${a.version_id ?? "—"} ${a.title} ${a.url}`,
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
        {signals.isPending && !(signals.data ?? []).length ? (
          <ListSkeleton rows={2} night />
        ) : (signals.data ?? []).length === 0 ? (
          <div className="mt-3">
            <EmptyState
              night
              kicker="Lane 3"
              title="No signals yet"
              body="Find something to dig into, or paste a lead. Dark desk searches broadly, preserves evidence, and never prints on its own."
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

function openQuestionsFrom(detail: {
  claims: { kind: string; body: string }[];
  searches: { generated_json?: string | null }[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 8) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const c of detail.claims) {
    if (/QUESTION|UNKNOWN|GAP/i.test(c.kind)) push(c.body);
  }
  for (const s of detail.searches) {
    try {
      const g = JSON.parse(s.generated_json || "{}") as { questions?: unknown };
      if (Array.isArray(g.questions)) for (const q of g.questions) push(String(q));
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, 16);
}
