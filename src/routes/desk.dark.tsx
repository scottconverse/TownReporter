import { newestTouchedFile, fullFileQuestion } from "@/lib/news/dark-rail";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Busy, DeskShell, InkButton, Score, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import {
  continueInvestigation,
  challengeInvestigation,
  fileRedditTip,
  getInvestigation,
  getArtifact,
  getArtifactOcrJob,
  listInvestigations,
  listWorthALook,
  openDarkInvestigation,
  parkInvestigation,
  queueInvestigation,
  queuePacket,
  closeInvestigation,
  queueArtifactOcr,
  refreshBrief,
  reopenParkedInvestigation,
  retryDarkRound,
  scanTipSubreddit,
  getTipSubreddit,
  investigationActivity,
  type InvestigationQueuePacket,
  type InvestigationRow,
} from "@/lib/news/dark";
import { cancelStoryJob } from "@/lib/news/job-progress";
import type { JobProgressView } from "@/lib/news/job-progress";
import { invalidateDeskJobs, useDeskJobs } from "@/components/job-card-state";
import { DeskJobCard, JobCard } from "@/components/JobCard";
import { usePaperSetupGate } from "@/components/paper-setup-gate";
import { PaperSetupGateNote } from "@/components/PaperSetupGateNote";
import {
  blockedDigBannerText,
  editorError,
  editorPauseIsPageFailure,
  editorPauseReason,
  editorKindLabel,
  elapsedLabel,
  excerptForEditor,
  headlineFromUrl,
  humanFrontierLabel,
  darkJobActive,
  observedDarkJobFinished,
  organizationFromUrl,
  editorTitle,
  investigationPileFor,
  plainEditorText,
  plainFinding,
  progressLine,
  DIG_STOP_ACK,
  digStopControl,
  recordKindFromUrl,
  redditFeedLabel,
  redditFeedStatusLabel,
  redditPostStateLabel,
  redditResultHeadline,
  sentenceCase,
  stalledRunCopy,
  worthItemOnDeskReason,
} from "@/lib/news/desk-copy";

type RedditScanResult = Awaited<ReturnType<typeof scanTipSubreddit>>;
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DarkDialsPanel } from "@/components/dark-dials-panel";
import { ModelPicker } from "@/components/model-picker";
import { useFirstRunPickerDefault, useFirstRunPickerSeed } from "@/components/first-run-picker-default";
import { scopeLabelsFor, type DarkScope } from "@/lib/news/dark-dials";
import { DARK_LIMITS } from "@/lib/news/editor-dialog-logic";
import { getDarkDials } from "@/lib/news/dark";
import { InvestigationBriefCard, SectionTldr } from "@/components/investigation-brief";
import { SearchTrailEntry } from "@/components/search-trail-entry";
import { dedupeFactLines, factLinesDropped } from "@/lib/news/dark-fact-lines";
import { captureBatchStats, readableCapture, captureRefusalLabel } from "@/lib/news/html-text";
import { describeExtractionMethod } from "@/lib/news/extraction-label";
import { DARK_OPEN_KEY, takeDarkFilePrefill, takeDarkSeed } from "@/lib/news/dark-seed";
import type { WorthSeed } from "@/lib/news/worth-a-look";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { looksLikeProviderAuthFailure } from "@/lib/news/preflight";
import { DarkFileDialog } from "@/components/dialogs/editor-dialogs";
import { PageWatchPanel } from "@/components/page-watch-panel";
import { Dialog } from "@/components/dialog";
import { FollowUpDialog, type FollowUpDialogInput } from "@/components/follow-up-dialog";
import { createAiFollowUp, listFollowUpStoryOptions } from "@/lib/news/desk";
import { checkPageWatch, createPageWatch } from "@/lib/news/page-watch-actions";
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

function darkDeskReadFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid byte sequence for encoding|empty body|unreadable|no readable text/i.test(raw)) {
    return "The page had no readable text";
  }
  if (/\b(?:401|403)\b|blocked|refused/i.test(raw)) return "The site refused the request";
  if (/\b5\d\d\b|server error|internal server error|sqlstate|database/i.test(raw)) {
    return "The page could not be read";
  }
  if (/failed to fetch|network|timeout|econnrefused|econnreset|socket hang up/i.test(raw)) {
    return "The server could not be reached";
  }
  return "The investigation list could not be read.";
}

function DarkPage() {
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
  const [startPrefill, setStartPrefill] = useState<{ question?: string; tip?: string; explanation?: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedPiles, setExpandedPiles] = useState<Record<string, boolean>>({});
  const togglePile = (key: string) => setExpandedPiles((prev) => ({ ...prev, [key]: !prev[key] }));
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(false);
  const [noticeFor, setNoticeFor] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const requestedOpenId = useRef<number | null>(null);
  const [fileFocusRequest, setFileFocusRequest] = useState<{ id: number } | null>(null);
  const [queued, setQueued] = useState<{
    leadId: number;
    invId: number;
    alreadyQueued: boolean;
  } | null>(null);
  const [queueError, setQueueError] = useState<{ invId: number; message: string } | null>(null);
  const [undoDisposition, setUndoDisposition] = useState<{ id: number; expiresAt: number } | null>(null);
  const [cardPhase, setCardPhase] = useState<string>("");
  const [claimedIds, setClaimedIds] = useState<string[]>([]);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSignalId = useRef<string | null>(null);
  const wasInvestigating = useRef(false);
  const [redditResult, setRedditResult] = useState<RedditScanResult | null>(null);
  const [redditElapsed, setRedditElapsed] = useState(0);
  const [redditAnnounce, setRedditAnnounce] = useState("");
  const redditStartRef = useRef<number | null>(null);

  useEffect(() => {
    const timerRef = phaseTimer;
    try {
      const raw = sessionStorage.getItem(DARK_OPEN_KEY);
      const requested = raw ? Number(raw) : null;
      if (requested != null && Number.isInteger(requested) && requested > 0) {
        requestedOpenId.current = requested;
        setOpenId(requested);
      }
      sessionStorage.removeItem(DARK_OPEN_KEY);
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
      } else {
        const prefill = takeDarkFilePrefill(sessionStorage);
        if (prefill) {
          setStartPrefill(prefill);
          setStartOpen(true);
        }
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!undoDisposition) return;
    const delay = Math.max(0, undoDisposition.expiresAt - Date.now());
    const timer = setTimeout(() => setUndoDisposition(null), delay);
    return () => clearTimeout(timer);
  }, [undoDisposition]);

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
  function showNotice(text: string | null, ok = false, investigationId = openId) {
    setNotice(text);
    setNoticeOk(ok);
    setNoticeFor(investigationId);
  }

  function rememberOpen(id: number) {
    setFileFocusRequest(null);
    setNotice(null);
    setNoticeFor(null);
    setOpenId(id);
    try {
      sessionStorage.removeItem(DARK_OPEN_KEY);
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
  const darkSettings = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });
  const noFiles = Boolean(
    investigations.data?.length === 0 && !investigations.isPending && !investigations.isError,
  );
  // Open the most recently touched file once, when the list first arrives.
  const autoOpened = useRef(false);
  useEffect(() => {
    const rows = investigations.data;
    if (autoOpened.current || !rows?.length) return;
    autoOpened.current = true;
    setOpenId((current) => {
      if (current != null && rows.some((row) => row.id === current)) return current;
      const handedOff = rows.find((row) => row.id === requestedOpenId.current);
      return handedOff?.id ?? newestTouchedFile(rows)?.id ?? null;
    });
  }, [investigations.data]);

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
  const [fileModelChoice, setFileModelChoice] = useState<StoryModelChoice>("auto");
  const [fileModelEffort, setFileModelEffort] = useState<ModelEffort | null>(null);
  const ocrModelChoice = useFirstRunPickerDefault("ocr") ?? "auto";
  const ocrModelEffort = defaultModelEffort(ocrModelChoice);
  const darkDefaultModel = useFirstRunPickerDefault("dark");
  const modelChoiceTouched = useRef(false);
  useFirstRunPickerSeed({
    surface: "dark",
    current: modelChoice,
    touched: () => modelChoiceTouched.current,
    apply: (choice) => {
      setModelChoice(choice);
      setModelEffort(defaultModelEffort(choice));
    },
  });
  const pickedFor = useRef<number | null>(null);
  const fileModelTouchedFor = useRef<number | null>(null);
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
      const cj = q.state.data?.challengeJob;
      if (cj && (cj.status === "queued" || cj.status === "running")) return 2000;
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
    if (fileModelTouchedFor.current === openId) {
      pickedFor.current = openId;
      return;
    }
    if (last == null && darkDefaultModel == null) return;
    pickedFor.current = openId;
    const remembered = darkModelChoice(last ?? darkDefaultModel);
    setFileModelChoice(remembered);
    setFileModelEffort(last == null
      ? defaultModelEffort(remembered)
      : validatedModelEffort(remembered, detail.data.run?.model_effort));
  }, [openId, detail.data, darkDefaultModel]);

  /** A queued brief has landed (or failed); say so once and stop polling. */
  useEffect(() => {
    const bj = detail.data?.briefJob;
    if (!briefWaiting || !bj) return;
    if (bj.status === "queued" || bj.status === "running") return;
    setBriefWaiting(false);
    showNotice(
      bj.status === "completed"
        ? "The brief is written."
        : `No brief: ${editorError(bj.error ?? "") || "the job did not finish."}`,
      bj.status === "completed",
    );
  }, [detail.data?.briefJob, briefWaiting]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
    if (openId != null) void qc.invalidateQueries({ queryKey: ["investigation", openId] });
    /*
      FB1: every press on this screen that starts a job -- Keep digging, Start
      digging, Follow this lead, Write the brief, Read selected pages -- funnels
      its refresh through here, so the Dark Desk's card appears at once instead
      of on the next idle poll. Before this the screen had no card at all.
    */
    invalidateDeskJobs(qc);
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
    // Unit DD1, item 3: the run this editor asked to stop has actually ended,
    // so the desk stops saying "Stopping…" -- this is the only place it clears.
    setStopRequestedFor((asked) => (job && asked === job.id ? null : asked));
    clearPhase();
    void qc.invalidateQueries({ queryKey: ["worth-a-look"] });
    void qc.invalidateQueries({ queryKey: ["investigations"] });
    void qc.invalidateQueries({ queryKey: ["dark-runs"] });
  }, [openId, detailInvestigationId, currentDarkJob, qc]);

  /*
    The model and effort the Start-a-file dialog was set to, for the first round
    only.

    The dialog hands its pick back with the new id, and the round it starts is
    issued in the same tick -- one render before `setModelChoice` could take
    effect, so reading the state there would dig with the previous file's
    model. Holding the pick in a ref and consuming it here is what makes the
    dialog's pick the model that actually runs; later rounds ("Keep digging",
    the picker under the file) read the state as before.

    Unit CY item 9: the ref carries the effort too. The dialog now draws the
    Effort select the reference draws (`Desk Dialogs.dc.html:89-93`), and an
    effort the editor turned that is then thrown away here would be the same
    lie as a model pick thrown away -- the row they saw would not be the row
    that ran. An untouched effort arrives as null and resolves to the surface
    default, which is what this round ran at before the select existed.
  */
  const firstRoundPick = useRef<{ choice: StoryModelChoice; effort: ModelEffort | null } | null>(null);
  /*
    Unit U25, B4: stop a running dig.

    `cancelStoryJob` is the same server function the follow-ups' Cancel uses --
    it checks that the job is in this newsroom and does not look at the kind,
    so a `dark` job needs no new route. The flag is a request: the worker reads
    it at its next boundary, which is why the copy says "at its next step"
    rather than claiming the run has stopped. The poll below picks the change
    up, so nothing else has to be invalidated by hand.
  */
  /*
    Unit DD1, item 3: which running job this editor has already asked to stop.

    `stop.isPending` is true only while the request is travelling, so on its own
    it turned the button back into "Stop this dig" about a second into a stop
    that takes a minute and a half -- the walkthrough of 2026-09-30 measured
    102 s of the desk saying nothing. This is cleared when the observed job
    actually ends (see the effect below), which is the only honest point at
    which "Stopping…" stops being true.
  */
  const [stopRequestedFor, setStopRequestedFor] = useState<number | null>(null);
  const stop = useMutation({
    mutationFn: (jobId: number) => cancelStoryJob({ data: { jobId } }),
    onSuccess: () => {
      showNotice(DIG_STOP_ACK, true);
      invalidate();
    },
    onError: (err) => {
      const msg =
        editorError(err instanceof Error ? err.message : "Could not stop the run") ||
        "Could not stop the run";
      // The press did not land, so the desk must stop claiming it did.
      setStopRequestedFor(null);
      showNotice(msg, false);
    },
  });
  const advance = useMutation({
    mutationFn: (id: number) => {
      const picked = firstRoundPick.current;
      firstRoundPick.current = null;
      return continueInvestigation({
        data: picked
          ? { id, modelChoice: picked.choice, modelEffort: picked.effort }
          : { id, modelChoice: fileModelChoice, modelEffort: fileModelEffort },
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
        const msg = isPreflightRefusal ? raw : editorError(raw) || "This round did not finish.";
        showNotice(msg, false);
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
      clearPhase();
      invalidate();
    },
  });

  function afterOpen(id: number, cardId?: string) {
    // This file was created with the picker value already on screen. Bind it
    // before the first open-state payload can hydrate Automatic and lock the
    // new id while the async job is still being committed.
    pickedFor.current = id;
    if (cardId) claimCard(cardId);
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
  }

  const toQueue = useMutation({
    mutationFn: ({ id, preview }: { id: number; preview: InvestigationQueuePacket }) => queueInvestigation({ data: { id, preview } }),
    onMutate: ({ id }) => {
      // Clear any stale error/confirmation from a previous attempt on this
      // file so a retry does not show two contradictory banners at once.
      setQueueError((prev) => (prev?.invId === id ? null : prev));
    },
    onSuccess: (res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      if (res?.ok) {
        setQueueError(null);
        setQueued({ leadId: res.leadId, invId: id, alreadyQueued: Boolean(res.alreadyQueued) });
        setUndoDisposition({ id, expiresAt: Date.now() + 10_000 });
      } else {
        setQueueError({ invId: id, message: editorError(res?.error ?? "") || "Could not send to the queue." });
      }
    },
    onError: (err, { id }) => {
      setQueueError({
        invId: id,
        message: editorError(err instanceof Error ? err.message : "") || "Could not send to the queue.",
      });
    },
  });

  const followLead = useMutation({
    mutationFn: (seed: { paste: string; title: string }) => openDarkInvestigation({ data: seed }),
    onMutate: () => {
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

  const challengeCase = useMutation({
    mutationFn: (id: number) => challengeInvestigation({ data: { id, modelChoice: fileModelChoice, modelEffort: fileModelEffort } }),
    onSuccess: (result, id) => {
      if (openId !== id) return;
      if (!result.ok) {
        showNotice(editorError(result.error ?? "") || "Could not challenge this case.", false, id);
        return;
      }
      showNotice("Challenging the case…", true, id);
      invalidate();
    },
    onError: (error, id) => {
      if (openId === id) showNotice(editorError(error instanceof Error ? error.message : "") || "Could not challenge this case.", false, id);
    },
  });

  const closeWithoutFinding = useMutation({
    mutationFn: (input: { id: number; note: string }) => closeInvestigation({ data: input }),
    onSuccess: (result, input) => {
      if (!result.ok) {
        showNotice(editorError(result.error ?? "") || "Could not close this file.");
        return;
      }
      setUndoDisposition({ id: input.id, expiresAt: Date.now() + 10_000 });
      showNotice("Closed with no finding. The file stays readable.", true);
      invalidate();
    },
    onError: (error) => showNotice(editorError(error instanceof Error ? error.message : "") || "Could not close this file."),
  });

  const park = useMutation({
    mutationFn: (id: number) => parkInvestigation({ data: id }),
    onSuccess: (_result, id) => {
      rememberOpen(id);
      setUndoDisposition({ id, expiresAt: Date.now() + 10_000 });
      showNotice("Set aside. Pull it back from that pile anytime.", true);
      invalidate();
    },
    onError: (err) => {
      showNotice(editorError(err instanceof Error ? err.message : "") || "Could not set that aside.");
    },
  });

  const pullBack = useMutation({
    mutationFn: (id: number) => reopenParkedInvestigation({ data: id }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        rememberOpen(res.investigationId);
        setUndoDisposition(null);
        setNotice(null);
      } else {
        showNotice("Could not pull that back.");
      }
      invalidate();
    },
    onError: (err) => {
      showNotice(editorError(err instanceof Error ? err.message : "") || "Could not pull that back.");
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
  // SG1 / Option A: every press on this screen that starts a Dark Desk run.
  const paperGate = usePaperSetupGate("start a Dark Desk run");
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
      const msg = editorError(err instanceof Error ? err.message : "") || "Reddit did not answer.";
      showNotice(msg);
      setRedditAnnounce(msg);
    },
  });

  const fileTip = useMutation({
    mutationFn: (post: { url: string; title: string; excerpt: string; updated: string; author: string }) =>
      fileRedditTip({ data: post }),
    onSuccess: (res, post) => {
      /*
        FB7, item 1: the `catch {}`-free rule, applied to the one press on this
        screen that answered a refusal with a bare `return`.

        `fileRedditTipFor` answers `{ok:true, filed:false}` when the tip is
        already on the desk -- the honest answer to a second press, and the
        shape the old code took as "nothing to do, say nothing". So the editor
        pressed File as tip on a tip that was already filed and the desk did
        absolutely nothing: no chip, no toast, no change. It says so now, in
        the ok tone, because a refusal to duplicate is not a failure.
      */
      if (!res?.ok) {
        showNotice("Could not file that tip.");
        return;
      }
      if (!res.filed) {
        showNotice("That tip is already on the Dark Desk — nothing was filed twice.", true);
        return;
      }
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
    },
    onError: (err) => {
      showNotice(editorError(err instanceof Error ? err.message : "") || "Could not file that tip.");
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
        showNotice(res?.error ? `No brief: ${editorError(res.error) || "the request did not finish."}` : "No brief written.");
        return;
      }
      // Queued, not written: the brief is a job now, and the file view below
      // polls until it lands. See `startBriefJob` in src/lib/news/dark.ts.
      setBriefWaiting(true);
      showNotice("Writing the brief…", true);
      invalidate();
    },
    onError: (err) =>
      showNotice(editorError(err instanceof Error ? err.message : "") || "Could not write the brief."),
  });

  const starting = followLead.isPending;
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
  /**
   * Is a dig actually in flight for the open file? The one expression the
   * workspace's busy state and the Stop control are both drawn from, so the
   * button cannot offer to stop a run the page has already given up on.
   */
  const digRunning = (digging || inv?.status === "investigating") && !stalled;
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
    // Unit DD1, item 6: the whole file's captures, not the page's sixty rows,
    // so the line the live run writes agrees with the two counters beside it.
    artifacts: detail.data?.captureCounts?.captures ?? 0,
    searches: detail.data?.searches.length ?? 0,
    claims: detail.data?.claims.length ?? 0,
  });
  const allInv = investigations.data ?? [];
  const active = allInv.filter((row) => investigationPileFor(row) === "desk");
  const waitingFiles = allInv.filter((row) => investigationPileFor(row) === "waiting");
  const parked = allInv.filter((row) => investigationPileFor(row) === "aside");
  const hasEverStartedFollowUp = allInv.some((row) =>
    row.has_ai_followup || row.waiting_follow_up || row.found_follow_up,
  );
  /*
    FB7, item 5 (A2c C6). "An r/longmont tip card still disappears unopened
    ... with 'SET ASIDE 0' throughout."

    The card was drawn here and then was not, because `worthItemOnDesk` hides
    any card whose title fuzzily matches an investigation's -- and the screen
    said nothing about it. The counter the editor checked counts PARKED FILES,
    which is a different thing, so the card simply left with no trace.

    Cards already attached to a file or claimed for a follow-up do not appear
    in this review group. Every remaining card opens the start-a-file dialog.
  */
  const worthRows = (worth.data ?? []).map((item) => ({
    item,
    off: worthItemOnDeskReason(item, allInv, claimedIds),
  }));
  const inbox = worthRows.filter((row) => !row.off).map((row) => row.item);
  const investigationListFailed = investigations.isError && !investigations.data;
  const detailReadFailed = openId != null && detail.isError && !detail.data;
  const darkDeskReadError = investigationListFailed
    ? investigations.error
    : detailReadFailed
      ? detail.error
      : null;
  const loadingFile = !noFiles && !darkDeskReadError && (
    (investigations.isPending && !investigations.data) ||
    (openId != null && detail.isPending && !detail.data) ||
    (Boolean(investigations.data?.length) && openId == null)
  );
  const retryDarkDeskRead = () => {
    if (investigationListFailed) void investigations.refetch();
    else void detail.refetch();
  };

  function chooseSignal(item: WorthSeed) {
    pendingSignalId.current = item.id;
    setStartPrefill({ tip: item.seed });
    setStartOpen(true);
  }

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
          <button type="button" className="btn quiet" aria-expanded={settingsOpen} aria-controls="dark-settings" onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button>
          {/* SG1 / Option A: starting a file is the start of a Dark Desk run,
              which searches and spends. Disabled, with the reason in text,
              until the paper is set up. */}
          <button
            type="button"
            className="btn solid"
            disabled={paperGate.blocked}
            onClick={() => {
              setStartPrefill(undefined);
              setStartOpen(true);
            }}
          >
            + Start a file
          </button>
          <PaperSetupGateNote gate={paperGate} />
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
        defaultLimit={darkSettings.data?.defaultLimitKey ?? "standard"}
        defaultModel={modelChoiceTouched.current ? modelChoice : darkDefaultModel ?? modelChoice}
        defaultEffort={modelChoiceTouched.current ? modelEffort : defaultModelEffort(darkDefaultModel ?? modelChoice)}
        seed={seedFromImport || undefined}
        prefill={startPrefill}
        onClose={() => {
          setStartOpen(false);
          setSeedFromImport("");
          setStartPrefill(undefined);
          pendingSignalId.current = null;
        }}
        onOpened={(id, run) => {
          // The editor's pick, for the first round: `afterOpen` issues the
          // round in this same tick, before `setModelChoice` can be read.
          const picked = run.modelChoice ? darkModelChoice(run.modelChoice) : null;
          if (picked) {
            /*
              Unit CY item 9: the dialog's Effort wins when it was touched, and
              the model's own default stands in when it was not -- the same
              resolution `DarkDialsPanel` uses a few hundred lines down
              (`onModelChoice` -> `defaultModelEffort`), so the panel and the
              round agree on what is running.
            */
            const effort = validatedModelEffort(picked, run.modelEffort) ?? defaultModelEffort(picked);
            firstRoundPick.current = { choice: picked, effort };
            fileModelTouchedFor.current = id;
            setFileModelChoice(picked);
            setFileModelEffort(effort);
          } else {
            const choice = darkDefaultModel ?? modelChoice;
            fileModelTouchedFor.current = id;
            setFileModelChoice(choice);
            setFileModelEffort(defaultModelEffort(choice));
          }
          const signalId = pendingSignalId.current;
          pendingSignalId.current = null;
          afterOpen(id, signalId ?? undefined);
        }}
      />
      {/*
        The drawing's grid: a 320px rail of piles on the left, the open file on
        the right (desk-astra.css `.astra-split-deep`). The rail is the desk's
        index -- every file, every unopened signal -- so an editor can switch
        files without leaving the one they are reading. The columns sit beside
        each other when this content area reaches 900px; narrower areas stack.
      */}
      <div className="astra-deep-container">
      <section id="dark-settings" className="astra-settings-panel" hidden={!settingsOpen} aria-labelledby="dark-settings-title">
        <div className="astra-settings-head">
          <h2 id="dark-settings-title">Dark Desk settings</h2>
          <button type="button" className="btn quiet" onClick={() => setSettingsOpen(false)}>Close</button>
        </div>
        <div className="astra-settings-body">
          <DarkDialsPanel
            modelChoice={modelChoice}
            onModelChoice={(choice) => {
              modelChoiceTouched.current = true;
              setModelChoice(choice);
              setModelEffort(defaultModelEffort(choice));
            }}
            modelEffort={modelEffort}
            onModelEffort={setModelEffort}
            modelDisabled={digging || busyStart}
          />
          <PageWatchPanel files={investigations.data ?? []} onOpenFile={openWatchedFile} modelDefault={darkDefaultModel ?? undefined} />
        </div>
      </section>
      <div className={"astra-split-deep" + (noFiles ? " astra-empty-desk" : "")}>
        <div className="astra-piles" hidden={noFiles}>
          <div className="astra-pile" hidden={!active.length && !investigations.isPending && !investigations.isError}>
            <div className="astra-pile-h">
              <span>Open files</span>
              <span>{investigations.data ? active.length : ""}</span>
            </div>
            {investigations.isError && !investigations.data ? (
              <div className="astra-pile-pad">
                <ScreenError
                  message={
                    darkDeskReadFailureReason(investigations.error)
                  }
                  onRetry={() => void investigations.refetch()}
                  retrying={investigations.isRefetching}
                />
              </div>
            ) : investigations.isPending && !active.length ? (
              <div className="astra-pile-pad">
                <ListSkeleton rows={3} />
              </div>
            ) : active.length > 0 ? (
              (expandedPiles.open ? active : active.slice(0, 5)).map((row) => (
              <DeskFileCard
                key={row.id}
                row={row}
                selected={row.id === openId}
                onOpen={() => rememberOpen(row.id)}
              />
            ))
            ) : null}
            <PileShowAll count={active.length} expanded={Boolean(expandedPiles.open)} onToggle={() => togglePile("open")} />
          </div>

          <div className="astra-pile" hidden={!inbox.length && !worth.isPending && !worth.isError}>
            <div className="astra-pile-h">
              <span>Signals to review</span>
              <span>{inbox.length}</span>
            </div>
            {worth.isError && !worth.data ? (
              <div className="astra-pile-pad">
                <ScreenError
                  message={
                    worth.error instanceof Error
                      ? editorError(worth.error.message) || "Could not load new material."
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
            ) : inbox.length > 0 ? (
              (expandedPiles.signals ? inbox : inbox.slice(0, 5)).map((item) => (
                <WorthSelector
                  key={item.id}
                  item={item}
                  onOpen={() => chooseSignal(item)}
                />
              ))
            ) : null}
            <PileShowAll count={inbox.length} expanded={Boolean(expandedPiles.signals)} onToggle={() => togglePile("signals")} />
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
            ) : null}
          </div>

          {waitingFiles.length || hasEverStartedFollowUp ? (
            <div className="astra-pile">
              <div className="astra-pile-h"><span>Waiting on an AI follow-up</span><span>{waitingFiles.length}</span></div>
              {waitingFiles.length ? (expandedPiles.waiting ? waitingFiles : waitingFiles.slice(0, 5)).map((row) => (
                <DeskFileCard key={row.id} row={row} selected={row.id === openId} onOpen={() => rememberOpen(row.id)} />
              )) : <p className="meta astra-pile-pad">Nothing waiting on AI.</p>}
              <PileShowAll count={waitingFiles.length} expanded={Boolean(expandedPiles.waiting)} onToggle={() => togglePile("waiting")} />
            </div>
          ) : null}

          {parked.length ? (
            <div className="astra-pile astra-pile-aside">
              <div className="astra-pile-h"><span>Set aside</span><span>{parked.length}</span></div>
              {(expandedPiles.aside ? parked : parked.slice(0, 5)).map((row) => (
                <SetAsideRow key={row.id} row={row} selected={row.id === openId} onOpen={() => rememberOpen(row.id)} />
              ))}
              <PileShowAll count={parked.length} expanded={Boolean(expandedPiles.aside)} onToggle={() => togglePile("aside")} />
            </div>
          ) : null}

          {/* The rail's foot holds the one desks-wide action: check the subreddit for signals. */}
          <div className="astra-piles-foot">
            <div className="astra-pile-acts">
              <InkButton
                tone="quiet"
                disabled={
                  busyStart ||
                  digging ||
                  reddit.isPending ||
                  paperGate.blocked ||
                  !tipSubreddit.data?.subreddit
                }
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
              <p className="note" role={tipSubreddit.isError ? "alert" : "status"}>
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
          {/*
            FB7, item 1. Every notice on this screen was `<p className="note">`
            with no role at all (FB0-REPORT.md Table B, Dark Desk: "no role
            anywhere") -- so the screen that answers most of this desk's presses
            answered a screen reader with silence. `alert` for a failure,
            `status` for an outcome: a polite region queues behind whatever is
            being read and a failure is the sentence that should not wait.
          */}
          {notice && openId == null && !redditResult ? (
            <p className={"note" + (noticeOk ? "" : " err")} role={noticeOk ? "status" : "alert"}>
              {notice}{undoDisposition ? <InkButton small tone="quiet" onClick={() => pullBack.mutate(undoDisposition.id)}>Undo</InkButton> : null}
            </p>
          ) : null}

          {darkDeskReadError ? (
            <section className="astra-panel" role="alert" aria-labelledby="dark-desk-read-error">
              <h2 id="dark-desk-read-error" className="astra-panel-h">Could not load Dark Desk</h2>
              <p className="astra-note">{darkDeskReadFailureReason(darkDeskReadError)}</p>
              <div className="astra-panel-acts">
                <Link to="/desk/ops" className="inline-link">Open Server health</Link>
                <InkButton tone="quiet" onClick={retryDarkDeskRead}>
                  {investigations.isRefetching || detail.isRefetching ? "Trying again…" : "Try again"}
                </InkButton>
              </div>
            </section>
          ) : loadingFile ? (
            <p className="astra-panel astra-note" role="status" aria-busy="true">Loading the file…</p>
          ) : null}

          {/* The no-files state follows the state table and hides the rail. */}
          {noFiles ? (
            <section className="astra-panel astra-empty" aria-label="No investigations">
              <h2 className="astra-panel-h">No investigations yet</h2>
              <p className="astra-note">Start a file with a question, or check a public page for signals.</p>
              <div className="astra-panel-acts">
                <button
                  type="button"
                  className="btn solid"
                  disabled={paperGate.blocked}
                  onClick={() => {
                    setStartPrefill(undefined);
                    setStartOpen(true);
                  }}
                >
                  + Start a file
                </button>
                <InkButton
                  tone="quiet"
                  disabled={reddit.isPending || !tipSubreddit.data?.subreddit}
                  onClick={() => reddit.mutate()}
                >
                  {reddit.isPending
                    ? `Reading ${redditLabel}…`
                    : tipSubreddit.data?.subreddit
                      ? `Check ${redditLabel} for signals`
                      : "Reddit unavailable"}
                </InkButton>
              </div>
            </section>
          ) : null}

          {openId != null && !noFiles && detail.data?.investigation.id === openId ? (
            <InvestigationWorkspace
              key={openId}
              openId={openId}
              onOpenFile={() => rememberOpen(openId)}
              detail={detail.data ?? undefined}
              canUndoDisposition={undoDisposition?.id === openId}
              pending={detail.isPending && !detail.data}
              digging={digRunning}
              keepDisabled={digRunning || !detail.data || detail.data.investigation.id !== openId}
              stalled={stalled}
              darkJobError={
                detail.data?.darkJob?.status === "failed"
                  ? editorError(detail.data.darkJob.error ?? "") ||
                    "This round did not finish."
                  : null
              }
              phase={liveJobStage || cardPhase || liveLine}
              notice={noticeFor === openId ? notice : null}
              noticeOk={noticeOk}
              queuedLead={queued?.invId === openId ? queued.leadId : null}
              queuePending={toQueue.isPending}
              queueError={queueError?.invId === openId ? queueError.message : null}
              followPending={followLead.isPending}
              parkPending={park.isPending}
              // Unit U25, B4: the editor's way out of a running dig. Same
              // job-cancel the follow-ups use (see `cancelStoryJob`, which
              // checks newsroom ownership and not kind), so the queue and the
              // worker agree about what "stopped" means.
              //
              // Unit DD1, item 3: the state is derived from the press AND the
              // job, not from the request alone -- see `digStopControl`.
              stopControl={digStopControl({
                // The same `digRunning` the workspace is drawn with: a stalled
                // run has no worker left to read the flag, so it offers no
                // Stop button and cannot sit on "Stopping…" for ever.
                running: digRunning && currentDarkJob?.id != null,
                requested: stopRequestedFor != null && stopRequestedFor === currentDarkJob?.id,
                sending: stop.isPending,
              })}
              onStopDig={() => {
                if (currentDarkJob?.id == null) return;
                setNotice(null);
                setStopRequestedFor(currentDarkJob.id);
                stop.mutate(currentDarkJob.id);
              }}
              onKeepDigging={() => {
                setNotice(null);
                beginDigPhase();
                advance.mutate(openId);
              }}
              onQueue={(preview) => toQueue.mutate({ id: openId, preview })}
              onPark={() => park.mutate(openId)}
              onPullBack={() => pullBack.mutate(openId)}
              onCloseWithoutFinding={(note) => closeWithoutFinding.mutate({ id: openId, note })}
              closePending={closeWithoutFinding.isPending}
              onFollow={(seed) => followLead.mutate(seed)}
              onChallenge={() => challengeCase.mutate(openId)}
              challengePending={challengeCase.isPending}
              onWriteBrief={() => writeBrief.mutate(openId)}
              briefPending={writeBrief.isPending || briefWaiting}
              modelChoice={fileModelChoice}
              onModelChoice={(choice) => {
                fileModelTouchedFor.current = openId;
                setFileModelChoice(choice);
                setFileModelEffort(defaultModelEffort(choice));
              }}
              modelEffort={fileModelEffort}
              onModelEffort={(effort) => {
                fileModelTouchedFor.current = openId;
                setFileModelEffort(effort);
              }}
              ocrModelChoice={ocrModelChoice}
              ocrModelEffort={ocrModelEffort}
            />
          ) : null}


        </div>
      </div>
      </div>
    </DeskShell>
  );
}

function DeskFileCard({
  row,
  selected,
  onOpen,
}: {
  row: InvestigationRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const { formatListDateTime, formatShortDate } = usePaperDateFormatters();
  const records = Number(row.records ?? 0);
  const waitingCount = Number(row.still_open ?? 0);
  const recordProgress = waitingCount > 0
    ? `${records} of ${records + waitingCount} records`
    : `${records} records`;
  const waitingLine = row.waiting_follow_up
    ? `AI watching for ${row.waiting_follow_up}${row.waiting_since ? ` · since ${formatShortDate(row.waiting_since)}` : ""}`
    : row.waiting_watch
      ? `Watching ${row.waiting_watch}`
      : null;
  const stateLine = row.status === "closed"
    ? row.closed_kind === "queued"
      ? `Sent to the queue${row.close_note ? ` · ${row.close_note}` : ""}`
      : row.closed_kind === "no-finding"
        ? `Closed · no finding${row.close_note ? ` · ${row.close_note}` : ""}`
        : `Closed · ${formatListDateTime(row.updated_at)}`
    : waitingLine
      ? waitingLine
      : row.found_follow_up
        ? "Found an answer"
        : row.status === "investigating"
          ? `Reading · ${recordProgress}`
          : row.status === "open" && waitingCount > 0
            ? `Waiting on ${waitingCount} ${waitingCount === 1 ? "record" : "records"}`
            : row.status === "paused"
              ? `Stopped · ${recordProgress}`
              : `Case file ready · ${records} records`;
  return (
    <div className={"astra-file astra-pile-row" + (selected ? " on" : "")}>
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
        <span className="astra-file-t">{editorTitle(row.title) || `File ${row.id}`}</span>
        <span className="astra-file-m">{stateLine}</span>
      </button>
    </div>
  );
}

function PileShowAll({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
  if (count <= 5) return null;
  return (
    <button type="button" className="astra-show-all" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? "Show fewer" : `Show all ${count}`}
    </button>
  );
}

function SetAsideRow({ row, selected, onOpen }: { row: InvestigationRow; selected: boolean; onOpen: () => void }) {
  const { formatShortDate } = usePaperDateFormatters();
  return (
    <button
      type="button"
      className={"astra-set-aside-row" + (selected ? " on" : "")}
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
    >
      <span className="astra-set-aside-title">{editorTitle(row.title) || `File ${row.id}`}</span>
      <span className="astra-set-aside-meta">Set aside {formatShortDate(row.updated_at)}</span>
    </button>
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
            {/* UI1b-6: the label function's words are stored lower case
                ("filed", "already known", "below the line"); the chip is
                sentence case, and the words are given their capital here. */}
            <span className={"chip st-" + p.state}>{sentenceCase(redditPostStateLabel(p.state))}</span>
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
        <strong>Full-thread reading:</strong> {editorError(result.enrichment.reason) || "Could not read the replies."}
      </p>
      {result.searched.length > 0 ? (
        <p className="reddit-searched">Searched: {result.searched.join(" · ")}</p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {result.incomplete ? (
        <Notice kind="warn">
          {editorError(result.reason ?? "") || "The read stopped early."}
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

function WorthSelector({ item, onOpen }: { item: WorthSeed; onOpen: () => void }) {
  const meta = item.kind === "reddit-tip"
    ? "1 post · unverified"
    : `${item.badge || editorKindLabel(item.kind)} · unverified`.toLowerCase();
  return (
    <button
      type="button"
      className="astra-file-open astra-signal-open"
      onClick={onOpen}
    >
      <span className="astra-file-t">{editorTitle(item.title)}</span>
      <span className="astra-file-m">{meta}</span>
    </button>
  );
}

function InvestigationWorkspace({
  openId,
  onOpenFile,
  detail,
  canUndoDisposition,
  pending,
  digging,
  keepDisabled,
  stalled,
  darkJobError,
  phase,
  notice,
  noticeOk,
  queuedLead,
  queuePending,
  queueError,
  followPending,
  parkPending,
  stopControl,
  onStopDig,
  onKeepDigging,
  onQueue,
  onCloseWithoutFinding,
  closePending,
  onPark,
  onPullBack,
  onFollow,
  onChallenge,
  challengePending,
  onWriteBrief,
  briefPending,
  modelChoice,
  onModelChoice,
  modelEffort,
  onModelEffort,
  ocrModelChoice,
  ocrModelEffort,
}: {
  openId: number;
  onOpenFile: () => void;
  detail: Awaited<ReturnType<typeof getInvestigation>> | undefined;
  canUndoDisposition: boolean;
  pending: boolean;
  digging: boolean;
  keepDisabled: boolean;
  stalled: boolean;
  darkJobError: string | null;
  phase: string;
  notice: string | null;
  noticeOk: boolean;
  queuedLead: number | null;
  queuePending: boolean;
  queueError: string | null;
  followPending: boolean;
  parkPending: boolean;
  stopControl: { visible: boolean; label: string; disabled: boolean; line: string | null };
  onStopDig: () => void;
  onKeepDigging: () => void;
  onQueue: (preview: InvestigationQueuePacket) => void;
  onCloseWithoutFinding: (note: string) => void;
  closePending: boolean;
  onPark: () => void;
  onPullBack: () => void;
  onFollow: (seed: { paste: string; title: string }) => void;
  onChallenge: () => void;
  challengePending: boolean;
  onWriteBrief: () => void;
  briefPending: boolean;
  modelChoice: StoryModelChoice;
  onModelChoice: (choice: StoryModelChoice) => void;
  modelEffort: ModelEffort | null;
  onModelEffort: (effort: ModelEffort | null) => void;
  ocrModelChoice: StoryModelChoice;
  ocrModelEffort: ModelEffort | null;
}) {
  const { formatListDateTime, formatClockTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  const [frN, setFrN] = useState(6);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpNotice, setFollowUpNotice] = useState("");
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchPageIds, setWatchPageIds] = useState<number[]>([]);
  const [watchNotice, setWatchNotice] = useState("");
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  useEffect(() => {
    setFrN(6);
  }, [openId]);
  /*
    FB7, item 2. THE JOB CARDS IN CONTEXT.

    A dig round, a brief rewrite and a PDF read are all long jobs this file
    owns, and until now none of them drew a card on the screen they run from:
    the dig showed a `Busy` line, the brief a `Busy` line, the PDF read a
    sentence and a `stage`. FB0-REPORT.md Table B called all three "LAZY BAR".

    The card for each comes from the desk's one job query -- same reader, same
    Cancel, same stall rule as every other card in the product -- and the
    `subjectId` match is what keeps it honest: a `dark` or `brief` job's
    subject is an INVESTIGATION, an `artifact-ocr` job's is an ARTIFACT, and
    drawing the newsroom's open dig on whichever file happened to be open is
    the plausible-looking wrong answer `job-progress.ts` warns about.

    Running and queued only. Done and failed are already reported in place, in
    one sentence each, right where the press was -- `darkJobError` above the
    Decide strip, the brief card's own line, and the PDF reader's two
    `role="alert"` lines. A second statement of the same failure is how a
    screen starts contradicting itself (the same rule `StoryJobProgress`
    keeps).
  */
  const jobs = useDeskJobs();
  const activityQuery = useQuery({
    queryKey: ["investigation-activity", openId],
    queryFn: () => investigationActivity({ data: openId }),
    refetchInterval: digging ? 2000 : false,
  });
  const followUpLeads = useQuery({
    queryKey: ["follow-up-story-options"],
    queryFn: () => listFollowUpStoryOptions(),
    enabled: followUpOpen,
  });
  const queuePacketQuery = useQuery({
    queryKey: ["dark-queue-packet", openId],
    queryFn: () => queuePacket({ data: openId }),
    enabled: queuePreviewOpen,
  });
  const createFileFollowUp = useMutation({
    mutationFn: (input: FollowUpDialogInput) => createAiFollowUp({
      data: {
        investigationId: openId,
        what: input.what,
        agentKind: input.agentKind,
        schedule: input.schedule,
        targets: input.targets,
        leadId: input.leadId,
        modelChoice: input.modelChoice,
      },
    }),
    onSuccess: (result) => {
      if (!result.ok) return;
      setFollowUpOpen(false);
      setFollowUpNotice("AI follow-up started. This file is now waiting on its next check.");
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
      void qc.invalidateQueries({ queryKey: ["investigations"] });
      void qc.invalidateQueries({ queryKey: ["investigation", openId] });
    },
  });
  const createFileWatches = useMutation({
    mutationFn: async (pages: { id: number; title: string; url: string }[]) => {
      const saved: string[] = [];
      const failed: string[] = [];
      for (const page of pages) {
        try {
          const result = await createPageWatch({ data: {
            url: page.url,
            name: page.title.slice(0, 200),
            reason: `Watch for changes relevant to: ${detail?.investigation.title ?? "this file"}`,
            investigationId: openId,
          } });
          if (!result.ok) {
            failed.push(page.title);
            continue;
          }
          if (!result.alreadyExists) await checkPageWatch({ data: result.id });
          saved.push(page.title);
        } catch {
          failed.push(page.title);
        }
      }
      return { saved, failed };
    },
    onSuccess: (result) => {
      if (result.saved.length) {
        setWatchNotice(result.failed.length
          ? `Watching ${result.saved.length} ${result.saved.length === 1 ? "page" : "pages"}; ${result.failed.length} could not be added.`
          : `Watching ${result.saved.length} ${result.saved.length === 1 ? "page" : "pages"}.`);
        void qc.invalidateQueries({ queryKey: ["page-watches"] });
        void qc.invalidateQueries({ queryKey: ["investigations"] });
        void qc.invalidateQueries({ queryKey: ["investigation", openId] });
        void qc.invalidateQueries({ queryKey: ["investigation-activity", openId] });
      }
      if (!result.failed.length) setWatchOpen(false);
    },
  });
  const fileJob = (kind: "dark" | "brief" | "artifact-ocr" | "challenge", subjectId: number | null) =>
    subjectId == null
      ? null
      : ((jobs.data ?? []).find(
          (row) =>
            row.kind === kind &&
            row.subjectId === subjectId &&
            (row.status === "queued" || row.status === "running"),
        ) ?? null);
  const darkResearchJob = (jobs.data ?? []).find((row) => row.kind === "dark" && row.subjectId === openId) ?? null;
  const digJob = darkResearchJob && (darkResearchJob.status === "queued" || darkResearchJob.status === "running") ? darkResearchJob : null;
  const failedDarkJob = darkResearchJob?.status === "failed" ? darkResearchJob : null;
  const briefJob = fileJob("brief", openId);
  const challengeJob = fileJob("challenge", openId);
  const inv = detail?.investigation;
  const detailReady = inv?.id === openId;
  const allArtifacts = detail?.artifacts ?? [];
  const artifacts = allArtifacts.filter((a) => !a.url.startsWith("editor://"));
  const watchPages = artifacts
    .filter((artifact) => /^https?:\/\//i.test(artifact.url))
    .map((artifact) => {
      const title = editorTitle(plainEditorText(artifact.title));
      return { id: artifact.id, title: title && !/^https?:\/\//i.test(title) ? title : headlineFromUrl(artifact.url), url: artifact.url };
    });
  const foundAnswer = detail?.investigationFollowUps?.find((followUp) => followUp.lastState === "found") ?? null;
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
  /*
    Unit DD1, item 6. The line's counts come from the whole file, and from the
    same query the rail row is counted with -- not from the sixty rows this page
    happens to have loaded. See dark-counters.ts: the rail and this line used to
    disagree by one (the editor's pasted tip) and, on a long file, by more.
  */
  const captureCounts = detail?.captureCounts ?? { captures: 0, readable: 0, unreadable: 0 };
  const readableCountBadge =
    captureCounts.captures === 0
      ? 0
      : captureCounts.readable >= captureCounts.captures
        ? captureCounts.captures
        : `${captureCounts.readable}/${captureCounts.captures}`;
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
  const sourceCaptures = detail?.sourceCaptures ?? [];
  /*
    FB7, item 5 (A2c X3). Five rounds that each recorded the same sentence left
    five `claims` rows -- `investigate.ts` inserts one per planned claim per
    round and nothing dedupes the body -- so WHAT WE KNOW printed the same line
    five times. Deduped on the way OUT (`dark-fact-lines.ts`), not at the
    insert: the rows are the file's own record of what each round found, and
    merging them on write would rewrite that record.

    `factLinesDropped` is what lets the section say how many echoes it folded,
    rather than the list quietly shrinking.
  */
  const facts = dedupeFactLines(claims.filter((c) => /FACT|OBSERVATION/i.test(c.kind)));
  const factsFolded = factLinesDropped(claims.filter((c) => /FACT|OBSERVATION/i.test(c.kind)));
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
  const parentTitle = detailReady ? fullFileQuestion(inv!.title, pasteArt?.excerpt ?? "") : "";

  const activityAll = activityQuery.data ?? [];
  const activityRows = activityAll.slice(-5);
  const earlierActivity = activityAll.slice(0, activityAll.length - activityRows.length);

  // The saved scope is file-specific; the newsroom place supplies only its
  // human-readable jurisdiction names.
  const dialsQ = useQuery({ queryKey: ["dark-dials"], queryFn: () => getDarkDials() });
  const savedScope = (() => {
    try {
      const scope = (JSON.parse(inv?.scope_json || "{}") as { scope?: unknown }).scope;
      return ["city", "county", "region", "adjacent"].includes(String(scope))
        ? (scope as DarkScope)
        : "city";
    } catch {
      return "city";
    }
  })();
  const scopeLabel = dialsQ.data ? scopeLabelsFor(dialsQ.data.place)[savedScope] : "City scope";
  const limit = DARK_LIMITS.find((row) => row.key === inv?.limit_key) ?? DARK_LIMITS[1];
  const limitMinutes = Number(inv?.limit_minutes ?? limit.minutes);
  const limitTimeLabel = limitMinutes % 60 === 0
    ? `${limitMinutes / 60} hour${limitMinutes === 60 ? "" : "s"}`
    : `${limitMinutes} minutes`;
  const explanation = inv?.ordinary_explanation?.trim();
  const sourceByCapture = new Map(sourceCaptures.map((capture) => [capture.id, capture]));
  const normalizedSupport = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sourcedFindings = claims
    .filter((claim) => claim.capture_event_id != null && /FINDING|PATTERN|FACT|OBSERVATION/i.test(claim.kind))
    .map((claim) => {
      const source = sourceByCapture.get(claim.capture_event_id!);
      const text = plainEditorText(claim.body);
      const normalized = normalizedSupport(text);
      const rank = (brief?.supports ?? []).findIndex((support) => {
        const supportText = normalizedSupport(support);
        return supportText && (normalized.includes(supportText) || supportText.includes(normalized));
      });
      return { text, source, confidence: Number(claim.confidence ?? 0), rank };
    })
    .filter((finding) => finding.text && finding.source && /^https?:\/\//i.test(finding.source.url))
    .sort((a, b) => (a.rank < 0 ? Number.MAX_SAFE_INTEGER : a.rank) - (b.rank < 0 ? Number.MAX_SAFE_INTEGER : b.rank) || b.confidence - a.confidence);
  const contradictions = brief?.contradictions ?? [];
  const hasChallengeMaterial = sourcedFindings.length > 0 || contradictions.length > 0 || Boolean(brief?.supports.length);
  const unanswered = questions.map((question) => plainEditorText(question)).filter(Boolean);
  const linkedFollowUps = (detail?.investigationFollowUps ?? []).filter((followUp) => ["active", "paused"].includes(followUp.status) || followUp.lastState === "found");
  const sourceLink = (captureId: number) => {
    const source = sourceByCapture.get(captureId);
    if (!source || !/^https?:\/\//i.test(source.url)) return null;
    const title = editorTitle(plainEditorText(source.title));
    const label = title && !/^https?:\/\//i.test(title) ? title : headlineFromUrl(source.url);
    return <a className="inline-link astra-citation" href={source.url} target="_blank" rel="noreferrer">{label}</a>;
  };
  const renderCompactCaseText = (value: string, key: string) => {
    const full = plainEditorText(value).replace(/\s+/g, " ").trim();
    const preview = full.length > 132 ? `${full.slice(0, 132).trimEnd()}…` : full;
    return (
      <div key={key} className="astra-case-compact">
        <p className="side-item astra-case-v">{preview}</p>
        {preview !== full ? <details className="of-trail"><summary>More</summary><p className="side-item astra-case-v">{full}</p></details> : null}
      </div>
    );
  };
  const renderFinding = (finding: (typeof sourcedFindings)[number], key: string) => (
    <div key={key} className="astra-case">
      {renderCompactCaseText(finding.text, `${key}-text`)}
      <span className="meta">— {sourceLink(finding.source!.id)}</span>
    </div>
  );
  const renderQuestion = (question: string, key: string) => <div key={key} className="astra-case">{renderCompactCaseText(question, `${key}-text`)}</div>;
  const renderContradiction = (pair: (typeof contradictions)[number], key: string) => (
    <div key={key} className="astra-case">
      {renderCompactCaseText(`${plainEditorText(pair.first.text)}; another record says ${plainEditorText(pair.second.text)}`, `${key}-text`)}
      <span className="meta">— {sourceLink(pair.first.captureId)}; {sourceLink(pair.second.captureId)}</span>
    </div>
  );
  const renderFollowUp = (followUp: (typeof linkedFollowUps)[number], key: string) => (
    <div key={key} className="astra-case">
      <p className="side-item astra-case-v"><span className="meta">{followUp.lastState === "found" ? "Found an answer" : followUp.status === "paused" ? "Paused" : "Watching"}</span></p>
      {renderCompactCaseText(followUp.what, `${key}-what`)}
      <Link to="/desk/follow-ups" className="inline-link">{followUp.lastState === "found" ? "Review finding" : "Open follow-up"}</Link>
    </div>
  );

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
      <div className="astra-file-head">
        <div>
          <p className="astra-label">The question</p>
          <h2 className="astra-question" title={parentTitle}>{parentTitle}</h2>
        </div>
        <details className="astra-more-file-actions of-trail">
          <summary>More file actions</summary>
          <div className="astra-panel-acts">
            <InkButton tone="quiet" disabled={keepDisabled || parkPending || inv?.status === "closed"} pending={parkPending} pendingLabel="Setting aside…" onClick={onPark}>Set aside</InkButton>
            {inv?.status === "closed" ? <InkButton tone="quiet" disabled={keepDisabled} onClick={onPullBack}>Pull back</InkButton> : null}
            {foundAnswer ? <InkButton tone="quiet" disabled={keepDisabled || createFileFollowUp.isPending} onClick={() => { setFollowUpNotice(""); setFollowUpOpen(true); }}>Start another AI follow-up</InkButton> : null}
          </div>
        </details>
      </div>
      {explanation ? (
        <div>
          <p className="astra-label">Ordinary explanation to rule out</p>
          <p className="astra-serif">{explanation}</p>
        </div>
      ) : null}

      <ModelPicker
        scope="dark"
        layout="stacked"
        value={modelChoice}
        onChange={onModelChoice}
        effort={modelEffort}
        onEffortChange={onModelEffort}
        disabled={digging || keepDisabled}
        compact
      />

      {digJob || failedDarkJob ? (
        <DarkResearchCard
          job={digJob ?? failedDarkJob!}
          onStop={onStopDig}
          onOpen={onOpenFile}
          stopDisabled={stopControl.disabled}
        />
      ) : null}

      {/* Status, in the order it matters: stopped, failed, running, then the rest. */}
      <div className="astra-notices">
        {stalled && !digJob ? (
          <p className="note err" role="status">
            {stalledRunCopy("dark")}
          </p>
        ) : null}
        {darkJobError && !failedDarkJob ? <p className="note err" role="alert">{darkJobError}</p> : null}
        {digging && !digJob ? <Busy label={phase || "Searching records…"} /> : null}
        {/*
          Unit DD1, item 3. The acknowledgement belongs here, above the notice
          line, and NOT inside it: the notice line is suppressed while a run is
          live, and the editor presses Stop precisely while a run is live. The
          walkthrough measured 102 seconds of a desk that had accepted the stop
          and said nothing about it.
        */}
        {stopControl.line && !digJob ? (
          <p className="note" role="status">
            {stopControl.line}
          </p>
        ) : null}
        {/* The same live region as the one above the file pane -- see the note
            there. This is the copy of the notice line the editor sees while a
            file is open, which is when most of these presses happen. */}
        {notice && !digging && stopControl.line == null ? (
          <p className={"note" + (noticeOk ? "" : " err")} role={noticeOk ? "status" : "alert"}>
            {notice}{canUndoDisposition ? <InkButton small tone="quiet" onClick={onPullBack}>Undo</InkButton> : null}
          </p>
        ) : null}
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
              Filed to the Queue ·{" "}
              <Link
                to="/desk/story/$leadId"
                params={{ leadId: String(queuedLead) }}
                className="inline-link"
              >
                Open the lead →
              </Link>
              {canUndoDisposition ? <InkButton small tone="quiet" onClick={onPullBack}>Undo</InkButton> : null}
            </Notice>
          ) : null
        }
        {pending ? <p className="meta">Getting this ready…</p> : null}
        {inv?.status === "paused" && inv.pause_reason && !digging ? (
          <p className={"of-stop" + (editorPauseIsPageFailure(inv.pause_reason) ? " fail" : "")} role="status">
            {editorPauseReason(inv.pause_reason, captureStats) ?? "Could not finish — retry."}
            {looksLikeProviderAuthFailure(inv.pause_reason) ? <ProviderSignInButton detail={inv.pause_reason} /> : null}
          </p>
        ) : null}
        {showBlockedBanner ? (
          <p className="of-stop err" role="status">
            <b>Mostly blocked:</b> {blockedDigBannerText(captureStats)}
          </p>
        ) : null}
      </div>

      {/* Each boundary is the value saved on this file when it was opened. */}
      <div className="astra-bounds">
        <div className="astra-bound">
          <p className="astra-bound-k">Scope</p>
          <p className="astra-bound-v">{scopeLabel ?? "Not recorded yet"}</p>
        </div>
        <div className="astra-bound">
          <p className="astra-bound-k">Depth</p>
          <p className="astra-bound-v">{limit.label.split(",")[0]}</p>
        </div>
        <div className="astra-bound">
          <p className="astra-bound-k">Limit</p>
          <p className="astra-bound-v">{limitTimeLabel}</p>
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
          </div>
          {activityQuery.isError ? (
            <div className="astra-note" role="alert">
              <p>Could not load the activity</p>
              <InkButton tone="quiet" onClick={() => void activityQuery.refetch()}>Try again</InkButton>
            </div>
          ) : activityRows.length === 0 ? (
            <p className="astra-note">
              {activityQuery.isPending ? "Loading activity…" : "No activity recorded yet."}
            </p>
          ) : (
            activityRows.map((a) => (
              <div key={a.id} className="astra-log">
                <time className="astra-log-t" dateTime={a.occurredAt}>{formatClockTime(a.occurredAt)}</time>
                <span
                  className={
                    "astra-log-e" + (a.tone === "failure" ? " fail" : a.tone === "finding" ? " find" : "")
                  }
                >
                  {a.text}
                </span>
              </div>
            ))
          )}
          {earlierActivity.length ? (
            <details className="of-trail">
              <summary>Show earlier</summary>
              {earlierActivity.map((a) => (
                <div key={a.id} className="astra-log">
                  <time className="astra-log-t" dateTime={a.occurredAt}>{formatClockTime(a.occurredAt)}</time>
                  <span className={"astra-log-e" + (a.tone === "failure" ? " fail" : a.tone === "finding" ? " find" : "")}>{a.text}</span>
                </div>
              ))}
            </details>
          ) : null}
        </div>
        <div>
          <div className="astra-case-h">
            <p className="astra-label">Case file</p>
          </div>
          {challengeJob ? <div className="dark-job-card"><DeskJobCard job={challengeJob} /></div> : null}
          {briefJob ? <div className="dark-job-card"><DeskJobCard job={briefJob} /></div> : null}
          {brief || detail?.latestChallenge ? (
            <details className="of-trail">
              <summary>More</summary>
              {brief ? <InvestigationBriefCard brief={brief} onRefresh={onWriteBrief} refreshing={briefPending} /> : null}
              {detail?.latestChallenge ? <p className="meta">Challenged {formatListDateTime(detail.latestChallenge.createdAt)}: {plainEditorText(detail.latestChallenge.summary)}</p> : null}
            </details>
          ) : null}
          <div className="of-block">
            <p className="side-label">Findings</p>
            {sourcedFindings.length ? renderFinding(sourcedFindings[0]!, "finding-0") : <p className="side-item">No sourced findings yet.</p>}
            {sourcedFindings.length > 1 ? (
              <details className="of-trail"><summary>More</summary>{sourcedFindings.slice(1).map((finding, i) => renderFinding(finding, `finding-more-${i}`))}</details>
            ) : null}
          </div>
          <div className="of-block">
            <p className="side-label">Contradictions</p>
            {contradictions.length ? renderContradiction(contradictions[0]!, "contradiction-0") : <p className="side-item">No captured records disagree yet.</p>}
            {contradictions.length > 1 ? (
              <details className="of-trail"><summary>More</summary>{contradictions.slice(1).map((pair, i) => renderContradiction(pair, `contradiction-more-${i}`))}</details>
            ) : null}
          </div>
          <div className="of-block">
            <p className="side-label">Unanswered</p>
            {unanswered.length ? renderQuestion(unanswered[0]!, "question-0") : <p className="side-item">No unanswered questions listed yet.</p>}
            {unanswered.length > 1 ? <details className="of-trail"><summary>More</summary>{unanswered.slice(1).map((question, i) => renderQuestion(question, `question-more-${i}`))}</details> : null}
          </div>
          <div className="of-block">
            <p className="side-label">AI follow-ups running</p>
            {linkedFollowUps.length ? renderFollowUp(linkedFollowUps[0]!, `follow-up-${linkedFollowUps[0]!.id}`) : <p className="side-item">No AI follow-ups are running.</p>}
            {linkedFollowUps.length > 1 ? <details className="of-trail"><summary>More</summary>{linkedFollowUps.slice(1).map((followUp) => renderFollowUp(followUp, `follow-up-more-${followUp.id}`))}</details> : null}
          </div>
          <div className="astra-panel-acts">
            <InkButton tone="ghost" disabled={keepDisabled || challengePending || Boolean(challengeJob) || !hasChallengeMaterial} pending={challengePending} pendingLabel="Challenging…" onClick={onChallenge}>Challenge the case</InkButton>
          </div>
        </div>
      </div>

      {/* The five editor decisions stay on the file. */}
      <div className="astra-panel decide">
        <div className="astra-case-h">
          <p className="astra-label">Decide</p>
          <p className="astra-note">It digs; it never prints.</p>
        </div>
        {digging ? <p className="astra-note" role="status">Decide when this round ends.</p> : null}
        <div className="astra-panel-acts" aria-label="File decisions">
          <InkButton tone="ghost" disabled={keepDisabled || inv?.status === "closed"} pending={digging} pendingLabel="Reading…" onClick={onKeepDigging}>
            Keep investigating
          </InkButton>
          <InkButton tone="solid" disabled={keepDisabled || createFileFollowUp.isPending} onClick={() => { setFollowUpNotice(""); setFollowUpOpen(true); }}>
            Start an AI follow-up
          </InkButton>
          <InkButton tone="ghost" disabled={keepDisabled} onClick={() => { setWatchNotice(""); setWatchPageIds(watchPages.map((page) => page.id)); setWatchOpen(true); }}>
            Wait and watch
          </InkButton>
          <InkButton tone="ghost" disabled={keepDisabled || queuePending} onClick={() => setQueuePreviewOpen(true)}>
            {queuePending ? "Sending…" : "Send to the queue"}
          </InkButton>
          <InkButton tone="quiet" disabled={keepDisabled || closePending} onClick={() => { setCloseNote(""); setCloseDialogOpen(true); }}>
            Close: no finding
          </InkButton>
        </div>
        {followUpNotice ? <p className="note" role="status">{followUpNotice}</p> : null}
        {watchNotice ? <p className="note" role="status">{watchNotice}</p> : null}
        <p className="astra-note">
          Nothing here prints. "Send to the queue" files a lead for you to review.
        </p>
      </div>

      {followUpOpen && detailReady ? (
        <FollowUpDialog
          leads={followUpLeads.data ?? []}
          initial={{
            what: parentTitle,
            agentKind: watchPages.length ? "recheck" : "search",
            targets: watchPages.slice(0, 3).map((page) => page.url).join("\n"),
            leadId: null,
            leadHeadline: null,
            modelChoice: "auto",
          }}
          onClose={() => setFollowUpOpen(false)}
          onSubmit={(input) => createFileFollowUp.mutate(input)}
          pending={createFileFollowUp.isPending}
          error={createFileFollowUp.error instanceof Error
            ? editorError(createFileFollowUp.error.message) || "Could not start the AI follow-up."
            : createFileFollowUp.data?.ok === false
              ? editorError(createFileFollowUp.data.error ?? "") || "Could not start the AI follow-up."
              : null}
        />
      ) : null}

      <Dialog
        open={watchOpen}
        onClose={() => setWatchOpen(false)}
        title="Wait and watch"
        subtitle="Choose public pages already in this file. Their watches stay linked to the file."
        primaryLabel="Start watching"
        primaryPendingLabel="Saving watches…"
        pending={createFileWatches.isPending}
        primaryDisabled={!watchPageIds.length || createFileWatches.isPending}
        onPrimary={() => createFileWatches.mutate(watchPages.filter((page) => watchPageIds.includes(page.id)))}
        footNote="The file moves to Waiting while its pages are watched."
      >
        {watchPages.length ? (
          <div className="fu-form">
            {watchPages.map((page) => (
              <label key={page.id} className="fu-field">
                <span className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={watchPageIds.includes(page.id)}
                    onChange={(event) => setWatchPageIds((current) => event.target.checked
                      ? [...current, page.id]
                      : current.filter((id) => id !== page.id))}
                  />
                  <span><b>{page.title}</b><br /><span className="meta astra-case-v">{page.url}</span></span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p role="status">No captured public pages are ready to watch. Keep investigating to add pages to this file.</p>
        )}
        {createFileWatches.error instanceof Error ? <p className="fu-err" role="alert">{editorError(createFileWatches.error.message) || "Could not start watching these pages."}</p> : null}
        {createFileWatches.data?.failed.length ? <p className="fu-err" role="alert">Some pages could not be added. Retry the remaining pages or close this window.</p> : null}
      </Dialog>

      <Dialog
        open={queuePreviewOpen}
        onClose={() => setQueuePreviewOpen(false)}
        title="Send to the queue"
        subtitle="Review the AI-prepared packet before you hand this file to the reporting queue."
        primaryLabel="Send to the queue"
        primaryPendingLabel="Sending…"
        pending={queuePending}
        primaryDisabled={!queuePacketQuery.data || queuePending}
        onPrimary={() => { if (queuePacketQuery.data) { setQueuePreviewOpen(false); onQueue(queuePacketQuery.data); } }}
        footNote="Publication remains an editorial decision."
      >
        {queuePacketQuery.isPending ? <p role="status">Preparing the file packet…</p> : null}
        {queuePacketQuery.isError ? <p className="fu-err" role="alert">Could not prepare the queue packet. Close this window and try again.</p> : null}
        {queuePacketQuery.data ? <QueuePacketPreview packet={queuePacketQuery.data} /> : null}
      </Dialog>

      <Dialog
        open={closeDialogOpen}
        onClose={() => setCloseDialogOpen(false)}
        title="Close: no finding"
        subtitle="The file stays readable in Set aside. Add a reason if there is one."
        primaryLabel={closeNote.trim() ? "Close the file" : "Close, no reason"}
        primaryPendingLabel="Closing file…"
        pending={closePending}
        onPrimary={() => { onCloseWithoutFinding(closeNote.trim()); setCloseDialogOpen(false); }}
        altLabel={closeNote.trim() ? "Close, no reason" : undefined}
        altDisabled={closePending}
        onAlt={() => { onCloseWithoutFinding(""); setCloseDialogOpen(false); }}
        footNote="This records a no-finding decision and keeps the research available."
      >
        <label className="fu-field">
          <span>Reason (optional)</span>
          <textarea className="fu-input" maxLength={500} value={closeNote} onChange={(event) => setCloseNote(event.target.value)} />
        </label>
      </Dialog>

      <details className="of-trail astra-records">
        <summary>The file's records ▸</summary>
        <p className="astra-note">Run history is on the <Link to="/desk/ops" className="inline-link">Server</Link>.</p>
      <div>
        <SecHead
          title="What to read"
          count={readableCountBadge}
          sub="Click a title. The captured page opens below — that is the file."
        />
        {artifacts.length > 0 ? (
          <OpenedRecords
            artifacts={artifacts}
            modelChoice={ocrModelChoice}
            modelEffort={ocrModelEffort}
          />
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
        searches.map((s, i) => (
          <SearchTrailEntry
            key={`${s.hop}-${i}`}
            record={{ ...s, query: plainEditorText(s.query).replace(/https?:\/\/[^\s<>"']+/gi, (url) => headlineFromUrl(url)) }}
          />
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
      {tests.length > 0 ? (
        <details className="of-trail">
          <summary>Questions the AI tested — {tests.length}</summary>
          {tests.map((question, i) => <p key={i} className="side-item">{question}</p>)}
        </details>
      ) : null}
      {findings.length > 0 ? (
        <details className="of-trail">
          <summary>Other research notes — {findings.length}</summary>
          {findings.map((finding, i) => (
            <p key={i} className="side-item">{finding.text}{finding.sourceNote ? <span className="meta"> — {finding.sourceNote}</span> : <span className="meta evidence-weak"> — pattern-level, not tied to one source</span>}</p>
          ))}
        </details>
      ) : null}
      </div>
      {facts.length > 0 ? (
        <div className="of-block">
          <p className="side-label">What we know</p>
          <SectionTldr text={brief?.sections?.known ?? ""} />
          {facts.map((claim, i) => (
            <p key={i} className="side-item">{plainEditorText(claim.body)}{claim.evidence ? <span className="meta"> — {plainEditorText(claim.evidence).slice(0, 160)}</span> : null}</p>
          ))}
          {factsFolded > 0 ? <p className="meta">{factsFolded} repeated records folded into the lines above.</p> : null}
        </div>
      ) : null}
      </details>
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

function darkJobStepLine(step: string): string {
  const value = step.trim();
  const pass = value.match(/^Researching hop (\d+)\/(\d+)$/i);
  if (pass) return `Reading public records · pass ${pass[1]} of up to ${pass[2]}`;
  const search = value.match(/^Searching (\d+)\/(\d+) on hop (\d+)$/i);
  if (search) return `Checking public pages · search ${search[1]} of ${search[2]}`;
  if (/^Researching the file$/i.test(value)) return "Starting to read public records";
  if (/^Synthesizing signals/i.test(value)) return "Putting the case file together";
  if (/^Testing explanations$/i.test(value)) return "Checking ordinary explanations";
  if (/^Writing editor brief$/i.test(value)) return "Finishing the case file";
  if (/^Switched to /i.test(value)) return "Changing models to keep the work moving";
  return "Working on the case file";
}

function DarkResearchCard({ job, onStop, onOpen, stopDisabled }: { job: JobProgressView; onStop: () => void; onOpen: () => void; stopDisabled: boolean }) {
  const qc = useQueryClient();
  const [retryNote, setRetryNote] = useState("");
  const [retryAfterStop, setRetryAfterStop] = useState(false);
  const retry = useMutation({
    mutationFn: (nextModel: boolean) => retryDarkRound({ data: { jobId: job.id, nextModel } }),
    onSuccess: (result) => {
      if (!result.ok) {
        setRetryNote(editorError(result.error ?? "") || "Could not retry this round.");
        return;
      }
      setRetryNote(`Retry queued on ${result.model}.`);
      invalidateDeskJobs(qc);
      void qc.invalidateQueries({ queryKey: ["investigation", job.subjectId] });
      void qc.invalidateQueries({ queryKey: ["investigations"] });
    },
    onError: (error) => setRetryNote(editorError(error instanceof Error ? error.message : "") || "Could not retry this round."),
  });
  const retryRound = retry.mutate;
  useEffect(() => {
    if (!retryAfterStop || job.status !== "failed") return;
    setRetryAfterStop(false);
    retryRound(true);
  }, [retryAfterStop, job.status, job.id, retryRound]);
  const displayJob: JobProgressView = {
    ...job,
    stages: ["Question", "Gather", "Case file", "Challenge"],
    stageIndex: job.status === "queued" ? 0 : Math.min(3, Math.max(1, (job.stageIndex ?? 0) + 1)),
    step: darkJobStepLine(job.step),
    doneText: "Case file ready for your decision",
    openLabel: "Open file",
    error: job.status === "failed"
      ? /cancel(?:led|ed)? by the editor/i.test(job.error ?? "")
        ? "Stopped at the editor's request. What was found remains saved."
        : editorError(job.error ?? "") || "Could not finish — retry."
      : job.error,
    cancelRequested: job.cancelRequested || stopDisabled,
    canRetry: false,
  };
  const retryOnNextModel = () => {
    if (stopDisabled || retryAfterStop) return;
    setRetryAfterStop(true);
    setRetryNote("Stopping this run before retrying on another model.");
    onStop();
  };
  return (
    <div>
      <JobCard
        job={displayJob}
        cancelLabel="Stop"
        failoverNote={false}
        onCancel={onStop}
        onOpen={onOpen}
        onRetryNext={job.status === "running" ? retryOnNextModel : undefined}
      />
      {job.status === "failed" ? (
        <div className="astra-panel-acts">
          <InkButton pending={retry.isPending} pendingLabel="Retrying…" onClick={() => retry.mutate(false)}>Retry</InkButton>
          <InkButton tone="quiet" pending={retry.isPending} pendingLabel="Retrying…" onClick={() => retry.mutate(true)}>Retry on next model</InkButton>
        </div>
      ) : null}
      {retryNote ? <p className="meta" role="status">{retryNote}</p> : null}
    </div>
  );
}

function QueuePacketPreview({ packet }: { packet: InvestigationQueuePacket }) {
  const safeSource = (url: string | null) => /^https?:\/\//i.test(url ?? "")
    ? <a className="inline-link" href={url!} target="_blank" rel="noreferrer">{organizationFromUrl(url!) || "Source record"}</a>
    : <span className="meta">Source record</span>;
  return (
    <div className="fu-form">
      <section>
        <p className="side-label">Suggested headline</p>
        <p>{plainEditorText(packet.suggestedHeadline)}</p>
      </section>
      <section>
        <p className="side-label">Evidence</p>
        {packet.evidence.length ? packet.evidence.map((item, index) => (
          <p key={`evidence-${index}`} className="side-item">{plainEditorText(item.text)} — {safeSource(item.source)}</p>
        )) : <p className="meta">No sourced evidence is attached yet.</p>}
      </section>
      <section>
        <p className="side-label">Uncertainties</p>
        {packet.uncertainties.length ? packet.uncertainties.map((item, index) => <p key={`uncertainty-${index}`} className="side-item">{plainEditorText(item)}</p>) : <p className="meta">None listed.</p>}
      </section>
      <section>
        <p className="side-label">Contradictions</p>
        {packet.contradictions.length ? packet.contradictions.map((item, index) => (
          <p key={`contradiction-${index}`} className="side-item">
            {plainEditorText(item.first.text)}; another record says {plainEditorText(item.second.text)}
          </p>
        )) : <p className="meta">No captured records disagree yet.</p>}
      </section>
      <section>
        <p className="side-label">What would kill the story</p>
        {packet.whatWouldDisproveIt.length ? packet.whatWouldDisproveIt.map((item, index) => <p key={`disprove-${index}`} className="side-item">{plainEditorText(item)}</p>) : <p className="meta">No disconfirming fact is listed yet.</p>}
      </section>
    </div>
  );
}

function OpenedRecords({
  artifacts,
  modelChoice,
  modelEffort,
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
  modelEffort: ModelEffort | null;
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
  /*
    FB7, item 2. The retained-PDF read's own card, for THIS capture.

    An `artifact-ocr` job's subject is the ARTIFACT, not the file, so this is
    matched on the record the editor is looking at rather than on the open
    investigation. Table B called these two presses "LAZY BAR -- 1.5s poll,
    `stage` text only, no cancel, despite `dark.ts:2660` honouring it": the
    worker honours a cancel the screen never offered. The card offers it.
  */
  const jobs = useDeskJobs();
  const ocrJob =
    selected == null
      ? null
      : ((jobs.data ?? []).find(
          (row) =>
            row.kind === "artifact-ocr" &&
            row.subjectId === selected.id &&
            (row.status === "queued" || row.status === "running"),
        ) ?? null);
  const body = useQuery({
    queryKey: ["artifact", selected?.id ?? 0],
    queryFn: () => getArtifact({ data: selected!.id }),
    enabled: selected != null,
  });
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("1");
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
          modelEffort,
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
          {body.data?.retained_pdf ? <>
          <form
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
                disabled={requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
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
                disabled={requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
              />
            </label>
            <button type="submit" className="inline-link" disabled={requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}>
              {pageRead.data?.status === "queued" || pageRead.data?.status === "running" ? "Reading retained PDF…" : "Read selected pages"}
            </button>
            <button
              type="button"
              className="inline-link"
              disabled={requestPageRead.isPending || pageRead.data?.status === "queued" || pageRead.data?.status === "running"}
              onClick={() => requestPageRead.mutate("complete")}
            >
              Read entire PDF
            </button>
            <span className="np-meta">Uses {modelChoiceLabel(modelChoice, "forced")} · the entire packet is saved in batches of up to 12 pages · original retained PDF only</span>
          </form>
          </> : null}
          {ocrJob ? (
            <div className="dark-job-card">
              <DeskJobCard job={ocrJob} />
            </div>
          ) : null}
          {/* FB7, item 1: the PDF reader's two failures, announced. `Read
              selected pages`/`Read entire PDF` are the two presses on this
              screen that spend the most, and both of their error sentences
              were drawn without a role -- silent to a screen reader. */}
          {requestPageRead.error ? (
            <p className="note err" role="alert">
              {editorError(requestPageRead.error.message) || "Could not read these pages."}
            </p>
          ) : null}
          {pageRead.data?.error ? (
            <p className="note err" role="alert">
              {editorError(pageRead.data.error) || "Could not read these pages."}
            </p>
          ) : null}
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
                    ? `Entire PDF · ${result.pagesRead ?? 0} of ${result.pagesTotal ?? "?"} pages saved${result.batchesTotal ? ` · batch ${result.batchesCompleted ?? 0} of ${result.batchesTotal}` : ""}`
                    : `Requested PDF pages ${result.start}-${result.end}`}
                  {` · ${result.provider ?? modelChoiceLabel(modelChoice)}`}
                </p>
                {result.pages?.map((page) => <p key={page.page}><strong>Page {page.page}</strong><br />{page.text}</p>)}
                {result.reason ? <p className="meta">{editorError(result.reason) || "The page read stopped early."}</p> : null}
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
