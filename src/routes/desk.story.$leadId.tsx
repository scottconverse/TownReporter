import { StoryDocumentList } from "@/components/story-documents";
import { DraftScopePicker } from "@/components/draft-scope-picker";
import {
  evidenceNeedsReview,
  mayInheritLeadSources,
  type EvidenceDecision,
} from "@/lib/news/draft-evidence";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Busy,
  Chip,
  DeskShell,
  Field,
  InkButton,
  leadOrigin,
  announceToDesk,
} from "@/components/desk-chrome";
import { EmptyState, WorkbenchSkeleton, Notice, ScreenError } from "@/components/states";
import {
  createFollowUp,
  dropFollowUp,
  draftLead,
  getLead,
  listFollowUps,
  nudgeFollowUp,
  publishLead,
  pullTodo,
  recordFollowUpReply,
  saveDraft,
  saveReportingNotes,
} from "@/lib/news/desk";
import { FollowUpItem } from "@/components/follow-up-item";
import { uncreditedOutlets } from "@/lib/news/report";
import { parseUrlList } from "@/lib/paper";
import { useEditorSections } from "@/lib/use-sections";
import { usePaperDateFormatters } from "@/lib/paper-context";
import {
  applyTodoPatch,
  notesHaveMemo,
  parseNotes,
  uncheckedGateTodos,
  type ReportingNotes,
} from "@/lib/news/notes";
import {
  editorDraftError,
  expectedDraftJobHasLanded,
  recoverExpectedDraftJobId,
  resolveDraftJobState,
  recoveringDraftCopy,
  followUpsRailCopy,
} from "@/lib/news/desk-copy";
import { stripReporterNotebook } from "@/lib/news/strip-draft";
import { describeExtractionMethod } from "@/lib/news/extraction-label";
import { ModelPicker } from "@/components/model-picker";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { FindingEvidenceReviewPanel } from "@/components/finding-evidence-review";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { integrityNoteItems } from "@/lib/news/coerce-draft";
import { DraftReconcileControl } from "@/components/draft-reconcile-control";
import {
  assessCheckedDraftResult,
  assessRefreshedCheckedDraft,
  draftFieldsMatch,
  getCheckedDraftResultFn,
  getDraftReconciliationStatusFn,
  requestDraftReconciliationFn,
  type EditableDraftFields,
} from "@/lib/news/draft-reconcile-actions";

export const Route = createFileRoute("/desk/story/$leadId")({
  component: StoryPage,
});

/**
 * A server function that answered with something other than a result.
 *
 * The desk restarting, the tunnel returning its own error page, a proxy
 * timeout — none of those come back as JSON, so the call resolves to
 * `undefined` and reading `.ok` on it throws
 * "Cannot read properties of undefined (reading 'ok')". That message names a
 * property, not a cause, and it appears with nothing in the server log because
 * the server never saw the request. Publishing a story failed this way and the
 * error pointed at nothing.
 *
 * Editors get a sentence they can act on instead.
 */
const NO_ANSWER = "The desk did not answer that click. It may have been restarting — try again.";

function answered<T>(res: T | undefined | null): res is T {
  return res !== undefined && res !== null && typeof res === "object";
}

function StoryPage() {
  const { sections } = useEditorSections();
  const TOPICS = sections.map((s) => s.key);
  const { formatShortDate } = usePaperDateFormatters();
  const { leadId } = Route.useParams();
  const id = Number(leadId);
  const qc = useQueryClient();
  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("council");
  const [scratch, setScratch] = useState("");
  const [researchScope, setResearchScope] = useState<"public" | "supplied">("public");
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  /*
    Publishing is the only irreversible thing on this page, and it was the
    only one that did not ask.

    An audit put it plainly: one unconfirmed click puts a story on a public
    website, in a product whose whole premise is that a human deliberately
    decides what prints -- while Delete, which keeps a copy for thirty days,
    gets a paragraph of consequence and a second click. The weights were the
    wrong way round.

    Same inline pattern the desk already uses for Delete, so it is a shape
    the editor recognises rather than a new dialog to learn.
  */
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [msg, setMsg] = useState("");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [slowWait, setSlowWait] = useState(false);
  const hadBodyAtStart = useRef(false);
  const bodyAtStart = useRef("");
  const expectedDraftJobId = useRef<number | null>(null);
  const priorDraftJobId = useRef<number | null>(null);
  const priorDraftJobWasOpen = useRef(false);
  const [awaitingDraftJobAck, setAwaitingDraftJobAck] = useState(false);
  const appliedFp = useRef("");
  const reconcileSnapshot = useRef<EditableDraftFields | null>(null);
  const currentDraftFields = useRef<EditableDraftFields>({
    headline: "",
    dek: "",
    body: "",
    topic: "",
  });
  const appliedReconcileJob = useRef<number | null>(null);
  const [reconcileNote, setReconcileNote] = useState("");
  const [reconcileNoteError, setReconcileNoteError] = useState(false);
  const [reconcileNoteWarning, setReconcileNoteWarning] = useState(false);
  const [checkedDraftReady, setCheckedDraftReady] = useState(false);
  const [checkedDraftStale, setCheckedDraftStale] = useState(false);

  const waiting = waitingSince !== null;

  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead({ data: id }),
    refetchInterval: waiting ? 2000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  currentDraftFields.current = { headline, dek, body, topic };
  const reconcileStatus = useQuery({
    queryKey: ["draft-reconcile", id],
    queryFn: () => getDraftReconciliationStatusFn({ data: { leadId: id } }),
    enabled: Boolean(data?.draft?.id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const previousJobError =
    !waiting && !msg && data?.job?.status === "failed"
      ? (editorDraftError(data.job.error) ?? data.job.error ?? "The last draft did not finish.")
      : "";

  useEffect(() => {
    const job = data?.job;
    const recoveredJobId = recoverExpectedDraftJobId({
      expectedJobId: expectedDraftJobId.current,
      priorJobId: priorDraftJobId.current,
      priorJobWasOpen: priorDraftJobWasOpen.current,
      attemptInProgress: waitingSince != null,
      awaitingAcknowledgement: awaitingDraftJobAck,
      job,
    });
    if (recoveredJobId == null || !job) return;
    expectedDraftJobId.current = recoveredJobId;
    if (waitingSince) return;
    hadBodyAtStart.current = Boolean(data?.draft?.body);
    bodyAtStart.current = data?.draft?.body ?? "";
    const started = Date.parse(job.started_at ?? job.created_at ?? "");
    setWaitingSince(Number.isFinite(started) ? started : Date.now());
  }, [awaitingDraftJobAck, data?.draft?.body, data?.job, waitingSince]);

  useEffect(() => {
    if (data?.articleSlug) setPublishedSlug(data.articleSlug);
    const d = data?.draft;
    if (!d) return;
    const fp = `${d.updated_at ?? ""}|${(d.body ?? "").length}|${d.headline ?? ""}`;
    if (!waitingSince) {
      if (appliedFp.current === "") {
        setHeadline(d.headline);
        setDek(d.dek);
        setBody(stripReporterNotebook(d.body ?? ""));
        setTopic(d.topic);
        appliedFp.current = fp;
      }
      return;
    }
    if (
      !expectedDraftJobHasLanded({
        expectedJobId: expectedDraftJobId.current,
        job: data?.job,
        hadBodyAtStart: hadBodyAtStart.current,
        bodyAtStart: bodyAtStart.current,
        startedAt: waitingSince,
        draft: d,
      })
    ) {
      return;
    }
    setHeadline(d.headline);
    setDek(d.dek);
    setBody(stripReporterNotebook(d.body));
    setTopic(d.topic);
    appliedFp.current = fp;
    expectedDraftJobId.current = null;
    priorDraftJobId.current = data.job?.id ?? null;
    priorDraftJobWasOpen.current = false;
    setWaitingSince(null);
    setSlowWait(false);
    setMsg("");
  }, [awaitingDraftJobAck, data, waitingSince]);

  useEffect(() => {
    if (!waitingSince) return;
    if (
      data?.job?.status !== "failed" ||
      expectedDraftJobId.current == null ||
      data.job.id !== expectedDraftJobId.current
    )
      return;
    expectedDraftJobId.current = null;
    priorDraftJobId.current = data.job.id;
    priorDraftJobWasOpen.current = false;
    setWaitingSince(null);
    setSlowWait(false);
    setMsg(editorDraftError(data.job.error) ?? data.job.error ?? "The draft did not finish.");
  }, [data?.job, waitingSince]);

  /*
    A job that looks open (no failure, no landed draft) but whose desk_jobs
    heartbeat has gone cold -- most likely the app restarted mid-draft --
    used to be handled by a `useEffect` here that latched a "stopped, click
    Draft with AI again" message into local state. That message could go
    stale: the next poll would find the reclaim drainer had already re-run
    the same job (fresh heartbeat, still `running`), the effect below would
    re-arm `waitingSince`, and the leftover message never got cleared --
    showing a disabled "Drafting…" button, the pending-notice line, AND the
    stale "click again" notice all at once (the 2026-09-02 incident).
    `resolveDraftJobState` (./desk-copy.ts), used directly in the JSX below,
    replaces that: it derives "drafting" vs "recovering" fresh from the job
    row on every render, so there is nothing left over to contradict a later
    poll.
  */

  useEffect(() => {
    setResearchScope(parseNotes(data?.lead.notes_json).researchScope ?? "public");
    const s = parseNotes(data?.lead.notes_json).scratch ?? "";
    if (s) setScratch(s);
  }, [data?.lead.notes_json]);

  useEffect(() => {
    if (!waitingSince) {
      setSlowWait(false);
      return;
    }
    const slow = window.setTimeout(() => setSlowWait(true), 20_000);
    return () => window.clearTimeout(slow);
  }, [waitingSince]);

  const draft = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      return draftLead({ data: { leadId: id, modelChoice, researchScope } });
    },
    onMutate: () => {
      setMsg("");
      hadBodyAtStart.current = Boolean(data?.draft?.body);
      bodyAtStart.current = data?.draft?.body ?? "";
      priorDraftJobId.current = data?.job?.id ?? null;
      priorDraftJobWasOpen.current =
        data?.job?.status === "queued" || data?.job?.status === "running";
      expectedDraftJobId.current = null;
      setAwaitingDraftJobAck(true);
      setWaitingSince(Date.now());
    },
    onSuccess: async (res) => {
      setAwaitingDraftJobAck(false);
      if (answered(res) && res.ok) expectedDraftJobId.current = res.jobId;
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
      if (!answered(res)) {
        setWaitingSince(null);
        setSlowWait(false);
        setMsg(NO_ANSWER);
        return;
      }
      if (res.ok) return;
      if (looksLikeDraftTimeout(res.error)) return;
      setWaitingSince(null);
      setSlowWait(false);
      /*
        A refusal that arrives with a `kind` came from the provider
        preflight, which already knows exactly what is missing and what to
        do about it. Running that through editorDraftError re-derives the
        answer from the prose and gets it wrong: the guidance mentions
        Claude Code, the mapper matches /claude code/, and the editor is
        told "the writing model did not finish this draft, click Draft with
        AI again" -- a retry that cannot succeed, for a draft that was never
        attempted. Prefer the structured answer over pattern-matching it.

        This used to append `res.detail` (the provider's own raw text) under
        `res.error` (the desk's guidance) -- two stacked messages saying the
        same "no model is set up" thing in different words (owner screenshot,
        2026-09-05). `res.error` alone is the single, specific answer:
        preflight already folds anything `res.detail` would usefully add
        into it (see `scanPreflight` in preflight.ts), so showing both here
        only doubled the copy.
      */
      if ("kind" in res && res.kind) {
        setMsg(res.error);
        return;
      }
      setMsg(editorDraftError(res.error) ?? res.error);
    },
    onError: async (err) => {
      setAwaitingDraftJobAck(false);
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      const raw = err instanceof Error ? err.message : "Draft failed";
      if (looksLikeDraftTimeout(raw)) return;
      setWaitingSince(null);
      setSlowWait(false);
      setMsg(editorDraftError(raw) ?? "The draft did not finish. Click Draft with AI again.");
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      return saveDraft({ data: { leadId: id, headline, dek, body, topic } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setMsg("Saved.");
    },
    onError: (err) => {
      setMsg(err instanceof Error ? err.message : "Could not save.");
    },
  });

  const reviewEvidence = useMutation({
    mutationFn: (decision: EvidenceDecision) =>
      saveDraft({
        data: {
          leadId: id,
          headline,
          dek,
          body,
          topic,
          evidenceDecision: decision,
          evidenceToken: data?.evidenceToken,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setMsg("Saved.");
    },
    onError: (error) =>
      setMsg(error instanceof Error ? error.message : "Evidence review could not be saved."),
  });

  const applyCheckedDraft = async (
    draftId: number,
    expected?: EditableDraftFields,
    explicit = false,
  ) => {
    const checked = await getCheckedDraftResultFn({ data: { leadId: id, draftId } });
    const assessment = assessCheckedDraftResult({
      resultDraftId: checked.id,
      currentDraftId: checked.currentDraftId,
    });
    if (!assessment.safeToAutoLoad && !explicit) {
      setCheckedDraftReady(true);
      setCheckedDraftStale(true);
      setReconcileNoteWarning(true);
      setReconcileNoteError(false);
      setReconcileNote(
        "Evidence check finished, but a newer saved draft exists. The newer draft was kept. Load the checked version only to review it as unsaved text.",
      );
      return false;
    }
    if (expected && !draftFieldsMatch(expected, currentDraftFields.current)) {
      setCheckedDraftReady(true);
      setCheckedDraftStale(false);
      setReconcileNoteWarning(true);
      setReconcileNoteError(false);
      setReconcileNote(
        "Evidence check finished. You typed while it loaded, so your unsaved edits were kept.",
      );
      return false;
    }
    if (assessment.safeToAutoLoad && expected && !explicit) {
      const refreshed = await refetch();
      if (refreshed.isError) throw refreshed.error;
      const refreshedAssessment = assessRefreshedCheckedDraft({
        checkedDraftId: checked.id,
        refreshedDraftId: refreshed.data?.draft?.id ?? null,
        checked: {
          headline: checked.headline,
          dek: checked.dek,
          body: stripReporterNotebook(checked.body ?? ""),
          topic: checked.topic,
        },
        refreshed: refreshed.data?.draft
          ? {
              headline: refreshed.data.draft.headline,
              dek: refreshed.data.draft.dek,
              body: stripReporterNotebook(refreshed.data.draft.body ?? ""),
              topic: refreshed.data.draft.topic,
            }
          : null,
        expected,
        current: currentDraftFields.current,
      });
      if (refreshedAssessment === "stale") {
        setCheckedDraftReady(true);
        setCheckedDraftStale(true);
        setReconcileNoteWarning(true);
        setReconcileNoteError(false);
        setReconcileNote(
          "Evidence check finished, but a newer saved draft exists. The newer draft was kept. Load the checked version only to review it as unsaved text.",
        );
        return false;
      }
      if (refreshedAssessment === "typed") {
        setCheckedDraftReady(true);
        setCheckedDraftStale(false);
        setReconcileNoteWarning(true);
        setReconcileNoteError(false);
        setReconcileNote(
          "Evidence check finished. You typed while it loaded, so your unsaved edits were kept.",
        );
        return false;
      }
    }
    setHeadline(checked.headline);
    setDek(checked.dek);
    setBody(stripReporterNotebook(checked.body ?? ""));
    setTopic(checked.topic);
    appliedFp.current = assessment.safeToAutoLoad
      ? `${checked.updatedAt ?? ""}|${(checked.body ?? "").length}|${checked.headline ?? ""}`
      : "";
    setCheckedDraftReady(false);
    setCheckedDraftStale(false);
    if (!assessment.safeToAutoLoad) {
      setReconcileNoteWarning(true);
      setReconcileNoteError(false);
      setReconcileNote(
        "Checked version loaded for review as unsaved text. A newer saved draft still exists and was not replaced.",
      );
    }
    return true;
  };

  const reconcile = useMutation({
    mutationFn: () => requestDraftReconciliationFn({ data: { leadId: id, modelChoice } }),
    onMutate: () => {
      reconcileSnapshot.current = { ...currentDraftFields.current };
      appliedReconcileJob.current = reconcileStatus.data?.jobId ?? null;
      setCheckedDraftReady(false);
      setReconcileNote("");
      setReconcileNoteError(false);
      setReconcileNoteWarning(false);
      setCheckedDraftStale(false);
    },
    onSuccess: async (result) => {
      if (!answered(result)) {
        setReconcileNote(NO_ANSWER);
        setReconcileNoteError(true);
        return;
      }
      if (!result.ok) {
        setReconcileNote(result.error);
        setReconcileNoteError(true);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["draft-reconcile", id] });
      setReconcileNote("");
    },
    onError: (cause) => {
      setReconcileNote(
        cause instanceof Error ? cause.message : "The evidence check could not be queued.",
      );
      setReconcileNoteError(true);
    },
  });

  useEffect(() => {
    const status = reconcileStatus.data;
    if (!status || status.status !== "completed" || appliedReconcileJob.current === status.jobId)
      return;
    appliedReconcileJob.current = status.jobId;
    const snapshot = reconcileSnapshot.current;
    if (!snapshot) return;
    if (!status.resultDraftId) {
      setReconcileNote(
        "Evidence check finished without identifying its saved result. Reload the page and review the current draft.",
      );
      setReconcileNoteError(true);
      return;
    }
    if (!draftFieldsMatch(snapshot, currentDraftFields.current)) {
      setCheckedDraftReady(true);
      setCheckedDraftStale(false);
      setReconcileNoteWarning(true);
      setReconcileNote(
        "Evidence check finished. You typed while it ran, so your unsaved edits were kept.",
      );
      return;
    }
    void applyCheckedDraft(status.resultDraftId, snapshot)
      .then((loaded) => {
        if (!loaded) return;
        setReconcileNote(
          status.evidenceCheckIncomplete
            ? "Evidence check finished, but no matching saved capture was available. The retained draft is loaded and remains marked for review."
            : "Evidence check finished and the checked saved draft is loaded.",
        );
        setReconcileNoteError(false);
        setReconcileNoteWarning(status.evidenceCheckIncomplete);
      })
      .catch((cause) => {
        setReconcileNote(
          cause instanceof Error ? cause.message : "The checked draft could not be loaded.",
        );
        setReconcileNoteError(true);
        setReconcileNoteWarning(false);
      });
  }, [reconcileStatus.data]);

  const publish = useMutation({
    mutationFn: async () => {
      await saveReportingNotes({
        data: { leadId: id, scratch, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      return publishLead({ data: id });
    },
    onSuccess: async (res) => {
      if (!answered(res)) {
        setMsg(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["paper"] });
      await qc.invalidateQueries({ queryKey: ["published-desk"] });
      setPublishedSlug(res.slug);
      setMsg("On the paper.");
    },
    onError: (err) => {
      setMsg(err instanceof Error ? err.message : "Could not publish.");
    },
  });

  if (isPending) {
    return (
      <DeskShell title="Story" kicker="Workbench">
        <WorkbenchSkeleton />
      </DeskShell>
    );
  }
  if (!data) {
    if (isError) {
      return (
        <DeskShell title="Missing" kicker="Workbench">
          <ScreenError
            message={error instanceof Error ? error.message : "Could not load that lead."}
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        </DeskShell>
      );
    }
    return (
      <DeskShell title="Missing" kicker="Workbench">
        <EmptyState
          kicker="Workbench"
          title="That lead is not on this desk"
          body="It may have been killed, or this copy of the desk never filed it. The queue has what is still open."
          action={
            <Link to="/desk/queue" className="btn">
              Back to queue
            </Link>
          }
        />
      </DeskShell>
    );
  }

  // The one source of truth for what the Draft-with-AI area shows -- see
  // resolveDraftJobState in desk-copy.ts for why this replaced three
  // separately-latched pieces of local state.
  const jobState = resolveDraftJobState(data.job);
  const sources = parseUrlList(data.lead.source_urls);
  const fromDark =
    Boolean(data.lead.investigation_id) ||
    /DARK DESK/i.test(data.lead.why) ||
    data.lead.headline.startsWith("[Dark]");
  const locked = data.lead.status === "killed";
  const onPaper = data.lead.status === "published" || Boolean(publishedSlug);
  const canPublish = Boolean(data.draft) && data.lead.status !== "held" && !locked && !onPaper;
  const found = findingsFrom(data.draft?.found_note);
  const unanswered = unansweredNotes(data.draft?.unanswered);
  const verify = data.draft?.integrity_notes?.trim() || "";
  const notes = parseNotes(data.lead.notes_json);
  if (!notesHaveMemo(notes)) {
    if (!notes.found.length && found.length) {
      notes.found = found.map((f) => ({ t: f.text, src: f.url }));
    }
    if (!notes.todo.length && unanswered.length) {
      notes.todo = unanswered.map((t) => ({ t, done: false, src: "machine" as const }));
    }
    if (!notes.verify.length && verify) notes.verify = [verify];
  }
  const score = data.lead.newsworthiness ?? 0;
  /*
    The "how we report" page promises that leaning on another newsroom's
    reporting gets them named in the body, not just linked. Linking was
    already enforced (see `linkOutletInBody`); naming rested on model
    instruction and an editor's eye alone. This checks the editable draft
    body against the lead's own sources at the moment of publishing, when
    both are final. It only warns -- a source can be background rather than
    something the story hangs on, and that call stays the editor's.
  */
  const draftSources = parseUrlList(data.draft?.source_urls ?? "[]");
  const uncredited = uncreditedOutlets(
    body,
    draftSources.length > 0 || !mayInheritLeadSources(data.draft ?? {}) ? draftSources : sources,
  );
  /*
    Claims of absence block printing until a person has confirmed each one.

    On 2026-09-05 a draft told readers no city survey page, launch release or
    agenda item existed, and treated the city's own published deadline as
    unverified. The city was advertising all of it on its home page. The gate
    that catches those sentences (absence-gate.ts) puts each one here as a
    checkbox; the server refuses to publish while one is unticked, and this
    says so before the editor reaches for the button.
  */
  const evidenceStale = data.draft ? evidenceNeedsReview(data.draft, body) : false;
  const savedDraftFields: EditableDraftFields | null = data.draft
    ? {
        headline: data.draft.headline,
        dek: data.draft.dek,
        body: stripReporterNotebook(data.draft.body ?? ""),
        topic: data.draft.topic,
      }
    : null;
  const hasUnsavedDraftEdits = Boolean(
    savedDraftFields && !draftFieldsMatch(savedDraftFields, { headline, dek, body, topic }),
  );
  const reconcileActive =
    reconcile.isPending ||
    reconcileStatus.data?.status === "queued" ||
    reconcileStatus.data?.status === "running";
  const savePending = save.isPending || reviewEvidence.isPending || publish.isPending;
  const openClaims = uncheckedGateTodos(notes);
  const blockedReason = openClaims.length
    ? openClaims.length === 1
      ? "Confirm the claim of absence first"
      : `Confirm the ${openClaims.length} claims of absence first`
    : "";

  return (
    <DeskShell title={data.lead.headline} kicker="Workbench" hideTitle>
      <Link to="/desk/queue" className="crumb">
        ← Queue
      </Link>
      <div className="story-grid">
        <aside className="story-side">
          <Chip s={data.lead.status} />
          <p className="kick">{fromDark ? "Working notes from Dark Desk" : "The lead"}</p>
          <h2 className="side-h">{data.lead.headline}</h2>
          <p className="side-why">{data.lead.why}</p>
          <p className="meta">
            {data.lead.topic} · filed {formatShortDate(data.lead.created_at)} · scored {score}/20 ·{" "}
            {leadOrigin(data.lead)}
            {data.lead.investigation_id ? (
              <>
                {" · "}
                <Link
                  to="/desk/dark"
                  className="inline-link"
                  onClick={() => {
                    try {
                      sessionStorage.setItem(
                        "townreporter.dark.openId",
                        String(data.lead.investigation_id),
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  Open investigation
                </Link>
              </>
            ) : null}
          </p>
          {fromDark ? (
            <p className="side-note">
              This trail came from Dark Desk. Draft privately here; printing is a separate click and
              every claim still needs evidence.
            </p>
          ) : null}
          {sources.length > 0 ? (
            <div className="side-block">
              <p className="side-label">Sources on the lead</p>
              {sources.map((u) => (
                <p key={u} className="side-url">
                  <a href={u} target="_blank" rel="noreferrer" className="inline-link">
                    {u}
                  </a>
                </p>
              ))}
            </div>
          ) : null}
          <ReportingNotesPane
            leadId={id}
            notes={notes}
            hasDraft={Boolean(data.draft)}
            locked={locked || onPaper}
            openedExtractionByUrl={data.openedExtractionByUrl ?? {}}
          />
        </aside>

        <section className="story-work">
          <StoryDocumentList leadId={id} />
          {!locked && !onPaper ? (
            <DraftScopePicker
              value={researchScope}
              onChange={setResearchScope}
              disabled={waiting}
            />
          ) : null}
          {evidenceStale && !onPaper ? (
            <div className="note publish-blocked" role="status">
              <p>
                The story changed after its evidence was gathered. The previous reporting remains in
                private notes; review the sources and claims below before publishing this version.
              </p>
              <a
                href="#evidence-review"
                className="inline-link"
                onClick={() => {
                  const details = document.getElementById("evidence-review")?.closest("details");
                  if (details) details.open = true;
                }}
              >
                Review claims and sources
              </a>
              <ul>
                {parseUrlList(data.draft?.source_urls ?? "[]").map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer" className="inline-link">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 mt-2">
                <InkButton
                  disabled={reviewEvidence.isPending}
                  onClick={() => reviewEvidence.mutate("keep")}
                >
                  I checked: keep this evidence
                </InkButton>
                <InkButton
                  tone="ghost"
                  disabled={reviewEvidence.isPending}
                  onClick={() => reviewEvidence.mutate("remove")}
                >
                  Remove old evidence from public story
                </InkButton>
              </div>
              <p>
                Remove clears the old public source list, reporting trail, findings and unanswered
                questions; it keeps their private audit copy and does not edit your body or its
                links.
              </p>
            </div>
          ) : null}
          <div className="work-bar">
            {!locked && !onPaper ? (
              <>
                <ModelPicker
                  value={modelChoice}
                  onChange={setModelChoice}
                  disabled={waiting || reconcileActive || savePending}
                  compact
                />
                <InkButton
                  disabled={waiting || reconcileActive}
                  onClick={() => {
                    if (waiting) return;
                    draft.mutate();
                  }}
                >
                  {jobState === "recovering"
                    ? "Recovering…"
                    : waiting
                      ? "Drafting…"
                      : data.draft?.body
                        ? "Redraft"
                        : "Draft with AI"}
                </InkButton>
              </>
            ) : null}
            {data.draft && !locked && !onPaper ? (
              <>
                <InkButton
                  tone="ghost"
                  disabled={save.isPending || reconcileActive}
                  onClick={() => save.mutate()}
                >
                  Save edits
                </InkButton>
                <DraftReconcileControl
                  status={reconcileStatus.data}
                  active={reconcileActive}
                  disabled={waiting || reconcileActive || savePending || hasUnsavedDraftEdits}
                  dirty={hasUnsavedDraftEdits}
                  note={reconcileNote}
                  noteError={reconcileNoteError}
                  noteWarning={reconcileNoteWarning}
                  checkedDraftReady={checkedDraftReady}
                  checkedDraftStale={checkedDraftStale}
                  onStart={() => reconcile.mutate()}
                  onReload={() => {
                    const resultDraftId = reconcileStatus.data?.resultDraftId;
                    if (!resultDraftId) return;
                    void applyCheckedDraft(resultDraftId, undefined, true).catch((cause) => {
                      setReconcileNote(
                        cause instanceof Error
                          ? cause.message
                          : "The checked draft could not be loaded.",
                      );
                      setReconcileNoteError(true);
                      setReconcileNoteWarning(false);
                    });
                  }}
                />
                {canPublish ? (
                  confirmingPublish ? (
                    <>
                      <span className="note">
                        This puts the story on the public paper and in the feed, under your name,
                        now. Corrections are published, not silent edits.
                      </span>
                      {uncredited.length > 0 ? (
                        <span className="note">
                          {uncredited.length === 1
                            ? `The body never names ${uncredited[0]}, though it's in the sources. If the story leans on their reporting, we said we'd say so.`
                            : `The body never names ${uncredited.join(" or ")}, though they're in the sources. If the story leans on their reporting, we said we'd say so.`}
                        </span>
                      ) : null}
                      <InkButton
                        disabled={
                          publish.isPending ||
                          evidenceStale ||
                          reviewEvidence.isPending ||
                          reconcileActive
                        }
                        onClick={() => {
                          setConfirmingPublish(false);
                          publish.mutate();
                        }}
                      >
                        {publish.isPending ? "Publishing…" : "Yes, print it"}
                      </InkButton>
                      <InkButton tone="quiet" onClick={() => setConfirmingPublish(false)}>
                        Not yet
                      </InkButton>
                    </>
                  ) : (
                    <>
                      <InkButton
                        disabled={
                          publish.isPending ||
                          !headline.trim() ||
                          !body.trim() ||
                          openClaims.length > 0 ||
                          evidenceStale ||
                          reviewEvidence.isPending ||
                          reconcileActive
                        }
                        onClick={() => setConfirmingPublish(true)}
                      >
                        Publish to the paper
                      </InkButton>
                      {/*
                        A greyed button with no sentence beside it is a dead
                        end -- the editor cannot tell whether it is broken,
                        still loading, or refusing on purpose. The reason is
                        text, not opacity, and it points at the work.
                      */}
                      {blockedReason ? (
                        <span className="note publish-blocked">
                          {blockedReason} — see “Claims of absence” in reporting notes.
                        </span>
                      ) : null}
                    </>
                  )
                ) : null}
              </>
            ) : null}
            {onPaper ? (
              <p className="note">
                On the paper.{" "}
                <Link to="/desk/published" className="inline-link">
                  See it under Published
                </Link>
                {publishedSlug ? (
                  <>
                    {" · "}
                    <Link
                      to="/articles/$slug"
                      params={{ slug: publishedSlug }}
                      className="inline-link"
                    >
                      Read it on the paper
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {/*
            One message for the whole "a draft job is open" span, chosen by
            resolveDraftJobState so it can never contradict the button above:
            "recovering" gets the calm restart notice below, everything else
            (queued, or running with a live heartbeat) gets the ordinary
            progress line. The "click dropped" wording is deliberately
            confined to the genuinely-pending case -- it never renders next to
            a failure or recovery notice (2026-09-02 incident).
          */}
          {waiting && jobState === "recovering" ? (
            <Notice kind="warn">{recoveringDraftCopy()}</Notice>
          ) : waiting ? (
            <Busy
              label={
                slowWait
                  ? "The writing pass is still running. This page will show the draft when it is ready."
                  : researchScope === "supplied"
                    ? "Drafting from your supplied material. Stay on this page."
                    : "Reporting first — following the trail, then drafting. Stay on this page."
              }
            />
          ) : null}
          {publish.isPending ? <Busy label="Sending this to the paper…" /> : null}
          {(msg || previousJobError) && !onPaper ? (
            <Notice kind={msg === "Saved." ? "ok" : "err"}>
              {msg || previousJobError}
              {/*
                The one error the desk could describe but never act on. A
                lapsed CLI login used to end at "sign in again", which meant a
                terminal; this starts the sign-in and hands over to the Server
                page. It renders only when the error really is that.
              */}
              <ProviderSignInButton detail={msg || previousJobError} />
            </Notice>
          ) : null}

          {data.draft || body ? (
            <form className="work-form" onSubmit={(e) => e.preventDefault()}>
              <Field label="Headline">
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              <Field label="Dek">
                <input value={dek} onChange={(e) => setDek(e.target.value)} disabled={onPaper} />
              </Field>
              <Field label="Topic">
                <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={onPaper}>
                  {TOPICS.filter((t) => t !== "about").map((t) => (
                    <option key={t} value={t}>
                      {sections.find((s) => s.key === t)?.name ?? t}
                    </option>
                  ))}
                  {topic && !TOPICS.includes(topic as (typeof TOPICS)[number]) ? (
                    <option value={topic}>{topic}</option>
                  ) : null}
                </select>
              </Field>
              <Field label="Body">
                <textarea
                  rows={16}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              <Field
                label="Pulled notes"
                chip="does not print"
                hint="Redraft reads this box. Nothing here prints."
              >
                <textarea
                  rows={8}
                  value={scratch}
                  onChange={(e) => setScratch(e.target.value)}
                  disabled={onPaper}
                  placeholder="Pull a still-to-pull line and the excerpt lands here. Cut and paste into the story."
                />
              </Field>
              {data.draft?.form ? <p className="meta">Form · {data.draft.form}</p> : null}
              {data.job?.failover_note ? (
                <p className="meta">Model note: {data.job.failover_note}</p>
              ) : null}
            </form>
          ) : waiting ? null : (
            <p className="meta" style={{ marginTop: 14 }}>
              {locked
                ? "This lead was killed. Nothing to draft."
                : "No draft yet. Draft with AI writes a first pass from the lead and its sources; you edit, then publish."}
            </p>
          )}
          {data.draft ? (
            <FindingEvidenceReviewPanel
              leadId={id}
              reviewRevision={data.evidenceToken}
              currentDraft={{ headline, dek, body, topic }}
              disabled={
                locked ||
                onPaper ||
                waiting ||
                save.isPending ||
                reviewEvidence.isPending ||
                reconcileActive
              }
            />
          ) : null}
        </section>
      </div>
    </DeskShell>
  );
}

function looksLikeDraftTimeout(raw: string): boolean {
  return /timeout|timed out|aborted|abort|network|failed to fetch|load failed|504|503|502|econnreset|socket hang up|unexpected server error|gateway/i.test(
    raw,
  );
}

function findingsFrom(raw: string | null | undefined): { text: string; url?: string }[] {
  if (!raw?.trim()) return [];
  let value: unknown = raw;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return [{ text: raw.trim().slice(0, 1200) }];
  }
  const rows = Array.isArray(value) ? value : [value];
  const out: { text: string; url?: string }[] = [];
  for (const row of rows) {
    if (typeof row === "string" && row.trim()) {
      out.push({ text: row.trim().slice(0, 1200) });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const text = String(o.text ?? o.found ?? "").trim();
    if (!text) continue;
    const urls = Array.isArray(o.source_urls) ? o.source_urls.map(String) : [];
    out.push({ text: text.slice(0, 1200), url: urls[0] });
  }
  return out.slice(0, 6);
}

function unansweredNotes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function usePhoneNotes() {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const go = () => setSmall(mq.matches);
    go();
    mq.addEventListener("change", go);
    return () => mq.removeEventListener("change", go);
  }, []);
  return small;
}

function ReportingNotesPane({
  leadId,
  notes,
  hasDraft,
  locked,
  openedExtractionByUrl,
}: {
  leadId: number;
  notes: ReportingNotes;
  hasDraft: boolean;
  locked: boolean;
  /** Capture-time extraction method for each `notes.opened` url, when known (see getLead). */
  openedExtractionByUrl: Record<string, string | null>;
}) {
  const qc = useQueryClient();
  const [line, setLine] = useState("");
  const [pulling, setPulling] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const small = usePhoneNotes();
  const filled = notesHaveMemo(notes);
  const verifyItems = notes.verify.flatMap(integrityNoteItems);

  /*
    "People who still need to respond" (Direction A stage 1, the Follow-ups
    object). Today this is the only place a follow-up is created; the rail
    on /desk and /desk/follow-ups both read the same rows.
  */
  const followUps = useQuery({
    queryKey: ["follow-ups", "lead", leadId],
    queryFn: () => listFollowUps({ data: { limit: 50 } }),
  });
  const leadFollowUps = (followUps.data ?? []).filter((f) => f.lead_id === leadId);
  const [addingFollowUp, setAddingFollowUp] = useState(false);
  const [fuWho, setFuWho] = useState("");
  const [fuWhat, setFuWhat] = useState("");
  const [fuDue, setFuDue] = useState("");
  const addFollowUp = useMutation({
    mutationFn: () =>
      createFollowUp({
        data: { leadId, who: fuWho.trim(), what: fuWhat.trim(), dueOn: fuDue || null },
      }),
    onSuccess: (res) => {
      if (res?.ok) {
        setFuWho("");
        setFuWhat("");
        setFuDue("");
        setAddingFollowUp(false);
        void qc.invalidateQueries({ queryKey: ["follow-ups"] });
        announceToDesk("Follow-up added.");
      } else {
        announceToDesk((res && "error" in res && res.error) || "Could not add that follow-up.");
      }
    },
  });

  const save = useMutation({
    mutationFn: (input: { add?: string; toggle?: number; todos: ReportingNotes["todo"] }) =>
      saveReportingNotes({ data: { leadId, ...input } }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["lead", leadId] });
      const previous = qc.getQueryData(["lead", leadId]);
      qc.setQueryData(["lead", leadId], (old: typeof previous) => {
        if (!old || typeof old !== "object" || !("lead" in old) || !old.lead) return old;
        const lead = old.lead as { notes_json?: string | null };
        const next = applyTodoPatch(parseNotes(lead.notes_json), input);
        return {
          ...old,
          lead: { ...lead, notes_json: JSON.stringify(next) },
        };
      });
      if (input.add) setLine("");
      return { previous };
    },
    onError: (_err, input, ctx) => {
      if (ctx?.previous) qc.setQueryData(["lead", leadId], ctx.previous);
      if (input.add) setLine(input.add);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
  });

  const pull = useMutation({
    mutationFn: (input: { index: number; query: string }) =>
      pullTodo({ data: { leadId, query: input.query, index: input.index } }),
    onMutate: (input) => {
      setPulling(input.index);
      setPullMsg("");
    },
    onSuccess: (res) => {
      setPulling(null);
      if (!answered(res)) {
        setPullMsg(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setPullMsg(res.error);
        return;
      }
      // Say when pages were found and rejected. "Nothing found" and "found
      // four documents, none of them about this story" are different answers,
      // and the second one means the line needs rewording, not retrying.
      const off = res.offSubject
        ? ` Skipped ${res.offSubject} page${res.offSubject === 1 ? "" : "s"} that named neither the city nor the subject.`
        : "";
      setPullMsg(
        res.found
          ? `Dropped ${res.found} page${res.found === 1 ? "" : "s"} under the story.${off}`
          : `Nothing public found for that line.${off}`,
      );
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: (err) => {
      setPulling(null);
      setPullMsg(err instanceof Error ? err.message : "Pull failed.");
    },
  });

  /*
    Claims of absence get their own block, above everything else in the notes.

    They are not to-dos. A to-do is work the story would be better for; one of
    these is a sentence already in the story asserting that a public document
    does not exist, and printing it unchecked is how the paper prints something
    false. The checkbox is the editor saying they opened the city's site.
  */
  const gateClaims = notes.todo.map((t, i) => ({ t, i })).filter((row) => row.t.src === "gate");
  const absenceBlock = gateClaims.length ? (
    <div className="note-sec note-gate">
      <p className="side-label">Verify before print · Claims of absence</p>
      <p className="note-one">
        The story says these documents are not there. Open the city's own site and confirm each one.
        Publishing is blocked until every box is ticked.
      </p>
      {gateClaims.map((row) => (
        <div key={`gate-${row.i}-${row.t.t}`} className="gate-claim-block">
          <label className="gate-claim">
            <input
              type="checkbox"
              checked={row.t.done}
              disabled={locked || save.isPending}
              onChange={() => save.mutate({ toggle: row.i, todos: notes.todo })}
            />
            <span>
              <span className="gate-claim-t">{row.t.t}</span>
              {row.t.q ? <span className="gate-claim-q">{row.t.q}</span> : null}
              <span className="gate-claim-ack">I opened the city site and confirmed this</span>
            </span>
          </label>
          {row.t.queries?.length ? (
            // Kept out of the <label> on purpose: a <details> is itself an
            // interactive element, and nesting it inside the label risks the
            // checkbox toggling on a click meant only to expand the list.
            <details className="gate-claim-queries">
              <summary>
                {row.t.queries.length} search{row.t.queries.length === 1 ? "" : "es"} TownReporter
                already ran
              </summary>
              <ul>
                {row.t.queries.map((q, qi) => (
                  <li key={`gate-${row.i}-q-${qi}`}>
                    <code>{q.query}</code>
                    <span className="gate-claim-query-outcome">
                      {q.hit ? " — found a match" : " — no match"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ))}
    </div>
  ) : null;

  const todoList = (prefix: string) =>
    notes.todo.filter((t) => t.src !== "gate").length ? (
      <div className="note-sec">
        <p className="side-label">Still to pull</p>
        {notes.todo.map((t, i) =>
          t.src === "gate" ? null : (
            <TodoRow
              key={`${prefix}-${t.src}-${t.t}-${i}`}
              item={t}
              disabled={locked}
              pulling={pulling === i}
              onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
              onPull={() => pull.mutate({ index: i, query: t.t })}
            />
          ),
        )}
        <p className="note-hint">
          Pull searches that line and drops the excerpt in the box under the story. The checkbox
          just strikes it.
        </p>
        {pullMsg ? <p className="note-one">{pullMsg}</p> : null}
      </div>
    ) : null;

  const inner = (
    <div className="notes" id="evidence-review">
      {!small ? (
        <div className="notes-head">
          <p className="side-label" style={{ margin: 0 }}>
            Reporting notes
          </p>
          <span className="chip dnp">does not print</span>
        </div>
      ) : null}
      {!filled ? (
        <>
          <p className="note-one" style={{ marginTop: small ? 0 : 8 }}>
            {hasDraft
              ? "This draft was written before notes were kept. Redraft fills them; lines you add stay."
              : "Draft with AI fills this. You can add a line."}
          </p>
          {absenceBlock}
          {todoList("empty")}
        </>
      ) : (
        <>
          {notes.news ? (
            <div className="note-sec">
              <p className="side-label">The news</p>
              <p className="note-one">{notes.news}</p>
            </div>
          ) : null}
          {notes.why ? (
            <div className="note-sec">
              <p className="side-label">Why it matters</p>
              <p className="note-one">{notes.why}</p>
            </div>
          ) : null}
          {notes.angle ? (
            <div className="note-sec">
              <p className="side-label">Angle</p>
              <p className="note-one">{notes.angle}</p>
            </div>
          ) : null}
          {absenceBlock}
          {todoList("filled")}
          {notes.found.length ? (
            <div className="note-sec">
              <p className="side-label">Claims and sources</p>
              {notes.found.map((f) => (
                <p key={f.t} className="note-one">
                  {f.t}
                  {f.src ? (
                    <span className="meta-inline">
                      {" · "}
                      <a href={f.src} target="_blank" rel="noreferrer" className="inline-link">
                        {f.src}
                      </a>
                    </span>
                  ) : null}
                </p>
              ))}
            </div>
          ) : null}
          {verifyItems.length ? (
            <div className="note-sec">
              <p className="side-label">Verify before print</p>
              {verifyItems.map((v) => (
                <p key={v} className="note-one">
                  {v}
                </p>
              ))}
            </div>
          ) : null}
          {notes.opened.length ? (
            <div className="note-sec">
              <p className="side-label">Documents opened for this draft</p>
              {notes.opened.map((d) => {
                const method = openedExtractionByUrl[d.url] ?? null;
                const raw = (method ?? "").trim();
                const ocrLine = /^(ocr|needs-ocr):/.test(raw)
                  ? describeExtractionMethod(raw)
                  : null;
                return (
                  <p key={d.url} className="note-one">
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-link">
                      {d.title}
                    </a>
                    {/* Which of the memo's own asks this document was pulled to answer. */}
                    {d.for ? <span className="opened-for">for: {d.for}</span> : null}
                    {ocrLine ? <span className="opened-for">{ocrLine}</span> : null}
                  </p>
                );
              })}
            </div>
          ) : null}
        </>
      )}
      <div className="note-sec">
        <p className="side-label">People who still need to respond</p>
        {followUpsRailCopy(followUps.isError) ? (
          <p className="note-one">{followUpsRailCopy(followUps.isError)}</p>
        ) : leadFollowUps.length === 0 ? (
          <p className="note-one">No one owes you an answer on this story right now.</p>
        ) : (
          leadFollowUps.map((f) => (
            <FollowUpItem
              key={f.id}
              item={f}
              onReply={
                f.status === "open"
                  ? (replyText, repliedOn) => {
                      // The server appends the reply to this lead's own
                      // "found" notes too; refresh both.
                      void recordFollowUpReply({ data: { id: f.id, replyText, repliedOn } }).then(
                        () => {
                          void qc.invalidateQueries({ queryKey: ["follow-ups"] });
                          void qc.invalidateQueries({ queryKey: ["lead", leadId] });
                          announceToDesk("Reply recorded.");
                        },
                      );
                    }
                  : undefined
              }
              onDrop={
                f.status === "open"
                  ? () => {
                      void dropFollowUp({ data: { id: f.id } }).then(() => {
                        void qc.invalidateQueries({ queryKey: ["follow-ups"] });
                        announceToDesk("Follow-up dropped.");
                      });
                    }
                  : undefined
              }
              onNudge={
                f.status === "open"
                  ? () => {
                      void nudgeFollowUp({ data: { id: f.id } }).then(() => {
                        void qc.invalidateQueries({ queryKey: ["follow-ups"] });
                        announceToDesk("Nudge stamped.");
                      });
                    }
                  : undefined
              }
            />
          ))
        )}
        {!locked ? (
          addingFollowUp ? (
            <div className="note-add followup-reply-form">
              <input
                value={fuWho}
                onChange={(e) => setFuWho(e.target.value)}
                placeholder="Who — e.g. City Manager's office"
              />
              <input
                value={fuWhat}
                onChange={(e) => setFuWhat(e.target.value)}
                placeholder="For what — one line"
              />
              <input
                type="date"
                value={fuDue}
                onChange={(e) => setFuDue(e.target.value)}
                aria-label="Due date"
              />
              <InkButton
                small
                tone="ghost"
                disabled={!fuWho.trim() || !fuWhat.trim() || addFollowUp.isPending}
                onClick={() => addFollowUp.mutate()}
              >
                Save
              </InkButton>
              <InkButton small tone="quiet" onClick={() => setAddingFollowUp(false)}>
                Cancel
              </InkButton>
            </div>
          ) : (
            <InkButton small tone="ghost" onClick={() => setAddingFollowUp(true)}>
              Add a follow-up
            </InkButton>
          )
        ) : null}
      </div>
      {!locked ? (
        <div className="note-add">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (line.trim()) save.mutate({ add: line.trim(), todos: notes.todo });
              }
            }}
            placeholder="Your own line — a call to make, a record to pull"
          />
          <InkButton
            small
            tone="ghost"
            disabled={!line.trim() || save.isPending}
            onClick={() => save.mutate({ add: line.trim(), todos: notes.todo })}
          >
            Add
          </InkButton>
        </div>
      ) : null}
    </div>
  );

  if (small) {
    return (
      <details className="notes-disc">
        <summary>
          Reporting notes <span className="chip dnp">does not print</span>
        </summary>
        {inner}
      </details>
    );
  }
  return inner;
}

function TodoRow({
  item,
  disabled,
  pulling,
  onToggle,
  onPull,
}: {
  item: ReportingNotes["todo"][number];
  disabled: boolean;
  pulling: boolean;
  onToggle: () => void;
  onPull: () => void;
}) {
  return (
    <div className={"todo-row" + (item.done ? " done" : "")}>
      <button
        type="button"
        className={"todo" + (item.done ? " done" : "")}
        title={item.done ? "Struck — click to restore" : "Click to mark this pulled"}
        aria-pressed={item.done}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="todo-box" />
        <span className="todo-t">{item.t}</span>
        {item.src === "you" ? <span className="todo-src">yours</span> : null}
      </button>
      {!disabled && !item.done ? (
        <button type="button" className="todo-pull" disabled={pulling} onClick={onPull}>
          {pulling ? "Pulling…" : "Pull"}
        </button>
      ) : null}
    </div>
  );
}
