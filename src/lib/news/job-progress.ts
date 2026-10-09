import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { effectiveStoryModelChoice, modelChoiceLabel, storyModelChoice } from "./model-choice.ts";
import type { ModelEffort } from "./provider-registry.ts";
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
  /**
   * The row's `subject_id`, uninterpreted -- what this job is ABOUT.
   *
   * FB7, item 2. What the subject MEANS depends on the kind: for a draft or a
   * reconcile it is a lead, for a `dark`, `brief` or `challenge` it is an investigation,
   * and for an `artifact-ocr` it is the artifact whose pages are being read.
   * `leadId` above is the story-card view of the same column and is 0 for
   * every kind that is not a story -- which is exactly why a screen cannot use
   * it to ask "is this job about the file I am looking at?". The Dark Desk
   * needs that question answered to place the dig round's, the brief's and the
   * PDF read's cards beside their own controls, and a card drawn for the wrong
   * file is the plausible-looking wrong answer this module exists to avoid.
   *
   * Deliberately not named `leadId` for the other kinds: a scan's subject is a
   * `scan_runs` id and an editorial's is an `editorial_requests` id, and
   * printing whichever lead happened to share the number is the defect the
   * note on `headline` already describes.
   */
  subjectId: number;
  /**
   * The story's headline, for the two kinds whose subject IS a lead.
   *
   * Null for every other kind, deliberately: a scan's subject is a `scan_runs`
   * id and an editorial's is an `editorial_requests` id, and printing whichever
   * headline happened to share that number would be a plausible-looking wrong
   * answer. The shell's Running box and Today's strips use this where they have
   * it and fall back to `title` where they do not -- see `jobHeadline`.
   */
  headline: string | null;
  /** Resolved provider label ("Codex Sol", "Local model"), never "auto". */
  model: string;
  /** Saved reasoning effort for a Dark Desk research run, when present. */
  modelEffort: ModelEffort | null;
  stages: string[] | null;
  stageIndex: number | null;
  pct: number | null;
  /** The one-line "now" step. Falls back to the legacy `stage` sentence. */
  step: string;
  startedAt: number | null;
  endedAt: number | null;
  beatAt: number | null;
  /**
   * The row's `updated_at`, epoch ms: the heartbeat `executeJob` writes every
   * 30s for as long as its process is alive. It is here beside `beatAt` because
   * the two answer different questions and the desk needs both: `beatAt` is the
   * worker's own progress report (a long unwrapped call can let it go quiet
   * while the process is fine -- see `jobProgressStalled`), and `updatedAt` is
   * whether the PROCESS is alive (`jobHeartbeatStale`, the same rule the
   * drainer uses to reclaim a row). A follow-up card asks the second question
   * when it decides whether a Stop is still in flight.
   */
  updatedAt: number | null;
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
  // FB1: the other seven. Until the one reader could see them, six of these
  // kinds had no card anywhere in the product -- so no title was ever needed.
  scan: "Scanning the watch list",
  dark: "Digging the file",
  editorial: "Writing an editorial",
  brief: "Writing the editor brief",
  challenge: "Challenging the case",
  "routine-notice": "Filing the routine edition",
  "artifact-ocr": "Reading the PDF",
  pull: "Pulling the public record",
  "audio-transcribe": "Transcribing the audio",
  reporting: "Reporting the assignment",
};

const DONE_TEXT: Partial<Record<JobKind, string>> = {
  draft: "Your draft is ready",
  reconcile: "The evidence check is done",
  "follow-up": "The check is done",
  scan: "The scan is done",
  dark: "Case file ready for your decision",
  editorial: "The editorial is written",
  brief: "The brief is written",
  challenge: "The case review is done",
  "routine-notice": "The routine edition is filed",
  "artifact-ocr": "The PDF pages are read",
  pull: "The pull is done",
  "audio-transcribe": "The transcript is saved",
  reporting: "Your reporting package is ready",
};

const OPEN_LABEL: Partial<Record<JobKind, string>> = {
  draft: "Open the draft",
  reconcile: "Open the checked draft",
  "follow-up": "Open the follow-up",
  scan: "Open the scan",
  dark: "Open file",
  editorial: "Open Opinion",
  brief: "Open the file",
  challenge: "Open the file",
  "routine-notice": "Open the routine desk",
  "artifact-ocr": "Open the file",
  pull: "Open the story",
  "audio-transcribe": "Open the transcript",
  reporting: "Open the reporting",
};

/*
  WHERE A FINISHED JOB'S "Open" GOES, for the kinds whose result is not a story
  draft. A route the app already serves, or null -- `desk_jobs.result_href` (a
  value the worker itself wrote) still wins over all of these, because the
  worker is the only thing that knows where its own output landed.
*/
const RESULT_HREF: Partial<Record<JobKind, (subjectId: number) => string>> = {
  scan: () => "/desk/scan",
  dark: () => "/desk/dark",
  challenge: () => "/desk/dark",
  "artifact-ocr": () => "/desk/dark",
  editorial: () => "/desk/opinion",
  // The transcript screen is keyed by the ARTIFACT, and this job's subject IS
  // the audio artifact -- `performAudioTranscribeWork` refuses to run when the
  // receipt's `audioArtifactId` and the subject disagree.
  "audio-transcribe": (subjectId) => `/desk/transcript/${subjectId}`,
  // A reporting subject is a request ID. Until its lead is resolved, use the
  // queue rather than interpreting that request ID as a story ID.
  reporting: () => "/desk/queue",
  // Pull's result is a document under a story, and a `pull` job's subject is
  // the job's own receipt rather than a lead, so there is no honest id to put
  // in a URL here. Null: the card offers no Open button rather than a wrong one.
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
  | "leadId"
  | "title"
  | "headline"
  | "doneText"
  | "openLabel"
  | "resultHref"
  | "resultDraftId"
  | "canRetry"
>;

const SAVED_MODEL_EFFORTS = new Set<ModelEffort>(["none", "low", "medium", "high", "xhigh", "max"]);

function darkJobEffort(row: Pick<DeskJob, "kind" | "result_json">): ModelEffort | null {
  if (!["dark", "challenge", "brief"].includes(row.kind) || !row.result_json) return null;
  try {
    const value = (JSON.parse(row.result_json) as { modelEffort?: unknown }).modelEffort;
    return typeof value === "string" && SAVED_MODEL_EFFORTS.has(value as ModelEffort)
      ? value as ModelEffort
      : null;
  } catch {
    return null;
  }
}

function progressShape(row: DeskJob, model: string): ProgressShape {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    status: row.status,
    model,
    modelEffort: darkJobEffort(row),
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
    updatedAt: ms(row.updated_at),
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
export function jobProgressView(
  row: DeskJob,
  leadId: number,
  draftId: number | null,
  headline: string | null = null,
): JobProgressView {
  const kind = row.kind;
  return {
    ...progressShape(row, modelChoiceLabel(effectiveStoryModelChoice(row.model_choice))),
    leadId,
    title: TITLES[kind] ?? row.kind,
    // Non-story kinds carry no headline, whatever the caller passed: their
    // subject id is a run id, and the query above resolves a headline only for
    // the two kinds whose subject is a lead.
    headline: kind === "draft" || kind === "reconcile" ? headline : null,
    resultHref:
      row.result_href ??
      (kind === "draft" || kind === "reconcile"
        ? draftId
          ? `/desk/story/draft/${draftId}`
          : `/desk/story/${leadId}`
        : kind === "reporting" && leadId
          ? `/desk/story/${leadId}`
          : RESULT_HREF[kind]?.(row.subject_id) ?? null),
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
    /* A follow-up's subject is a `follow_ups` id, so there is no headline to
       look up and none to show -- the card draws its title. */
    headline: null,
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
 * EVERY job the desk is running, every kind (FB1, unit 3).
 *
 * THE ONE READER. It replaces two narrow ones -- `listStoryJobProgress`
 * (`kind in ('draft','reconcile')`) and the shell's `listRecentStoryWork`
 * (`kind='draft'`) -- which between them meant six of the earlier kinds had no
 * card surface anywhere in the product: a Scan, a Dark Desk round, a brief, a
 * PDF read, a Pull, a transcription and a routine edition could all be running
 * with nothing on any screen that said so.
 *
 * OPEN ROWS COME FIRST, then newest. The `limit` is not a detail: a newsroom
 * with forty finished jobs behind it would otherwise page its own running scan
 * out of the window, and the card the editor is looking for would vanish as the
 * history grew. `order by (status in (...)) desc, id desc` is what makes the
 * window a window on the OPEN work first, newest-first within each group.
 *
 * `finished` rows are included, not just open ones, because the card has to be
 * able to show Done and Failed -- a query that only ever returned running jobs
 * would make two of the design's three states unreachable.
 *
 * Deliberately small and unordered beyond that: every screen wants a different
 * slice (one lead, one kind, everything open) and slices on the client, which
 * is what keeps this one query rather than five.
 */
export async function readDeskJobs(newsroomId: number): Promise<JobProgressView[]> {
  {
    const { ensureJobsSchema } = await import("./jobs.ts");
    await ensureJobsSchema();
    const sql = await getSql();
    const rows = await sql<
      DeskJob & { lead_id: number; draft_id: number | null; headline: string | null }
    >`
      select j.*, j.subject_id as lead_id,
        /*
          The drafts row first, the lead second, as two INDEPENDENT scalar
          subqueries rather than one nested in the other. A lead whose draft
          has not been written yet has no drafts row at all, so a coalesce
          inside that subquery would never run: the subquery returns no rows
          and the whole expression is NULL -- a job with a headline and no
          headline to show, which is the bug this shape avoids.
        */
        case
          when j.kind in ('draft', 'reconcile') then coalesce(
            (
              select nullif(d.headline, '') from drafts d
              where d.lead_id = j.subject_id and d.newsroom_id = j.newsroom_id
              order by d.updated_at desc, d.id desc limit 1
            ),
            (
              select l.headline from leads l
              where l.id = j.subject_id and l.newsroom_id = j.newsroom_id
            )
          )
          else null
        end as headline,
        (select d.id from drafts d
          where d.lead_id = j.subject_id and d.newsroom_id = j.newsroom_id
          order by d.updated_at desc, d.id desc limit 1) as draft_id
      from desk_jobs j
      where j.newsroom_id = ${newsroomId}
      order by (j.status in ('queued', 'running')) desc, j.id desc
      limit 30
    `;
    const reportingRequestIds = rows.filter((row) => row.kind === "reporting").map((row) => row.subject_id);
    const reportingLeads = reportingRequestIds.length
      ? await sql<{ id: number; lead_id: number | null }>`select id, lead_id from reporting_requests where newsroom_id = ${newsroomId} and id = any(${reportingRequestIds}::int[])`
      : [];
    const leadByRequest = new Map(reportingLeads.map((request) => [Number(request.id), request.lead_id == null ? null : Number(request.lead_id)]));
    return rows.map((row) =>
      jobProgressView(
        row,
        row.kind === "reporting" ? leadByRequest.get(row.subject_id) ?? 0 : row.kind === "draft" || row.kind === "reconcile" ? row.subject_id : 0,
        row.kind === "draft" || row.kind === "reconcile" ? row.draft_id : null,
        row.headline,
      ),
    );
  }
}

/*
  The desk's one job query, as the desk calls it. The read above is a plain
  exported function on purpose: a `createServerFn` handler needs a session and a
  request, so a test could only reach it through a built server -- and "does
  this reader return a scan" is a question about SQL, not about routing. The
  test calls `readDeskJobs` directly against PGlite and against real Postgres.
*/
export const listDeskJobs = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(({ context }): Promise<JobProgressView[]> => readDeskJobs(context.newsroomId ?? 1));

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
