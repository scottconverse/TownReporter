import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { InkButton } from "@/components/desk-chrome";
import { JobCard } from "@/components/JobCard";
import {
  cardActions,
  cardChip,
  cardResultLine,
  cardTimeLine,
  followUpCardState,
  methodLine,
  parseFinding,
  watchNotice,
  type CardActionEmphasis,
  type CardActionKey,
} from "@/lib/news/follow-up-copy";
import type { JobProgressView } from "@/lib/news/job-progress";
import type { FollowUpRow } from "@/lib/news/types";

/**
 * One AI follow-up, as the drawn Follow-ups screen draws it.
 *
 * The card is one `<div>` with a two-column grid: the reading column (method
 * line, question, latest result, story and time) and the actions. The 4px left
 * edge is the state, and it is a different axis from the chip -- a stopped card
 * whose last run FOUND something is a stopped card, so its edge is neutral
 * while its result paragraph still says what was found.
 *
 * A running card also embeds the live Job (`<dc-import name="Desk Job" job
 * compact>` in the reference), which spans both columns. This component renders
 * `JobCard` rather than `DeskJobCard` because the cancel press has to refresh
 * TWO queries -- the jobs and the follow-up row, since a cancelled run ends
 * with a new `last_state` -- and `DeskJobCard` owns cancellations for story
 * jobs only. The caller passes `onCancelJob`, which is the same
 * `cancelStoryJob` server function.
 *
 * THE TWO STOP BUTTONS ON A RUNNING CARD ARE NOT TWO ANSWERS TO ONE QUESTION,
 * and Stop (the card's own) writes the SAME flag this inner Cancel writes
 * (`cancel_requested` -- see `cancelFollowUpRunsIn` in ./follow-ups.ts), so
 * they cannot fight: Cancel ends the run and leaves the agent on its schedule,
 * Stop ends the run and the agent, and a press of Stop hides the inner Cancel
 * because `job.cancelRequested` is then true. An editor who only wanted the bad
 * run gone has not been made to kill the agent to get it.
 *
 * Nothing here decides anything: the state, the chip, the result sentence, the
 * time sentence and the button set are all in ./follow-up-copy.ts, so a change
 * to how a stopped row reads is one edit in a module a test can call. The one
 * fact that comes from outside is the live run, which is what makes the
 * `stopping` card possible at all -- `followUpCardState(row, job)`.
 */
export function FollowUpCard({
  row,
  job,
  watchUrls,
  now,
  onAction,
  onEdit,
  onAddStory,
  onCancelJob,
  busyKey,
}: {
  row: FollowUpRow;
  /** The live run for this row, when one is queued or running. */
  job?: JobProgressView | null;
  /**
   * The URLs of page watches a stopped re-check left switched on, from
   * `listFollowUpWatchNotices`. A re-check run creates a watch that keeps
   * polling after the agent is stopped, and the card is where the editor is
   * told so (see `watchNotice`).
   */
  watchUrls?: string[];
  /** The reader's clock, so the sentences are testable at a pinned minute. */
  now: Date;
  onAction?: (action: Extract<CardActionKey, "pause" | "resume" | "stop" | "done" | "run-now">) => void;
  onEdit?: () => void;
  /**
   * Opens the Edit dialog, which is where the story is chosen: a finding is
   * written into the story's reporting notes and nowhere else, so linking one
   * after the fact is what puts the finding in the notes (see the dialog).
   */
  onAddStory?: () => void;
  onCancelJob?: (jobId: number) => void;
  /** Which button is mid-press, so the whole row does not go dead. */
  busyKey?: CardActionKey | null;
}) {
  const [findingOpen, setFindingOpen] = useState(false);
  /*
    The live run is passed in because `stopping` is a fact about the pair: Stop
    has committed on the row, and the run it had in flight has not reached its
    terminal state yet. See `followUpCardState` -- and note `now`, which is the
    same clock the time sentences get: whether that run is still in flight is a
    comparison with the clock (a worker that has gone quiet is not in flight).
  */
  const state = followUpCardState(row, job, now);
  const chip = cardChip(state);
  const finding = parseFinding(row.finding_json);
  const times = {
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    startedAt: job?.startedAt ?? null,
    // "today 6:00 a.m." versus "Wed 6:00 a.m." is a comparison with the clock,
    // so the clock comes from the caller rather than a second `new Date()`
    // inside the sentence builder.
    from: now,
  };
  const hasStory = Boolean(row.lead_id || row.article_slug);

  const storyTo = row.lead_id
    ? { to: "/desk/story/$leadId" as const, params: { leadId: String(row.lead_id) } }
    : row.article_slug
      ? { to: "/articles/$slug" as const, params: { slug: row.article_slug } }
      : null;
  const storyTitle = row.lead_headline ?? row.article_headline;

  /*
    A run in flight says what it is DOING -- the job's own step -- and the
    worker's step is the only honest source for that. Every other state reads
    its sentence off the last recorded finding, `stopping` included: the point
    of that card is that the run will not record anything more, which is not
    something the job's own step line says.
  */
  const resultText = state === "running" ? job?.step || "Working…" : cardResultLine(state, finding, times);
  const timeText = cardTimeLine(state, times);
  /*
    Only on the terminal cards. While the run is still stopping the card is
    saying something else, and the watch notice is about what a STOPPED agent
    left behind -- it is not news until the agent is stopped.
  */
  const notice =
    state === "stopped" || state === "done" ? watchNotice(watchUrls ?? []) : null;

  return (
    <div className={"fu-card state-" + state}>
      <div className="fu-main">
        <div className="fu-top">
          {chip ? <span className={"fu-chip " + chip.tone}>{chip.text}</span> : null}
          {/*
            0.6.81 (unit CU): this fell back to `row.who` -- the name of the
            person a manual ask was addressed to -- for a row with no method
            line. Every read that feeds this card is agents only, so there is
            no such row left and no human name belongs on a follow-up card.
          */}
          <span className="fu-method">
            {row.agent_kind && row.schedule ? methodLine(row.agent_kind, row.schedule) : ""}
          </span>
        </div>
        <span className="fu-q">{row.what}</span>
        {resultText ? <span className="fu-result">{resultText}</span> : null}
        {notice ? (
          <span className="fu-watch-notice">
            {notice.text}{" "}
            <Link to="/desk/dark" className="fu-story-link">
              {notice.linkLabel}
            </Link>
          </span>
        ) : null}
        {(storyTo || timeText) && (
          <span className="fu-meta">
            {storyTo ? (
              <>
                {"Story: "}
                <Link {...storyTo} className="fu-story-link">
                  {storyTitle || "the story"}
                </Link>
                {timeText ? " · " : null}
              </>
            ) : null}
            {timeText}
          </span>
        )}
      </div>

      <div className="fu-actions">
        {cardActions(state, hasStory).map((action) => (
          <InkButton
            key={action.key}
            small
            tone={BUTTON_TONE[action.emphasis]}
            disabled={busyKey === action.key}
            onClick={() => {
              if (action.key === "review") return setFindingOpen((open) => !open);
              if (action.key === "edit") return onEdit?.();
              if (action.key === "add-story") return onAddStory?.();
              onAction?.(action.key);
            }}
          >
            {action.label}
          </InkButton>
        ))}
      </div>

      {/*
        The finding, opened in place. The drawing's Found card has a story and
        its "Review finding" could navigate; a search agent's answer often has
        no story yet, so the panel is what makes the button work in both cases.
      */}
      {findingOpen ? (
        <div className="fu-finding">
          <span className="fu-finding-title">
            {finding.title || "The last check found this"}
          </span>
          {finding.summary ? <span className="fu-finding-summary">{finding.summary}</span> : null}
          {finding.reason ? <span className="fu-finding-summary">{finding.reason}</span> : null}
          <span className="fu-finding-meta">
            {finding.url ? (
              <>
                <a href={finding.url} target="_blank" rel="noreferrer" className="fu-story-link">
                  {finding.url}
                </a>
                {" · "}
              </>
            ) : null}
            {finding.checkedAt
              ? `found ${cardTimeLine("found", { lastRunAt: finding.checkedAt }).replace("last run ", "")}`
              : "never run"}
            {hasStory ? " · added to the story's reporting notes" : " · not linked to a story yet"}
          </span>
        </div>
      ) : null}

      {job ? (
        <div className="fu-job">
          <JobCard job={job} compact onCancel={onCancelJob ? () => onCancelJob(job.id) : undefined} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The drawing's four button letters, mapped to the desk's button family. `p`
 * (yellow fill, 800) is `solid`, `o` (2px ink outline) is `ghost`, `d` (2px
 * danger outline) is `quiet-danger`, and no letter (1px `--line`) is `quiet`.
 */
const BUTTON_TONE: Record<CardActionEmphasis, "solid" | "ghost" | "quiet" | "quiet-danger"> = {
  primary: "solid",
  outline: "ghost",
  danger: "quiet-danger",
  quiet: "quiet",
};
