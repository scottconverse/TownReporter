import { StoryBody } from "@/components/story-body";
import { KilledLeadRecord, LeadComparePanel } from "@/components/desk-lead-compare";
import { StoryDocumentList, StoryDocumentPartialNotice } from "@/components/story-documents";
import { DeskNameCheck } from "@/components/desk-name-check";
import { MeetingSourceBlock } from "@/components/meeting-source-block";
import { meetingClock } from "@/components/meeting-source-block-utils";
import { DraftScopePicker } from "@/components/draft-scope-picker";
import {
  evidenceNeedsReview,
  mayInheritLeadSources,
  type EvidenceDecision,
} from "@/lib/news/draft-evidence";
import { auditDraft } from "@/lib/news/draft-audit";
import { parseStyleRecord } from "@/lib/news/draft-audit-record";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Busy, Chip, DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { leadOrigin, announceToDesk } from "@/components/desk-chrome-utils";
import { EmptyState, WorkbenchSkeleton, Notice, ScreenError } from "@/components/states";
import {
  createFollowUp,
  dropFollowUp,
  draftLead,
  fixDraftStyle,
  getLead,
  getDraftHistoryItem,
  listDraftHistory,
  listPullJobs,
  listFollowUps,
  nudgeFollowUp,
  publishLead,
  pullTodo,
  resolveDraftMeetingReview,
  continuePullJob,
  overrideNamedOutlet,
  recordFollowUpReply,
  resolveLeadDuplicate,
  saveDraft,
  saveReportingNotes,
  setLeadStatus,
  stopPullJob,
  suggestHeadlines,
  updateArticleHeadline,
} from "@/lib/news/desk";
import type { PullRunView } from "@/lib/news/pull.server";
import { FollowUpItem } from "@/components/follow-up-item";
import { uncreditedOutlets } from "@/lib/news/source-credit";
import { parseUrlList } from "@/lib/paper";
import { useEditorSections } from "@/lib/use-sections";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import {
  applyTodoPatch,
  mergeDraftEvidenceIntoNotes,
  notesHaveMemo,
  parseNotes,
  uncheckedGateTodos,
  type ReportingNotes,
} from "@/lib/news/notes";
import {
  duplicateKillReason,
  editorActionError,
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
import {
  modelChoiceLabel,
  rememberedStoryModelChoice,
  retiredModelChoiceNote,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import { defaultModelEffort, modelEffort as validatedModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { integrityNoteItems } from "@/lib/news/coerce-draft";
import {
  DraftReconcileControl,
  type EvidenceCheckReview,
} from "@/components/draft-reconcile-control";
import {
  assessCheckedDraftResult,
  assessRefreshedCheckedDraft,
  draftFieldsMatch,
  getCheckedDraftResultFn,
  getDraftReconciliationStatusFn,
  requestDraftReconciliationFn,
  type CheckedDraftResult,
  type EditableDraftFields,
} from "@/lib/news/draft-reconcile-actions";
import { parseDraftCompletionReceipt } from "@/lib/news/draft-completion";
import type { DraftMeetingEvidence } from "@/lib/news/meeting-draft-transcript-link";

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

/**
 * Where a style finding is, in words the editor can find on the page.
 *
 * Paragraph 0 is the headline and the dek, which print together above the
 * body (`draft-audit.ts`), so it is named rather than numbered.
 */
function styleLocation(finding: { paragraph: number; sentence: number }): string {
  return finding.paragraph === 0
    ? "Headline and dek"
    : `Paragraph ${finding.paragraph}, sentence ${finding.sentence}`;
}

function StoryPage() {
  const [inspector, setInspector] = useState<"checks" | "sources" | "reporting">("checks");
  const preview = useRef<HTMLDialogElement>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const { sections } = useEditorSections();
  const TOPICS = sections.map((s) => s.key);
  /* The section's reader-facing name, for the sentences and the button that
     name it. Falls back to the key, which is what the desk stored. */
  const sectionName = (key: string) => sections.find((s) => s.key === key)?.name ?? key;
  const { formatShortDate } = usePaperDateFormatters();
  const { leadId } = Route.useParams();
  const id = Number(leadId);
  const qc = useQueryClient();
  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    const resize = () => {
      for (const el of document.querySelectorAll<HTMLTextAreaElement>(
        ".astra-headline,.astra-dek,.astra-story-body",
      )) {
        el.style.height = "auto";
        el.style.height = `${Math.max(el === bodyField.current ? 480 : 50, el.scrollHeight)}px`;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [body, headline, dek]);
  const [topic, setTopic] = useState("council");
  const [scratch, setScratch] = useState("");
  const [storyDirection, setStoryDirection] = useState("");
  const [researchScope, setResearchScope] = useState<"public" | "supplied">("public");
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(null);
  const [modelResearchOpen, setModelResearchOpen] = useState(false);
  const modelResearchPanel = useRef<HTMLElement>(null);
  const modelChoiceTouched = useRef(false);
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
  /*
    Whether a person has chosen the section on this page (0.6.67).

    The select shows a section from the moment the page loads: the model's when
    the model named one, the desk's fallback guess when it did not. Publish
    carries the section the editor is looking at and the server records that as
    the confirmation for the version it prints, so the desk must never send
    that guess on its own. Showing a section the model chose and pressing the
    button is a person confirming it. For a lead the model filed nowhere
    (`topic_unchosen`) the same press would be printing a guess, so the request
    carries nothing until this flips -- and the server, with no section and no
    stored confirmation for this draft version, refuses.
  */
  const [topicTouched, setTopicTouched] = useState(false);
  /*
    Headline suggestions are held here and applied on a click, never before --
    the whole contract of the button. The note is the page's own line about
    the last headline action, shown beside the box: on a published story the
    draft area's notice is not rendered at all, so a headline change there
    would otherwise happen silently.
  */
  const [headlineSuggestions, setHeadlineSuggestions] = useState<string[]>([]);
  const [headlineNote, setHeadlineNote] = useState("");
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [slowWait, setSlowWait] = useState(false);
  /*
   * Unit AK item 5: whether the side-by-side view is open. `null` means the
   * editor has not said, and the panel follows the data: a lead the scanner
   * filed against another one opens with the comparison showing, because that
   * is the question the lead is asking. The press can close it.
   */
  const [compareOpen, setCompareOpen] = useState<boolean | null>(null);
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
  const [evidenceReview, setEvidenceReview] = useState<EvidenceCheckReview | null>(null);
  const [evidenceReviewOpen, setEvidenceReviewOpen] = useState(false);

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
  const draftProblem = msg || previousJobError;

  useEffect(() => {
    if (!modelResearchOpen) return;
    const frame = requestAnimationFrame(() => {
      modelResearchPanel.current?.scrollIntoView({ block: "nearest" });
      modelResearchPanel.current
        ?.querySelector<HTMLSelectElement>("select")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [modelResearchOpen]);

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
        /*
          On a published story the box starts from what the paper prints, not
          from the draft: the headline is the article's field and may have been
          changed after the story went up. An edit here then continues from the
          reader's headline instead of silently reverting it to the draft's.
        */
        setHeadline(data?.articleId && data.articleHeadline ? data.articleHeadline : d.headline);
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
    const completion = parseDraftCompletionReceipt(data.job?.result_json);
    setMsg(completion?.quality.reviewRequired
      ? "Draft saved. Review the source and name-check warnings before publication."
      : "Draft saved.");
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
    const notes = parseNotes(data?.lead.notes_json);
    setResearchScope(notes.researchScope ?? "public");
    setStoryDirection(notes.editorialAssignment?.text ?? "");
    const s = notes.scratch ?? "";
    if (s) setScratch(s);
  }, [data?.lead.notes_json]);

  useEffect(() => {
    if (!data?.job || modelChoiceTouched.current) return;
    const remembered = rememberedStoryModelChoice(data.job.model_choice, data.job.model_choice_source);
    setModelChoice(remembered);
    try {
      const receipt = JSON.parse(data.job.result_json || "{}") as { modelEffort?: unknown };
      setModelEffort(validatedModelEffort(remembered, receipt.modelEffort));
    } catch {
      setModelEffort(defaultModelEffort(remembered));
    }
  }, [data?.job]);

  /*
    0.6.63 (Unit Y item 4): a job row that still holds the retired Grok choice
    runs on Automatic -- `modelChoice` above is already normalised, so the note
    has to be read from the stored row, or the editor would see "Automatic"
    with no explanation of where their pick went.
  */
  const retiredModelNote = retiredModelChoiceNote(data?.job?.model_choice);

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
        data: { leadId: id, scratch, storyDirection, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      return draftLead({ data: { leadId: id, modelChoice, modelEffort, researchScope } });
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

  const draftMeetingReview = useMutation({
    mutationFn: (input: { confirmedSegmentIndexes: number[]; note: string }) => {
      if (!data?.draft?.id || !data.evidenceToken || !data.draftMeetingEvidence?.currentArtifactId) {
        throw new Error("The current draft or transcript comparison is unavailable. Reload this story first.");
      }
      return resolveDraftMeetingReview({ data: {
        leadId: id,
        draftId: Number(data.draft.id),
        evidenceToken: data.evidenceToken,
        acceptedArtifactId: data.draftMeetingEvidence.currentArtifactId,
        confirmedSegmentIndexes: input.confirmedSegmentIndexes,
        note: input.note,
      } });
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
      setMsg("Citation review saved against the current transcript. The draft text and original evidence remain unchanged.");
      await qc.invalidateQueries({ queryKey: ["lead", id] });
    },
    onError: (error) =>
      setMsg(
        editorActionError(error instanceof Error ? error.message : "", "save the citation review") ??
          "Could not save the citation review.",
      ),
  });

  /*
    Saving the reporting notes cannot stop the story (0.6.67).

    Save edits and Publish both `await`ed the notes save first, with no error
    handling around it. The notes carry the running checklist that machine
    passes write into, so one machine-written line past the length the wire
    accepted made that save throw -- and a valid draft could not be saved or
    printed, ending at a raw schema dump the editor could do nothing with
    (lead 240: a 227-character to-do, "too_big", "maximum", path "todos,0,t").

    The notes are the desk's working file, not the story. A failure here is
    returned as a sentence and the draft save goes ahead; both callers put that
    sentence in front of the editor next to what did happen.
  */
  const saveNotesQuietly = useCallback(async (): Promise<string> => {
    try {
      await saveReportingNotes({
        data: { leadId: id, scratch, storyDirection, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      return "";
    } catch (err) {
      return (
        editorActionError(err instanceof Error ? err.message : "", "save your reporting notes") ??
        "Your reporting notes did not save."
      );
    }
  }, [id, scratch, storyDirection, researchScope, data?.lead.notes_json]);

  const save = useMutation({
    mutationFn: async () => {
      const notesProblem = await saveNotesQuietly();
      await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      return { notesProblem };
    },
    onSuccess: async ({ notesProblem }) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setMsg(notesProblem ? `Saved. ${notesProblem}` : "Saved.");
    },
    onError: (err) => {
      setMsg(
        editorActionError(err instanceof Error ? err.message : "", "save your edits") ??
          "Could not save.",
      );
    },
  });

  /*
    Overriding a named-outlet block: one outlet at a time, for this draft. The
    server checks the draft still names that outlet and its Sources still do
    not show it, so this button cannot record a decision about a claim the
    editor was never looking at. What it writes -- who, when, which outlet,
    which draft -- is the paper's record, and the desk shows it back below.
  */
  const overrideOutlet = useMutation({
    mutationFn: (outlet: string) => overrideNamedOutlet({ data: { leadId: id, outlet } }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setMsg(
        res.ok
          ? `Recorded: you overrode the outlet check for ${res.outlet} on this draft.`
          : res.error,
      );
    },
    onError: (err) => {
      setMsg(
        editorActionError(err instanceof Error ? err.message : "", "record the override") ??
          "Could not record the override.",
      );
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
      setMsg(
        editorActionError(error instanceof Error ? error.message : "", "save the evidence review") ??
          "Evidence review could not be saved.",
      ),
  });

  /*
    "Fix these with the model": ONE round, on the text on this page, with the
    model the picker is set to. The server saves what comes back as an ordinary
    draft revision -- nothing publishes -- and a rewrite that would have
    changed a quotation, a number, a name or a link is refused there, so the
    text the editor gets back is either the repair or exactly what was sent.

    No findings, no call: the button is only offered when the check above found
    something to fix.
  */
  const fixStyle = useMutation({
    mutationFn: () =>
      fixDraftStyle({ data: { leadId: id, headline, dek, body, topic, modelChoice, modelEffort } }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setBody(res.body);
      setMsg(res.note);
    },
    onError: (err) => {
      setMsg(
        editorActionError(err instanceof Error ? err.message : "", "fix the style findings") ??
          "The style repair did not run. Your draft is unchanged.",
      );
    },
  });

  /*
    The style check, measured on the text on screen rather than read back from
    the stored record: the editor's unsaved edits are exactly what they are
    looking at, and this measurement is pure, so keeping it current costs
    nothing and cannot go stale. The same measurement runs when the desk writes
    a draft and when the editor saves; the stored copy is what the completion
    receipt and the evidence record read.

    Nothing here is a verdict and nothing here blocks: every finding is
    advisory, and the editor may ignore all of it.
  */
  const styleCheck = useMemo(
    () => auditDraft({ headline, dek, body, form: data?.draft?.form ?? "" }),
    [headline, dek, body, data?.draft?.form],
  );
  const styleFixes = styleCheck.findings.filter((finding) => finding.severity === "fix");
  const styleReviews = styleCheck.findings.filter((finding) => finding.severity === "review");
  /* What the desk said last time it measured this draft, from the record saved
     with it -- the plain sentence the repair or the save wrote. */
  const styleNote = useMemo(() => {
    try {
      const research = JSON.parse(data?.draft?.research_json ?? "{}") as Record<string, unknown>;
      return parseStyleRecord(research?.styleAudit)?.note ?? "";
    } catch {
      return "";
    }
  }, [data?.draft?.research_json]);

  const applyCheckedDraft = useCallback(async (
    draftId: number,
    originalDraftId: number,
    expected?: EditableDraftFields,
    explicit = false,
  ) => {
    const checked: CheckedDraftResult = await getCheckedDraftResultFn({
      data: { leadId: id, draftId, originalDraftId },
    });
    setEvidenceReview({
      original: checked.original,
      checked: {
        headline: checked.headline,
        dek: checked.dek,
        body: stripReporterNotebook(checked.body ?? ""),
        topic: checked.topic,
      },
      integrityNotes: checked.integrityNotes,
    });
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
  }, [id, refetch]);

  const reconcile = useMutation({
    mutationFn: () => requestDraftReconciliationFn({ data: { leadId: id, modelChoice, modelEffort } }),
    onMutate: () => {
      reconcileSnapshot.current = { ...currentDraftFields.current };
      appliedReconcileJob.current = reconcileStatus.data?.jobId ?? null;
      setCheckedDraftReady(false);
      setEvidenceReview(null);
      setEvidenceReviewOpen(false);
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
        editorActionError(cause instanceof Error ? cause.message : "", "start the evidence check") ??
          "The evidence check could not be queued.",
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
    if (!status.resultDraftId) {
      setReconcileNote(
        "Evidence check finished without identifying its saved result. Reload the page and review the current draft.",
      );
      setReconcileNoteError(true);
      return;
    }
    if (!snapshot) {
      void applyCheckedDraft(status.resultDraftId, status.draftId)
        .then(() => setEvidenceReviewOpen(false))
        .catch((cause) => {
          setReconcileNote(
            editorActionError(cause instanceof Error ? cause.message : "", "load the checked draft") ??
              "The checked draft could not be loaded.",
          );
          setReconcileNoteError(true);
        });
      return;
    }
    setEvidenceReviewOpen(true);
    void applyCheckedDraft(status.resultDraftId, status.draftId, snapshot)
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
          editorActionError(cause instanceof Error ? cause.message : "", "load the checked draft") ??
            "The checked draft could not be loaded.",
        );
        setReconcileNoteError(true);
        setReconcileNoteWarning(false);
      });
  }, [reconcileStatus.data, applyCheckedDraft]);

  /*
    THE PUBLISH CLICK CONFIRMS THE SECTION (0.6.67).

    The section was the last thing about a draft that printed on a machine's
    word: the classifier picked it, the select showed it, and Publish printed
    whatever the select said -- unless a person had pressed a separate Confirm
    button first, which read as a step of its own and was easy to leave until
    the button below refused.

    Publish now carries the section the editor is looking at, and the server
    records that as this draft version's confirmation inside the transaction
    that prints it. One click, and the button says which section it will file
    under -- "Publish in Council" -- so the editor is confirming something they
    can read. The server's guarantee is untouched: a request that arrives with
    no section and no stored confirmation for the version being printed is
    still refused, in a sentence.
  */
  const publish = useMutation({
    mutationFn: async () => {
      const notesProblem = await saveNotesQuietly();
      /*
        The draft save is the story. If it fails, the server is about to print
        a version the editor is not looking at, so the print stops -- with a
        sentence that names what did not save, never a schema dump.
      */
      try {
        await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      } catch (err) {
        throw new Error(
          editorActionError(err instanceof Error ? err.message : "", "save your edits") ??
            "The desk could not save your edits, so nothing was published. Try again.",
        );
      }
      return {
        result: await publishLead({ data: { leadId: id, topic: topic.trim() } }),
        notesProblem,
      };
    },
    onSuccess: async ({ result, notesProblem }) => {
      if (!answered(result)) {
        setMsg(NO_ANSWER);
        return;
      }
      if (!result.ok) {
        setMsg(result.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await qc.invalidateQueries({ queryKey: ["paper"] });
      await qc.invalidateQueries({ queryKey: ["published-desk"] });
      setPublishedSlug(result.slug);
      setMsg(notesProblem ? `On the paper. ${notesProblem}` : "On the paper.");
    },
    onError: (err) => {
      setMsg(
        editorActionError(err instanceof Error ? err.message : "", "publish that story") ??
          "Could not publish.",
      );
    },
  });

  /*
    "Suggest headlines": three lines from the story model, on the provider
    ladder the rest of the desk uses. The whole contract is that nothing is
    applied without a click -- this holds the options, the list below the
    headline offers them, and only a click writes the box.

    A model that cannot be reached, or that answers with paragraphs instead of
    headlines, is not an error the editor has to act on: the headline on the
    page is untouched and the sentence says so.
  */
  const suggest = useMutation({
    mutationFn: () =>
      suggestHeadlines({ data: { leadId: id, headline: headline.trim() || undefined } }),
    onSuccess: (res) => {
      if (!answered(res)) {
        setHeadlineNote(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setHeadlineNote(res.error);
        return;
      }
      setHeadlineSuggestions(res.options);
      setHeadlineNote(
        res.options.length
          ? ""
          : "The story model offered no headlines this time. Your headline is exactly as you left it.",
      );
    },
    onError: (err) => {
      setHeadlineNote(
        editorActionError(err instanceof Error ? err.message : "", "reach the story model") ??
          "The story model could not be reached just now. Your headline is exactly as you left it.",
      );
    },
  });

  /*
    A published story's headline lives on the article, not on the draft: the
    draft is what the story was written from, and the paper prints
    `articles.headline`. Changing it here changes the printed headline and
    nothing else -- the slug stays, so every link to the story still works --
    and the server keeps the old headline with who changed it and when.
  */
  const savePublishedHeadline = useMutation({
    mutationFn: () =>
      updateArticleHeadline({ data: { articleId: data?.articleId ?? 0, headline } }),
    onSuccess: async (res) => {
      if (!answered(res)) {
        setHeadlineNote(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setHeadlineNote(res.error);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      await qc.invalidateQueries({ queryKey: ["paper"] });
      await qc.invalidateQueries({ queryKey: ["published-desk"] });
      setHeadlineNote(
        "Headline changed. The story's link is unchanged, and the headline it replaced is on the record.",
      );
    },
    onError: (err) => {
      setHeadlineNote(
        editorActionError(err instanceof Error ? err.message : "", "change the headline") ??
          "Could not change the headline.",
      );
    },
  });

  /*
   * Unit AK items 5 and 6: the Compare view's three presses and the Reopen on
   * a killed lead's page.
   *
   * These are plain callbacks rather than useMutation()s because each one has
   * to hand a result back to the panel that pressed it -- "did that land?" is
   * the whole point of the press, and a fire-and-forget mutation cannot answer.
   * Every branch below returns `{ ok: false, error }` with a sentence, so a
   * refusal from the desk is shown, not swallowed.
   */
  const afterLeadChange = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["lead", id] });
    await qc.invalidateQueries({ queryKey: ["leads"] });
  }, [qc, id]);

  const moveToNew = useCallback(async () => {
    const res = await resolveLeadDuplicate({ data: { id, action: "not-a-duplicate" } });
    if (!answered(res)) return { ok: false, error: NO_ANSWER };
    if (!res.ok) return { ok: false, error: res.error };
    await afterLeadChange();
    return { ok: true };
  }, [id, afterLeadChange]);

  const killAsDuplicateOfPrior = useCallback(async () => {
    const prior = data?.lead.possible_duplicate;
    if (!prior) return { ok: false, error: "The earlier lead is no longer available to name." };
    const res = await setLeadStatus({
      data: { id, status: "killed", killReason: duplicateKillReason(prior.headline) },
    });
    if (!answered(res)) return { ok: false, error: NO_ANSWER };
    if (!res.ok) return { ok: false, error: "The desk refused that kill." };
    await afterLeadChange();
    return { ok: true };
  }, [data, id, afterLeadChange]);

  const reopenPrior = useCallback(async () => {
    const res = await resolveLeadDuplicate({ data: { id, action: "reopen-prior" } });
    if (!answered(res)) return { ok: false, error: NO_ANSWER };
    if (!res.ok) return { ok: false, error: res.error };
    await afterLeadChange();
    return { ok: true };
  }, [id, afterLeadChange]);

  const reopenThisLead = useCallback(async () => {
    const res = await setLeadStatus({ data: { id, status: "new" } });
    if (!answered(res)) return { ok: false, error: NO_ANSWER };
    if (!res.ok) return { ok: false, error: "The desk refused that reopen." };
    await afterLeadChange();
    return { ok: true };
  }, [id, afterLeadChange]);

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
            message={
              editorActionError(
                error instanceof Error ? error.message : "",
                "load that story",
              ) ?? "Could not load that lead."
            }
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
  const draftCompletion = parseDraftCompletionReceipt(data.job?.result_json);
  const completedDraftNeedsReview = Boolean(
    data.job?.status === "completed" &&
    data.draft?.id &&
    draftCompletion?.finalDraftId === data.draft.id &&
    draftCompletion.quality.reviewRequired,
  );
  const sources = parseUrlList(data.lead.source_urls);
  const fromDark =
    Boolean(data.lead.investigation_id) ||
    /DARK DESK/i.test(data.lead.why) ||
    data.lead.headline.startsWith("[Dark]");
  const locked = data.lead.status === "killed";
  const onPaper = data.lead.status === "published" || Boolean(publishedSlug);
  /*
   * Unit AK item 5: the two leads the scanner thinks are the same story. Both
   * sides come down with the lead (see getLead), so the comparison is on this
   * page instead of a link to a page that knew nothing about the pair.
   */
  const priorLead = data.lead.possible_duplicate ?? null;
  const comparePair = data.lead.possible_duplicate_of && priorLead ? { prior: priorLead } : null;
  const compareShown = comparePair ? (compareOpen ?? true) : false;
  /*
   * Unit AK item 6: a kill leaves a record, and the record outlives the kill --
   * once the Compare view reopens a lead, its status is "new" again and the
   * kill columns are all that is left to say what happened to it.
   */
  const killRecord = Boolean(data.lead.killed_at || data.lead.kill_reason);
  const leadForRecord = {
    id: data.lead.id,
    headline: data.lead.headline,
    why: data.lead.why,
    status: data.lead.status,
    source_urls: data.lead.source_urls,
    created_at: data.lead.created_at,
    kill_reason: data.lead.kill_reason ?? null,
    kill_reason_url: data.lead.kill_reason_url ?? null,
    killed_at: data.lead.killed_at ?? null,
  };
  const canChooseAnotherModel =
    !onPaper &&
    /readiness check|did not answer in time|provider slow|timed?\s*out|choose another model/i.test(
      draftProblem,
    );
  const canPublish = Boolean(data.draft) && data.lead.status !== "held" && !locked && !onPaper;
  const found = findingsFrom(data.draft?.found_note);
  const unanswered = unansweredNotes(data.draft?.unanswered);
  const verify = data.draft?.integrity_notes?.trim() || "";
  const notes = mergeDraftEvidenceIntoNotes(parseNotes(data.lead.notes_json), {
    found: found.map((f) => ({ t: f.text, src: f.url })),
    unanswered,
    verify,
  });
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
  /*
    The section a story files under was the last thing about a draft that
    printed on a machine's word alone: the classifier picks it, the select
    shows it, and publish printed whatever the select said unless somebody had
    pressed a separate Confirm button first.

    Publish itself is now the confirmation (see the publish mutation): the
    button reads "Publish in <section>" and the request carries that section,
    which the server records for the version it prints. So what this has to
    answer is narrower than before -- is there a section a person is looking at
    and can put their name to?

      - the model named one and the desk is showing it: yes. Pressing the
        button is the person confirming the model's choice.
      - the model named none (`topic_unchosen`): the select is showing the
        desk's own fallback guess, and sending that unasked would print a
        guess. Somebody has to pick.
      - a person already confirmed this exact section for this saved version:
        yes, without a second press.
  */
  const sectionChosenByModel = Boolean(String(data.draft?.topic ?? "").trim()) && !data.lead.topic_unchosen;
  const sectionAlreadyConfirmed =
    Boolean(data.topicConfirmed) && data.topicConfirmed === topic && !hasUnsavedDraftEdits;
  const sectionReady = sectionChosenByModel || topicTouched || sectionAlreadyConfirmed;
  const sectionNameNow = sectionName(topic);
  /*
    Naming another newsroom's reporting and not showing the reader where it
    came from blocks printing, the same way an unconfirmed claim of absence
    does -- `namedOutlets` is the server's own answer to that question, so the
    desk cannot disagree with the refusal.
  */
  const outletBlocked =
    data.namedOutlets.length === 0
      ? ""
      : data.namedOutlets.length === 1
        ? `Deal with the named outlet first`
        : `Deal with the ${data.namedOutlets.length} named outlets first`;
  const blockedReason = openClaims.length
    ? openClaims.length === 1
      ? "Confirm the claim of absence first"
      : `Confirm the ${openClaims.length} claims of absence first`
    : outletBlocked
      ? outletBlocked
      : sectionReady
        ? ""
        : "Pick the section this story files under first";

  return (
    <DeskShell title={data.lead.headline} kicker="Workbench" hideTitle>
      {data.job && (data.job.status === "queued" || data.job.status === "running") ? (
        <section className="story-running-banner" aria-label="Draft progress" role="status">
          <strong>
            {data.job.status === "queued" ? "Your story is queued" : "Your story is being written"}
          </strong>
          <p>{data.job.stage || "Preparing your sources…"}</p>
          {data.job.failover_note ? (
            <p className="story-model-switch-note">
              <strong>Model switch:</strong> {data.job.failover_note}
            </p>
          ) : null}
          <span>
            Your submission is saved. The draft will appear here automatically. You can return from{" "}
            <Link to="/desk">Desk → Your recent drafts</Link>.
          </span>
        </section>
      ) : null}
      {completedDraftNeedsReview ? (
        <Notice kind="err">
          <strong>Draft saved — review required.</strong> Check the source and name-verification findings before publication.
        </Notice>
      ) : null}
      <Link to="/desk/queue" className="crumb">
        ← Queue
      </Link>
      <div className="astra-story-heading">
        <div>
          <p className="kick">Your newsroom</p>
          <h1 className="h1">Story workspace</h1>
        </div>
        <Chip s={data.lead.status} />
      </div>
      <div className="work-bar astra-story-actions">
        <button
          className="btn"
          type="button"
          aria-expanded={modelResearchOpen}
          aria-controls="story-model-research"
          onClick={() => setModelResearchOpen((open) => !open)}
        >
          Model & research · {modelChoiceLabel(modelChoice)}
        </button>
        {retiredModelNote ? (
          <p className="note" role="status">
            {retiredModelNote}
          </p>
        ) : null}
        <span className="astra-save-state" role="status">
          {onPaper ? "Published story" : hasUnsavedDraftEdits ? "Unsaved changes" : "Saved draft"}
        </span>
        {body && (
          <InkButton tone="ghost" onClick={() => preview.current?.showModal()}>
            Preview
          </InkButton>
        )}
        <a className="btn astra-checks-jump" href="#story-inspector">
          Checks & sources
        </a>
        {/*
          Unit AK item 5: the press that opens the side-by-side view. It used
          to be a link on the Queue that opened the other lead's page, which
          had no comparison on it at all.
        */}
        {comparePair ? (
          <button
            className="btn"
            type="button"
            aria-expanded={compareShown}
            aria-controls="lead-compare"
            onClick={() => setCompareOpen(!compareShown)}
          >
            Compare
          </button>
        ) : null}
        {!locked && !onPaper ? (
          <>
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
                  ? data.job?.failover_note
                    ? `Switched to ${data.job.failover_note.match(/moved to (.+?) because/i)?.[1] ?? "another model"}…`
                    : "Drafting…"
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
              modelLabel={modelChoiceLabel(reconcileStatus.data?.modelChoice ?? modelChoice)}
              review={evidenceReview}
              reviewOpen={evidenceReviewOpen}
              onStart={() => reconcile.mutate()}
              onReload={() => {
                const resultDraftId = reconcileStatus.data?.resultDraftId;
                if (!resultDraftId) return;
                const originalDraftId = reconcileStatus.data?.draftId;
                if (!originalDraftId) return;
                setEvidenceReviewOpen(true);
                void applyCheckedDraft(resultDraftId, originalDraftId, undefined, true).catch((cause) => {
                  setReconcileNote(
                    editorActionError(
                      cause instanceof Error ? cause.message : "",
                      "load the checked draft",
                    ) ?? "The checked draft could not be loaded.",
                  );
                  setReconcileNoteError(true);
                  setReconcileNoteWarning(false);
                });
              }}
              onKeepChecked={() => {
                setEvidenceReviewOpen(false);
                setReconcileNote("The checked version remains the current saved draft.");
                setReconcileNoteError(false);
                setReconcileNoteWarning(false);
              }}
              onRestoreOriginal={() => {
                if (!evidenceReview) return;
                setHeadline(evidenceReview.original.headline);
                setDek(evidenceReview.original.dek);
                setBody(stripReporterNotebook(evidenceReview.original.body));
                setTopic(evidenceReview.original.topic);
                setEvidenceReviewOpen(false);
                setReconcileNote(
                  "Previous version loaded as unsaved text. Click Save edits to make it the current saved draft.",
                );
                setReconcileNoteError(false);
                setReconcileNoteWarning(true);
              }}
            />
            {canPublish ? (
              confirmingPublish ? (
                <>
                  <span className="note">
                    This puts the story on the public paper and in the feed, under your name, now.
                    Corrections are published, not silent edits.
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
                      !sectionReady ||
                      data.namedOutlets.length > 0 ||
                      evidenceStale ||
                      reviewEvidence.isPending ||
                      reconcileActive
                    }
                    onClick={() => {
                      setConfirmingPublish(false);
                      publish.mutate();
                    }}
                  >
                    {publish.isPending ? "Publishing…" : `Yes, print it in ${sectionNameNow}`}
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
                      !sectionReady ||
                      data.namedOutlets.length > 0 ||
                      evidenceStale ||
                      reviewEvidence.isPending ||
                      reconcileActive
                    }
                    onClick={() => setConfirmingPublish(true)}
                  >
                    {`Publish in ${sectionNameNow}`}
                  </InkButton>
                  {/*
                    The section is on the button, so the editor can read what
                    they are about to confirm. This is the way back to the
                    select when the name on the button is not the one they
                    want -- and the focus, not just the scroll, because the
                    point of pressing it is to change that field.
                  */}
                  <button
                    type="button"
                    className="inline-link astra-publish-section-change"
                    onClick={() => {
                      document.getElementById("story-topic-select")?.focus();
                      document
                        .getElementById("story-topic")
                        ?.scrollIntoView({ block: "center" });
                    }}
                  >
                    {sectionReady ? "change" : "pick the section"}
                  </button>
                  {/*
                        A greyed button with no sentence beside it is a dead
                        end -- the editor cannot tell whether it is broken,
                        still loading, or refusing on purpose. The reason is
                        text, not opacity, and it points at the work.
                      */}
                  {blockedReason ? (
                    <span className="note publish-blocked">
                      {blockedReason}.{" "}
                      {openClaims.length > 0 ? (
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() => {
                            setInspector("reporting");
                            document
                              .getElementById("story-inspector")
                              ?.scrollIntoView({ block: "start" });
                          }}
                        >
                          Open reporting notes
                        </button>
                      ) : outletBlocked ? (
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() =>
                            document
                              .getElementById("story-outlets")
                              ?.scrollIntoView({ block: "center" })
                          }
                        >
                          Go to the named outlets
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="inline-link"
                          onClick={() =>
                            document
                              .getElementById("story-topic")
                              ?.scrollIntoView({ block: "center" })
                          }
                        >
                          Go to the section
                        </button>
                      )}
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
                <Link to="/articles/$slug" params={{ slug: publishedSlug }} className="inline-link">
                  Read it on the paper
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {comparePair && compareShown ? (
        <div id="lead-compare">
          <LeadComparePanel
            current={leadForRecord}
            prior={comparePair.prior}
            onNotADuplicate={moveToNew}
            onKillThis={killAsDuplicateOfPrior}
            onReopenPrior={reopenPrior}
            formatDate={formatShortDate}
          />
        </div>
      ) : null}
      {!locked && !onPaper ? (
        <Field label="Story direction for AI" hint="Tell the AI which decision or question to cover. This controls the draft's subject; it does not print or count as evidence.">
          <textarea
            rows={2}
            value={storyDirection}
            onChange={(e) => setStoryDirection(e.target.value)}
            maxLength={1000}
            disabled={waiting}
            placeholder="For example: Cover the vote on Ordinance 2026-57 and what changes for residents."
          />
        </Field>
      ) : null}
      {modelResearchOpen && !locked && !onPaper ? (
        <section
          className="astra-model-research"
          id="story-model-research"
          ref={modelResearchPanel}
          aria-labelledby="story-model-research-heading"
        >
          <div className="astra-model-research-heading">
            <div>
              <p className="kick">Redraft settings</p>
              <h2 id="story-model-research-heading">Choose the model and research scope</h2>
            </div>
            <button className="btn" type="button" onClick={() => setModelResearchOpen(false)}>
              Close
            </button>
          </div>
          <div className="astra-model-research-controls">
            <ModelPicker
              value={modelChoice}
              onChange={(choice) => {
                modelChoiceTouched.current = true;
                setModelChoice(choice);
                setModelEffort(defaultModelEffort(choice));
              }}
              effort={modelEffort}
              onEffortChange={setModelEffort}
              disabled={waiting || reconcileActive || savePending}
              compact
            />
            <DraftScopePicker
              value={researchScope}
              onChange={setResearchScope}
              disabled={waiting}
            />
          </div>
          <p className="meta">
            Redraft uses these settings. Your current saved draft stays in place until a new draft
            finishes successfully.
          </p>
        </section>
      ) : null}
      <div className="story-grid">
        <aside
          className="story-side astra-inspector"
          id="story-inspector"
          aria-label="Story checks and sources"
        >
          <div className="astra-inspector-tabs" role="tablist" aria-label="Story inspector">
            {(["checks", "sources", "reporting"] as const).map((tab) => (
              <button
                key={tab}
                id={`inspector-tab-${tab}`}
                role="tab"
                aria-selected={inspector === tab}
                aria-controls={`inspector-${tab}`}
                tabIndex={inspector === tab ? 0 : -1}
                onClick={() => setInspector(tab)}
                onKeyDown={(e) => {
                  const tabs = ["checks", "sources", "reporting"] as const;
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                    e.preventDefault();
                    const i = tabs.indexOf(tab);
                    const next =
                      tabs[
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? 2
                            : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3
                      ];
                    setInspector(next);
                    document.getElementById(`inspector-tab-${next}`)?.focus();
                  }
                }}
              >
                {tab === "checks" ? "Checks" : tab === "sources" ? "Sources" : "Reporting"}
              </button>
            ))}
          </div>
          <section
            id="inspector-checks"
            role="tabpanel"
            aria-labelledby="inspector-tab-checks"
            hidden={inspector !== "checks"}
          >
            <h2>Before you publish</h2>
            <p className="meta">Review names, claims and supporting records for this draft.</p>
            {data.draft ? (
              <DeskNameCheck
                research={data.draft.research_json}
                headline={headline}
                dek={dek}
                body={body}
              />
            ) : (
              <p>Name checks appear after the first draft.</p>
            )}
            <div className="astra-check-action">
              <h3>Claims & evidence</h3>
              <p>
                {evidenceStale
                  ? "The story changed. Review its evidence."
                  : "Open the reporting trail and supporting sources."}
              </p>
              <a
                href="#finding-evidence-review"
                className="btn"
                onClick={() => {
                  const details = document.getElementById("evidence-review")?.closest("details");
                  if (details) details.open = true;
                }}
              >
                Review claims and sources
              </a>
            </div>
            <div className="astra-check-action">
              <h3>Claims of absence</h3>
              <p>
                {openClaims.length
                  ? `${openClaims.length} claim${openClaims.length === 1 ? " needs" : "s need"} your confirmation.`
                  : "No outstanding claims of absence."}
              </p>
              <button
                className="btn"
                onClick={() => {
                  setInspector("reporting");
                  const detail = document.getElementById("evidence-review")?.closest("details");
                  if (detail) detail.open = true;
                }}
              >
                Open reporting notes
              </button>
            </div>
          </section>
          <section
            id="inspector-sources"
            role="tabpanel"
            aria-labelledby="inspector-tab-sources"
            hidden={inspector !== "sources"}
          >
            <h2>Your source material</h2>
            <StoryDocumentList leadId={id} />
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

            {!sources.length && <p className="meta">No source links are attached to this lead.</p>}
          </section>
          <section
            id="inspector-reporting"
            role="tabpanel"
            aria-labelledby="inspector-tab-reporting"
            hidden={inspector !== "reporting"}
          >
            {!locked && !onPaper ? (
              <div className="astra-current-model">
                <p className="side-label">Redraft settings</p>
                <p>
                  <strong>{modelChoiceLabel(modelChoice)}</strong> ·{" "}
                  {researchScope === "supplied" ? "Supplied material only" : "Public research"}
                </p>
                <button className="btn" type="button" onClick={() => setModelResearchOpen(true)}>
                  Change model or research
                </button>
              </div>
            ) : null}
            <Chip s={data.lead.status} />
            <p className="kick">{fromDark ? "Working notes from Dark Desk" : "The lead"}</p>
            <h2 className="side-h">{data.lead.headline}</h2>
            <p className="side-why">{data.lead.why}</p>
            <p className="meta">
              {data.lead.topic} · filed {formatShortDate(data.lead.created_at)} · scored {score}/20
              · {leadOrigin(data.lead)}
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
                This trail came from Dark Desk. Draft privately here; printing is a separate click
                and every claim still needs evidence.
              </p>
            ) : null}
            <ReportingNotesPane
              leadId={id}
              notes={notes}
              hasDraft={Boolean(data.draft)}
              currentDraftId={data.draft ? Number(data.draft.id) : null}
              locked={locked || onPaper}
              openedExtractionByUrl={data.openedExtractionByUrl ?? {}}
              draftMeetingEvidence={data.draftMeetingEvidence}
              onMeetingRedraft={locked || onPaper ? undefined : () => draft.mutate()}
              meetingRedrafting={draft.isPending || waiting}
              evidenceToken={data.evidenceToken}
              onReverifyMeetingCitations={locked || onPaper || !data.draft ? undefined : (review) => draftMeetingReview.mutate(review)}
              reverifyingMeetingCitations={draftMeetingReview.isPending}
            />
          </section>
        </aside>

        <section className="story-work">
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
                  setInspector("reporting");
                  requestAnimationFrame(() =>
                    document.getElementById("story-inspector")?.scrollIntoView({ block: "start" }),
                  );
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
          {/*
            A successful action that also has something to report -- the draft
            saved but the reporting notes did not -- still reads as a success:
            the story was saved, and a red box would say otherwise. Both of
            those sentences begin with the thing that worked, which is what the
            colour below reads. The sentence stays the first thing inside the
            notice, where the editor reads it before the button under it.
          */}
          {draftProblem && !onPaper ? (
            <Notice kind={/^(Saved\.|On the paper\.)/.test(msg) ? "ok" : "err"}>
              {draftProblem}
              {/*
                The one error the desk could describe but never act on. A
                lapsed CLI login used to end at "sign in again", which meant a
                terminal; this starts the sign-in and hands over to the Server
                page. It renders only when the error really is that.
              */}
              <ProviderSignInButton detail={draftProblem} />
              {canChooseAnotherModel ? (
                <button className="btn" type="button" onClick={() => setModelResearchOpen(true)}>
                  Choose another model
                </button>
              ) : null}
            </Notice>
          ) : null}
          {/*
            0.6.64 Unit AB: a document the redraft could only partly read is no
            longer a red error line -- the draft ran on the pages that were read
            and every later document was still read. This is the plain notice
            that names the document (pages read of total) and carries the one
            action that finishes it, so an editor never has to guess that
            pressing Redraft again is the way forward.
          */}
          <StoryDocumentPartialNotice
            leadId={id}
            busy={waiting || draft.isPending}
            onReadRest={() => draft.mutate()}
          />

          {data.draft || body ? (
            <form className="work-form" onSubmit={(e) => e.preventDefault()}>
              {/*
                THE HEADLINE IS AN EDITOR'S FIELD (0.6.67).

                Two things were wrong with it.

                It looked printed. The headline carried the same treatment as
                the dek and the body -- no border, no background -- so an editor
                read it as a caption rather than something to type in. The
                wrapper and its "Edit" hint are the fix; the rules are in
                desk-astra.css.

                And on a published story it was disabled outright, which left
                the one edit editors make most often reachable only from the
                Published page. A printed story's headline now stays editable
                here, and saving it changes the article the reader is looking at
                -- same slug, same link, with the headline it replaced written
                down against the editor's name (see `savePublishedHeadline`).
              */}
              <Field label="Headline" htmlFor="story-headline">
                <div className="astra-headline-box">
                  <textarea
                    id="story-headline"
                    rows={2}
                    className="astra-headline"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    aria-describedby="headline-edit-hint"
                  />
                  <span className="astra-headline-hint" id="headline-edit-hint">
                    Edit
                  </span>
                </div>
              </Field>
              <div className="astra-headline-actions">
                {onPaper ? (
                  <InkButton
                    disabled={savePublishedHeadline.isPending || !data.articleId || !headline.trim()}
                    onClick={() => savePublishedHeadline.mutate()}
                  >
                    {savePublishedHeadline.isPending ? "Saving…" : "Save headline"}
                  </InkButton>
                ) : null}
                {/*
                  The scan's own headline, one press away. The model's redrafts
                  can drift from it, and the words the desk read on the lead are
                  often the ones an editor wants back.
                */}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setHeadline(data.lead.headline);
                    setHeadlineSuggestions([]);
                    setHeadlineNote(
                      onPaper
                        ? "The lead's headline is in the box. Save headline to put it on the paper."
                        : "The lead's headline is in the box. Save edits to keep it.",
                    );
                  }}
                >
                  Use the lead's headline
                </button>
                {/*
                  Three options from the story model, on the provider ladder the
                  rest of the desk uses. Nothing is applied without a click --
                  the options appear below the box and one of them has to be
                  chosen.
                */}
                <button
                  type="button"
                  className="btn"
                  disabled={suggest.isPending || waiting}
                  onClick={() => suggest.mutate()}
                >
                  {suggest.isPending ? "Asking the story model…" : "Suggest headlines"}
                </button>
              </div>
              {headlineSuggestions.length > 0 ? (
                <ul className="astra-headline-options" aria-label="Suggested headlines">
                  {headlineSuggestions.map((option) => (
                    <li key={option}>
                      <button
                        type="button"
                        onClick={() => {
                          setHeadline(option);
                          setHeadlineSuggestions([]);
                          setHeadlineNote(
                            onPaper
                              ? "That headline is in the box. Save headline to put it on the paper."
                              : "That headline is in the box. Save edits to keep it.",
                          );
                        }}
                      >
                        {option}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {/*
                The page's own line about the last headline action. On a
                published story the draft area's notice is not rendered at all,
                so without this a headline change would happen with nothing
                said.
              */}
              {headlineNote ? (
                <p className="note" role="status">
                  {headlineNote}
                </p>
              ) : null}
              <Field label="Dek">
                <textarea
                  rows={2}
                  className="astra-dek"
                  value={dek}
                  onChange={(e) => setDek(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              {/*
                The section is a field an editor confirms, not a default a
                machine left behind. Publish is where it is confirmed: the
                draft is saved first, the request carries this section, and the
                server records it against the version it is about to print, so
                what is confirmed is always the section of the version the desk
                has. See the publish mutation.
              */}
              <div id="story-topic">
                <Field label="Topic">
                  <select
                    id="story-topic-select"
                    value={topic}
                    onChange={(e) => {
                      setTopic(e.target.value);
                      /* A person moved it. See `topicTouched`. */
                      setTopicTouched(true);
                    }}
                    disabled={onPaper}
                  >
                    {TOPICS.filter((t) => t !== "about").map((t) => (
                      <option key={t} value={t}>
                        {sectionName(t)}
                      </option>
                    ))}
                    {topic && !TOPICS.includes(topic as (typeof TOPICS)[number]) ? (
                      <option value={topic}>{topic}</option>
                    ) : null}
                  </select>
                </Field>
                {/*
                  A lead the scan filed under a section the model never chose.

                  The desk still had to write a key (`schema.ts`), so the row
                  and this select show one -- but it is the desk's fallback,
                  not a decision, and printing it as though it were is how a
                  guessed section reaches the paper. The notice is the same
                  words the Queue row carries, and it goes away when the editor
                  picks a section above -- or when the section has already been
                  confirmed for this saved draft, which is what a person
                  pressing Publish does.
                */}
                {!onPaper && data.lead.topic_unchosen && !sectionReady ? (
                  <p className="note publish-blocked">
                    Section not chosen — pick one. The scan filed this lead under{" "}
                    {sectionName(data.lead.topic)} because the model named no section this newsroom
                    files under. Choose the section above, then publish: the Publish button names the
                    section and pressing it is the confirmation.
                  </p>
                ) : null}
                {/*
                  No separate Confirm button (0.6.67). It was a second step for
                  a decision the editor had already made in the select above,
                  and its reset nag -- "editing the section or the body means
                  confirming it again" -- taught people to press a button that
                  did nothing they could see. Publish carries this section and
                  the server records it for the version it prints, so the
                  guarantee is stronger than before and the desk is one press
                  shorter.
                */}
                {onPaper || !sectionReady ? null : (
                  <p className="note">
                    Publishing this draft files it under {sectionNameNow}. The Publish button names
                    that section, and pressing it confirms the section for the version being
                    printed.
                  </p>
                )}
              </div>
              {/*
                THE NAMED-OUTLET CHECK (0.6.62).

                A body that says "the Denver Post reported" is asking the reader
                to trust a report the paper has not shown them. The server
                refuses to print while an outlet is named and its Sources do not
                show it, unless an editor overrides that outlet for this draft
                -- one at a time, and recorded: who, when, which outlet, which
                draft.

                This is the desk's half of it: what is outstanding, the button
                that records the decision, and the record itself. None of it
                reaches the public page -- a reader does not need the paper's
                internal argument, but the newsroom needs the paper trail.
              */}
              {data.draft ? (
                <div id="story-outlets">
                  {data.namedOutlets.length > 0 ? (
                    <>
                      <p className="note publish-blocked">
                        The body names{" "}
                        {data.namedOutlets.length === 1
                          ? data.namedOutlets[0]
                          : data.namedOutlets.join(", ")}{" "}
                        and the Sources do not show{" "}
                        {data.namedOutlets.length === 1 ? "it" : "them"}. Add the source you read,
                        or override {data.namedOutlets.length === 1 ? "it" : "each one"} for this
                        draft.
                      </p>
                      {onPaper ? null : (
                        <div>
                          {data.namedOutlets.map((outlet) => (
                            <InkButton
                              key={outlet}
                              tone="quiet"
                              disabled={overrideOutlet.isPending}
                              onClick={() => overrideOutlet.mutate(outlet)}
                            >
                              {overrideOutlet.isPending ? "Recording…" : `Override ${outlet}`}
                            </InkButton>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="note">
                      Every outlet the body names is in the Sources. Editing the body re-runs this
                      check.
                    </p>
                  )}
                  {data.outletOverrides.length > 0 ? (
                    <>
                      <p className="note">
                        Overrides recorded for this draft — this is the paper's record, and it
                        prints nowhere:
                      </p>
                      <ul className="note">
                        {data.outletOverrides.map((o) => (
                          <li key={`${o.outlet}-${o.overridden_at}`}>
                            <strong>{o.outlet}</strong> — by {o.overridden_by} on{" "}
                            {new Date(o.overridden_at).toLocaleString()}.
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
              <Field label="Body">
                <textarea
                  ref={bodyField}
                  className="astra-story-body"
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
          ) : waiting ? null : locked || killRecord ? (
            /*
              Unit AK item 6: "This lead was killed. Nothing to draft." named
              the state and nothing else. The record below shows what the lead
              was -- headline, why, sources -- and when and why it was killed,
              with the way back. After a reopen it stays, saying the kill was
              undone, because a record that vanishes hides what happened.
            */
            <KilledLeadRecord
              lead={leadForRecord}
              reopened={!locked}
              onReopen={locked ? reopenThisLead : undefined}
              formatDate={formatShortDate}
            />
          ) : (
            <p className="meta" style={{ marginTop: 14 }}>
              No draft yet. Draft with AI writes a first pass from the lead and its sources; you
              edit, then publish.
            </p>
          )}
          {data.draft ? (
            <section className="note-sec" aria-label="Style check">
              <p className="side-label">Style check</p>
              {styleFixes.length ? (
                <>
                  <p className="note-one">
                    {styleFixes.length} thing{styleFixes.length === 1 ? "" : "s"} to fix:
                  </p>
                  <ul className="meeting-citations">
                    {styleFixes.map((finding, index) => (
                      <li key={`${finding.code}-${finding.paragraph}-${finding.sentence}-${index}`}>
                        <p>
                          <b>{styleLocation(finding)}</b> · {finding.message}
                        </p>
                        {finding.snippet ? <p className="note-one">{finding.snippet}</p> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="note-one">Nothing to fix.</p>
              )}
              {styleReviews.length ? (
                <details>
                  <summary>
                    {styleReviews.length} thing{styleReviews.length === 1 ? "" : "s"} to read, not
                    to fix
                  </summary>
                  <ul className="meeting-citations">
                    {styleReviews.map((finding, index) => (
                      <li key={`${finding.code}-${finding.paragraph}-${finding.sentence}-${index}`}>
                        <p>
                          <b>{styleLocation(finding)}</b> · {finding.message}
                        </p>
                        {finding.snippet ? <p className="note-one">{finding.snippet}</p> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="note-one">
                You do not have to act on any of this. Nothing here publishes anything.
              </p>
              <InkButton
                disabled={
                  !styleFixes.length ||
                  locked ||
                  onPaper ||
                  waiting ||
                  fixStyle.isPending ||
                  save.isPending ||
                  reviewEvidence.isPending ||
                  reconcileActive
                }
                onClick={() => fixStyle.mutate()}
              >
                {fixStyle.isPending ? "Fixing…" : "Fix these with the model"}
              </InkButton>
              <p className="note-one">
                One pass with the model the picker is set to. It is given the list above and the
                draft, and returns the draft with those problems fixed. It may not change a
                quotation, a number, a name or a link — a rewrite that does is refused and your text
                is kept. The result is saved as a draft revision, never published.
              </p>
              {styleNote ? <p className="note-one">{styleNote}</p> : null}
            </section>
          ) : null}
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
      <dialog
        ref={preview}
        className="astra-dialog astra-preview"
        aria-labelledby="story-preview-title"
      >
        <div className="astra-dialog-head">
          <h2 id="story-preview-title">Draft preview</h2>
          <button className="btn" onClick={() => preview.current?.close()}>
            Close preview
          </button>
        </div>
        <article className="astra-dialog-body">
          <p className="kick">{topic} · Draft for review</p>
          <h1>{headline}</h1>
          <p className="astra-preview-dek">{dek}</p>
          <div className="astra-preview-body">
            <StoryBody body={body} />
          </div>
        </article>
      </dialog>
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

function DraftHistoryPanel({ leadId, currentDraftId }: { leadId: number; currentDraftId: number | null }) {
  const [open, setOpen] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const history = useQuery({
    queryKey: ["draft-history", leadId],
    queryFn: () => listDraftHistory({ data: leadId }),
    enabled: open,
  });
  const detail = useQuery({
    queryKey: ["draft-history-item", leadId, selectedDraftId],
    queryFn: () => getDraftHistoryItem({ data: { leadId, draftId: selectedDraftId! } }),
    enabled: open && selectedDraftId != null,
  });
  const drafts = history.data ?? [];
  const selected = detail.data;

  return (
    <section className="note-sec draft-history">
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Hide draft history" : "Draft history and transcript revisions"}
      </button>
      {open ? (
        <div>
          {history.isPending ? <p className="note-one">Loading saved drafts…</p> : null}
          {history.isError ? <p className="note-gate">Draft history could not be loaded. Try again.</p> : null}
          {!history.isPending && !history.isError && !drafts.length ? <p className="note-one">No saved draft history is available for this story.</p> : null}
          {drafts.length ? (
            <ul className="meeting-citations" aria-label="Saved draft history">
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <p><b>{draft.headline || "Untitled draft"}</b>{draft.id === currentDraftId ? " · Current draft" : " · Earlier draft"}</p>
                  <p className="note-one">{new Date(draft.updatedAt).toLocaleString()} · {draft.topic || "Uncategorized"}</p>
                  {draft.transcriptLinks.map((link) => (
                    <p className="note-one" key={link.id}>
                      Transcript artifact {link.artifactId} ({link.sha256.slice(0, 12)}…) · {link.citationCount} saved citation{link.citationCount === 1 ? "" : "s"}
                      {link.revisionNotice ? ` · ${link.revisionNotice}` : ""}
                    </p>
                  ))}
                  {draft.transcriptReviews.map((review, index) => (
                    <p className="note-one" key={`${draft.id}-review-${review.acceptedArtifactId}-${index}`}>
                      Citation review of artifact {review.acceptedArtifactId} ({review.acceptedArtifactSha256.slice(0, 12)}…) by {review.reviewedBy} on {new Date(review.reviewedAt).toLocaleString()}: {review.note}
                    </p>
                  ))}
                  <button type="button" className="btn" onClick={() => setSelectedDraftId(draft.id)}>
                    {selectedDraftId === draft.id ? "Showing this saved draft" : "View saved draft and evidence"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {detail.isPending && selectedDraftId != null ? <p className="note-one">Loading saved draft…</p> : null}
          {detail.isError ? <p className="note-gate">The saved draft could not be loaded.</p> : null}
          {selected ? (
            <article className="note-sec" aria-label={`Saved draft ${selected.id}`}>
              <h3>{selected.headline || "Untitled draft"}</h3>
              {selected.dek ? <p>{selected.dek}</p> : null}
              <pre className="draft-history-body">{selected.body}</pre>
              {selected.transcriptLinks.map((link) => (
                <section key={`history-link-${link.id}`}>
                  <p><b>Original transcript artifact {link.artifactId}</b> · SHA-256 {link.sha256}</p>
                  {link.revisionNotice ? <p className="note-gate">{link.revisionNotice}</p> : null}
                  <ul className="meeting-citations">
                    {link.citations.map((citation, index) => (
                      <li key={`${link.id}-${citation.segmentIndex}-${index}`}>
                        <p className="meeting-citation-head">Segment {citation.segmentIndex} · {citation.timestampSeconds == null ? "time unavailable" : meetingClock(citation.timestampSeconds)}</p>
                        <p className="meeting-citation-excerpt">{citation.segmentAvailable ? citation.excerpt : "The saved citation no longer resolves to matching stored transcript text."}</p>
                        {citation.captionSha256 ? <code>{citation.captionSha256}</code> : null}
                      </li>
                    ))}
                    {!link.citations.length ? <li>Transcript citations are missing or malformed in this history record.</li> : null}
                  </ul>
                </section>
              ))}
              {selected.transcriptReviews.map((review) => (
                <section key={`accepted-review-${review.id}`}>
                  <p><b>Editor citation review</b> · artifact {review.acceptedArtifactId} · SHA-256 {review.acceptedArtifactSha256}</p>
                  <p>{review.reviewedBy} · {new Date(review.reviewedAt).toLocaleString()}</p>
                  <p>{review.note}</p>
                  <ul className="meeting-citations">
                    {review.citations.map((value, index) => {
                      const citation = value as { sourceSegmentIndex?: number; acceptedSegmentIndex?: number; acceptedTimestampSeconds?: number; excerpt?: string; captionSha256?: string };
                      return (
                        <li key={`review-citation-${review.id}-${index}`}>
                          <p>Original A segment {citation.sourceSegmentIndex ?? "unknown"} → accepted B segment {citation.acceptedSegmentIndex ?? "unknown"}
                            {citation.acceptedTimestampSeconds != null && Number.isFinite(citation.acceptedTimestampSeconds) ? ` · ${meetingClock(citation.acceptedTimestampSeconds)}` : ""}</p>
                          <p className="meeting-citation-excerpt">{citation.excerpt ?? "Accepted passage unavailable."}</p>
                          {citation.captionSha256 ? <code>{citation.captionSha256}</code> : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReportingNotesPane({
  leadId,
  notes,
  hasDraft,
  locked,
  openedExtractionByUrl,
  draftMeetingEvidence,
  onMeetingRedraft,
  meetingRedrafting,
  evidenceToken,
  onReverifyMeetingCitations,
  reverifyingMeetingCitations,
  currentDraftId,
}: {
  leadId: number;
  notes: ReportingNotes;
  hasDraft: boolean;
  locked: boolean;
  /** Capture-time extraction method for each `notes.opened` url, when known (see getLead). */
  openedExtractionByUrl: Record<string, string | null>;
  draftMeetingEvidence: DraftMeetingEvidence | null;
  onMeetingRedraft?: () => void;
  meetingRedrafting: boolean;
  evidenceToken: string;
  onReverifyMeetingCitations?: (review: { confirmedSegmentIndexes: number[]; note: string }) => void;
  reverifyingMeetingCitations: boolean;
  currentDraftId: number | null;
}) {
  const qc = useQueryClient();
  const [line, setLine] = useState("");
  const [startingPullIndex, setStartingPullIndex] = useState<number | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const small = usePhoneNotes();
  const filled =
    notesHaveMemo(notes) ||
    notes.opened.length > 0 ||
    notes.found.length > 0 ||
    notes.verify.length > 0;
  const verifyItems = notes.verify.flatMap(integrityNoteItems);
  const pullRuns = useQuery({
    queryKey: ["pull-jobs", leadId],
    queryFn: () => listPullJobs({ data: { leadId } }),
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (run) => run.jobStatus === "queued" || run.jobStatus === "running",
      )
        ? 1_000
        : false,
  });
  const terminalPulls = (pullRuns.data ?? [])
    .filter((run) => run.jobStatus === "completed" || run.jobStatus === "failed")
    .map((run) => `${run.jobId}:${run.updatedAt}`)
    .join("|");
  const lastTerminalPulls = useRef("");
  useEffect(() => {
    if (!terminalPulls || terminalPulls === lastTerminalPulls.current) return;
    lastTerminalPulls.current = terminalPulls;
    void qc.invalidateQueries({ queryKey: ["lead", leadId] });
  }, [leadId, qc, terminalPulls]);

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
      setStartingPullIndex(input.index);
      setPullMsg("");
    },
    onSuccess: (res) => {
      setStartingPullIndex(null);
      if (!answered(res)) {
        setPullMsg(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setPullMsg(res.error);
        return;
      }
      setPullMsg("Pull started. Its live progress is shown under the reporting line.");
      void qc.invalidateQueries({ queryKey: ["pull-jobs", leadId] });
    },
    onError: (err) => {
      setStartingPullIndex(null);
      setPullMsg(
        editorActionError(err instanceof Error ? err.message : "", "start the Pull") ??
          "Pull failed.",
      );
    },
  });
  const stopPull = useMutation({
    mutationFn: (jobId: number) => stopPullJob({ data: { jobId } }),
    onSuccess: (res) => {
      if (!res.ok) setPullMsg(res.error);
      void qc.invalidateQueries({ queryKey: ["pull-jobs", leadId] });
    },
    onError: (err) =>
      setPullMsg(
        editorActionError(err instanceof Error ? err.message : "", "stop the Pull") ??
          "Could not stop Pull.",
      ),
  });
  const continuePull = useMutation({
    mutationFn: (jobId: number) => continuePullJob({ data: { jobId } }),
    onSuccess: (res) => {
      setPullMsg(res.ok ? "Pull continued from its saved checkpoint." : res.error);
      void qc.invalidateQueries({ queryKey: ["pull-jobs", leadId] });
    },
    onError: (err) =>
      setPullMsg(
        editorActionError(err instanceof Error ? err.message : "", "continue the Pull") ??
          "Could not continue Pull.",
      ),
  });

  /*
    Claims of absence get their own block, above everything else in the notes.

    They are not to-dos. A to-do is work the story would be better for; one of
    these is a sentence already in the story asserting that a public document
    does not exist, and printing it unchecked is how the paper prints something
    false. The checkbox is the editor saying they opened the city's site.
  */
  /*
    "Where this came from" sits at the top of the notes on a meeting story.

    It renders nothing for a draft with no transcript citations, so every other
    story in the paper is unchanged.
  */
  const meetingSourceBlock = (
    <MeetingSourceBlock
      notes={notes}
      usedEvidence={draftMeetingEvidence}
      onRedraft={onMeetingRedraft}
      redrafting={meetingRedrafting}
      onReverify={onReverifyMeetingCitations}
      reverifying={reverifyingMeetingCitations}
      evidenceToken={evidenceToken}
    />
  );
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
        {notes.todo.map((t, i) => {
          if (t.src === "gate") return null;
          const candidates = pullRuns.data ?? [];
          const queryIsUnique = notes.todo.filter((row) => row.t === t.t).length === 1;
          const run =
            candidates.find((candidate) => candidate.todoIndex === i && candidate.query === t.t) ??
            (queryIsUnique
              ? candidates.find((candidate) => candidate.query === t.t)
              : candidates.find(
                  (candidate) => candidate.todoIndex == null && candidate.query === t.t,
                ));
          return (
            <TodoRow
              key={`${prefix}-${t.src}-${t.t}-${i}`}
              item={t}
              disabled={locked}
              run={run}
              starting={startingPullIndex === i}
              onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
              onPull={() => pull.mutate({ index: i, query: t.t })}
              onStop={() => run && stopPull.mutate(run.jobId)}
              onContinue={() => run && continuePull.mutate(run.jobId)}
            />
          );
        })}
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
      {meetingSourceBlock}
      {hasDraft ? <DraftHistoryPanel leadId={leadId} currentDraftId={currentDraftId} /> : null}
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
                aria-label="Who owes a response"
              />
              <input
                value={fuWhat}
                onChange={(e) => setFuWhat(e.target.value)}
                placeholder="For what — one line"
                aria-label="What response is needed"
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
            aria-label="Add a reporting note"
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
    const activePull =
      startingPullIndex != null ||
      (pullRuns.data ?? []).some(
        (run) => run.jobStatus === "queued" || run.jobStatus === "running",
      );
    return (
      <details className="notes-disc" open={activePull || undefined}>
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
  run,
  starting,
  onToggle,
  onPull,
  onStop,
  onContinue,
}: {
  item: ReportingNotes["todo"][number];
  disabled: boolean;
  run?: PullRunView;
  starting: boolean;
  onToggle: () => void;
  onPull: () => void;
  onStop: () => void;
  onContinue: () => void;
}) {
  const active = starting || run?.jobStatus === "queued" || run?.jobStatus === "running";
  return (
    <div className="todo-pull-group">
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
          <button type="button" className="todo-pull" disabled={active} onClick={onPull}>
            {active ? "Pulling…" : "Pull"}
          </button>
        ) : null}
      </div>
      {run ? (
        <PullProgress run={run} onStop={onStop} onContinue={onContinue} disabled={disabled} />
      ) : starting ? (
        <div className="pull-progress active">
          <div className="pull-progress-head">
            <strong>Starting Pull…</strong>
            <span>0s</span>
          </div>
          <p>Mechanical web search and document extraction — no AI model is being used.</p>
          <p className="pull-counts" aria-live="polite">Creating the saved background job…</p>
        </div>
      ) : null}
    </div>
  );
}

function PullProgress({
  run,
  onStop,
  onContinue,
  disabled,
}: {
  run: PullRunView;
  onStop: () => void;
  onContinue: () => void;
  disabled: boolean;
}) {
  const active = run.jobStatus === "queued" || run.jobStatus === "running";
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  const start = run.startedAt ? Date.parse(run.startedAt) : Date.parse(run.updatedAt);
  const end = active ? now : run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(run.updatedAt);
  const elapsed = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : 0;
  const canContinue =
    !active && (run.status === "stopped" || run.status === "deadline" || run.status === "failed");
  return (
    <div className={`pull-progress ${active ? "active" : "finished"}`}>
      <div className="pull-progress-head">
        <strong aria-live="polite">{run.stage}</strong>
        <span>{elapsed}s</span>
      </div>
      <p>Mechanical web search and document extraction — no AI model is being used.</p>
      <p className="pull-counts" aria-live="polite">
        {run.counters.searchesAttempted} searches · {run.counters.providersAttempted} providers ·{" "}
        {run.counters.indexPagesChecked} index pages · {run.counters.documentsOpened} documents opened ·{" "}
        {run.counters.documentsSaved} saved
      </p>
      <div className="pull-progress-actions">
        {active ? (
          <button type="button" className="text-action" disabled={disabled || run.stopRequested} onClick={onStop}>
            {run.stopRequested ? "Stopping…" : "Stop"}
          </button>
        ) : null}
        {canContinue ? (
          <button type="button" className="text-action" disabled={disabled} onClick={onContinue}>
            Continue pull
          </button>
        ) : null}
        {run.errors.length ? (
          <details>
            <summary>
              {run.errors.length} provider or page failure{run.errors.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {run.errors.map((error, index) => (
                <li key={`${run.jobId}-pull-error-${index}`}>{error}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
