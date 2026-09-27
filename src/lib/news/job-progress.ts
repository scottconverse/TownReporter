import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { effectiveStoryModelChoice, modelChoiceLabel, storyModelChoice } from "./model-choice.ts";
import {
  jobStages,
  requestJobCancel,
  type DeskJob,
  type JobKind,
  type JobStatus,
} from "./jobs.ts";
/*
  The failover planner and the provider probe are imported inside the retry
  handler rather than here. This module is imported by a client component, so
  everything at its top level is in the CLIENT bundle graph too: `ai.ts` reaches
  the provider adapters, and pulling those in to satisfy a server-only handler
  would ship the whole toolchain to the browser. The types are erased, so only
  the runtime values have to wait.
*/

/**
 * The desk's own view of a job in progress, shaped for the JobCard.
 *
 * This is deliberately NOT `DeskJob`. The card is a client component and the
 * row is a database row: timestamps arrive as strings, the model arrives as
 * `"auto"`, the stage list arrives as JSON text, and `result_json` is a blob
 * the card must never see. One mapping on the server keeps every one of those
 * out of the client, and keeps the card a pure function of what it is handed.
 *
 * Times are epoch milliseconds because the two things the card does with them
 * are subtract them from `Date.now()` (the elapsed clock, the stall rule) and
 * neither of those is a date. A client that has to parse a Postgres timestamp
 * to ask "has this been quiet for 60 seconds" will eventually get it wrong on
 * a machine in another timezone.
 */
export type JobProgressView = {
  id: number;
  leadId: number;
  kind: JobKind;
  status: JobStatus;
  /** The card's bold line: what this job is doing, in the editor's words. */
  title: string;
  /** Resolved provider label ("Codex Sol", "Local model"), never "auto". */
  model: string;
  stages: string[] | null;
  stageIndex: number | null;
  pct: number | null;
  /** The one-line "now" step. Falls back to the legacy `stage` sentence. */
  step: string;
  startedAt: number | null;
  endedAt: number | null;
  beatAt: number | null;
  error: string | null;
  /** Where the Done card's Open button goes. Already a route the app serves. */
  resultHref: string | null;
  /**
   * The same destination as an id. The router is typed, so a screen navigates
   * with `params`, not with `resultHref` -- but `resultHref` is still what the
   * server decided and what anything without a router (a test, a notification
   * email, a future link) should read, so both travel.
   */
  resultDraftId: number | null;
  /** The Done card's sentence. Never derived from `step`, which is the last
      thing the worker was doing, not what the editor now has. */
  doneText: string;
  /** The Done card's button label. */
  openLabel: string;
  failoverNote: string;
  /** The editor has pressed Cancel and the worker has not stopped yet. */
  cancelRequested: boolean;
  /** False when this row's request is not reproducible from the row alone. */
  canRetry: boolean;
};

const TITLES: Partial<Record<JobKind, string>> = {
  draft: "Drafting story",
  reconcile: "Checking the draft against the evidence",
  "follow-up": "Running the check",
};

const DONE_TEXT: Partial<Record<JobKind, string>> = {
  draft: "Your draft is ready",
  reconcile: "The evidence check is done",
  "follow-up": "The check is done",
};

const OPEN_LABEL: Partial<Record<JobKind, string>> = {
  draft: "Open the draft",
  reconcile: "Open the checked draft",
  "follow-up": "Open the follow-up",
};

const ms = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * The fields every kind of job shares, mapped once.
 *
 * Two kinds are drawn by this module now -- a story job (draft, reconcile) and
 * an agent's run -- and the fifteen fields below are identical between them.
 * They were duplicated for a while; the second copy is what this replaces, so a
 * change to how a percentage or a heartbeat is read cannot land on one card and
 * miss the other.
 */
type ProgressShape = Omit<
  JobProgressView,
  "leadId" | "title" | "doneText" | "openLabel" | "resultHref" | "resultDraftId" | "canRetry"
>;

function progressShape(row: DeskJob, model: string): ProgressShape {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    model,
    stages: jobStages(row),
    stageIndex: row.stage_index ?? null,
    pct: row.pct ?? null,
    /*
      `step_text` first, `stage` second. `stage` is the older column and is
      still written at every boundary, so a row that predates 0099 -- or one
      whose kind never reports a step -- still has a sentence to show rather
      than an empty line under the bar.
    */
    step: row.step_text || row.stage || (row.status === "queued" ? "Waiting to start…" : "Working…"),
    startedAt: ms(row.started_at),
    endedAt: ms(row.finished_at),
    beatAt: ms(row.beat_at),
    error: row.error ?? null,
    failoverNote: row.failover_note ?? "",
    cancelRequested: (row.status === "queued" || row.status === "running") && Boolean(row.cancel_requested),
  };
}

/**
 * A `desk_jobs` row as the card needs it. Exported so a route that already has
 * the row from its own loader can render the first paint from it instead of
 * waiting a round trip for the poll -- a story that is running must not lose
 * its progress bar for one frame because the card moved to a live query.
 */
export function jobProgressView(row: DeskJob, leadId: number, draftId: number | null): JobProgressView {
  const kind = row.kind;
  return {
    ...progressShape(row, modelChoiceLabel(effectiveStoryModelChoice(row.model_choice))),
    leadId,
    title: TITLES[kind] ?? row.kind,
    resultHref:
      row.result_href ??
      (kind === "draft" || kind === "reconcile"
        ? draftId
          ? `/desk/story/draft/${draftId}`
          : `/desk/story/${leadId}`
        : null),
    resultDraftId: draftId,
    doneText: DONE_TEXT[kind] ?? "Done",
    openLabel: OPEN_LABEL[kind] ?? "Open result",
    /*
      Retry re-runs the request the row describes, so it is only offered for the
      two kinds whose request IS the row: a lead and a model choice. Every other
      kind's payload lives somewhere else (an editorial request row, a captured
      meeting, a stored PDF) and re-enqueueing from the job row would run
      something the editor did not ask for. Better no button than a button that
      guesses.
    */
    canRetry: kind === "draft" || kind === "reconcile",
  };
}

/**
 * A `follow-up` job as the card needs it -- the live Job the drawn Running card
 * shows inline.
 *
 * `leadId` is 0 and not the job's `subject_id`: a follow-up job's subject is a
 * `follow_ups` id, and handing a story-card that number would be a plausible
 * looking wrong lead. Nothing in JobCard.tsx reads the field (the route passes
 * what it needs through `onNavigate`), so 0 is the honest "not a story".
 *
 * `resultHref` is null and `canRetry` is false for the same reason: a run has
 * no page of its own to open, and its request lives in the follow-up row rather
 * than in the job -- "Run now" on the card is the retry, through the path that
 * claims the row and honors the fences.
 *
 * The model label is passed in rather than computed, because the follow-up's
 * model comes from the phase 5 `follow-up` job key, which the caller resolves
 * with the same `resolveFollowUpModel` the worker uses. Reading the story
 * default here would put a model name on the card that the run may not use.
 */
export function followUpJobProgressView(row: DeskJob, model: string): JobProgressView {
  return {
    ...progressShape(row, model),
    leadId: 0,
    title: TITLES["follow-up"] ?? "Running the check",
    resultHref: null,
    resultDraftId: null,
    doneText: DONE_TEXT["follow-up"] ?? "The check is done",
    openLabel: OPEN_LABEL["follow-up"] ?? "Open the follow-up",
    canRetry: false,
  };
}

/**
 * A running follow-up job, keyed by the follow-up card it belongs to.
 *
 * The card is the unit here, not the job: the screen draws one card per
 * `follow_ups` row and a running one needs the live Job inside it, so the
 * caller looks up its own row's id and finds either a view or nothing. A job
 * whose follow-up has been deleted is dropped rather than returned with a
 * guessed card.
 */
export type FollowUpJobProgress = {
  /** The `follow_ups` id this job's `subject_id` is. */
  followUpId: number;
  view: JobProgressView;
};

/**
 * The follow-up runs in flight in this newsroom -- normally zero or one, since
 * `tickFollowUpsFor` enqueues at most one and refuses to start another while one
 * is open.
 *
 * The model label comes from the SAME `resolveFollowUpModel` the worker uses,
 * resolved at read time. It has to be resolved rather than read off the row:
 * `model_choice` is `auto` for most follow-ups, and the whole point of the
 * phase 5 assignment table is that `auto` means different models on different
 * surfaces. A card that showed "Automatic" while the run uses Codex would be
 * telling the editor something the run is not doing.
 */
export const listFollowUpJobProgress = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<FollowUpJobProgress[]> => {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const sql = await getSql();
    const newsroomId = context.newsroomId ?? 1;
    const rows = await sql<DeskJob>`
      select * from desk_jobs
      where newsroom_id = ${newsroomId} and kind = 'follow-up'
        and status in ('queued', 'running')
      order by id desc
      limit 20
    `;
    if (!rows.length) return [];
    /*
      Both imports are inside the handler for the reason the file's header
      gives: this module is in the client bundle graph, and `follow-ups.ts`
      reaches PGlite and `follow-up-agents.ts` reaches the provider adapters.
      Neither can be a top-level import here.
    */
    const [{ performReadFollowUp }, { resolveFollowUpModel }] = await Promise.all([
      import("./follow-ups.ts"),
      import("./follow-up-agents.ts"),
    ]);
    const out: FollowUpJobProgress[] = [];
    for (const row of rows) {
      const followUp = await performReadFollowUp(context, row.subject_id);
      if (!followUp) continue;
      // A resolution failure is a label problem, not a card problem: the run is
      // real and its progress bar is worth showing, so it falls back to the
      // resolver's own word for "no opinion" rather than dropping the card.
      const resolved = await resolveFollowUpModel(followUp).catch(() => null);
      out.push({
        followUpId: row.subject_id,
        view: followUpJobProgressView(row, modelChoiceLabel(resolved?.providerId ?? "auto")),
      });
    }
    return out;
  });

/**
 * The newsroom's recent story work, newest first.
 *
 * Deliberately small and unordered in the database: the desk shows at most a
 * handful of these at once, and every screen that uses it wants a different
 * slice (one lead, or everything running). Sorting and slicing on the client is
 * what keeps this one query rather than three, which is what "fed by one
 * `useDeskJobs()`" asks for.
 *
 * `finished` rows are included, not just open ones, because the card has to be
 * able to show Done and Failed -- a query that only ever returned running jobs
 * would make two of the design's three states unreachable.
 */
export const listStoryJobProgress = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<JobProgressView[]> => {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const sql = await getSql();
    const newsroomId = context.newsroomId ?? 1;
    const rows = await sql<DeskJob & { lead_id: number; draft_id: number | null }>`
      select j.*, j.subject_id as lead_id,
        (select d.id from drafts d
          where d.lead_id = j.subject_id and d.newsroom_id = j.newsroom_id
          order by d.updated_at desc, d.id desc limit 1) as draft_id
      from desk_jobs j
      where j.newsroom_id = ${newsroomId}
        and j.kind in ('draft', 'reconcile')
      order by j.id desc
      limit 20
    `;
    return rows.map((row) => jobProgressView(row, row.lead_id, row.draft_id));
  });

/**
 * The editor pressed Cancel. This only writes the flag: the worker is what
 * stops, at its next boundary, and `executeJob` is what records the reason. A
 * job whose process has already died will never see the flag, which is exactly
 * why the card offers Retry beside this button rather than pretending the press
 * is guaranteed to land.
 */
export const cancelStoryJob = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => {
    const jobId = Number((input as { jobId?: unknown })?.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("A job id is required.");
    return { jobId };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const sql = await getSql();
    const owned = await sql<{ id: number }>`
      select id from desk_jobs
      where id = ${data.jobId} and newsroom_id = ${context.newsroomId ?? 1}
    `;
    if (!owned[0]) throw new Error("That job is not in this newsroom.");
    await requestJobCancel(data.jobId);
    return { ok: true };
  });

/**
 * Retry, and Retry on another model.
 *
 * Both go through the SAME entry points that created the job in the first
 * place -- `commitStoryDraftForAuthenticatedEditor` for a draft,
 * `requestDraftReconciliation` for a reconcile -- so a retried job is an
 * ordinary job of its kind and inherits everything those paths already do
 * (preflight, the one-open-job index, the queue). There is deliberately no
 * second retry mechanism here.
 *
 * `nextModel` is the design's second button, and it is not a different kind of
 * retry: it asks the EXISTING automatic-failover planner which rung to move to
 * and then runs the same retry on that rung. When the planner has no rung left
 * the call reports that instead of quietly retrying the model that just failed,
 * because a button that does nothing visible is worse than one that says why.
 */
export const retryStoryJob = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: unknown) => {
    const raw = input as { jobId?: unknown; nextModel?: unknown } | null;
    const jobId = Number(raw?.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("A job id is required.");
    return { jobId, nextModel: Boolean(raw?.nextModel) };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; model: string }> => {
    const sql = await getSql();
    const newsroomId = context.newsroomId ?? 1;
    const [row] = await sql<DeskJob>`
      select * from desk_jobs
      where id = ${data.jobId} and newsroom_id = ${newsroomId}
    `;
    if (!row) throw new Error("That job is not in this newsroom.");
    if (row.kind !== "draft" && row.kind !== "reconcile") {
      throw new Error("This job's request is not stored with the job, so it cannot be retried here.");
    }
    const leadId = row.subject_id;
    let choice = storyModelChoice(row.model_choice);
    let label = modelChoiceLabel(effectiveStoryModelChoice(choice));
    if (data.nextModel) {
      const [{ planAutomaticFailover }, { probeProvider }] = await Promise.all([
        import("./automatic-failover.ts"),
        import("./ai.ts"),
      ]);
      const plan = await planAutomaticFailover({
        source: row.model_choice_source ?? "editor",
        current: row.model_choice,
        /*
          The failure that stopped this job is the reason to move on. A row with
          no error (a cancel) still gets a plan: the editor pressing "Retry on
          another model" IS the reason, and `planAutomaticFailover` only refuses
          when the error itself is not a technical failure it knows how to
          answer.
        */
        error: row.error || "the previous model did not answer",
        probe: (candidate) => probeProvider(candidate, newsroomId, undefined, "story"),
      });
      if (!plan) {
        throw new Error(
          "No other model is available to try for this job. Pick one on the story's Model & research panel.",
        );
      }
      choice = plan.next;
      label = plan.label;
    }
    const context2 = { userId: context.userId, newsroomId };
    if (row.kind === "reconcile") {
      const { requestDraftReconciliation } = await import("./draft-reconcile.server.ts");
      await requestDraftReconciliation(context2, { leadId, modelChoice: choice });
    } else {
      const { commitStoryDraftForAuthenticatedEditor } = await import("./model-request-commit.server.ts");
      const result = await commitStoryDraftForAuthenticatedEditor({
        context: context2,
        leadId,
        modelChoice: choice,
        modelEffort: null,
        researchScope: row.research_scope === "supplied" ? "supplied" : undefined,
      });
      /*
        The commit path REFUSES by returning, not by throwing (a killed lead, a
        provider that is not ready), and every one of those refusals already
        carries the sentence the editor needs. Swallowing it here would leave the
        card showing the old failure as though the press had done nothing.
      */
      if (!result.ok) throw new Error(result.error);
    }
    return { ok: true, model: label };
  });
