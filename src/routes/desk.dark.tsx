import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DeskShell, InkButton, areaClass } from "@/components/desk-chrome";
import { BusyLine, ListSkeleton, Notice } from "@/components/states";
import {
  continueInvestigation,
  findSomethingToDigInto,
  getInvestigation,
  listDarkRuns,
  listInvestigations,
  listWorthALook,
  openDarkInvestigation,
  parkInvestigation,
  queueInvestigation,
  reopenParkedInvestigation,
  type InvestigationRow,
} from "@/lib/news/dark";
import {
  editorError,
  editorKindLabel,
  editorPauseReason,
  editorStatus,
  headlineFromUrl,
  looksLikeInternalSummary,
  organizationFromUrl,
  pileForStatus,
  plainEditorText,
  plainFinding,
  progressLine,
  sourceLineFromUrl,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";
import { formatDateTime, formatShortDate } from "@/lib/paper";
import type { WorthSeed } from "@/lib/news/worth-a-look";

export const Route = createFileRoute("/desk/dark")({
  component: DarkPage,
});

const OPEN_KEY = "townreporter.dark.openId";
const CLAIM_KEY = "townreporter.dark.claimed";

function readClaimed(): string[] {
  try {
    const raw = sessionStorage.getItem(CLAIM_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeClaimed(ids: string[]) {
  try {
    sessionStorage.setItem(CLAIM_KEY, JSON.stringify(ids.slice(-40)));
  } catch {
    /* ignore */
  }
}

function DarkPage() {
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [queuedLead, setQueuedLead] = useState<number | null>(null);
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [cardPhase, setCardPhase] = useState<string>("");
  const [claimedIds, setClaimedIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) setOpenId(Number(raw));
    } catch {
      /* ignore */
    }
    setClaimedIds(readClaimed());
  }, []);

  function claimCard(id: string) {
    setClaimedIds((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      writeClaimed(next);
      return next;
    });
  }

  function rememberOpen(id: number | null) {
    setOpenId(id);
    try {
      if (id != null) sessionStorage.setItem(OPEN_KEY, String(id));
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      /* ignore */
    }
  }

  const worth = useQuery({ queryKey: ["worth-a-look"], queryFn: () => listWorthALook() });
  const investigations = useQuery({
    queryKey: ["investigations"],
    queryFn: () => listInvestigations(),
  });
  const runs = useQuery({ queryKey: ["dark-runs"], queryFn: () => listDarkRuns() });
  const detail = useQuery({
    queryKey: ["investigation", openId],
    queryFn: () => getInvestigation({ data: openId! }),
    enabled: openId != null,
    refetchInterval: (q) => {
      const st = q.state.data?.investigation.status;
      if (st === "investigating") return 2000;
      return false;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
    if (openId != null) void qc.invalidateQueries({ queryKey: ["investigation", openId] });
  };

  const advance = useMutation({
    mutationFn: (id: number) => continueInvestigation({ data: id }),
    onSuccess: (res) => {
      if (!res || res.ok !== true) {
        const raw = res && "error" in res ? String(res.error ?? "") : "Research failed";
        const msg = editorError(raw) || raw || "Research failed";
        setNotice(msg);
        setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
        setCardPhase("");
        invalidate();
        return;
      }
      if (res.error) setNotice(editorError(res.error));
      else setNotice(null);
      setCardPhase("");
      setPendingCard(null);
      invalidate();
    },
    onError: (err) => {
      const msg = editorError(err instanceof Error ? err.message : "Research failed") || "Research failed";
      setNotice(msg);
      setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
      setCardPhase("");
      invalidate();
    },
  });

  function afterOpen(id: number, cardId?: string) {
    rememberOpen(id);
    setNotice(null);
    setCardPhase("Searching records…");
    invalidate();
    requestAnimationFrame(() => {
      document.getElementById("investigation-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    advance.mutate(id);
    if (cardId) setPendingCard(cardId);
  }

  const openFromCard = useMutation({
    mutationFn: (item: WorthSeed) =>
      openDarkInvestigation({ data: { paste: item.seed, title: item.title } }),
    onMutate: (item) => {
      setPendingCard(item.id);
      setCardError(null);
      setCardPhase("Starting…");
      claimCard(item.id);
    },
    onSuccess: (res, item) => {
      if (!res?.ok || !res.investigationId) {
        setCardError({ id: item.id, message: "Could not open an investigation." });
        setCardPhase("");
        return;
      }
      setCardPhase("Investigation started. Searching records…");
      afterOpen(res.investigationId, item.id);
    },
    onError: (err, item) => {
      const msg = editorError(err instanceof Error ? err.message : "Could not start") || "Could not start";
      setCardError({ id: item.id, message: msg });
      setCardPhase("");
    },
  });

  const openPaste = useMutation({
    mutationFn: () => openDarkInvestigation({ data: { paste, title: paste.split("\n")[0] } }),
    onMutate: () => {
      setPendingCard("paste");
      setCardError(null);
      setCardPhase("Starting investigation…");
    },
    onSuccess: (res) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Could not open an investigation.");
        setCardPhase("");
        return;
      }
      setCardPhase("Investigation started. Searching records…");
      afterOpen(res.investigationId, "paste");
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Could not start"));
      setCardPhase("");
    },
  });

  const find = useMutation({
    mutationFn: () => findSomethingToDigInto(),
    onMutate: () => {
      setPendingCard("find");
      setCardPhase("Starting investigation…");
    },
    onSuccess: (res) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Nothing to open yet. Paste a lead to start.");
        setCardPhase("");
        return;
      }
      setCardPhase("Investigation started. Searching records…");
      afterOpen(res.investigationId, "find");
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Find failed"));
      setCardPhase("");
    },
  });

  const toQueue = useMutation({
    mutationFn: (id: number) => queueInvestigation({ data: id }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (res?.ok) {
        setQueuedLead(res.leadId);
        setNotice("On the working queue as a story lead. Dark Desk did not publish.");
      } else setNotice(res?.error ?? "Could not send to the queue.");
    },
  });

  const followLead = useMutation({
    mutationFn: (seed: { paste: string; title: string }) => openDarkInvestigation({ data: seed }),
    onMutate: () => {
      setPendingCard("follow");
      setCardPhase("Starting investigation…");
    },
    onSuccess: (res, seed) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Could not follow that lead.");
        setCardPhase("");
        return;
      }
      setCardPhase("Investigation started. Searching records…");
      afterOpen(res.investigationId, seed.title);
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Could not follow that lead"));
      setCardPhase("");
    },
  });

  const park = useMutation({
    mutationFn: (id: number) => parkInvestigation({ data: id }),
    onSuccess: () => {
      rememberOpen(null);
      setNotice("Set aside. Pull it back from that pile anytime.");
      invalidate();
    },
  });

  const pullBack = useMutation({
    mutationFn: (id: number) => reopenParkedInvestigation({ data: id }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        rememberOpen(res.investigationId);
        setNotice(null);
      }
      invalidate();
    },
  });

  const starting = openFromCard.isPending || openPaste.isPending || find.isPending || followLead.isPending;
  const digging = advance.isPending;
  const busyStart = starting;
  const inv = detail.data?.investigation;
  const liveLine = progressLine({
    running: digging || inv?.status === "investigating",
    status: inv?.status ?? (digging ? "investigating" : "open"),
    hops: inv?.hops ?? 0,
    budget: inv?.budget ?? 5,
    artifacts: detail.data?.artifacts.length ?? 0,
    searches: detail.data?.searches.length ?? 0,
    claims: detail.data?.claims.length ?? 0,
  });
  const allInv = investigations.data ?? [];
  const active = allInv.filter((row) => pileForStatus(row.status) === "desk");
  const parked = allInv.filter((row) => pileForStatus(row.status) === "aside");
  const inbox = (worth.data ?? []).filter(
    (item) => !worthItemOnDesk(item, allInv, claimedIds) && pendingCard !== item.id,
  );

  return (
    <DeskShell night title="Dark desk" kicker="Investigative desk">
      <p className="max-w-2xl text-paper-2">
        Three piles. <span className="text-paper">To look at</span> is new
        material nobody has opened yet. <span className="text-paper">On the desk</span> is
        what you started — including files that stopped because there is more to
        read. <span className="text-paper">Set aside</span> is finished or parked;
        you can pull any of it back. Dark Desk investigates. It does not print.
      </p>

      {openId != null && (
        <InvestigationWorkspace
          openId={openId}
          detail={detail.data ?? undefined}
          pending={detail.isPending && !detail.data}
          digging={digging || inv?.status === "investigating"}
          keepDisabled={digging}
          phase={cardPhase || liveLine}
          notice={notice}
          queuedLead={queuedLead}
          onKeepDigging={() => {
            setCardPhase("Searching records…");
            advance.mutate(openId);
          }}
          onQueue={() => toQueue.mutate(openId)}
          onClose={() => rememberOpen(null)}
          onPark={() => park.mutate(openId)}
          onFollow={(seed) => followLead.mutate(seed)}
        />
      )}

      <section className="mt-10 grid items-start gap-6 lg:grid-cols-3">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl">To look at</h2>
              <p className="mt-1 text-sm text-paper-2">Not opened yet.</p>
            </div>
            <p className="text-sm tabular-nums text-paper-2">{inbox.length}</p>
          </div>
          {worth.isPending && !inbox.length ? (
            <ListSkeleton rows={3} night />
          ) : inbox.length === 0 ? (
            <p className="mt-3 text-sm text-paper-2">
              Nothing new tonight, or everything interesting is already on the desk.
            </p>
          ) : (
            <ul className="stagger-in mt-4 space-y-3">
              {inbox.map((item) => (
                <WorthCard
                  key={item.id}
                  item={item}
                  busy={busyStart || digging}
                  active={false}
                  phase=""
                  error={cardError?.id === item.id ? cardError.message : null}
                  onStart={() => openFromCard.mutate(item)}
                  canOpen={false}
                  openId={null}
                />
              ))}
            </ul>
          )}
          <div className="mt-4">
            <InkButton tone="invert" disabled={busyStart || digging} onClick={() => find.mutate()}>
              {find.isPending ? "Starting…" : "Pick one for me"}
            </InkButton>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl">On the desk</h2>
              <p className="mt-1 text-sm text-paper-2">Started. Still in play.</p>
            </div>
            <p className="text-sm tabular-nums text-paper-2">{active.length}</p>
          </div>
          {investigations.isPending && !active.length ? (
            <ListSkeleton rows={3} night />
          ) : active.length === 0 ? (
            <p className="mt-3 text-sm text-paper-2">
              Empty. Start digging on a card and it moves here.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {active.map((row) => (
                <DeskFileCard
                  key={row.id}
                  row={row}
                  selected={row.id === openId}
                  digging={digging && openId === row.id}
                  onOpen={() => rememberOpen(row.id)}
                  onKeep={() => {
                    rememberOpen(row.id);
                    setCardPhase("Searching records…");
                    advance.mutate(row.id);
                  }}
                  onPark={() => park.mutate(row.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl">Set aside</h2>
              <p className="mt-1 text-sm text-paper-2">Finished or parked. Pull back anytime.</p>
            </div>
            <p className="text-sm tabular-nums text-paper-2">{parked.length}</p>
          </div>
          {parked.length === 0 ? (
            <p className="mt-3 text-sm text-paper-2">Nothing set aside yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {parked.map((row) => (
                <li key={row.id} className="border border-ink-2 px-4 py-3">
                  <p className="text-[11px] tracking-[0.14em] text-rust uppercase">
                    {editorStatus(row.status)}
                  </p>
                  <p className="mt-1 font-medium">{row.title || `File ${row.id}`}</p>
                  <p className="mt-1 text-sm text-paper-2">
                    {Number(row.records ?? 0)} records · last touched {formatShortDate(row.updated_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <InkButton
                      tone="invert"
                      disabled={pullBack.isPending}
                      onClick={() => pullBack.mutate(row.id)}
                    >
                      Pull back
                    </InkButton>
                    <InkButton tone="invert" onClick={() => rememberOpen(row.id)}>
                      Read
                    </InkButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-10 border border-ink-2 p-4">
        <h2 className="font-display text-2xl">Start from a tip</h2>
        <p className="mt-1 text-sm text-paper-2">
          Paste a URL, person, organization, contract number, RFP, parcel, or a
          question. That opens a new file on the desk.
        </p>
        <label className="mt-3 block space-y-1.5">
          <span className="sr-only">Tip</span>
          <textarea
            className={areaClass + " min-h-28"}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Transcript, staff report, an LLC, an RFP number…"
          />
        </label>
        <div className="mt-3">
          <InkButton
            tone="invert"
            disabled={busyStart || digging || !paste.trim()}
            onClick={() => openPaste.mutate()}
          >
            {openPaste.isPending ? "Starting…" : "Start digging"}
          </InkButton>
        </div>
        {pendingCard === "paste" && cardPhase ? (
          <p className="mt-2 text-sm text-paper-2" aria-live="polite">
            {cardPhase}
          </p>
        ) : null}
      </section>

      {(runs.data ?? []).length > 0 && (
        <details className="mt-10">
          <summary className="min-h-11 cursor-pointer font-display text-xl">
            What Dark Desk did
          </summary>
          <ul className="mt-3 divide-y divide-ink-2 border border-ink-2">
            {(runs.data ?? []).map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <p className="text-paper-2">{formatDateTime(r.started_at)}</p>
                {r.error ? (
                  <p className="mt-1 text-blush">{editorError(r.error)}</p>
                ) : null}
                {r.summary ? (
                  <p className="mt-1 whitespace-pre-wrap text-paper-2">
                    {plainEditorText(r.summary)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </DeskShell>
  );
}

function DeskFileCard({
  row,
  selected,
  digging,
  onOpen,
  onKeep,
  onPark,
}: {
  row: InvestigationRow;
  selected: boolean;
  digging: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onPark: () => void;
}) {
  const records = Number(row.records ?? 0);
  const still = Number(row.still_open ?? 0);
  const internal = !row.summary || looksLikeInternalSummary(row.summary);
  return (
    <li className={"border px-4 py-3 " + (selected ? "border-paper-2 bg-ink" : "border-ink-2")}>
      <p className="text-[11px] tracking-[0.14em] text-rust uppercase">
        {editorStatus(row.status)}
      </p>
      <p className="mt-1 font-medium">{row.title || `File ${row.id}`}</p>
      <p className="mt-1 text-sm text-paper-2">
        {records} records on file
        {still > 0 ? ` · ${still} still to open` : ""}
      </p>
      <p className="mt-1 text-sm text-paper-2">Last touched {formatShortDate(row.updated_at)}</p>
      {!internal ? (
        <p className="mt-1 line-clamp-2 text-sm text-paper-2">{plainEditorText(row.summary)}</p>
      ) : row.status === "paused" && still > 0 ? (
        <p className="mt-1 text-sm text-paper-2">
          Stopped after a round. {still} things have not been opened yet.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <InkButton tone="invert" onClick={onOpen}>
          {selected ? "Viewing" : "Open file"}
        </InkButton>
        <InkButton tone="invert" disabled={digging} onClick={onKeep}>
          {digging ? "Looking…" : "Keep digging"}
        </InkButton>
        <InkButton tone="invert" onClick={onPark}>
          Set aside
        </InkButton>
      </div>
    </li>
  );
}

function WorthCard({
  item,
  busy,
  active,
  phase,
  error,
  onStart,
  canOpen,
  openId,
}: {
  item: WorthSeed;
  busy: boolean;
  active: boolean;
  phase: string;
  error: string | null;
  onStart: () => void;
  canOpen: boolean;
  openId: number | null;
}) {
  return (
    <li className="border border-ink-2 bg-ink-2 p-4">
      <p className="text-[11px] tracking-[0.14em] text-rust uppercase">
        {item.badge || editorKindLabel(item.kind)}
      </p>
      <h3 className="mt-1 font-display text-xl">{item.title}</h3>
      <p className="mt-3 text-sm uppercase tracking-[0.14em] text-paper-2">Why it’s worth a look</p>
      <p className="mt-1 text-paper-2">{item.why}</p>
      <p className="mt-3 text-sm uppercase tracking-[0.14em] text-paper-2">What changed</p>
      <p className="mt-1 text-paper-2">{item.happened}</p>
      <p className="mt-3 text-sm italic text-paper-2">First question: {item.question}</p>
      {item.source_line ? (
        <p className="mt-2 text-sm text-paper-2">Source: {item.source_line}</p>
      ) : null}
      {item.source_url ? (
        <details className="mt-2 text-sm text-paper-2">
          <summary className="min-h-11 cursor-pointer">Technical details</summary>
          <p className="break-all">{item.source_url}</p>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <InkButton tone="invert" disabled={busy} onClick={onStart}>
          {active && phase.startsWith("Starting")
            ? "Starting…"
            : active && phase
              ? "Digging…"
              : "Start digging"}
        </InkButton>
        {canOpen && openId != null ? (
          <a href="#investigation-workspace" className="inline-flex min-h-11 items-center text-sm text-blush">
            View results
          </a>
        ) : null}
      </div>
      {active && phase ? (
        <p className="mt-2 text-sm text-paper-2" aria-live="polite">
          {phase}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-blush" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function InvestigationWorkspace({
  openId,
  detail,
  pending,
  digging,
  keepDisabled,
  phase,
  notice,
  queuedLead,
  onKeepDigging,
  onQueue,
  onClose,
  onPark,
  onFollow,
}: {
  openId: number;
  detail: Awaited<ReturnType<typeof getInvestigation>> | undefined;
  pending: boolean;
  digging: boolean;
  keepDisabled: boolean;
  phase: string;
  notice: string | null;
  queuedLead: number | null;
  onKeepDigging: () => void;
  onQueue: () => void;
  onClose: () => void;
  onPark: () => void;
  onFollow: (seed: { paste: string; title: string }) => void;
}) {
  const inv = detail?.investigation;
  const artifacts = detail?.artifacts ?? [];
  const claims = detail?.claims ?? [];
  const hyps = detail?.hypotheses ?? [];
  const searches = detail?.searches ?? [];
  const frontier = detail?.frontier ?? [];
  const deadEnds = detail?.deadEnds ?? [];
  const anomalies = detail?.anomalies ?? [];
  const entities = detail?.entities ?? [];
  const signals = detail?.signals ?? [];
  const progress = progressLine({
    running: digging,
    status: inv?.status ?? "investigating",
    hops: inv?.hops ?? 0,
    budget: inv?.budget ?? 5,
    artifacts: artifacts.length,
    searches: searches.length,
    claims: claims.length,
  });
  const facts = claims.filter((c) => /FACT|OBSERVATION/i.test(c.kind));
  const questions = openQuestionsFrom(detail);
  const found = [
    ...signals.map((s) => plainEditorText(`${s.name}: ${s.observation}`)),
    ...anomalies.map((a) => plainFinding(a.summary, a.url)),
    ...entities.map((e) => plainEditorText(`${e.name} — ${e.why}`)),
    ...claims.filter((c) => /FINDING|PATTERN/i.test(c.kind)).map((c) => plainEditorText(c.body)),
  ].filter(Boolean);
  const next = frontier.filter((f) =>
    ["open", "investigating", "reopened"].includes(f.status),
  );
  const seedSummary = !inv?.summary || looksLikeInternalSummary(inv.summary);
  const started = inv?.title
    ? `You opened this from Dark Desk because “${inv.title}” looked worth a closer look.`
    : "Opened from Dark Desk. It is reading the records now.";
  const whyMatters = !seedSummary && inv?.summary ? plainEditorText(inv.summary) : "";
  const pauseText = editorPauseReason(inv?.pause_reason);
  const leftover = next.length;
  const subtitle = !inv
    ? "Opening…"
    : inv.status === "paused"
      ? leftover > 0
        ? `${editorStatus(inv.status)} · ${leftover} still to open`
        : editorStatus(inv.status)
      : `${editorStatus(inv.status)} · ${progress}`;

  return (
    <section
      id="investigation-workspace"
      className="enter-rise mt-10 scroll-mt-6 border border-paper-2 bg-ink-2 p-5"
    >
      <p className="text-[11px] tracking-[0.16em] text-rust uppercase">Open file</p>
      <h2 className="mt-2 font-display text-3xl">
        {inv?.title || `File ${openId}`}
      </h2>
      <p className="mt-2 text-sm text-paper-2">{subtitle}</p>
      <p className="mt-1 text-sm text-paper-2">
        {artifacts.length} records on file
        {leftover > 0 ? ` · ${leftover} still to open` : ""}
        {inv?.updated_at ? ` · last touched ${formatShortDate(inv.updated_at)}` : ""}
      </p>
      {digging ? (
        <div className="mt-4">
          <BusyLine night label={phase || progress} />
        </div>
      ) : null}
      {notice ? (
        <div className="mt-4">
          <Notice kind="err" night>
            {notice}
          </Notice>
        </div>
      ) : null}
      {pending ? (
        <p className="mt-4 text-sm text-paper-2">Preparing the lead…</p>
      ) : null}

      <Block title="What started this" text={started} />
      {pauseText ? <Block title="Why it stopped" text={pauseText} /> : null}
      {inv?.status === "paused" && !digging ? (
        <div className="mt-4">
          <InkButton tone="invert" disabled={keepDisabled} onClick={onKeepDigging}>
            Keep digging
          </InkButton>
        </div>
      ) : null}
      <BlockList
        title="What we know"
        items={facts.map((c) => c.body)}
        empty={digging ? "Still reading." : "Nothing confirmed yet."}
      />
      <BlockList
        title="What Dark Desk found"
        items={found}
        empty={digging ? "Searching…" : "Nothing distinctive yet. That does not close the file."}
      />
      {whyMatters ? <Block title="Why it matters" text={whyMatters} /> : null}
      <BlockList
        title="What we’re testing"
        items={hyps.map((h) => h.body)}
      />
      <BlockList title="Open questions" items={questions} />

      {next.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-xl">Still to look at</h3>
          <p className="mt-1 text-sm text-paper-2">
            Names, pages, and documents mentioned in what Dark Desk already opened. It has not read these yet.
          </p>
          <ul className="mt-2 space-y-2">
            {next.slice(0, 8).map((f) => (
              <li key={f.id} className="border border-ink px-3 py-2">
                <p className="text-sm text-paper-2">
                  {humanLabel(f.label)}
                  {f.why ? ` — ${plainEditorText(f.why)}` : ""}
                </p>
                <div className="mt-2">
                  <InkButton
                    tone="invert"
                    disabled={keepDisabled}
                    onClick={() =>
                      onFollow({
                        paste: `${f.label}\n${f.why}`,
                        title: humanLabel(f.label),
                      })
                    }
                  >
                    Follow this lead
                  </InkButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-xl">Evidence</h3>
          <ul className="mt-3 space-y-3">
            {artifacts.slice(0, 16).map((a) => (
              <li key={a.id} className="border border-ink p-3">
                <p className="font-medium">
                  {a.title && !/^https?:/i.test(a.title) ? a.title : headlineFromUrl(a.url) || a.title}
                </p>
                <p className="text-sm text-paper-2">
                  {organizationFromUrl(a.url)}
                  {a.created_at ? ` · captured ${formatShortDate(a.created_at)}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {a.url.startsWith("http") ? (
                    <a href={a.url} className="text-blush hover:text-paper" target="_blank" rel="noreferrer">
                      Open source
                    </a>
                  ) : null}
                  {a.version_id != null ? (
                    <Link
                      to="/evidence/$versionId"
                      params={{ versionId: String(a.version_id) }}
                      className="text-blush hover:text-paper"
                    >
                      View evidence
                    </Link>
                  ) : null}
                  {a.url.startsWith("http") ? (
                    <Link
                      to="/evidence/compare"
                      search={{ url: a.url }}
                      className="text-blush hover:text-paper"
                    >
                      Compare versions
                    </Link>
                  ) : null}
                </p>
                <details className="mt-2 text-sm text-paper-2">
                  <summary className="cursor-pointer">Technical details</summary>
                  <p className="break-all">{a.url}</p>
                  {a.version_id != null ? <p>Content version {a.version_id}</p> : null}
                  {a.fetch_outcome ? <p>{a.fetch_outcome}</p> : null}
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="mt-6">
        <summary className="min-h-11 cursor-pointer font-display text-xl">Research trail</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-paper-2">
          {searches.length ? (
            searches.map((s, i) => (
              <li key={`${s.hop}-${i}`}>
                {s.query}
                <span className="text-paper-2"> · round {s.hop}</span>
              </li>
            ))
          ) : (
            <li>No searches logged yet.</li>
          )}
        </ul>
      </details>
      <BlockList
        title="Dead ends"
        items={deadEnds.map((d) => `${d.hypothesis} — ${plainEditorText(d.dismissed_because)}`)}
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <InkButton tone="invert" disabled={keepDisabled} onClick={onKeepDigging}>
          {digging ? "Looking…" : "Keep digging"}
        </InkButton>
        <InkButton tone="invert" onClick={onQueue}>
          Send to reporting queue
        </InkButton>
        {artifacts[0]?.url?.startsWith("http") ? (
          <a
            href={artifacts[0].url}
            className="inline-flex min-h-11 items-center px-4 text-sm text-paper hover:text-blush"
            target="_blank"
            rel="noreferrer"
          >
            Open source
          </a>
        ) : null}
        <InkButton tone="invert" onClick={onClose}>
          Close file
        </InkButton>
        <InkButton tone="invert" onClick={onPark}>
          Set aside
        </InkButton>
      </div>
      {queuedLead != null ? (
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(queuedLead) }}
            className="text-blush hover:text-paper"
          >
            Open the story lead
          </Link>
          <Link to="/desk/queue" className="text-paper-2 hover:text-paper">
            Working queue
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="mt-6">
      <h3 className="font-display text-xl">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-paper-2">{text}</p>
    </div>
  );
}

function BlockList({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty?: string;
}) {
  if (!items.length && !empty) return null;
  return (
    <div className="mt-6">
      <h3 className="font-display text-xl">{title}</h3>
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-paper-2">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-paper-2">{empty}</p>
      )}
    </div>
  );
}

function humanLabel(label: string): string {
  if (/^https?:/i.test(label)) return headlineFromUrl(label) || sourceLineFromUrl(label);
  return label;
}

function openQuestionsFrom(
  detail: Awaited<ReturnType<typeof getInvestigation>> | undefined,
): string[] {
  if (!detail) return [];
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
