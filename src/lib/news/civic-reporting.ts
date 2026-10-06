/*
  The editor's reporting package, as data.

  WHAT THIS IS. One requested civic-reporting run produces one structured
  package: the assignment it answered, the coverage ledger, the claim/source
  ledger with real locators, the four-component newsworthiness score, the
  editorial readiness tier (assigned SEPARATELY from the score), the explicit
  unknowns, and the run receipt (method version + model identity). This module
  is the package's SHAPE and its pure parse/validate/normalize helpers.

  WHY IT IS ITS OWN MODULE, CLIENT-SAFE. `desk.story.$leadId.tsx` renders the
  package beside the copy and `desk.ts` writes it; both need the same type and
  the same parsers. The moment this module imports `@/lib/db` it stops loading
  under `node --test`, and the parse rules below -- which are the rules that
  decide whether a claim is shown as VERIFIED or as a gap -- stop being
  testable. So: types, constants, pure functions, relative imports only.

  WHAT IT MUST NOT DO. It must not invent. An empty coverage ledger is a real
  state ("nothing was read"), not a licence to fill one in; an unresolved vote
  is `unverified`, not a tally; a missing locator is dropped, not replaced with
  a plausible page number. Every normalizer below either keeps a value that is
  present or drops it -- none of them synthesizes one.
*/

import type { ModelEffort } from "./provider-registry.ts";

/**
 * The civic-scanner method this repository is pinned to. Stated once, here, so
 * the run receipt, the tests and the desk's labels cannot disagree about which
 * instructions produced the work. The method itself lives OUTSIDE TownReporter
 * (see `resolveCivicMethodDir`) and is never copied into a smaller "Scan".
 */
export const CIVIC_SCANNER_METHOD_VERSION = "2.6.0";

/** The seven modes the installed skill declares. Reporting uses `full-pipeline`. */
export type CivicMode =
  | "daily-scan"
  | "full-pipeline"
  | "verify-only"
  | "research"
  | "revise"
  | "legal-threat"
  | "discover";

/** The mode a desk reporting run always asks for. */
export const CIVIC_REPORTING_MODE: CivicMode = "full-pipeline";

/** Source tiers are claim-specific, and separate from editorial readiness. */
export type SourceTier = "A" | "B" | "C";

/** A claim's verification status. `CONTESTED` is not a polite `UNVERIFIED`. */
export type PackageClaimStatus = "VERIFIED" | "CONTESTED" | "UNVERIFIED";

/**
 * One source, with the locator that makes it checkable. `url` is public when
 * one exists; `offlineReference` is the honest alternative (an interview note,
 * a file path the newsroom holds) and is REQUIRED when there is no URL -- the
 * method's rule that a source without a public link gets a real reference
 * rather than an invented one.
 */
export type PackageSource = {
  id: string;
  title: string;
  tier: SourceTier;
  url: string;
  /** Page, agenda item, or recording timestamp. Empty when the source has none. */
  locator: string;
  /** Used only when `url` is empty: the interview/file reference. */
  offlineReference: string;
};

/** One consequential factual claim, with the sources in THIS package that support it. */
export type PackageClaim = {
  id: string;
  text: string;
  status: PackageClaimStatus;
  /** IDs into this package's `sources`. A VERIFIED claim resolves to >= 1 Tier A. */
  sourceIds: string[];
  /** The reporter's next accessible check, or "" when nothing is owed. */
  nextCheck: string;
  /**
   * The agenda item, motion number or packet page the claim was written
   * UNDER, when the writer named one. The code-side binding uses it to hold a
   * figure, a tally or a quote to that item's own record: a number that
   * appears elsewhere in the meeting does not verify this action. Absent or
   * empty means the claim names no item, and the binding falls back to word
   * overlap -- never to a different item.
   */
  item?: string;
};

/**
 * The four newsworthiness components, each 1..5. A zero means the run did not
 * score, which is rendered as "not scored" rather than as a low score.
 */
export type PackageScore = {
  immediacy: number;
  impact: number;
  conflict: number;
  novelty: number;
  total: number;
  /** The one-line why-it-matters note. */
  whyItMatters: string;
};

/**
 * A story packet: substantial copy plus its OWN claims and sources. The method
 * requires the ledger to travel with the story, so this is per-packet, not a
 * global appendix.
 */
export type PackageStory = {
  id: string;
  headline: string;
  /** The draft body. Substantial; never a rewritten scan excerpt. */
  draft: string;
  /** The reporter's plain-language brief, or "". */
  plainBrief: string;
  /** What this story specifically cannot yet say. */
  cannotSay: string;
  /** The reporter-assigned editorial readiness tier: 0 (unstated), 1, 2 or 3. */
  readinessTier: number;
  claims: PackageClaim[];
  sources: PackageSource[];
};

/** Every substantive action the meeting took, including procedural ones. */
export type CoverageAction = {
  actionId: string;
  /** Recording time or transcript line range; "unknown" only when unresolved. */
  timestamp: string;
  agendaItem: string;
  motionOrAction: string;
  outcome: string;
  /** A VERIFIED tally, or the literal "unverified". */
  vote: string;
  policyStage: string;
  /** URL plus page/section/time. */
  evidence: string;
  disposition: string;
};

export type MeetingCoverage = {
  status: "COMPLETE" | "PARTIAL";
  body: string;
  date: string;
  coverageStatus: "complete" | "partial" | "unavailable";
  recordingUrl: string;
  gaps: string;
};

/** A held or Black Desk possibility: visible, and never publication copy. */
export type PackageHeld = {
  storyId: string;
  headline: string;
  reason: string;
  /** The testable next check (the method's `agent4Target`). */
  nextCheck: string;
  unverified: boolean;
};

/** The run receipt: which method, which model, and what it actually did. */
export type RunReceipt = {
  methodVersion: string;
  methodDir: string;
  mode: CivicMode;
  /** The effective model choice the run was pinned to. */
  modelChoice: string;
  /** The model/effort the selected provider resolved to, when known. */
  modelLabel: string;
  /** True when the run's host had live research tools; false is a visible limitation. */
  researchToolsAvailable: boolean;
  /** Wall-clock milliseconds the run took, when known. */
  elapsedMs: number | null;
  /** Immutable runtime and effort selected when the job was queued. */
  requestedRuntime?: string;
  requestedEffort?: ModelEffort | null;
  /** Runtime and effort that actually answered. */
  actualRuntime?: string;
  modelEffort?: ModelEffort | null;
  /** Exact OpenAI-compatible model and endpoint, when the provider exposes them. */
  localModel?: { baseUrl: string; id: string } | null;
  modelId?: string;
  modelEndpoint?: string;
  runtimeProvider?: string;
};

/**
 * The whole package. `packageVersion` lets a reader tell a shape change from a
 * content change, so a package written before a field existed is not read as
 * one that filled it with nothing.
 */
export type ReportingPackage = {
  packageVersion: 1;
  /** The editor's assignment, echoed back so the copy can be judged against it. */
  assignment: string;
  action: string;
  city: string;
  /** The scan run status: COMPLETE only when the method's coverage gate passed. */
  runStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  /** A one-line reason for a PARTIAL/FAILED run, so a gap is visible. */
  runNote: string;
  meetingCoverage: MeetingCoverage[];
  actions: CoverageAction[];
  /** True when every action has a disposition and the coverage gate passed. */
  coverageComplete: boolean;
  stories: PackageStory[];
  held: PackageHeld[];
  /** The package-level score, when the run scored a lead story. */
  score: PackageScore | null;
  readinessTier: number;
  unknowns: string[];
  receipt: RunReceipt;
};

/** A blank package, for the shape a run that produced nothing still returns. */
export function emptyReportingPackage(input: {
  assignment: string;
  action: string;
  city: string;
  runStatus: ReportingPackage["runStatus"];
  runNote: string;
  receipt: RunReceipt;
}): ReportingPackage {
  return {
    packageVersion: 1,
    assignment: input.assignment,
    action: input.action,
    city: input.city,
    runStatus: input.runStatus,
    runNote: input.runNote,
    meetingCoverage: [],
    actions: [],
    coverageComplete: false,
    stories: [],
    held: [],
    score: null,
    readinessTier: 0,
    unknowns: [],
    receipt: input.receipt,
  };
}

/* ------------------------------------------------------------------ *
 * Parsing -- pure, defensive, and NEVER synthesizing.
 *
 * Every function here reads a value that a model or a stored row produced.
 * The one rule they all keep: a field that is absent, blank or the wrong
 * shape is DROPPED or defaulted to an honest empty, never guessed. A claim
 * whose status is unrecognized is UNVERIFIED (the cautious reading), not
 * VERIFIED; a source with no URL and no offline reference is dropped, because
 * a source nothing can locate is not a source.
 * ------------------------------------------------------------------ */

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The tier a source claims, defaulting to C (the least trusted) when unclear. */
export function parseSourceTier(value: unknown): SourceTier {
  const raw = str(value).toUpperCase();
  return raw === "A" || raw === "B" || raw === "C" ? raw : "C";
}

/**
 * The status a claim states. Anything the desk does not recognize reads as
 * UNVERIFIED: an unknown status must never be shown as a checked fact, and
 * "contested by the reporter" is a status in its own right, not an alias.
 */
export function parseClaimStatus(value: unknown): PackageClaimStatus {
  const raw = str(value).toUpperCase();
  if (raw === "VERIFIED") return "VERIFIED";
  if (raw === "CONTESTED") return "CONTESTED";
  return "UNVERIFIED";
}

/** A 1..5 component, or 0 for "not scored". Values outside the band are clamped. */
export function parseScoreComponent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(str(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** A readiness tier 0..3; anything else is 0 ("unstated"). */
export function parseReadinessTier(value: unknown): number {
  const n = typeof value === "number" ? value : Number(str(value));
  return n === 1 || n === 2 || n === 3 ? n : 0;
}

export function parseSource(raw: unknown): PackageSource | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const url = str(o.url);
  const offlineReference = str(o.offlineReference ?? o.offline ?? o.reference);
  // A source with neither a public URL nor an honest reference cannot be
  // checked by anyone and is not carried.
  if (!url && !offlineReference) return null;
  return {
    id,
    title: str(o.title),
    tier: parseSourceTier(o.tier),
    url,
    locator: str(o.locator ?? o.location),
    offlineReference,
  };
}

export function parseClaim(raw: unknown): PackageClaim | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text ?? o.fact);
  if (!text) return null;
  const id = str(o.id) || `C${text.length}`;
  const item = str(o.item ?? o.agendaItem);
  return {
    id,
    text,
    status: parseClaimStatus(o.status),
    sourceIds: arr(o.sourceIds ?? o.sources).map(str).filter(Boolean),
    nextCheck: str(o.nextCheck ?? o.next ?? o.receipt),
    ...(item ? { item } : {}),
  };
}

export function parseStory(raw: unknown): PackageStory | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const headline = str(o.headline);
  const draft = str(o.draft ?? o.body);
  if (!headline && !draft) return null;
  return {
    id: str(o.id) || headline.slice(0, 40),
    headline,
    draft,
    plainBrief: str(o.plainBrief ?? o.plainLanguage),
    cannotSay: str(o.cannotSay ?? o.whatCannotSay),
    readinessTier: parseReadinessTier(o.readinessTier ?? o.editorialTier ?? o.readiness),
    claims: arr(o.claims).map(parseClaim).filter((c): c is PackageClaim => c !== null),
    sources: arr(o.sourceList ?? o.sources).map(parseSource).filter((s): s is PackageSource => s !== null),
  };
}

export function parseAction(raw: unknown): CoverageAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const motionOrAction = str(o.motionOrAction ?? o.motion ?? o.action);
  if (!motionOrAction) return null;
  return {
    actionId: str(o.actionId ?? o.action_id ?? o.id),
    timestamp: str(o.timestamp) || "unknown",
    agendaItem: str(o.agendaItem ?? o.agenda_item),
    motionOrAction,
    outcome: str(o.outcome),
    // A vote is carried only if it was written down; "unverified" is the honest
    // empty, never a fabricated tally.
    vote: str(o.vote) || "unverified",
    policyStage: str(o.policyStage ?? o.policy_stage),
    evidence: str(o.evidence),
    disposition: str(o.disposition),
  };
}

export function parseMeetingCoverage(raw: unknown): MeetingCoverage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const status = str(o.coverageStatus ?? o.status).toLowerCase();
  return {
    status: str(o.status).toUpperCase() === "COMPLETE" ? "COMPLETE" : "PARTIAL",
    body: str(o.body),
    date: str(o.date),
    coverageStatus:
      status === "complete" || status === "partial" || status === "unavailable"
        ? (status as MeetingCoverage["coverageStatus"])
        : "unavailable",
    recordingUrl: str(o.recordingUrl ?? o.recording_url),
    gaps: str(o.gaps),
  };
}

export function parseHeld(raw: unknown): PackageHeld | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const headline = str(o.headline ?? o.title);
  if (!headline) return null;
  return {
    storyId: str(o.storyId ?? o.id),
    headline,
    reason: str(o.reason ?? o.details),
    nextCheck: str(o.nextCheck ?? o.agent4Target ?? o.elevate),
    unverified: o.unverified !== false,
  };
}

export function parseScore(raw: unknown): PackageScore | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const immediacy = parseScoreComponent(o.immediacy);
  const impact = parseScoreComponent(o.impact);
  const conflict = parseScoreComponent(o.conflict);
  const novelty = parseScoreComponent(o.novelty);
  if (immediacy + impact + conflict + novelty === 0) return null;
  const statedTotal = Number(o.total);
  return {
    immediacy,
    impact,
    conflict,
    novelty,
    total: Number.isFinite(statedTotal) && statedTotal > 0 ? statedTotal : immediacy + impact + conflict + novelty,
    whyItMatters: str(o.whyItMatters ?? o.why),
  };
}

export function parseReceipt(raw: unknown, fallback: RunReceipt): RunReceipt {
  if (typeof raw !== "object" || raw === null) return fallback;
  const o = raw as Record<string, unknown>;
  const local = o.localModel;
  const localModel = local && typeof local === "object" && !Array.isArray(local)
    ? local as Record<string, unknown>
    : null;
  const effort = (value: unknown, backup: ModelEffort | null | undefined): ModelEffort | null | undefined =>
    value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"
      ? value
      : backup;
  return {
    methodVersion: str(o.methodVersion) || fallback.methodVersion,
    methodDir: str(o.methodDir) || fallback.methodDir,
    mode: (str(o.mode) as CivicMode) || fallback.mode,
    modelChoice: str(o.modelChoice) || fallback.modelChoice,
    modelLabel: str(o.modelLabel) || fallback.modelLabel,
    researchToolsAvailable: o.researchToolsAvailable !== false,
    elapsedMs: typeof o.elapsedMs === "number" ? o.elapsedMs : null,
    requestedRuntime: str(o.requestedRuntime) || fallback.requestedRuntime,
    requestedEffort: effort(o.requestedEffort, fallback.requestedEffort),
    actualRuntime: str(o.actualRuntime) || fallback.actualRuntime,
    modelEffort: effort(o.modelEffort, fallback.modelEffort),
    localModel: localModel && typeof localModel.baseUrl === "string" && typeof localModel.id === "string"
      ? { baseUrl: localModel.baseUrl, id: localModel.id }
      : fallback.localModel,
    modelId: str(o.modelId) || fallback.modelId,
    modelEndpoint: str(o.modelEndpoint) || fallback.modelEndpoint,
    runtimeProvider: str(o.runtimeProvider) || fallback.runtimeProvider,
  };
}

/**
 * Read a stored (or just-produced) package. Absent fields become honest
 * empties; nothing is invented. A package that fails to parse at all is null,
 * and the caller shows "no package" rather than an empty-looking one.
 */
export function parseReportingPackage(raw: unknown): ReportingPackage | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const runStatus = str(o.runStatus).toUpperCase();
  const actionRows = arr(o.actions).map(parseAction).filter((a): a is CoverageAction => a !== null);
  const fallbackReceipt: RunReceipt = {
    methodVersion: CIVIC_SCANNER_METHOD_VERSION,
    methodDir: "",
    mode: CIVIC_REPORTING_MODE,
    modelChoice: "auto",
    modelLabel: "",
    researchToolsAvailable: true,
    elapsedMs: null,
    requestedRuntime: "",
    requestedEffort: null,
    actualRuntime: "",
    modelEffort: null,
    localModel: null,
    modelId: "",
    modelEndpoint: "",
    runtimeProvider: "",
  };
  return {
    packageVersion: 1,
    assignment: str(o.assignment),
    action: str(o.action),
    city: str(o.city),
    runStatus: runStatus === "COMPLETE" || runStatus === "FAILED" ? (runStatus as ReportingPackage["runStatus"]) : "PARTIAL",
    runNote: str(o.runNote),
    meetingCoverage: arr(o.meetingCoverage).map(parseMeetingCoverage).filter((m): m is MeetingCoverage => m !== null),
    actions: actionRows,
    coverageComplete: coverageGatePassed(actionRows, o.coverageComplete === true),
    stories: arr(o.stories ?? o.agent2_stories).map(parseStory).filter((s): s is PackageStory => s !== null),
    held: arr(o.held ?? o.heldStories).map(parseHeld).filter((h): h is PackageHeld => h !== null),
    score: parseScore(o.score),
    readinessTier: parseReadinessTier(o.readinessTier ?? o.readiness),
    unknowns: arr(o.unknowns).map(str).filter(Boolean),
    receipt: parseReceipt(o.receipt, fallbackReceipt),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The coverage gate, stated as code. It passes only when there is at least one
 * action AND every action names a disposition. A run that read nothing does not
 * "pass" an empty check -- the caller's own `coverageComplete` cannot turn a
 * ledger with undispositioned rows into a complete one.
 */
export function coverageGatePassed(actions: CoverageAction[], claimed: boolean): boolean {
  if (!claimed) return false;
  if (actions.length === 0) return false;
  return actions.every((a) => a.disposition.trim().length > 0 && a.timestamp.trim().length > 0);
}

/** Serialize for storage. Whole, unclipped -- the note columns' cap is not applied here. */
export function serializeReportingPackage(pkg: ReportingPackage): string {
  return JSON.stringify(pkg);
}

/** The package's lead story (the first packet), or null when there is none. */
export function leadStoryOf(pkg: ReportingPackage): PackageStory | null {
  return pkg.stories[0] ?? null;
}

/**
 * A one-line, editor-facing progress sentence for a reporting run. Kept beside
 * the type so the worker that reports progress and any test agree on the
 * vocabulary -- reporting language, not job-log language.
 */
export const REPORTING_STAGES = [
  "Reading the assignment",
  "Finding the reporting",
  "Reading the meeting record",
  "Checking the votes and actions",
  "Looking for contrary evidence",
  "Scoring the lead",
  "Writing the story",
  "Filing the package",
] as const;
