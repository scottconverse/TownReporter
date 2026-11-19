import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  DraftItemBoundary,
  DraftStateChip,
} from "@/components/draft-item-boundary";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskMoreMenu, DeskShell } from "@/components/desk-chrome";
import { DeskJobCard } from "@/components/JobCard";
import { draftPillText } from "@/lib/desk/draft-pills";
import { useDeskJobs } from "@/components/job-card-state";
import { useNowMs } from "@/components/desk-jobs";
import { ListSkeleton, ScreenError } from "@/components/states";
import { Dialog } from "@/components/dialog";
import {
  bulkKillLeads,
  listDraftsDesk,
  listDraftsDeskPage,
  publishAllDrafts,
  publishLead,
  undoBulkKillLeads,
} from "@/lib/news/desk";
import { listEditorials } from "@/lib/news/opinion";
import { opinionDraftsWaiting } from "@/lib/news/opinion-drafts-waiting";
import {
  getWaitingRoundup,
  killWaitingRoundup,
  listWaitingRoundups,
  publishWaitingRoundup,
  type WaitingRoundup,
  type WaitingRoundupDetail,
} from "@/lib/news/routine-waiting";
import { StoryBody } from "@/components/story-body";
import { editorTitle } from "@/lib/news/desk-copy";
import {
  deskDraftAction,
  deskDraftElapsed,
  deskDraftState,
  publishAllCandidates,
  type DeskDraftFilter,
  type DeskDraftState,
  type PublishAllCandidate,
} from "@/lib/news/desk-drafts";
import { draftItemLabel } from "@/lib/news/draft-item";
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
  const { formatListDateTime, formatShortDate } = usePaperDateFormatters();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<DeskDraftFilter>("all");
  const [draftShown, setDraftShown] = useState(PAGE_SIZE);
  /*
    feat-bulk-desk (Nov 16 2026): the rows the editor has ticked. One selection
    serves both presses above the list -- "Publish N selected" and "Kill N
    selected" -- so an editor picks stories once and chooses what to do with
    them. The ids are kept even when the filter or the window moves a row off
    the screen; a row that leaves the desk (printed or killed) is taken out of
    the selection when the press reports.
  */
  const [selectedDraftLeadIds, setSelectedDraftLeadIds] = useState<number[]>([]);
  const toggleDraftSelection = (leadId: number, on: boolean) =>
    setSelectedDraftLeadIds((prev) =>
      on ? [...new Set([...prev, leadId])] : prev.filter((id) => id !== leadId),
    );
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
    "writing now" and "to check" counts describe every draft, and a page
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
  const anyRunning = rows.some(
    (row) => row?.job_status === "running" || row?.job_status === "queued",
  );
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
  const shown = rows;

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
      const why = String(row.job_error ?? "")
        .split("\n")[0]
        .trim();
      const when = formatListDateTime(row.job_updated_at ?? row.updated_at);
      return why ? `${why} · ${when}` : when;
    }
    if (state.running) return modelChoiceLabel(row.job_model_choice, "story");
    if (state.key === "names" && row.names_checked_at) {
      return `checked ${formatListDateTime(row.names_checked_at)}`;
    }
    if (state.key === "evidence" && row.evidence_checked_at) {
      return `checked ${formatListDateTime(row.evidence_checked_at)}`;
    }
    if (state.key === "ready") {
      const checked = row.evidence_checked_at ?? row.names_checked_at;
      return checked
        ? `checked ${formatListDateTime(checked)}`
        : `saved ${formatListDateTime(row.updated_at)}`;
    }
    if (state.key === "not-ready" && state.readiness?.reason) {
      // The chip says "✕ Not ready"; this line says why, in the gate's words.
      return `${state.readiness.reason} · saved ${formatListDateTime(row.updated_at)}`;
    }
    if (state.key === "imported") return `pasted ${formatShortDate(row.updated_at)}`;
    // The draft row is written with the lead, so its timestamp is the filing
    // time: "filed", not "saved", which would read as an editor's save.
    if (state.key === "empty") return `filed ${formatListDateTime(row.updated_at)}`;
    return `saved ${formatListDateTime(row.updated_at)}`;
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
      <WaitingRoundups />
      <OpinionDraftsWaiting />
      {/* A row that cannot be read arrives as `null` (DraftItemBoundary draws
          the one alert); it holds no id and so is not selectable. */}
      <PublishAllDrafts
        selected={selectedDraftLeadIds}
        onSelectionChange={setSelectedDraftLeadIds}
        listedLeadIds={rows
          .map((row) => row?.lead_id)
          .filter((id): id is number => typeof id === "number")}
      />
      <div className="seg-strip" role="group" aria-label="Filter drafts">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? "on" : ""}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {draftPillText(f.label, counts, f.key)}
          </button>
        ))}
      </div>

      {query.isError && rows.length === 0 ? (
        <ScreenError
          message={
            query.error instanceof Error ? query.error.message : "Could not load the drafts."
          }
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
          {shown.map((row, index) => (
            <DraftItemBoundary
              key={row?.id ?? `unreadable-${index}`}
              item={draftItemLabel(row, index)}
            >
              {() => {
                const state = deskDraftState(
                  { ...row, story_readiness: row.story_readiness ?? null },
                  deskDraftElapsed(row.job_started_at ?? row.job_updated_at, nowMs),
                );
                const liveJob = liveJobFor(row.lead_id);
                const action = deskDraftAction(state);
                const primary = state.key === "ready" || state.key === "failed";
                return (
                  <div className="drafts-row" key={row.id ?? `draft-${index}`}>
                    <span className="drafts-state">
                      {/* The row's one tick box (feat-bulk-desk). It is the
                      Queue's own `queue-check` control, so the mark, the 44px
                      press area and the focus ring are the desk's existing
                      ones. A running or failed row can be ticked and killed;
                      it is simply never in the publish batch. */}
                      <label className="queue-check drafts-check">
                        <input
                          type="checkbox"
                          className="queue-pick"
                          checked={selectedDraftLeadIds.includes(row.lead_id)}
                          aria-label={`Select ${editorTitle(row.headline)}`}
                          onChange={(event) =>
                            toggleDraftSelection(row.lead_id, event.target.checked)
                          }
                        />
                        <span className="queue-box" aria-hidden="true">
                          {selectedDraftLeadIds.includes(row.lead_id) ? "✓" : null}
                        </span>
                      </label>
                      <DraftStateChip state={state} />
                    </span>
                    <div className="drafts-main">
                      {/* The origin drops out rather than leaving a hanging
                      separator when there is nothing true to say about it. */}
                      <span className="drafts-overline">
                        {[sectionName(row.topic), draftOrigin(row, state)]
                          .filter(Boolean)
                          .join(" · ")}
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
                          {editorTitle(row.headline)}
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
                          {
                            label: "Open the story workbench",
                            onSelect: () => openWorkbench(row.lead_id),
                          },
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
              }}
            </DraftItemBoundary>
          ))}
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

/*
  Pieces filed through the Opinion desk's paste box.

  They are drafts with no lead, so `DESK_DRAFT_ROWS_SQL` -- which joins
  `leads` -- cannot see them, and an editor who pasted a column found it on
  neither screen they looked at. They print only from the Opinion page, so the
  row does not offer Publish here: it offers the way there.

  Same query key as `desk.opinion.tsx` ("editorials"), so filing or
  publishing there refreshes this list without a poll of its own.
*/
function OpinionDraftsWaiting() {
  const waiting = useQuery({
    queryKey: ["editorials"],
    queryFn: () => listEditorials(),
  });

  const rows = opinionDraftsWaiting(waiting.data ?? []);
  if (waiting.isPending || rows.length === 0) return null;

  return (
    <section aria-label="Opinion pieces waiting">
      <h2 className="hl-head">Opinion pieces waiting</h2>
      <p className="wire-sum">
        These opinion pieces print only when you press Publish on the Opinion page.
      </p>
      {rows.map((row) => {
        const headline = row.headline || row.subject;
        return (
          <div className="drafts-row" key={row.id}>
            <div className="drafts-main">
              <p className="drafts-overline">
                Opinion
                {row.words != null ? ` · ${row.words} words` : ""}
              </p>
              <h3 className="hl-head">{headline}</h3>
            </div>
            <div className="drafts-side">
              <Link
                to="/desk/opinion"
                className="btn solid"
                aria-label={`Open in Opinion: ${headline}`}
              >
                Open in Opinion
              </Link>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function WaitingRoundups() {
  const queryClient = useQueryClient();
  const [publishing, setPublishing] = useState<number | null>(null);
  const [results, setResults] = useState<
    Record<number, { ok: true; slug: string } | { ok: true } | { ok: false; error: string }>
  >({});
  const [published, setPublished] = useState<{ id: number; headline: string; slug: string }[]>([]);
  const [killed, setKilled] = useState<{ id: number; headline: string }[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<WaitingRoundupDetail | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [killTarget, setKillTarget] = useState<number | null>(null);
  const [killing, setKilling] = useState<number | null>(null);
  const waiting = useQuery({
    queryKey: ["desk", "waiting-roundups"],
    queryFn: () => listWaitingRoundups(),
  });

  const rows = waiting.data ?? [];
  if (waiting.isLoading || (rows.length === 0 && published.length === 0 && killed.length === 0)) {
    return null;
  }

  const channels: Record<WaitingRoundup["channel"], string> = {
    today: "Today in town",
    weekend: "This weekend",
    deadlines: "Deadlines",
  };

  async function handlePublish(id: number) {
    setPublishing(id);
    try {
      const result = await publishWaitingRoundup({ data: id });
      if (result.ok) {
        const headline = waiting.data?.find((r) => r.id === id)?.headline ?? "";
        setPublished((prev) => [...prev.filter((p) => p.id !== id), { id, headline, slug: result.slug }]);
      }
      setResults((prev) => ({ ...prev, [id]: result }));
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["desk", "waiting-roundups"] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not publish.";
      setResults((prev) => ({ ...prev, [id]: { ok: false, error: message } }));
    } finally {
      setPublishing(null);
    }
  }

  async function handleOpen(id: number) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpening(id);
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    try {
      const loaded = await getWaitingRoundup({ data: id });
      if (!loaded) {
        setOpenId(null);
        setDetail(null);
        setResults((prev) => ({
          ...prev,
          [id]: { ok: false, error: "This roundup is not waiting any more. Reload the page." },
        }));
        return;
      }
      setDetail(loaded);
      setOpenId(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open the roundup.";
      setResults((prev) => ({ ...prev, [id]: { ok: false, error: message } }));
    } finally {
      setOpening(null);
    }
  }

  async function handleKill(id: number, headline: string) {
    setKilling(id);
    try {
      const result = await killWaitingRoundup({ data: id });
      setResults((prev) => ({ ...prev, [id]: result }));
      if (result.ok) {
        setKilled((prev) => [...prev.filter((k) => k.id !== id), { id, headline }]);
        if (openId === id) {
          setOpenId(null);
          setDetail(null);
        }
        await queryClient.invalidateQueries({ queryKey: ["desk", "waiting-roundups"] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not kill the roundup.";
      setResults((prev) => ({ ...prev, [id]: { ok: false, error: message } }));
    } finally {
      setKilling(null);
      setKillTarget(null);
    }
  }

  return (
    <section aria-label="Roundups waiting">
      <h2 className="hl-head">Roundups waiting</h2>
      <p className="wire-sum">These roundups print only when you press Publish.</p>
      {rows.map((roundup) => {
        const result = results[roundup.id];
        const isPublishing = publishing === roundup.id;
        return (
          <div className="drafts-row roundup-row" key={roundup.id}>
            <div className="drafts-main">
              <p className="drafts-overline">
                {channels[roundup.channel]} · {roundup.issueDate}
              </p>
              <h3 className="hl-head">{roundup.headline}</h3>
              {result && !result.ok && <p role="alert">{result.error}</p>}
              {result && result.ok && "slug" in result && (
                /*
                  Faint toast (walk note, Oct 31 2026): this confirmation was an
                  unstyled <p> -- it inherited whatever colour the row was
                  given, so in the dark desk it read as dark maroon on near
                  black, and at the desk's 14px base it was small too.
                  `.published-line` gives it 16px and the high-contrast ink
                  (`--fg`), and its link is underlined ink as well. The class is
                  shared with the second copy of this line below.
                */
                <p className="published-line" role="status">
                  Published.{" "}
                  <Link to="/articles/$slug" params={{ slug: result.slug }} className="inline-link">
                    Open the story
                  </Link>
                </p>
              )}
            </div>
            <div className="drafts-side">
              <button
                type="button"
                className="btn"
                aria-label={
                  openId === roundup.id
                    ? `Close: ${roundup.headline}`
                    : `Open: ${roundup.headline}`
                }
                aria-expanded={openId === roundup.id}
                disabled={opening === roundup.id}
                onClick={() => void handleOpen(roundup.id)}
              >
                {openId === roundup.id ? "Close" : "Open"}
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Kill: ${roundup.headline}`}
                disabled={killing === roundup.id}
                onClick={() => setKillTarget(killTarget === roundup.id ? null : roundup.id)}
              >
                Kill
              </button>
              <button
                type="button"
                className="btn solid"
                aria-label={`Publish: ${roundup.headline}`}
                disabled={isPublishing}
                onClick={() => handlePublish(roundup.id)}
              >
                {isPublishing ? "Publishing…" : "Publish"}
              </button>
            </div>
            {killTarget === roundup.id ? (
              <div
                className="drafts-main roundup-kill"
                role="group"
                aria-label={`Kill ${roundup.headline}`}
              >
                <p>Kill this roundup? It will not print.</p>
                <div className="drafts-side">
                  <button
                    type="button"
                    className="btn solid"
                    disabled={killing === roundup.id}
                    onClick={() => void handleKill(roundup.id, roundup.headline)}
                  >
                    {killing === roundup.id ? "Killing…" : "Yes, kill it"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setKillTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {openId === roundup.id && detail ? (
              /* The opened roundup is a full-width block under the row's own
                 line (headline at the left, Open / Kill / Publish at the
                 right), not a continuation of the headline cell. See
                 `.roundup-preview` in desk-astra.css. */
              <div className="roundup-preview">
                {detail.dek ? <p className="dek">{detail.dek}</p> : null}
                <StoryBody body={detail.body} />
                {detail.sourceUrls.length ? (
                  <section aria-label="Sources and public records">
                    <h4 className="hl-head">Sources &amp; public records</h4>
                    <ul>
                      {detail.sourceUrls.map((url) => (
                        <li key={url}>
                          <a href={url} className="inline-link" target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {published
        .filter((p) => !rows.some((r) => r.id === p.id))
        .map((p) => (
          <div className="drafts-row" key={`published-${p.id}`}><div className="drafts-main"><h3 className="hl-head">{p.headline}</h3><p className="published-line" role="status">Published.{" "}<Link to="/articles/$slug" params={{ slug: p.slug }} className="inline-link">Open the story</Link></p></div></div>
        ))}
      {killed
        .filter((k) => !rows.some((r) => r.id === k.id))
        .map((k) => (
          <div className="drafts-row" key={`killed-${k.id}`}><div className="drafts-main"><p className="published-line" role="status">Killed: {k.headline}</p></div></div>
        ))}
    </section>
  );
}

/*
  ── "PUBLISH ALL DRAFTS" (feat-publish-all, Nov 15 2026) ─────────────────────

  The owner's ask: "can you give the ability to publish all stories that I've
  done drafts of at once? … I should be able to push one button for 'publish
  all drafts'." Until now each finished story was published from its own story
  page, one screen at a time.

  WHAT IS IN THE BATCH. The stories whose row's own state is "Your draft" or
  "Ready to check", AND every "Needs you" row that has a finished body --
  not-checked, to-check, names and evidence to review. The owner's words
  (Nov 16 2026): "I just want to publish them all at once." His eight drafts
  were all "! Not checked yet", so a batch limited to "Ready" was a button he
  could never press. Running, failed and empty drafts are never in. The list is
  the WHOLE list (`listDraftsDesk`), not only the 25 rows the window is
  showing. The button hides itself when nothing qualifies.

  THE CONFIRM STEP IS THE SECTION CONFIRMATION AND THE WARNING. The dialog lists
  every story with its section, and marks each story that still needs the
  editor with a short warning ("Not checked yet", "3 to check", "Names to
  review"). Pressing "Publish N stories" sends each story's shown section as its
  `topic`, and -- for a story the dialog warned about -- the warning keys that
  warning stands for, exactly the keys the story page's own "Publish anyway"
  sends. That is Scott's rule 22 at the batch's scale: the dialog names what is
  outstanding, so the one press may acknowledge it. A story with nothing shown
  acknowledges nothing.

  A REFUSAL IS ONE STORY'S, NOT THE BATCH'S. If a warning the dialog did NOT
  draw fires, or any gate refuses, that story alone comes back named in "Not
  published"; the rest still print, and the row offers "Publish anyway" with
  exactly the keys the server returned (rule 22). A `hard` refusal is a wall
  and gets no button.
*/
type PublishAllOutcome = {
  leadId: number;
  headline: string;
  ok: boolean;
  slug?: string;
  error?: string;
  warnings?: { key: string; sentence: string }[];
  hard?: string;
};

/** One lead's answer from `bulkKillLeads`, in the order it was sent. */
type BulkKillOutcome = {
  id: number;
  ok: boolean;
  error?: string;
  warnings?: { key: string; sentence: string }[];
  hard?: boolean;
};

/*
  ── PICKING STORIES TO PUBLISH OR KILL (feat-bulk-desk, Nov 16 2026) ─────────

  Scott's order: "If there are 14 stories drafted that day, i want to publish
  them all at once on some days by selecting them all, or some subset of them,
  and clicking a button and having them all publish." And: "I want to be able
  to ALSO kill stories in bulk (drafted or not drafted) the same way."

  The tick boxes live on the rows in `DraftsPage`; this component owns the two
  presses they feed. "Publish all drafts (N)" is unchanged and still prints the
  whole list in one press. "Publish N selected" is the same publish path over
  the ticked stories only -- the same `publishAllDrafts` call, the same section
  confirmation and the same acknowledged warning keys, so a story cannot print
  with more consent from a selection than from the whole-list button. A `hard`
  refusal still skips that one story and names it.

  "Kill N selected" is one press, one optional reason for every ticked story,
  and -- after it -- ONE line, "Killed N stories. Undo", with one Undo that puts
  all of them back. A running or failed draft can still be ticked and killed
  (Scott asked for drafted or not drafted), but it is never in the publish
  batch: there is nothing finished to print.
*/
function PublishAllDrafts({
  selected,
  onSelectionChange,
  listedLeadIds,
}: {
  selected: number[];
  onSelectionChange: (ids: number[]) => void;
  /** The rows the Drafts list is showing: what "Select all" ticks. */
  listedLeadIds: number[];
}) {
  const qc = useQueryClient();
  const { sections } = useEditorSections();
  const sectionName = (topic: string | null) =>
    (topic && sections.find((s) => s.key === topic)?.name) || topic || "No section";
  const [running, setRunning] = useState(false);
  /*
    F20 (Nov 19 walk): "Publish all drafts" used to send the batch on one
    press. The confirm now lists every headline it will print and marks the
    stories that are not checked yet, so a press that skips the story pages is
    still a press an editor read first. Holds the list being confirmed.
  */
  const [confirming, setConfirming] = useState<PublishAllCandidate[] | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [batchError, setBatchError] = useState("");
  const [published, setPublished] = useState<
    { leadId: number; headline: string; slug: string }[]
  >([]);
  const [refused, setRefused] = useState<PublishAllOutcome[]>([]);
  const [anywayId, setAnywayId] = useState<number | null>(null);

  const [killConfirming, setKillConfirming] = useState(false);
  const [killReason, setKillReason] = useState("");
  const [killing, setKilling] = useState(false);
  const [killed, setKilled] = useState<{ id: number; headline: string }[]>([]);
  const [killFailures, setKillFailures] = useState<BulkKillOutcome[]>([]);
  const [killError, setKillError] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState("");

  /*
    The whole list, not the window: the button counts the stories the desk can
    print, and a page of 25 would make it describe the page. The key starts
    with `["drafts-desk"]` so every existing invalidation of that prefix (the
    story page after a publish, Today after a redraft) reaches this read too.
  */
  const all = useQuery({
    queryKey: ["drafts-desk", "publish-all"],
    queryFn: () => listDraftsDesk(),
    refetchInterval: 5000,
  });

  // Only a real list counts. The key shares the `["drafts-desk"]` prefix, so a
  // cache or fixture holding the paged shape ({ rows, total }) must not crash
  // the screen; it simply offers nothing until the whole list arrives.
  const allRows = Array.isArray(all.data) ? all.data : [];
  const candidates = publishAllCandidates(allRows, (row) =>
    deskDraftState({ ...row, story_readiness: row.story_readiness ?? null }),
  );
  const sectionFor = new Map(candidates.map((c) => [c.leadId, c.topic]));

  const selectedSet = new Set(selected);
  const selectedCandidates = candidates.filter((c) => selectedSet.has(c.leadId));

  const rowById = new Map(allRows.map((row) => [row.lead_id, row]));
  const selectedRows = selected
    .map((id) => rowById.get(id))
    .filter((row): row is (typeof allRows)[number] => Boolean(row));
  const listed = new Set(listedLeadIds);
  const allListedSelected =
    listedLeadIds.length > 0 && listedLeadIds.every((id) => selectedSet.has(id));

  const toggleAllListed = (on: boolean) => {
    if (on) onSelectionChange([...new Set([...selected, ...listedLeadIds])]);
    else onSelectionChange(selected.filter((id) => !listed.has(id)));
  };

  const refresh = (queryKey: readonly unknown[]) => {
    void qc.invalidateQueries({ queryKey }).catch(() => {});
  };
  // The same list the story page's own publish refreshes, so the nav count,
  // the Drafts list and the published screen agree after the batch.
  const refreshAfterPublish = (leadIds: number[]) => {
    refresh(["drafts-desk"]);
    refresh(["leads"]);
    refresh(["paper"]);
    refresh(["published-desk"]);
    for (const leadId of leadIds) refresh(["lead", leadId]);
  };

  /*
    ONE PRESS PUBLISHES (Nov 17 2026). Scott: "when i click publish all drafts,
    it does nothing. I expected it to publish them without clicking on
    anything". The confirm box is gone, and the press accepts every soft
    warning (`acceptAllWarnings`); the server still records each one, and a
    hard refusal (no headline, no body) still lands in "Not published".

    ONE STORY PER REQUEST, so the button counts up as each one prints. A story
    can take several seconds to print, and a 25-story request drew nothing
    until all 25 were done -- Scott: "nothing happens for 10-20 seconds (looks
    frozen or like it didn't get the click)".
  */
  async function run(list: PublishAllCandidate[]) {
    if (list.length === 0 || running) return;
    setRunning(true);
    setBatchError("");
    setPublished([]);
    setRefused([]);
    setProgress({ done: 0, total: list.length });
    const publishedNow: { leadId: number; headline: string; slug: string }[] = [];
    const refusedNow: PublishAllOutcome[] = [];
    let done = 0;
    try {
      /*
        One story per request, one after the other (see the note above): each
        answer is drawn as it lands, so a long list is never a silent spinner.
      */
      for (let start = 0; start < list.length; start += 1) {
        const batch = list.slice(start, start + 1);
        const answer = await publishAllDrafts({
          data: {
            acceptAllWarnings: true,
            items: batch.map((c) => ({
              leadId: c.leadId,
              ...(c.topic ? { topic: c.topic } : {}),
              ...(c.acknowledgedWarningKeys.length
                ? { acknowledgedWarningKeys: c.acknowledgedWarningKeys }
                : {}),
            })),
          },
        });
        if ("error" in answer && answer.error) setBatchError(answer.error);
        for (const result of answer.results) {
          done += 1;
          setProgress({ done, total: list.length });
          if (result.ok) {
            publishedNow.push({
              leadId: result.leadId,
              headline: result.headline,
              slug: result.slug,
            });
          } else {
            refusedNow.push(result);
          }
        }
        setPublished([...publishedNow]);
        setRefused([...refusedNow]);
      }
      refreshAfterPublish([
        ...publishedNow.map((p) => p.leadId),
        ...refusedNow.map((r) => r.leadId),
      ]);
      // A published story is no longer selected: it has left the desk's work.
      if (publishedNow.length) {
        const gone = new Set(publishedNow.map((p) => p.leadId));
        onSelectionChange(selected.filter((id) => !gone.has(id)));
      }
      void all.refetch();
    } catch (error) {
      setBatchError(
        error instanceof Error ? error.message : "Could not publish the drafts.",
      );
    } finally {
      setRunning(false);
    }
  }

  /*
    "Publish anyway" for one refused story: the existing single-story publish,
    with exactly the warning keys the server returned for THIS story and the
    section it was confirmed in. Nothing else is acknowledged.
  */
  async function publishAnyway(item: PublishAllOutcome) {
    setAnywayId(item.leadId);
    try {
      const topic = sectionFor.get(item.leadId) ?? null;
      const answer = await publishLead({
        data: {
          leadId: item.leadId,
          ...(topic ? { topic } : {}),
          acknowledgedWarningKeys: (item.warnings ?? []).map((w) => w.key),
        },
      });
      if (answer.ok) {
        setPublished((prev) => [
          ...prev.filter((p) => p.leadId !== item.leadId),
          { leadId: item.leadId, headline: item.headline, slug: answer.slug },
        ]);
        setRefused((prev) => prev.filter((r) => r.leadId !== item.leadId));
        refreshAfterPublish([item.leadId]);
        onSelectionChange(selected.filter((id) => id !== item.leadId));
        void all.refetch();
      } else {
        setRefused((prev) =>
          prev.map((r) =>
            r.leadId === item.leadId
              ? {
                  leadId: r.leadId,
                  headline: r.headline,
                  ok: false,
                  error: answer.error,
                  ...("warnings" in answer && answer.warnings
                    ? { warnings: answer.warnings }
                    : {}),
                  ...("hard" in answer && answer.hard ? { hard: answer.hard } : {}),
                }
              : r,
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not publish.";
      setRefused((prev) =>
        prev.map((r) => (r.leadId === item.leadId ? { ...r, error: message } : r)),
      );
    } finally {
      setAnywayId(null);
    }
  }

  /*
    The kill, for the ticked stories. One reason for all of them, and the
    written-draft warning answered by the same press: the dialog marked each
    story that has a saved draft, so the one press is consent for exactly that.
  */
  async function runKill() {
    const ids = selectedRows.map((row) => row.lead_id);
    if (ids.length === 0) return;
    const overrideById: Record<number, string[]> = {};
    for (const row of selectedRows) {
      if (row.lead_status === "drafted" || row.has_body) {
        overrideById[row.lead_id] = ["lead-status-drafted"];
      }
    }
    setKilling(true);
    setKillError("");
    setUndoError("");
    setKilled([]);
    setKillFailures([]);
    try {
      const reason = killReason.trim();
      const results = await bulkKillLeads({
        data: {
          ids,
          ...(reason ? { killReason: reason } : {}),
          ...(Object.keys(overrideById).length ? { overrideById } : {}),
        },
      });
      const done = results.filter((result) => result.ok);
      const failed = results.filter((result) => !result.ok);
      const killedNow = done.map((result) => ({
        id: result.id,
        headline: rowById.get(result.id)?.headline ?? `#${result.id}`,
      }));
      setKilled(killedNow);
      setKillFailures(failed);
      setKillConfirming(false);
      setKillReason("");
      const gone = new Set(done.map((result) => result.id));
      onSelectionChange(selected.filter((id) => !gone.has(id)));
      refresh(["drafts-desk"]);
      refresh(["leads"]);
      refresh(["paper"]);
      refresh(["published-desk"]);
      void all.refetch();
    } catch (error) {
      setKillConfirming(false);
      setKillError(error instanceof Error ? error.message : "Could not kill the stories.");
    } finally {
      setKilling(false);
    }
  }

  /** The one Undo: every story this press killed goes back where it was. */
  async function runUndo() {
    const ids = killed.map((item) => item.id);
    if (ids.length === 0) return;
    setUndoing(true);
    setUndoError("");
    try {
      const results = await undoBulkKillLeads({ data: { ids } });
      const failed = results.filter((result) => !result.ok);
      if (failed.length) {
        setUndoError(
          failed.length === 1
            ? "One story could not be put back."
            : `${failed.length} stories could not be put back.`,
        );
        setKillFailures((prev) => [...prev, ...failed]);
        setKilled((prev) => prev.filter((item) => failed.some((f) => f.id === item.id)));
      } else {
        setKilled([]);
      }
      refresh(["drafts-desk"]);
      refresh(["leads"]);
      refresh(["paper"]);
      refresh(["published-desk"]);
      void all.refetch();
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : "Could not put the stories back.");
    } finally {
      setUndoing(false);
    }
  }

  /** The short warning the kill dialog prints beside a story, or "". */
  const selectedKillWarning = (row: (typeof allRows)[number]): string => {
    const state = deskDraftState({ ...row, story_readiness: row.story_readiness ?? null });
    if (state.running) return "Still being written";
    if (state.failed) return "Draft failed";
    if (row.lead_status === "drafted" || row.has_body) return "Has a written draft; it stays saved";
    return "";
  };

  const selectionStrip =
    listedLeadIds.length > 0 ? (
      <section aria-label="Selected drafts" className="drafts-bulk">
        <label className="drafts-bulk-all">
          <input
            type="checkbox"
            checked={allListedSelected}
            aria-label="Select all drafts shown"
            onChange={(event) => toggleAllListed(event.target.checked)}
          />
          <span>Select all shown</span>
        </label>
        {selected.length > 0 ? (
          <>
            <span className="drafts-bulk-count">{selected.length} selected</span>
            <button
              type="button"
              className="btn solid"
              disabled={running || killing || selectedCandidates.length === 0}
              aria-label={`Publish ${selectedCandidates.length} selected stories`}
              aria-busy={running}
              onClick={() => setConfirming(selectedCandidates)}
            >
              {running
                ? `Publishing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : `Publish ${selectedCandidates.length} selected`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={running || killing}
              aria-label={`Kill ${selected.length} selected stories`}
              onClick={() => {
                setKillError("");
                setKillConfirming(true);
              }}
            >
              Kill {selected.length} selected
            </button>
          </>
        ) : null}
        {selected.length > 0 && selectedCandidates.length < selected.length ? (
          <span className="drafts-bulk-note">
            {selected.length - selectedCandidates.length === 1
              ? "1 selected story is not finished, so it cannot print."
              : `${selected.length - selectedCandidates.length} selected stories are not finished, so they cannot print.`}
          </span>
        ) : null}
      </section>
    ) : null;

  if (
    candidates.length === 0 &&
    published.length === 0 &&
    refused.length === 0 &&
    killed.length === 0 &&
    killFailures.length === 0 &&
    !running &&
    !killing
  ) {
    // Nothing to publish or report -- but the selection strip may still be
    // needed to kill, so it is drawn on its own when the list has rows.
    return selectionStrip;
  }

  return (
    <section aria-label="Publish all drafts">
      {selectionStrip}

      {candidates.length > 0 || running ? (
        <div className="drafts-row">
          <div className="drafts-main">
            <h2 className="hl-head">Publish all drafts</h2>
            <p className="wire-sum">
              {candidates.length === 1
                ? "One finished story is ready to print."
                : `${candidates.length} finished stories are ready to print.`}
            </p>
            {running ? (
              /* The live region: the batch's own progress, in words. */
              <p className="published-line" role="status">
                Publishing story {Math.min(progress.done + 1, progress.total)} of{" "}
                {progress.total}. Each story takes a few seconds. Stay on this page.
              </p>
            ) : null}
            {batchError ? <p role="alert">{batchError}</p> : null}
          </div>
          {candidates.length > 0 ? (
            <div className="drafts-side">
              <button
                type="button"
                className="btn solid"
                disabled={running || killing}
                aria-busy={running}
                onClick={() => setConfirming(candidates)}
              >
                {running
                  ? `Publishing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                  : `Publish all drafts (${candidates.length})`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {killed.length > 0 ? (
        <p className="published-line" role="status">
          Killed {killed.length} {killed.length === 1 ? "story" : "stories"}.{" "}
          <button
            type="button"
            className="inline-link"
            disabled={undoing}
            onClick={() => void runUndo()}
          >
            {undoing ? "Putting back…" : "Undo"}
          </button>
        </p>
      ) : null}
      {killError ? <p role="alert">{killError}</p> : null}
      {undoError ? <p role="alert">{undoError}</p> : null}
      {killFailures.length > 0 ? (
        <div>
          <h2 className="hl-head">Not killed ({killFailures.length})</h2>
          {killFailures.map((item) => (
            <div className="drafts-row" key={`bulk-kill-no-${item.id}`}>
              <div className="drafts-main">
                <h3 className="hl-head">
                  {editorTitle(rowById.get(item.id)?.headline ?? `#${item.id}`)}
                </h3>
                {item.error ? <p role="alert">{item.error}</p> : null}
              </div>
              <div className="drafts-side">
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(item.id) }}
                  className="btn"
                  aria-label={`Open: ${rowById.get(item.id)?.headline ?? item.id}`}
                >
                  Open
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {published.length > 0 ? (
        <div>
          <h2 className="hl-head">Published ({published.length})</h2>
          {published.map((item) => (
            <div className="drafts-row" key={`publish-all-ok-${item.leadId}`}>
              <div className="drafts-main">
                <h3 className="hl-head">{editorTitle(item.headline)}</h3>
                <p className="published-line" role="status">
                  Published.{" "}
                  <Link
                    to="/articles/$slug"
                    params={{ slug: item.slug }}
                    className="inline-link"
                  >
                    Open the story
                  </Link>
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {refused.length > 0 ? (
        <div>
          <h2 className="hl-head">Not published ({refused.length})</h2>
          {refused.map((item) => (
            <div className="drafts-row" key={`publish-all-no-${item.leadId}`}>
              <div className="drafts-main">
                <h3 className="hl-head">{editorTitle(item.headline)}</h3>
                {item.error ? <p role="alert">{item.error}</p> : null}
                {/* A refusal with one warning carries that warning's sentence
                    as its error too; say it once. */}
                {(item.warnings ?? [])
                  .filter((warning) => warning.sentence.trim() !== (item.error ?? "").trim())
                  .map((warning) => (
                    <p key={warning.key}>{warning.sentence}</p>
                  ))}
              </div>
              <div className="drafts-side">
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(item.leadId) }}
                  className="btn"
                  aria-label={`Open: ${item.headline}`}
                >
                  Open
                </Link>
                {/* Rule 22: a warning has an "anyway" press. A hard refusal is
                    a wall, so it gets none. */}
                {item.warnings && item.warnings.length > 0 && !item.hard ? (
                  <button
                    type="button"
                    className="btn solid"
                    disabled={anywayId === item.leadId}
                    aria-label={`Publish anyway: ${item.headline}`}
                    onClick={() => void publishAnyway(item)}
                  >
                    {anywayId === item.leadId ? "Publishing…" : "Publish anyway"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <Dialog
        open={killConfirming}
        onClose={() => setKillConfirming(false)}
        title={`Kill ${selectedRows.length} ${selectedRows.length === 1 ? "story" : "stories"}?`}
        subtitle="Killed stories leave the desk and will not print."
        primaryLabel={`Yes, kill ${selectedRows.length}`}
        primaryDisabled={killing || selectedRows.length === 0}
        onPrimary={() => void runKill()}
        cancelLabel="Cancel"
      >
        <ul>
          {selectedRows.map((row) => {
            const warning = selectedKillWarning(row);
            return (
              <li key={row.lead_id}>
                {editorTitle(row.headline)}
                {warning ? <span className="warn-inline">{warning}</span> : null}
              </li>
            );
          })}
        </ul>
        <label>
          <span>Why? The reason is optional and is written on all of them.</span>
          <input
            value={killReason}
            onChange={(event) => setKillReason(event.target.value)}
            placeholder="No reason — leave this empty"
            aria-label="Why these stories are being killed"
          />
        </label>
      </Dialog>

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Publish these stories?"
        subtitle="Each story prints in the section shown beside it."
        primaryLabel={`Publish ${(confirming ?? []).length} ${
          (confirming ?? []).length === 1 ? "story" : "stories"
        }`}
        primaryDisabled={running || (confirming ?? []).length === 0}
        onPrimary={() => {
          const list = confirming ?? [];
          setConfirming(null);
          void run(list);
        }}
        cancelLabel="Cancel"
      >
        <ul>
          {(confirming ?? []).map((item) => (
            <li key={item.leadId}>
              {editorTitle(item.headline)} — {sectionName(item.topic)}
              {item.warning ? <span className="warn-inline">{item.warning}</span> : null}
            </li>
          ))}
        </ul>
      </Dialog>
    </section>
  );
}
