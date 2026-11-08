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
import { listDraftsDesk, listDraftsDeskPage } from "@/lib/news/desk";
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
  type DeskDraftFilter,
  type DeskDraftState,
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
