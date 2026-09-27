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
  getArtifactOcrJob,
  listDarkRuns,
  listInvestigations,
  listWorthALook,
  openDarkInvestigation,
  parkInvestigation,
  queueInvestigation,
  queueArtifactOcr,
  refreshBrief,
  reopenParkedInvestigation,
  scanTipSubreddit,
  getTipSubreddit,
  type DarkRunRow,
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
  investigationRoundLabel,
  darkJobActive,
  observedDarkJobFinished,
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
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DarkDialsPanel } from "@/components/dark-dials-panel";
import { estimateMinutes, scopeLabelsFor } from "@/lib/news/dark-dials";
import { getDarkDials } from "@/lib/news/dark";
import { InvestigationBriefCard, SectionTldr } from "@/components/investigation-brief";
import { SearchTrailEntry } from "@/components/search-trail-entry";
import { searchOutcomeWords } from "@/lib/news/search-trail-words";
import { captureBatchStats, readableCapture, captureRefusalLabel } from "@/lib/news/html-text";
import { describeExtractionMethod } from "@/lib/news/extraction-label";
import { takeDarkSeed } from "@/lib/news/dark-seed";
import type { WorthSeed } from "@/lib/news/worth-a-look";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";
import { DarkFileDialog } from "@/components/dialogs/editor-dialogs";
import { PageWatchPanel } from "@/components/page-watch-panel";
import {
  darkModelChoice,
  modelChoiceLabel,
  shouldHydrateDarkModel,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import {
  defaultModelEffort,
  modelEffort as validatedModelEffort,
  type ModelEffort,
} from "@/lib/news/provider-registry";

export const Route = createFileRoute("/desk/dark")({
  component: DarkPage,
});

const OPEN_KEY = "townreporter.dark.openId";

function DarkPage() {
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const qc = useQueryClient();
  /*
    A hand-over the editor asked for on another screen -- an import's review
    screen, a lead's "Send to Dark Desk" -- carried in `sessionStorage` because
    a couple of long paragraphs cannot ride in a URL. It waits here until the
    Start-a-file dialog opens with it (see the mount effect below) and is
    cleared the moment the dialog closes, so a second visit to the desk does
    not offer the same file twice.
  */
  const [seedFromImport, setSeedFromImport] = useState("");
  /** The header's "+ Start a file": the drawn dialog, open or shut. */
  const [startOpen, setStartOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [fileFocusRequest, setFileFocusRequest] = useState<{ id: number } | null>(null);
  const [queued, setQueued] = useState<{
    leadId: number;
    invId: number;
    alreadyQueued: boolean;
  } | null>(null);
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
    const timerRef = phaseTimer;
    try {
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) setOpenId(Number(raw));
      // `takeDarkSeed` reads the hand-over once and clears the `sessionStorage`
      // copy, so this holds the lead for the dialog and the next visit to the
      // desk opens its own empty one.
      //
      // The dialog opens with it: a hand-over the editor asked for on another
      // screen ("Send it to Dark Desk") is the drawn start box "opened with its
      // text already in it" (`dark-seed.ts:10`), and the box lives in the
      // dialog since phase 2c. A seed that only filled a shut dialog would
      // leave the editor on the desk with nothing to see and no sign the
      // hypothesis arrived.
      const seed = takeDarkSeed(sessionStorage);
      if (seed) {
        setSeedFromImport(seed);
        setStartOpen(true);
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function claimCard(id: string) {
    setClaimedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  /*
    Where a notice shows. Before the Start-a-file dialog, this screen had two
    boxes -- the paste panel above the split and the open file's workspace --
    and a notice had to say which one it belonged to. Starting a file is the
    dialog's own press now and reports its refusals inside itself, so the only
    notices left are the file's, and there is one place to put them.
  */
  function showNotice(text: string | null, ok = false) {
    setNotice(text);
    setNoticeOk(ok);
  }

  function rememberOpen(id: number | null) {
    setFileFocusRequest(null);
    setOpenId(id);
    try {
      if (id != null) sessionStorage.setItem(OPEN_KEY, String(id));
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      /* ignore */
    }
  }

  function openWatchedFile(id: number) {
    rememberOpen(id);
    setFileFocusRequest({ id });
  }

  function beginDigPhase() {
    setCardPhase("Queueing investigation…");
  }

  function clearPhase() {
    if (phaseTimer.current) clearTimeout(phaseTimer.current);
    setCardPhase("");
  }

  const tipSubreddit = useQuery({queryKey:["tip-subreddit"],queryFn:()=>getTipSubreddit()});
  const redditLabel = tipSubreddit.data?.subreddit ? `r/${tipSubreddit.data.subreddit}` : "configured subreddit";
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
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(null);
  const pickedFor = useRef<number | null>(null);
  const observedActiveDarkJob = useRef<{ investigationId: number; jobId: number } | null>(null);
  const [briefWaiting, setBriefWaiting] = useState(false);
  const detail = useQuery({
    queryKey: ["investigation", openId],
    queryFn: () => getInvestigation({ data: openId! }),
    enabled: openId != null,
    refetchInterval: (q) => {
      const st = q.state.data?.investigation.status;
      if (st === "investigating") return 2000;
      if (darkJobActive(q.state.data?.darkJob?.status)) return 2000;
      // The brief is its own job (0.6.2); poll while one is in flight.
      const bj = q.state.data?.briefJob;
      if (bj && (bj.status === "queued" || bj.status === "running")) return 2000;
      return false;
    },
  });

  useEffect(() => {
    if (
      fileFocusRequest?.id !== openId ||
      detail.data?.investigation.id !== openId
    ) return;
    // Wait for the selected file's data to render before moving the editor.
    const workspace = document.getElementById("investigation-workspace");
    if (!workspace) return;
    workspace.scrollIntoView({ behavior: "auto", block: "start" });
    workspace.focus({ preventScroll: true });
    setFileFocusRequest(null);
  }, [fileFocusRequest, openId, detail.data]);

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
    if (!shouldHydrateDarkModel(
      openId,
      detail.data.investigation.id,
      last,
      detail.data.investigation.status,
    )) return;
    pickedFor.current = openId;
    const remembered = darkModelChoice(last);
    setModelChoice(remembered);
    setModelEffort(validatedModelEffort(remembered, detail.data.run?.model_effort));
  }, [openId, detail.data]);

  /** A queued brief has landed (or failed); say so once and stop polling. */
  useEffect(() => {
    const bj = detail.data?.briefJob;
    if (!briefWaiting || !bj) return;
    if (bj.status === "queued" || bj.status === "running") return;
    setBriefWaiting(false);
    showNotice(
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

  const detailInvestigationId = detail.data?.investigation.id;
  const currentDarkJob = detail.data?.darkJob;
  const liveJobStage = darkJobActive(currentDarkJob?.status)
    ? String(currentDarkJob?.stage ?? "").trim()
    : "";
  useEffect(() => {
    if (openId == null || detailInvestigationId !== openId) return;
    const job = currentDarkJob;
    if (job && darkJobActive(job.status)) {
      observedActiveDarkJob.current = { investigationId: openId, jobId: job.id };
      return;
    }
    if (!observedDarkJobFinished(observedActiveDarkJob.current, openId, job)) return;
    observedActiveDarkJob.current = null;
    clearPhase();
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
  }, [openId, detailInvestigationId, currentDarkJob, qc]);

  /*
    The model the Start-a-file dialog was set to, for the first round only.

    The dialog hands its pick back with the new id, and the round it starts is
    issued in the same tick -- one render before `setModelChoice` could take
    effect, so reading the state there would dig with the previous file's
    model. Holding the pick in a ref and consuming it here is what makes the
    dialog's pick the model that actually runs; later rounds ("Keep digging",
    the picker under the file) read the state as before.
  */
  const firstRoundPick = useRef<StoryModelChoice | null>(null);
  const advance = useMutation({
    mutationFn: (id: number) => {
      const picked = firstRoundPick.current;
      firstRoundPick.current = null;
      return continueInvestigation({
        data: picked
          ? { id, modelChoice: picked, modelEffort: defaultModelEffort(picked) }
          : { id, modelChoice, modelEffort },
      });
    },
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
        showNotice(msg, false);
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
      showNotice(msg, false);
      setCardError(pendingCard ? { id: pendingCard, message: msg } : null);
      clearPhase();
      invalidate();
    },
  });

  function afterOpen(id: number, cardId?: string) {
    // This file was created with the picker value already on screen. Bind it
    // before the first open-state payload can hydrate Automatic and lock the
    // new id while the async job is still being committed.
    pickedFor.current = id;
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
      const msg =
        editorError(err instanceof Error ? err.message : "Could not start") || "Could not start";
      setCardError({ id: item.id, message: msg });
      setPendingCard(null);
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
        showNotice("Nothing to open yet. Paste a lead to start.");
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, "find");
    },
    onError: (err) => {
      showNotice(editorError(err instanceof Error ? err.message : "Find failed"));
      clearPhase();
    },
  });

  const toQueue = useMutation({
    mutationFn: (id: number) => queueInvestigation({ data: { id } }),
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
        showNotice("Could not follow that lead.");
        clearPhase();
        return;
      }
      afterOpen(res.investigationId, seed.title);
    },
    onError: (err) => {
      showNotice(
        editorError(err instanceof Error ? err.message : "Could not follow that lead"),
      );
      clearPhase();
    },
  });

  const park = useMutation({
    mutationFn: (id: number) => parkInvestigation({ data: id }),
    onSuccess: () => {
      rememberOpen(null);
      showNotice("Set aside. Pull it back from that pile anytime.", true);
      invalidate();
    },
    onError: (err) => {
      showNotice(err instanceof Error ? err.message : "Could not set that aside.");
    },
  });

  const pullBack = useMutation({
    mutationFn: (id: number) => reopenParkedInvestigation({ data: id }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        rememberOpen(res.investigationId);
        setNotice(null);
      } else {
        showNotice("Could not pull that back.");
      }
      invalidate();
    },
    onError: (err) => {
      showNotice(err instanceof Error ? err.message : "Could not pull that back.");
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
        showNotice("Reddit did not answer. Try again in a few minutes.");
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
      parts.push(res.enrichment.reason);
      if (res.alreadyKnown) parts.push(`${res.alreadyKnown} already on the desk.`);
      if (res.incomplete && res.reason) parts.push(res.reason);
      // A quiet subreddit is a successful read, not a failure — style it as
      // one. Only an actual incomplete/failed read gets the err styling.
      showNotice(parts.join(" "), !res.incomplete);
      setRedditResult(res);
      setRedditAnnounce(`Finished reading r/${res.subreddit}. ${redditResultHeadline(res)}.`);
      invalidate();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Reddit did not answer.";
      showNotice(msg);
      setRedditAnnounce(msg);
    },
  });

  const fileTip = useMutation({
    mutationFn: (post: { url: string; title: string; excerpt: string; updated: string; author: string }) =>
      fileRedditTip({ data: post }),
    onSuccess: (res, post) => {
      if (!res?.ok) return;
      if (res.filed) {
        const markFiled = (p: RedditScanResult["topScores"][number]) =>
          p.url === post.url ? { ...p, state: "filed" as const } : p;
        setRedditResult((prev) =>
          prev
            ? {
                ...prev,
                topScores: prev.topScores.map(markFiled),
                nearMisses: prev.nearMisses.map(markFiled),
              }
            : prev,
        );
        invalidate();
      }
    },
    onError: (err) => {
      showNotice(err instanceof Error ? err.message : "Could not file that tip.");
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
    setRedditAnnounce(`Reading ${redditLabel}. Four feeds, paced about a minute.`);
    const id = setInterval(() => {
      if (redditStartRef.current != null) {
        setRedditElapsed(Math.floor((Date.now() - redditStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [reddit.isPending, redditLabel]);

  const writeBrief = useMutation({
    mutationFn: (id: number) => refreshBrief({ data: { id, modelChoice, modelEffort } }),
    onSuccess: (res) => {
      if (!res?.ok) {
        showNotice(res?.error ? `No brief: ${res.error}` : "No brief written.");
        return;
      }
      // Queued, not written: the brief is a job now, and the file view below
      // polls until it lands. See `startBriefJob` in src/lib/news/dark.ts.
      setBriefWaiting(true);
      showNotice("Writing the brief…", true);
      invalidate();
    },
    onError: (err) =>
      showNotice(err instanceof Error ? err.message : "Could not write the brief."),
  });

  const starting =
    openFromCard.isPending || find.isPending || followLead.isPending;
  const digging = advance.isPending || darkJobActive(detail.data?.darkJob?.status);
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
  }, [openId, digging, starting, advance]);
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
    /*
      No `night` prop: Dark Desk is a page, not a theme. Before 0.6.72 this
      route passed it, which forced `.night` on the shell whatever
      `townreporter.desk.mode` said -- so the "light" capture of this screen
      rendered dark, `data-appearance` disagreed with the page, and the shell
      hid its own appearance toggle (desk-chrome.tsx shows it only when `night`
      is false). The desk's appearance is the editor's, on every desk page.
    */
    <DeskShell title="Dark Desk" kicker="Investigations · nothing here prints on its own" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule. The
        drawing's "+ Start a file" opens the Start-a-Dark-Desk-file dialog, and
        so does this: the dialog owns the question, the tip, the ordinary
        explanation, the Limits dial and the model, and it opens the file. The
        drawing puts no form in the rail: the rail is the index of files, and a
        form at the top of it pushed the first file out of the first screenful.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">Investigations · nothing here prints on its own</p>
          <h1 className="h1">Dark Desk</h1>
        </div>
        <div className="astra-head-acts">
          <button type="button" className="btn solid" onClick={() => setStartOpen(true)}>
            + Start a file
          </button>
        </div>
      </div>
      {/*
        Start a Dark Desk file, as drawn. The dialog opens the file and stops
        there (`editor-dialogs.tsx`); this screen starts the first round from
        `onOpened`, where the activity log and the stop are on screen.

        `seed` is a hand-over from another screen -- an import's review screen,
        a lead's "Send to Dark Desk" -- and is cleared on close so the same file
        is not offered twice.
      */}
      <DarkFileDialog
        open={startOpen}
        seed={seedFromImport || undefined}
        onClose={() => {
          setStartOpen(false);
          setSeedFromImport("");
        }}
        onOpened={(id, run) => {
          // The editor's pick, for the first round: `afterOpen` issues the
          // round in this same tick, before `setModelChoice` can be read.
          const picked = run.modelChoice ? darkModelChoice(run.modelChoice) : null;
          if (picked) {
            firstRoundPick.current = picked;
            setModelChoice(picked);
            setModelEffort(defaultModelEffort(picked));
          }
          afterOpen(id);
        }}
      />
      {/*
        The drawing's grid: a 320px rail of piles on the left, the open file on
        the right (desk-astra.css `.astra-split-deep`). The rail is the desk's
        index -- every file, every unopened signal -- so an editor can switch
        files without leaving the one they are reading. Below 980px the two
        columns stack and the rail becomes the top of the page.
      */}
      <div className="astra-split-deep">
        <div className="astra-piles">
          <div className="astra-pile">
            <div className="astra-pile-h">
              <span>Open files</span>
              <span>{active.length}</span>
            </div>
            <p className="astra-note astra-pile-pad">
              Started. A stop mid-file is normal — it means more to read, not a failure.
            </p>
            {investigations.isError && !investigations.data ? (
              <div className="astra-pile-pad">
                <ScreenError
                  message={
                    investigations.error instanceof Error
                      ? investigations.error.message
                      : "Could not load the desk."
                  }
                  onRetry={() => void investigations.refetch()}
                  retrying={investigations.isRefetching}
                />
              </div>
            ) : investigations.isPending && !active.length ? (
              <div className="astra-pile-pad">
                <ListSkeleton rows={3} />
              </div>
            ) : active.length === 0 ? (
              <p className="meta astra-pile-pad">
                Empty. Paste a tip above, or start digging on a signal.
              </p>
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
          </div>

          <div className="astra-pile">
            <div className="astra-pile-h">
              <span>Signals to review</span>
              <span>{inbox.length}</span>
            </div>
            <p className="astra-note astra-pile-pad">New material. Nobody has opened it yet.</p>
            {worth.isError && !worth.data ? (
              <div className="astra-pile-pad">
                <ScreenError
                  message={
                    worth.error instanceof Error
                      ? worth.error.message
                      : "Could not load new material."
                  }
                  onRetry={() => void worth.refetch()}
                  retrying={worth.isRefetching}
                />
              </div>
            ) : worth.isPending && !inbox.length ? (
              <div className="astra-pile-pad">
                <ListSkeleton rows={3} />
              </div>
            ) : inbox.length === 0 ? (
              <p className="meta astra-pile-pad">
                Nothing new tonight — everything interesting is already on the desk.
              </p>
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
            {reddit.isPending ? (
              <div className="astra-pile-pad">
                <div className="reddit-progress">
                  <p className="worth-t">Reading {redditLabel}</p>
                  <p className="reddit-sub">
                    Four feeds, then up to three full-thread reads through Redlib. Every Reddit
                    request stays 8 seconds apart. Usually about a minute.
                  </p>
                  <div className="busy-rule" aria-hidden />
                  <p className="reddit-elapsed" aria-hidden>
                    {elapsedLabel(redditElapsed)}
                  </p>
                  <p className="sr-only" role="status" aria-live="polite">
                    {redditAnnounce}
                  </p>
                </div>
              </div>
            ) : redditResult ? (
              <div className="astra-pile-pad">
                <RedditResultPanel
                  result={redditResult}
                  announce={redditAnnounce}
                  onDismiss={() => setRedditResult(null)}
                  onFileTip={(post) => fileTip.mutate(post)}
                  filingUrl={fileTip.isPending ? (fileTip.variables?.url ?? null) : null}
                />
              </div>
            ) : (
              <p className="astra-note astra-pile-pad">
                Tips from the subreddit arrive here as unverified cards. They are a reason to go
                looking for the record, never a source to cite.
              </p>
            )}
          </div>

          <div className="astra-pile">
            <div className="astra-pile-h">
              <span>Set aside</span>
              <span>{parked.length}</span>
            </div>
            <p className="astra-note astra-pile-pad">Parked or finished. Pull anything back.</p>
            {parked.length === 0 ? (
              <p className="meta astra-pile-pad">Nothing set aside yet.</p>
            ) : (
              parked.map((row) => (
                <div key={row.id} className="astra-file dim">
                  <button type="button" className="astra-file-open" onClick={() => rememberOpen(row.id)}>
                    <span className="astra-file-t">{row.title || `File ${row.id}`}</span>
                    <span className="astra-file-m">
                      {Number(row.records ?? 0)} records · last touched{" "}
                      {formatShortDate(row.updated_at)}
                    </span>
                  </button>
                  {!looksLikeInternalSummary(row.summary) && row.summary ? (
                    <p className="astra-file-m">{plainEditorText(row.summary)}</p>
                  ) : null}
                  <div className="astra-file-acts">
                    <InkButton
                      disabled={pullBack.isPending}
                      onClick={() => pullBack.mutate(row.id)}
                    >
                      {pullBack.isPending ? "Pulling back…" : "Pull back"}
                    </InkButton>
                    <InkButton tone="quiet" onClick={() => rememberOpen(row.id)}>
                      Read
                    </InkButton>
                  </div>
                </div>
              ))
            )}
            {(runs.data ?? []).length > 0 ? (
              <details className="of-trail runs astra-pile-pad">
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
                    {r.summary ? <p className="side-item">{plainEditorText(r.summary)}</p> : null}
                    <DarkRunMeter run={r} />
                  </div>
                ))}
              </details>
            ) : null}
          </div>

          {/*
            The rail's foot, as drawn: the two desks-wide actions that are not
            about any one file. Pick one for me stays here rather than in the
            signals pile so it is reachable with an empty rail.
          */}
          <div className="astra-piles-foot">
            <div className="astra-pile-acts">
              <InkButton
                tone="quiet"
                disabled={busyStart || digging}
                onClick={() => find.mutate()}
              >
                {find.isPending ? "Starting…" : "Pick one for me"}
              </InkButton>
              <InkButton
                tone="quiet"
                disabled={busyStart || digging || reddit.isPending || !tipSubreddit.data?.subreddit}
                onClick={() => reddit.mutate()}
              >
                {reddit.isPending
                  ? `Reading ${redditLabel}…`
                  : tipSubreddit.data?.subreddit
                    ? `Check ${redditLabel} for signals`
                    : "Reddit unavailable"}
              </InkButton>
            </div>
            {!tipSubreddit.isPending && !tipSubreddit.data?.subreddit ? (
              <p className="note">
                {tipSubreddit.isError
                  ? "Could not read the configured Reddit source."
                  : "Reddit check needs one unambiguous subreddit URL in Sources; no subreddit is guessed from the town name."}{" "}
                <Link to="/desk/sources" className="inline-link">
                  Review Sources
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className="astra-col">
          {notice && openId == null && !redditResult ? (
            <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p>
          ) : null}

          {/*
            No file open: the drawing's right side is a short empty state, not
            the settings that used to fill it. Before 0.6.72 an empty desk
            showed Watched pages and How hard to dig and nothing else, which
            read as a settings page rather than as a desk with no file on it.
            Both panels are still below, so nothing became unreachable.
          */}
          {openId == null ? (
            <div className="astra-panel astra-empty">
              <h2 className="astra-panel-h">No file open</h2>
              <p className="astra-note">
                Pick a file from Open files, open a signal nobody has read yet, or start one of
                your own with <strong>+ Start a file</strong> above.
              </p>
            </div>
          ) : null}

          {openId != null ? (
            <InvestigationWorkspace
              openId={openId}
              detail={detail.data ?? undefined}
              pending={detail.isPending && !detail.data}
              digging={(digging || inv?.status === "investigating") && !stalled}
              keepDisabled={(digging || inv?.status === "investigating") && !stalled}
              stalled={stalled}
              darkJobError={
                detail.data?.darkJob?.status === "failed"
                  ? editorError(detail.data.darkJob.error ?? "") ||
                    detail.data.darkJob.error ||
                    "This research run did not finish."
                  : null
              }
              phase={liveJobStage || cardPhase || liveLine}
              notice={notice}
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
            />
          ) : null}

          <PageWatchPanel files={investigations.data ?? []} onOpenFile={openWatchedFile} />

          {/*
            How hard to dig stays on the page, below the file rather than in a
            settings route: it is a dial an editor turns mid-file, and the
            walk that checks "How hard to dig" is on this screen. It is not in
            the rail -- the rail is 320px and this panel is a form.
          */}
          <DarkDialsPanel
            modelChoice={modelChoice}
            onModelChoice={(choice) => {
              setModelChoice(choice);
              setModelEffort(defaultModelEffort(choice));
            }}
            modelEffort={modelEffort}
            onModelEffort={setModelEffort}
            modelDisabled={digging || busyStart}
          />
        </div>
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
    <div className={"astra-file" + (selected ? " on" : "")}>
      {/*
        The row is the control. The drawing's rail rows are selectors -- a bold
        title and one line of metadata -- so "Open file" / "Viewing above" is no
        longer a button: clicking anywhere on the row opens it, and
        `aria-current` says which file the pane on the right is showing.
      */}
      <button
        type="button"
        className="astra-file-open"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
      >
        <span className="astra-file-t">{row.title || `File ${row.id}`}</span>
        <span className="astra-file-m">
          {editorStatus(row.status)} · {records} record{records === 1 ? "" : "s"} on file
          {still > 0 ? ` · ${still} open follow-up entries` : ""} · last touched{" "}
          {formatShortDate(row.updated_at)}
        </span>
      </button>
      {/*
        Keep digging and Set aside keep the behavior they had on the old card,
        but move under More: the drawing's rail row carries one action, and the
        rail is an index, not a workbench. Neither act is lost -- both are one
        click away, and Keep digging is also on the open file's own Decide
        strip.
      */}
      <div className="astra-file-acts">
        <details className="row-more">
          <summary className="btn quiet">
            More ▾
          </summary>
          <div className="row-more-panel">
            <button
              type="button"
              className="btn quiet"
              disabled={digging || locked}
              onClick={onKeep}
            >
              {digging ? "Reading…" : "Keep digging"}
            </button>
            <button
              type="button"
              className="btn quiet"
              disabled={digging || locked}
              onClick={onPark}
            >
              Set aside
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * A list of scored posts with a "File as tip" action — shared between the
 * filed/above-threshold list and the near-misses list below it, so the two
 * read the same way even though only one of them cleared the civic line.
 */
function RedditTipRows({
  posts,
  onFileTip,
  filingUrl,
}: {
  posts: RedditScanResult["topScores"];
  onFileTip: (post: { url: string; title: string; excerpt: string; updated: string; author: string }) => void;
  filingUrl: string | null;
}) {
  return (
    <div className="tip-list">
      {posts.map((p) => {
        const canFile = p.state !== "filed";
        const filing = filingUrl === p.url;
        return (
          <div key={p.url} className="tip-row">
            <Score v={p.score} />
            <div>
              <a href={p.url} target="_blank" rel="noopener" className="inline-link tip-title">
                {p.title}
              </a>
              <span className="np-meta block">{p.updated ? `Posted ${p.updated.slice(0, 10)}` : "Posted date unknown"}{p.author ? ` · ${p.author}` : ""}{!p.autoFileEligible ? " · older/undated — manual file only" : ""}</span>
              <span className="np-meta block">
                {p.sourceAdapter === "redlib-html" ? "Thread page read via Redlib" : "RSS excerpt read"}
                {p.redditScore !== null && p.redditScore !== undefined ? ` · ${p.redditScore} Reddit points` : ""}
                {p.reportedCommentCount !== null && p.reportedCommentCount !== undefined ? ` · ${p.reportedCommentCount} comments reported` : ""}
                {p.coverage === "partial" ? " · some comments were unavailable" : ""}
              </span>
            </div>
            <span className={"chip st-" + p.state}>{redditPostStateLabel(p.state)}</span>
            {canFile ? (
              <InkButton
                tone="quiet"
                disabled={filing}
                onClick={() => onFileTip({ url: p.url, title: p.title, excerpt: p.excerpt, updated: p.updated, author: p.author })}
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
  );
}

/**
 * Result of a "Check r/longmont" read.
 *
 * Owner report 2026-09-05: the read takes ~60-70s and used to leave a single
 * easy-to-miss line as its only trace. This panel is the honest version of
 * "what actually happened" — every scored post (not only the ones filed),
 * which searches ran this time, the top 5 near-misses shown by default so the
 * owner can see what almost made it, a per-feed log, and a way to file a near
 * miss by hand.
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
  onFileTip: (post: { url: string; title: string; excerpt: string; updated: string; author: string }) => void;
  filingUrl: string | null;
}) {
  return (
    <div className="reddit-result">
      <p className="worth-t">Reddit read finished</p>
      <p className="reddit-headline">{redditResultHeadline(result)}</p>
      <p className="reddit-sub">Automatic filing uses dated posts from the past 30 days. Older or undated results remain available to file by hand.</p>
      <p className="reddit-sub">
        <strong>Full-thread reading:</strong> {result.enrichment.reason}
      </p>
      {result.searched.length > 0 ? (
        <p className="reddit-searched">Searched: {result.searched.join(" · ")}</p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {result.incomplete ? (
        <Notice kind="warn">
          {result.reason || "The read stopped early."}
        </Notice>
      ) : null}
      {result.read > 0 && result.civic === 0 ? (
        <p className="reddit-empty">
          No posts qualified for automatic filing: a civic score of at least 6 and a date within
          the past 30 days are required. You can still file a listed post by hand.
        </p>
      ) : null}
      {result.topScores.length > 0 ? (
        <RedditTipRows posts={result.topScores} onFileTip={onFileTip} filingUrl={filingUrl} />
      ) : null}
      {result.nearMisses.length > 0 ? (
        <div className="reddit-near-misses">
          <p className="worth-t">Near misses — scored 3-5</p>
          <p className="reddit-sub">
            Not civic enough to file automatically, but close. Worth a glance before they scroll off
            the feed.
          </p>
          <RedditTipRows posts={result.nearMisses} onFileTip={onFileTip} filingUrl={filingUrl} />
        </div>
      ) : null}
      <details className="of-trail">
        <summary>
          What was read — {result.log.length} feed{result.log.length === 1 ? "" : "s"}
        </summary>
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
        <InkButton tone="quiet" onClick={onDismiss}>
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
    <div className="astra-file">
      <p className="astra-file-t">{item.title}</p>
      <p className="astra-file-m">
        {item.badge || editorKindLabel(item.kind)} · {item.why}
      </p>
      <div className="astra-file-acts">
        <InkButton disabled={busy} onClick={onStart}>
          {phase.startsWith("Starting") ? "Starting…" : phase ? "Digging…" : "Start digging"}
        </InkButton>
        {/*
          The two lines the card used to print in full -- what changed and the
          first question -- are what makes a signal worth opening, so they stay
          one click away rather than being cut. The rail's row shape is one
          line of metadata; the why is the line that decides whether to look.
        */}
        <details className="row-more">
          <summary className="btn quiet">More ▾</summary>
          <div className="row-more-panel">
            <p className="row-more-h">What changed</p>
            <p>{item.happened}</p>
            <p className="row-more-h">First question</p>
            <p>{item.question}</p>
            {item.source_line ? <p className="meta">{item.source_line}</p> : null}
          </div>
        </details>
      </div>
      {phase ? (
        <p className="astra-file-m" aria-live="polite">
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

const DARK_STOP_COPY: Record<string, string> = {
  "elapsed-time-limit": "Stopped at the total time limit",
  "model-call-limit": "Stopped at the model-call limit",
  "search-limit": "Stopped at the search limit",
  "document-read-limit": "Stopped at the document-read limit",
  "evidence-sufficient": "This run paused after the planner judged the current evidence sufficient; unresolved trails remain saved",
  "diminishing-returns": "This run paused after diminishing returns; it did not reject the remaining leads",
  "repeated-sources": "This run paused after sources began repeating; it did not resolve the hypothesis",
  "no-materially-new-finding": "This run paused after two rounds without a material new finding; unresolved trails remain saved",
  "frontier-exhausted": "This run ended because no productive unresolved lead remained in the active frontier",
  "hop-limit": "Stopped at the hop limit; unresolved leads remain saved",
  "synthesis-failed": "Stopped because synthesis failed; completed research remains saved",
  "provider-failed": "Stopped because the provider failed; completed work remains saved",
  completed: "Completed within the run limits",
};

function DarkRunMeter({ run, active = false }: { run: DarkRunRow; active?: boolean }) {
  const totals = run.usage.totals;
  const startedAt = Date.parse(run.started_at);
  const elapsedMs = active && Number.isFinite(startedAt)
    ? Math.max(totals.elapsedMs, Date.now() - startedAt)
    : totals.elapsedMs;
  const tokens = totals.totalTokens == null ? "tokens not reported for every call" : `${totals.totalTokens.toLocaleString()} tokens`;
  return (
    <div className="of-stop" role={active ? "status" : undefined} aria-live={active ? "polite" : undefined}>
      <p>
        <b>{active ? "Live run:" : "Run usage:"}</b>{" "}
        {totals.modelCalls} model call{totals.modelCalls === 1 ? "" : "s"} · {totals.searches} search{totals.searches === 1 ? "" : "es"} · {totals.documentReads} document read{totals.documentReads === 1 ? "" : "s"} · {elapsedLabel(Math.ceil(elapsedMs / 1000))} · {tokens}
      </p>
      {!active && run.stopReason ? <p className="meta">{DARK_STOP_COPY[run.stopReason] ?? run.stopReason}</p> : null}
      {run.usage.calls.length ? (
        <details className="of-trail">
          <summary>Model calls — {run.usage.calls.length}</summary>
          {run.usage.calls.map((call, index) => (
            <p className="side-item" key={`${call.stage}-${index}`}>
              <b>{call.stage}</b> · {call.provider} · {call.model} · {elapsedLabel(Math.ceil(call.durationMs / 1000))} · {call.result}{call.totalTokens == null ? "" : ` · ${call.totalTokens.toLocaleString()} tokens`}
            </p>
          ))}
        </details>
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
  darkJobError,
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
}: {
  openId: number;
  detail: Awaited<ReturnType<typeof getInvestigation>> | undefined;
  pending: boolean;
  digging: boolean;
  keepDisabled: boolean;
  stalled: boolean;
  darkJobError: string | null;
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
  /*
    The chosen model, read-only here: this component prints it (the file's own
    line, the PDF reader's "Uses …"), while the picker that sets it lives with
    the dials in `DarkDialsPanel`. The effort is not read here at all.
  */
  modelChoice: StoryModelChoice;
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
      extractionMethod: a.extraction_method,
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
  const run = detail?.run ?? null;
  const verifiedSignals = signals.filter((s) => s.verification_status === "verified");
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
  // Deferred means "saved for a later run," not rejected. Keep those leads
  // visible so a frontier cap never looks like the desk threw them away.
  const next = frontier.filter((f) =>
    ["open", "investigating", "reopened", "deferred"].includes(f.status),
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
  const totalOpen = Math.max(Number(inv?.still_open ?? 0), leftover);
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

  /*
    Activity, from the run's own call record. The drawing's left column is a
    clock time; a call has a duration but no timestamp of its own, so the
    column is the elapsed time into the round -- the same fact from the other
    end, and it cannot be wrong. With no run record yet, this round's searches
    carry the log instead.
  */
  const callLog = run?.usage.calls ?? [];
  const activityAll: { when: string; what: string; tone: "find" | "fail" | "plain" }[] = [];
  if (callLog.length) {
    let ms = 0;
    for (const call of callLog) {
      ms += call.durationMs;
      const failed = /fail|error|blocked|refus|timeout|unavailable/i.test(call.result);
      const found = /found|new |result|captur/i.test(call.result);
      activityAll.push({
        when: elapsedLabel(Math.ceil(ms / 1000)),
        what: `${call.stage} — ${call.result}`,
        tone: failed ? "fail" : found ? "find" : "plain",
      });
    }
  } else {
    for (const s of searches.slice(-14)) {
      const outcome = String(s.state ?? "");
      activityAll.push({
        when: `Round ${Math.max(1, Number(s.hop ?? 0) + 1)}`,
        what: `Search — ${searchOutcomeWords(s)}`,
        tone: /FAIL|BLOCKED|TIMEOUT/.test(outcome) ? "fail" : "plain",
      });
    }
  }
  const activityRows = activityAll.slice(-14);

  /*
    How hard the desk is set to dig, for the boundaries strip. Same query key as
    the settings panel below, so this reads that panel's cache instead of asking
    the server a second time.
  */
  const dialsQ = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });
  const dials = dialsQ.data?.dials;
  const scopeLabel = dialsQ.data ? scopeLabelsFor(dialsQ.data.place)[dials?.scope ?? "city"] : null;
  const roundMinutes = dials ? estimateMinutes(dials) : null;
  const statusLine = [
    statusBit,
    readableLabel,
    totalOpen > 0 ? `${totalOpen} unresolved follow-up entries` : null,
    investigationRoundLabel(round, budget),
    inv?.updated_at ? `last touched ${formatShortDate(inv.updated_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      id="investigation-workspace"
      className="astra-col astra-deep-file"
      tabIndex={-1}
      aria-label="Investigation workspace"
    >
      {/*
        The question the file is: the largest voice on the screen, and
        everything below it is evidence about this one line.
      */}
      <div>
        <p className="astra-label">The question</p>
        <h2 className="astra-question">{parentTitle}</h2>
        <p className="astra-note">{statusLine}</p>
      </div>

      {/*
        The drawing puts "the ordinary explanation to rule out first" here. The
        investigations table has no such column (migrations/0006_investigate.sql:
        id, title, status, summary, hops, budget), so the honest line in that
        slot is where the file actually started -- the pasted tip, or the file's
        own saved summary. Nothing is invented to fill the drawn sentence.
      */}
      {started ? <p className="astra-serif">{started}</p> : null}

      {/* Status, in the order it matters: stopped, failed, running, then the rest. */}
      <div className="astra-notices">
        {stalled ? <p className="note err">{stalledRunCopy("dark")}</p> : null}
        {darkJobError ? <p className="note err" role="alert">{darkJobError}</p> : null}
        {digging ? <Busy label={phase || "Searching records…"} /> : null}
        {run ? <DarkRunMeter run={run} active={digging} /> : null}
        {notice && !digging ? <p className={"note" + (noticeOk ? "" : " err")}>{notice}</p> : null}
        {
          /*
            Persistent, not a fleeting toast: this banner stays mounted for as
            long as the queue state it describes is true, independent of the
            transient `notice` line above (which other actions on this file
            clear). An editor who queues a lead and then keeps digging must
            still be able to answer "where did it go?" without hunting --
            especially since a queued lead can later be drafted and drop out of
            the editor's default Queue view (0.6.16).
          */
          queueError != null ? (
            <Notice kind="err">
              Could not send to the queue: {queueError}
            </Notice>
          ) : queuedLead != null ? (
            <Notice kind="ok">
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
        {signals.length > 0 && queuedLead == null ? (
          <p className="of-stop" role="status">
            <b>Lead status:</b>{" "}
            {`${verifiedSignals.length} of ${signals.length} signal${signals.length === 1 ? "" : "s"} completed the research protocol. Incomplete checks remain visible in the file and travel with the lead; they do not block sending it to the working queue.`}
          </p>
        ) : null}
        {pending ? <p className="meta">Getting this ready…</p> : null}
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
      </div>

      {/*
        The boundaries strip, as drawn. Every cell is a real stored value:
        Scope is the saved map scope, Depth is this file's round against its
        budget, Limit is where a round stops at the saved dig settings. The
        dials come from the same ["dark-dials"] query the settings panel below
        reads, so the strip and the panel cannot disagree and nothing is
        fetched twice.
      */}
      <div className="astra-bounds">
        <div className="astra-bound">
          <p className="astra-bound-k">Scope</p>
          <p className="astra-bound-v">{scopeLabel ?? "Not recorded yet"}</p>
        </div>
        <div className="astra-bound">
          <p className="astra-bound-k">Depth</p>
          <p className="astra-bound-v">{investigationRoundLabel(round, budget)}</p>
        </div>
        <div className="astra-bound">
          <p className="astra-bound-k">Limit</p>
          <p className="astra-bound-v">
            Stops at the time, search and model-call limits
            {roundMinutes != null
              ? ` · about ${roundMinutes} minute${roundMinutes === 1 ? "" : "s"} a round`
              : ""}
          </p>
        </div>
      </div>

      {/*
        Activity beside the Case file. The log is built from the run's own call
        record, so it is what the desk actually did and not a summary of it; it
        never prints a raw search string (the wording is the same safe wording
        the search trail uses), so the log cannot leak a query nobody meant to
        publish.
      */}
      <div className="astra-pair">
        <div>
          <div className="astra-case-h">
            <p className="astra-label">Activity</p>
            <p className="astra-note">
              What the desk did, in order. Failures stay on the record.
            </p>
          </div>
          {activityRows.length === 0 ? (
            <p className="astra-note">
              No activity recorded yet. Keep digging starts the first round.
            </p>
          ) : (
            activityRows.map((a, i) => (
              <div key={i} className="astra-log">
                <span className="astra-log-t">{a.when}</span>
                <span
                  className={
                    "astra-log-e" + (a.tone === "fail" ? " fail" : a.tone === "find" ? " find" : "")
                  }
                >
                  {a.what}
                </span>
              </div>
            ))
          )}
        </div>
        <div>
          <div className="astra-case-h">
            <p className="astra-label">Case file</p>
            <p className="astra-note">
              What is established, what is being tested, and what is still unanswered.
            </p>
          </div>
          {/*
            Above the four lists, because the question an editor opens a file
            with -- is there something here, is it worth an hour -- is the one
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
                    <span className="meta evidence-weak">
                      {" "}
                      — pattern-level, not tied to one source
                    </span>
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
          {/*
            The drawing ends this column with "Challenge the case". There is no
            challenge action on this base -- the adversarial work is a round,
            i.e. Keep digging, which already stands in the Decide strip below,
            and the brief card's own refresh rewrites the brief rather than
            challenging it. No button is drawn here that would only re-run
            something under a name that means something else.
          */}
        </div>
      </div>

      {/*
        Decide: the file's verbs, in the drawing's order. "Start an AI
        follow-up" is the drawn primary. Follow-ups are lane 2's screen
        (/desk/follow-ups); there is no add-follow-up component on this base,
        so the drawn primary links there rather than pretending to start one
        in place. Everything else is the same action it was before the
        restyle, with the same label.
      */}
      <div className="astra-panel decide">
        <div className="astra-case-h">
          <p className="astra-label">Decide</p>
          <p className="astra-note">It digs; it never prints.</p>
        </div>
        {/*
          The drawing's Decide is the five verbs and the sentence under them.
          Which model digs is a dial, not a verb, and it lives with the other
          dials in "How hard to dig" below the file -- see the panel's own
          comment. Nothing became unreachable: the state behind it is the same
          one this route has always held, and the picker writes it from there.
        */}
        <div className="astra-panel-acts">
          <InkButton disabled={keepDisabled} onClick={onKeepDigging}>
            {digging ? "Reading…" : "Keep digging"}
          </InkButton>
          <Link to="/desk/follow-ups" className="btn solid">
            Start an AI follow-up
          </Link>
          <InkButton tone="quiet" disabled={keepDisabled || parkPending} onClick={onPark}>
            {parkPending ? "Setting aside…" : "Set aside"}
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
          <InkButton tone="quiet" onClick={onClose}>
            Close file
          </InkButton>
        </div>
        <p className="astra-note">
          Nothing here prints. “Send to the queue” files a lead for you to review.
        </p>
      </div>

      {/*
        The file's own captures and its unresolved trails. The drawing shows a
        file that is already dug; these are the records it was dug from, and
        they stay on the page -- clicking a title opens the captured page, and
        that page is the file.
      */}
      <div>
        <SecHead
          title="What to read"
          count={readableCountBadge}
          sub="Click a title. The captured page opens below — that is the file."
        />
        {artifacts.length > 0 ? (
          <OpenedRecords artifacts={artifacts} modelChoice={modelChoice} />
        ) : digging ? (
          <p className="meta">Opening pages now. They land on the file as they are read…</p>
        ) : (
          <p className="meta">Nothing captured yet. Keep digging starts the first round.</p>
        )}
      </div>

      {nextDeduped.length > 0 ? (
        <div>
          <SecHead
            title="Still to pursue"
            count={nextDeduped.length}
            sub="Open and deferred trails stay visible here. Displayed duplicates are folded in."
          />
          <div className="of-frontier">
            {nextDeduped.slice(0, frN).map((f) => (
              <div key={f.id} className="fr-item">
                <p className="fr-label">{humanFrontierLabel(f.label)}</p>
                {f.status === "deferred" ? (
                  <p className="meta">Saved for a later run; this lead was not rejected.</p>
                ) : null}
                {f.why ? <p className="fr-why">{plainEditorText(f.why)}</p> : null}
                <InkButton
                  tone="quiet"
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
            <InkButton tone="quiet" onClick={() => setFrN((n) => n + 10)}>
              Next 10 — {nextDeduped.length - frN} more
            </InkButton>
          ) : null}
          {totalOpen > nextDeduped.length ? (
            <p className="meta">
              This view shows a limited, deduplicated subset of {totalOpen} open follow-up
              entries. Keep digging works from the full list.
            </p>
          ) : null}
        </div>
      ) : null}

      {signals.length > 0 ? (
        <div>
          <SecHead
            title="Signals"
            count={signals.length}
            sub="Stage one asks the question. Stage two runs the adversarial searches and answers the four gates. Completing all four records protocol completion; the editor still verifies the underlying facts."
          />
          {signals.map((s) => (
            <div key={s.id} className="side-item sig-card">
              <p>
                <b>{s.name}</b> <span className="chip">{s.stageChip}</span>
              </p>
              <p className="meta">{s.stageSentence}</p>
              {s.newsworthiness ? <p className="meta">{s.newsworthiness}</p> : null}
              {s.adversarial.length > 0 ? (
                <details className="of-trail">
                  <summary>
                    Searches this round — {s.adversarial.length} run against this signal
                  </summary>
                  {s.adversarial.map((a, i) => (
                    <SearchTrailEntry key={i} record={a} />
                  ))}
                </details>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <details className="of-trail">
          <summary>Searches this round — {searches.length}</summary>
          {searches.length ? (
            searches.map((s, i) => <SearchTrailEntry key={`${s.hop}-${i}`} record={s} />)
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
    </section>
  );
}

/**
 * Only worth a line when the capture went through OCR (read, or still
 * blocked on it) -- an ordinary html/unpdf/primegov capture's method is not
 * something an editor needs to see on every row.
 */
function ocrStatusLine(method: string | null | undefined): string | null {
  const refusal = captureRefusalLabel(method);
  if (refusal) return refusal;
  const raw = (method ?? "").trim();
  if (!/^(?:ocr(?:-pages(?:-partial)?)?|needs-ocr):/.test(raw)) return null;
  return describeExtractionMethod(raw);
}

function OpenedRecords({
  artifacts,
  modelChoice,
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
    extraction_method?: string | null;
  }[];
  modelChoice: StoryModelChoice;
}) {
  const qc = useQueryClient();
  const { formatShortDate } = usePaperDateFormatters();
  const ordered = artifacts.slice().reverse();
  function previewOf(a: (typeof ordered)[number]) {
    return readableCapture({
      text: a.excerpt ?? "",
      status: a.fetch_status,
      outcome: a.fetch_outcome,
      title: a.title,
      extractionMethod: a.extraction_method,
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
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("1");
  const mustChooseReader = modelChoice === "auto";
  useEffect(() => {
    setPageStart("1");
    setPageEnd("1");
  }, [selected?.id]);
  const pageRead = useQuery({
    queryKey: ["artifact-ocr-job", selected?.id ?? 0],
    queryFn: () => getArtifactOcrJob({ data: selected!.id }),
    enabled: selected != null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
  const requestPageRead = useMutation({
    mutationFn: async (mode: "range" | "complete") => {
      const queued = await queueArtifactOcr({
        data: {
          artifactId: selected!.id,
          start: Number(pageStart),
          end: Number(pageEnd),
          modelChoice,
          mode,
        },
      });
      if (!queued.ok) throw new Error(queued.error);
      return queued;
    },
    onSuccess: () => void pageRead.refetch(),
  });
  useEffect(() => {
    if (pageRead.data?.status !== "completed") return;
    void qc.invalidateQueries({ queryKey: ["artifact", selected?.id ?? 0] });
    void qc.invalidateQueries({ queryKey: ["investigation"] });
  }, [pageRead.data?.status, qc, selected?.id]);

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
        extractionMethod: selected.extraction_method,
      })
    : null;
  const title = selected
    ? cap?.kind === "blocked"
      ? (captureRefusalLabel(selected.extraction_method) ??
        (selected.fetch_status === 429
          ? "Too many requests — not the article"
          : "Capture failed — not the article"))
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
              ? (captureRefusalLabel(a.extraction_method) ??
                (a.fetch_status === 429
                  ? "Too many requests — not the article"
                  : `Capture failed${a.fetch_status ? ` (${a.fetch_status})` : ""} — not the article`))
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
              {ocrStatusLine(a.extraction_method) ? (
                <span className="np-meta">{ocrStatusLine(a.extraction_method)}</span>
              ) : preview.kind === "ok" && preview.body ? (
                <span className="np-meta">{excerptForEditor(preview.body, 140)}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {selected ? (
        <article className="reader-doc">
          <p className="read-kind">
            Reading {idx + 1} of {ordered.length} · {cap?.kind === "blocked" ? "Blocked" : kind}
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
            <button
              type="button"
              className="inline-link"
              disabled={idx <= 0}
              onClick={() => go(-1)}
            >
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
          {body.data?.retained_pdf ? <form
            className="read-acts"
            onSubmit={(event) => {
              event.preventDefault();
              requestPageRead.mutate("range");
            }}
          >
            <label>
              Read PDF pages
              <input
                type="number"
                min="1"
                value={pageStart}
                onChange={(event) => setPageStart(event.target.value)}
                disabled={mustChooseReader || requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
              />
            </label>
            <span>through</span>
            <label>
              <span className="sr-only">Last PDF page</span>
              <input
                type="number"
                min="1"
                value={pageEnd}
                onChange={(event) => setPageEnd(event.target.value)}
                disabled={mustChooseReader || requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
              />
            </label>
            <button type="submit" className="inline-link" disabled={mustChooseReader || requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}>
              {pageRead.data?.status === "queued" || pageRead.data?.status === "running" ? "Reading retained PDF…" : "Read selected pages"}
            </button>
            <button
              type="button"
              className="inline-link"
              disabled={mustChooseReader || requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
              onClick={() => requestPageRead.mutate("complete")}
            >
              Read entire PDF
            </button>
            <span className="np-meta">{mustChooseReader ? "Choose a named model in the Dark Desk picker before sending retained PDF pages." : `Uses ${modelChoiceLabel(modelChoice)} · the entire packet is saved in batches of up to 12 pages · original retained PDF only`}</span>
          </form> : null}
          {requestPageRead.error ? <p className="note err">{requestPageRead.error.message}</p> : null}
          {pageRead.data?.error ? <p className="note err">{pageRead.data.error}</p> : null}
          {pageRead.data?.stage && (pageRead.data.status === "queued" || pageRead.data.status === "running") ? (
            <p className="meta">{pageRead.data.stage}</p>
          ) : null}
          {(() => {
            const result = pageRead.data?.result as
              | { mode?: "range" | "complete"; start?: number; end?: number; provider?: string; reason?: string | null; pages?: { page: number; text: string }[]; pagesRead?: number; pagesTotal?: number; batchesCompleted?: number; batchesTotal?: number; unreadPages?: number[]; modelCalls?: number; budgetPaused?: boolean }
              | undefined;
            if (!result?.pages?.length && !result?.reason && result?.pagesTotal == null) return null;
            return (
              <section className="read-full">
                <p className="meta">
                  {result.mode === "complete"
                    ? `Entire PDF · ${result.pagesRead ?? 0} of ${result.pagesTotal ?? "?"} pages saved${result.batchesTotal ? ` · batch ${result.batchesCompleted ?? 0} of ${result.batchesTotal}` : ""}${result.modelCalls != null ? ` · ${result.modelCalls} model calls` : ""}${result.budgetPaused ? " · paused at run budget" : ""}`
                    : `Requested PDF pages ${result.start}-${result.end}`}
                  {` · ${result.provider ?? modelChoiceLabel(modelChoice)}`}
                </p>
                {result.pages?.map((page) => <p key={page.page}><strong>Page {page.page}</strong><br />{page.text}</p>)}
                {result.reason ? <p className="meta">{result.reason}</p> : null}
                {result.unreadPages?.length ? <p className="note err">Still unread: {result.unreadPages.slice(0, 16).join(", ")}{result.unreadPages.length > 16 ? `, and ${result.unreadPages.length - 16} more` : ""}. Run Read entire PDF again to retry only these pages.</p> : null}
              </section>
            );
          })()}
          {selected.url.startsWith("http") ? <p className="read-url">{selected.url}</p> : null}
          {ocrStatusLine(selected.extraction_method) ? (
            <p className="meta">{ocrStatusLine(selected.extraction_method)}</p>
          ) : null}
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
