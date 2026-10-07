import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { AddFollowUpButton } from "@/components/add-follow-up-button";
import { DeskShell } from "@/components/desk-chrome";
import { announceToDesk } from "@/components/desk-chrome-utils";
import { FollowUpCard } from "@/components/follow-up-card";
import {
  FollowUpDialog,
  type FollowUpDialogInitial,
  type FollowUpDialogInput,
} from "@/components/follow-up-dialog";
import { jobForFollowUp, useFollowUpJobs } from "@/components/follow-up-jobs";
import { ScreenError } from "@/components/states";
import {
  createAiFollowUp,
  followUpAction,
  listFollowUps,
  listFollowUpStoryOptions,
  updateAiFollowUp,
} from "@/lib/news/desk";
import { cancelStoryJob } from "@/lib/news/job-progress";
import {
  listFollowUpWatchNotices,
  type FollowUpWatchNotice,
} from "@/lib/news/follow-up-watch-notice";
import {
  FOLLOW_UP_FILTERS,
  FOLLOW_UP_FILTER_LABELS,
  followUpFilterLabel,
  followUpStoppedNotice,
  followUpTargets,
  isAgentKind,
  isFollowUpSchedule,
  matchesFollowUpFilter,
  type FollowUpFilter,
} from "@/lib/news/follow-up-copy";
import type { FollowUpRow } from "@/lib/news/types";
import { storyModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/follow-ups")({ component: FollowUpsPage });

/**
 * The Follow-ups screen, as the redesign draws it: the agents working on open
 * questions, one card each, filtered by what they are doing.
 *
 * Unit CU (0.6.81): this screen used to split the list it read -- a row with an
 * `agent_kind` was an agent (drawn by `FollowUpCard`), a row without one was a
 * manual ask (drawn by the retired `FollowUpItem`, under a "Manual asks" head,
 * with Record reply / Nudge / Drop). The manual half is gone: DECISIONS.md:38
 * says follow-ups are AI agents, not a list of people to call, and :44 says
 * there is no human "seek a response" step anywhere. `listFollowUps` now filters
 * `agent_kind is not null` server-side, so the split here had nothing left to
 * split -- every row this screen receives is an agent.
 *
 * Two reads of its own: the rows, and the runs in flight
 * (`useFollowUpJobs`), because a running card embeds the live Job.
 */
function FollowUpsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FollowUpFilter>("active");
  const [dialog, setDialog] = useState<{
    mode: "create" | "edit";
    initial: FollowUpDialogInitial;
  } | null>(null);

  const list = useQuery({ queryKey: ["follow-ups"], queryFn: () => listFollowUps({ data: {} }) });
  const jobs = useFollowUpJobs();
  /*
    The page watches the stopped re-check agents left switched on. One read for
    the screen rather than one per card, and polled slowly: a watch is turned
    off by the editor on another screen, and the card should stop mentioning it
    within a screenful of time rather than instantly.
  */
  const watchNotices = useQuery({
    queryKey: ["follow-up-watch-notices"],
    queryFn: () => listFollowUpWatchNotices(),
    refetchInterval: 60_000,
  });
  // Fetched when a dialog opens, not when the screen renders: the picker's list
  // is only ever needed by the one dialog the editor actually opened.
  const storyOptions = useQuery({
    queryKey: ["follow-up-story-options"],
    queryFn: () => listFollowUpStoryOptions(),
    enabled: dialog !== null,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["follow-ups"] });
    void qc.invalidateQueries({ queryKey: ["follow-up-jobs"] });
    void qc.invalidateQueries({ queryKey: ["follow-up-watch-notices"] });
  };

  /*
    A run in flight floats to the top of whatever filter is on: it is the one
    card whose contents change while the editor is looking at them, and the only
    one with a progress bar worth finding. The rest keep the query's order.
  */
  const visible = useMemo(
    () => (list.data ?? []).filter((row) => matchesFollowUpFilter(row, filter)).sort(runningFirst),
    [list.data, filter],
  );

  const counts = useMemo(() => {
    const out = new Map<FollowUpFilter, number>();
    for (const key of FOLLOW_UP_FILTERS) {
      out.set(key, (list.data ?? []).filter((row) => matchesFollowUpFilter(row, key)).length);
    }
    return out;
  }, [list.data]);

  const action = useMutation({
    mutationFn: (input: {
      id: number;
      action: "pause" | "resume" | "stop" | "done" | "run-now";
    }) => followUpAction({ data: input }),
    onSuccess: (_result, input) => {
      invalidate();
      /*
        Stop says BOTH halves out loud, because they happen at different
        moments: the follow-up is stopped now, and a run that was in flight
        stops at its next step. The card's chip does the same thing in two
        stages ("Stopping…", then "Stopped") -- see `followUpCardState`.
      */
      announceToDesk(
        input.action === "run-now"
          ? "Run started."
          : input.action === "stop"
            ? followUpStoppedNotice()
            : "Follow-up updated.",
      );
    },
    // The refusals ("A draft is being written right now…") are thrown by the
    // server on purpose, so the press that could not do anything says why.
    onError: (err) => announceToDesk(err instanceof Error ? err.message : "Could not do that.", "err"),
  });

  const save = useMutation({
    mutationFn: (input: FollowUpDialogInput) =>
      input.id
        ? updateAiFollowUp({ data: { ...asWireInput(input), id: input.id } })
        : createAiFollowUp({ data: asWireInput(input) }),
    onSuccess: (result) => {
      if (result && result.ok === false) {
        announceToDesk(result.error, "err");
        return;
      }
      invalidate();
      announceToDesk(dialog?.mode === "edit" ? "Saved." : "Follow-up started.");
      setDialog(null);
    },
    onError: (err) =>
      announceToDesk(err instanceof Error ? err.message : "Could not save that follow-up.", "err"),
  });

  const cancel = useMutation({
    mutationFn: (jobId: number) => cancelStoryJob({ data: { jobId } }),
    onSuccess: () => {
      invalidate();
      announceToDesk("Cancelling — the run stops at its next step.");
    },
    onError: (err) =>
      announceToDesk(err instanceof Error ? err.message : "Could not cancel that run.", "err"),
  });

  return (
    <DeskShell
      title="Follow-ups"
      kicker="AI agents working on open questions"
      /*
        CY item 7: "+ New AI follow-up" in the page header, at the right-hand
        end, where the drawing puts it (Desk Screens.dc.html:364,
        `follow: [["+ New AI follow-up", primary]]`). It used to sit at the
        right-hand end of the filters row because `DeskShell` had no action
        slot then; it has one now (desk-chrome.tsx:169, rendered as
        `.head-acts` inside `.ov-head`), so the button moves up into the drawn
        place and the filters row goes back to being the filters.
      */
      actions={<AddFollowUpButton label="+ New AI follow-up" tone="solid" small={false} />}
    >
      {/*
        The intro is the drawing's, sentence for sentence, and the last sentence
        is the screen's most important one: nothing an agent does can print.
        CY item 7 restored the clause the drawing opens its second sentence
        with -- "finds something, it adds the finding ... and flags it here"
        (Desk Screens.dc.html:73); the desk had "tells you here".
      */}
      <p className="fu-intro mt-8">
        AI follow-ups add findings to reporting notes and never publish.
      </p>

      <div className="fu-filters mt-4" role="group" aria-label="Filter follow-ups">
        {FOLLOW_UP_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={"fu-filter" + (filter === key ? " on" : "")}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {followUpFilterLabel(key, counts.get(key) ?? 0)}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {list.isError ? (
          <ScreenError
            message={list.error instanceof Error ? list.error.message : "Could not load follow-ups."}
            onRetry={() => void list.refetch()}
            retrying={list.isRefetching}
          />
        ) : list.isPending ? (
          <div className="fu-list" aria-busy="true">
            {[0, 1, 2].map((n) => (
              <div key={n} className="fu-card skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="fu-result">
            {filter === "active"
              ? "Nothing is running or waiting right now. Start a follow-up and it will report here."
              : `Nothing has “${FOLLOW_UP_FILTER_LABELS[filter]}” right now.`}
          </p>
        ) : (
          <div className="fu-list">
            {visible.map((row) => (
              <FollowUpCard
                key={row.id}
                row={row}
                job={jobForFollowUp(jobs.data, row.id)}
                watchUrls={watchUrlsFor(watchNotices.data, row.id)}
                now={new Date()}
                busyKey={
                  action.isPending && action.variables?.id === row.id ? action.variables.action : null
                }
                onAction={(key) => action.mutate({ id: row.id, action: key })}
                onEdit={() => setDialog({ mode: "edit", initial: initialFor(row) })}
                onAddStory={() => setDialog({ mode: "edit", initial: initialFor(row) })}
                onCancelJob={(jobId) => cancel.mutate(jobId)}
              />
            ))}
          </div>
        )}
      </div>

      {/*
        Unit CU (0.6.81): the "Manual asks" section stood here -- the editor's own
        asks, each drawn by `FollowUpItem` with Record reply, Nudge and Drop. It
        is gone with the component, the three mutations above it and the server
        functions behind them; DECISIONS.md:44 is the reason there is no "seek a
        response" step left to take. Rows the old screen showed are not lost --
        migrations/0106_retire_manual_follow_ups.sql keeps every one of them and
        drops the open ones, and `listFollowUps` no longer hands a manual row to
        any screen.
      */}
      {dialog ? (
        <FollowUpDialog
          mode={dialog.mode}
          initial={dialog.initial}
          leads={storyOptions.data ?? []}
          pending={save.isPending}
          error={
            save.error instanceof Error
              ? save.error.message
              : save.data && save.data.ok === false
                ? save.data.error
                : null
          }
          onClose={() => setDialog(null)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </DeskShell>
  );
}

/** The dialog's input as the server's schema wants it. */
function asWireInput(input: FollowUpDialogInput) {
  return {
    what: input.what,
    agentKind: input.agentKind,
    schedule: input.schedule,
    targets: input.targets,
    leadId: input.leadId,
    modelChoice: input.modelChoice,
  };
}

/** Running first; the query's own order otherwise. */
function runningFirst(a: FollowUpRow, b: FollowUpRow): number {
  return Number(b.last_state === "running") - Number(a.last_state === "running");
}

/** The watches one card should mention, from the screen's single read. */
function watchUrlsFor(
  notices: FollowUpWatchNotice[] | undefined,
  followUpId: number,
): string[] {
  return (notices ?? []).filter((notice) => notice.followUpId === followUpId).map((notice) => notice.url);
}

/** A row as the edit dialog's starting state. */
function initialFor(row: FollowUpRow): FollowUpDialogInitial {
  return {
    id: row.id,
    what: row.what,
    agentKind: isAgentKind(row.agent_kind) ? row.agent_kind : "recheck",
    schedule: isFollowUpSchedule(row.schedule) ? row.schedule : "daily",
    targets: followUpTargets(row.targets_json).join("\n"),
    leadId: row.lead_id,
    leadHeadline: row.lead_headline ?? null,
    modelChoice: storyModelChoice(row.model_choice),
  };
}
