import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DeskMoreMenu, DeskShell } from "@/components/desk-chrome";
import { DeskJobCard } from "@/components/JobCard";
import { useDeskJobs } from "@/components/job-card-state";
import { useNowMs } from "@/components/desk-jobs";
import { ListSkeleton, ScreenError } from "@/components/states";
import { listDraftsDesk, listDraftsDeskPage } from "@/lib/news/desk";
import { sentenceCase } from "@/lib/news/desk-copy";
import {
  deskDraftAction,
  deskDraftElapsed,
  deskDraftState,
  type DeskDraftFilter,
  type DeskDraftState,
} from "@/lib/news/desk-drafts";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
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

  A running row shows the job's own live detail inline -- the DRAWN compact Job
  card, FB1, from the one `useDeskJobs()` query. It used to draw `JobSlot`, a
  dashed stand-in whose own comment said it was a placeholder: a title, an
  elapsed clock and the `stage` text, with no bar, no chips and -- the report's
  finding -- no Cancel, so a draft started from this screen could only be
  stopped from its story page.
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
  /*
    UI1b-5. "Ready to check" was drawn in `d-ok` -- the green 1px border the
    state table gives a ✓ that has been verified. This row has not been
    verified: the checks it still faces are recorded on the story page, not
    here, so green was a verdict the row could not read. The designer's ruling
    is the neutral chip, which is the state table's "Waiting" level.
  */
  if (state.key === "ready") return "d-ready";
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
  // A row with no prose was written by nobody, and "AI" would claim a model
  // produced the words on a lead that is still only a headline and a why.
  if (state.key === "empty") return "";
  return "AI";
}

function DraftsPage() {
  const { sections } = useEditorSections();
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<DeskDraftFilter>("all");
  const [draftShown, setDraftShown] = useState(PAGE_SIZE);
  /*
    HOW MUCH OF THE LIST IS ON THE SCREEN (Unit CZ-long-lists).

    The desk can hold more drafts than anyone scrolls: this screen used to
    render every one of them. It now asks the server for the first 25 and for
    one more page each time the footer is pressed, and the server does the
    narrowing -- a window cut on the client, before the filter, would page the
    unfiltered list and show the wrong rows. The query key carries the filter
    and the window size, so pressing a pill or the footer is a new fetch, and
    `placeholderData` keeps the previous page on screen while it arrives
    instead of blanking the table.

    The bare `["drafts-desk"]` prefix is deliberate and shared with Today's own
    read of the same list: several screens invalidate `["drafts-desk"]` after
    they change a draft (desk.index.tsx:743), and a prefix reaches every key
    that starts with it. A key of its own would go stale behind those writes.

    Today's edition keeps reading the whole list through `listDraftsDesk`: its
    "writing now" and "ready to check" counts describe every draft, and a page
    of 25 would make them describe the page.
  */
  const query = useQuery({
    queryKey: ["drafts-desk", filter, draftShown],
    queryFn: () => listDraftsDeskPage({ data: { limit: draftShown, offset: 0, filter } }),
    placeholderData: keepPreviousData,
    // The desk polls its lists: a draft being written on Tonight's edition is
    // the same work this screen is watching.
    refetchInterval: 5000,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  /*
    THE PILLS COUNT THE LIST, NOT THE PAGE. These arrive counted on the server
    over every draft the newsroom holds; counting `rows` here would make "All"
    read 25 the moment a page appeared.
  */
  const counts = query.data?.counts;
  const anyRunning = rows.some((row) => row.job_status === "running" || row.job_status === "queued");
  const nowMs = useNowMs(anyRunning);
  /*
    THE ONE JOB QUERY (FB1, unit 3). The list rows carry their own snapshot of
    the job (`job_status`, `job_stage`, ...), which is what decides the row's
    state chip; the LIVE card inside a running row is drawn from the same
    `useDeskJobs()` every other screen reads, so the bar, the chips, the stall
    rule and Cancel are the drawn card's and not a second rendering of the same
    row. Keyed by lead, because that is the unit this screen lists.
  */
  const deskJobs = useDeskJobs();
  const liveJobFor = (leadId: number) =>
    (deskJobs.data ?? []).find(
      (job) => job.leadId === leadId && (job.kind === "draft" || job.kind === "reconcile"),
    ) ?? null;

  // The window has narrowed the list already, so every row that arrives is
  // shown; the elapsed time is read here only for the rows on screen.
  const shown = rows.map((row) => ({
    row,
    state: deskDraftState(row, deskDraftElapsed(row.job_started_at ?? row.job_updated_at, nowMs)),
  }));

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
    // The draft row is written with the lead, so its timestamp is the filing
    // time: "filed", not "saved", which would read as an editor's save.
    if (state.key === "empty") return `filed ${formatDateTime(row.updated_at)}`;
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
            {f.label} · {counts?.[f.key] ?? 0}
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
            const liveJob = liveJobFor(row.lead_id);
            const action = deskDraftAction(state);
            const primary = state.key === "ready" || state.key === "failed";
            return (
              <div className="drafts-row" key={row.id}>
                <span className="drafts-state">
                  {/* UI1b-6: sentence case, wherever the word came from. Most
                      of `deskDraftState`'s labels are already capitalised; a
                      running row's is the worker's own stage line, which is
                      not. `sentenceCase` leaves a capital or a marker alone. */}
                  <span className={"chip " + stateTone(state)}>{sentenceCase(state.label)}</span>
                </span>
                <div className="drafts-main">
                  {/* The origin drops out rather than leaving a hanging
                      separator when there is nothing true to say about it. */}
                  <span className="drafts-overline">
                    {[sectionName(row.topic), draftOrigin(row, state)].filter(Boolean).join(" · ")}
                  </span>
                  {/* UI1b-3: the row's list title, in a heading. The link was
                      underlined on hover only before this unit -- and even
                      with the underline always on, a link floating on its own
                      is not the plain form the design system allows (README
                      section 6: a sentence, a list title, a heading or a
                      table cell). */}
                  <h3 className="hl-head">
                    <Link
                      to="/desk/story/$leadId"
                      params={{ leadId: String(row.lead_id) }}
                      className="drafts-hl hl-link"
                    >
                      {row.headline}
                    </Link>
                  </h3>
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
                    {/* The drawn compact card, from `useDeskJobs()`. When the
                        query has not answered yet there is nothing to draw, and
                        the row's own state chip above already says the draft is
                        being written -- a stand-in bar would be the one thing
                        this screen is not allowed to invent. */}
                    {liveJob ? (
                      /*
                        FB6, item 6: NOT `compact`. The compact card drops the
                        stage chip row (JobCard.tsx: `!compact && job.stages`),
                        and the whole of the report's finding on this row was
                        "no chips, no bar, no Cancel" -- a row that is one per
                        story, full width, has the room the compact card exists
                        to save. So this is the drawn card at full size: the
                        stages it is working through, the percent, the bar, the
                        step in words, and Cancel.
                      */
                      <DeskJobCard
                        job={liveJob}
                        viewLabel="Open your story"
                        onNavigate={() => openWorkbench(row.lead_id)}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {/* The list is windowed, so the footer says how much of it is on the
              screen and offers the next page. Not drawn: the handoff's only
              footer is the Queue's "Load more" (Desk Screens.dc.html:67); the
              brief names this button, so this is the brief's wording. Recorded
              in SPEC-GAPS-0681.md. */}
          {total > 0 ? (
            <div className="astra-list-foot">
              <span>{showingLine(rows.length, total, "drafts")}</span>
              {rows.length < total ? (
                <button
                  type="button"
                  className="astra-list-more"
                  onClick={() => setDraftShown((n) => n + PAGE_SIZE)}
                >
                  Show {PAGE_SIZE} more
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </DeskShell>
  );
}
