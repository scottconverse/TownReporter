import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DeskShell, Field, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  addSource,
  addSourcesBulk,
  listScans,
  listSources,
  reviewSuggestedSources,
  runScan,
  setSourceStatus,
} from "@/lib/news/desk";
import {
  editorActionError,
  editorFetchError,
  kindFromSourceUrl,
  scanCountsLine,
  suggestedOriginLine,
  tierFromKind,
} from "@/lib/news/desk-copy";
import { applySections, editorSections } from "@/lib/news/sections";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    data: sources = [],
    isPending,
    isError: listIsError,
    error: listError,
    refetch: refetchSources,
    isRefetching: refetchingSources,
  } = useQuery({
    queryKey: ["sources"],
    queryFn: () => listSources(),
  });
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [bulk, setBulk] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [addedId, setAddedId] = useState<number | null>(null);
  /*
    The add panel's two doors. The drawing puts a single "+ Add a source" in
    the header and one dialog behind it, whose second tab is the bulk import
    ("+ Add a source opens the add-source dialog, which includes bulk import",
    README 337). Phase 4's AddSourcesDialog replaces this panel on merge; until
    then the two tabs are the same two forms that used to sit open on the page.
  */
  const [addTab, setAddTab] = useState<"one" | "file">("one");
  /*
    Which sections a source joins, chosen here at the moment the source is
    added or accepted.

    Assigning a source to a section is a `SectionConfig` write, and
    `applySections` refuses anyone but the owner ("Only the owner can configure
    newspaper sections.") -- so this chooser is shown only when that same
    server function says `canEdit`. Adding and accepting a source stay
    editor-level, exactly as they were; nothing about who may do what changed,
    only where the owner can do it from.
  */
  const sectionsQuery = useQuery({
    queryKey: ["editor-sections"],
    queryFn: () => editorSections(),
  });
  const canAssignSections = Boolean(sectionsQuery.data?.canEdit);
  const reportingSections = (sectionsQuery.data?.sections ?? []).filter(
    (s) => !["opinion", "about"].includes(s.key) && !s.replacementKey,
  );
  const [assignKeys, setAssignKeys] = useState<string[]>([]);
  const [rowKeys, setRowKeys] = useState<Record<number, string[]>>({});
  // The search box the design draws beside the group filters. Client-side over
  // the rows already loaded: the watch list is a few hundred rows at most and
  // filtering it server-side would put a round trip on every keystroke.
  const [sourceQuery, setSourceQuery] = useState("");
  const { formatDateTime } = usePaperDateFormatters();
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
  /** The newest run, which is what "Last run" and the pager both read. */
  const last = scans.data?.rows?.[0];
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const runScanNow = useMutation({
    mutationFn: () => runScan({ data: { modelChoice: "auto", modelEffort: null } }),
    onSuccess: (res) => {
      if (res && "ok" in res && res.ok === false) {
        setScanNotice(res.error);
        return;
      }
      setScanNotice(null);
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) =>
      setScanNotice(err instanceof Error ? err.message : "Could not start that scan."),
  });
  /*
    "Check now" / "Retry" on one watch-list row.

    Same runner, same defaults, one source: `runScan` has taken an explicit
    source set since P0-1 (`customSourceIds`), and `selectCustomScanSources`
    narrows it to the still-accepted rows, so this cannot reach a source the
    editor has paused or dropped. It is not a second scanner -- it is the one
    the Daily scan panel above already runs, scoped to the row you pressed.
  */
  const checkOne = useMutation({
    mutationFn: (id: number) =>
      runScan({ data: { modelChoice: "auto", modelEffort: null, customSourceIds: [id] } }),
    onSuccess: (res) => {
      if (res && "ok" in res && res.ok === false) {
        setScanNotice(res.error);
        return;
      }
      setScanNotice(null);
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) =>
      setScanNotice(err instanceof Error ? err.message : "Could not check that source."),
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
  const add = useMutation({
    mutationFn: () =>
      addSource({
        data: {
          url,
          title,
          kind: kindFromSourceUrl(url),
          tier: tierFromKind(kindFromSourceUrl(url)),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice({ kind: "err", text: res.error });
        return;
      }
      setUrl("");
      setTitle("");
      setAddedId(res.source.id);
      setSourceTab("accepted");
      const keys = assignKeys;
      setNotice({
        kind: "ok",
        text: `On watch: ${res.source.title} — ${res.source.url}`,
      });
      qc.setQueryData(["sources"], (old: SourceRow[] | undefined) => {
        if (!old) return [res.source];
        return [
          res.source,
          ...old.filter((s) => s.id !== res.source.id && s.url !== res.source.url),
        ];
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      // The section assignment is a second write, so it can fail on its own
      // (a stale revision, an expired session). Say which half landed.
      void assignSourceToSections(res.source.id, keys).then((assignment) => {
        if (!assignment.ok) {
          setNotice({
            kind: "err",
            text: `On watch: ${res.source.title} — ${res.source.url}. The section assignment failed: ${assignment.error}`,
          });
          return;
        }
        if (keys.length) {
          setAssignKeys([]);
          setNotice({
            kind: "ok",
            text: `On watch: ${res.source.title} — ${res.source.url}. Assigned to ${sectionNames(keys)}.`,
          });
        }
      });
      requestAnimationFrame(() => {
        document.getElementById("on-watch")?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    onError: (err) => {
      // The URL and Name boxes carry no `maxLength` and `addSourceInput` caps
      // both, so a long paste reached the notice bar as the issues array.
      const raw = err instanceof Error ? err.message : "";
      setNotice({
        kind: "err",
        text:
          raw === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : editorActionError(raw, "add that source") ?? "Could not add that source.",
      });
    },
  });
  const addBulk = useMutation({
    mutationFn: (text: string) => addSourcesBulk({ data: { text } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setNotice({ kind: "err", text: res.error });
        return;
      }
      setBulk("");
      setSourceTab("accepted");
      const t = res.byTier;
      setNotice({
        kind: "ok",
        text: `Added ${res.added} sources (A ${t.A} · B ${t.B} · C ${t.C}). Tier C is scanned as a discovery clue, never treated as fact.`,
      });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      // Same boundary on the registry box: `bulkSourceInput.text` caps at
      // 200,000 and the textarea is unbounded (a chosen file is read whole
      // into it), so a big paste or file dumped the schema.
      const raw = err instanceof Error ? err.message : "";
      setNotice({
        kind: "err",
        text:
          raw === "Unauthorized"
            ? "Session expired. Sign in again, then retry."
            : editorActionError(raw, "read that registry") ?? "Bulk add failed.",
      });
    },
  });
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
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" | "paused" }) =>
      setSourceStatus({ data: input }),
    onSuccess: async (_res, input) => {
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
    "On watch" is two statuses, not one.

    A paused source is still on the watch list -- it is the same row, held, and
    the drawing's row carries Resume rather than Accept for exactly that reason.
    So the tab counts both and shows both, while `watch` below counts only the
    rows the scanner may actually read (`daily-scan.ts` and `runScan` both ask
    for `status = 'accepted'`), which is what "Files up to" means.
  */
  const onWatch = (s: SourceRow) => s.status === "accepted" || s.status === "paused";
  /*
    How many pages the scanner is allowed to read. This is the "files up to"
    the design puts in the Daily scan panel, and it is the same number the Scan
    screen computes for its own run. Paused rows are deliberately not in it.
  */
  const watch = sources.filter((s) => s.status === "accepted").length;

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setBulk(text);
    setNotice(null);
    addBulk.mutate(text);
  }

  return (
    <DeskShell
      title="Sources"
      kicker="What the desk watches, and whether it could check"
      hideTitle
    >
      {/*
        The drawn header: kicker, title, the page's own action, rule. The
        drawing puts "+ Add a source" on the title line; this build has no
        add-source dialog yet (the dialogs are lane 1's, and Desk Dialogs is not
        in the tree), so the button opens the panel that adds one today -- the
        same form the walks press, reached from the header instead. The plus is
        a literal character here: the walks match the panel's own summary by its
        exact text "Add a source", and the ::before that draws the panel's plus
        is CSS, so only this button reads "+ Add a source" to a text match.

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
          <button
            type="button"
            className="btn solid"
            onClick={() => {
              const panel = document.getElementById("astra-add-source");
              if (panel instanceof HTMLDetailsElement) {
                panel.open = true;
                panel.scrollIntoView({ block: "start" });
                panel.querySelector("summary")?.focus();
              }
            }}
          >
            + Add a source
          </button>
        </div>
      </div>
      <p className="lede">
        The pages the scanner reads on every pass. Add one, paste a whole registry, or review what
        the machine proposes.
      </p>
      {/*
        The add panel, behind the header's "+ Add a source" (BJ2 item 4).

        The drawing draws one control there and one dialog behind it, not two
        open panels above the list. Phase 4's AddSourcesDialog replaces this
        panel on merge, and the registry import that used to be its own top
        disclosure is now this panel's second tab -- which is where the README
        says the bulk import lives ("includes bulk import", line 337).

        Two things are deliberate. The panel keeps `.astra-source-add` and the
        id `astra-add-source`, because that is what the header button above
        reaches for. And it is closed on load and drawn only when open
        (`desk-astra.css`: `main > details.astra-source-add:not([open])` is
        `display: none`), so the resting page shows the list and nothing else --
        the walks open it through the header button
        (sources-desk-e2e, scan-desk-e2e, sections-source-add-e2e).
      */}
      <details className="file-form astra-source-add astra-panel astra-jump" id="astra-add-source">
        <summary>Add a source</summary>
        <div className="astra-seg" role="group" aria-label="How to add sources">
          <button
            type="button"
            className={"astra-seg-opt" + (addTab === "one" ? " on" : "")}
            aria-pressed={addTab === "one"}
            onClick={() => setAddTab("one")}
          >
            One source
          </button>
          <button
            type="button"
            className={"astra-seg-opt" + (addTab === "file" ? " on" : "")}
            aria-pressed={addTab === "file"}
            onClick={() => setAddTab("file")}
          >
            Upload a file
          </button>
        </div>
        {addTab === "file" ? (
          /* The registry import, as the dialog's second tab: paste it, or
             choose a file, which is read into the same box and added. */
          <div className="src-bulk">
            <p className="meta">
              Paste a registry or choose a .txt, .md or .csv file. TIER A/B/C headers are
              preserved. Selecting a file adds its sources to the watch list.
            </p>
            <textarea
              rows={5}
              className="bulk"
              aria-label="Paste source registry"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={
                "TIER A — OFFICIAL RECORD\n* City Council: https://www.longmontcolorado.gov/…\nTIER B — JOURNALISM\n* Times-Call: https://www.timescall.com/"
              }
            />
            <div className="row-acts static">
              <InkButton
                disabled={addBulk.isPending || !bulk.trim()}
                onClick={() => addBulk.mutate(bulk)}
              >
                {addBulk.isPending ? "Adding list…" : "Add list"}
              </InkButton>
              <InkButton
                tone="ghost"
                disabled={addBulk.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Choose registry file
              </InkButton>
              <input
                ref={fileRef}
                type="file"
                aria-label="Choose source registry file"
                accept=".txt,.csv,.md,.tsv,text/plain,text/csv,text/markdown"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void onPickFile(file);
                }}
              />
            </div>
          </div>
        ) : (
        <form
          className="src-add"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            add.mutate();
          }}
        >
          <Field label="URL">
            <input
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.longmontcolorado.gov/…"
              required
            />
          </Field>
          <Field label="Name">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="City Council packets"
            />
          </Field>
          <InkButton type="submit" disabled={add.isPending || !url.trim()}>
            {add.isPending ? "Adding…" : "Add source"}
          </InkButton>
          {/* The form is a three-column grid, so this spans it rather than
              becoming a fourth column. */}
          <div className="[grid-column:1/-1]">
            {canAssignSections ? (
              <SectionPicker
                legend="Assign to sections (optional)"
                hint="Tick the newspaper sections this source should feed. Saved with the source, in the same step."
                options={reportingSections}
                picked={assignKeys}
                disabled={add.isPending}
                onToggle={(key) =>
                  setAssignKeys((keys) =>
                    keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key],
                  )
                }
              />
            ) : sectionsQuery.isSuccess ? (
              <p className="meta">
                Only the owner can file a source under a section. Adding and accepting are yours to
                do; an owner can tick the sections here, or on Server → Sections.
              </p>
            ) : null}
          </div>
        </form>
        )}
      </details>
      {notice ? (
        <p className={"note" + (notice.kind === "err" ? " err" : "")}>{notice.text}</p>
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
                  {g.k === "accepted"
                    ? "On watch"
                    : g.k === "proposed"
                      ? "Suggested"
                      : "Rejected"}{" · "}
                  {sources.filter((s) => (g.k === "accepted" ? onWatch(s) : s.status === g.k)).length}
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
                {sources.filter((s) => onWatch(s) && s.last_error != null).length}
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
        groups.map((g) => {
          /*
            "Could not check" shows the accepted group, narrowed to the rows
            that carry a fetch error, so it is the same table with the same
            actions -- Accept and Drop stay where they are, because a source
            that cannot be read may still be worth dropping.
          */
          const forTab = sourceTab === "unchecked" ? "accepted" : sourceTab;
          if (g.k !== forTab) return null;
          const rows = sources
            .filter((s) => (g.k === "accepted" ? onWatch(s) : s.status === g.k))
            .filter((s) => (sourceTab === "unchecked" ? s.last_error != null : true))
            .filter((s) => {
              const q = sourceQuery.trim().toLowerCase();
              if (!q) return true;
              return [s.title, s.url, s.kind, s.tier].some((value) =>
                (value ?? "").toLowerCase().includes(q),
              );
            });
          return (
            <section key={g.k} id={g.k === "accepted" ? "on-watch" : "suggested"} className="src-sec">
              <SecHead
                title={sourceTab === "unchecked" ? "Could not check" : g.title}
                count={rows.length}
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
                    : sourceQuery.trim()
                      ? "No source on this list matches that search."
                      : "Nothing on watch yet — add a URL above."}
                </p>
              ) : g.k === "proposed" ? (
                /* The one list built for volume: 175 rows were waiting when
                   this was written, so it carries a select-all, a per-press
                   Saving/Saved/Failed line, and one transaction per press. */
                <SuggestedSources rows={rows} canAssign={canAssignSections} options={reportingSections} />
              ) : g.k === "accepted" ? (
                <WatchRows
                  rows={rows}
                  addedId={addedId}
                  checkingId={checkOne.isPending ? (checkOne.variables ?? null) : null}
                  onCheck={(id) => checkOne.mutate(id)}
                  onStatus={(id, status) => setStatus.mutate({ id, status })}
                />
              ) : (
                <SourceTable
                  rows={rows}
                  acts={g.acts}
                  addedId={addedId}
                  onStatus={(id, status) => setStatus.mutate({ id, status })}
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
        })
      )}
        </div>
        <aside className="astra-col">
          {/*
            The Daily scan panel, drawn with a 2px yellow border because on this
            screen it is the one thing that acts on everything else. Its three
            rows answer "is the scanner working": how many runs, how many files
            it can reach, and when it last went out. The design also draws a
            Model row here; this build records no model on a scan run (ScanRow
            carries no such column), so the row is absent rather than guessed --
            the model each job uses lives on Models.
          */}
          <div className="astra-panel hot">
            <h2 className="astra-panel-h">Daily scan</h2>
            <dl className="astra-kv ruled">
              <dt>Runs</dt>
              <dd>{scans.data?.total ?? 0}</dd>
            </dl>
            <dl className="astra-kv ruled">
              <dt>Files up to</dt>
              <dd>{watch}</dd>
            </dl>
            <dl className="astra-kv ruled">
              <dt>Last run</dt>
              <dd>
                {last
                  ? last.stalled
                    ? "Stalled"
                    : last.finished_at
                      ? formatDateTime(last.finished_at)
                      : "Running now"
                  : "Never"}
              </dd>
            </dl>
            <p className="astra-note">Scans file leads only. They never draft or publish.</p>
            {scanNotice ? (
              <p className="note err" role="alert">
                {scanNotice}
              </p>
            ) : null}
            <div className="astra-panel-acts">
              <InkButton disabled={runScanNow.isPending} onClick={() => runScanNow.mutate()}>
                {runScanNow.isPending ? "Starting…" : "Run scan now"}
              </InkButton>
              <Link to="/desk/scan" className="btn quiet">
                Open the scan screen
              </Link>
            </div>
          </div>
          {/*
            Previous scans. Five, and a link rather than a pager: the Scan
            screen owns the full history, its paging and its diagnostics, and a
            second copy of that here would be a second thing to keep right.
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
                      {run.started_at ? formatDateTime(run.started_at) : "—"}
                    </span>
                    <span className="astra-row-meta">
                      {run.error
                        ? "Failed"
                        : run.stalled
                          ? "Stalled with no result"
                          : run.finished_at
                            ? scanCountsLine(run)
                            : "Running now"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="astra-panel-acts">
              <Link to="/desk/scan" className="btn quiet">
                All previous scans
              </Link>
            </div>
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
function suggesterKey(by: string | null | undefined): "scan" | "research" | "dark" | "editor" | "unrecorded" {
  return by === "scan" || by === "research" || by === "dark" || by === "editor" ? by : "unrecorded";
}

const SUGGESTER_FILTERS: { k: "all" | ReturnType<typeof suggesterKey>; label: string; none: string }[] = [
  { k: "all", label: "Anyone", none: "Nothing is waiting for review." },
  { k: "scan", label: "The scan", none: "No suggestions from the scan are waiting." },
  { k: "research", label: "The research pass", none: "No suggestions from the research pass are waiting." },
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
      const one = n === 1 ? (rows.find((r) => r.id === input.ids[0])?.title ?? "That suggestion") : null;
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
            f.k === "all" ? rows.length : rows.filter((r) => suggesterKey(r.proposed_by) === f.k).length;
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
                        onClick={() => decide([s.id], "accepted", canAssign ? picked || undefined : undefined, noteFor(s))}
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
  addedId,
  checkingId,
  onCheck,
  onStatus,
}: {
  rows: SourceRow[];
  addedId?: number | null;
  /** The row a check is in flight for, so only that row says "Checking…". */
  checkingId: number | null;
  onCheck: (id: number) => void;
  onStatus: (id: number, status: "accepted" | "rejected" | "paused") => void;
}) {
  const { formatDateTime } = usePaperDateFormatters();
  return (
    <div className="astra-rows">
      {rows.map((s) => {
        const paused = s.status === "paused";
        const failed = s.last_error != null;
        const fresh = s.new_since_last_pass ?? 0;
        const chip = paused
          ? { cls: "paused", label: "Paused" }
          : failed
            ? { cls: "fail", label: "Could not check" }
            : fresh > 0
              ? { cls: "changed", label: "Changed" }
              : s.last_fetched_at
                ? { cls: "same", label: "✓ No change" }
                : { cls: "wait", label: "Not checked yet" };
        const note = paused
          ? "Paused · the scanner will not fetch it"
          : failed
            ? (editorFetchError(s.last_error, s.url) ?? s.last_error ?? "")
            : fresh > 0
              ? `${fresh} new ${fresh === 1 ? "item" : "items"} · ${formatDateTime(s.last_fetched_at)}`
              : s.last_fetched_at
                ? `Checked ${formatDateTime(s.last_fetched_at)}`
                : "Added, not fetched yet";
        const checking = checkingId === s.id;
        return (
          <div
            key={s.id}
            className={"astra-row src" + (addedId === s.id ? " just-added" : "")}
          >
            <div className="astra-cell">
              <span className="astra-row-t">{s.title}</span>
              <span className="astra-row-meta">
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-link">
                  {hostLabel(s.url)} ↗
                </a>
                {s.kind ? ` · ${s.kind}` : ""}
              </span>
            </div>
            <div className="astra-cell">
              <span className={"astra-chip " + chip.cls}>{chip.label}</span>
              <span className="astra-row-meta">{note}</span>
            </div>
            <div className="astra-row-acts">
              {paused ? (
                <InkButton tone="quiet" onClick={() => onStatus(s.id, "accepted")}>
                  Resume
                </InkButton>
              ) : (
                <>
                  <InkButton
                    tone={failed ? "solid" : "quiet"}
                    disabled={checking}
                    onClick={() => onCheck(s.id)}
                  >
                    {checking ? "Checking…" : failed ? "Retry" : "Check now"}
                  </InkButton>
                  <InkButton tone="quiet" onClick={() => onStatus(s.id, "paused")}>
                    Pause
                  </InkButton>
                </>
              )}
              <InkButton tone="quiet" onClick={() => onStatus(s.id, "rejected")}>
                Remove
              </InkButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourceTable({
  rows,
  acts,
  addedId,
  onStatus,
  assignUI,
}: {
  rows: SourceRow[];
  acts: ("accepted" | "rejected")[];
  addedId?: number | null;
  onStatus: (id: number, status: "accepted" | "rejected") => void;
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
          <tr key={s.id} className={"lead-tr" + (addedId === s.id ? " just-added" : "")}>
            <td className="td-hl" data-label="Source">
              <span className="src-t">{s.title}</span>
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
                  <InkButton tone="quiet" onClick={() => onStatus(s.id, "accepted")}>
                    Accept
                  </InkButton>
                ) : null}
                {acts.includes("rejected") ? (
                  <InkButton tone="quiet" onClick={() => onStatus(s.id, "rejected")}>
                    Drop
                  </InkButton>
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
