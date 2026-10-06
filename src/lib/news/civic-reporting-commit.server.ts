/*
  The editor-facing civic-reporting actions, behind the desk.

  WHAT THIS IS. One press -- "Report this meeting", "Develop this lead", or a
  direct town/beat/date/issue assignment -- becomes ONE `reporting_requests`
  row (the durable run workspace) plus ONE `desk_jobs` row of kind `reporting`
  whose `subject_id` is the REQUEST id, not a lead id. The runner
  (`civic-reporting-run.server.ts`) reads the request, runs the installed
  civic-scanner method, and writes the resulting package/drafts. This module
  never runs the method; it only opens the request and the job.

  WHY A SEPARATE MODULE FROM `desk.ts`. `desk.ts` is the desk's write surface
  and is already the largest file in the repo. More to the point, every one of
  these presses spends a model, so they must go through the SAME preflight,
  paper-setup refusal and rate unit the draft path uses; keeping them together
  in one small module is how that stays true as the surface grows. The server
  functions themselves are attached to `desk.ts` (the client imports them from
  there), but the logic lives here.

  WHAT IT MUST NOT DO. It must not run the method, invent a package, or write
  `reporting_packages` -- those are the runner's. It MUST NOT let a direct
  assignment name a lead id (a direct assignment has no lead yet), and it must
  not let a follow-up point at another newsroom's request (`loadReportingRequest`
  scopes by newsroom). The selected model is validated with the same
  `scanPreflight` the draft path uses; an `auto` pick is resolved and persisted
  so the queued run cannot drift to a different model between press and run.

  THE METHOD VERSION IS RECORDED HERE, ONCE. `civicReportingMethodVersion` is
  the pin (civic-reporting.ts). The runner records the directory it actually
  read; this module records the version the request was told to use, so an
  editor can later see which instructions produced the work.
*/
import { assertRate } from "./ops.ts";
import { getSql, withTransaction, type Sql } from "../db.ts";
import { probeProvider, type LocalModelOverride } from "./ai.ts";
import { scanPreflight } from "./preflight.ts";
import { paperSetUpRefusal } from "./paper-settings.ts";
import { enqueueJob, kickJobs } from "./jobs.ts";
import { initialModelRuntimeReceipt } from "./model-runtime-receipt.ts";
import { modelEffort, type ModelEffort } from "./provider-registry.ts";
import {
  effectiveStoryModelChoice,
  modelChoiceLabel,
  storyModelChoice,
  type EffectiveStoryModelChoice,
  type StoryModelChoice,
} from "./model-choice.ts";
import { parseNotes } from "./notes.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import {
  civicReportingMethodVersion,
  ensureReportingSchema,
  loadReportingRequest,
  relevantReportingObservations,
  saveReportingObservation,
  loadLeadReportingPackage,
  type RelevantReportingObservation,
} from "./civic-reporting.server.ts";
import { parseReportingPackage, type ReportingPackage } from "./civic-reporting.ts";
import { sanitizePublicUrls } from "./schema.ts";
import type { CurrentReportingDocumentChecks } from "./reporting-document-check.ts";

export type AuthenticatedEditor = { userId: string; newsroomId: number };

/**
  The identity of one reporting submission, used to coalesce an immediate
  duplicate. Every field is part of what the editor actually asked for, so two
  submissions that differ in ANY of them are different runs, not a double press.
*/
export type ReportingSubmissionIdentity = {
  userId: string;
  newsroomId: number;
  requestKind: string;
  leadId: number | null;
  parentRequestId: number | null;
  actionLabel: string;
  assignment: string;
  seedUrls: string[];
  /**
   * The exact runtime this submission is pinned to, as a canonical string.
   *
   * `model_choice` alone is NOT the pin. "Local model" can mean two different
   * servers, or two different models on one server, and "Automatic" resolves to
   * a different rung when the ladder changed; two submissions with the SAME
   * `model_choice` and different real runtimes are different runs. This string
   * covers the effective runtime, the reasoning effort, and -- for a local run
   * -- the exact base URL and model id the preflight verified. It is what the
   * request row's `model_receipt` holds, and what the lookup compares.
   */
  modelPin: string;
  researchScope: "public" | "supplied";
};

/**
  The canonical pin for the runtime a submission was resolved to.

  Two submissions collide only when they would run on the identical runtime.
  The parts are joined in a fixed order with a separator that no part can
  contain, so the string is a fingerprint, not a sentence:

    <actualRuntime>|<effort>|<baseUrl>|<modelId>

  `actualRuntime` is the resolved rung (what the effective choice collapses to),
  `effort` is the pinned reasoning depth, and the last two name the exact local
  server and model when the run is on this machine. A pure cloud run has an
  empty tail, so `sol|none||` and `sol|high||` are different -- the same named
  model at two efforts is two runs, which is the brief's rule. The four slots
  are ALWAYS present, empty string included, so this function and the SQL in
  `findOpenMatchingReportingRequest` build the identical string.
*/
export function reportingModelPin(receipt: {
  actualRuntime: string;
  modelEffort?: string | null;
  localModel?: { baseUrl: string; id: string } | null;
}): string {
  const baseUrl = receipt.localModel?.baseUrl ?? "";
  const modelId = receipt.localModel?.id ?? "";
  return `${receipt.actualRuntime}|${receipt.modelEffort ?? "none"}|${baseUrl}|${modelId}`;
}

/**
  The still-open request that matches this submission exactly, if one exists.

  "Open" means its reporting job is still `queued` or `running`: a finished run
  is a completed assignment, and re-pressing after it finished is a deliberate
  new version, not a duplicate. The caller holds the newsroom lock, so this is
  the only lookup that can win the race.
*/
export async function findOpenMatchingReportingRequest(
  sql: Sql,
  identity: ReportingSubmissionIdentity,
): Promise<number | null> {
  const [row] = await sql<{ id: number }>`
    select r.id from reporting_requests r
    join desk_jobs j
      on j.newsroom_id = r.newsroom_id and j.kind = 'reporting' and j.subject_id = r.id
    where r.newsroom_id = ${identity.newsroomId}
      and r.user_id = ${identity.userId}
      and r.request_kind = ${identity.requestKind}
      and r.lead_id is not distinct from ${identity.leadId}
      and r.parent_request_id is not distinct from ${identity.parentRequestId}
      and r.action = ${identity.actionLabel}
      and r.assignment = ${identity.assignment}
      and r.seed_urls = ${JSON.stringify(identity.seedUrls)}::jsonb
      and ${identity.modelPin} = (
        coalesce(r.model_receipt->>'actualRuntime', '') || '|' ||
        coalesce(r.model_receipt->>'modelEffort', 'none') || '|' ||
        coalesce(r.model_receipt->'localModel'->>'baseUrl', '') || '|' ||
        coalesce(r.model_receipt->'localModel'->>'id', '')
      )
      and j.research_scope = ${identity.researchScope}
      and j.status in ('queued', 'running')
      and r.run_status = 'PENDING'
    order by r.id desc
    limit 1
  `;
  return row ? Number(row.id) : null;
}

/** Which actions anchor on an existing lead, and which open a direct assignment. */
const LEAD_ACTIONS = new Set(["report-meeting", "develop-lead"]);
const DIRECT_ACTIONS: Record<string, string> = {
  "report-town": "Report a town",
  "report-beat": "Report a beat",
  "report-date": "Report a date",
  "report-issue": "Report an issue",
};
const LEAD_ACTION_LABELS: Record<string, string> = {
  "report-meeting": "Report this meeting",
  "develop-lead": "Develop this lead",
};

export type StartReportingInput = {
  action: string;
  leadId?: number;
  assignment: string;
  seedUrls?: string;
  parentRequestId?: number;
  modelChoice?: string;
  modelEffort?: ModelEffort | null;
  researchScope?: "public" | "supplied";
};

export type StartReportingResult =
    // `modelChoice` is the RESOLVED choice the run was pinned to, so it may be
  // the sentinel "configured" that `effectiveStoryModelChoice` yields for an
  // org-configured default. Widened to the effective type so the resolved
  // pin flows out to the UI verbatim instead of being narrowed to a literal.
  | { ok: true; requestId: number; jobId: number; modelChoice: EffectiveStoryModelChoice; modelLabel: string }
  | {
      ok: false;
      error: string;
      detail?: string;
      retryable?: boolean;
      kind?: string;
      modelChoice?: StoryModelChoice;
      jobId?: number;
      pending?: boolean;
    };

type InheritedReportingModelPin = {
  choice: StoryModelChoice;
  effort: ModelEffort | null;
  localModel: LocalModelOverride | null;
};

type ReportingStartDependencies = {
  probe?: typeof probeProvider;
  /** Test-only seam: suppress the post-commit queue kick in an offline test. */
  kick?: boolean;
  /** Trusted parent-request pin; never read from client input. */
  inheritedPin?: InheritedReportingModelPin;
};

type FollowUpDependencies = Pick<ReportingStartDependencies, "probe" | "kick">;

async function paperSetupRefusalFor(newsroomId: number, action: string) {
  const refusal = await paperSetUpRefusal(newsroomId, action);
  if (refusal === null) return null;
  return { ok: false as const, error: refusal, detail: "", retryable: true, kind: undefined };
}

/**
 * Resolve and pin the model for a reporting run.
 *
 * Returns either the ready choice plus its runtime receipt, or a refusal that
 * carries the desk's own setup sentence. Identical in shape and order to the
 * draft path's `resolveTechnicalPreflight`: probe, then plan an automatic
 * failover if the editor chose Automatic and the first rung is not ready,
 * then probe the planned rung. Nothing is enqueued or charged before this.
 */
async function pinReportingModel(input: {
  requested: StoryModelChoice;
  newsroomId: number;
  requestedEffort: ModelEffort | null | undefined;
  probe: typeof probeProvider;
}) {
  const probe = (choice: StoryModelChoice) => input.probe(choice, input.newsroomId, undefined, "story");
  const first = await probe(input.requested);
  if (!first.ok) {
    const ready = scanPreflight(first, input.requested);
    if (!ready.ok) {
      return {
        ok: false as const,
        kind: ready.kind,
        error: ready.guidance,
        detail: ready.detail,
        retryable: ready.retryable,
      };
    }
  }
  const effectiveChoice = first.ok ? effectiveStoryModelChoice(first.choice) : input.requested;
  if (effectiveChoice === "local-model" && (!first.ok || !first.localModel)) {
    return {
      ok: false as const,
      kind: "not-ready" as const,
      error: "The selected local model could not be pinned to its exact server and model before enqueueing.",
      detail: "Refresh the Local model list and try again. No reporting run was started.",
      retryable: true,
    };
  }
  const effectiveEffort = modelEffort(effectiveChoice, input.requestedEffort);
  return {
    ok: true as const,
    choice: effectiveChoice,
    effort: effectiveEffort,
    receipt: initialModelRuntimeReceipt({
      requestedRuntime: input.requested,
      requestedEffort: modelEffort(input.requested, input.requestedEffort),
      actualRuntime: effectiveChoice,
      actualEffort: effectiveEffort,
      localModel: first.ok ? first.localModel : undefined,
    }),
  };
}

function parseStoredModelReceipt(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function parseStoredLocalModel(value: unknown): LocalModelOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.baseUrl !== "string" || typeof row.id !== "string") return null;
  const baseUrl = row.baseUrl.trim();
  const id = row.id.trim();
  if (!baseUrl || !id) return null;
  try {
    const parsed = new URL(baseUrl);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
  } catch {
    return null;
  }
  return { baseUrl, id };
}

/**
 * Read both the original finished-run receipt and the canonical initial receipt.
 * A Local model or custom connection without its exact saved endpoint/model is
 * ambiguous; do not silently turn that continuation into Automatic.
 */
function inheritedReportingModelPin(value: unknown): InheritedReportingModelPin | null {
  const receipt = parseStoredModelReceipt(value);
  if (!receipt) return null;

  const canonicalRuntime = typeof receipt.actualRuntime === "string" ? receipt.actualRuntime : null;
  const legacyRuntime = typeof receipt.effective === "string" ? receipt.effective : null;
  if (canonicalRuntime && legacyRuntime && canonicalRuntime !== legacyRuntime) return null;
  const runtime = canonicalRuntime ?? legacyRuntime;
  if (!runtime || runtime === "auto") return null;
  const choice = storyModelChoice(runtime);
  if (choice !== runtime || choice === "auto") return null;

  const hasCanonicalEffort = Object.prototype.hasOwnProperty.call(receipt, "modelEffort");
  const hasLegacyEffort = Object.prototype.hasOwnProperty.call(receipt, "effort");
  if (!hasCanonicalEffort && !hasLegacyEffort) return null;
  const rawEffort = hasCanonicalEffort ? receipt.modelEffort : receipt.effort;
  const effort: ModelEffort | null = rawEffort === null
    ? null
    : rawEffort === "none" || rawEffort === "low" || rawEffort === "medium" ||
        rawEffort === "high" || rawEffort === "xhigh" || rawEffort === "max"
      ? rawEffort
      : null;
  if (rawEffort !== null && effort === null) return null;

  const hasLocalModel = Object.prototype.hasOwnProperty.call(receipt, "localModel");
  const localModel = hasLocalModel ? parseStoredLocalModel(receipt.localModel) : null;
  if (hasLocalModel && !localModel) return null;
  if ((choice === "local-model" || choice.startsWith("custom:")) && !localModel) return null;

  return { choice, effort, localModel };
}

function pinInheritedReportingModel(
  inheritedPin: InheritedReportingModelPin,
  requestedEffort: ModelEffort | null | undefined,
) {
  const effort = requestedEffort == null
    ? inheritedPin.effort
    : modelEffort(inheritedPin.choice, requestedEffort, inheritedPin.localModel?.id);
  return {
    ok: true as const,
    choice: inheritedPin.choice,
    effort,
    receipt: initialModelRuntimeReceipt({
      requestedRuntime: inheritedPin.choice,
      requestedEffort: effort,
      actualRuntime: inheritedPin.choice,
      actualEffort: effort,
      localModel: inheritedPin.localModel,
    }),
  };
}

/**
 * Open a reporting run for an authenticated editor and queue its job.
 *
 * The request row is the durable record of what was asked for: the action, the
 * editor's words, the seed URLs, and the pinned method version and model. The
 * job is the durable record of the run, keyed by the REQUEST id (`subject_id`),
 * so a follow-up -- a new request -- is a new job and can never coalesce onto
 * the run it continues. The request and its job are created in ONE transaction
 * under the newsroom lock (see the body below), and the SAME identity is reused
 * on a second identical press, so a double-click returns the first run's ids
 * rather than opening a second one.
 */
export async function startReportingForAuthenticatedEditor(
  context: AuthenticatedEditor,
  input: StartReportingInput,
  /**
   * Test seam: the model probe this press uses to resolve and pin the runtime.
   * Defaults to the real provider probe. A test passes a stub so it can drive
   * the real submission path -- the transaction, the lock, the lookup, the job
   * enqueue -- without a provider or the network. Production callers omit it.
   */
  deps: ReportingStartDependencies = {},
): Promise<StartReportingResult> {
  const refusal = await paperSetupRefusalFor(context.newsroomId, "start a reporting run");
  if (refusal) return refusal;

  const sql = await getSql();
  await ensureReportingSchema(sql);

  const action = input.action;
  const anchorsLead = LEAD_ACTIONS.has(action);
  const directLabel = DIRECT_ACTIONS[action];
  if (!anchorsLead && !directLabel) {
    return { ok: false as const, error: "That reporting action is not one the desk knows." };
  }
  if (anchorsLead && !input.leadId) {
    return { ok: false as const, error: "This action reports on an existing lead, but no lead was named." };
  }
  if (!anchorsLead && input.leadId) {
    return {
      ok: false as const,
      error: "A direct assignment files its own lead, so it does not take an existing one.",
    };
  }

  /*
    A follow-up must continue a run in THIS newsroom. `loadReportingRequest`
    scopes by newsroom, so a request id from another paper resolves to null and
    is refused here -- the parent can never leak across newsrooms.
  */
  let parent: { id: number } | null = null;
  if (input.parentRequestId) {
    const row = await loadReportingRequest(sql, input.parentRequestId, context.newsroomId);
    if (!row) return { ok: false as const, error: "That reporting run is not in this newsroom." };
    parent = { id: row.id };
  }

  let leadId: number | null = null;
  if (anchorsLead && input.leadId) {
    const [lead] = await sql<{ id: number; status: string; notes_json: string | null }>`
      select id, status, to_jsonb(leads)->>'notes_json' as notes_json from leads
      where id = ${input.leadId} and newsroom_id = ${context.newsroomId} limit 1
    `;
    if (!lead) return { ok: false as const, error: "That lead is not in this newsroom." };
    if (lead.status === "killed") return { ok: false as const, error: "Restore this lead before reporting on it." };
    leadId = lead.id;
  }

  const researchScope =
    input.researchScope ?? (leadId ? parseNotes((await sql<{ notes_json: string | null }>`
      select to_jsonb(leads)->>'notes_json' as notes_json from leads
      where id = ${leadId} and newsroom_id = ${context.newsroomId} limit 1
    `)[0]?.notes_json ?? null).researchScope : undefined) ?? "public";

  const inheritedPin = deps.inheritedPin;
  const requested = inheritedPin?.choice ?? storyModelChoice(input.modelChoice);
  const pinned = inheritedPin
    ? pinInheritedReportingModel(inheritedPin, input.modelEffort)
    : await pinReportingModel({
        requested,
        newsroomId: context.newsroomId,
        requestedEffort: input.modelEffort,
        probe: deps.probe ?? probeProvider,
      });
  if (!pinned.ok) return pinned;

  await assertRate(context.userId, "reporting", context.newsroomId);

  /*
    Seed sources are free text -- one URL per line, or a few separated by
    spaces. Each is checked to be a public http(s) URL by the same
    `sanitizePublicUrls` the import path uses, so a pasted paragraph is not
    stored as a "source" and an invented scheme is dropped, not carried. The
    list is capped: this is the seeds an editor typed, not a crawl list.
  */
  const seedUrls = sanitizePublicUrls(
    (input.seedUrls ?? "")
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean),
  ).slice(0, 30);
  const requestKind = anchorsLead ? (action === "report-meeting" ? "meeting" : "lead") : "assignment";
  const actionLabel = anchorsLead ? LEAD_ACTION_LABELS[action] : (directLabel as string);

  /*
    AN IMMEDIATE DUPLICATE IS COALESCED, NOT DUPLICATED.

    WHAT WAS WRONG. Every press inserted a NEW reporting_requests row in one
    transaction and then queued the job in a SECOND one, outside it. The
    `findOpenJob` that ran in between was scoped to the brand-new request id, so
    it could only ever see the row this press had created. Worse, the request
    lookup joins `desk_jobs`: a second identical press could take the lock after
    the first request had committed but before the first job had, find no job,
    and open a duplicate request and a duplicate run.

    WHAT IT DOES NOW. The lookup AND the request insert AND the job insert are
    ONE transaction. It takes the newsroom's `paper_settings` row `for update`
    first, so two simultaneous presses serialize here; then it looks for a
    still-open request with the SAME identity and, on a match, reuses it. The
    job is enqueued on the same transaction (`enqueueJob`'s `sql` option), so the
    request row and its job commit together -- a worker draining between the two
    is impossible, and the second press sees the first press's JOB as well as its
    request. A DELIBERATE follow-up or a second assignment after the first has
    finished has a different parent/assignment/scope, or no open request to
    match, so it still opens a new version.

    The identity includes the request's `model_receipt` PIN, not just
    `model_choice`: the effective runtime, the reasoning effort, and the exact
    local server/model. A re-press after the editor changed any of those is a
    different run, and the reused request keeps the pin it was created with.
  */
  const identity = {
    userId: context.userId,
    newsroomId: context.newsroomId,
    requestKind,
    leadId,
    parentRequestId: parent?.id ?? null,
    actionLabel,
    assignment: input.assignment,
    seedUrls,
    modelPin: reportingModelPin(pinned.receipt),
    researchScope,
  };
  const submission = await withTransaction(async (tx) => {
    /*
      Serialize on the newsroom's own settings row: it exists for every
      newsroom, it is the same row `paperSetUpRefusal` already reads on this
      path, and locking it needs no advisory-lock support and no new schema.
      Direct assignments have no lead row to lock, so this is the one point
      that covers both lead-anchored and direct submissions.
    */
    await tx`
      insert into paper_settings (newsroom_id) values (${context.newsroomId})
      on conflict (newsroom_id) do nothing
    `;
    await tx`
      select newsroom_id from paper_settings where newsroom_id = ${context.newsroomId} for update
    `;
    const existing = await findOpenMatchingReportingRequest(tx, identity);
    let requestId = existing;
    if (requestId == null) {
      const [created] = await tx<{ id: number }>`
        insert into reporting_requests
          (user_id, newsroom_id, request_kind, lead_id, parent_request_id, action, assignment,
           seed_urls, model_choice, method_version, model_receipt, run_status)
        values
          (${context.userId}, ${context.newsroomId}, ${requestKind}, ${leadId}, ${parent?.id ?? null},
           ${actionLabel}, ${input.assignment}, ${JSON.stringify(seedUrls)}::jsonb,
           ${pinned.choice}, ${civicReportingMethodVersion}, ${JSON.stringify(pinned.receipt)}::jsonb, ${"PENDING"})
        returning id
      `;
      requestId = created.id;
    }
    /*
      The job is enqueued on THIS transaction, so it commits with the request.
      `enqueueJob` returns the open job for the subject when one already exists
      (the fresh-request path always creates it; the reuse path returns the run
      already in flight), which is exactly the double-press answer.
    */
    const job = await enqueueJob({
      userId: context.userId,
      newsroomId: context.newsroomId,
      kind: "reporting",
      subjectId: requestId,
      modelChoice: pinned.choice,
      modelChoiceSource: requested === "auto" ? "auto" : "editor",
      researchScope,
      resultJson: JSON.stringify({
        requestId,
        ...pinned.receipt,
        ...(input.researchScope ? { researchScope: input.researchScope } : {}),
      }),
      sql: tx,
    });
    return { requestId, job };
  });

  /*
    Wake the drain only AFTER the transaction commits. `enqueueJob` suppressed
    its own kick because it ran on this transaction, so the one and only kick
    for a reporting press happens here -- when the request and its job are both
    durable and a worker that starts now will actually find them. A fixture
    that never wants a real drain passes `kick: false`.
  */
  if (deps.kick !== false) kickJobs();

  return {
    ok: true as const,
    requestId: submission.requestId,
    jobId: submission.job.id,
    modelChoice: effectiveStoryModelChoice(pinned.choice),
    modelLabel: modelChoiceLabel(pinned.choice),
  };
}

/**
 * A follow-up run: targeted work against a run the editor already has, with
 * the parent pinned to this newsroom. The follow-up never overwrites the run
 * it continues -- it is a new request row pointing at the old one, and the
 * runner saves its result as a new version.
 */
export async function answerReportingFollowUp(
  context: AuthenticatedEditor,
  input: {
    parentRequestId: number;
    assignment: string;
    seedUrls?: string;
    modelChoice?: string;
    modelEffort?: ModelEffort | null;
    researchScope?: "public" | "supplied";
  },
  dependencies: FollowUpDependencies = {},
): Promise<StartReportingResult> {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  const parent = await loadReportingRequest(sql, input.parentRequestId, context.newsroomId);
  if (!parent) return { ok: false as const, error: "That reporting run is not in this newsroom." };

  const [parentJob] = await sql<{ research_scope: string }>`
    select research_scope from desk_jobs
    where newsroom_id = ${context.newsroomId} and kind = 'reporting' and subject_id = ${parent.id}
    order by id desc limit 1
  `;
  const parentScope = parentJob?.research_scope === "public" || parentJob?.research_scope === "supplied"
    ? parentJob.research_scope
    : undefined;
  const researchScope = input.researchScope ?? parentScope;
  if (!researchScope) {
    return { ok: false as const, error: "This reporting run has no saved research scope to continue." };
  }

  const explicitModelChoice = input.modelChoice?.trim() ? input.modelChoice : undefined;
  const inheritedPin = explicitModelChoice ? undefined : inheritedReportingModelPin(parent.model_receipt);
  if (!explicitModelChoice && !inheritedPin) {
    return {
      ok: false as const,
      error: "This reporting run's saved model pin is incomplete. Choose a model explicitly to continue.",
    };
  }
  const seedUrls = input.seedUrls?.trim()
    ? input.seedUrls
    : parseSeedUrls(parent.seed_urls).join("\n");

  return startReportingForAuthenticatedEditor(context, {
    action: parent.lead_id ? "develop-lead" : "report-issue",
    leadId: parent.lead_id ?? undefined,
    assignment: input.assignment,
    seedUrls,
    parentRequestId: parent.id,
    modelChoice: explicitModelChoice,
    modelEffort: input.modelEffort,
    researchScope,
  }, {
    ...dependencies,
    ...(inheritedPin ? { inheritedPin } : {}),
  });
}

/**
 * The editor's dated, sourced correction or disposition for a later relevant
 * assignment. This is the ONLY observation write the desk makes; it requires
 * scope (a request or lead in this newsroom) and evidence, and it changes no
 * model prompt. It records what the editor decided, dated, so the next
 * assignment can retrieve it.
 */
export async function saveReportingCorrection(
  context: AuthenticatedEditor,
  input: {
    requestId?: number;
    leadId?: number;
    kind: "correction" | "disposition" | "source";
    text: string;
    evidence: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  if (!input.requestId && !input.leadId) {
    return { ok: false, error: "Name the reporting run or lead this correction is about." };
  }
  if (input.requestId) {
    const row = await loadReportingRequest(sql, input.requestId, context.newsroomId);
    if (!row) return { ok: false, error: "That reporting run is not in this newsroom." };
  }
  if (input.leadId) {
    const [row] = await sql<{ id: number }>`
      select id from leads where id = ${input.leadId} and newsroom_id = ${context.newsroomId}
    `;
    if (!row) return { ok: false, error: "That lead is not in this newsroom." };
  }
  await saveReportingObservation(sql, {
    newsroomId: context.newsroomId,
    userId: context.userId,
    requestId: input.requestId ?? null,
    leadId: input.leadId ?? null,
    kind: input.kind,
    text: input.text,
    evidence: input.evidence,
  });
  return { ok: true };
}

/**
 * Where each story in a run landed, read back from the run's own job result.
 *
 * WHY THIS IS HERE AND NOT IN THE PANEL. The runner records `result_json` as
 * `{ leadIds, filed: [{ storyId, leadId, draftId, created }] }` on the job row
 * (finishJob, civic-reporting-run.server.ts). A story packet itself carries no
 * lead id -- a story is the method's idea, and the lead is what the DESK filed
 * for it -- so the only honest way to give an editor an "Open this story" link
 * is to read that mapping back. It lives on the server because `result_json`
 * must never reach the client bundle, and it is SCOPED to the request and the
 * newsroom so a story id from another paper's run can never resolve.
 *
 * A story the runner could not file (no lead created) simply has no entry; the
 * panel then draws no link rather than a link to the wrong lead.
 */
export type StoryLeadLink = { storyId: string; leadId: number; draftId: number | null };

export async function storyLeadLinksForRequest(
  sql: Sql,
  requestId: number,
  newsroomId: number,
): Promise<StoryLeadLink[]> {
  const [row] = await sql<{ result_json: string }>`
    select result_json from desk_jobs
    where newsroom_id = ${newsroomId} and kind = 'reporting' and subject_id = ${requestId}
    order by id desc limit 1
  `;
  if (!row?.result_json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.result_json);
  } catch {
    return [];
  }
  const filed = (parsed as { filed?: unknown })?.filed;
  if (!Array.isArray(filed)) return [];
  const out: StoryLeadLink[] = [];
  for (const entry of filed) {
    const storyId = typeof (entry as { storyId?: unknown })?.storyId === "string" ? (entry as { storyId: string }).storyId : "";
    const leadId = Number((entry as { leadId?: unknown })?.leadId);
    if (!storyId || !Number.isInteger(leadId) || leadId <= 0) continue;
    const draftId = Number((entry as { draftId?: unknown })?.draftId);
    out.push({ storyId, leadId, draftId: Number.isInteger(draftId) && draftId > 0 ? draftId : null });
  }
  return out;
}

/** The structured package for a lead, scoped to this newsroom. Null when none. */
export async function loadLeadReportingPackageForEditor(
  context: AuthenticatedEditor,
  leadId: number,
): Promise<{
  requestId: number;
  draftId: number | null;
  pkg: ReportingPackage;
  currentDocumentChecks: CurrentReportingDocumentChecks;
  storyLeads: StoryLeadLink[];
  latestRun: { requestId: number; status: string; error: string | null; assignment: string } | null;
  /**
   * The seed URLs the run was opened with, read from its own request row.
   * The panel uses these to scope "records kept for the next assignment" to
   * the sources this assignment named, so a correction is surfaced only when
   * it is actually relevant to the run on screen.
   */
  seedUrls: string[];
} | null> {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  const [row] = await sql<{ id: number }>`
    select id from leads where id = ${leadId} and newsroom_id = ${context.newsroomId} limit 1
  `;
  if (!row) return null;
  const loaded = await loadLeadReportingPackage(sql, leadId, context.newsroomId);
  if (!loaded) return null;
  const storyLeads = await storyLeadLinksForRequest(sql, loaded.requestId, context.newsroomId);
  /*
    Seeds are stored as a jsonb array of strings on the request. Read them
    back defensively: a malformed legacy value yields no seeds rather than
    throwing on this story read.
  */
  const [requestRow] = await sql<{ seed_urls: unknown }>`
    select seed_urls from reporting_requests
    where id = ${loaded.requestId} and newsroom_id = ${context.newsroomId} limit 1
  `;
  const seedUrls = parseSeedUrls(requestRow?.seed_urls);
  const [latest] = await sql<{ id: number; run_status: string; error: string | null; assignment: string }>`
    select id, run_status, error, assignment from reporting_requests
    where newsroom_id = ${context.newsroomId} and lead_id = ${leadId}
    order by created_at desc, id desc limit 1
  `;
  const latestRun = latest ? { requestId: Number(latest.id), status: latest.run_status, error: latest.error, assignment: latest.assignment } : null;
  const { loadCurrentReportingDocumentChecks } = await import("./reporting-document-check.server.ts");
  const currentDocumentChecks = await loadCurrentReportingDocumentChecks(sql, context.newsroomId, loaded.requestId);
  return { ...loaded, storyLeads, seedUrls, latestRun, currentDocumentChecks };
}

/** Coerce a request's `seed_urls` jsonb into a clean string list. */
function parseSeedUrls(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((url): url is string => typeof url === "string")
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
  Observations relevant to ONE assignment, for the story page's "records kept
  for the next assignment" list.

  WHAT CHANGED AND WHY. This used to call `recentReportingObservations(newsroomId)`,
  which returned the newest observations for the whole newsroom -- so every
  story showed the same unrelated editor corrections, and a correction filed
  against one lead leaked onto every other lead in the paper. The panel now
  passes the scope it is actually looking at (this lead, this run's parent
  request, and this run's seed sources), and the storage worker answers with
  only the observations that belong to that scope. Scope is REQUIRED: an
  unscoped read is no longer reachable from the desk, so there is no way to
  leak unrelated correction context by omitting an argument.
*/
export async function listReportingObservations(
  context: AuthenticatedEditor,
  scope: { leadId?: number | null; requestId?: number | null; seedUrls?: string[] },
): Promise<RelevantReportingObservation[]> {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  return relevantReportingObservations(sql, {
    newsroomId: context.newsroomId,
    leadId: scope.leadId ?? null,
    parentRequestId: scope.requestId ?? null,
    seedUrls: scope.seedUrls ?? [],
  });
}

/**
 * Stop a reporting run the editor started. The request row is the durable
 * record; cancelling flips only the job, which the existing desk_jobs machinery
 * owns (fencing, heartbeat). Returns whether an open job was found to cancel;
 * a request whose job already finished is left as it is.
 */
export async function cancelReportingRequest(
  context: AuthenticatedEditor,
  requestId: number,
): Promise<{ ok: boolean; error?: string }> {
  const sql = await getSql();
  await ensureReportingSchema(sql);
  const run = await loadReportingRequest(sql, requestId, context.newsroomId);
  if (!run) return { ok: false, error: "That reporting run is not in this newsroom." };
  const [job] = await sql<{ id: number }>`
    select id from desk_jobs
    where newsroom_id = ${context.newsroomId} and kind = 'reporting' and subject_id = ${requestId}
      and status in ('queued','running')
    order by id desc limit 1
  `;
  if (!job) return { ok: false, error: "That run has already finished." };
  const { requestJobCancel } = await import("./jobs.ts");
  await requestJobCancel(job.id);
  return { ok: true };
}

export { parseReportingPackage, DEFAULT_NEWSROOM_ID };
export type { ReportingPackage };
