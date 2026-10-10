import { NativeDialog } from "@/components/dialog";
import { StoryReadinessChip } from "@/components/story-readiness-chip";
import { editorStoryState, savedStoryReadiness } from "@/lib/news/story-readiness";
import { UNCHECKED_STORY_REASON, uncheckedStoryNeedsCheck } from "@/lib/news/unchecked-story-gate";
import { StoryBody } from "@/components/story-body";
import { CheckGates } from "@/components/check-gates";
import { BeforeYouCanPublish } from "@/components/publish-blockers";
import {
  pageGateChip,
  recordedChecks,
} from "@/lib/news/check-gates";
import {
  blockerPressState,
  publishBlockers,
  publishPressState,
  showsPublishPrep,
  type PublishBlockerTarget,
} from "@/lib/news/publish-blockers";
import { PublishBarDone, PublishBarResult, PublishTranscriptNotice } from "@/components/publish-bar-result";
import { ActionButton, type ActionPhase } from "@/components/action-button";
import { KilledLeadRecord, LeadComparePanel } from "@/components/desk-lead-compare";
import { StoryDocumentList, StoryDocumentPartialNotice } from "@/components/story-documents";
import { DeskNameCheck } from "@/components/desk-name-check";
import { readNameCheck } from "@/lib/news/name-check";
import { MeetingSourceBlock } from "@/components/meeting-source-block";
import { MeetingTranscriptChooser } from "@/components/meeting-transcript-chooser";
import { MeetingLedgerPanel } from "@/components/meeting-ledger-panel";
import { meetingClock } from "@/components/meeting-source-block-utils";
import { DraftScopePicker } from "@/components/draft-scope-picker";
import {
  evidenceNeedsReview,
  mayInheritLeadSources,
  type EvidenceDecision,
} from "@/lib/news/draft-evidence";
import { auditDraft, findingsWithIds, type DraftAuditFinding } from "@/lib/news/draft-audit";
import type {
  EvidenceCheckReport,
  EvidenceCheckState,
} from "@/lib/news/evidence-check-state";
import { parseStyleRecord } from "@/lib/news/draft-audit-record";
import { areaPills, HOME_AREA } from "@/lib/story-area";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { editorTitle } from "@/lib/news/desk-copy";
import { Busy, DeskShell, Field, InkButton } from "@/components/desk-chrome";
import { leadOrigin, announceToDesk } from "@/components/desk-chrome-utils";
import { SaveShortcut, SaveShortcutHint } from "@/components/desk-save-shortcut";
import { EmptyState, WorkbenchSkeleton, Notice, ScreenError } from "@/components/states";
import {
  draftLead,
  fixDraftStyle,
  getLead,
  loadLeadReportingPackage,
  getDraftHistoryItem,
  listDraftHistory,
  listPullJobs,
  publishLead,
  pullTodo,
  resolveDraftMeetingReview,
  acceptUnreviewedClaims,
  acknowledgeUncheckedStory,
  continuePullJob,
  overrideNamedOutlet,
  resolveLeadDuplicate,
  rewriteFromLedger,
  saveDraft,
  saveReportingNotes,
  setLeadStatus,
  stopPullJob,
  suggestHeadlines,
  updateArticleHeadline,
} from "@/lib/news/desk";
import type { PullRunView } from "@/lib/news/pull.server";
import { failureSummary } from "@/lib/news/pull-outcome";
import { explainPairMatch } from "@/lib/news/lead-match";
import { myDesk } from "@/lib/news/claim";
import { uncreditedOutlets } from "@/lib/news/source-credit";
import { parseUrlList } from "@/lib/paper";
import { useEditorSections } from "@/lib/use-sections";
import { saveLeadTopic } from "@/lib/news/lead-topic";
import { useAreaLabels, usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import {
  applyTodoPatch,
  clipTodoText,
  earlierReportingNotes,
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
  initialStoryTopic,
  recoverExpectedDraftJobId,
  resolveDraftJobState,
  recoveringDraftCopy,
} from "@/lib/news/desk-copy";
import { stripReporterNotebook } from "@/lib/news/strip-draft";
import { describeExtractionMethod } from "@/lib/news/extraction-label";
import { ModelPicker } from "@/components/model-picker";
import { useFirstRunPickerSeed } from "@/components/first-run-picker-default";
import { usePaperSetupGate } from "@/components/paper-setup-gate";
import { PaperSetupGateNote } from "@/components/PaperSetupGateNote";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { FindingEvidenceReviewPanel } from "@/components/finding-evidence-review";
import { evidenceReviewDisabled, takeDownPressDisabled } from "@/lib/news/finding-evidence-locks";
import { evidenceDetailId, STYLE_ROW_KEY } from "@/lib/news/evidence-check-list";
import {
  modelChoiceLabel,
  rememberedStoryModelChoice,
  retiredModelChoiceNote,
  type StoryModelChoice,
} from "@/lib/news/model-choice";
import { defaultModelEffort, modelEffort as validatedModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { providerAvailability } from "@/lib/news/provider-availability";
import { PROVIDER_AVAILABILITY_QUERY_KEY } from "@/lib/news/provider-availability-key";
import { getCustomAiConnectionsFn } from "@/lib/news/custom-ai-settings";
/*
  The Writer / Effort bar's own lines (unit CW): the readiness dot, the
  last-draft line and the save line under the Story label. Each is derived,
  and each refuses to say something the desk did not record -- see the
  module's own note on what "model availability" is about.
*/
import {
  lastDraftLine,
  lastDraftWhen,
  readinessDot,
  saveState,
  writerIsReady,
} from "@/lib/news/writer-bar";
import { integrityNoteItems } from "@/lib/news/coerce-draft";
import {
  DraftReconcileControl,
  type EvidenceCheckReview,
} from "@/components/draft-reconcile-control";
/*
  Unit BH2 decisions 5 and 6: the Kill, Redraft and Compare-versions dialogs.
  All three are mounted at the foot of this page and opened from a press that
  already existed or from the one new Kill press in the context row.
*/
import { KillDialog } from "@/components/dialogs/KillDialog";
import { RedraftDialog } from "@/components/dialogs/RedraftDialog";
import { CompareVersionsDialog } from "@/components/dialogs/CompareVersionsDialog";
import { AddToStoryDialog, HeadlineDialog } from "@/components/dialogs";
import { StoryCheckJobProgress, StoryJobProgress } from "@/components/JobCard";
import { jobProgressView } from "@/lib/news/job-progress";
/*
  Civic reporting (editor UI). `ReportingPackagePanel` draws the structured
  package the runner filed for this lead beside the editable copy, and
  `ReportThisLeadControl` is the press that starts a run anchored on this
  lead. Both are new, lead-scoped files; neither writes a package itself -- the
  runner does. See reporting-package-panel.tsx.
*/
import { ReportingPackagePanel } from "@/components/reporting-package-panel";
import { ReportThisLeadControl } from "@/components/report-this-lead";
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
import type { MeetingAccounting } from "@/lib/news/meeting-ledger.server";

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

/**
 * One finding in the style check, with the tick that decides whether "Fix these
 * with the model" sends it.
 *
 * The label wraps the box, so the whole row is the click target and the
 * finding's own words are the control's accessible name -- nothing restates on
 * `aria-label` what is already written on the page.
 */
function StyleFindingRow({
  finding,
  ticked,
  onTick,
}: {
  finding: DraftAuditFinding;
  ticked: boolean;
  onTick: (ticked: boolean) => void;
}) {
  return (
    <li>
      <label className="style-tick">
        <input type="checkbox" checked={ticked} onChange={(e) => onTick(e.target.checked)} />
        <span>
          <span className="style-tick-t">
            <b>{styleLocation(finding)}</b> · {finding.message}
          </span>
          {finding.snippet ? <span className="style-tick-q">{finding.snippet}</span> : null}
        </span>
      </label>
    </li>
  );
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
  /*
    Unit U24: the paper as the desk has it configured, for the one rule below
    that needs to know which city this paper publishes in (`creditsHomeCity`,
    src/lib/news/source-credit.ts). The resolved identity, not the build-time
    constant, so a desk that renamed its city in Paper setup gets its own city's
    prose words -- the same value /about renders.
  */
  const paperIdentity = usePaper();
  // The same words the reader sees on the pill row: this paper's own
  // geography, not the shipped default's (see `useAreaLabels`).
  const labels = useAreaLabels();
  const { leadId } = Route.useParams();
  const id = Number(leadId);
  const qc = useQueryClient();
  const reportingPackage = useQuery({
    queryKey: ["reporting-package", id],
    queryFn: () => loadLeadReportingPackage({ data: { leadId: id } }),
    enabled: Number.isFinite(id),
  });
  const [headline, setHeadline] = useState("");
  const [dek, setDek] = useState("");
  const [body, setBody] = useState("");
  const [manualDraft, setManualDraft] = useState<"write" | "paste" | null>(null);
  const [selectedMeetingTranscriptArtifactId, setSelectedMeetingTranscriptArtifactId] = useState<number | null>(null);
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
  /*
    The geography the paper's pills filter on (0.6.71). One more field on the
    existing publish step, not a new step: the editor sets it here and the
    request carries it, exactly as the section travels.

    Default is the home town, which is also what a story with no stored area
    reads as on the paper -- so the default the editor sees and the default a
    scripted publish gets are the same ground, and neither is a decision nobody
    made.
  */
  const [area, setArea] = useState<string>(HOME_AREA);
  const [scratch, setScratch] = useState("");
  const [storyDirection, setStoryDirection] = useState("");
  const [researchScope, setResearchScope] = useState<"public" | "supplied">("public");
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(null);
  const [modelResearchOpen, setModelResearchOpen] = useState(false);
  const modelResearchPanel = useRef<HTMLElement>(null);
  const modelChoiceTouched = useRef(false);
  /*
    F3b: on a fresh install that finished setup with a local model in memory,
    "Draft with AI" opens on Local model instead of sending the literal "auto"
    as an explicit pick -- which outranks the paper's stored assignment and
    walked Automatic anyway. Declared BEFORE the effect below that hydrates the
    picker from the job's remembered model, so a story that already has a model
    on it still wins: both set the state in the same commit, and the later
    effect is the one that sticks. The owner's own touch always wins too (see
    first-run-picker-default.ts).
  */
  useFirstRunPickerSeed({
    surface: "story",
    current: modelChoice,
    touched: () => modelChoiceTouched.current,
    apply: (choice) => {
      setModelChoice(choice);
      setModelEffort(defaultModelEffort(choice));
    },
  });
  /*
    Publishing is the only irreversible thing on this page, and it was the
    only one that did not ask.

    An audit put it plainly: one unconfirmed click puts a story on a public
    website, in a product whose whole premise is that a human deliberately
    decides what prints -- while Delete, which keeps a copy for thirty days,
    gets a paragraph of consequence and a second click. The weights were the
    wrong way round.

    Same inline pattern the desk already uses for Delete, so it is a shape
    the editor recognizes rather than a new dialog to learn.
  */
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [msg, setMsg] = useState("");
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  /*
    Whether the story on the paper got there from THIS page (unit PUB1).
    `publishedSlug` alone cannot answer it: a page opened on an already
    published story seeds it from the loader, and a green "Published." bar
    greeting every visit would be the desk saying something happened that did
    not happen just now.
  */
  const [justPublished, setJustPublished] = useState(false);
  /*
    What the sticky bar says about the last press (unit PUB1).

    The server's own words for a refusal, held HERE rather than in `msg`,
    because `msg` is drawn as a Notice in the page body -- and on the owner's
    story the body Notice was far from the button he pressed, which is how a
    refusal came to look like a dead button. Cleared by the next press and by
    any edit to the story, so it can never describe a draft that has moved on.
  */
  const [publishRefusal, setPublishRefusal] = useState("");
  /*
    Unit UI1a. The blocker row that just recorded an acceptance, so the control
    that was pressed can say "Accepted" with a check instead of going quiet.
    Held for as long as the row is on the page: the acceptance is recorded
    against ONE review token, so any edit to the words clears it along with the
    refusal (see the effect below) -- a check left standing beside a row that
    has come back for a NEW review would be the desk claiming a decision nobody
    made about this version.
  */
  const [acceptedUnreviewed, setAcceptedUnreviewed] = useState(false);
  /*
    Unit UI1a2. "Redraft started" / "Draft started": the press's own done word,
    held only until the draft it started actually lands. Cleared by the effect
    that seeds the box from the new draft, so the control goes back to reading
    "Redraft" (or "Draft with AI") for the next press -- a done state latched
    forever would rename the button out from under the walks that ask for it by
    name.
  */
  const [redraftDone, setRedraftDone] = useState(false);
  /*
    WR1 phase 2. "Rewrite from ledger" is the same press as the Draft button --
    the same job, the same wait, the same landing -- so it shares this
    mutation's phases rather than growing a second progress line. This is the
    one bit of state that tells the two presses apart: which one was asked for
    last, so the done word and the working word land on the button that was
    pressed and not on its neighbour.
  */
  const [rewriteDone, setRewriteDone] = useState(false);
  const pressWasRewrite = useRef(false);
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
  const leadTopicChoice = useRef<string | null>(null);
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
  /*
    Unit U24: the evidence check's one state, reported up by the Checks pane
    (the only thing holding the resolved review) and read by the chips, the
    publish bar and the blockers. Declared here with the rest of the page's
    state, above the loading and not-found returns below, because a hook after
    an early return is a hook that does not run on every render.
  */
  const [panelEvidence, setPanelEvidence] = useState<(EvidenceCheckReport & { revision?: string }) | null>(null);
  /*
    Unit BH2 decision 5 and 6, the three dialogs. Each is opened by a press and
    owns nothing else: the record, the two calls and the saved text all stay
    where they were, which is what makes these dialogs a new surface rather than
    a new behavior.
  */
  const [killOpen, setKillOpen] = useState(false);
  const [redraftOpen, setRedraftOpen] = useState(false);
  const [compareVersionsOpen, setCompareVersionsOpen] = useState(false);
  /*
    Unit CP: the two drawn dialogs that had no press on this page. The "+ Add to
    story" press in the action row opens the first, the "Suggest headlines"
    press beside the headline box opens the second (`Desk Story.dc.html:114` and
    `:97`). Both write through the server functions they always called; nothing
    about this screen's own save path changes.
  */
  const [addToOpen, setAddToOpen] = useState(false);
  const [headlineOpen, setHeadlineOpen] = useState(false);
  /*
    "Preview viewed" is a checklist item in the drawing, not a gate: opening the
    preview is a thing this session has done or has not, and the publish button
    below is still refused by exactly the list it always was. Nothing here reads
    it to disable anything.
  */
  const [previewSeen, setPreviewSeen] = useState(false);

  const waiting = waitingSince !== null;

  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => getLead({ data: id }),
    refetchInterval: waiting ? 2000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const meetingTranscriptChoices = data?.meetingTranscriptChoices ?? [];
  const onEvidenceState = useCallback((state: EvidenceCheckReport) => setPanelEvidence({ ...state, revision: data?.evidenceToken }), [data?.evidenceToken]);
  const selectedMeetingArtifactId = selectedMeetingTranscriptArtifactId
    ?? data?.defaultMeetingTranscriptArtifactId
    ?? null;
  useEffect(() => {
    setSelectedMeetingTranscriptArtifactId((current) =>
      data?.meetingTranscriptChoices?.some((choice) => choice.artifactId === current)
        ? current
        : data?.defaultMeetingTranscriptArtifactId ?? null,
    );
  }, [data?.meetingTranscriptChoices, data?.defaultMeetingTranscriptArtifactId]);

  const [topic, setTopic] = useState(() => initialStoryTopic(data?.lead.topic));

  currentDraftFields.current = { headline, dek, body, topic };
  /*
    Unit U11b: whether this editor is the owner, so the evidence review knows
    whether to draw the "Take down this capture" press. The same `my-desk`
    query the desk shell already holds (`desk.tsx`'s DeskGate), so this is a
    cache read in practice, not a second round trip. The server refuses a
    non-owner regardless (see `evidence-takedown.ts`); this only decides what
    the page offers.
  */
  const deskRole = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const isOwner = deskRole.data?.ok === true && deskRole.data.role === "owner";
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

  /*
    Whether the writer the editor has chosen can actually run, for the drawn
    "model availability" dot (unit CW).

    Both reads are `ModelPicker`'s own, under its own query keys, so the bar
    above the panel and the panel's option list are served from one cache entry
    and can never answer the question differently -- and opening the panel
    costs no extra request, since the panel reads what is already here.
  */
  const writerAvailability = useQuery({
    queryKey: PROVIDER_AVAILABILITY_QUERY_KEY,
    queryFn: () => providerAvailability(),
    staleTime: 5 * 60 * 1000,
  });
  const writerConnections = useQuery({
    queryKey: ["custom-ai-connections"],
    queryFn: () => getCustomAiConnectionsFn(),
    staleTime: 15_000,
  });

  const previousJobError =
    !waiting && !msg && data?.job?.status === "failed"
      ? (editorDraftError(data.job.error) ?? data.job.error ?? "The last draft did not finish.")
      : "";
  const draftProblem = msg || previousJobError;

  /*
    The writer row's derived words (unit CW).

    `readiness` is about the writer -- can the chosen model run on this server?
    -- not about the draft: the drawing itself shows "model availability" above a sticky
    bar reading "Review 1 name to publish.", so the dot cannot mean "this may
    print". `lastDraft` is the one line the drawing draws about the draft in
    hand, and it is empty unless the desk recorded a draft job that finished:
    an hour nobody wrote down is not an hour this bar may print.
  */
  let civicReportingDraft = false;
  try {
    const research: unknown = JSON.parse(data?.draft?.research_json ?? "{}");
    civicReportingDraft = Boolean(
      research && typeof research === "object" && !Array.isArray(research) &&
      (research as { civicReporting?: unknown }).civicReporting === true,
    );
  } catch {
    // Malformed metadata cannot identify this as a civic-reporting draft.
  }
  /*
    A civic-reporting run files a new draft without a standard `draft` job.
    `data.job` is the latest standard writer job and can belong to an older
    draft, so do not pair its model/time with this reporting-created draft.
    The Reporting package shows its own run status; until the page has a
    truthful reporting receipt line, suppress this stale attribution.
  */
  const lastDraft = civicReportingDraft
    ? ""
    : lastDraftLine({
        modelLabel: data?.job?.model_choice ? modelChoiceLabel(data.job.model_choice) : "",
        when: lastDraftWhen(data?.job?.finished_at),
      });

  useEffect(() => {
    if (!modelResearchOpen) return;
    const frame = requestAnimationFrame(() => {
      modelResearchPanel.current?.scrollIntoView?.({ block: "nearest" });
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
    if (!d) {
      if (data?.lead && !topicTouched) setTopic(initialStoryTopic(data.lead.topic));
      return;
    }
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
        setTopic(leadTopicChoice.current ?? d.topic);
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
    setTopic(leadTopicChoice.current ?? d.topic);
    appliedFp.current = fp;
    expectedDraftJobId.current = null;
    /* Unit UI1a2: the draft this press started has arrived, so the control's
       done word comes off and it reads "Redraft" again. The ledger panel's
       rewrite button is the same press, so its done word comes off with it. */
    setRedraftDone(false);
    setRewriteDone(false);
    priorDraftJobId.current = data.job?.id ?? null;
    priorDraftJobWasOpen.current = false;
    setWaitingSince(null);
    setSlowWait(false);
    const completion = parseDraftCompletionReceipt(data.job?.result_json);
    setMsg(completion?.quality.reviewRequired
      ? "Draft saved. Review the source and name-check warnings before publication."
      : "Draft saved.");
  }, [topicTouched, awaitingDraftJobAck, data, waitingSince]);

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

  // SG1 / Option A: "Draft with AI" and the redraft it opens.
  const paperGate = usePaperSetupGate("draft this story");
  const draft = useMutation({
    /*
      Unit BH2 decision 6: the direction is a variable now, because the Redraft
      dialog types a new one and the two calls below must save it before the
      draft starts. `undefined` means "the direction already on the page", which
      is what every other press on this screen passes, so the order and the
      arguments of `saveReportingNotes` then `draftLead` are unchanged.
    */
    mutationFn: async (input: string | { fromLedger: true } | undefined) => {
      /*
        WR1 phase 2: one press, two sources. A string (or nothing) means the
        ordinary Draft/Redraft, reading the tape and the packet; `{fromLedger}`
        means the Meeting ledger panel's "Rewrite from ledger", which queues the
        same kind of job with `reuseLedger` set -- the worker then skips reading
        the tape and writes from the stored ledger and the editor's statuses.
        Keeping them in one mutation is what makes the progress, the wait and
        the landing identical; only the server call differs.
      */
      const direction = typeof input === "string" ? input : undefined;
      const fromLedger = typeof input === "object" && input !== null && input.fromLedger === true;
      await saveReportingNotes({
        data: { leadId: id, scratch, storyDirection: direction ?? storyDirection, researchScope, todos: parseNotes(data?.lead.notes_json).todo }, // tampercheck: allow existing reporting checklist items are preserved through draft, save and publish; not an implementation placeholder.
      });
      const meetingArtifactId = selectedMeetingArtifactId ?? data?.defaultMeetingTranscriptArtifactId ?? undefined;
      if (fromLedger)
        return rewriteFromLedger({ data: { leadId: id, modelChoice, modelEffort, researchScope, meetingArtifactId } });
      return draftLead({ data: { leadId: id, modelChoice, modelEffort, researchScope, meetingArtifactId } });
    },
    onMutate: (input) => {
      setMsg("");
      /* Which button was pressed, recorded from the press itself so the phase
         below never has to guess. */
      pressWasRewrite.current =
        typeof input === "object" && input !== null && input.fromLedger === true;
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
      if (answered(res) && res.ok) {
        expectedDraftJobId.current = res.jobId;
        /* Unit UI1a2: the press took, so the control that made it says so. */
        if (pressWasRewrite.current) setRewriteDone(true);
        else setRedraftDone(true);
      }
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

  const saveTopic = useMutation({
    mutationFn: (nextTopic: string) => saveLeadTopic({ data: { leadId: id, topic: nextTopic } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setMsg("Saved.");
    },
    onError: (err) => {
      setMsg(
        editorActionError(err instanceof Error ? err.message : "", "save your section") ??
        "Your section did not save.",
      );
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const notesProblem = await saveNotesQuietly();
      await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      return { notesProblem };
    },
    onSuccess: async ({ notesProblem }) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      setManualDraft(null);
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

  /*
    Unit U24: the recorded override for a draft going to paper with claims its
    own evidence check raised and nobody judged. It is a press, not a checkbox
    in the publish dialog, so the acceptance is a separate, dated, attributed
    record rather than a side effect of printing -- and `performPublish` refuses
    without it, which is what makes it a gate instead of a suggestion.
  */
  const acceptUnreviewed = useMutation({
    /*
      Unit U24b: the press carries the REVIEW TOKEN the editor was looking at,
      the same identity the judgment saves send, and the server refuses an
      acceptance recorded against a review that has moved since. The bare lead
      id plus a token -- `rowId` and a string, validated together.
    */
    mutationFn: () =>
      acceptUnreviewedClaims({
        data: { leadId: id, evidenceToken: panelEvidence?.evidenceToken ?? "" },
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      /*
        B7R, item 4: two answers, two tones. A recorded acceptance is a finished
        press and takes the accent; the refusal is a failure and takes the
        danger edge, so the reason is never painted as the next step.
      */
      if (res.ok) setAcceptedUnreviewed(true);
      announceToDesk(
        res.ok
          ? `Recorded: you accepted ${res.count} unreviewed claim${res.count === 1 ? "" : "s"} for this draft.`
          : res.error,
        res.ok ? "ok" : "err",
      );
    },
    onError: (err) => {
      announceToDesk(
        editorActionError(err instanceof Error ? err.message : "", "record that acceptance") ??
          "Could not record that acceptance.",
        "err",
      );
    },
  });

  /*
    Unit ZC: "I checked this story myself" -- the one-press acknowledgement of
    the zero-claims gate. It carries the DRAFT identity the page is holding
    (`data.evidenceToken`), the same value `performPublish` would confirm the
    section against, so the server can refuse a press for a version the editor
    never saw. It is a server round trip like the acceptance above, so it goes
    through the shared `blockerPressState` and `ActionButton` phase machinery.
  */
  const acknowledgeUnchecked = useMutation({
    /*
      Unit ZC: the acknowledgement is for the words on screen, so the press saves
      the CURRENT editor fields first (the same save the Publish press makes),
      then reads the fresh draft identity the save produced and submits THAT. If
      the editor types again while the save is in flight, those new unsaved fields
      stay blocked -- the acknowledgement names the saved version, and the page's
      `hasUnsavedDraftEdits` gate keeps the chip up.
    */
    mutationFn: async () => {
      await saveDraft({ data: { leadId: id, headline, dek, body, topic } });
      const fresh = await getLead({ data: id });
      return acknowledgeUncheckedStory({
        data: { leadId: id, evidenceToken: fresh?.evidenceToken ?? "" },
      });
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["lead", id] });
      announceToDesk(
        res.ok
          ? "Recorded: you confirmed you checked this story against your sources."
          : res.error,
        res.ok ? "ok" : "err",
      );
    },
    onError: (err) => {
      announceToDesk(
        editorActionError(err instanceof Error ? err.message : "", "record that check") ??
          "Could not record that check.",
        "err",
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

    No ticks, no call: the button sends the ids of the findings the editor
    ticked, and the server looks each one up in its own audit of this same text
    (`draft-audit.server.ts`), so a finding the client made up can never reach
    the model. A body that names nothing is refused there as well as here.
  */
  const fixStyle = useMutation({
    mutationFn: () =>
      fixDraftStyle({
        data: {
          leadId: id,
          headline,
          dek,
          body,
          topic,
          modelChoice,
          modelEffort,
          findingIds: styleTickedIds,
        },
      }),
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
  /*
    ── The tick boxes ──────────────────────────────────────────────────────────
    "Fix these with the model" used to be a grey button with no reason: whether
    it was offered said "there is nothing here to fix", but the editor reading a
    "to read" line could not send it, and nothing on the page said why.

    Now every finding carries a tick. The fix-level ones start ticked (the list
    the desk would have sent on its own) and the "to read" ones start clear, so
    the model's work is still scoped by default and the editor can widen it
    deliberately. What travels to the server is the ID of each ticked row, never
    the text of a finding: `draft-audit.server.ts` looks every id up in its own
    audit of this same draft and refuses one it did not produce.

    The map holds only the rows the editor has touched, so a tick follows the
    row it was made on and not a position that shifts as the text is edited.
  */
  const [styleTickOverrides, setStyleTickOverrides] = useState<Record<string, boolean>>({});
  const styleRows = useMemo(() => findingsWithIds(styleCheck), [styleCheck]);
  const styleTickedIds = useMemo(
    () =>
      styleRows
        .filter((row) => styleTickOverrides[row.id] ?? row.finding.severity === "fix")
        .map((row) => row.id),
    [styleRows, styleTickOverrides],
  );
  const toggleStyleTick = (rowId: string, ticked: boolean) =>
    setStyleTickOverrides((current) => ({ ...current, [rowId]: ticked }));
  const sourceAttachmentNote = useMemo(() => {
    try {
      const note = JSON.parse(data?.draft?.research_json ?? "{}").sourceAttachmentNote;
      return typeof note === "string" ? note : "";
    } catch {
      return "";
    }
  }, [data?.draft?.research_json]);
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
  /*
    When the desk last ran the evidence check on this draft. It is written into
    the draft's own research record by the reconcile job that does the checking
    (`evidenceReconciledAt`), so the drawn "Ran 8:14 a.m." reads off the record
    rather than off the moment this browser happened to open the page.
  */
  const evidenceCheckedAt = useMemo(() => {
    try {
      const research = JSON.parse(data?.draft?.research_json ?? "{}") as Record<string, unknown>;
      const ran = research?.evidenceReconciledAt;
      return typeof ran === "string" ? ran : null;
    } catch {
      return null;
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
        result: await publishLead({ data: { leadId: id, topic: topic.trim(), area } }),
        notesProblem,
      };
    },
    onSuccess: ({ result, notesProblem }) => {
      /*
        ── EVERY ANSWER IS DRAWN AT THE BAR (UNIT PUB1) ──────────────────────

        The owner pressed Publish, the server refused, and the refusal went to
        a Notice in the page body while the bar showed the same button it had
        shown before. The press looked dead. So a refusal is written to the bar
        now, not to `msg`, and the lead query is invalidated: the refusal was
        the server disagreeing with the page's stored state (an acceptance
        recorded for a draft version that has since moved), and a page that
        keeps saying "Nothing blocks Publish" after being told otherwise is the
        same bug in a different coat.

        ── THE ANSWER IS RECORDED FIRST, THE REFRESHES ARE NOT WAITED ON ────
        (PUB2, review-bot finding on PR 163.)

        TanStack keeps a mutation `isPending` until an async `onSuccess`
        settles, and this one used to await four invalidations -- each of which
        refetches -- BEFORE it set `publishedSlug`, `justPublished` and `msg`.
        A slow or stalled `lead` refetch therefore left the bar saying
        "Publishing…" while the article was already committed, and the two
        refusal paths had the same ordering. So the state is written first and
        the invalidations are fired without being awaited (with their rejection
        handled, so nothing lands as an unhandled rejection); the bar stops
        saying a press is in flight the moment the server has answered.
      */
      const refresh = (queryKey: readonly unknown[]) => {
        void qc.invalidateQueries({ queryKey }).catch(() => {});
      };
      const refuse = (text: string) => {
        setMsg("");
        setPublishRefusal(text);
        refresh(["lead", id]);
      };
      if (!answered(result)) {
        refuse(NO_ANSWER);
        return;
      }
      if (!result.ok) {
        refuse(result.error);
        return;
      }
      setPublishRefusal("");
      setPublishedSlug(result.slug);
      setJustPublished(true);
      setMsg(notesProblem ? `On the paper. ${notesProblem}` : "On the paper.");
      refresh(["leads"]);
      refresh(["paper"]);
      refresh(["published-desk"]);
      refresh(["lead", id]);
    },
    onError: (err) => {
      setMsg("");
      setPublishRefusal(
        editorActionError(err instanceof Error ? err.message : "", "publish that story") ??
          "Could not publish.",
      );
      void qc.invalidateQueries({ queryKey: ["lead", id] }).catch(() => {});
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

  /*
    Unit BH2 decision 6. The two decisions of the comparison, named once. The
    inline evidence-check panel and the Compare versions dialog are handed the
    same two functions, so "Keep checked version" cannot mean one thing in the
    panel and another in the dialog.
  */
  const keepCheckedVersion = useCallback(() => {
    setEvidenceReviewOpen(false);
    setReconcileNote("The checked version remains the current saved draft.");
    setReconcileNoteError(false);
    setReconcileNoteWarning(false);
  }, []);

  const restoreOriginalVersion = useCallback(() => {
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
  }, [evidenceReview]);

  /*
    A refusal describes a press against ONE version of the story (unit PUB1).
    The moment the editor changes the words -- or the section -- it is about a
    draft that no longer exists, so it goes. The next press clears it too, in
    the button's own handler. Above the early returns, with the other hooks:
    a hook that runs on some renders and not others is not a hook.
  */
  useEffect(() => {
    setPublishRefusal("");
    setAcceptedUnreviewed(false);
  }, [headline, dek, body, topic]);

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
  const comparisonExplanation = comparePair
    ? explainPairMatch(
        data.lead.headline,
        sources,
        comparePair.prior.headline,
        parseUrlList(comparePair.prior.source_urls ?? "[]"),
        {
          city: paperIdentity.city,
          state: paperIdentity.state,
          county: paperIdentity.county,
        },
        {
          candidateTopic: data.lead.topic,
          leadTopic: comparePair.prior.topic,
        },
      )
    : null;
  const comparisonReason = comparePair
    ? data.lead.dup_ai_same === true && data.lead.dup_ai_why?.trim()
      ? data.lead.dup_ai_why.trim()
      : comparisonExplanation?.reason ??
        "The saved link does not match the current story evidence."
    : "";
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
    /*
      Unit U24: the paper's own city, so a story that attributes to "the city
      manager" is not told it never named City of Longmont. It turns the prose
      words on for that one source and no other -- see `creditsHomeCity`.
    */
    paperIdentity.city,
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
    manualDraft || (savedDraftFields && !draftFieldsMatch(savedDraftFields, { headline, dek, body, topic })),
  );
  /*
    The line at the head of the Story editor: the drawn green "Saved 8:20 a.m.".

    It keeps the class the walks already wait on (`confirm-section-step.mjs`
    and `paste-one-story-e2e.mjs` wait for the desk's word that the server took
    an edit), and it now carries the hour of the save the desk actually made --
    the saved draft's own `updated_at` -- rather than the bare word.
  */
  const saveLine = saveState({
    published: onPaper,
    dirty: hasUnsavedDraftEdits,
    when: lastDraftWhen(data?.draft?.updated_at),
  });
  const reconcileActive =
    reconcile.isPending ||
    reconcileStatus.data?.status === "queued" ||
    reconcileStatus.data?.status === "running";
  const savePending = saveTopic.isPending || save.isPending || reviewEvidence.isPending || publish.isPending;
  /*
    Unit U25, B1: the two reasons the evidence panel closes, kept apart so the
    takedown press can stay live on a published story. See
    `src/lib/news/finding-evidence-locks.ts` for why they differ.
  */
  const reviewLocks = {
    locked,
    onPaper,
    waiting,
    busy: save.isPending || reviewEvidence.isPending || reconcileActive,
  };
  const panelLocks = evidenceReviewDisabled(reviewLocks);
  const takeDownLocks = takeDownPressDisabled(reviewLocks);
  /*
    Why the "Fix these with the model" button is off, in the editor's own words,
    or "" when it is on. The first reason is the ordinary one on a fresh check --
    the button used to be grey here with nothing said -- and the rest are the
    desk's existing gates, said plainly rather than left to a grey button.
  */
  const styleFixReason = !styleTickedIds.length
    ? "Tick a finding to send it to the model."
    : locked
      ? "This lead is killed, so the style check will not spend a model call on it."
      : onPaper
        ? "This story is published, so the style check will not spend a model call on it."
        : waiting
          ? "The desk is still writing this draft. Wait for it to finish, then press again."
          : reconcileActive
            ? "A reconcile is running. Wait for it to finish, then press again."
            : fixStyle.isPending
              ? "The model is working on the ticked findings."
              : savePending
                ? "Your save is still going. Press again when it has landed."
                : "";
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
    ── ONE STATE ABOUT THE EVIDENCE CHECK (UNIT U24) ─────────────────────────

    The chip, the line beside the Publish button and the blocker all read
    `evidenceState`; the Checks pane is the only thing that can produce it,
    because it is the only thing holding the resolved review, so it reports it
    up (`onEvidenceState`) and this page reads it. Before, the bar asked the
    draft's memo and the pane asked the findings, and on the stand-in editorial
    day they said opposite things about the same run: `○ Evidence check not run`
    above seven `! Needs review` rows.

    Until the pane reports -- the review query is still in flight, or there is
    no draft to review -- the page falls back to the record it does hold
    (`recordedChecks`), which is exactly what it printed before this unit. That
    fallback can only ever under-report, and only for the first paint.
  */
  const evidenceLoaded = Boolean(panelEvidence?.evidenceToken && panelEvidence.revision === data.evidenceToken);
  const evidenceState: EvidenceCheckState = (evidenceLoaded ? panelEvidence : null) ?? {
    ran: Boolean(data.draft && recordedChecks(data.draft.research_json).evidenceChecked),
    toReview: 0,
    contradicted: 0,
  };
  /*
    Unit U24b: an acceptance covers this draft when it is for THIS version AND
    it was given for at least as many claims as are outstanding now. The count
    matters because the fingerprint alone does not: a judgment the desk
    downgrades to unreviewed -- because the capture behind it changed or the
    binding moved -- does not touch the draft row, so the token stands still
    while the number of claims to answer for grows. "I accepted three" must not
    print four.
  */
  const acceptanceCovers =
    data.unreviewedClaimsAcceptedCount > 0 &&
    data.unreviewedClaimsAcceptedCount >= evidenceState.toReview;
  const filedStoryId = reportingPackage.data?.storyLeads?.find((link) => link.leadId === id)?.storyId;
  const heldForDraft = reportingPackage.data?.draftId === data.draft?.id
    ? (reportingPackage.data?.pkg?.held ?? []).filter((item) => item.storyId === filedStoryId && item.unverified)
    : [];
  const hasAiJudgments = Boolean(data.draft?.research_json?.includes('"aiEvidenceReview"'));
  const legacyReadiness = savedStoryReadiness(data.draft?.research_json, reconcileActive || waiting) ??
    { state: "not-ready" as const, openCount: 0, totalCount: 0, reason: "No draft yet." };
  /*
    Every reason the Publish button is off, in one place (unit CT).

    `publishBlockers` owns the list -- a sentence and a press for each reason --
    and the button's `disabled` below is `blockers.length > 0`, so what the
    editor reads and the state of the button cannot disagree. Before this, one
    reason out of six had a sentence, small text at the far right of the bottom
    bar, and `evidenceStale`, a running reconcile and a saving evidence
    decision turned the button grey with nothing said at all.

    Naming another newsroom's reporting and not showing the reader where it
    came from blocks printing, the same way an unconfirmed claim of absence
    does -- `namedOutlets` is the server's own answer to that question, so the
    desk cannot disagree with the refusal.
  */
  /*
    One value for what the bar says about the press (unit PUB1): pending, the
    server's refusal, or the story that just printed. Derived, so the bar cannot
    hold two answers at once -- see `publishPressState`.
  */
  const press = publishPressState({
    publishing: publish.isPending,
    refusal: publishRefusal,
    publishedSlug: justPublished ? publishedSlug : null,
  });
  /*
    Unit ZC: the zero-claims gate, decided over the CURRENT fields.

    The loader hands the gate's server facts -- how many claims the run recorded,
    whether a completed check covers the SAVED version, whether the saved version
    is acknowledged, and whether this story is exempt. The page recomputes the
    decision on the text in the boxes, not the saved row, so an editor who types a
    dollar figure and has not pressed Save still meets the chip and the block. The
    completion and the acknowledgement are for the SAVED version, so they only
    count while there are no unsaved edits -- type one character and the gate the
    editor is answering is no longer the one on file.
  */
  const uncheckedStory = uncheckedStoryNeedsCheck({
    recordedClaims: data.uncheckedRecordedClaims,
    evidenceCheckedCurrentVersion: data.uncheckedEvidenceChecked && !hasUnsavedDraftEdits,
    body,
    acknowledgedForVersion: data.uncheckedStoryAcknowledged && !hasUnsavedDraftEdits,
    exempt: data.uncheckedExempt,
  }).blocked;
  const publishChecks = publishBlockers({
    headline,
    dek,
    body,
    evidenceLoading: Boolean(hasAiJudgments && data.draft && !evidenceLoaded),
    readiness: hasAiJudgments ? reconcileActive || waiting ? "checking" : heldForDraft.length ? "not-ready" : undefined : legacyReadiness.state,
    readinessReason: hasAiJudgments ? reconcileActive || waiting ? "The AI is checking this draft." : heldForDraft.length ?
      `${heldForDraft[0]!.headline.replace(/\s+/g, " ").slice(0, 70)}${heldForDraft.length > 1 ? ` and ${heldForDraft.length - 1} more` : ""}.` : undefined : legacyReadiness.reason,
    sectionReady,
    openClaims: openClaims.length,
    namedOutlets: data.namedOutlets,
    /*
      Unit U24: the claims the draft's own evidence check raised and nobody has
      judged, and whether this exact version has already been accepted. Both
      come from the one state the Checks pane reports up (`evidenceState`
      below), so the count in "Before you can publish", the count on the chip,
      the line under "Evidence check" and the rows themselves are one number.
    */
    unreviewedClaims: evidenceState.toReview,
    // M5: which part of that number the record disagrees with, so the blocker
    // and its override can say so.
    contradictedClaims: evidenceState.contradicted,
    unreviewedAccepted: false,
    uncheckedStory,
    evidenceStale,
    reviewingEvidence: reviewEvidence.isPending,
    reconcileActive,
    publishing: publish.isPending,
  });
  // Acceptance clears the Publish gate; it does not resolve the evidence claims.
  const blockers = publishChecks.filter((blocker) =>
    blocker.key !== "claims-unreviewed" || hasAiJudgments || !acceptanceCovers,
  );
  /*
    Unit UI1a: the three blocker presses that are a SERVER round trip, as the
    facts the shared `ActionButton` needs -- which row is running, which last
    failed, and the server's own reason for it. The other rows in the list are
    a focus or a scroll and never leave idle, which is why this names three
    targets and not all of them.

    Unit UI1a3, finding 1: the derivation itself lives in
    `blockerPressState` (`lib/news/publish-blockers.ts`), because the ordinary
    failure of two of these three is a RESOLVED `{ ok: false, error }` -- a
    stale evidence token, a draft that no longer names the outlet -- which
    settles as a success and left `isError` false. Reading the refusal off the
    settled answer is the whole of the fix, and it is a pure function of what
    the mutations report, so it is testable without mounting this route.
  */
  /*
    Unit ZC: the zero-claims gate wins the readiness, over the generic
    not-ready/verified a legacy memo would give, and over the generic
    claims-unreviewed row for a flagged draft. `not-checked` is its own state, so
    the chip says what is actually wrong -- a checkable story nobody has checked.
  */
  const uncheckedReadiness = uncheckedStory
    ? { state: "not-checked" as const, openCount: 0, totalCount: 0, reason: UNCHECKED_STORY_REASON }
    : null;
  const legacyEvidenceBlocker = publishChecks.find((blocker) => blocker.key === "claims-unreviewed");
  const draftReadiness = data.draft
    ? uncheckedReadiness ??
      (hasAiJudgments
        ? editorStoryState(blockers, evidenceState.toReview)
        : legacyEvidenceBlocker
          ? { state: "not-ready" as const, openCount: evidenceState.toReview, totalCount: evidenceState.toReview, reason: legacyEvidenceBlocker.sentence }
          : legacyReadiness)
    : uncheckedReadiness ?? { state: "not-ready" as const, openCount: 0, totalCount: 0, reason: "No draft yet." };
  const readiness = readinessDot(
    writerIsReady({
      choice: modelChoice,
      availability: writerAvailability.data,
      customConnection:
        writerConnections.data?.find((row) => `custom:${row.id}` === modelChoice) ?? null,
    }),
    draftReadiness,
  );
  const heldPublishNote = heldForDraft.length && blockers[0]?.key === "readiness"
    ? `${heldForDraft[0]!.headline.replace(/\s+/g, " ").slice(0, 100)}${heldForDraft.length > 1 ? ` and ${heldForDraft.length - 1} more` : ""}.`
    : "";
  const blockerPress = blockerPressState({
    accept: {
      isPending: acceptUnreviewed.isPending,
      isError: acceptUnreviewed.isError,
      error: acceptUnreviewed.error,
      answer: acceptUnreviewed.data,
    },
    acknowledge: {
      isPending: acknowledgeUnchecked.isPending,
      isError: acknowledgeUnchecked.isError,
      error: acknowledgeUnchecked.error,
      answer: acknowledgeUnchecked.data,
    },
    override: {
      isPending: overrideOutlet.isPending,
      isError: overrideOutlet.isError,
      error: overrideOutlet.error,
      answer: overrideOutlet.data,
    },
    keepEvidence: {
      isPending: reviewEvidence.isPending,
      isError: reviewEvidence.isError,
      error: reviewEvidence.error,
      answer: reviewEvidence.data,
    },
  });
  /*
    One press per row of the "Before you can publish" list. Every target is
    the control that already existed -- the same mutation the mid-form button
    calls, the same details the Reporting tab opens, the same select the
    section-change link focuses -- so a row is a way to the work, never a
    second implementation of it.

    Unit CW2: the review is the Checks tab's own body now, so a row that sends
    the editor to it opens that tab and scrolls the panel into view instead of
    opening a shut details element in the Reporting tab. The scroll waits one
    frame, because the panel is rendered by the tab that is only just being
    switched to and is not in the document yet at the moment of the press.
  */
  const openEvidenceReview = () => {
    setInspector("checks");
    requestAnimationFrame(() =>
      document.getElementById("finding-evidence-review")?.scrollIntoView?.({ block: "start" }),
    );
  };
  /*
    ── The drawn Checks-tab list (unit CW, moved by CW2) ───────────────────────
    The screen this replaces said "Review names, claims and supporting records"
    and gave two paragraphs and two links; it never said which claim had been
    checked, what the desk found, or where the record was. The list on the
    Checks tab is every row of that answer, built from the review the panel on
    that tab saves judgments against -- one request, one cache entry, no second
    read of the same facts.

    `readNameCheck` on the draft's own record is the same name check
    `DeskNameCheck` renders above it; the style row's count is the same
    measurement the Style check section acts on. Where the drawing writes
    something with nothing behind it (the per-run capture count, "Confirm
    spelling"), the row is drawn without it and the divergence is a CW line in
    `design/SPEC-GAPS-0681.md`.
  */
  /*
    The style row's press is the style section's own repair button, focused and
    scrolled to -- a row is a way to the work, never a second implementation of
    it. The button stays grey with its own stated reason until a finding is
    ticked, which is why this focuses rather than presses.

    Unit CW2: the section is the style row's own disclosure body now
    (`#evidence-detail-style`), so the press opens that disclosure first --
    a browser will not scroll to or focus anything inside a shut <details>, and
    a press that opened nothing would read as a dead press. Both the row and the
    section are in the Checks tab, so the tab is already the one on screen.
  */
  const focusStyleFix = () => {
    const more = document.getElementById(
      evidenceDetailId(STYLE_ROW_KEY),
    ) as HTMLDetailsElement | null;
    if (more) more.open = true;
    const el = document.querySelector<HTMLElement>("#style-fix-act .btn");
    el?.scrollIntoView?.({ block: "center" });
    el?.focus();
  };
  /*
    "Compare checked vs. previous version" (the drawing's footer press) is the
    Compare-versions dialog that only has anything to show once an evidence
    check left two versions behind. Before that the press falls back to the
    Reporting panel, which is where the two decisions and the integrity notes
    live.
  */
  const openCompareChecked = () => {
    if (evidenceReview) setCompareVersionsOpen(true);
    else openEvidenceReview();
  };
  /*
    Unit CW2. Topic, Geography and Pulled notes are not drawn, so they live in
    one shut disclosure under the action row (`.astra-story-details`,
    `#story-details`). Anything that presses a control in there has to open it
    first: a browser will not scroll to, focus, or submit a field inside a
    closed <details>, so a press that skipped this step would read as a dead
    press. Both the sticky bar's "pick the section" and the Checks tab's
    section/outlet blockers go through here.
  */
  const openStoryDetails = () => {
    const el = document.getElementById("story-details") as HTMLDetailsElement | null;
    if (el) el.open = true;
    return el;
  };
  const actOnBlocker = (target: PublishBlockerTarget) => {
    const focus = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      el?.scrollIntoView?.({ block: "center" });
      el?.focus();
    };
    switch (target.kind) {
      case "headline":
        focus("#story-headline");
        return;
      case "dek":
        focus(".astra-dek");
        return;
      case "body":
        focus(".astra-story-body");
        return;
      case "section":
        openStoryDetails();
        focus("#story-topic-select");
        return;
      case "outlets":
        openStoryDetails();
        document.getElementById("story-outlets")?.scrollIntoView?.({ block: "center" });
        return;
      case "override-outlet":
        /* The same mutation the mid-form "Override <outlet>" button calls. */
        overrideOutlet.mutate(target.outlet);
        return;
      case "add-source":
        setInspector("sources");
        document.getElementById("story-inspector")?.scrollIntoView?.({ block: "start" });
        return;
      case "claims":
      case "running-check":
      case "evidence-review":
        openEvidenceReview();
        return;
      case "keep-evidence":
        /* The same mutation the evidence review's own "keep" press calls. */
        reviewEvidence.mutate("keep");
        return;
      case "accept-unreviewed":
        /*
          Unit U24: the second honest answer to "claims nobody has judged".
          `performPublish` refuses without this record, so the press is the gate
          -- and the record names who accepted, when, and which draft version.
        */
        acceptUnreviewed.mutate();
        return;
      case "acknowledge-unchecked":
        /* Unit ZC: "I checked this story myself" for the zero-claims gate. */
        acknowledgeUnchecked.mutate();
        return;
      case "publish-bar":
        document.getElementById("astra-publish-bar")?.scrollIntoView?.({ block: "center" });
        return;
    }
  };

  /*
    The two rows the drawing puts around the work (Desk Story.dc.html): the
    stage stepper in the top bar, and the gate chips on the publish bar.

    Neither is a control and neither decides anything. The stage row reads the
    record -- the lead exists, a draft exists, the checks ran and passed, the
    story is on the paper -- and the gate chips say the same things the page
    already knows about the draft in front of the editor. Every chip is a
    `<li>`; the one thing the publish bar must not grow is a second set of
    blockers, so what actually refuses a publish is still the `disabled` list
    on the button below, unchanged.

    Unit U9: "the checks ran and passed" is not the same question as "nothing
    is outstanding". The old `checkClear` answered the second one, which is
    true of a blank hand-filed draft that no check has ever touched, so the
    stepper ticked Check and the bar printed "All checks done." for a story
    with no recorded evidence review, no name check and no claims. Both rows
    now read `recordedChecks` off the draft's own memo -- the evidence review's
    decision and the name check's completion -- plus the page's outstanding
    flags, through the one rule in `lib/news/check-gates.ts`.
  */
  const draftChecks = recordedChecks(data.draft?.research_json);
  const nameCheck = readNameCheck(data.draft?.research_json);
  const publishGates = [pageGateChip(`${hasUnsavedDraftEdits ? "!" : "✓"} Saved`, !hasUnsavedDraftEdits)];

  /*
    The evidence check's props, in one place because the drawn action row needs
    two halves of it apart (unit CW).

    `Desk Story.dc.html:112` draws "Check draft against evidence" second in the
    row, between "Save edits" and "+ Add to story" -- and everything this
    control has to say afterwards (progress, the dirty note, the finished
    notice, the review panel) is a block. The row asks for `render="button"`;
    the block lands under the row, where the drawing puts the job cards. Two
    instances, one set of props, so the two halves can never be told different
    things about the same check.
  */
  const reconcileControlProps = {
    status: reconcileStatus.data,
    active: reconcileActive,
    disabled: waiting || reconcileActive || savePending || hasUnsavedDraftEdits,
    dirty: hasUnsavedDraftEdits,
    note: reconcileNote,
    noteError: reconcileNoteError,
    noteWarning: reconcileNoteWarning,
    checkedDraftReady,
    checkedDraftStale,
    modelLabel: modelChoiceLabel(reconcileStatus.data?.modelChoice ?? modelChoice),
    review: evidenceReview,
    reviewOpen: evidenceReviewOpen,
    onStart: () => reconcile.mutate(),
    onReload: () => {
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
    },
    onKeepChecked: keepCheckedVersion,
    onRestoreOriginal: restoreOriginalVersion,
  };

  /*
    STYLE CHECK (unit CW2).

    The section the style row opens into. It is built here, in the route, and
    handed to the checks panel as markup, because everything it needs -- the
    tick state, the audit's findings and the repair mutation -- is this page's;
    the panel draws the row that is the way to it. Nothing else draws this
    section: `Desk Story.dc.html`'s page ends at the action row, and its style
    repair press lives on the style row of the Evidence check list.
  */
  const styleDetail = data.draft ? (
    <section className="note-sec" aria-label="Style check">
      <p className="side-label">Style check</p>
      {styleFixes.length ? (
        <>
          <p className="note-one">
            {styleFixes.length} thing{styleFixes.length === 1 ? "" : "s"} to fix. Tick the
            ones you want the model to take on:
          </p>
          <ul className="meeting-citations">
            {styleRows
              .filter((row) => row.finding.severity === "fix")
              .map((row) => (
                <StyleFindingRow
                  key={row.id}
                  finding={row.finding}
                  ticked={styleTickOverrides[row.id] ?? true}
                  onTick={(ticked) => toggleStyleTick(row.id, ticked)}
                />
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
            {styleRows
              .filter((row) => row.finding.severity === "review")
              .map((row) => (
                <StyleFindingRow
                  key={row.id}
                  finding={row.finding}
                  ticked={styleTickOverrides[row.id] ?? false}
                  onTick={(ticked) => toggleStyleTick(row.id, ticked)}
                />
              ))}
          </ul>
        </details>
      ) : null}
      <p className="note-one">
        You do not have to act on any of this. Nothing here publishes anything.
      </p>
      <div className="style-fix-act" id="style-fix-act">
        <InkButton
          disabled={
            !styleTickedIds.length ||
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
        {/* Why it is off, in words. Empty when it is on, so nothing sits
            beside a live button saying nothing. */}
        {styleFixReason ? (
          <p className="note-one style-fix-why">{styleFixReason}</p>
        ) : null}
      </div>
      <p className="note-one">
        One pass with the model the picker is set to. It is given the ticked findings above
        and the draft, and returns the draft with those problems fixed. It may not change a
        quotation, a number, a name or a link — a rewrite that does is refused and your text
        is kept. The result is saved as a draft revision, never published.
      </p>
      {styleNote ? <p className="note-one">{styleNote}</p> : null}
    </section>
  ) : null;

  return (
    <DeskShell title={editorTitle(data.lead.headline)} kicker="Workbench" hideTitle>
      {/*
        The phase 3 progress card used to sit here, above the title. Phase 2b
        moves it down into the writing surface, under the action row, which is
        where the drawing puts it -- see the "under the actions" block below the
        form. The condition and the reassurance line traveled with it.
      */}

      <h1 className="astra-wb-title">Story workspace</h1>
      {/*
        The workbench's top bar (redesign phase 2b, "Desk Story.dc.html"): the
        way back, and where this lead stands. The stage cells are spans, not
        buttons -- the stage is derived from the record, and Do 3 of this unit's
        brief keeps today's control wherever the drawing's button has no
        behavior behind it, so a row of presses that go nowhere is the one thing
        this row must not be.
      */}
      <div className="astra-wb-top">
        <Link to="/desk" className="astra-wb-back">
          ← Today
        </Link>
      </div>
      {/*
        v3.1 fix: the context line is its own row, under the bar, rather than a
        third item wrapped into it. It reads as a caption on the whole page
        instead of competing with the stepper for the same line, and it is what
        the reference calls for.

        The status chip rides at the end of it. The drawing's top bar holds
        exactly two things -- the way back and the stepper -- and the chip was
        the third; the caption row is where it belongs, because the stepper
        only tells progress, and the status word is the one thing on this page
        that says a lead was killed or spiked.
      */}
      <div className="astra-wb-context">
        <span>
          Story from lead · {sectionNameNow}
        </span>
        <StoryReadinessChip readiness={draftReadiness} />
        {/*
          Unit BH2 decision 5: the Kill press, on the row that already carries
          this lead's status, because a kill is a change to exactly that. It is
          not drawn for a lead that is already killed (nothing to do) or one on
          the paper (legal removal is the route there, and unpublish is on the
          published page). `quiet-danger` is InkButton's own tone for this: a
          real action heading toward removal that is not a confirm step.
        */}
        {!locked && !onPaper ? (
          /*
            Unit UI1a2: the shared piece, at the Kill level. This control's DONE
            state is the page's own record of the kill -- a killed lead stops
            being drawn here (`locked` turns the whole line off) and
            `KilledLeadRecord` takes its place with the reason, the time and the
            way back. That is the existing flow, and rule 3's "one confirmation"
            (PUB2) means no second green "Killed" is drawn on a button that is
            about to disappear. The press itself is the dialog's, which already
            reports "The kill did not reach the desk. The lead is unchanged."
            beside its own confirm.
          */
          <ActionButton
            tone="quiet-danger"
            small
            phase="idle"
            onAct={() => setKillOpen(true)}
          >
            Kill this lead
          </ActionButton>
        ) : null}
      </div>
      {/*
        A story that was ALREADY on the paper when the page opened says so here.
        One printed from this page says so in the bar's own place instead
        (`PublishBarResult`, unit PUB1), so the same sentence and the same link
        are never on the screen twice.
      */}
      {onPaper && !justPublished ? (
          <p className="note">
            On the paper.{" "}
            <Link to="/desk/published" className="inline-link">
              See it under Published
            </Link>
          </p>
        ) : null}
      {comparePair && compareShown ? (
        <div id="lead-compare">
          <LeadComparePanel
            current={leadForRecord}
            prior={comparePair.prior}
            onNotADuplicate={moveToNew}
            onKillThis={killAsDuplicateOfPrior}
            onReopenPrior={reopenPrior}
            matchReason={comparisonReason}
            formatDate={formatShortDate}
          />
        </div>
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
            {/*
              Every reason Publish is off, first thing on the tab the page
              opens on (unit CT). The heading below was "Before you publish",
              which would now be two near-identical headings for two different
              things; the drawing calls this list "Evidence check".

              UNIT U24 -- NOT ON A KILLED LEAD. This list is work toward a
              publish, and a killed lead cannot be printed: the page already
              drops the editors, "Draft with AI" and the whole publish bar for
              it, because `performPublish` refuses a killed lead outright. What
              was left was the list itself, advertising "4 things block
              Publish" with four enabled buttons -- "Write the headline",
              "Write the story", "Write a dek", "Pick a section" -- three of
              which point at fields this page no longer draws. The action on a
              killed lead is Reopen, and that panel is already on the page; a
              second list of controls that cannot be reached is the desk
              contradicting itself.
            */}
            {showsPublishPrep(data.lead.status, Boolean(data.draft)) && blockers.length > 0 ? (
              <BeforeYouCanPublish
                blockers={blockers}
                onAct={actOnBlocker}
                busyTarget={blockerPress.busyTarget}
                failedTarget={blockerPress.failedTarget}
                failureReason={blockerPress.failureReason}
                doneTarget={
                  acceptedUnreviewed && blockers.some((b) => b.altAction?.target.kind === "accept-unreviewed")
                    ? "accept-unreviewed"
                    : null
                }
              />
            ) : null}
            {data.draft ? (
              /*
                The panel, not the list (unit CW2). The panel owns the review
                query and every judgment mutation, so it is the one thing that
                can render the list's rows with the record checks and the
                judgment controls the row opens into; the list it draws, the
                run line, and the extra rows are all still the same unit CW
                code, with the page's own facts passed in.
              */
              <FindingEvidenceReviewPanel
                leadId={id}
                reviewRevision={data.evidenceToken}
                currentDraft={{ headline, dek, body, topic }}
                meetingEvidence={data.draftMeetingEvidence}
                isOwner={isOwner}
                /*
                  Unit U25, B1. Two rules, named and tested in
                  `src/lib/news/finding-evidence-locks.ts`, because they used to
                  be one expression and the difference between them is the whole
                  of finding B1.

                  The panel closes on a published story: a judgment binds to a
                  saved draft and a published story has none. The takedown press
                  must NOT inherit that -- a published story's captures are the
                  only ones with public pages at /evidence/:versionId, so it is
                  the only place the press matters, and it rendered disabled on
                  all ten claims of story 16 with no tooltip and no way to reach
                  it. The server still refuses every editor who is not the owner.
                */
                disabled={panelLocks}
                takeDownDisabled={takeDownLocks}
                list={{
                  checkedAt: evidenceCheckedAt,
                  modelLabel: reconcileStatus.data?.modelChoice
                    ? modelChoiceLabel(reconcileStatus.data.modelChoice)
                    : "",
                  openClaims,
                  nameCheck,
                  styleFindings: styleCheck.findings,
                  styleDetail,
                  compareLabel: evidenceReview ? "Compare checked vs. previous version" : "",
                  onCompare: openCompareChecked,
                  onStylePress: focusStyleFix,
                  /*
                    The one fact the page holds and the panel cannot: whether the
                    memo records a decision or a reconciliation stamp. The panel
                    adds it to what it can see and reports the whole state back
                    (unit U24).
                  */
                  evidenceRecorded: draftChecks.evidenceChecked,
                  onEvidenceState,
                  readinessReason: hasAiJudgments ? draftReadiness.reason : undefined,
                  onDraftChanged: (draft) => { setHeadline(draft.headline); setDek(draft.dek); setBody(draft.body); setTopic(draft.topic); },
                }}
              />
            ) : (
              /*
                FB6 item 8a (A2c-REPORT.md §6 C4). With no draft there is
                exactly one thing to do, and it is not four prep rows: it is
                writing the draft. This pane used to be one grey sentence
                ("Checks appear after the first draft."), and above it sat the
                publish-prep list offering "Write the headline / Write the
                story / Write a dek / Pick a section" -- three of which point
                at fields this page does not draw until there is something to
                edit. One sentence, one press, and it is the SAME press as the
                toolbar's (the same `draft` mutation, the same dialog-less
                path a first draft takes).

                A killed lead has no such press -- `performPublish` refuses it
                and the page draws Reopen instead -- so it gets the sentence
                with no button, rather than a control that cannot work.
              */
              <section className="astra-evidence" aria-label="Evidence check">
                <h2 className="astra-evidence-title">Evidence check</h2>
                {locked || onPaper ? (
                  <p className="meta">Checks appear after the first draft.</p>
                ) : (
                  <>
                    <p className="meta">
                      Nothing to check yet — there is no draft. Draft with AI writes a first pass
                      from the lead and its sources; the checks run on it and their rows appear
                      here.
                    </p>
                    <InkButton
                      disabled={waiting || reconcileActive || paperGate.blocked}
                      onClick={() => {
                        if (waiting) return;
                        draft.mutate(undefined);
                      }}
                    >
                      {waiting ? "Drafting…" : "Draft with AI"}
                    </InkButton>
                    <PaperSetupGateNote gate={paperGate} />
                  </>
                )}
              </section>
            )}
            {/*
              The name check keeps its own panel under the list (unit CW): the
              list carries one name row with the count and the first reason, and
              this is the full answer -- every name, its source, the written
              records -- for the row that sends the editor here.

              The two prose blocks that used to sit here ("Claims & evidence",
              "Claims of absence") are gone: the drawing does not have them, and
              both were a paragraph and a link to the same panel the list now
              names row by row. "Claims of absence" is not lost with them --
              every still-unconfirmed absence is a row of the list, worded the
              same way the Reporting tab words it, and the same unticked gate
              item still blocks Publish and says so at the top of this tab.
            */}
            {data.draft ? (
              <DeskNameCheck
                research={data.draft.research_json}
                headline={headline}
                dek={dek}
                body={body}
              />
            ) : (
              /*
                The same shape its sibling above uses, and the same shape the
                panel itself has once a draft exists (desk-name-check.tsx), so
                the tab does not change its outline the moment the first draft
                lands. This one line was the last unstyled paragraph left on
                the tab.
              */
              <section className="story-name-check" aria-label="Names and spellings">
                <h2>Names and spellings</h2>
                <p className="meta">Name checks appear after the first draft.</p>
              </section>
            )}
          </section>
          <section
            id="inspector-sources"
            role="tabpanel"
            aria-labelledby="inspector-tab-sources"
            hidden={inspector !== "sources"}
          >
            <h2>Your source material</h2>
            {sourceAttachmentNote && <p className="meta">{sourceAttachmentNote}</p>}
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
            <p className="kick">{fromDark ? "Working notes from Dark Desk" : "The lead"}</p>
            <h2 className="side-h">{editorTitle(data.lead.headline)}</h2>
            <p className="side-why">{data.lead.why}</p>
            <p className="meta">
              {data.lead.topic} · filed {formatShortDate(data.lead.created_at)}
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
              onMeetingRedraft={locked || onPaper ? undefined : () => draft.mutate(undefined)}
              meetingRedrafting={draft.isPending || waiting}
              evidenceToken={data.evidenceToken}
              onReverifyMeetingCitations={locked || onPaper || !data.draft ? undefined : (review) => draftMeetingReview.mutate(review)}
              reverifyingMeetingCitations={draftMeetingReview.isPending}
              meetingAccounting={data.meetingAccounting}
              onRewriteFromLedger={
                locked || onPaper || paperGate.blocked
                  ? undefined
                  : () => draft.mutate({ fromLedger: true })
              }
              rewritePhase={
                waiting && pressWasRewrite.current
                  ? "working"
                  : rewriteDone
                    ? "done"
                    : draft.isError && draftProblem && pressWasRewrite.current
                      ? "failed"
                      : "idle"
              }
              rewriteReason={pressWasRewrite.current ? draftProblem : null}
            />
            {/*
              The structured reporting package, drawn beside the editable copy
              in the same tab the notes live in. It renders ONLY what the runner
              filed (reporting-package-panel.tsx): a run that has not finished
              shows the honest "no package yet" line, never a fake one. Its
              "Open this story" links are the real filed leads the runner
              recorded, and its follow-up/correction boxes start a NEW request
              -- they never overwrite this draft, these notes or the checked
              states.
            */}
            <ReportingPackagePanel leadId={data.lead.id} />
          </section>
        </aside>

        <section className="story-work">
          {/* Model availability appears only in the Redraft dialog. */}
          <div className="astra-wb-writer">
            <span className="astra-wb-writer-label">Writer</span>
            <button
              className="btn"
              type="button"
              aria-expanded={modelResearchOpen}
              aria-controls="story-model-research"
              onClick={() => setModelResearchOpen((open) => !open)}
            >
              Model & research · {modelChoiceLabel(modelChoice)}
            </button>
            <button
              className="btn quiet"
              type="button"
              aria-expanded={modelResearchOpen}
              aria-controls="story-model-research"
              onClick={() => setModelResearchOpen(true)}
            >
              Thinking effort
            </button>
            {lastDraft ? <span className="astra-wb-last">{lastDraft}</span> : null}
            {retiredModelNote ? (
              <p className="note" role="status">
                {retiredModelNote}
              </p>
            ) : null}
          </div>
          {modelResearchOpen && !locked ? (
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
                    document.getElementById("story-inspector")?.scrollIntoView?.({ block: "start" }),
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
          {saveTopic.isPending ? <Busy label="Saving your section…" /> : null}
          {/*
            A successful action that also has something to report -- the draft
            saved but the reporting notes did not -- still reads as a success:
            the story was saved, and a red box would say otherwise. Both of
            those sentences begin with the thing that worked, which is what the
            color below reads. The sentence stays the first thing inside the
            notice, where the editor reads it before the button under it.
          */}
          {/*
            Unit PUB1: the green "On the paper." used to be suppressed the
            instant the lead became published (`!onPaper`), so the one sentence
            that said the press worked was hidden -- and the bar it belonged to
            had just unmounted. A story published FROM THIS PAGE keeps its
            confirmation (`publishedSlug`); a story that arrived already on the
            paper still says nothing, which is what `!onPaper` was for.
          */}
          {draftProblem && (!onPaper || (justPublished && msg !== "On the paper.")) ? (
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
            onReadRest={() => draft.mutate(undefined)}
          />

          {data.draft || body || manualDraft ? (
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
              <Field
                label="Headline · yours"
                htmlFor="story-headline"
                aside="A redraft will not replace it"
              >
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
                    setHeadline(editorTitle(data.lead.headline));
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

                  Unit CP item 2: on a draft workbench this press opens the drawn
                  Headline dialog instead (`Desk Story.dc.html:97`, whose
                  `doHeads` action is "headlines"). The dialog's own "Suggest 3
                  more" is the same `suggestHeadlines` call this button used to
                  make, and the line its "Use this headline" saves comes back
                  through `onSaved` to land in this box -- which is why the inline
                  list below is now drawn on the published path only. A printed
                  story keeps this press as it was: the dialog writes the *draft's*
                  headline, and what a printed story shows is the article's own
                  field, saved by "Save headline" above.
                */}
                <button
                  type="button"
                  className="btn"
                  disabled={suggest.isPending || waiting}
                  onClick={() => {
                    if (onPaper) suggest.mutate();
                    else setHeadlineOpen(true);
                  }}
                >
                  {suggest.isPending ? "Asking the story model…" : "Suggest headlines"}
                </button>
              </div>
              {/*
                Unit CP item 2: the inline list stays for a published story,
                whose press still fills it. On a draft the dialog holds the
                suggestions, so this list cannot appear at the same time as the
                dialog that replaced it.
              */}
              {onPaper && headlineSuggestions.length > 0 ? (
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
              {/*
                The dek, under the drawing's own name for it: SUMMARY.

                The class and the id stay `.astra-dek`/`story-dek`, because
                both are already the page's names for this field (`paste-one-
                story-e2e.mjs` fills `.astra-dek.directly`, and the auto-resize
                above selects it by class). Only the words the editor reads
                change.
              */}
              <Field label="Summary" htmlFor="story-dek">
                <textarea
                  id="story-dek"
                  rows={2}
                  className="astra-dek"
                  value={dek}
                  onChange={(e) => setDek(e.target.value)}
                  disabled={onPaper}
                />
              </Field>
              {/*
                The body, under the drawing's own name for it: STORY -- with
                the save line at the head of the label row, which is where the
                drawing writes "Saved 8:20 a.m.".

                The line is passed as `aside` and not written inside the label:
                a browser builds a control's accessible name out of the whole
                text inside its <label>, so "Saved 8:20 a.m." inside it would
                make this box's name "Story Saved 8:20 a.m." and break every
                walk that asks for the box by name. See `Field`'s own note.

                It keeps the class the walks already wait on
                (`.astra-save-state`), so what those walks are watching for --
                the desk's word that the server took an edit -- is unchanged.
              */}
              <Field
                label="Story"
                htmlFor="story-body"
                aside={
                  <span
                    className={`astra-save-state astra-wb-saved astra-wb-saved-${saveLine.tone}`}
                    role="status"
                  >
                    {saveLine.label}
                  </span>
                }
              >
                <textarea
                  id="story-body"
                  ref={bodyField}
                  className="astra-story-body"
                  rows={16}
                  placeholder={manualDraft === "paste" ? "Paste your story here." : manualDraft === "write" ? "Write your story here." : undefined}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={onPaper}
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
      <div className="work-bar astra-story-actions">
        {/*
          THE DRAWN ACTION ROW (unit CW).

          `Desk Story.dc.html:112` draws, in this order: Save edits ⌘S |
          Check draft against evidence | + Add to story | Redraft… |
          Preview as reader. This row is those five presses in that order,
          each still wired to the server function it always called -- save,
          the reconcile job, the add-to-story dialog, the redraft dialog,
          the preview. The desk's own extras (the jump into the inspector,
          the two comparison presses) follow them, because the drawing has
          no equivalent and a working press is not dropped to match a
          picture.

          Tone is the drawing's: the three presses that change what is
          saved are the heavy 2px ink (`.btn`), the two that only look are
          the light 1px rule (`.btn.quiet`).
        */}
        {/*
          FB5: the ⌘S chip below had nothing behind it. README "Interactions &
          behavior" lists "⌘S saves in the story workbench", and the key fell
          through to the browser's Save-page dialog instead (FB0-REPORT.md
          Table B, "⌘S badge … DEAD"). It is bound rather than removed, because
          saving here is manual -- there is a press, an "Unsaved changes" line
          and no autosave.

          `SaveShortcut` rides the button's own condition, so the key can never
          save what the button would refuse, and it adds no announcement of its
          own: this save already answers visibly and out loud through `setMsg`.
        */}
        {(data.draft || manualDraft) && !locked && !onPaper ? (
          <>
            <SaveShortcut
              save={() => save.mutate()}
              enabled={!save.isPending && !reconcileActive}
            />
            <InkButton
              tone={hasUnsavedDraftEdits || manualDraft ? "solid" : "quiet"}
              disabled={save.isPending || reconcileActive}
              onClick={() => save.mutate()}
            >
            Save edits
            {/*
              The drawn ⌘S chip, aria-hidden so the press's accessible name
              stays exactly "Save edits" -- the walks ask for it by that
              name (`getByRole("button", { name: "Save edits", exact: true })`)
              and a name of "Save edits ⌘S" would stop matching.
            */}
            <SaveShortcutHint />
            </InkButton>
          </>
        ) : null}
        {data.draft && !locked && !onPaper ? (
          <div className="story-check-inline">
          <DraftReconcileControl {...reconcileControlProps} render="button" />
          </div>
        ) : null}
        {/*
          Unit CP item 1: the drawn "+ Add to story", which had no press on
          this page at all. `Desk Story.dc.html:114` draws it in the draft
          editor's own row, between "Check draft against evidence" and
          "Redraft…", and `:172` wires it to the `add-to` action; this row is
          the desk's version of that one, so it sits in the same place here.

          Drawn only where it can act. The gate is the one the presses either
          side of it use -- `!locked && !onPaper`, the page's "not killed and
          not published" rule (`locked` at the top of this component is
          `status === "killed"`, `onPaper` is `status === "published"` or a
          published slug) -- plus `data.draft`, because the weave the dialog
          runs has nothing to add to without one: `performWeaveIntoStory`
          answers "This lead has no draft to add to yet." The drawing agrees
          with that last condition: its row is drawn inside a draft that
          already has a body.
        */}
        {!locked && !onPaper && meetingTranscriptChoices.length ? (
          <MeetingTranscriptChooser
            choices={meetingTranscriptChoices}
            selectedArtifactId={selectedMeetingArtifactId}
            onSelect={setSelectedMeetingTranscriptArtifactId}
            disabled={waiting || data.job?.status === "queued" || data.job?.status === "running"}
          />
        ) : null}
        {!locked && !onPaper ? (
          <>
            <div className={data.draft?.body ? "story-redraft-inline" : ""}>
            <ActionButton
              /*
                The drawing's tone rule, applied to this press too: the three
                presses that change what is saved are the heavy 2px ink
                (`.btn`), the two that only look are the light 1px rule
                (`.btn.quiet`). "Redraft" only exists beside a draft that has
                a body, and beside a body it is one of the light ones -- the
                drawn fifth press. "Draft with AI" has no draft to sit beside
                and is the only way forward, so it stays the heavy one.
              */
              tone={data.draft?.body ? "quiet" : "primary"}
              /*
                Unit UI1a2: the four states, at the control.

                WORKING is `waiting` -- the press latches it synchronously in
                `onMutate`, so the button is disabled with a spinner in the same
                paint as the click. DONE is "Redraft started" / "Draft started",
                and it is deliberately SHORT-LIVED: `redraftDone` is cleared by
                the effect that seeds the box when the new draft lands (line
                ~563), because the button must go back to reading "Redraft" for
                the next press. A done state that latched forever would rename
                the control out from under every walk that asks for it by name
                (`claim-sources-pull-walk` presses "Redraft" after having
                pressed "Draft with AI" earlier in the same run). FAILED prints
                the desk's own sentence beside the button -- the same sentence
                the area above already carries (`msg` / `previousJobError`) --
                and the button returns to idle and pressable.
              */
              phase={
                waiting
                  ? "working"
                  : draft.isError && draftProblem
                    ? "failed"
                    : redraftDone
                      ? "done"
                      : "idle"
              }
              workingLabel={
                jobState === "recovering"
                  ? "Recovering…"
                  : data.job?.failover_note
                    ? `Switched to ${data.job.failover_note.match(/moved to (.+?) because/i)?.[1] ?? "another model"}…`
                    : data.draft?.body
                      ? "Redrafting…"
                      : "Drafting…"
              }
              doneLabel={data.draft?.body ? "Redraft started" : "Draft started"}
              reason={draft.isError && draftProblem ? draftProblem : null}
              /* SG1 / Option A: drafting spends a model on this paper's
                 behalf, so on an install nobody has set up the press is
                 disabled and the reason is drawn under it. */
              disabled={waiting || reconcileActive || paperGate.blocked}
              onAct={() => {
                if (waiting) return;
                /*
                  Unit BH2 decision 6: when there is already a draft, the
                  drawing puts a dialog in front of the redraft -- "What
                  should change?", the keep rule, the model row -- and that
                  dialog's Start does these same two calls. With no draft
                  there is nothing to redraft and nothing to compare, so
                  "Draft with AI" still starts on the press, as it always
                  has.
                */
                if (data.draft?.body) setRedraftOpen(true);
                else draft.mutate(undefined);
              }}
            >
              {data.draft?.body ? (
                /*
                  The drawn ellipsis, aria-hidden so the press's accessible
                  name stays exactly "Redraft" -- the walks ask for it by that
                  name. The shared piece's icon is `aria-hidden` for the same
                  reason: the WORD is the name.
                */
                <>
                  Redraft
                  <span aria-hidden="true">…</span>
                </>
              ) : (
                "Draft with AI"
              )}
            </ActionButton>
            </div>
            <PaperSetupGateNote gate={paperGate} />
          </>
        ) : null}
        {!data.draft && !locked && !onPaper ? (
          <>
            <InkButton tone="quiet" disabled={waiting} onClick={() => { setManualDraft("write"); if (!manualDraft) { setHeadline(editorTitle(data.lead.headline)); if (!topicTouched) setTopic(data.lead.topic); } requestAnimationFrame(() => bodyField.current?.focus()); }}>Write it myself</InkButton>
            <InkButton tone="quiet" disabled={waiting} onClick={() => { setManualDraft("paste"); if (!manualDraft) { setHeadline(editorTitle(data.lead.headline)); if (!topicTouched) setTopic(data.lead.topic); } requestAnimationFrame(() => bodyField.current?.focus()); }}>Paste a story</InkButton>
          </>
        ) : null}
        <details className="row-more story-more">
          <summary className="btn quiet">More <span aria-hidden="true">&#9662;</span></summary>
          <div className="row-more-panel">
        {data.draft && !locked && !onPaper ? (
          <div className="story-check-overflow">
            <DraftReconcileControl {...reconcileControlProps} render="button" />
          </div>
        ) : null}
        {data.draft?.body && !locked && !onPaper ? (
          <div className="story-redraft-overflow">
          <InkButton
            tone="quiet"
            disabled={waiting || reconcileActive || paperGate.blocked}
            onClick={() => setRedraftOpen(true)}
          >
            {waiting ? "Redrafting…" : "Redraft…"}
          </InkButton>
          </div>
        ) : null}
        {data.draft && !locked && !onPaper ? (
          <InkButton
            tone="ghost"
            disabled={waiting || reconcileActive}
            onClick={() => setAddToOpen(true)}
          >
            + Add to story
          </InkButton>
        ) : null}
        {body ? (
          /*
            Unit UI1a2. The press is synchronous -- it opens the preview dialog
            -- so there is no `working` to show; what it HAS is a done state,
            and the page already records it (`previewSeen`, which the Checks
            tab's gate chip reads as "✓ Preview viewed"). The button says the
            same thing: "Preview opened", in the success green, with a check.
            No walk asks for this control by name, so the done word cannot
            rename it out from under one.
          */
          <ActionButton
            tone="quiet"
            phase={previewSeen ? "done" : "idle"}
            doneLabel="Preview opened"
            onAct={() => {
              setPreviewSeen(true);
              preview.current?.showModal();
            }}
          >
            Preview as reader
          </ActionButton>
        ) : null}
        <a className="inline-link astra-checks-jump" href="#story-inspector">
          Checks & sources
        </a>
        {/*
          Unit BH2 decision 6: the drawn `dialog-12-compare.png`, opened by a
          press of its own. It only exists once an evidence check has left two
          versions behind -- before that there is nothing to compare, and the
          inline "Evidence check results" panel in the inspector still holds
          the same two decisions for anyone who reads it there.
        */}
        {evidenceReview ? (
          <InkButton tone="quiet" onClick={() => setCompareVersionsOpen(true)}>
            Compare versions
          </InkButton>
        ) : null}
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
        {/*
          CIVIC REPORTING (editor UI). The press that starts a civil-reports
          run anchored on THIS lead: "Report this meeting" or "Develop this
          lead". It shares the page's model/research state so the pin the
          runner is handed is the same one the Writer row shows, and it is
          gated exactly like the other presses that spend a model
          (`!locked && !onPaper`, plus the paper-setup gate's own reason).

          Which of the two words is drawn: a lead that already carries a draft
          is one being developed, so it reads "Develop this lead"; a lead with
          no draft yet is most often a meeting record the editor wants
          accounted for, so it reads "Report this meeting". The control itself
          owns the ask-and-model box it opens -- see report-this-lead.tsx.
        */}
        {!locked && !onPaper ? (
          <span className="astra-story-report-this">
            <ReportThisLeadControl
              leadId={data.lead.id}
              action={data.draft?.body ? "develop-lead" : "report-meeting"}
              hasDraft={Boolean(data.draft?.body)}
              modelChoice={modelChoice}
              modelEffort={modelEffort}
              onModelChoice={setModelChoice}
              onModelEffort={setModelEffort}
              researchScope={researchScope}
              onResearchScope={setResearchScope}
              disabled={paperGate.blocked}
              disabledReason={paperGate.reason ?? null}
            />
          </span>
        ) : null}
          </div>
        </details>
      </div>
      {/*
        The evidence check's own block, under the row: its progress, its
        dirty note, its finished notice. The drawing puts the job cards here,
        and the row above only has space for a button. See
        `reconcileControlProps`.

        Unit CW2: `review` is withheld from this instance. That panel -- the
        before/after comparison under the heading "Evidence check results",
        with its two decisions -- is the one the Checks tab's compare press
        opens as the Compare-versions dialog, on the same two functions, so
        drawing it here as well printed the same decision twice and ran the
        page thousands of pixels past the action row the drawing ends at. The
        job's progress, its failure notice and its "Reload checked draft"
        press all stay: those are the check's own state, and the drawing has
        them.
      */}
      {data.draft && !locked && !onPaper ? (
        <DraftReconcileControl
          {...reconcileControlProps}
          render="notes"
          review={null}
          reviewOpen={false}
        />
      ) : null}
      {/*
        "A full JobCard under the actions while a check or redraft runs"
        (phase 2b, item 1). Two cards, because this page runs two jobs: the
        draft (the phase 3 banner's own component, moved here from above the
        title) and the evidence check (the same JobCard, filtered to the
        `reconcile` kind). Both render nothing when their job is not open.
      */}
      <StoryJobProgress
        leadId={data.lead.id}
        initial={
          data.job && (data.job.status === "queued" || data.job.status === "running")
            ? [jobProgressView(data.job, data.lead.id, data.draft?.id ?? null)]
            : null
        }
        note={
          <p className="story-running-note">
            Your submission is saved. The draft will appear here automatically. You can return from{" "}
            <Link to="/desk">Desk → Your recent drafts</Link>.
          </p>
        }
      />
      <StoryCheckJobProgress leadId={data.lead.id} />
          {data.draft || !locked ? (
            /*
              STORY DETAILS (unit CW2).

              `Desk Story.dc.html` draws no Topic, no Geography, no Pulled
              notes and no named-outlet record: the main column it draws ends
              at the action row, and the section it needs to publish is picked
              from the sticky bar. The page still owes an editor every one of
              these fields, so they live here -- one disclosure, shut by default,
              directly under the action row. A press that needs a field in here
              (the sticky bar's "pick the section", the Checks tab's section
              blocker) opens the disclosure and then focuses, which is the only
              way a press into a shut <details> can work at all. See
              `openStoryDetails`.
            */
            <details className="astra-story-details" id="story-details">
              <summary>Story details</summary>
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
                      if (!data.draft) {
                        leadTopicChoice.current = e.target.value;
                        setMsg("");
                        saveTopic.mutate(e.target.value);
                      }
                    }}
                    disabled={onPaper || locked || saveTopic.isPending}
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
                THE GROUND THIS STORY STANDS ON (0.6.71).

                The paper's front page carries four geography pills, and the
                only place that knows which one a story belongs to is the person
                publishing it. One select, on the publish step that already
                exists -- not a new step and not a desk re-layout (that is a
                later phase).

                Longmont is the default and the fallback: a story with no stored
                area reads as the home town on the paper, so leaving this alone
                is not an omission the reader ever sees.
              */}
              <div id="story-area">
                <Field label="Geography">
                  <select
                    id="story-area-select"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    disabled={onPaper}
                  >
                    {areaPills(labels).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="note">
                  Which pill this story answers to on the front page — {labels[HOME_AREA]} is
                  the home town and the default.
                </p>
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
            </details>
          ) : null}
          {/*
            The Style check section used to be drawn here, at the bottom of
            the main column (unit CW2). It is the style row's own disclosure
            body now -- `#evidence-detail-style` in the Checks tab list --
            because the drawing's page ends at the action row and its style
            row is the only place the drawing puts the repair press. It is
            built as `styleDetail` below and handed to the panel.
          */}
          {/*
            The evidence review used to be mounted here, at the bottom of the
            page's main column (unit CW2). It is on the Checks tab now, where
            the drawing puts the list it draws: the main column ends at the
            action row, and the page's own stack of judgment forms under the
            editors is gone with it.
          */}
        </section>
      </div>
      {/*
        ── WHERE THE PRESS WAS MADE IS WHERE THE ANSWER IS DRAWN (PUB1) ───────

        A print takes the bar away -- `canPublish` is false once the lead is on
        the paper -- so the "Published." banner takes the bar's OWN place, at
        the same spot on the page, and stays there for the rest of the visit
        rather than being a note at the top the editor has to find. A refusal
        keeps the bar where it is and is drawn next to the button that was
        pressed. Both are `PublishBarResult`, so neither can drift from the
        other or from `publishPressState`.

        ── AND THE PRESS ITSELF, CHANGED AND STAYING (UI1b-2) ───────────────

        UI1a made the banner the ONLY confirmation, on the rule that a print
        takes the control away so the two could not both be drawn. The owner
        changed that rule on purpose. On his own story the auditor found the
        Publish button GONE after "Yes, print it", and what he asked for was
        the control changing: "click a publish button, it publishes and then
        CHANGES to say 'Published' with, say, a green color". So the slot the
        press was made in now holds the shared `ActionButton` in its `done`
        phase -- "Published", the green token, the check, not pressable -- and
        the banner stays beside it. See `PublishBarDone`.

        The condition is `onPaper`, NOT `press.kind === "published"`, and that
        is the decision this unit was asked to make and say out loud: the green
        "Published" is a FACT ABOUT THE STORY, so it is drawn for as long as the
        story is on the paper -- through the cache refreshes a print triggers,
        and on a page opened later on a story that went up days ago. The banner
        is the answer to a PRESS, so it is drawn only right after one
        (`justPublished`, through `press`), which is PUB1's rule kept exactly.
        A refusal leaves `onPaper` false, so it can never draw the Published
        state.
      */}
      {onPaper ? (
        <PublishBarDone result={press} />
      ) : canPublish ? (
        /*
          The sticky publish bar. What is drawn on it is what is true: the four
          chips read this page's own state, and the button keeps every rule it
          had -- 0.6.67's section confirmed in the same press, the named-outlet
          and stale-evidence gates, and phase 1's area select, which stays in
          the form above so the press that prints is the press that confirms.
          The gates are the drawing's; they are not new blockers. Disabling is
          still exactly the `disabled` list on the button, which is the rule
          the claims-of-absence test pins.
        */
        <div className="astra-publish-bar" id="astra-publish-bar">
          <CheckGates gates={publishGates} label="Publish gates" />
          <div className="astra-publish-actions">
            <PublishTranscriptNotice notice={data?.meetingPublishNotice} />
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
                  {/*
                    The button and the list above it are one thing (unit CT):
                    `blockers` is every reason this can be off, and the press
                    is off exactly when that list is not empty. The old list
                    named five states here and a sixth on the first press, and
                    only one of them had a sentence anywhere on the page.
                  */}
                  {/*
                    Unit UI1a: the confirm press goes through the shared
                    `ActionButton`, so a press in flight is a spinner and the
                    word "Publishing…" at the control the editor just pressed,
                    with the button disabled -- not a button that looks
                    unchanged until the page swaps under it.
                  */}
                  <ActionButton
                    tone="primary"
                    phase={publish.isPending ? "working" : "idle"}
                    disabled={publish.isPending || blockers.length > 0}
                    workingLabel="Publishing…"
                    onAct={() => {
                      setConfirmingPublish(false);
                      /* The last answer is about to be replaced by this
                         press's answer (unit PUB1). */
                      setPublishRefusal("");
                      publish.mutate();
                    }}
                  >
                    {publish.isPending ? "Publishing…" : `Yes, print it in ${sectionNameNow}`}
                  </ActionButton>
                  <ActionButton
                    tone="secondary"
                    phase="idle"
                    onAct={() => setConfirmingPublish(false)}
                  >
                    Not yet
                  </ActionButton>
                </>
              ) : (
                <>
                  <ActionButton
                    tone="primary"
                    phase={publish.isPending ? "working" : "idle"}
                    workingLabel="Publishing…"
                    disabled={publish.isPending || blockers.length > 0}
                    onAct={() => setConfirmingPublish(true)}
                  >
                    {`Publish in ${sectionNameNow}`}
                  </ActionButton>
                  {/*
                    The section is on the button, so the editor can read what
                    they are about to confirm. This is the way back to the
                    select when the name on the button is not the one they
                    want -- and the focus, not just the scroll, because the
                    point of pressing it is to change that field.

                    Unit CW2 moved that select into the shut "Story details"
                    disclosure, and a shut <details> swallows focus, so this
                    press opens it first. Without that step the press would
                    scroll to the section heading and leave the cursor
                    nowhere, which is a dead press however the scroll looks.
                  */}
                  <button
                    type="button"
                    className="inline-link astra-publish-section-change"
                    onClick={() => {
                      openStoryDetails();
                      document.getElementById("story-topic-select")?.focus();
                      document
                        .getElementById("story-topic")
                        ?.scrollIntoView?.({ block: "center" });
                    }}
                  >
                    {sectionReady ? "change" : "pick the section"}
                  </button>
                  {/*
                    A greyed button with no sentence beside it is a dead end --
                    the editor cannot tell whether it is broken, still loading,
                    or refusing on purpose. The reason is text, not opacity.

                    It used to name the first reason only, one at a time, in
                    small text at the far right of this row: the owner read it
                    as stray text and never found the button it pointed at.

                    Unit CW puts the drawing's own sentence here: the first
                    reason, said as the press that clears it -- "Confirm the
                    claim to publish." -- above the same press to the list at
                    the top of the Checks tab, where every reason has its own
                    sentence and its own button. The count CT put here still
                    runs, at the head of that list, which is the one place it
                    was ever acted on.
                  */}
                  {/*
                    Unit PUB1: while the press is in flight the bar says so once,
                    through `PublishBarResult` below. The `publishing` blocker is
                    real -- it is what disables the button -- but its sentence
                    ("See the publish bar to publish.") is a way to the bar, and
                    an editor already ON the bar reading it mid-press is the same
                    dead-press feel this unit removes.
                  */}
                  {blockers.length > 0 && press.kind !== "publishing" ? (
                    <span className="note publish-blocked">
                      {hasAiJudgments ? draftReadiness.reason : heldPublishNote || blockers[0]?.sentence}{" "}
                      <button
                        type="button"
                        className="inline-link"
                        onClick={() => {
                          if (heldPublishNote) {
                            setInspector("reporting");
                            document.getElementById("inspector-reporting")?.scrollIntoView?.({ block: "start" });
                            return;
                          }
                          setInspector("checks");
                          document
                            .getElementById("publish-blockers")
                            ?.scrollIntoView?.({ block: "start" });
                        }}
                      >
                        Review
                      </button>
                    </span>
                  ) : (
                    /*
                      The drawing's other half: nothing stands in the way.

                      Unit U9: that is not the same claim as "the checks ran".
                      A hand-filed story may print with nothing recorded against
                      it, and this line used to answer that case with "All
                      checks done." -- the page saying a check passed when the
                      panel below it said "This draft has no recorded name
                      check." `publishBarNote` says which one did not run.
                    */
                    <span className="note">{hasAiJudgments ? draftReadiness.reason : "Ready to publish."}</span>
                  )}
                </>
              )
            ) : null}
            {/* The bar's own answer to the press: "Publishing…", the server's
                refusal, or nothing when there is nothing to say. */}
            <PublishBarResult state={press} />
          </div>
        </div>
      ) : null}
      <NativeDialog
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
        <article className="astra-dialog-body" tabIndex={0}>
          <p className="kick">{topic} · Draft for review</p>
          <h1>{headline}</h1>
          <p className="astra-preview-dek">{dek}</p>
          <div className="astra-preview-body">
            <StoryBody body={body} />
          </div>
        </article>
      </NativeDialog>
      {/*
        Unit BH2 decisions 5 and 6: the three dialogs. They are mounted here, at
        the foot of the page, because each one portals itself to the body -- the
        position in this tree decides nothing about where it appears, and
        grouping them keeps the page's own markup above unchanged.

        Each is opened from a press that already existed, except Kill, whose
        press is the one control this unit adds to the page.
      */}
      <KillDialog
        leadId={id}
        open={killOpen}
        onOpenChange={setKillOpen}
        onKilled={afterLeadChange}
      />
      {/*
        Unit CP items 1 and 2: the two dialogs that were built and drawn but had
        no press anywhere on the desk. Mounted here for the same reason the
        three above are -- each portals itself to the body, so where it sits in
        this tree decides nothing about where it appears.
      */}
      <AddToStoryDialog
        leadId={id}
        open={addToOpen}
        onClose={() => setAddToOpen(false)}
        onSaved={(after) => {
          /*
            The dialog saved the body on the server; this page's box holds its
            own copy, and the effect that seeds that box only takes the server's
            copy when the draft it is looking at changes. Without this the box
            would keep the pre-weave text and the next "Save edits" would write
            it back over the weave. `stripReporterNotebook` is the same
            treatment every other seed of this box applies.
          */
          setBody(stripReporterNotebook(after));
        }}
        onDone={(note) => {
          setMsg(note);
          void afterLeadChange();
        }}
      />
      <HeadlineDialog
        leadId={id}
        current={headline}
        open={headlineOpen}
        onClose={() => setHeadlineOpen(false)}
        onSaved={(saved) => {
          // The chosen line lands in the page's own box, where "Save edits"
          // already knows how to keep it; the dialog has written the same line
          // to the draft, so the two agree.
          setHeadline(saved);
        }}
        onDone={(note) => {
          setHeadlineNote(note);
          void afterLeadChange();
        }}
      />
      <RedraftDialog
        open={redraftOpen}
        onOpenChange={setRedraftOpen}
        direction={storyDirection}
        modelChoice={modelChoice}
        /*
          Handed straight over, `null` and all: the dialog's row is the same
          `ModelPicker` this page already draws, so it takes the page's state as
          it is rather than a resolved copy that could disagree with it.
        */
        modelEffort={modelEffort}
        writerStatus={readiness}
        onModelChange={(choice) => {
          modelChoiceTouched.current = true;
          setModelChoice(choice);
          setModelEffort(defaultModelEffort(choice));
        }}
        onEffortChange={setModelEffort}
        busy={waiting || draft.isPending}
        error={redraftOpen ? draftProblem : undefined}
        onStart={(next) => {
          /*
            The two calls the Redraft press has always made, in the same order:
            the direction is saved first, then the draft starts. The page's own
            `storyDirection` is updated too, so the box on the page and any later
            save carry what was typed here.
          */
          setStoryDirection(next);
          setRedraftOpen(false);
          draft.mutate(next);
        }}
      />
      {evidenceReview ? (
        <CompareVersionsDialog
          open={compareVersionsOpen}
          onOpenChange={setCompareVersionsOpen}
          review={evidenceReview}
          /*
            The drawing's two kickers carry a time each. Only one of the two
            times exists on this page -- the saved draft's `updated_at`; the
            checked version is not stored with one (see
            `DraftReconcileStatus`). So the left kicker carries the time and the
            right one says what the version is.
          */
          originalLabel={
            data.draft?.updated_at
              ? `Your saved version · ${formatShortDate(data.draft.updated_at)}`
              : "Your saved version"
          }
          checkedLabel="After evidence check"
          busy={waiting || reconcileActive || save.isPending}
          onKeepChecked={() => {
            keepCheckedVersion();
            setCompareVersionsOpen(false);
          }}
          onRestoreOriginal={() => {
            restoreOriginalVersion();
            setCompareVersionsOpen(false);
          }}
        />
      ) : null}
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

/**
 * The site name a claim's source link shows (0.6.74). The full URL used to be
 * the link text, and in the inspector's width it broke into a column of
 * fragments with the " · " that preceded it left alone on a line above them.
 * The host is short enough to sit on the claim's own line; the URL an editor
 * needs to copy is in the link's `title` and in its href.
 */
function shortSourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The reporting-note line the Add-to-notes button writes, exactly as stored. */
function claimNoteLine(claim: string, url: string): string {
  return clipTodoText(`${claim} — ${url}`);
}

/**
 * Whether that line is already in the notes. `addHumanLine` refuses a
 * duplicate, so the button can say so instead of looking like it did nothing.
 */
function hasNoteLine(notes: ReportingNotes, line: string): boolean {
  const wanted = clipTodoText(line).toLowerCase();
  return notes.todo.some((row) => row.src === "you" && row.t.toLowerCase() === wanted);
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
  meetingAccounting,
  onRewriteFromLedger,
  rewritePhase,
  rewriteReason,
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
  /** WR1 phase 2: the whole-meeting run's accounting for this lead (see getLead). */
  meetingAccounting: MeetingAccounting | null;
  /** The ledger panel's "Rewrite from ledger", or undefined when it cannot run. */
  onRewriteFromLedger?: () => void;
  rewritePhase: ActionPhase;
  rewriteReason?: string | null;
}) {
  const qc = useQueryClient();
  const [line, setLine] = useState("");
  /*
    Which Pull was just asked for, as `todo:<index>` or `claim:<source url>`.
    One key rather than one state per row: a reporting line and a claim's
    source can both be waiting, and the row that pressed the button is the only
    one that should show "Pulling…".
  */
  const [startingPullKey, setStartingPullKey] = useState<string | null>(null);
  const [pullMsg, setPullMsg] = useState("");
  const small = usePhoneNotes();
  const earlierNotes = earlierReportingNotes(notes);
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
    Unit CU (0.6.81): this is where "People who still need to respond" stood --
    the story's own manual follow-ups, read by `listFollowUps`, and the only
    place in the app a manual ask could still be created ("Add a follow-up",
    who/what/due). The manual workflow is retired (DECISIONS.md:38, :44): the
    query, the three form fields, the `addFollowUp` mutation and the reply /
    nudge / drop writes are all gone, and `listFollowUps` returns agents only.
    Nothing replaces the section here; the story's agents are on
    /desk/follow-ups, and their findings reach Today's rail through
    `listFollowUpFindings`, which joins the lead. Rows already written are kept
    by migrations/0106_retire_manual_follow_ups.sql.
  */

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
    mutationFn: (input: { index?: number; query: string; url?: string; key: string }) =>
      pullTodo({ data: { leadId, query: input.query, index: input.index, url: input.url } }),
    onMutate: (input) => {
      setStartingPullKey(input.key);
      setPullMsg("");
    },
    onSuccess: (res, input) => {
      setStartingPullKey(null);
      if (!answered(res)) {
        setPullMsg(NO_ANSWER);
        return;
      }
      if (!res.ok) {
        setPullMsg(res.error);
        return;
      }
      setPullMsg(
        input.url
          ? "Pull started. The page it reads is dropped in the box under the story."
          : "Pull started. Its live progress is shown under the reporting line.",
      );
      void qc.invalidateQueries({ queryKey: ["pull-jobs", leadId] });
    },
    onError: (err) => {
      setStartingPullKey(null);
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
              starting={startingPullKey === `todo:${i}`}
              onToggle={() => save.mutate({ toggle: i, todos: notes.todo })}
              onPull={() => pull.mutate({ index: i, query: t.t, key: `todo:${i}` })}
              onStop={() => run && stopPull.mutate(run.jobId)}
              onContinue={() => run && continuePull.mutate(run.jobId)}
            />
          );
        })}
        <p className="note-hint">
          Pull opens a URL in that line, or searches the line when it has no URL, and drops the excerpt in the box under the story. The checkbox
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
      {earlierNotes.length ? (
        <details className="note-sec">
          <summary className="side-label">Earlier</summary>
          {earlierNotes.map((entry) => (
            <section key={entry.label}>
              <p className="side-label">{entry.label}</p>
              <div className="note-one" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.text}</div>
            </section>
          ))}
        </details>
      ) : null}
      {/*
        WR1 phase 2: the whole-meeting run's ledger, beside the transcript block
        and above the notes. It renders nothing at all for a lead whose draft
        has no ledger rows, so every other story in the paper is unchanged.
      */}
      <MeetingLedgerPanel
        leadId={leadId}
        accounting={meetingAccounting}
        transcriptArtifactId={
          draftMeetingEvidence
            ? (draftMeetingEvidence.currentArtifactId ?? draftMeetingEvidence.artifactId)
            : null
        }
        locked={locked}
        onRewrite={onRewriteFromLedger ?? (() => {})}
        rewritePhase={onRewriteFromLedger ? rewritePhase : "idle"}
        rewriteReason={rewriteReason}
      />
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
          {absenceBlock}
          {todoList("filled")}
          {notes.found.length ? (
            <div className="note-sec">
              <p className="side-label">Claims and sources</p>
              {notes.found.map((f, i) => {
                const run = f.src
                  ? (pullRuns.data ?? []).find((candidate) => candidate.sourceUrl === f.src)
                  : undefined;
                const key = `claim:${f.src ?? i}`;
                const active =
                  startingPullKey === key ||
                  run?.jobStatus === "queued" ||
                  run?.jobStatus === "running";
                // The accessible name the buttons and any test can address them
                // by, so two claims on one story never share a button name.
                const named = f.t.slice(0, 40).trim();
                const noted = f.src ? hasNoteLine(notes, claimNoteLine(f.t, f.src)) : false;
                return (
                  <div key={`claim-${i}-${f.t}`} className="note-one claim-row">
                    <span className="claim-t">{f.t}</span>
                    {f.src ? (
                      <span className="claim-meta">
                        <a
                          href={f.src}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-link"
                          title={f.src}
                        >
                          {shortSourceHost(f.src)}
                        </a>
                        {!locked ? (
                          <>
                            <button
                              type="button"
                              className="claim-act"
                              aria-label={`Pull source for: ${named}`}
                              disabled={active || pull.isPending}
                              onClick={() =>
                                pull.mutate({
                                  query: f.t.slice(0, 200),
                                  url: f.src!,
                                  key,
                                })
                              }
                            >
                              {active ? "Pulling…" : "Pull"}
                            </button>
                            <button
                              type="button"
                              className="claim-act"
                              aria-label={`Add to notes for: ${named}`}
                              disabled={noted || save.isPending}
                              onClick={() => {
                                save.mutate({
                                  add: claimNoteLine(f.t, f.src!),
                                  todos: notes.todo,
                                });
                                announceToDesk("Added to reporting notes. Redraft reads it.");
                              }}
                            >
                              {noted ? "In notes" : "Add to notes"}
                            </button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {run ? (
                      <PullProgress
                        run={run}
                        onStop={() => stopPull.mutate(run.jobId)}
                        onContinue={() => continuePull.mutate(run.jobId)}
                        disabled={locked}
                      />
                    ) : startingPullKey === key ? (
                      <div className="pull-progress active">
                        <div className="pull-progress-head">
                          <strong>Starting Pull…</strong>
                          <span>0s</span>
                        </div>
                        <p>Reading the page this claim cites — no AI model is being used.</p>
                        <p className="pull-counts" aria-live="polite">
                          Creating the saved background job…
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <p className="note-hint">
                Pull reads that claim&rsquo;s source page and drops the excerpt in the box under
                the story. Add to notes writes the claim and its link into your reporting notes.
              </p>
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
      {/*
        Unit CU (0.6.81): the "People who still need to respond" section stood
        here -- `FollowUpItem` per manual ask with Record reply / Nudge / Drop,
        and the "Add a follow-up" form (who, what, due) under it. Removed
        whole: DECISIONS.md:44 retires the human "seek a response" step, so
        there is no ask to write and no reply to record. The rows are kept by
        migrations/0106_retire_manual_follow_ups.sql.
      */}
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
      startingPullKey != null ||
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
  /*
    What the last pull on this line did, in the editor's words and at the
    paper's own clock: "Tried 12:15 p.m.: search unavailable". The reason is
    `item.q` and the time is `item.triedAt`, both written by the pull that ended
    without a document and stored together (PULL1b). It is deliberately NOT the
    newest run's finish: after a successful retry the line is struck, and an
    editor who restores it would read the retry's time beside the older failure.
    A reason with no stamp -- a row from an earlier build -- is drawn on its own,
    with no time. A struck line says nothing: it worked.
  */
  const { clockTime } = usePaperDateFormatters();
  const triedAt = clockTime(item.triedAt ?? null);
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
      {!item.done && item.q ? (
        <p className="todo-q">
          {triedAt ? `Tried ${triedAt}: ${item.q}` : item.q}
        </p>
      ) : null}
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
        {/*
          The fold used to print a count of failures -- "13 provider or page
          failures" -- which is our bookkeeping and told the editor nothing
          about why the pull came back empty. It now names the providers in
          plain words; the raw lines stay inside for support.
        */}
        {run.providerNotes?.length ? (
          <details>
            <summary>{failureSummary(run.providerNotes ?? [])}</summary>
            <ul>
              {run.errors.map((error, index) => (
                <li key={`${run.jobId}-pull-error-${index}`}>{error}</li>
              ))}
            </ul>
          </details>
        ) : run.errors.length ? (
          <details>
            <summary>
              {run.errors.length} page{run.errors.length === 1 ? "" : "s"} could not be opened
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
