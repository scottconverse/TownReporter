import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DeskMoreMenu, DeskShell, JobSlot } from "@/components/desk-chrome";
import { useNowMs, type RunningJob } from "@/components/desk-jobs";
import { ListSkeleton, ScreenError } from "@/components/states";
import { listDraftsDesk } from "@/lib/news/desk";
import {
  deskDraftAction,
  deskDraftElapsed,
  deskDraftFilterCounts,
  deskDraftMatchesFilter,
  deskDraftState,
  type DeskDraftFilter,
  type DeskDraftState,
} from "@/lib/news/desk-drafts";
import { modelChoiceLabel } from "@/lib/news/model-choice";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { useEditorSections } from "@/lib/use-sections";

export const Route = createFileRoute("/desk/drafts")({ component: DraftsPage });

/*
  "Everything not yet printed" (redesign phase 2a, README "4. Drafts").

  ONE ROW PER STORY, not one per draft row: `listDraftsDesk` groups by lead and
  takes the newest draft, because a redraft inserts a new `drafts` row rather
  than updating the old one, so a lead with two rows is still one story.

  Every row carries its state in words -- "Writing · 2:18", "! 1 name to
  review", "Draft failed", "Your draft" -- decided by `deskDraftState`, which is
  a pure module with its own tests because the ORDER the facts are read in is
  the rule and a wrong word here tells an editor a story is further along than
  it is.

  A running row shows the job's own live detail inline. That slot is lane 2's
  Job card (`JobSlot` in desk-chrome.tsx): this screen hands it the job and
  renders nothing else, so the swap is one line when lane 2 lands.
*/

type DraftRow = Awaited<ReturnType<typeof listDraftsDesk>>[number];

const FILTERS: { key: DeskDraftFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "needs-you", label: "Needs you" },
  { key: "yours", label: "Yours" },
  { key: "failed", label: "Failed" },
];

/** The tone the state chip is drawn in -- the words carry the state, the
 *  border carries the tone. */
function stateTone(state: DeskDraftState): string {
  if (state.failed) return "d-danger";
  if (state.running) return "d-run";
  if (state.needsYou) return "d-warn";
  if (state.key === "ready") return "d-ok";
  return "d-quiet";
}

/**
 * Where this draft came from, in the drawing's three words.
 *
 * "Reprint" is a story pasted in from somewhere else (the desk stores it as
 * `importedText` and chips it "Imported" -- the chip's word is pinned by
 * `desk-drafts.test.ts`, so the origin line says what the chip cannot). The
 * drawing writes "Reprint · not checked" as one string; the check state is
 * this screen's own state chip, so the two are not said twice.
 */
function draftOrigin(row: DraftRow, state: DeskDraftState): string {
  if (row.imported_text) return "Reprint";
  if (state.yours) return "Written by you";
  return "AI";
}

function DraftsPage() {
  const { sections } = useEditorSections();
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<DeskDraftFilter>("all");
  const query = useQuery({
    queryKey: ["drafts-desk"],
    queryFn: () => listDraftsDesk(),
    // The desk polls its lists: a draft being written on Tonight's edition is
    // the same work this screen is watching.
    refetchInterval: 5000,
  });

  const rows = query.data ?? [];
  const anyRunning = rows.some((row) => row.job_status === "running" || row.job_status === "queued");
  const nowMs = useNowMs(anyRunning);

  const states = rows.map((row) =>
    deskDraftState(row, deskDraftElapsed(row.job_started_at ?? row.job_updated_at, nowMs)),
  );
  const counts = deskDraftFilterCounts(states);
  const shown = rows
    .map((row, index) => ({ row, state: states[index] }))
    .filter(({ state }) => deskDraftMatchesFilter(state, filter));

  const sectionName = (topic: string | null) =>
    (topic && sections.find((s) => s.key === topic)?.name) || topic || "No section";

  /*
    WHAT THE META COLUMN SAYS, which is what has happened to this row most
    recently: the model writing it, when its checks last ran, when it was
    saved, or why it stopped. A row with nothing to say about itself leaves the
    column empty rather than printing a time it does not have.
  */
  const metaFor = (row: DraftRow, state: DeskDraftState): string => {
    if (state.failed) {
      const why = String(row.job_error ?? "").split("\n")[0].trim();
      const when = formatDateTime(row.job_updated_at ?? row.updated_at);
      return why ? `${why} · ${when}` : when;
    }
    if (state.running) return modelChoiceLabel(row.job_model_choice, "story");
    if (state.key === "names" && row.names_checked_at) {
      return `checked ${formatDateTime(row.names_checked_at)}`;
    }
    if (state.key === "evidence" && row.evidence_checked_at) {
      return `checked ${formatDateTime(row.evidence_checked_at)}`;
    }
    if (state.key === "ready") {
      const checked = row.evidence_checked_at ?? row.names_checked_at;
      return checked ? `checked ${formatDateTime(checked)}` : `saved ${formatDateTime(row.updated_at)}`;
    }
    if (state.key === "imported") return `pasted ${formatShortDate(row.updated_at)}`;
    return `saved ${formatDateTime(row.updated_at)}`;
  };

  const openWorkbench = (leadId: number) =>
    void navigate({ to: "/desk/story/$leadId", params: { leadId: String(leadId) } });

  return (
    <DeskShell
      title="Drafts"
      kicker="Everything not yet printed"
      lede={
        <Link to="/desk" hash="story-composer" className="btn solid">
          + New story
        </Link>
      }
    >
      <div className="seg-strip" role="group" aria-label="Filter drafts">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? "on" : ""}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} · {counts[f.key]}
          </button>
        ))}
      </div>

      {query.isError && rows.length === 0 ? (
        <ScreenError
          message={query.error instanceof Error ? query.error.message : "Could not load the drafts."}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : query.isPending && rows.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <p className="wire-sum">
          {filter === "all"
            ? "Nothing is waiting to be printed. A draft lands here the moment a lead is written, and leaves when it prints."
            : `No drafts under ${FILTERS.find((f) => f.key === filter)?.label}.`}
        </p>
      ) : (
        <div>
          {shown.map(({ row, state }) => {
            const job: RunningJob = {
              id: row.lead_id,
              headline: row.headline,
              status: String(row.job_status ?? ""),
              stage: String(row.job_stage ?? ""),
              started_at: row.job_started_at,
              updated_at: row.job_updated_at ?? row.updated_at,
            };
            const action = deskDraftAction(state);
            const primary = state.key === "ready" || state.key === "failed";
            return (
              <div className="drafts-row" key={row.id}>
                <span className="drafts-state">
                  <span className={"chip " + stateTone(state)}>{state.label}</span>
                </span>
                <div className="drafts-main">
                  <span className="drafts-overline">
                    {sectionName(row.topic)} · {draftOrigin(row, state)}
                  </span>
                  <Link
                    to="/desk/story/$leadId"
                    params={{ leadId: String(row.lead_id) }}
                    className="drafts-hl hl-link"
                  >
                    {row.headline}
                  </Link>
                </div>
                {/* A meta cell with nothing to say still holds its column, so
                    the rows below it do not shift by a column. */}
                <span className="drafts-meta">{metaFor(row, state)}</span>
                <span className="drafts-side">
                  <Link
                    to="/desk/story/$leadId"
                    params={{ leadId: String(row.lead_id) }}
                    className={"btn" + (primary ? " solid" : "")}
                    aria-label={`${action}: ${row.headline}`}
                  >
                    {action}
                  </Link>
                  <DeskMoreMenu
                    ariaLabel={`More actions for ${row.headline}`}
                    items={[
                      { label: "Open the story workbench", onSelect: () => openWorkbench(row.lead_id) },
                      {
                        label: "Hold, kill or delete it in the Queue",
                        onSelect: () => void navigate({ to: "/desk/queue" }),
                      },
                    ]}
                  />
                </span>
                {state.running ? (
                  <div className="drafts-job">
                    {/* LANE-2 SLOT: today this is the dashed stand-in in
                        desk-chrome.tsx; lane 2's compact Job card replaces its
                        body and nothing here changes. */}
                    <JobSlot job={job} nowMs={nowMs} compact />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </DeskShell>
  );
}
