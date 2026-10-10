import { requestDraftReconciliationFn as _requestDraftReconciliationFn } from "@/lib/news/draft-reconcile-actions";
import { saveDailyScanPolicy as _saveDailyScanPolicy } from "@/lib/news/daily-scan";
import { startDraftBatch as _startDraftBatch } from "@/lib/news/draft-batch";
import { retryStoryJob as _retryStoryJob } from "@/lib/news/job-progress";
import { chooseHeadline as _chooseHeadline, holdLead as _holdLead, findSources as _findSources, addLead as _addLead } from "@/lib/news/editor-dialog-actions";
/**
 * Drop-in scoped server handles that carry the desk's explicit-consent flow.
 *
 * Scott's rule (Oct 10 2026): outside Publish the desk may WARN, never block. A
 * scoped server handle that a policy gate refuses now answers
 * `{ ok:false, warning:{key,sentence}, error }`. A route that presses such a
 * handle must show the sentence and let the editor press again; that logic is
 * identical for every button, so it lives here once and the routes keep their
 * own words.
 *
 * Each export is the SAME server handle behind `withEditorWarningAction`: the
 * call shapes, the return types and the argument names are unchanged, so a route
 * migrates by changing only WHERE it imports the handle from —
 *
 *     import { runScan } from "@/components/scoped-actions";   // was @/lib/news/desk
 *
 * — and every callsite of that handle gains the flow at once. Publish handles
 * stay imported from their own modules; nothing here touches them.
 *
 * The first call carries no override. A warning opens the desk's one consent
 * surface (`WarningConsentHost`, mounted in the shell); only the editor's own
 * "…anyway" press re-runs the SAME captured request with `override:[key]`. A
 * cancel runs nothing again. Sequential warnings keep every key approved so
 * far. There is no automatic approval and no silent retry anywhere in here.
 */
import { askEditorToOverride, withEditorWarningAction } from "@/components/editor-warning-consent";
import type { WarningPressKind } from "@/components/editor-warning";
import {
  checkOneSource as _checkOneSource,
  createAiFollowUp as _createAiFollowUp,
  draftLead as _draftLead,
  fileLead as _fileLead,
  followUpAction as _followUpAction,
  pullTodo as _pullTodo,
  resolveLeadDuplicate as _resolveLeadDuplicate,
  rewriteFromLedger as _rewriteFromLedger,
  runScan as _runScan,
  saveSourceScanPreference as _saveSourceScanPreference,
  setLeadStatus as _setLeadStatus,
  updateLead as _updateLead,
  startReporting as _startReporting,
  answerReportingFollowUp as _answerReportingFollowUp,
  updateAiFollowUp as _updateAiFollowUp,
  continuePullJob as _continuePullJob,
  writeStoryFromInput as _writeStoryFromInput,
} from "@/lib/news/desk";
import {
  continueInvestigation as _continueInvestigation,
  findSomethingToDigInto as _findSomethingToDigInto,
  openDarkInvestigation as _openDarkInvestigation,
  queueInvestigation as _queueInvestigation,
  runDarkDesk as _runDarkDesk,
  retryDarkRound as _retryDarkRound,
  refreshBrief as _refreshBrief,
  challengeInvestigation as _challengeInvestigation,
  scanTipSubreddit as _scanTipSubreddit,
} from "@/lib/news/dark";
import {
  forceRecaptureMeeting as _forceRecaptureMeeting,
  captureAudioAgain as _captureAudioAgain,
  runMeetingsNow as _runMeetingsNow,
} from "@/lib/news/meeting-manual-run";

type ServerCall = (...args: unknown[]) => Promise<unknown>;
/** How to fold the approved keys into the exact call the editor made. */
export type OverrideMap = (args: unknown, override: string[]) => unknown;

/**
 * The default fold: put `override` beside the input the editor already sent.
 * Server input schemas are plain objects (unknown keys are ignored when a gate
 * has not yet been taught the field), so this is safe to send either way.
 */
function mergeOverride(args: unknown, override: string[]): unknown {
  const base =
    args && typeof args === "object" ? (args as Record<string, unknown>) : ({} as Record<string, unknown>);
  const data = base.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ...base, data: { ...(data as Record<string, unknown>), override } };
  }
  return { ...base, data: { override } };
}

/** Wrap a scoped handle so a structured warning becomes an explicit second press. */
export function wrapScoped<H>(
  handle: H,
  action: string,
  kind?: WarningPressKind,
  map: OverrideMap = mergeOverride,
): H {
  const call = handle as ServerCall;
  const wrapped = (args?: unknown) => {
    const captured = args === undefined ? undefined : structuredClone(args);
    return withEditorWarningAction(
      (override) => (override ? call(map(captured, override)) : call(captured)),
      { action, kind },
      askEditorToOverride,
    );
  };
  return wrapped as unknown as H;
}

// — Scan and sources (items 1, 26, 27, 29, 31) —
export const runScan = wrapScoped(_runScan, "Run scan", "run");
export const checkOneSource = wrapScoped(_checkOneSource, "Check now", "check", (args, override) => ({
  // checkOneSource took a bare row id; it is normalised to `{ sourceId }` so the
  // approval can ride beside it (the server's schema accepts the new shape).
  data: { ...((args as { data?: unknown })?.data && typeof (args as { data?: unknown }).data === "object" ? (args as { data: Record<string, unknown> }).data : { sourceId: (args as { data?: unknown })?.data }), override },
}));
export const saveSourceScanPreference = wrapScoped(_saveSourceScanPreference, "Use this scan setting");

// — Leads and drafts (items 2, 3, 4, 5, 6, 34) —
export const draftLead = wrapScoped(_draftLead, "Draft this story", undefined, (args, override) => typeof (args as {data?: unknown})?.data === "number" ? { data: { leadId: (args as {data:number}).data, override } } : mergeOverride(args, override));
export const rewriteFromLedger = wrapScoped(_rewriteFromLedger, "Rewrite this story");
export const fileLead = wrapScoped(_fileLead, "File this lead");
export const setLeadStatus = wrapScoped(_setLeadStatus, "Change this lead");
export const updateLead = wrapScoped(_updateLead, "Save this lead");
export const resolveLeadDuplicate = wrapScoped(_resolveLeadDuplicate, "Resolve this lead");
export const pullTodo = wrapScoped(_pullTodo, "Pull the thread");

// — Follow-ups (item 33) —
export const createAiFollowUp = wrapScoped(_createAiFollowUp, "Create this follow-up");
export const followUpAction = wrapScoped(_followUpAction, "Run this follow-up", "run");

// — Dark Desk and investigations (items 23, 24, 36) —
export const runDarkDesk = wrapScoped(_runDarkDesk, "Start a Dark Desk run", "run");
export const openDarkInvestigation = wrapScoped(_openDarkInvestigation, "Open this investigation");
export const findSomethingToDigInto = wrapScoped(_findSomethingToDigInto, "Find something to dig into");
export const continueInvestigation = wrapScoped(_continueInvestigation, "Keep digging", undefined, (args, override) => typeof (args as {data?:unknown})?.data === "number" ? {data:{id:(args as {data:number}).data,override}} : mergeOverride(args, override));
export const queueInvestigation = wrapScoped(_queueInvestigation, "Send this to the Queue");
export const scanTipSubreddit = wrapScoped(_scanTipSubreddit, "Check the tip subreddit", "check");

// — Meetings (item 36) —
export const runMeetingsNow = wrapScoped(_runMeetingsNow, "Run meeting capture", "run");
export const forceRecaptureMeeting = wrapScoped(_forceRecaptureMeeting, "Re-capture this meeting");

export const saveDailyScanPolicy = wrapScoped(_saveDailyScanPolicy, "Save this schedule");
export const startDraftBatch = wrapScoped(_startDraftBatch, "Draft this batch");
export const writeStoryFromInput = wrapScoped(_writeStoryFromInput, "Write this story");
export const addLead = wrapScoped(_addLead, "File this lead");
export const updateAiFollowUp = wrapScoped(_updateAiFollowUp, "Save this follow-up");
export const continuePullJob = wrapScoped(_continuePullJob, "Continue this Pull");
export const retryStoryJob = wrapScoped(_retryStoryJob, "Retry this draft");
export const retryDarkRound = wrapScoped(_retryDarkRound, "Retry this round");
export const challengeInvestigation = wrapScoped(_challengeInvestigation, "Challenge this case");
export const refreshBrief = wrapScoped(_refreshBrief, "Write this brief", undefined, (args, override) => typeof (args as {data?:unknown})?.data === "number" ? {data:{id:(args as {data:number}).data,override}} : mergeOverride(args, override));
export const captureAudioAgain = wrapScoped(_captureAudioAgain, "Capture audio again");

export const requestDraftReconciliationFn = wrapScoped(_requestDraftReconciliationFn, "Check this draft");

export const startReporting = wrapScoped(_startReporting, "Start this reporting run");
export const answerReportingFollowUp = wrapScoped(_answerReportingFollowUp, "Run this reporting follow-up");

export const holdLead = wrapScoped(_holdLead, "Hold");
export const chooseHeadline = wrapScoped(_chooseHeadline, "Use headline");
export const findSources = wrapScoped(_findSources, "Find sources");
