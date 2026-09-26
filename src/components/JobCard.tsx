import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelStoryJob,
  retryStoryJob,
  type JobProgressView,
} from "@/lib/news/job-progress";
import { jobCardState, useDeskJobs } from "./job-card-state";

/*
  The job card (redesign phase 3).

  Ported from docs/design/handoff-2026-09-26/design-system/components/desk/
  JobCard.jsx -- same states, same copy, same motion, same geometry. Three
  deliberate departures, each because the reference's context is a prototype:

  1. Colours come from the desk's own tokens (see the JobCard block in
     desk-astra.css), not the prototype's --yel/--panel/--ink set, which the
     shipped desk never defines.
  2. `role="status" aria-live="polite"` is on the status LINE, not on the card.
     The reference puts it on the whole card, which contains a clock that
     changes every second -- a screen reader would read the card out once per
     second, forever. The live region is the sentence that actually changes
     meaning: the current step, the failure, the cancellation.
  3. There is an optional `onView` for a RUNNING job. The reference offers only
     Cancel while running; Today used to offer "Open your story", and the
     placement rule for this phase is to replace the old progress text without
     taking away what those screens did.
*/

const fmt = (total: number) => {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function JobCard({
  job,
  compact,
  stallSeconds = 60,
  now,
  onCancel,
  onOpen,
  onView,
  viewLabel,
  onRetry,
  onRetryNext,
  onKeepWaiting,
}: {
  job: JobProgressView;
  compact?: boolean;
  stallSeconds?: number;
  now?: number;
  onCancel?: () => void;
  onOpen?: () => void;
  onView?: () => void;
  viewLabel?: string;
  onRetry?: () => void;
  onRetryNext?: () => void;
  onKeepWaiting?: () => void;
}) {
  const state = jobCardState(job);
  const running = state === "running";
  const [, tick] = useState(0);
  /*
    One tick per second, and only while something is actually running. The
    reference always ticks; on a desk whose Today page can hold several cards
    that is several timers a second re-rendering finished cards that cannot
    change.
  */
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  /*
    "Keep waiting" buys another window rather than hiding the box, so it comes
    back if the job is still silent at the end of it. A new `beatAt` is news --
    the worker spoke -- so it clears the waiver the editor gave the old silence.
  */
  const [waived, setWaived] = useState(0);
  useEffect(() => {
    setWaived(0);
  }, [job.beatAt]);

  const t = now ?? Date.now();
  const elapsed = job.startedAt == null ? 0 : Math.floor((((job.endedAt ?? t) - job.startedAt) / 1000));
  // A job that has never beaten is not stalled -- it is queued, or its worker
  // has not reached its first boundary yet. Null means "no evidence", not "very
  // quiet"; the server's stall rule says the same thing.
  const quiet = job.beatAt ? Math.max(0, Math.floor((t - job.beatAt) / 1000)) : 0;
  const stalled = running && quiet >= stallSeconds * (1 + waived);
  const col = state === "done" ? "done" : state === "failed" ? "failed" : stalled ? "stalled" : "running";

  return (
    <div className={`job-card${compact ? " compact" : ""} state-${col}`}>
      <div className="job-card-head">
        <div className="job-card-id">
          <span className="job-card-dot" aria-hidden="true" />
          <span>
            <b className="job-card-title">{job.title}</b>
            <span className="job-card-model">
              {job.model}
              {job.pct != null && running ? ` · ${job.pct}%` : ""}
            </span>
          </span>
        </div>
        <b className="job-card-elapsed">
          {state === "done" ? "Done " : state === "failed" ? "Stopped " : ""}
          {fmt(elapsed)}
        </b>
      </div>

      {!compact && job.stages && job.stages.length ? (
        <div className="job-card-stages">
          {job.stages.map((stage, i) => {
            const done = i < (job.stageIndex ?? -1) || state === "done";
            const cur = i === job.stageIndex && running;
            return (
              <span key={stage + i} className={`job-card-chip${cur ? " cur" : done ? " done" : ""}`}>
                {done ? "✓ " : ""}
                {stage}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="job-card-track">
        {job.pct != null || !running ? (
          <span
            className="job-card-fill"
            style={{ width: `${state === "done" ? 100 : Math.max(0, Math.min(100, job.pct ?? 0))}%` }}
          />
        ) : (
          <span className={`job-card-fill${stalled ? "" : " indeterminate"}`} />
        )}
      </div>

      <div className="job-card-foot">
        <b className="job-card-now" role="status" aria-live="polite">
          {state === "failed" ? job.error : state === "done" ? job.doneText : `Now: ${job.step}`}
        </b>
        {running && !stalled ? <span className="job-card-quiet">Last activity {fmt(quiet)} ago</span> : null}
      </div>

      {job.failoverNote ? <p className="job-card-quiet">Model switch: {job.failoverNote}</p> : null}

      {job.cancelRequested && running ? (
        <p className="job-card-quiet" role="status" aria-live="polite">
          Cancelling — the worker stops at its next step.
        </p>
      ) : null}

      {stalled ? (
        <div className="job-card-stall">
          <b className="job-card-stall-note">
            No activity for {fmt(quiet)}. The model may be slow, or it may have stalled.
          </b>
          <div className="job-card-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setWaived((n) => n + 1);
                onKeepWaiting?.();
              }}
            >
              Keep waiting
            </button>
            {onRetryNext ? (
              <button type="button" className="btn solid" onClick={onRetryNext}>
                Retry on next model
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="job-card-actions">
        {running && onView ? (
          <button type="button" className="btn" onClick={onView}>
            {viewLabel ?? "Open your story"}
          </button>
        ) : null}
        {running && !job.cancelRequested && onCancel ? (
          <button type="button" className="btn danger" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {state === "done" && onOpen ? (
          <button type="button" className="btn solid" onClick={onOpen}>
            {job.openLabel}
          </button>
        ) : null}
        {state === "failed" && job.canRetry ? (
          <>
            {onRetry ? (
              <button type="button" className="btn solid" onClick={onRetry}>
                Retry
              </button>
            ) : null}
            {onRetryNext ? (
              <button type="button" className="btn" onClick={onRetryNext}>
                Retry on another model
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A card wired to the three actions the desk can take on a job.
 *
 * Each card owns its own mutations rather than sharing one hook: the state that
 * matters is per-job ("this one is being cancelled"), and a shared hook would
 * have one `isPending` for a page that can hold several cards.
 *
 * `onNavigate` is the route's business, not the card's: the card does not know
 * whether "your story" is a link, a modal or a panel on the page it was placed
 * in. Running and Done both route through it -- one goes to the story, the
 * other to whatever the server put in `resultHref` -- and a caller that passes
 * nothing gets a card with no such button rather than a button that does
 * nothing.
 */
export function DeskJobCard({
  job,
  compact,
  onNavigate,
  viewLabel,
}: {
  job: JobProgressView;
  compact?: boolean;
  onNavigate?: (job: JobProgressView) => void;
  viewLabel?: string;
}) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["desk-jobs"] });
  const cancel = useMutation({
    mutationFn: () => cancelStoryJob({ data: { jobId: job.id } }),
    onSettled: refresh,
  });
  const retry = useMutation({
    mutationFn: (nextModel: boolean) => retryStoryJob({ data: { jobId: job.id, nextModel } }),
    onSettled: refresh,
  });
  const failure = cancel.error ?? retry.error;
  const busy = cancel.isPending || retry.isPending;
  const go = busy || !onNavigate ? undefined : () => onNavigate(job);
  /*
    Retry is offered only where the server says the row describes its own
    request (`canRetry`), which is every row this query can return today -- the
    gate is here so that a kind added to the query later gets a Retry it can
    actually honour, instead of one that re-runs something else.
  */
  const canRetry = job.canRetry && !busy;
  return (
    <div>
      <JobCard
        job={job}
        compact={compact}
        viewLabel={viewLabel}
        onView={go}
        onOpen={go}
        onCancel={busy ? undefined : () => cancel.mutate()}
        onRetry={canRetry ? () => retry.mutate(false) : undefined}
        onRetryNext={canRetry ? () => retry.mutate(true) : undefined}
      />
      {failure ? <p className="job-card-error">{failure instanceof Error ? failure.message : String(failure)}</p> : null}
      {retry.data ? <p className="job-card-quiet">Queued on {retry.data.model}.</p> : null}
    </div>
  );
}

/**
 * The story page's progress card: the DRAFT job for this lead, full size.
 *
 * Exactly what the old `.story-running-banner` showed, and nothing more. The
 * other states are deliberately somebody else's:
 *
 * - Done is not shown, because the page below the card IS the finished draft;
 *   a card announcing it above it would be noise.
 * - Failed is not shown, because the page already turns `job.error` into its
 *   own message next to the draft controls, and two statements of one failure
 *   is how a screen starts contradicting itself.
 * - The evidence check is not shown, because `DraftReconcileControl` already
 *   reports that job, in place, with its own 2 s poll.
 *
 * What is new is the stall: the old banner said "being written" for as long as
 * the row was open, however silent the worker had gone.
 */
export function StoryJobProgress({
  leadId,
  initial,
  note,
}: {
  leadId: number;
  initial?: JobProgressView[] | null;
  /** The reassurance the old banner carried under its progress text. */
  note?: ReactNode;
}) {
  const jobs = useDeskJobs(initial);
  const job = useMemo(() => {
    const mine = jobs.data?.filter((row) => row.leadId === leadId && row.kind === "draft") ?? [];
    return mine.find((row) => row.status === "queued" || row.status === "running") ?? null;
  }, [jobs.data, leadId]);
  if (!job) return null;
  return (
    <section className="story-running-banner" aria-label="Draft progress">
      <DeskJobCard job={job} />
      {note}
    </section>
  );
}

/**
 * How long a finished story job keeps its card on Today. The strip's job is
 * "something you just started has stopped"; the failure that stopped the draft
 * you asked for five minutes ago is that, and last week's is not -- a desk that
 * accumulates dead cards stops being read.
 */
const RECENT_MS = 10 * 60 * 1000;
/** Four is a screenful. Past that the strip is a list, and the queue page is the list. */
const MAX_CARDS = 4;

/**
 * Today's strip: every story job that is open, plus the ones that just stopped.
 *
 * `onNavigate` is required, not optional. The strip's old markup offered "Open
 * your story" as a link, and this phase replaces the strip's text without taking
 * that away -- so a card with no way to act would be a regression, not a
 * simplification.
 */
export function ActiveStoryJobs({
  initial,
  onNavigate,
}: {
  initial?: JobProgressView[] | null;
  onNavigate: (job: JobProgressView) => void;
}) {
  const jobs = useDeskJobs(initial);
  const shown = useMemo(() => {
    // Frozen at render time, like the card's own clock: it is filtered on every
    // poll, and the poll is already the thing that decides when it disappears.
    const at = Date.now();
    return (jobs.data ?? [])
      .filter(
        (row) =>
          row.status === "queued" ||
          row.status === "running" ||
          (row.endedAt != null && at - row.endedAt <= RECENT_MS),
      )
      .slice(0, MAX_CARDS);
  }, [jobs.data]);
  return (
    <>
      {shown.map((job) => (
        <div className="desk-active-story" key={job.id}>
          <DeskJobCard job={job} compact onNavigate={onNavigate} viewLabel="Open your story" />
        </div>
      ))}
    </>
  );
}
