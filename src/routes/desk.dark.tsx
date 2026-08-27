import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton } from "@/components/states";
import {
  continueInvestigation,
  findSomethingToDigInto,
  getInvestigation,
  getArtifact,
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
  recordKindFromUrl,
  sourceLineFromUrl,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";
import { formatDateTime, formatShortDate } from "@/lib/paper";
import { readableCapture } from "@/lib/news/html-text";
import type { WorthSeed } from "@/lib/news/worth-a-look";

export const Route = createFileRoute("/desk/dark")({
  component: DarkPage,
});

const OPEN_KEY = "townreporter.dark.openId";

function DarkPage() {
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [queuedLead, setQueuedLead] = useState<number | null>(null);
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [cardPhase, setCardPhase] = useState<string>("");
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) setOpenId(Number(raw));
    } catch {
      /* ignore */
    }
    return () => {
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    };
  }, []);

  function claimCard(id: string) {
    setClaimedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
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

  function beginDigPhase() {
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    setCardPhase("Searching records…");
    phaseTimer.current = setTimeout(() => {
      setCardPhase("Opening pages. They land on the file as they are read…");
    }, 1200);
  }

  function clearPhase() {
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    setCardPhase("");
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
        setNoticeOk(false);
        setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
        clearPhase();
        invalidate();
        return;
      }
      if (res.error) {
        setNotice(editorError(res.error));
        setNoticeOk(false);
      } else {
        setNotice(null);
      }
      clearPhase();
      setPendingCard(null);
      invalidate();
    },
    onError: (err) => {
      const msg =
        editorError(err instanceof Error ? err.message : "Research failed") || "Research failed";
      setNotice(msg);
      setNoticeOk(false);
      setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
      clearPhase();
      invalidate();
    },
  });

  function afterOpen(id: number, cardId?: string) {
    rememberOpen(id);
    setNotice(null);
    beginDigPhase();
    invalidate();
    requestAnimationFrame(() => {
      document
        .getElementById("investigation-workspace")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    },
    onSuccess: (res, item) => {
      if (!res?.ok || !res.investigationId) {
        setCardError({ id: item.id, message: "Could not open an investigation." });
        setNotice("Could not open that file. Try Start digging again.");
        setNoticeOk(false);
        setPendingCard(null);
        clearPhase();
        return;
      }
      claimCard(item.id);
      afterOpen(res.investigationId, item.id);
    },
    onError: (err, item) => {
      const msg = editorError(err instanceof Error ? err.message : "Could not start") || "Could not start";
      setCardError({ id: item.id, message: msg });
      setNotice(msg);
      setNoticeOk(false);
      setPendingCard(null);
      clearPhase();
    },
  });

  const openPaste = useMutation({
    mutationFn: () => openDarkInvestigation({ data: { paste, title: paste.split("\n")[0] } }),
    onMutate: () => {
      setPendingCard("paste");
      setCardError(null);
      setCardPhase("Starting…");
    },
    onSuccess: (res) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Could not open an investigation.");
        setNoticeOk(false);
        clearPhase();
        return;
      }
      setPaste("");
      afterOpen(res.investigationId, "paste");
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Could not start"));
      setNoticeOk(false);
      clearPhase();
    },
  });

  const find = useMutation({
    mutationFn: () => findSomethingToDigInto(),
    onMutate: () => {
      setPendingCard("find");
      setCardPhase("Starting…");
    },
    onSuccess: (res) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Nothing to open yet. Paste a lead to start.");
        setNoticeOk(false);
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, "find");
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Find failed"));
      setNoticeOk(false);
      clearPhase();
    },
  });

  const toQueue = useMutation({
    mutationFn: (id: number) => queueInvestigation({ data: id }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (res?.ok) {
        setQueuedLead(res.leadId);
        setNotice("On the working queue as a story lead. Dark Desk did not publish.");
        setNoticeOk(true);
      } else {
        setNotice(res?.error ?? "Could not send to the queue.");
        setNoticeOk(false);
      }
    },
  });

  const followLead = useMutation({
    mutationFn: (seed: { paste: string; title: string }) => openDarkInvestigation({ data: seed }),
    onMutate: () => {
      setPendingCard("follow");
      setCardPhase("Starting…");
    },
    onSuccess: (res, seed) => {
      if (!res?.ok || !res.investigationId) {
        setNotice("Could not follow that lead.");
        setNoticeOk(false);
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, seed.title);
    },
    onError: (err) => {
      setNotice(editorError(err instanceof Error ? err.message : "Could not follow that lead"));
      setNoticeOk(false);
      clearPhase();
    },
  });

  const park = useMutation({
    mutationFn: (id: number) => parkInvestigation({ data: id }),
    onSuccess: () => {
      rememberOpen(null);
      setNotice("Set aside. Pull it back from that pile anytime.");
      setNoticeOk(true);
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
  const inbox = (worth.data ?? []).filter((item) => !worthItemOnDesk(item, allInv, claimedIds));

  return (
    <DeskShell
      night
      title="Dark Desk"
      kicker="Investigative desk"
      lede={
        <>
          Three piles. <b>To look at</b> is new. <b>On the desk</b> is started.{" "}
          <b>Set aside</b> is parked — nothing is deleted. It digs; it never prints.
        </>
      }
    >
      <form
        className="tipbox top"
        onSubmit={(e) => {
          e.preventDefault();
          if (!paste.trim() || busyStart || digging) return;
          openPaste.mutate();
        }}
      >
        <p className="side-label">Start a file</p>
        <p className="meta">
          Paste a URL, a subject, a person, an LLC, a contract number, a rumor, or a chunk of text.
          It opens a new file on the desk.
        </p>
        <textarea
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              if (paste.trim() && !busyStart && !digging) openPaste.mutate();
            }
          }}
          placeholder="https://…  ·  Costco rebate cap  ·  Front Range Civic Partners LLC"
          aria-label="Tip, URL, or subject to investigate"
        />
        <div className="row-acts static">
          <InkButton
            small
            type="submit"
            disabled={busyStart || digging || !paste.trim()}
          >
            {openPaste.isPending ? "Starting…" : "Start digging"}
          </InkButton>
        </div>
        {notice ? <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p> : null}
        {pendingCard && cardPhase ? (
          <p className="meta" aria-live="polite">
            {cardPhase}
          </p>
        ) : null}
      </form>

      {openId != null ? (
        <InvestigationWorkspace
          openId={openId}
          detail={detail.data ?? undefined}
          pending={detail.isPending && !detail.data}
          digging={digging || inv?.status === "investigating"}
          keepDisabled={digging}
          phase={cardPhase || liveLine}
          notice={notice}
          noticeOk={noticeOk}
          queuedLead={queuedLead}
          onKeepDigging={() => {
            setNotice(null);
            beginDigPhase();
            advance.mutate(openId);
          }}
          onQueue={() => toQueue.mutate(openId)}
          onClose={() => rememberOpen(null)}
          onPark={() => park.mutate(openId)}
          onFollow={(seed) => followLead.mutate(seed)}
        />
      ) : null}

      <div className="piles">
        <section>
          <SecHead
            title="To look at"
            count={inbox.length}
            sub="New material. Nobody has opened it yet."
          />
          {worth.isPending && !inbox.length ? (
            <ListSkeleton rows={3} night />
          ) : inbox.length === 0 ? (
            <p className="meta">Nothing new tonight — everything interesting is already on the desk.</p>
          ) : (
            inbox.map((item) => (
              <WorthCard
                key={item.id}
                item={item}
                busy={busyStart || digging}
                phase={pendingCard === item.id ? cardPhase : ""}
                error={cardError?.id === item.id ? cardError.message : null}
                onStart={() => openFromCard.mutate(item)}
              />
            ))
          )}
          <div className="np-acts">
            <InkButton tone="quiet" small disabled={busyStart || digging} onClick={() => find.mutate()}>
              {find.isPending ? "Starting…" : "Pick one for me"}
            </InkButton>
          </div>
        </section>

        <section>
          <SecHead
            title="On the desk"
            count={active.length}
            sub="Started. A stop mid-file is normal — it means more to read, not a failure."
          />
          {investigations.isPending && !active.length ? (
            <ListSkeleton rows={3} night />
          ) : active.length === 0 ? (
            <p className="meta">Empty. Paste a tip above, or start digging on a card.</p>
          ) : (
            active.map((row) => (
              <DeskFileCard
                key={row.id}
                row={row}
                selected={row.id === openId}
                digging={digging && openId === row.id}
                onOpen={() => rememberOpen(row.id)}
                onKeep={() => {
                  setNotice(null);
                  rememberOpen(row.id);
                  beginDigPhase();
                  advance.mutate(row.id);
                }}
                onPark={() => park.mutate(row.id)}
              />
            ))
          )}
        </section>

        <section>
          <SecHead
            title="Set aside"
            count={parked.length}
            sub="Parked or finished. Pull anything back."
          />
          {parked.length === 0 ? (
            <p className="meta">Nothing set aside yet.</p>
          ) : (
            parked.map((row) => (
              <div key={row.id} className="deskfile dim">
                <p className="worth-t">{row.title || `File ${row.id}`}</p>
                <p className="np-meta">
                  {Number(row.records ?? 0)} records · last touched {formatShortDate(row.updated_at)}
                </p>
                {!looksLikeInternalSummary(row.summary) && row.summary ? (
                  <p className="np-meta">{plainEditorText(row.summary)}</p>
                ) : null}
                <div className="np-acts">
                  <InkButton small disabled={pullBack.isPending} onClick={() => pullBack.mutate(row.id)}>
                    Pull back
                  </InkButton>
                  <InkButton tone="quiet" small onClick={() => rememberOpen(row.id)}>
                    Read
                  </InkButton>
                </div>
              </div>
            ))
          )}
          {(runs.data ?? []).length > 0 ? (
            <details className="of-trail runs">
              <summary>What Dark Desk did — {(runs.data ?? []).length} recent runs</summary>
              {(runs.data ?? []).map((r) => (
                <div key={r.id} className="run-row">
                  <p className="meta">{formatDateTime(r.started_at)}</p>
                  {r.error ? <p className="side-item">{editorError(r.error)}</p> : null}
                  {r.summary ? (
                    <p className="side-item">{plainEditorText(r.summary)}</p>
                  ) : null}
                </div>
              ))}
            </details>
          ) : null}
        </section>
      </div>
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
  return (
    <div className={"deskfile" + (selected ? " sel" : "")}>
      <p className="np-kind">{editorStatus(row.status)}</p>
      <p className="worth-t">{row.title || `File ${row.id}`}</p>
      <p className="np-meta">
        {records} records on file
        {still > 0 ? ` · ${still} still to open` : ""} · last touched {formatShortDate(row.updated_at)}
      </p>
      <div className="np-acts">
        <InkButton small onClick={onOpen}>
          {selected ? "Viewing above" : "Open file"}
        </InkButton>
        <InkButton small disabled={digging} onClick={onKeep}>
          {digging ? "Reading…" : "Keep digging"}
        </InkButton>
        <InkButton tone="quiet" small onClick={onPark}>
          Set aside
        </InkButton>
      </div>
    </div>
  );
}

function WorthCard({
  item,
  busy,
  phase,
  error,
  onStart,
}: {
  item: WorthSeed;
  busy: boolean;
  phase: string;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <div className="worth">
      <p className="np-kind">{item.badge || editorKindLabel(item.kind)}</p>
      <p className="worth-t">{item.title}</p>
      <p className="worth-line">
        <b>Why it matters</b> — {item.why}
      </p>
      <p className="worth-line">
        <b>What changed</b> — {item.happened}
      </p>
      <p className="worth-q">First question: {item.question}</p>
      {item.source_line ? <p className="meta">{item.source_line}</p> : null}
      <div className="np-acts">
        <InkButton small disabled={busy} onClick={onStart}>
          {phase.startsWith("Starting") ? "Starting…" : phase ? "Digging…" : "Start digging"}
        </InkButton>
      </div>
      {phase ? (
        <p className="meta" aria-live="polite">
          {phase}
        </p>
      ) : null}
      {error ? (
        <p className="note err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
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
  noticeOk,
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
  noticeOk: boolean;
  queuedLead: number | null;
  onKeepDigging: () => void;
  onQueue: () => void;
  onClose: () => void;
  onPark: () => void;
  onFollow: (seed: { paste: string; title: string }) => void;
}) {
  const [frN, setFrN] = useState(6);
  useEffect(() => {
    setFrN(6);
  }, [openId]);
  const inv = detail?.investigation;
  const allArtifacts = detail?.artifacts ?? [];
  const artifacts = allArtifacts.filter((a) => !a.url.startsWith("editor://"));
  const pasteArt = allArtifacts.find((a) => a.url.startsWith("editor://"));
  const claims = detail?.claims ?? [];
  const hyps = detail?.hypotheses ?? [];
  const searches = detail?.searches ?? [];
  const frontier = detail?.frontier ?? [];
  const deadEnds = detail?.deadEnds ?? [];
  const anomalies = detail?.anomalies ?? [];
  const entities = detail?.entities ?? [];
  const signals = detail?.signals ?? [];
  const facts = claims.filter((c) => /FACT|OBSERVATION/i.test(c.kind));
  const questions = openQuestionsFrom(detail);
  const noticed = [
    ...signals.map((s) => plainEditorText(`${s.name}: ${s.observation}`)),
    ...anomalies.map((a) => plainFinding(a.summary, a.url)),
    ...entities.map((e) => plainEditorText(`${e.name} — ${e.why}`)),
    ...claims.filter((c) => /FINDING|PATTERN/i.test(c.kind)).map((c) => plainEditorText(c.body)),
    ...hyps.map((h) => plainEditorText(h.body)),
    ...questions,
  ].filter(Boolean);
  const next = frontier.filter((f) =>
    ["open", "investigating", "reopened"].includes(f.status),
  );
  const leftover = next.length;
  const pauseText = editorPauseReason(inv?.pause_reason);
  const parentTitle = inv?.title || `File ${openId}`;
  const started = startedLine(parentTitle, pasteArt?.excerpt ?? "", inv?.summary ?? "");
  const statusBit = !inv
    ? "Opening…"
    : inv.status === "paused"
      ? leftover > 0
        ? "Stopped — more to read"
        : editorStatus(inv.status)
      : editorStatus(inv.status);
  const round = inv?.hops ?? 0;
  const budget = inv?.budget ?? 5;
  const statusLine = [
    statusBit,
    `${artifacts.length} records on file`,
    leftover > 0 ? `${leftover} still to open` : null,
    `round ${round} of ${budget}`,
    inv?.updated_at ? `last touched ${formatShortDate(inv.updated_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section id="investigation-workspace" className="openfile">
      <div className="of-head">
        <div>
          <p className="kick">Open file</p>
          <h2 className="of-title">{parentTitle}</h2>
          <p className="meta">{statusLine}</p>
        </div>
        <div className="row-acts static">
          <InkButton disabled={keepDisabled} onClick={onKeepDigging}>
            {digging ? "Reading…" : "Keep digging"}
          </InkButton>
          <InkButton tone="ghost" onClick={onQueue}>
            Send to the queue
          </InkButton>
          <InkButton tone="quiet" onClick={onPark}>
            Set aside
          </InkButton>
          <InkButton tone="quiet" onClick={onClose}>
            Close file
          </InkButton>
        </div>
      </div>
      {digging ? <Busy label={phase || "Searching records…"} /> : null}
      {notice && !digging ? <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p> : null}
      {queuedLead != null ? (
        <p className="note">
          On the working queue as a story lead. Dark Desk did not publish.{" "}
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(queuedLead) }}
            className="inline-link"
          >
            Open the story lead
          </Link>
          {" · "}
          <Link to="/desk/queue" className="inline-link">
            Open the queue
          </Link>
        </p>
      ) : null}
      {pending ? <p className="meta">Getting this ready…</p> : null}
      {started ? <p className="of-started">{started}</p> : null}
      {inv?.status === "paused" && pauseText && !digging ? (
        <p className="of-stop">
          <b>Why it stopped:</b> {pauseText}
        </p>
      ) : null}

      <div className="of-grid">
        <div>
          <SecHead
            title="What to read"
            count={artifacts.length}
            sub="Click a title. The captured page opens below — that is the file."
          />
          {artifacts.length > 0 ? (
            <OpenedRecords artifacts={artifacts} />
          ) : digging ? (
            <p className="meta">Opening pages now. They land on the file as they are read…</p>
          ) : (
            <p className="meta">Nothing captured yet. Keep digging starts the first round.</p>
          )}
        </div>
        <div>
          {next.length > 0 ? (
            <>
              <SecHead
                title="Still unopened"
                count={next.length}
                sub="Names, pages, and documents mentioned in the records. Not read yet."
              />
              <div className="of-frontier">
                {next.slice(0, frN).map((f) => (
                  <div key={f.id} className="fr-item">
                    <p className="fr-label">{humanLabel(f.label)}</p>
                    {f.why ? <p className="fr-why">{plainEditorText(f.why)}</p> : null}
                    <InkButton
                      tone="quiet"
                      small
                      disabled={keepDisabled}
                      onClick={() =>
                        onFollow({
                          paste: `Followed from the “${parentTitle}” file: ${plainEditorText(f.why) || humanLabel(f.label)}.\n\n${f.label}\n${f.why}`,
                          title: humanLabel(f.label),
                        })
                      }
                    >
                      Follow this lead
                    </InkButton>
                  </div>
                ))}
              </div>
              {next.length > frN ? (
                <InkButton tone="quiet" small onClick={() => setFrN((n) => n + 10)}>
                  Next 10 — {next.length - frN} more
                </InkButton>
              ) : null}
              {Number(inv?.still_open ?? leftover) > next.length ? (
                <p className="meta">
                  {Number(inv?.still_open ?? leftover) - next.length} more were mentioned but not yet
                  named. They surface as rounds read them.
                </p>
              ) : null}
            </>
          ) : null}
          {noticed.length > 0 ? (
            <div className="of-block">
              <p className="side-label">What Dark Desk noticed</p>
              {noticed.map((n, i) => (
                <p key={i} className="side-item">
                  {n}
                </p>
              ))}
            </div>
          ) : null}
          {facts.length > 0 ? (
            <div className="of-block">
              <p className="side-label">What we know</p>
              {facts.map((c, i) => (
                <p key={i} className="side-item">
                  {plainEditorText(c.body)}
                </p>
              ))}
            </div>
          ) : null}
          <details className="of-trail">
            <summary>Research trail — {searches.length} searches</summary>
            {searches.length ? (
              searches.map((s, i) => (
                <p key={`${s.hop}-${i}`} className="side-item">
                  “{s.query}”
                </p>
              ))
            ) : (
              <p className="side-item">No searches logged yet.</p>
            )}
          </details>
          {deadEnds.length > 0 ? (
            <details className="of-trail">
              <summary>Dead ends — {deadEnds.length}</summary>
              {deadEnds.map((d, i) => (
                <p key={i} className="side-item">
                  <b>{d.hypothesis}</b> — {plainEditorText(d.dismissed_because)}
                </p>
              ))}
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function OpenedRecords({
  artifacts,
}: {
  artifacts: {
    id: number;
    url: string;
    title: string;
    classification: string;
    fetch_status: number | null;
    fetch_outcome: string | null;
    version_id: number | null;
    created_at: string;
    excerpt?: string;
  }[];
}) {
  const ordered = artifacts.slice().reverse();
  function previewOf(a: (typeof ordered)[number]) {
    return readableCapture({
      text: a.excerpt ?? "",
      status: a.fetch_status,
      outcome: a.fetch_outcome,
      title: a.title,
    });
  }
  function firstReadableId(list: typeof ordered) {
    return list.find((a) => previewOf(a).kind === "ok")?.id ?? list[0]?.id ?? null;
  }
  const [openId, setOpenId] = useState<number | null>(() => firstReadableId(ordered));
  const idKey = ordered.map((a) => a.id).join(",");
  useEffect(() => {
    const list = ordered;
    if (openId != null && list.some((a) => a.id === openId)) return;
    setOpenId(firstReadableId(list));
    // ordered is derived from artifacts; idKey is the stable fingerprint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, openId]);

  const selected = ordered.find((a) => a.id === openId) ?? ordered[0];
  const idx = selected ? ordered.findIndex((a) => a.id === selected.id) : -1;
  const body = useQuery({
    queryKey: ["artifact", selected?.id ?? 0],
    queryFn: () => getArtifact({ data: selected!.id }),
    enabled: selected != null,
  });

  if (!ordered.length) return null;

  function go(delta: number) {
    const next = idx + delta;
    if (next < 0 || next >= ordered.length) return;
    setOpenId(ordered[next]!.id);
  }

  const cap = selected
    ? readableCapture({
        text: body.data?.full_text ?? selected.excerpt ?? "",
        status: body.data?.fetch_status ?? selected.fetch_status,
        outcome: body.data?.fetch_outcome ?? selected.fetch_outcome,
        title: selected.title,
      })
    : null;
  const title = selected
    ? cap?.kind === "blocked"
      ? selected.fetch_status === 429
        ? "Too many requests — not the article"
        : "Capture failed — not the article"
      : selected.title && !/^https?:/i.test(selected.title)
        ? selected.title
        : headlineFromUrl(selected.url) || selected.title || selected.url
    : "";
  const kind = selected ? recordKindFromUrl(selected.url) : "";
  const org = selected ? organizationFromUrl(selected.url) : "";

  return (
    <div className="reader">
      <div className="reader-index" role="list">
        {ordered.map((a, i) => {
          const preview = previewOf(a);
          const rowTitle =
            preview.kind === "blocked"
              ? a.fetch_status === 429
                ? "Too many requests — not the article"
                : `Capture failed${a.fetch_status ? ` (${a.fetch_status})` : ""} — not the article`
              : a.title && !/^https?:/i.test(a.title)
                ? a.title
                : headlineFromUrl(a.url) || a.title || a.url;
          const rowOrg = organizationFromUrl(a.url);
          return (
            <button
              key={a.id}
              type="button"
              role="listitem"
              className={
                "reader-row" +
                (a.id === selected?.id ? " on" : "") +
                (preview.kind === "blocked" ? " blocked" : "")
              }
              aria-current={a.id === selected?.id ? "true" : undefined}
              onClick={() => setOpenId(a.id)}
            >
              <span className="read-kind">
                {i + 1} · {preview.kind === "blocked" ? "Blocked" : recordKindFromUrl(a.url)}
                {rowOrg ? ` · ${rowOrg}` : ""}
              </span>
              <span className="read-title">{rowTitle || "Captured page"}</span>
            </button>
          );
        })}
      </div>

      {selected ? (
        <article className="reader-doc">
          <p className="read-kind">
            Reading {idx + 1} of {ordered.length} ·{" "}
            {cap?.kind === "blocked" ? "Blocked" : kind}
            {org ? ` · ${org}` : ""}
            {selected.created_at ? ` · captured ${formatShortDate(selected.created_at)}` : ""}
          </p>
          <h3 className="read-doc-title">{title || "Captured page"}</h3>
          <p className="read-acts">
            {selected.url.startsWith("http") ? (
              <a href={selected.url} className="inline-link" target="_blank" rel="noreferrer">
                Open original
              </a>
            ) : null}
            <button type="button" className="inline-link" disabled={idx <= 0} onClick={() => go(-1)}>
              Previous
            </button>
            <button
              type="button"
              className="inline-link"
              disabled={idx >= ordered.length - 1}
              onClick={() => go(1)}
            >
              Next
            </button>
          </p>
          {selected.url.startsWith("http") ? <p className="read-url">{selected.url}</p> : null}
          {body.isPending && !body.data ? (
            <p className="meta">Opening the captured copy…</p>
          ) : cap?.kind === "blocked" ? (
            <p className="note err">{cap.note}</p>
          ) : cap?.kind === "empty" ? (
            <p className="read-ex">{cap.note}</p>
          ) : cap?.body ? (
            <div className="read-full">{cap.body}</div>
          ) : (
            <p className="read-ex">
              Opened, but no readable text was extracted. Use Open original to read the live page.
            </p>
          )}
        </article>
      ) : null}
    </div>
  );
}

function startedLine(title: string, paste: string, summary: string): string {
  const text = paste.trim();
  if (/^followed from the/i.test(text)) {
    return text.split("\n")[0]!.slice(0, 280);
  }
  if (text) {
    const first = text.split("\n")[0]!.replace(/\s+/g, " ").trim();
    if (first && !looksLikeInternalSummary(first)) return first.slice(0, 220);
  }
  if (summary && !looksLikeInternalSummary(summary)) {
    return plainEditorText(summary).slice(0, 220);
  }
  return `Opened as “${title}.”`;
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
