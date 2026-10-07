import { dailyScanCounts } from "@/lib/desk/daily-scan-counts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useDeferredValue, useMemo, useState } from "react";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ModelPicker } from "@/components/model-picker";
import { AddSourcesDialog, SourceKillPattern } from "@/components/dialogs/editor-dialogs";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  listLeads,
  listScans,
  checkOneSource,
  listSourcesPage,
  replacementCandidates,
  reviewSuggestedSources,
  runScan,
  setSourceStatus,
} from "@/lib/news/desk";
import { findReplacement } from "@/lib/news/editor-dialog-actions";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
import { badSourceKillsBySource } from "@/lib/news/editor-dialog-logic";
import { myDesk } from "@/lib/news/claim";
import { getDailyScanPolicy } from "@/lib/news/daily-scan";
import { sourceStatusUndoTo, type SingleRowStatus } from "@/lib/news/source-status-undo";
import { modelChoiceLabel, type StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import {
  dailyScheduleLabel,
  editorActionError,
  editorFetchError,
  keepsFailingNote,
  scanRowLine,
  suggestedOriginLine,
} from "@/lib/news/desk-copy";
import { keepsFailing } from "@/lib/news/source-rows";
import { candidateIsWatchedSource } from "@/lib/news/source-replacements";
import { applySections, editorSections } from "@/lib/news/sections";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { useDeskMutation } from "@/components/desk-action";
import { ActionButton, rowActionPhase } from "@/components/action-button";
import { invalidateDeskJobs, useDeskJobs } from "@/components/job-card-state";
import { DeskJobCard } from "@/components/JobCard";
import type { SourceRow } from "@/lib/news/types";

export const Route = createFileRoute("/desk/sources")({
  /*
    `?tab=` is here for the Command Center's "N more suggested" link, which has
    to land the editor on the list it is counting. Everywhere else links to
    this page without one and lands on the watch list, which is the default.
    An unknown value is dropped rather than trusted, so a hand-typed URL cannot
    open a group this screen does not have.
  */
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "accepted" | "proposed" | "rejected" } => ({
    tab:
      search.tab === "accepted" || search.tab === "proposed" || search.tab === "rejected"
        ? search.tab
        : undefined,
  }),
  component: SourcesPage,
});

function SourcesPage() {
  const search = Route.useSearch();
  const [sourceTab, setSourceTab] = useState<string>(search.tab ?? "accepted");
  const qc = useQueryClient();
  /*
    The search box the design draws beside the group filters, and the window the
    brief puts on this list (Unit CZ-long-lists).

    SOURCES IS THE LONGEST LIST ON THE DESK -- 1,588 suggested rows, some
    15,872px -- and every one of them used to be laid out. The screen now holds
    one page: the server applies the tab and this search, then cuts the first
    `sourcesShown` rows, so what arrives is a page rather than a list.

    THE SEARCH IS THE SERVER'S NOW. It used to run here over the rows already
    loaded, which was cheap while every row was loaded; with a window it would
    only ever search the page on screen, so a source filed below the fold would
    be unfindable. It goes to the server, and it is deferred so a fast typist
    sends one request per pause rather than one per letter.

    THE COUNTS COME WITH THE PAGE, counted over every source -- see
    `source-rows.ts`. A count taken here would be a count of the page, and the
    pills and "Files up to" both promise the size of the list.
  */
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourcesShown, setSourcesShown] = useState(PAGE_SIZE);
  const deferredSourceQuery = useDeferredValue(sourceQuery);
  const {
    data: sourcesPage,
    isPending,
    isError: listIsError,
    error: listError,
    refetch: refetchSources,
    isRefetching: refetchingSources,
  } = useQuery({
    queryKey: ["sources", sourceTab, deferredSourceQuery, sourcesShown],
    queryFn: () =>
      listSourcesPage({
        data: {
          limit: sourcesShown,
          offset: 0,
          filter: sourceTab,
          search: deferredSourceQuery,
        },
      }),
    placeholderData: keepPreviousData,
  });
  /*
    A stable empty array for the frames before the first page arrives. Written
    as a `useMemo` rather than a bare `?? []` because `killCounts` below is a
    memo over this array, and a fresh literal on every render would recompute
    the kill-pattern count on every render.
  */
  const sources = useMemo(() => sourcesPage?.rows ?? [], [sourcesPage]);
  const sourcesTotal = sourcesPage?.total ?? 0;
  const counts = sourcesPage?.counts;
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /*
    The row the dialog just added, which is drawn with the tint.

    `AddSourcesDialog` reports what it did in a sentence, not in an id: it adds
    through the same server function this screen would have called and never
    hands the new row back. So the tint is keyed on the watch list's own
    high-water mark -- the largest id on screen when the dialog said it had
    added -- rather than on an id the dialog cannot give. A newly saved source
    is minted with a higher id than every row already drawn, so the tint lands
    on the new row and on nothing else, and the next add moves the mark.
  */
  const [addedFloor, setAddedFloor] = useState<number | null>(null);
  /** The header's "+ Add a source" dialog (BJ3 item 3), open or shut. */
  const [addOpen, setAddOpen] = useState(false);
  /*
    Which sections a source joins, chosen here at the moment a source is
    *accepted*.

    Assigning a source to a section is a `SectionConfig` write, and
    `applySections` refuses anyone but the owner ("Only the owner can configure
    newspaper sections.") -- so this chooser is shown only when that same
    server function says `canEdit`. Accepting a source stays editor-level,
    exactly as it was; nothing about who may do what changed, only where the
    owner can do it from. Filing a source under a section at the moment it is
    *added* is on Server -> Sections (see the note at the dialog's mount).
  */
  const sectionsQuery = useQuery({
    queryKey: ["editor-sections"],
    queryFn: () => editorSections(),
  });
  const reportingSections = (sectionsQuery.data?.sections ?? []).filter(
    (s) => !["opinion", "about"].includes(s.key) && !s.replacementKey,
  );
  const canAssignSections = Boolean(sectionsQuery.data?.canEdit);
  const [rowKeys, setRowKeys] = useState<Record<number, string[]>>({});
  const { formatListDateTime } = usePaperDateFormatters();
  /*
    The right column: what the scan last did, and "Run scan now".

    This is the same `runScan` the Scan screen calls, with the same defaults --
    no scope, no pack, the desk's own model choice. It is not a second runner.
    The Scan screen is still where a run is scoped, paged and diagnosed; this
    panel is the one-press version for an editor who is already looking at the
    watch list and has just added a source.
  */
  const scans = useQuery({
    queryKey: ["scans", 1],
    queryFn: () => listScans({ data: { limit: 6, offset: 0 } }),
    refetchInterval: (q) => {
      const row = q.state.data?.rows?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  /*
    THE RUNNING SCAN'S JOB ROW (FB1, unit 4). `scan_runs` is the run record and
    the history; `desk_jobs` is where the stage list, the step, the percentage
    and the heartbeat live, which is what the card draws. Same reader as every
    other screen -- see `useDeskJobs`.
  */
  const deskJobs = useDeskJobs();
  const scanJob =
    (deskJobs.data ?? []).find(
      (job) => job.kind === "scan" && (job.status === "queued" || job.status === "running"),
    ) ?? null;
  /*
    What the Daily scan panel's "Runs" and "Model" rows read (Unit
    CZ-long-lists).

    Both are facts about the SCHEDULE, not about the last run, and both live in
    the daily scan policy. `getDailyScanPolicy` is owner-gated -- it answers
    `forbidden` to an editor -- so it is asked for only once `myDesk` has said
    the reader owns this desk, the same gate `daily-scan-settings.tsx` and
    `desk.published.tsx` already use. An editor gets the drawing's own default
    line rather than an empty pair of rows; that is the one case the drawing
    does not draw and is recorded in SPEC-GAPS-0681 (prefix CZ-long-lists).
  */
  const deskRole = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const isOwner = deskRole.data?.role === "owner";
  const scanPolicyQuery = useQuery({
    queryKey: ["daily-scan-policy"],
    queryFn: () => getDailyScanPolicy(),
    enabled: isOwner,
  });
  const scanPolicy =
    scanPolicyQuery.data && scanPolicyQuery.data.ok ? scanPolicyQuery.data.policy : null;
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanModel, setScanModel] = useState<StoryModelChoice>("auto");
  const [scanModelEffort, setScanModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  /*
    Unit U24: what the last per-row check said, and which row it belongs to.
    The editor pressed a row, so the answer is drawn on that row -- "Read OK
    now." or "Still failing: <the reason>" -- instead of a page-level notice
    that reads the same whichever source was pressed, or (as happened on the
    stand-in editorial day) nothing at all.
  */
  const [checkResult, setCheckResult] = useState<{
    id: number;
    ok: boolean;
    line: string;
  } | null>(null);
  const runScanNow = useMutation({
    mutationFn: () => runScan({ data: { modelChoice: scanModel, modelEffort: scanModelEffort } }),
    onSuccess: (res) => {
      if (res && "ok" in res && res.ok === false) {
        setScanNotice(res.error);
        return;
      }
      setScanNotice(null);
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      // FB1: the card for the scan just queued. See invalidateDeskJobs.
      invalidateDeskJobs(qc);
    },
    onError: (err) =>
      setScanNotice(err instanceof Error ? err.message : "Could not start that scan."),
  });
  /*
    "Check now" / "Retry" on one watch-list row.

    UNIT U24. This used to call `runScan` scoped to one source -- a whole
    manual scan: a scan run, a queued job, a model writing pass, leads filed,
    and a flat refusal if another scan happened to be open. Pressing Retry on
    one unreadable source therefore produced, on the stand-in editorial day, a
    failed scan report blaming the model provider for a page nothing could read,
    and said nothing at all about the row that was pressed.

    Now it asks the row's own question -- can the desk read this page, and has
    it changed since the answer? -- through `checkOneSource`, which is the
    scan's fetch path and nothing else: no model call, no job, no leads. The
    answer comes back to the row it belongs on (`checkResult`), because the
    editor pressed a row, not a page.
  */
  const checkOne = useMutation({
    mutationFn: (id: number) => checkOneSource({ data: id }),
    onSuccess: (res, id) => {
      setScanNotice(null);
      setCheckResult({
        id,
        ok: res.ok,
        line: res.line,
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err, id) =>
      setCheckResult({
        id,
        ok: false,
        line: err instanceof Error ? err.message : "Could not check that source.",
      }),
  });
  const sectionNames = (keys: string[]) =>
    keys.map((key) => reportingSections.find((s) => s.key === key)?.name ?? key).join(", ");
  /** Write the section assignments for one source; a no-op for a non-owner. */
  const assignSourceToSections = async (sourceId: number, keys: string[]) => {
    const saved = sectionsQuery.data;
    if (!saved?.canEdit || keys.length === 0) return { ok: true as const };
    const result = await applySections({
      data: {
        revision: saved.revision,
        sections: saved.sections.map((s) =>
          keys.includes(s.key) ? { ...s, sourceIds: [...new Set([...s.sourceIds, sourceId])] } : s,
        ),
      },
    });
    if (result.ok) await qc.invalidateQueries({ queryKey: ["editor-sections"] });
    return result;
  };
  /** Tick or untick one reporting section for one row's pending assignment. */
  const toggleRowKey = (rowId: number, key: string) =>
    setRowKeys((map) => {
      const keys = map[rowId] ?? [];
      return {
        ...map,
        [rowId]: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
      };
    });
  const clearRowKey = (rowId: number) =>
    setRowKeys((map) => {
      if (!(rowId in map)) return map;
      const next = { ...map };
      delete next[rowId];
      return next;
    });
  /*
    FB5: this one mutation is every single-row source action -- Pause, Resume,
    the row's Remove, and Accept/Drop from the suggested list -- and none of
    them said anything when the write failed (FB0-REPORT.md Table B, Sources:
    "Pause / Resume … SILENT FAIL", "Remove … SILENT FAIL", "Accept / Drop …
    SILENT FAIL"). It reports through the shared action family now: the reason
    the server gave, visibly, on every one of those presses.
  */
  const setStatus = useDeskMutation<
    Awaited<ReturnType<typeof setSourceStatus>>,
    { id: number; status: SingleRowStatus; from?: string }
  >({
    mutationFn: (input) => setSourceStatus({ data: { id: input.id, status: input.status } }),
    pending: "Saving…",
    done: (_result, input) =>
      input.status === "paused"
        ? "Paused: the desk skips this source until you resume it."
        : input.status === "accepted"
          ? "Accepted: the scanner may fetch this source."
          : "Removed: this source is out of the watch list.",
    /*
      FB7, item 1: "NO UNDO" on the row's Remove (FB0-REPORT.md Table B,
      Sources). Removing is one press and the source leaves the watch list and
      its row -- with nothing to press to get it back, on a screen whose own
      bulk path has offered an Undo all along.

      The way back is the status the row had, which is why the variables carry
      `from`: the mutation knows the new status and has no memory of the old
      one. It is offered for Remove only -- Pause already has its inverse
      ("Resume") drawn on the same row, and an Undo next to it would be two
      buttons for one press.
    */
    undo: (_result, input) => {
      const back = sourceStatusUndoTo(input);
      if (!back) return null;
      return {
        label: "Undo",
        // A block body, not an arrow expression: returning the mutation's own
        // result here would make `setStatus`'s type depend on itself.
        run: () => {
          setStatus.mutate({ id: input.id, status: back, from: "rejected" });
        },
      };
    },
    failedLead: "Could not change that source. ",
    after: async (_res, input) => {
      await qc.invalidateQueries({ queryKey: ["sources"] });
      const keys = rowKeys[input.id] ?? [];
      if (input.status !== "accepted" || !keys.length) {
        clearRowKey(input.id);
        return;
      }
      // Accept first, assign second: applySections refuses a source that is
      // not accepted yet, so this order is the only one that works.
      const assignment = await assignSourceToSections(input.id, keys);
      clearRowKey(input.id);
      setNotice(
        assignment.ok
          ? { kind: "ok", text: `Accepted and filed under ${sectionNames(keys)}.` }
          : {
              kind: "err",
              text: `Accepted, but filing it under ${sectionNames(keys)} failed: ${assignment.error}`,
            },
      );
    },
  });
  /*
    FB7, item 1. Which row pressed Pause / Resume / Remove / Accept / Drop.
    It is one mutation for four buttons in two components, so the pending state
    has to travel as data rather than be read off the hook in each row -- see
    the prop's own note on `WatchRows`.
  */
  const statusId = setStatus.isPending ? (setStatus.variables?.id ?? null) : null;
  /*
    FB7, item 1: "NO UNDO + no confirm" on the row's Remove. Removing takes a
    source off the watch list -- the scanner stops fetching it and its row
    leaves this screen -- and it used to be one press with nothing behind it.

    Two presses now, the desk's own two-step shape (`confirmId` on Opinion and
    Published): the first arms the row, the second does it. It is held here
    rather than in the row because the rows are drawn in a `.map` and cannot
    own state each; one id is all this needs, because only one row can be
    armed at a time.
  */
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const groups: {
    k: string;
    title: string;
    sub: string | null;
    acts: ("accepted" | "rejected")[];
  }[] = [
    {
      k: "accepted",
      title: "On watch",
      sub: "What the scanner is allowed to fetch. Tier A is official record; B is journalism; C is a discovery clue, never treated as fact.",
      acts: ["rejected"],
    },
    {
      k: "proposed",
      title: "Suggested sources",
      sub: "Pages the scan, the research pass and the Dark Desk found while they worked. Nothing is fetched until you accept it, and nothing here is a source until you say so.",
      acts: ["accepted", "rejected"],
    },
    {
      k: "rejected",
      title: "Rejected",
      sub: null,
      acts: ["accepted"],
    },
  ];

  /*
    "On watch" is two statuses, not one -- a paused source is still on the watch
    list, held, which is why the drawing's paused row carries Resume rather than
    Accept. That rule, and the difference between the two-status tab and the
    accepted-only "Files up to", moved to `source-rows.ts` with the rest of the
    screen's narrowing when the window did: the server now has to know both.
  */
  /*
    Which watch rows have a kill pattern under them (BJ3 item 3).

    The panel is what counts, and mounting it to find out would put "No leads
    killed from this source yet." under every row, add a line to every row, and
    cost one read per row. So the count is computed here from one read of the
    leads the screen did not otherwise need -- `listLeads` is the Queue's own
    reader, with no validator, so this adds no server function and no input
    contract -- and only rows with a count above zero mount the panel, which
    then re-reads for itself and prints both numbers.

    WHAT THIS COSTS: one extra `listLeads` query per visit to this screen, when
    at least one row is on watch, carrying the whole lead row (the Queue's
    columns, including the duplicate-comparison block). It is gated on
    `enabled` so an empty watch list pays nothing, and it is not invalidated
    separately -- `["leads"]` is the key the scan runner already invalidates.

    WHAT IT CANNOT DO: `badSourceKillsBySource` applies the same identity,
    linkage, reason test and 500-kill window as the panel, so the two agree
    about the same rows -- see its own note. The gate can still be *stale*
    against the panel's fresh read, and the panel wins, because the panel is
    what prints.
  */
  const killPatternWanted = (counts?.accepted ?? 0) > 0;
  const leadsForKills = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
    enabled: killPatternWanted,
  });
  const killCounts = useMemo(
    () =>
      badSourceKillsBySource(
        // Recomputed from the page inside the memo rather than from the rows
        // the section renders, because that array is new on every render and
        // would make the memo recompute every render. A page is the right
        // scope: the count only ever draws on a row that is on the screen.
        sources
          .filter((s) => s.status === "accepted" || s.status === "paused")
          .map((s) => ({ id: s.id, url: s.url })),
        leadsForKills.data ?? [],
      ),
    [sources, leadsForKills.data],
  );
  return (
    <DeskShell title="Sources" kicker="What the desk watches, and whether it could check" hideTitle>
      {/*
        The drawn header: kicker, title, the page's own action, rule. The
        drawing puts "+ Add a source" on the title line, and phase 4's
        `AddSourcesDialog` is what it opens -- one control here and one dialog
        behind it, which is what the drawing draws. The plus is a literal
        character in the label: the walks match this button by its exact text,
        and the dialog's own headings carry no plus to confuse a text match.

        The title is the drawing's "Sources & scan" (BJ2 item 4). Two walks
        moved with it -- sources-desk-e2e.mjs and scan-desk-e2e.mjs wait on a
        level-1 heading by name, which is a selector naming the control the
        design renamed, so it moved in the same commit.
      */}
      <div className="astra-head">
        <div>
          <p className="kick">What the desk watches, and whether it could check</p>
          <h1 className="h1">Sources &amp; scan</h1>
        </div>
        <div className="astra-head-acts">
          <Link className="btn quiet" to="/desk/scan">Scan history →</Link>
          {/*
            The inventory screen has existed since the brief's first outcome
            ("inventory all accepted source records ... review status"), but it
            had no link from anywhere an editor actually stands: a semantic pass
            over the desk home, navigation and this screen found only /desk/sources
            links. The full accepted-source inventory is reachable here, in the
            header's own action cluster beside Scan history, rather than behind a
            new nav framework or a redesign.
          */}
          <Link className="btn quiet" to="/desk/inventory">Source inventory →</Link>
          <button type="button" className="btn solid" onClick={() => setAddOpen(true)}>
            + Add a source
          </button>
        </div>
      </div>
      <p className="lede">
        Manage the pages the scanner reads on every pass.
      </p>
      {/*
        The add dialog, behind the header's "+ Add a source" (BJ3 item 3).

        Phase 4's `AddSourcesDialog` replaced BJ2's temporary
        `#astra-add-source` panel when `origin/main` merged. Its four tabs are
        the behaviors the panel held and two it did not: one source, a pasted
        list, a file, and "ask the AI to find sources" -- so the panel's
        "Upload a file" and its bulk registry import are both still here, as
        the README's line 337 says ("includes bulk import"), and the find
        path landed with them.

        `onDone` is why this is mounted with a callback rather than as a bare
        trigger: the screen prints the dialog's own sentence in its notice bar
        (the walks wait on it) and re-reads the watch list, because the add
        happened inside the dialog.

        One behavior the panel had is NOT here: the owner-only "Assign to
        sections" picker on the single-source form. Filing a brand-new source
        under a section is reachable without leaving a page at Server ->
        Sections, which is the surface `sections-source-add-e2e.mjs` drives
        ("adding a source from inside a section calls the Sources page's own
        server function"), and it is where the owner's report asked for it.
        Adding a fourth control to the drawn watch-list row to keep the old
        one would have cost the row its single line (BJ3 item 1).
      */}
      <AddSourcesDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={(note) => {
          setNotice({ kind: "ok", text: note });
          setAddedFloor(sources.reduce((high, s) => Math.max(high, s.id), 0));
          void qc.invalidateQueries({ queryKey: ["sources"] });
          requestAnimationFrame(() => {
            document.getElementById("on-watch")?.scrollIntoView({ block: "start", behavior: "smooth" });
          });
        }}
      />
      {/*
        FB7, item 1 (FB0-REPORT.md Table B, Sources: the notice line was
        "SILENT (a11y)" -- "no role at all"). Everything this screen says in one
        sentence lands here: the add dialog's outcome, the section-assignment
        follow-up, "Accepted, but filing it under X failed". A sighted editor
        could read it; a screen reader was never told it had changed.

        `alert` for a failure and `status` for an outcome, not `role="status"`
        for both: a polite region queues behind whatever is being read, and a
        failure is the one sentence on this screen that should interrupt.
        Exactly one region is drawn, because the line is one.
      */}
      {notice ? (
        <p
          className={"note" + (notice.kind === "err" ? " err" : "")}
          role={notice.kind === "err" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      {/*
        The design draws this screen as two columns: the watch list, and the
        scanner that reads it. The right column is the same information the Scan
        screen shows, condensed to the one thing an editor wants while they are
        already looking at the list -- did it run, and run it now.
      */}
      <div className="astra-split">
        <div>
          {/*
            Filters, then the search box on its own line under them, at the top
            of the left column -- the drawing's order (README 332-334). The
            search box sits in a second `.astra-toolbar` so it keeps the
            drawing's own width instead of filling the column: the list beneath
            it is what wants the width.
          */}
          <div className="astra-toolbar">
            <div className="astra-seg" role="group" aria-label="Source groups">
              {groups.map((g) => (
                <button
                  key={g.k}
                  type="button"
                  className={"astra-seg-opt" + (sourceTab === g.k ? " on" : "")}
                  aria-pressed={sourceTab === g.k}
                  onClick={() => setSourceTab(g.k)}
                >
                  {g.k === "accepted" ? "On watch" : g.k === "proposed" ? "Suggested" : "Rejected"}
                  {" · "}
                  {g.k === "accepted"
                    ? (counts?.accepted ?? 0)
                    : g.k === "proposed"
                      ? (counts?.proposed ?? 0)
                      : (counts?.rejected ?? 0)}
                </button>
              ))}
              {/*
                The design's fourth filter. It is not a fourth status -- a source
                cannot be "could not check" -- it is the on-watch rows the last
                pass failed to fetch, which is the list an editor has to work
                through before the scan can be trusted to have covered the town.
                Rejected rows are excluded: nobody is waiting on those.
              */}
              <button
                type="button"
                className={"astra-seg-opt" + (sourceTab === "unchecked" ? " on" : "")}
                aria-pressed={sourceTab === "unchecked"}
                onClick={() => setSourceTab("unchecked")}
              >
                Could not check{" · "}
                {counts?.unchecked ?? 0}
              </button>
            </div>
          </div>
          <div className="astra-toolbar">
            <input
              type="search"
              className="astra-search"
              aria-label="Search sources"
              placeholder="Search the watch list"
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
            />
          </div>
      {listIsError && sources.length === 0 ? (
        <ScreenError
          message={listError instanceof Error ? listError.message : "Could not load sources."}
          onRetry={() => void refetchSources()}
          retrying={refetchingSources}
        />
      ) : isPending && sources.length === 0 ? (
        <ListSkeleton rows={5} />
      ) : (
        <>
          {groups.map((g) => {
          /*
            "Could not check" shows the accepted group, narrowed to the rows
            that carry a fetch error, so it is the same table with the same
            actions -- Accept and Drop stay where they are, because a source
            that cannot be read may still be worth dropping.

            The rows ARE the page: the tab and the search box were applied on
            the server (`listSourcesPage`), which is where they have to be now
            that the screen holds a window rather than the whole list. So the
            only group with rows is the one this tab names.
          */
          const forTab = sourceTab === "unchecked" ? "accepted" : sourceTab;
          if (g.k !== forTab) return null;
          const rows = sources;
          /*
            The heading's number is the whole tab, not the page. The pills
            above read the same counts, so the two agree at every page.
          */
          const tabTotal =
            sourceTab === "unchecked"
              ? (counts?.unchecked ?? 0)
              : sourceTab === "accepted"
                ? (counts?.accepted ?? 0)
                : sourceTab === "proposed"
                  ? (counts?.proposed ?? 0)
                  : (counts?.rejected ?? 0);
          return (
                <section
                  key={g.k}
                  id={g.k === "accepted" ? "on-watch" : "suggested"}
                  className="src-sec"
                >
              <SecHead
                title={sourceTab === "unchecked" ? "Could not check" : g.title}
                count={tabTotal}
                sub={
                  sourceTab === "unchecked"
                    ? "On the watch list, and the last pass could not read them. A source the scanner cannot fetch is not yet a source."
                    : (g.sub ?? undefined)
                }
              />
              {g.k === "accepted" && !rows.length ? (
                <p className="wire-sum">
                  {sourceTab === "unchecked"
                    ? "Every source on the watch list was readable on the last pass."
                    : deferredSourceQuery.trim()
                      ? "No source on this list matches that search."
                      : "Nothing on watch yet — add a URL above."}
                </p>
              ) : g.k === "proposed" ? (
                /* The one list built for volume: 175 rows were waiting when
                   this was written, so it carries a select-all, a per-press
                   Saving/Saved/Failed line, and one transaction per press. */
                    <SuggestedSources
                      rows={rows}
                      canAssign={canAssignSections}
                      options={reportingSections}
                    />
              ) : g.k === "accepted" ? (
                <WatchRows
                  rows={rows}
                      justAddedSince={addedFloor}
                      killCounts={killCounts}
                  checkingId={checkOne.isPending ? (checkOne.variables ?? null) : null}
                  statusId={statusId}
                  checkResult={checkResult}
                  onCheck={(id) => {
                    setCheckResult(null);
                    checkOne.mutate(id);
                  }}
                  confirmRemoveId={confirmRemove}
                  onConfirmRemove={setConfirmRemove}
                  onStatus={(id, status, from) => setStatus.mutate({ id, status, from })}
                />
              ) : (
                <SourceTable
                  rows={rows}
                  acts={g.acts}
                      justAddedSince={addedFloor}
                  statusId={statusId}
                  confirmRemoveId={confirmRemove}
                  onConfirmRemove={setConfirmRemove}
                  onStatus={(id, status, from) => setStatus.mutate({ id, status, from })}
                  /* Only where an Accept button sits, because only there can
                     the tick be saved in the same step. */
                  assignUI={
                    canAssignSections && g.acts.includes("accepted")
                      ? {
                          options: reportingSections,
                          picked: (rowId) => rowKeys[rowId] ?? [],
                          toggle: toggleRowKey,
                        }
                      : null
                  }
                />
              )}
            </section>
          );
          })}
          {/*
            The list is windowed (Unit CZ-long-lists), so the footer says how
            much of this tab is on the screen and offers the next page. Not
            drawn: the handoff's only list footer is the Queue's own "Load
            more" (Desk Screens.dc.html:67), and the brief names this button,
            so this is the brief's wording. Recorded in SPEC-GAPS-0681.md.
          */}
          {sourcesTotal > 0 ? (
            <div className="astra-list-foot">
              <span>{showingLine(sources.length, sourcesTotal, "sources")}</span>
              {sources.length < sourcesTotal ? (
                <button
                  type="button"
                  className="astra-list-more"
                  onClick={() => setSourcesShown((n) => n + PAGE_SIZE)}
                >
                  Show {PAGE_SIZE} more
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
        </div>
        <aside className="astra-col">
          {/*
            The Daily scan panel, drawn with a 2px yellow border because on this
            screen it is the one thing that acts on everything else.

            Its three rows are the drawing's own (Unit CZ-long-lists): when the
            scan goes out, how many files it may reach, and which model it will
            use. "Runs" used to print the number of runs and "Last run" the
            newest one -- neither is drawn, and the history is the panel below.
            The schedule and the model both come from the daily scan policy,
            which only the owner may read; an editor gets the drawing's default.
          */}
          <div className="astra-panel hot">
            <h2 className="astra-panel-h">Daily scan</h2>
            <dl className="astra-kv ruled">
              <dt>Runs</dt>
              <dd>{dailyScheduleLabel(scanPolicy)}</dd>
            </dl>
            {dailyScanCounts(scanPolicy).map((row) => (
              <dl className="astra-kv ruled" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </dl>
            ))}
            <p className="astra-note">Read and filed counts are from the latest scan.</p>

            <dl className="astra-kv ruled">
              <dt>Model</dt>
              <dd>{scanPolicy ? modelChoiceLabel(scanPolicy.runtime, "scan") : "Automatic"}</dd>
            </dl>
            <p className="astra-note">Scans file leads only. They never draft or publish.</p>
            <div className="mb-3 max-w-xl">
              <ModelPicker
                scope="scan"
                label="Model for this scan"
                value={scanModel}
                onChange={setScanModel}
                effort={scanModelEffort}
                onEffortChange={setScanModelEffort}
              />
            </div>
            {scanNotice ? (
              <p className="note err" role="alert">
                {scanNotice}
              </p>
            ) : null}
            <div className="astra-panel-acts">
              <InkButton disabled={runScanNow.isPending} onClick={() => runScanNow.mutate()}>
                {runScanNow.isPending ? "Starting…" : "Run scan now"}
              </InkButton>
            </div>
            {/*
              FB1b, item 3: THE RUNNING SCAN'S CARD, BESIDE THE BUTTON THAT
              STARTED IT.

              It was one panel further down, under "Previous scans", so the
              press changed nothing in view. Same reader as everywhere else
              (FB1, unit 3), so the bar, the chip row, the stall rule and Cancel
              are the drawn card's and not a second rendering of the same row.
            */}
            {/*
              FB7, item 2: NOT `compact`.

              This is where "Add & run first check" in the add-sources dialog
              lands and where a source's first check is watched -- the one
              place an editor looks after adding a source. The compact card
              drops the stage chip row (JobCard.tsx: `!compact && job.stages`),
              and the Scan screen draws this exact job at full size already, so
              the first check named the same stages on one screen and none on
              the other. Opinion and Drafts made the same swap; this is the
              last of them.
            */}
            {scanJob ? (
              <div className="sources-scan-card">
                <DeskJobCard job={scanJob} />
              </div>
            ) : null}
          </div>
          {/*
            Previous scans: five rows, and no link. The drawing draws the list
            and nothing under it (Unit CZ-long-lists removed the "All previous
            scans" press that used to sit here); the Scan screen is still the
            desk's own history, reached from the rail, and a second copy of its
            paging and diagnostics here would be a second thing to keep right.
          */}
          <div className="astra-panel">
            <h2 className="astra-panel-h">Previous scans</h2>
            {scans.isPending && !scans.data ? (
              <p className="astra-note">Loading…</p>
            ) : (scans.data?.rows ?? []).length === 0 ? (
              <p className="astra-note">No scan has run yet.</p>
            ) : (
              <ul className="astra-plain">
                {(scans.data?.rows ?? []).slice(0, 5).map((run) => (
                  <li key={run.id}>
                    <span className="astra-log-t">
                      {run.started_at ? formatListDateTime(run.started_at) : "—"}
                    </span>
                    {/*
                      FB1, unit 4: A RUNNING ROW SHOWS ITS LIVE COUNT.

                      It used to read the literal "Running now" for every open
                      run, and the count only appeared once the run finished.
                      Worse, the row was written ONLY on completion, so the
                      moment a scan started the row said `0 fetched` -- and
                      anything reading it through `scanCountsLine` /
                      `scanZeroWhy` printed "0 fetched · No sources were
                      fetched" about a scan that was hard at work. The scan
                      worker now writes `sources_fetched` / `sources_attempted`
                      as it goes (see `noteSourceProgress` in desk.ts), so the
                      open row is a live count and this is where it shows.

                      A run whose count is still zero says so in words that do
                      not contradict themselves -- "Starting" rather than
                      "0 fetched", and never "No sources were fetched" about a
                      run that has not stopped trying.
                    */}
                    <span className="astra-row-meta">{scanRowLine(run)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </DeskShell>
  );
}

/**
 * A multi-select of the newspaper sections a source can feed.
 *
 * A `fieldset`/`legend` rather than a bare list of checkboxes, so a screen
 * reader announces the group before each section name; each box keeps its own
 * `<label>`, so a click on the word works and the name is the accessible name.
 *
 * Reporting sections only: Opinion and About are written by people, and a
 * replacement section is a merged-away key that no longer reads anything.
 */
function SectionPicker({
  legend,
  hint,
  options,
  picked,
  onToggle,
  disabled,
}: {
  legend: string;
  hint: string;
  options: { key: string; name: string }[];
  picked: string[];
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  if (!options.length) return null;
  return (
    <fieldset className="src-sections mt-2 min-w-0 rounded border border-rule px-3 py-2">
      <legend className="px-1 font-semibold">{legend}</legend>
      <p className="meta">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {options.map((s) => (
          <label key={s.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.includes(s.key)}
              disabled={disabled}
              onChange={() => onToggle(s.key)}
            />
            {s.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Which filter bucket a suggestion falls in; anything unknown is "unrecorded". */
function suggesterKey(
  by: string | null | undefined,
): "scan" | "research" | "dark" | "editor" | "unrecorded" {
  return by === "scan" || by === "research" || by === "dark" || by === "editor" ? by : "unrecorded";
}

/*
  FB7, item 1. `SingleRowStatus` and the rule that decides whether a press has
  a way back live in `lib/news/source-status-undo.ts`, so the rule can be
  tested without a React tree -- see the note there.
*/

/**
 * Remove, in two presses, with a way back afterwards (FB7, item 1).
 *
 * "Remove" took a source off the watch list in one press with no confirm and
 * no Undo -- FB0-REPORT.md Table B's "SILENT FAIL + NO UNDO + no confirm".
 * The press is armed here and the done toast carries the Undo; this is the
 * desk's own two-step shape (`confirmId` on Opinion and Published) rather than
 * a dialog, because the row it is about is right there and a modal would take
 * the editor off it.
 *
 * One component for all three Remove buttons on this screen (the paused row's,
 * the active row's and the one behind "More"), so the wording and the arming
 * cannot drift apart between them.
 */
function RemoveAction({
  label,
  armed,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  label: string;
  armed: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!armed) {
    return (
      <ActionButton
        tone="quiet"
        phase="idle"
        disabled={busy}
        disabledReason={busy ? "Another change to this source is still being saved." : null}
        onAct={onAsk}
      >
        {label}
      </ActionButton>
    );
  }
  return (
    <>
      {/*
        Unit UI1a2. The second press is the one that does the work, so it is the
        one that carries the states: "Removing…" with a spinner and the button
        disabled while the write is in flight. Its DONE is the row's -- a
        removed source leaves the watch list, and the list's own notice is what
        says so; there is deliberately no second green "Removed" drawn on a
        button that is about to be unmounted.
      */}
      <ActionButton
        tone="primary"
        phase={rowActionPhase({ isPending: busy })}
        workingLabel="Removing…"
        onAct={onConfirm}
      >
        Yes, remove
      </ActionButton>
      <ActionButton tone="quiet" phase="idle" onAct={onCancel}>
        Keep
      </ActionButton>
    </>
  );
}

const SUGGESTER_FILTERS: {
  k: "all" | ReturnType<typeof suggesterKey>;
  label: string;
  none: string;
}[] = [
  { k: "all", label: "Anyone", none: "Nothing is waiting for review." },
  { k: "scan", label: "The scan", none: "No suggestions from the scan are waiting." },
  {
    k: "research",
    label: "The research pass",
    none: "No suggestions from the research pass are waiting.",
  },
  { k: "dark", label: "The Dark Desk", none: "No suggestions from the Dark Desk are waiting." },
  {
    k: "unrecorded",
    label: "Not recorded",
    none: "No suggestions are waiting without a recorded suggester.",
  },
];

/**
 * The Suggested sources list: a pile of suggestions an editor can actually
 * clear, not a list to click through one at a time.
 *
 * WHAT IT IS FOR. Production held 175 waiting suggestions, all of them from
 * the scan, none of them reviewed, and the screen showed a title and a URL --
 * so the only way to decide was to open each page. This shows the reason the
 * pass recorded, who suggested it, which lead it came from and the section it
 * guessed, which is the material a decision needs. Several rows can be decided
 * at once.
 *
 * ONE PRESS, ONE TRANSACTION. Every button here calls `reviewSuggestedSources`
 * with the whole selection: status and section link are written together, so a
 * failure changes nothing and this screen can say "Nothing was changed" and be
 * telling the truth. The old path -- accept, then assign -- could leave a batch
 * half-filed with no way to see which rows landed.
 *
 * The section picker is owner-only, the same rule as everywhere else that
 * writes `section_sources`. An editor without it still accepts and rejects;
 * the guess is shown to them as a note rather than as a control they cannot
 * use.
 */
function SuggestedSources({
  rows,
  canAssign,
  options,
}: {
  rows: SourceRow[];
  canAssign: boolean;
  options: { key: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [who, setWho] = useState<"all" | ReturnType<typeof suggesterKey>>("all");
  const [rowSection, setRowSection] = useState<Record<number, string>>({});
  const [rowNote, setRowNote] = useState<Record<number, string>>({});
  const [batchSection, setBatchSection] = useState("");
  const [press, setPress] = useState<{ phase: "saving" | "ok" | "err"; text: string } | null>(null);

  const nameOf = (key: string) => options.find((o) => o.key === key)?.name ?? key;
  /*
    The model's section guess, used as the picker's starting value -- but only
    when this newsroom still files under that key. A guess for a section that
    has since been renamed or merged away is a value this select cannot show
    and the accept would refuse, so it is dropped here and the picker starts
    empty rather than preselected with something that cannot be saved.
  */
  const guessFor = (row: SourceRow) =>
    row.proposed_section && options.some((o) => o.key === row.proposed_section)
      ? row.proposed_section
      : "";
  const sectionFor = (row: SourceRow) => rowSection[row.id] ?? guessFor(row);

  const review = useMutation({
    mutationFn: (input: {
      ids: number[];
      decision: "accepted" | "rejected";
      sectionKey?: string;
      note?: string;
    }) => reviewSuggestedSources({ data: input }),
    onMutate: (input) =>
      setPress({
        phase: "saving",
        text:
          input.ids.length === 1
            ? `Saving "${rows.find((r) => r.id === input.ids[0])?.title ?? "that suggestion"}"…`
            : `Saving ${input.ids.length} suggestions…`,
      }),
    onSuccess: (res, input) => {
      if (!res.ok) {
        // The server says nothing was written; repeat it here rather than
        // letting the editor work out which half landed.
        setPress({ phase: "err", text: `Nothing was changed: ${res.error}` });
        return;
      }
      const n = input.ids.length;
      const one =
        n === 1 ? (rows.find((r) => r.id === input.ids[0])?.title ?? "That suggestion") : null;
      const noteSaved = input.note ? " The note was saved with it." : "";
      const verb = input.decision === "accepted" ? "Accepted" : "Rejected";
      const what = one ? `"${one}"` : `${n} suggestions`;
      const where =
        input.decision === "accepted"
          ? res.sectionName
            ? ` and filed ${one ? "it" : "them"} under ${res.sectionName}`
            : " onto the watch list"
          : "";
      setPress({ phase: "ok", text: `${verb} ${what}${where}.${noteSaved}` });
      setSelected([]);
      setRowNote({});
      setRowSection({});
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      // A thrown error is the boundary, not the server's own refusal: an
      // expired session, or a payload the validator refused (the batch cap).
      const raw = err instanceof Error ? err.message : "";
      setPress({
        phase: "err",
        text:
          raw === "Unauthorized"
            ? "Nothing was changed: the session expired. Sign in again, then retry."
            : `Nothing was changed: ${
                editorActionError(raw, "review those suggestions") ?? "could not reach the desk."
              }`,
      });
    },
  });

  /*
    `rows` is the page, not the list (Unit CZ-long-lists). So "Select all 25"
    selects the rows on the screen and says so -- which is what the label has
    always done, since it prints the number it will pick. Selecting across a
    window would need the other tabs' rows, which the screen no longer holds.
  */
  const visible = who === "all" ? rows : rows.filter((r) => suggesterKey(r.proposed_by) === who);
  const allPicked = visible.length > 0 && visible.every((r) => selected.includes(r.id));
  const togglePicked = (id: number) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const noteFor = (row: SourceRow) => rowNote[row.id]?.trim() || undefined;
  const decide = (
    ids: number[],
    decision: "accepted" | "rejected",
    sectionKey?: string,
    note?: string,
  ) => {
    if (!ids.length) return;
    review.mutate({ ids, decision, sectionKey, note });
  };

  return (
    <>
      <div className="row-acts static" aria-label="Decide several suggestions at once">
        <InkButton
          disabled={!selected.length || review.isPending}
          onClick={() =>
            decide(selected, "accepted", canAssign ? batchSection || undefined : undefined)
          }
        >
          Accept selected{canAssign && batchSection ? ` to ${nameOf(batchSection)}` : ""}
        </InkButton>
        <InkButton
          tone="ghost"
          disabled={!selected.length || review.isPending}
          onClick={() => decide(selected, "rejected")}
        >
          Reject selected
        </InkButton>
        <InkButton
          tone="ghost"
          disabled={!visible.length || review.isPending}
          onClick={() => setSelected(allPicked ? [] : visible.map((r) => r.id))}
        >
          {allPicked ? "Clear selection" : `Select all ${visible.length}`}
        </InkButton>
        {canAssign && options.length ? (
          <label className="meta-inline">
            Section for the batch
            <select
              className="ml-2"
              value={batchSection}
              disabled={review.isPending}
              onChange={(e) => setBatchSection(e.target.value)}
            >
              <option value="">No section</option>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="filters" aria-label="Who suggested these sources">
        {SUGGESTER_FILTERS.map((f) => {
          const count =
            f.k === "all"
              ? rows.length
              : rows.filter((r) => suggesterKey(r.proposed_by) === f.k).length;
          return (
            <button
              key={f.k}
              className={"filter" + (who === f.k ? " on" : "")}
              aria-pressed={who === f.k}
              onClick={() => setWho(f.k)}
            >
              {f.label} {count}
            </button>
          );
        })}
      </div>
      {press ? (
        <p className={"note" + (press.phase === "err" ? " err" : "")} role="status">
          {press.text}
        </p>
      ) : null}
      {!rows.length ? (
        <p className="wire-sum">
          Nothing is waiting for review. The scan, the research pass and the Dark Desk file what
          they find here as they work.
        </p>
      ) : !visible.length ? (
        <p className="wire-sum">{SUGGESTER_FILTERS.find((f) => f.k === who)?.none}</p>
      ) : (
        <table className="ltable">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Select</span>
              </th>
              <th>Suggested source</th>
              <th>Why it was suggested</th>
              <th>Suggested by</th>
              <th>Section</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const picked = sectionFor(s);
              return (
                <tr key={s.id} className="lead-tr">
                  <td className="td-meta" data-label="Select">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      disabled={review.isPending}
                      aria-label={`Select ${s.title}`}
                      onChange={() => togglePicked(s.id)}
                    />
                  </td>
                  <td className="td-hl" data-label="Suggested source">
                    <span className="src-t">{s.title}</span>
                    <span className="meta-inline block">Kind: {s.kind || "unclassified"} · Tier: {s.tier || "unclassified"}. Kind describes the source; Tier describes its evidence level.</span>
                    <span className="meta-inline block">
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                        {s.url}
                      </a>
                    </span>
                  </td>
                  <td className="td-meta" data-label="Why">
                    {/*
                      A row suggested before 0.6.70 has no reason on it. Saying
                      so is the point -- 175 of them were waiting, and a blank
                      cell would read as "the reason is nothing".
                    */}
                    {s.proposed_reason ?? "No reason was recorded when this was suggested."}
                    {s.review_note?.trim() ? (
                      <p className="astra-row-meta">Source review: {s.review_note}</p>
                    ) : null}
                  </td>
                  <td className="td-meta" data-label="Suggested by">
                    {suggestedOriginLine(s)}
                    {s.proposed_lead_id != null ? (
                      <>
                        {" "}
                        <Link
                          to="/desk/story/$leadId"
                          params={{ leadId: String(s.proposed_lead_id) }}
                          className="inline-link"
                        >
                          Open the lead
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td className="td-meta" data-label="Section">
                    {canAssign ? (
                      <select
                        aria-label={`Section for ${s.title}`}
                        value={picked}
                        disabled={review.isPending}
                        onChange={(e) =>
                          setRowSection((map) => ({ ...map, [s.id]: e.target.value }))
                        }
                      >
                        <option value="">No section</option>
                        {options.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    ) : s.proposed_section ? (
                      `Guessed ${s.proposed_section}`
                    ) : (
                      "No section guessed"
                    )}
                  </td>
                  <td className="td-acts" data-label="Actions">
                    <input
                      className="mb-1 w-full"
                      value={rowNote[s.id] ?? ""}
                      disabled={review.isPending}
                      aria-label={`Review note for ${s.title}`}
                      placeholder="Note (optional)"
                      onChange={(e) => setRowNote((map) => ({ ...map, [s.id]: e.target.value }))}
                    />
                    <span className="row-acts">
                      <InkButton
                        tone="quiet"
                        disabled={review.isPending}
                        onClick={() =>
                          decide(
                            [s.id],
                            "accepted",
                            canAssign ? picked || undefined : undefined,
                            noteFor(s),
                          )
                        }
                      >
                        {canAssign && picked ? `Accept to ${nameOf(picked)}` : "Accept"}
                      </InkButton>
                      <InkButton
                        tone="quiet"
                        disabled={review.isPending}
                        onClick={() => decide([s.id], "rejected", undefined, noteFor(s))}
                      >
                        Reject
                      </InkButton>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/** The host of a source URL, without `www.`, for the drawn "url · kind" line.
 *  The full URL is still the link's `href`, so shortening the label costs the
 *  editor nothing -- and the `↗` after it is the drawing's Open ↗, which is why
 *  a failed row does not carry a fourth button to the same place. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/**
 * The On watch list, as the drawing draws it (README 332-334, capture
 * `desk-18-sources-light.png`).
 *
 * One row: the name, then "host ↗ · kind", then a state chip and the note that
 * explains it, then the actions. The chip is derived from what the desk already
 * recorded, never from a new column:
 *
 * - `last_error` is "Could not check", with the plain-English reason
 *   `editorFetchError` gives it.
 * - `new_since_last_pass` (0.6.72, `listSources`) is "Changed: 2 new items"
 *   against a source that was fetched and had not moved, which is "No change".
 * - a paused row is "Paused" with Resume in place of Pause.
 *
 * Retry is the primary button on a row that failed, because that is the one
 * action the row is waiting for; Check now is quiet, because a source that
 * reads fine does not need pressing. Drop is drawn as "Remove".
 */
function WatchRows({
  rows,
  justAddedSince,
  killCounts,
  checkingId,
  statusId,
  confirmRemoveId,
  onConfirmRemove,
  checkResult,
  onCheck,
  onStatus,
}: {
  rows: SourceRow[];
  /** The watch list's high-water mark when the add dialog last reported a save. */
  justAddedSince?: number | null;
  /**
   * The rows with a kill pattern, from `badSourceKillsBySource`. A row absent
   * from the map has no kill from it and mounts no panel.
   */
  killCounts?: Map<number, { badSource: number; killedFromSource: number }>;
  /** The row a check is in flight for, so only that row says "Checking…". */
  checkingId: number | null;
  /**
   * The row a Pause / Resume / Remove write is in flight for (FB7, item 1).
   *
   * `setStatus` is one mutation for four buttons, so it carries one
   * `isPending`; `variables.id` is which row pressed it. Every one of those
   * presses used to leave its button enabled and worded exactly as it was, so
   * one row's write in flight left four buttons -- and every other row's --
   * looking dead but pressable, and a second press re-sent the same change.
   */
  statusId: number | null;
  /** The row whose Remove has been pressed once and is waiting on the second. */
  confirmRemoveId: number | null;
  onConfirmRemove: (id: number | null) => void;
  /**
   * What the last per-row check answered, so the row that was pressed says it
   * (unit U24). Null before any press, and cleared when a new one starts.
   */
  checkResult: { id: number; ok: boolean; line: string } | null;
  onCheck: (id: number) => void;
  /** `from` is the status the row was in, so the done toast can offer Undo. */
  onStatus: (id: number, status: SingleRowStatus, from?: string) => void;
}) {
  const { formatListDateTime } = usePaperDateFormatters();
  return (
    <div className="astra-rows">
      {rows.map((s) => {
        const paused = s.status === "paused";
        const failed = s.last_error != null;
        /*
          SH0-3: the flag the whole unit exists for. `keepsFailing` is the
          predicate (SH0-2) and it already refuses a paused row, so this is the
          same "the desk tried three times and could not read it" the note
          below spells out. It does NOT replace the failure state -- a row that
          has failed once still says "Could not check" -- and it draws nothing
          new on the desk: the same chip, a stronger word.
        */
        const keeps = keepsFailing(s);
        const fresh = s.new_since_last_pass ?? 0;
        /*
          SH-B item 4: the row that is waiting.

          Two states the editor could not previously tell apart from "we have
          given up": a site that asked us to come back later, and a site that
          has blocked us. Both are still on watch, both are parked until a
          recorded time, and both say so in a sentence rather than a code --
          "Asked us to come back at 3:40 PM — will retry then" when the site
          named a time (MEDIUM-4: "Was busy at 3:10 PM — trying again after
          3:40 PM" when it did not and the wait is the desk's own) / "Blocked
          us at 9:12 AM — trying again after 3:12 PM".

          The sentence is read off `retry_after_note`, which the fetch wrote at
          the moment the site answered. Nothing is recomputed here and nothing
          compares against the clock, because the note is rewritten on every
          attempt and cleared by a read that worked: it can never be stale.
        */
        const waiting = s.retry_after_note ?? null;
        const blocked = waiting != null && s.blocked_at != null;
        const chip = paused
          ? { cls: "paused", label: "Paused" }
          : /*
              Precedence, SH-B over SH0-3: a row the desk has parked says WHY it
              is parked ("Waiting" / "Blocked") before it says "Keeps failing",
              because the wait is the more useful fact -- the desk is coming
              back at a recorded time. The streak still counts those attempts,
              so a row that has been refused three times keeps its Delete press
              and its replacement panel; only the word on the chip changes.
            */
            waiting != null
            ? { cls: "wait", label: blocked ? "Blocked" : "Waiting" }
            : keeps
              ? { cls: "fail", label: "Keeps failing" }
              : failed
              ? { cls: "fail", label: "Could not check" }
              : fresh > 0
                ? { cls: "changed", label: "Changed" }
                : s.last_fetched_at
                  ? { cls: "same", label: "✓ No change" }
                  : { cls: "wait", label: "Not checked yet" };
        const note = paused
          ? "Paused · the scanner will not fetch it"
          : waiting != null
            ? keeps
              ? // The wait is the reason, so the streak sentence drops its own
                // "Last reason" clause rather than say the same thing twice.
                `${waiting} ${keepsFailingNote({
                  count: s.consecutive_failures ?? 0,
                  firstFailedAt: s.failure_streak_started_at,
                })}`
              : waiting
            : keeps
              ? keepsFailingNote({
                  count: s.consecutive_failures ?? 0,
                  lastError: s.last_error,
                  url: s.url,
                  firstFailedAt: s.failure_streak_started_at,
                })
              : failed
              ? (editorFetchError(s.last_error, s.url) ?? s.last_error ?? "")
              : fresh > 0
                ? `${fresh} new ${fresh === 1 ? "item" : "items"} · ${formatListDateTime(s.last_fetched_at)}`
                : s.last_fetched_at
                  ? `Checked ${formatListDateTime(s.last_fetched_at)}`
                  : "Added, not fetched yet";
        const checking = checkingId === s.id;
        /*
          FB7, item 1. The pending state for this row's Pause / Resume /
          Remove: the button that was pressed disables itself and says what it
          is doing, in the same paint as the click -- the press→pending shape
          `useDeskAction` gives every other control on this desk. The other
          rows are left alone: they were not pressed and nothing about them
          has changed.
        */
        const statusBusy = statusId === s.id;
        const result = checkResult?.id === s.id ? checkResult : null;
        const kills = killCounts?.get(s.id);
        return (
          <Fragment key={s.id}>
            <div
              className={
                "astra-row src" +
                (justAddedSince != null && s.id > justAddedSince ? " just-added" : "")
              }
            >
              <div className="astra-cell src-name">
                <span className="astra-row-t">{s.title}</span>
                {/*
                  UI1b-4: a <p>, not a <span>. The link inside goes somewhere,
                  so it stays an underlined link (README §2) -- and an
                  underlined link is only allowed to be plain text when it
                  sits in prose, a list item, a table cell or a heading. This
                  meta line is the source's own sentence, so it is drawn as
                  one; the two host links on this screen were the last
                  controls on the desk the guard still read as bare text.
                */}
                <p className="astra-row-meta">
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                    {hostLabel(s.url)} ↗
                  </a>
                  {` · Kind: ${s.kind || "unclassified"} · Tier: ${s.tier || "unclassified"}`}
                </p>
                <p className="astra-row-meta">Kind describes the source; Tier describes its evidence level.</p>
                {s.review_note?.trim() ? (
                  <p className="astra-row-meta">Source review: {s.review_note}</p>
                ) : null}
              </div>
              <div className="astra-cell src-state">
                <span className={"astra-chip " + chip.cls}>{chip.label}</span>
                <span className="astra-row-meta">{note}</span>
                {/*
                  Unit U24: what the press on THIS row answered. The chip and
                  the note above are the last pass's record; this is the result
                  of the check the editor just asked for, so "Retry did
                  something" is visible on the row instead of only as a new
                  scan somewhere else on the page.
                */}
                {result?.ok ? (
                  <span className="astra-row-meta astra-row-result is-ok" role="status">
                    {result.line}
                  </span>
                ) : null}
              </div>
              <div className="astra-row-acts">
                {paused ? (
                  <>
                    {/*
                      Unit UI1a2. Every press on this row is the shared
                      `ActionButton` now, so Pause, Resume, Check now and
                      Delete have the same four states as Publish does.

                      The DONE state of Pause and Resume is the ROW's, not the
                      button's: a pause that lands makes this row
                      `status === "paused"`, so the chip above reads "Paused"
                      and this very control is redrawn as "Resume". That is
                      rule 3's "the new state, because the row's data now says
                      so" -- a green "Paused" on the button beside a row still
                      reading "Active" would be the desk contradicting itself
                      for one refetch, which is the flicker FB6 opened this
                      family of units about. See `rowActionPhase`.
                    */}
                    <ActionButton
                      tone="quiet"
                      phase={rowActionPhase({ isPending: statusBusy })}
                      workingLabel="Resuming…"
                      onAct={() => onStatus(s.id, "accepted")}
                    >
                      Resume
                    </ActionButton>
                    <RemoveAction
                      label="Remove"
                      armed={confirmRemoveId === s.id}
                      busy={statusBusy}
                      onAsk={() => onConfirmRemove(s.id)}
                      onCancel={() => onConfirmRemove(null)}
                      /*
                        Deliberately NOT disarming here: the row stays armed so
                        the second press keeps drawing "Removing…" while the
                        write is in flight. Disarming first turned the button
                        back into "Remove" in the same paint, so the pending
                        state this item exists to add was never visible. The
                        arming clears itself when the row leaves -- which is
                        what a successful Remove does -- and a failed one leaves
                        it armed, ready for another press.
                      */
                      onConfirm={() => {
                        onStatus(s.id, "rejected", s.status);
                      }}
                    />
                  </>
                ) : (
                  <>
                    {/*
                      "Check now" / "Retry" is the one control on this row whose
                      answer STAYS with the button rather than with the row's
                      own record: the press asks "can the desk read this page?",
                      and the answer is about the press, so the button is where
                      it belongs. It says "Checking…" with a spinner while it
                      runs, then "Checked" in the success green with a check --
                      and the row's own line ("Read OK now.") still carries the
                      detail underneath, which is U24's answer, not a second
                      one. A check that came back bad prints the desk's own
                      sentence in red BESIDE the button and the button goes back
                      to "Retry", pressable.
                    */}
                    <ActionButton
                      tone={failed ? "primary" : "quiet"}
                      phase={
                        checking
                          ? "working"
                          : result && !result.ok
                            ? "failed"
                            : result?.ok
                              ? "done"
                              : "idle"
                      }
                      workingLabel={failed ? "Retrying…" : "Checking…"}
                      doneLabel="Checked"
                      reason={result && !result.ok ? result.line : null}
                      onAct={() => onCheck(s.id)}
                    >
                      {failed ? "Retry" : "Check now"}
                    </ActionButton>
                    <ActionButton
                      tone="quiet"
                      phase={rowActionPhase({ isPending: statusBusy })}
                      workingLabel="Pausing…"
                      onAct={() => onStatus(s.id, "paused")}
                    >
                      Pause
                    </ActionButton>
                    {keeps ? (
                      /*
                        SH0-3 / owner addendum item 1: a row that keeps failing
                        offers the two things an editor actually wants, ONE
                        PRESS EACH -- Pause (already above) and Delete.

                        Delete is drawn as a plain button here rather than
                        behind the "More ▾" disclosure every other active row
                        uses, because the whole point of the flag is that this
                        row has been waiting. It asks ONE question first, and
                        the question names what goes: the source, and the watch
                        list it leaves. Nothing is autosaved, nothing was
                        paused or removed behind the editor's back -- the
                        addendum is explicit that the desk flags and the editor
                        acts.
                      */
                      <ActionButton
                        tone="danger"
                        phase={rowActionPhase({ isPending: statusBusy })}
                        workingLabel="Deleting…"
                        disabled={checking}
                        disabledReason={
                          checking ? "The desk is still reading this source." : null
                        }
                        onAct={() => {
                          if (
                            !confirm(
                              `Delete “${s.title}”? The desk stops fetching ${hostLabel(s.url)} and this source comes off the watch list. Pages already saved from it stay in the newsroom.`,
                            )
                          )
                            return;
                          onStatus(s.id, "rejected", s.status);
                        }}
                      >
                        Delete
                      </ActionButton>
                    ) : (
                      /*
                        Remove, one click deeper.

                        BJ3 item 1: three 44px buttons at their natural width
                        came to 292px of the 598px the column has at 1280. The
                        grid's third track is `auto`, so it sized to that 292px
                        max-content and the `1fr` name track starved to 79px --
                        the BJ2 finding (every name one word per line, the url
                        printed over the chip). The drawing puts two buttons on
                        an active row, so Remove is drawn here as the same
                        `row-more` disclosure the other desks use: still one
                        tab stop, still one click away, and the row keeps the
                        width for its name.
                      */
                      <details className="row-more">
                        <summary className="btn quiet">More ▾</summary>
                        <div className="row-more-panel">
                          <RemoveAction
                            label="Remove"
                            armed={confirmRemoveId === s.id}
                            busy={statusBusy}
                            onAsk={() => onConfirmRemove(s.id)}
                            onCancel={() => onConfirmRemove(null)}
                            onConfirm={() => {
                              onConfirmRemove(null);
                              onStatus(s.id, "rejected", s.status);
                            }}
                          />
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            </div>
            {/*
              The kill pattern, under the row it belongs to and only where the
              count above zero. A sibling of the row rather than a fourth grid
              cell: the panel is a paragraph and a list of examples, and putting
              it in the grid would either squeeze the name column or land under
              one column while the row's rule spans all three.

              It reads for itself (`sourceKillPattern`), so what prints here is
              the fresh count and the gate is only the gate -- see the note on
              `killCounts` where it is computed.
            */}
            {kills ? (
              <div className="astra-kill">
                <SourceKillPattern sourceId={s.id} />
              </div>
            ) : null}
            {/*
              SH0-10: "Find a replacement", and ONLY on a row that keeps
              failing. The panel is the one place in this feature a model may be
              asked for anything, so it is drawn where the editor has already
              been told the source is a problem -- never on a row that is fine.
            */}
            {keeps ? (
              <div className="astra-kill">
                <ReplacementPanel source={s} />
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * "FIND A REPLACEMENT" (SH0-10), under a row that keeps failing.
 *
 * TWO PRESSES, PRICED DIFFERENTLY, AND THE EDITOR IS TOLD WHICH IS WHICH.
 *
 *   - The list at the top costs NOTHING: it is one read of sources the desk
 *     already watches on the same beat (`replacementCandidates`), so nothing
 *     is fetched and the site that just refused us is not asked again.
 *   - The button at the bottom says **Uses one model call** before it is
 *     pressed, and it is the only thing in this feature that spends anything.
 *
 * Every candidate carries **Use this instead** (files a suggestion for the
 * editor to approve -- it never accepts anything) and **Not now** (drops it
 * from this panel only; nothing is written). The rows come back through
 * `useDeskMutation`, so a press that fails says why.
 *
 * WHAT IT SAYS WHEN IT FINDS NOTHING, AND WHY THAT MATTERS. For most newsrooms
 * the true answer to "what else covers Planning?" is "Planning has only this
 * one source", which is a fact worth knowing rather than a failure -- so the
 * panel says exactly that instead of showing a spinner that resolves to
 * nothing.
 */
function ReplacementPanel({ source }: { source: SourceRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(defaultModelEffort("auto"));
  const found = useQuery({
    queryKey: ["replacement-candidates", source.id],
    queryFn: () => replacementCandidates({ data: source.id }),
    enabled: open,
  });
  const file = useDeskMutation({
    mutationFn: (input: { url?: string; title?: string; modelChoice?: StoryModelChoice; modelEffort?: ModelEffort | null }) =>
      findReplacement({
        data: {
          sourceId: source.id,
          ...(input.url
            ? { url: input.url, title: input.title }
            : { modelChoice: input.modelChoice, modelEffort: input.modelEffort }),
        },
      }),
    pending: "Filing…",
    done: (result) =>
      result.ok
        ? result.proposed > 0
          ? "Added to Suggested sources. Nothing is fetched until you accept it."
          : (result.notice ?? "Nothing was added.")
        : (result.error ?? "That did not work."),
    failedLead: "Could not file that suggestion. ",
    after: async () => {
      await qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const beats = found.data?.beatNames ?? [];
  const candidates = (found.data?.candidates ?? []).filter((c) => !dismissed.includes(c.url));

  return (
    <div className="row-more-panel">
      <p className="astra-row-meta">
        <b>Find a replacement.</b>{" "}
        {beats.length
          ? `This source is filed under ${beats.join(", ")}.`
          : "The desk could not tell what this source was for."}
      </p>

      {!open ? (
        <InkButton tone="quiet" onClick={() => setOpen(true)}>
          Find a replacement
        </InkButton>
      ) : found.isPending ? (
        <p className="astra-row-meta" role="status">
          Looking at what else you already watch…
        </p>
      ) : found.isError ? (
        <p className="astra-row-meta" role="status">
          The desk could not read the watch list just now. Nothing was changed.
        </p>
      ) : (
        <>
          {candidates.length ? (
            candidates.map((candidate) => (
              <div key={candidate.url} className="astra-row-meta">
                <span>{candidate.title ?? candidate.url}</span>{" "}
                <span className="astra-chip">{candidate.label}</span>{" "}
                {/*
                  MEDIUM-1 (A-B8): a sibling IS one of the newsroom's accepted
                  sources, so the proposal door would refuse the URL this press
                  sent -- it could never file anything, and the toast afterwards
                  said so. The row says what is true and offers nothing to
                  press. The press stays on the candidates where it can succeed.
                */}
                {candidateIsWatchedSource(candidate) ? (
                  <span>Already on your watch list</span>
                ) : (
                  <span className="row-acts">
                    <InkButton
                      tone="quiet"
                      disabled={file.isPending}
                      onClick={() => file.mutate({ url: candidate.url, title: candidate.title ?? undefined })}
                    >
                      Use this instead
                    </InkButton>
                    <InkButton
                      tone="quiet"
                      disabled={file.isPending}
                      onClick={() => setDismissed((was) => [...was, candidate.url])}
                    >
                      Not now
                    </InkButton>
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="astra-row-meta">
              {beats.length
                ? `No other source is filed under ${beats.join(", ")}. This may be the only one the newsroom watches.`
                : "No other source shares a beat with this one."}
            </p>
          )}
          <ModelPicker
            scope="scan"
            label="Replacement search model"
            value={modelChoice}
            onChange={(choice) => {
              setModelChoice(choice);
              setModelEffort(defaultModelEffort(choice));
            }}
            effort={modelEffort}
            onEffortChange={setModelEffort}
            disabled={file.isPending}
          />
          <p className="astra-row-meta">
            <InkButton tone="quiet" disabled={file.isPending} onClick={() => file.mutate({ modelChoice, modelEffort })}>
              {file.isPending ? "Asking the model…" : "Ask AI to look further"}
            </InkButton>{" "}
            Uses one model call. We have not checked whether any of these is free to read.
          </p>
        </>
      )}
    </div>
  );
}

function SourceTable({
  rows,
  acts,
  justAddedSince,
  statusId,
  confirmRemoveId,
  onConfirmRemove,
  onStatus,
  assignUI,
}: {
  rows: SourceRow[];
  acts: ("accepted" | "rejected")[];
  /** The watch list's high-water mark when the add dialog last reported a save. */
  justAddedSince?: number | null;
  /** See `WatchRows`: the row an Accept / Drop write is in flight for. */
  statusId: number | null;
  /** See `WatchRows`: the row whose Drop is waiting on its second press. */
  confirmRemoveId: number | null;
  onConfirmRemove: (id: number | null) => void;
  /** See `WatchRows`: `from` is the status the row was in, for the Undo. */
  onStatus: (id: number, status: SingleRowStatus, from?: string) => void;
  /** Absent for a non-owner, and on the On watch list, where a source is already accepted. */
  assignUI?: {
    options: { key: string; name: string }[];
    picked: (rowId: number) => string[];
    toggle: (rowId: number, key: string) => void;
  } | null;
}) {
  const { formatShortDate } = usePaperDateFormatters();
  return (
    <table className="ltable">
      <thead>
        <tr>
          <th>Source</th>
          <th>Tier</th>
          <th>Kind</th>
          <th>Last fetched</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr
            key={s.id}
            className={
              "lead-tr" + (justAddedSince != null && s.id > justAddedSince ? " just-added" : "")
            }
          >
            <td className="td-hl" data-label="Source">
              <span className="src-t">{s.title}</span>
              <span className="meta-inline block">Kind: {s.kind || "unclassified"} · Tier: {s.tier || "unclassified"}. Kind describes the source; Tier describes its evidence level.</span>
              <span className="meta-inline block">
                {/^https?:/i.test(s.url) ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                    {s.url}
                  </a>
                ) : (
                  s.url
                )}
              </span>
              {s.last_error ? (
                <span className="warn-inline">
                  {editorFetchError(s.last_error, s.url) ?? s.last_error}
                </span>
              ) : null}
            </td>
            <td className="td-meta" data-label="Tier">
              {s.tier}
            </td>
            <td className="td-meta" data-label="Kind">
              {s.kind}
            </td>
            <td className="td-meta" data-label="Last fetched">
              {s.last_fetched_at ? formatShortDate(s.last_fetched_at) : "—"}
            </td>
            <td className="td-acts" data-label="Actions">
              {assignUI ? (
                /* Not `.file-form`: that is the page-level accordion, and this
                   one lives in a table cell. */
                <details className="row-sections">
                  <summary className="inline-block cursor-pointer">
                    {(() => {
                      const picked = assignUI.picked(s.id);
                      return picked.length
                        ? `Sections: ${picked.length} ticked`
                        : "Assign to sections";
                    })()}
                  </summary>
                  <SectionPicker
                    legend="Sections this source feeds"
                    hint="Tick now, then Accept: both are saved in one step."
                    options={assignUI.options}
                    picked={assignUI.picked(s.id)}
                    onToggle={(key) => assignUI.toggle(s.id, key)}
                  />
                </details>
              ) : null}
              <span className="row-acts">
                {acts.includes("accepted") ? (
                  /*
                    Unit UI1a2: the same shared piece as the watch list's
                    presses. Its DONE is the row's -- an accepted source moves
                    out of Suggested and into the watch list, which the tabs
                    and the row's own chip say.
                  */
                  <ActionButton
                    tone="quiet"
                    phase={rowActionPhase({ isPending: statusId === s.id })}
                    workingLabel="Accepting…"
                    onAct={() => onStatus(s.id, "accepted", s.status)}
                  >
                    Accept
                  </ActionButton>
                ) : null}
                {acts.includes("rejected") ? (
                  <RemoveAction
                    label="Drop"
                    armed={confirmRemoveId === s.id}
                    busy={statusId === s.id}
                    onAsk={() => onConfirmRemove(s.id)}
                    onCancel={() => onConfirmRemove(null)}
                    onConfirm={() => {
                      onConfirmRemove(null);
                      onStatus(s.id, "rejected", s.status);
                    }}
                  />
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
