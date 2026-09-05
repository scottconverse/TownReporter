import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Busy, DeskShell, InkButton, Score, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import {
  continueInvestigation,
  findSomethingToDigInto,
  fileRedditTip,
  getInvestigation,
  getArtifact,
  listDarkRuns,
  listInvestigations,
  listWorthALook,
  openDarkInvestigation,
  parkInvestigation,
  queueInvestigation,
  refreshBrief,
  reopenParkedInvestigation,
  scanTipSubreddit,
  type InvestigationRow,
} from "@/lib/news/dark";
import {
  blockedDigBannerText,
  editorError,
  editorKindLabel,
  editorPauseReason,
  editorStatus,
  elapsedLabel,
  excerptForEditor,
  headlineFromUrl,
  humanFrontierLabel,
  looksLikeInternalSummary,
  organizationFromUrl,
  pileForStatus,
  plainEditorText,
  plainFinding,
  progressLine,
  recordKindFromUrl,
  redditFeedLabel,
  redditFeedStatusLabel,
  redditPostStateLabel,
  redditResultHeadline,
  stalledRunCopy,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";

type RedditScanResult = Awaited<ReturnType<typeof scanTipSubreddit>>;
import { usePaperDateFormatters } from "@/lib/paper-context";
import { DarkDialsPanel } from "@/components/dark-dials-panel";
import {
  InvestigationBriefCard,
  SectionTldr,
} from "@/components/investigation-brief";
import { captureBatchStats, readableCapture } from "@/lib/news/html-text";
import type { WorthSeed } from "@/lib/news/worth-a-look";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";
import { ModelPicker } from "@/components/model-picker";
import { darkModelChoice, modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/dark")({
  component: DarkPage,
});

const OPEN_KEY = "townreporter.dark.openId";

function DarkPage() {
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(false);
  const [noticeAt, setNoticeAt] = useState<"paste" | "work">("work");
  const [openId, setOpenId] = useState<number | null>(null);
  const [queued, setQueued] = useState<
    { leadId: number; invId: number; alreadyQueued: boolean } | null
  >(null);
  const [queueError, setQueueError] = useState<{ invId: number; message: string } | null>(null);
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [cardPhase, setCardPhase] = useState<string>("");
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasInvestigating = useRef(false);
  const [redditResult, setRedditResult] = useState<RedditScanResult | null>(null);
  const [redditElapsed, setRedditElapsed] = useState(0);
  const [redditAnnounce, setRedditAnnounce] = useState("");
  const redditStartRef = useRef<number | null>(null);

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

  function showPasteNotice(text: string | null, ok = false) {
    setNotice(text);
    setNoticeOk(ok);
    setNoticeAt("paste");
  }
  function showWorkNotice(text: string | null, ok = false) {
    setNotice(text);
    setNoticeOk(ok);
    setNoticeAt("work");
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
    setCardPhase("Searching records…");
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

  /*
    Which model digs (0.6.2).

    Dark Desk is the one surface that had no picker: every round ran on
    whatever `resolveProvider()` preferred on the machine. The choice is
    carried on the job (`desk_jobs.model_choice`) exactly as a draft's is, and
    remembered on the investigation, so "Keep digging" on a file that was
    started on Codex stays on Codex rather than quietly changing author.
  */
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const pickedFor = useRef<number | null>(null);
  const [briefWaiting, setBriefWaiting] = useState(false);
  const detail = useQuery({
    queryKey: ["investigation", openId],
    queryFn: () => getInvestigation({ data: openId! }),
    enabled: openId != null,
    refetchInterval: (q) => {
      const st = q.state.data?.investigation.status;
      if (st === "investigating") return 2000;
      // The brief is its own job (0.6.2); poll while one is in flight.
      const bj = q.state.data?.briefJob;
      if (bj && (bj.status === "queued" || bj.status === "running")) return 2000;
      return false;
    },
  });

  /*
    Open a file, and the picker shows what that file was last dug with.

    Only once per file (`pickedFor`), so an editor who changes the model and
    then watches the round finish does not have their choice overwritten by
    the poll that lands a second later.
  */
  useEffect(() => {
    const last = detail.data?.investigation.last_model_choice;
    if (openId == null || pickedFor.current === openId) return;
    if (!detail.data) return;
    pickedFor.current = openId;
    setModelChoice(darkModelChoice(last));
  }, [openId, detail.data]);

  /** A queued brief has landed (or failed); say so once and stop polling. */
  useEffect(() => {
    const bj = detail.data?.briefJob;
    if (!briefWaiting || !bj) return;
    if (bj.status === "queued" || bj.status === "running") return;
    setBriefWaiting(false);
    showWorkNotice(
      bj.status === "completed"
        ? "The brief is written."
        : `No brief: ${editorError(bj.error ?? "") || bj.error || "it did not finish."}`,
      bj.status === "completed",
    );
  }, [detail.data?.briefJob, briefWaiting]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
    if (openId != null) void qc.invalidateQueries({ queryKey: ["investigation", openId] });
  };

  const advance = useMutation({
    mutationFn: (id: number) => continueInvestigation({ data: { id, modelChoice } }),
    onSuccess: (res) => {
      if (!res || res.ok !== true) {
        const raw = res && "error" in res ? String(res.error ?? "") : "Research failed";
        /*
          A preflight refusal (QA-002) carries its own `kind`, and its
          `error` field is already the plain-English guidance
          (`scanPreflight`'s GUIDANCE table) — never engine text. Routing it
          through `editorError` was actively harmful: that function's
          `/AI is not available/i` and `/claude code/i` matchers, written for
          mid-round failures, caught the guidance sentence too (it names
          "Claude Code" as one of the setup options) and rewrote it into
          "The writing model did not finish this round... Click Keep digging
          to continue" — inviting exactly the retry-that-cannot-help the
          preflight exists to prevent. Show the guidance as written for a
          refusal; keep `editorError`'s translation for every other failure.
        */
        const isPreflightRefusal = Boolean(res && typeof res === "object" && "kind" in res);
        const msg = isPreflightRefusal ? raw : editorError(raw) || raw || "Research failed";
        showWorkNotice(msg, false);
        setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
        clearPhase();
        invalidate();
        return;
      }
      setNotice(null);
      invalidate();
    },
    onError: (err) => {
      const msg =
        editorError(err instanceof Error ? err.message : "Research failed") || "Research failed";
      showWorkNotice(msg, false);
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
        showPasteNotice("Could not open an investigation.");
        clearPhase();
        return;
      }
      setPaste("");
      afterOpen(res.investigationId, "paste");
    },
    onError: (err) => {
      showPasteNotice(editorError(err instanceof Error ? err.message : "Could not start"));
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
        showWorkNotice("Nothing to open yet. Paste a lead to start.");
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, "find");
    },
    onError: (err) => {
      showWorkNotice(editorError(err instanceof Error ? err.message : "Find failed"));
      clearPhase();
    },
  });

  const toQueue = useMutation({
    mutationFn: (id: number) => queueInvestigation({ data: id }),
    onMutate: (id) => {
      // Clear any stale error/confirmation from a previous attempt on this
      // file so a retry does not show two contradictory banners at once.
      setQueueError((prev) => (prev?.invId === id ? null : prev));
    },
    onSuccess: (res, id) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (res?.ok) {
        setQueueError(null);
        setQueued({ leadId: res.leadId, invId: id, alreadyQueued: Boolean(res.alreadyQueued) });
      } else {
        setQueueError({ invId: id, message: res?.error ?? "Could not send to the queue." });
      }
    },
    onError: (err, id) => {
      setQueueError({
        invId: id,
        message: err instanceof Error ? err.message : "Could not send to the queue.",
      });
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
        showWorkNotice("Could not follow that lead.");
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, seed.title);
    },
    onError: (err) => {
      showWorkNotice(editorError(err instanceof Error ? err.message : "Could not follow that lead"));
      clearPhase();
    },
  });

  const park = useMutation({
    mutationFn: (id: number) => parkInvestigation({ data: id }),
    onSuccess: () => {
      rememberOpen(null);
      showWorkNotice("Set aside. Pull it back from that pile anytime.", true);
      invalidate();
    },
    onError: (err) => {
      showWorkNotice(err instanceof Error ? err.message : "Could not set that aside.");
    },
  });

  const pullBack = useMutation({
    mutationFn: (id: number) => reopenParkedInvestigation({ data: id }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        rememberOpen(res.investigationId);
        setNotice(null);
      } else {
        showWorkNotice("Could not pull that back.");
      }
      invalidate();
    },
    onError: (err) => {
      showWorkNotice(err instanceof Error ? err.message : "Could not pull that back.");
    },
  });

  /**
   * Read the town's subreddit for tips.
   *
   * Its own button rather than part of the scan, because it spends a budget
   * that is not ours: Reddit allows about ten requests a minute per address,
   * shared with everything else on this machine, so this runs when an editor
   * asks and not on a timer.
   */
  const reddit = useMutation({
    mutationFn: () => scanTipSubreddit(),
    onMutate: () => {
      setRedditResult(null);
    },
    onSuccess: (res) => {
      if (!res?.ok) {
        showWorkNotice("Reddit did not answer. Try again in a few minutes.");
        setRedditAnnounce("Reddit did not answer.");
        return;
      }
      const parts: string[] = [];
      parts.push(
        res.filed
          ? `Filed ${res.filed} tip${res.filed === 1 ? "" : "s"} from r/${res.subreddit}.`
          : `Nothing new in r/${res.subreddit}.`,
      );
      parts.push(`Read ${res.read} posts, ${res.civic} looked civic.`);
      if (res.alreadyKnown) parts.push(`${res.alreadyKnown} already on the desk.`);
      if (res.incomplete && res.reason) parts.push(res.reason);
      // A quiet subreddit is a successful read, not a failure — style it as
      // one. Only an actual incomplete/failed read gets the err styling.
      showWorkNotice(parts.join(" "), !res.incomplete);
      setRedditResult(res);
      setRedditAnnounce(`Finished reading r/${res.subreddit}. ${redditResultHeadline(res)}.`);
      invalidate();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Reddit did not answer.";
      showWorkNotice(msg);
      setRedditAnnounce(msg);
    },
  });

  const fileTip = useMutation({
    mutationFn: (post: { url: string; title: string; excerpt: string }) => fileRedditTip({ data: post }),
    onSuccess: (res, post) => {
      if (!res?.ok) return;
      if (res.filed) {
        setRedditResult((prev) =>
          prev
            ? {
                ...prev,
                topScores: prev.topScores.map((p) => (p.url === post.url ? { ...p, state: "filed" as const } : p)),
              }
            : prev,
        );
        invalidate();
      }
    },
    onError: (err) => {
      showWorkNotice(err instanceof Error ? err.message : "Could not file that tip.");
    },
  });

  // Elapsed time for the "Reading r/longmont" panel. The client cannot see
  // per-feed progress — one synchronous server call — so this is honest
  // about what it shows: how long the read has taken, not how far along it
  // is. Announced at start and end only (redditAnnounce), never per tick.
  useEffect(() => {
    if (!reddit.isPending) return;
    redditStartRef.current = Date.now();
    setRedditElapsed(0);
    setRedditAnnounce("Reading r/longmont. Three feeds, paced about a minute.");
    const id = setInterval(() => {
      if (redditStartRef.current != null) {
        setRedditElapsed(Math.floor((Date.now() - redditStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [reddit.isPending]);

  const writeBrief = useMutation({
    mutationFn: (id: number) => refreshBrief({ data: { id, modelChoice } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        showWorkNotice(res?.error ? `No brief: ${res.error}` : "No brief written.");
        return;
      }
      // Queued, not written: the brief is a job now, and the file view below
      // polls until it lands. See `startBriefJob` in src/lib/news/dark.ts.
      setBriefWaiting(true);
      showWorkNotice("Writing the brief…", true);
      invalidate();
    },
    onError: (err) =>
      showWorkNotice(err instanceof Error ? err.message : "Could not write the brief."),
  });

  const starting = openFromCard.isPending || openPaste.isPending || find.isPending || followLead.isPending;
  const digging = advance.isPending;
  const busyStart = starting;

  useEffect(() => {
    if (openId == null || digging || starting) return;
    try {
      const auto = sessionStorage.getItem("townreporter.dark.autodig");
      if (auto && Number(auto) === openId) {
        sessionStorage.removeItem("townreporter.dark.autodig");
        beginDigPhase();
        advance.mutate(openId);
      }
    } catch {
      /* ignore */
    }
  }, [openId]);
  const inv = detail.data?.investigation;
  // See `runLooksStalled` in `src/lib/news/jobs.ts`: true only when the
  // investigation claims to still be running but no live job is behind it,
  // most likely because the app restarted mid-round. Gates the busy UI so a
  // dead round does not poll and spin forever with "Keep digging" disabled.
  const stalled = Boolean(detail.data?.stalled);
  useEffect(() => {
    const now = inv?.status === "investigating" || digging;
    if (wasInvestigating.current && !now) clearPhase();
    wasInvestigating.current = Boolean(now);
  }, [inv?.status, digging]);
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
        <div className="row-acts static" id="dark-start-actions">
          {/*
            The same picker the open file has, and the same state behind it:
            the first round of a new file is a round like any other, and an
            editor who has decided which model digs should not have to open
            the file first to say so.
          */}
          <ModelPicker
            scope="dark"
            value={modelChoice}
            onChange={setModelChoice}
            disabled={busyStart || digging}
            compact
          />
          <InkButton
            small
            type="submit"
            disabled={busyStart || digging || !paste.trim()}
          >
            {openPaste.isPending ? "Starting…" : "Start digging"}
          </InkButton>
        </div>
        {notice && noticeAt === "paste" ? (
          <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p>
        ) : null}
        {pendingCard === "paste" && cardPhase ? (
          <p className="meta" aria-live="polite">
            {cardPhase}
          </p>
        ) : null}
      </form>

      {notice && noticeAt === "work" && openId == null && !redditResult ? (
        <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p>
      ) : null}

      {openId != null ? (
        <InvestigationWorkspace
          openId={openId}
          detail={detail.data ?? undefined}
          pending={detail.isPending && !detail.data}
          digging={(digging || inv?.status === "investigating") && !stalled}
          keepDisabled={(digging || inv?.status === "investigating") && !stalled}
          stalled={stalled}
          phase={cardPhase || liveLine}
          notice={noticeAt === "work" ? notice : null}
          noticeOk={noticeOk}
          queuedLead={queued?.invId === openId ? queued.leadId : null}
          queuedAlready={queued?.invId === openId ? queued.alreadyQueued : false}
          queuePending={toQueue.isPending}
          queueError={queueError?.invId === openId ? queueError.message : null}
          followPending={followLead.isPending}
          parkPending={park.isPending}
          onKeepDigging={() => {
            setNotice(null);
            beginDigPhase();
            advance.mutate(openId);
          }}
          onQueue={() => toQueue.mutate(openId)}
          onClose={() => rememberOpen(null)}
          onPark={() => park.mutate(openId)}
          onFollow={(seed) => followLead.mutate(seed)}
          onWriteBrief={() => writeBrief.mutate(openId)}
          briefPending={writeBrief.isPending || briefWaiting}
          modelChoice={modelChoice}
          onModelChoice={setModelChoice}
        />
      ) : null}

      <div className="piles">
        <section>
          <SecHead
            title="To look at"
            count={inbox.length}
            sub="New material. Nobody has opened it yet."
          />
          {worth.isError && !worth.data ? (
            <ScreenError
              night
              message={worth.error instanceof Error ? worth.error.message : "Could not load new material."}
              onRetry={() => void worth.refetch()}
              retrying={worth.isRefetching}
            />
          ) : worth.isPending && !inbox.length ? (
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
          <DarkDialsPanel />
          <div className="np-acts">
            <InkButton tone="quiet" small disabled={busyStart || digging} onClick={() => find.mutate()}>
              {find.isPending ? "Starting…" : "Pick one for me"}
            </InkButton>
            <InkButton
              tone="quiet"
              small
              disabled={busyStart || digging || reddit.isPending}
              onClick={() => reddit.mutate()}
            >
              {reddit.isPending ? "Reading r/longmont…" : "Check r/longmont"}
            </InkButton>
          </div>
          {reddit.isPending ? (
            <div className="reddit-progress">
              <p className="worth-t">Reading r/longmont</p>
              <p className="reddit-sub">
                Three feeds, read 8 seconds apart so Reddit does not block this paper. About a
                minute.
              </p>
              <div className="busy-rule" aria-hidden />
              <p className="reddit-elapsed" aria-hidden>
                {elapsedLabel(redditElapsed)}
              </p>
              <p className="sr-only" role="status" aria-live="polite">
                {redditAnnounce}
              </p>
            </div>
          ) : redditResult ? (
            <RedditResultPanel
              result={redditResult}
              announce={redditAnnounce}
              onDismiss={() => setRedditResult(null)}
              onFileTip={(post) => fileTip.mutate(post)}
              filingUrl={fileTip.isPending ? (fileTip.variables?.url ?? null) : null}
            />
          ) : (
            <p className="mt-2 text-sm text-muted">
              Tips from the subreddit arrive here as unverified cards. They are a
              reason to go looking for the record, never a source to cite.
            </p>
          )}
        </section>

        <section>
          <SecHead
            title="On the desk"
            count={active.length}
            sub="Started. A stop mid-file is normal — it means more to read, not a failure."
          />
          {investigations.isError && !investigations.data ? (
            <ScreenError
              night
              message={
                investigations.error instanceof Error
                  ? investigations.error.message
                  : "Could not load the desk."
              }
              onRetry={() => void investigations.refetch()}
              retrying={investigations.isRefetching}
            />
          ) : investigations.isPending && !active.length ? (
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
                locked={digging || busyStart}
                onOpen={() => rememberOpen(row.id)}
                onKeep={() => {
                  if (digging || busyStart) return;
                  setNotice(null);
                  rememberOpen(row.id);
                  beginDigPhase();
                  advance.mutate(row.id);
                }}
                onPark={() => {
                  if (digging) return;
                  park.mutate(row.id);
                }}
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
                    {pullBack.isPending ? "Pulling back…" : "Pull back"}
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
                  <p className="meta">
                    {formatDateTime(r.started_at)}
                    {/*
                      Which model dug this round. A round that dug badly and a
                      round that dug on a different model are different facts
                      about the same file, and the history could not tell them
                      apart before 0.6.2. Rounds dug before the picker existed
                      have no answer, and say nothing rather than guessing.
                    */}
                    {r.model_choice ? ` · ${modelChoiceLabel(r.model_choice)}` : ""}
                  </p>
                  {r.error ? (
                    <p className="side-item">
                      {editorError(r.error)}
                      {looksLikeProviderAuthFailure(r.error) ? (
                        <ProviderSignInButton detail={r.error} />
                      ) : null}
                    </p>
                  ) : null}
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
  locked,
  onOpen,
  onKeep,
  onPark,
}: {
  row: InvestigationRow;
  selected: boolean;
  digging: boolean;
  locked: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onPark: () => void;
}) {
  const { formatShortDate } = usePaperDateFormatters();
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
        <InkButton small disabled={digging || locked} onClick={onKeep}>
          {digging ? "Reading…" : "Keep digging"}
        </InkButton>
        <InkButton tone="quiet" small disabled={digging || locked} onClick={onPark}>
          Set aside
        </InkButton>
      </div>
    </div>
  );
}

/**
 * Result of a "Check r/longmont" read.
 *
 * Owner report 2026-09-05: the read takes ~60-70s and used to leave a single
 * easy-to-miss line as its only trace. This panel is the honest version of
 * "what actually happened" — every scored post (not only the ones filed),
 * a per-feed log, and a way to file a near miss by hand.
 */
function RedditResultPanel({
  result,
  announce,
  onDismiss,
  onFileTip,
  filingUrl,
}: {
  result: RedditScanResult;
  announce: string;
  onDismiss: () => void;
  onFileTip: (post: { url: string; title: string; excerpt: string }) => void;
  filingUrl: string | null;
}) {
  return (
    <div className="reddit-result">
      <p className="worth-t">Reddit read finished</p>
      <p className="reddit-headline">{redditResultHeadline(result)}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {result.incomplete ? (
        <Notice kind="warn" night>
          {result.reason || "The read stopped early."}
        </Notice>
      ) : null}
      {result.read > 0 && result.civic === 0 ? (
        <p className="reddit-empty">
          None of these scored 6 or more on the civic word test. Posts that came close are
          listed so you can file one by hand.
        </p>
      ) : null}
      {result.topScores.length > 0 ? (
        <div className="tip-list">
          {result.topScores.map((p) => {
            const canFile = p.state !== "filed";
            const filing = filingUrl === p.url;
            return (
              <div key={p.url} className="tip-row">
                <Score v={p.score} />
                <a href={p.url} target="_blank" rel="noopener" className="inline-link tip-title">
                  {p.title}
                </a>
                <span className={"chip st-" + p.state}>{redditPostStateLabel(p.state)}</span>
                {canFile ? (
                  <InkButton
                    tone="quiet"
                    small
                    disabled={filing}
                    onClick={() => onFileTip({ url: p.url, title: p.title, excerpt: p.excerpt })}
                  >
                    {filing ? "Filing…" : "File as tip"}
                  </InkButton>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      <details className="of-trail">
        <summary>What was read — {result.log.length} feed{result.log.length === 1 ? "" : "s"}</summary>
        {result.log.map((entry, i) => {
          const status = redditFeedStatusLabel(entry);
          const bad = !entry.ok;
          return (
            <p key={i} className="feed-row">
              <span>{redditFeedLabel(entry.url, result.subreddit)}</span>
              <span className={bad ? "feed-bad" : undefined}>{status}</span>
              <span>
                {entry.posts} post{entry.posts === 1 ? "" : "s"}
              </span>
            </p>
          );
        })}
      </details>
      <div className="np-acts">
        <InkButton tone="quiet" small onClick={onDismiss}>
          Dismiss
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
  stalled,
  phase,
  notice,
  noticeOk,
  queuedLead,
  queuedAlready,
  queuePending,
  queueError,
  followPending,
  parkPending,
  onKeepDigging,
  onQueue,
  onClose,
  onPark,
  onFollow,
  onWriteBrief,
  briefPending,
  modelChoice,
  onModelChoice,
}: {
  openId: number;
  detail: Awaited<ReturnType<typeof getInvestigation>> | undefined;
  pending: boolean;
  digging: boolean;
  keepDisabled: boolean;
  stalled: boolean;
  phase: string;
  notice: string | null;
  noticeOk: boolean;
  queuedLead: number | null;
  queuedAlready: boolean;
  queuePending: boolean;
  queueError: string | null;
  followPending: boolean;
  parkPending: boolean;
  onKeepDigging: () => void;
  onQueue: () => void;
  onClose: () => void;
  onPark: () => void;
  onFollow: (seed: { paste: string; title: string }) => void;
  onWriteBrief: () => void;
  briefPending: boolean;
  modelChoice: StoryModelChoice;
  onModelChoice: (value: StoryModelChoice) => void;
}) {
  const { formatShortDate } = usePaperDateFormatters();
  const [frN, setFrN] = useState(6);
  useEffect(() => {
    setFrN(6);
  }, [openId]);
  const inv = detail?.investigation;
  const allArtifacts = detail?.artifacts ?? [];
  const artifacts = allArtifacts.filter((a) => !a.url.startsWith("editor://"));
  const pasteArt = allArtifacts.find((a) => a.url.startsWith("editor://"));
  // Real-vs-blocked, not raw row counts: a mostly-blocked dig must not look
  // identical to a working one (Dark Desk F6).
  const captureStats = captureBatchStats(
    artifacts.map((a) => ({
      text: a.excerpt ?? "",
      status: a.fetch_status,
      outcome: a.fetch_outcome,
      title: a.title,
    })),
  );
  const readableLabel =
    captureStats.total === 0
      ? "0 records on file"
      : captureStats.ok === captureStats.total
        ? `${captureStats.total} records on file`
        : `${captureStats.ok} readable / ${captureStats.total} captured`;
  const readableCountBadge =
    captureStats.total === 0
      ? 0
      : captureStats.ok === captureStats.total
        ? captureStats.total
        : `${captureStats.ok}/${captureStats.total}`;
  const showBlockedBanner = captureStats.total >= 3 && captureStats.blockedRatio > 0.6;
  const claims = detail?.claims ?? [];
  const hyps = detail?.hypotheses ?? [];
  const searches = detail?.searches ?? [];
  const frontier = detail?.frontier ?? [];
  const deadEnds = detail?.deadEnds ?? [];
  const anomalies = detail?.anomalies ?? [];
  const entities = detail?.entities ?? [];
  const signals = detail?.signals ?? [];
  const brief = detail?.brief ?? null;
  const facts = claims.filter((c) => /FACT|OBSERVATION/i.test(c.kind));
  const questions = openQuestionsFrom(detail);
  // Grade each "On the record" line by whether it ties to a captured
  // source (a URL, or a claim with evidence/a version), so the list reads
  // as findings-with-strength instead of one undifferentiated pile
  // (Dark Desk F6).
  const findings: { text: string; sourceNote: string | null }[] = [
    ...signals
      .map((s) => ({
        text: plainEditorText(`${s.name}: ${s.observation}`),
        sourceNote: null,
      }))
      .filter((f) => f.text),
    ...anomalies
      .map((a) => ({
        text: plainFinding(a.summary, a.url),
        sourceNote: a.url ? organizationFromUrl(a.url) || a.url : null,
      }))
      .filter((f) => f.text),
    ...entities
      .map((e) => ({
        text: plainEditorText(`${e.name} — ${e.why}`),
        sourceNote: null,
      }))
      .filter((f) => f.text),
    ...claims
      .filter((c) => /FINDING|PATTERN/i.test(c.kind))
      .map((c) => ({
        text: plainEditorText(c.body),
        sourceNote: c.evidence ? plainEditorText(c.evidence).slice(0, 160) : null,
      }))
      .filter((f) => f.text),
  ];
  const tests = hyps.map((h) => plainEditorText(h.body)).filter(Boolean);
  const next = frontier.filter((f) =>
    ["open", "investigating", "reopened"].includes(f.status),
  );
  // The raw row list can hold the same lead under several labels; dedupe by
  // its displayed text so the pile shows what's actually left to open, not
  // duplicate rows counted as separate work (Dark Desk F6).
  const nextDeduped = (() => {
    const seen = new Set<string>();
    const out: typeof next = [];
    for (const f of next) {
      const key = humanFrontierLabel(f.label).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  })();
  const leftover = nextDeduped.length;
  const pauseText = editorPauseReason(inv?.pause_reason, captureStats);
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
    readableLabel,
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
          {/*
            The picker sits next to the button that spends, not in a settings
            page: the editor decides which model digs at the moment they press
            Keep digging, the same way they do on a Story draft. An explicit
            choice never falls back to another provider.
          */}
          <ModelPicker
            scope="dark"
            value={modelChoice}
            onChange={onModelChoice}
            disabled={keepDisabled}
            compact
          />
          <InkButton disabled={keepDisabled} onClick={onKeepDigging}>
            {digging ? "Reading…" : "Keep digging"}
          </InkButton>
          {queuedLead != null ? (
            <Link
              to="/desk/story/$leadId"
              params={{ leadId: String(queuedLead) }}
              className="btn queue-done"
            >
              {queuedAlready ? "✓ Already on the queue · Open →" : "✓ On the queue · Open →"}
            </Link>
          ) : (
            <InkButton tone="ghost" disabled={keepDisabled || queuePending} onClick={onQueue}>
              {queuePending ? "Sending…" : "Send to the queue"}
            </InkButton>
          )}
          <InkButton tone="quiet" disabled={keepDisabled || parkPending} onClick={onPark}>
            {parkPending ? "Setting aside…" : "Set aside"}
          </InkButton>
          <InkButton tone="quiet" onClick={onClose}>
            Close file
          </InkButton>
        </div>
      </div>
      {stalled ? <p className="note err">{stalledRunCopy("dark")}</p> : null}
      {digging ? <Busy label={phase || "Searching records…"} /> : null}
      {notice && !digging ? <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p> : null}
      {
        /*
          Persistent, not a fleeting toast: this banner stays mounted for as
          long as the queue state it describes is true, independent of the
          transient `notice` line above (which other actions on this file
          clear). An editor who queues a lead and then keeps digging must
          still be able to answer "where did it go?" without hunting —
          especially since a queued lead can later be drafted and drop out of
          the editor's default Queue view (0.6.16).
        */
        queueError != null ? (
          <Notice kind="err" night>
            Could not send to the queue: {queueError}
          </Notice>
        ) : queuedLead != null ? (
          <Notice kind="ok" night>
            {queuedAlready
              ? "Already on the working queue as a story lead."
              : "On the working queue as a story lead."}{" "}
            Dark Desk did not publish.{" "}
            <Link
              to="/desk/story/$leadId"
              params={{ leadId: String(queuedLead) }}
              className="inline-link"
            >
              Open the lead →
            </Link>
            {" · "}
            <Link to="/desk/queue" className="inline-link">
              Open the queue
            </Link>
          </Notice>
        ) : null
      }
      {pending ? <p className="meta">Getting this ready…</p> : null}
      {started ? <p className="of-started">{started}</p> : null}
      {inv?.status === "paused" && pauseText && !digging ? (
        <p className="of-stop">
          <b>Why it stopped:</b> {pauseText}
          {looksLikeProviderAuthFailure(inv?.pause_reason) ? (
            <ProviderSignInButton detail={inv?.pause_reason} />
          ) : null}
        </p>
      ) : null}
      {showBlockedBanner ? (
        <p className="of-stop err" role="status">
          <b>Mostly blocked:</b> {blockedDigBannerText(captureStats)}
        </p>
      ) : null}

      <div className="of-grid">
        <div>
          <SecHead
            title="What to read"
            count={readableCountBadge}
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
          {nextDeduped.length > 0 ? (
            <>
              <SecHead
                title="Still unopened"
                count={nextDeduped.length}
                sub="Names, pages, and documents mentioned in the records. Not read yet, duplicates folded in."
              />
              <div className="of-frontier">
                {nextDeduped.slice(0, frN).map((f) => (
                  <div key={f.id} className="fr-item">
                    <p className="fr-label">{humanFrontierLabel(f.label)}</p>
                    {f.why ? <p className="fr-why">{plainEditorText(f.why)}</p> : null}
                    <InkButton
                      tone="quiet"
                      small
                      disabled={keepDisabled || followPending}
                      onClick={() =>
                        onFollow({
                          paste: `Followed from the “${parentTitle}” file: ${plainEditorText(f.why) || humanFrontierLabel(f.label)}.\n\n${f.label}\n${f.why}`,
                          title: humanFrontierLabel(f.label),
                        })
                      }
                    >
                      {followPending ? "Following…" : "Follow this lead"}
                    </InkButton>
                  </div>
                ))}
              </div>
              {nextDeduped.length > frN ? (
                <InkButton tone="quiet" small onClick={() => setFrN((n) => n + 10)}>
                  Next 10 — {nextDeduped.length - frN} more
                </InkButton>
              ) : null}
              {Number(inv?.still_open ?? leftover) > nextDeduped.length ? (
                <p className="meta">
                  {Number(inv?.still_open ?? leftover) - nextDeduped.length} more were mentioned but not
                  yet named. They surface as rounds read them.
                </p>
              ) : null}
            </>
          ) : null}
          {/*
            Above the four lists, because the question an editor opens a file
            with — is there something here, is it worth an hour — is the one
            thing the lists cannot answer.
          */}
          <InvestigationBriefCard
            brief={brief}
            onRefresh={onWriteBrief}
            refreshing={briefPending}
          />
          {findings.length > 0 ? (
            <div className="of-block">
              <p className="side-label">On the record</p>
              <SectionTldr text={brief?.sections?.record ?? ""} />
              {findings.slice(0, 8).map((f, i) => (
                <p key={i} className="side-item">
                  {f.text}
                  {f.sourceNote ? (
                    <span className="meta"> — {f.sourceNote}</span>
                  ) : (
                    <span className="meta evidence-weak"> — pattern-level, not tied to one source</span>
                  )}
                </p>
              ))}
            </div>
          ) : null}
          {tests.length > 0 ? (
            <div className="of-block">
              <p className="side-label">Being tested</p>
              <SectionTldr text={brief?.sections?.tested ?? ""} />
              {tests.slice(0, 6).map((n, i) => (
                <p key={i} className="side-item">
                  {n}
                </p>
              ))}
            </div>
          ) : null}
          {questions.length > 0 ? (
            <div className="of-block">
              <p className="side-label">Still open</p>
              <SectionTldr text={brief?.sections?.open ?? ""} />
              {questions.slice(0, 8).map((n, i) => (
                <p key={i} className="side-item">
                  {n}
                </p>
              ))}
            </div>
          ) : null}
          {facts.length > 0 ? (
            <div className="of-block">
              <p className="side-label">What we know</p>
              <SectionTldr text={brief?.sections?.known ?? ""} />
              {facts.map((c, i) => (
                <p key={i} className="side-item">
                  {plainEditorText(c.body)}
                  {c.evidence ? (
                    <span className="meta"> — {plainEditorText(c.evidence).slice(0, 160)}</span>
                  ) : null}
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
  const { formatShortDate } = usePaperDateFormatters();
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
              {preview.kind === "ok" && preview.body ? (
                <span className="np-meta">{excerptForEditor(preview.body, 140)}</span>
              ) : null}
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
