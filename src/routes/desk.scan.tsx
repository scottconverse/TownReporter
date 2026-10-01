import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { MeetingsActivity } from "@/components/meetings-activity";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteScanSourcePackFn, listAcceptedScanSources, listScanSourcePacksFn, listScans, listSources, renameScanSourcePackFn, runScan, saveScanSourcePackFn } from "@/lib/news/desk";
import { editorActionError, editorScanError, scanCountsLine, scanCoverageLine, scanRowLine, parseFailedSources, failedSourcesLine, scanZeroWhy, stalledRunCopy } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { useDeskAction } from "@/components/desk-action";
import { invalidateDeskJobs, useDeskJobs } from "@/components/job-card-state";
import { DeskJobCard } from "@/components/JobCard";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { useEditorSections } from "@/lib/use-sections";
import {
  pageOffset,
  nextWindowSize,
  isHistoryExhausted,
  accumulateScanPages,
  scanIsRunning,
} from "@/lib/news/scan-history";

export const Route = createFileRoute("/desk/scan")({ component: ScanPage });

function ScanPage() {
  const {sections}=useEditorSections();
  const [sectionKey,setSectionKey]=useState("");
  const [scope,setScope]=useState<"general"|"section"|"custom">("general");
  // P0-1: Custom sources — explicit accepted source set for this run.
  const [pickedIds,setPickedIds]=useState<number[]>([]);
  const [sourceFilter,setSourceFilter]=useState("");
  const [kindFilter,setKindFilter]=useState("");
  const [tierFilter,setTierFilter]=useState("");
  // P0-2: saved packs.
  const [packId,setPackId]=useState<number | null>(null);
  const [packName,setPackName]=useState("");
  const { formatDateTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  /*
    P0-4: real offset paging. Each request is ONE bounded page (pageSize), and
    loaded pages are accumulated client-side, so older rows are appended rather
    than replacing the window. The old `limit: pageSize * pages` form could
    never reach row 51 once the server clamped `limit` to 50 — a permanent
    "Show more (1 older)" that re-fetched the same rows and never exhausted.
    Show more only pages history; it never reruns a scan.
  */
  const [pages, setPages] = useState(1);
  const pageSize = 12;
  // Rows accumulated across every page loaded so far.
  const [loadedRows, setLoadedRows] = useState<import("@/lib/news/types").ScanRow[]>([]);
  const scans = useQuery({
    queryKey: ["scans", pages],
    queryFn: () =>
      listScans({
        data: { limit: nextWindowSize(pageSize), offset: pageOffset(pages, pageSize) },
      }),
    refetchInterval: (q) => {
      const row = q.state.data?.rows?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  // Accumulate each fetched page into the loaded list (de-duped by id).
  useEffect(() => {
    const rows = scans.data?.rows;
    if (!rows) return;
    setLoadedRows((prev) => accumulateScanPages(prev, rows));
  }, [scans.data]);
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  // P0-1: accepted sources available for the Custom picker.
  const accepted = useQuery({ queryKey: ["scan-accepted"], queryFn: () => listAcceptedScanSources() });
  // P0-2: saved packs.
  const packs = useQuery({ queryKey: ["scan-packs"], queryFn: () => listScanSourcePacksFn() });
  /*
    A refusal is not a failure, and it needs different words.

    Scan used to enqueue whatever the model situation was: it fetched every
    source and died at the model call, showing a failed run and inviting a
    retry that could not help. runScan now checks first and returns setup
    guidance instead, which this renders as its own state — with the Run
    button hidden when pressing it again cannot work.
  */
  const [blocked, setBlocked] = useState<{
    guidance: string;
    detail: string;
    retryable: boolean;
  } | null>(null);
  // Per click, not persisted -- same as Story's picker (see model-choice.ts).
  const [modelChoice, setModelChoice] = useState<StoryModelChoice>("auto");
  const [modelEffort, setModelEffort] = useState<ModelEffort | null>(null);

  const history = loadedRows;
  const totalScans = scans.data?.total ?? history.length;
  const exhausted = isHistoryExhausted(history.length, totalScans);
  const watch = (sources.data ?? []).filter((s) => s.status === "accepted").length;
  const last = history[0];
  // A row can look open (no finished_at, no error) forever if the process
  // that was running it died mid-scan -- the machine rebooting, the app
  // restarting. `listScans` marks that row `stalled` by checking whether a
  // live job is actually behind it. Audit: this used to be purely
  // `!last.finished_at && !last.error`, which left the Run button disabled
  // and the page spinning with no way to start over.
  const stalled = Boolean(last?.stalled);
  /*
    Unit U24: the run this page was showing when the press happened, so the
    report on screen can be told from the one being waited for. `runScan`
    returns as soon as the job is queued and the history query has not come
    back yet, and in that window the page used to draw the previous run's
    finished report under the new scan's progress (see
    `scanReportIsCurrent` in scan-history.ts).
  */
  const [reportBeforePress, setReportBeforePress] = useState<number | null>(null);
  const scan = useMutation({
    mutationFn: async () => {
      const showing = history[0]?.id ?? null;
      return {
        showing,
        res: await runScan({
          data: {
            modelChoice,
            modelEffort,
            sectionKey: scope === "section" ? sectionKey || undefined : undefined,
            customSourceIds: scope === "custom" && !packId ? pickedIds : undefined,
            packId: scope === "custom" && packId ? packId : undefined,
          },
        }),
      };
    },
    onSuccess: ({ res, showing }) => {
      if (res && "ok" in res && res.ok === false) {
        setBlocked({
          guidance: res.error,
          detail: res.detail ?? "",
          retryable: Boolean(res.retryable),
        });
        return;
      }
      setBlocked(null);
      setReportBeforePress(showing);
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      // FB1: the card for the scan just queued. See invalidateDeskJobs.
      invalidateDeskJobs(qc);
    },
  });

  /*
    Unit U24: the third clause is the one that was missing. With only the first
    two the page could say "not scanning" while it was waiting for the run it
    had just started, and draw that run's predecessor's report as though it
    were the answer. See `scanIsRunning` in scan-history.ts.
  */
  const scanning = scanIsRunning({
    pressInFlight: scan.isPending,
    newestOpen: Boolean(last && !last.finished_at && !last.error && !stalled),
    newestRunId: last?.id ?? null,
    reportBeforePress,
  });
  /*
    THE RUNNING SCAN'S JOB ROW, from the one desk-jobs query (FB1, unit 4).

    The page polls `scan_runs` (the run record) because that is what the history
    list and the coverage accounting are; the CARD reads `desk_jobs`, because
    that is where the stage list, the step, the percentage and the heartbeat
    live. Two rows, one run -- and the job is the one the card can draw.
  */
  const deskJobs = useDeskJobs();
  const scanJob =
    (deskJobs.data ?? []).find(
      (job) => job.kind === "scan" && (job.status === "queued" || job.status === "running"),
    ) ?? null;

  return (
    <DeskShell title="Scan" kicker="Reporter pass">
      <div className="astra-split">
        <div className="astra-col">
          {/*
            The run panel, drawn with the same yellow border the Sources screen
            puts on its Daily scan panel: this is the one control on this page
            that spends money, and it is what the page is for.

            The scope picker, the section picker and the custom-source pick or
            saved pack are all the controls that were here before; what changed
            is that they now sit inside the panel that owns them rather than
            loose on the page. "Scan scope" keeps its label text and its options
            verbatim, because the walks select on them.
          */}
          <div className="astra-panel hot">
            <h2 className="astra-panel-h lg">Run a scan</h2>
            <p className="astra-note">
              One pass over the watch list: fetch every accepted source, then one AI read for
              leads and proposed sources. It runs only when you click — this is the expensive
              button, not a loop.
            </p>
            <div className="astra-toolbar">
        <label>Scan scope{" "}
          <select
            className="ml-2 border border-rule bg-transparent p-2"
            value={scope}
            onChange={(e) => {
              const next = e.target.value as "general" | "section" | "custom";
              setScope(next);
              setBlocked(null);
              if (next !== "custom") { setPackId(null); }
              if (next !== "section") { setSectionKey(""); }
            }}
            disabled={scanning}
          >
            <option value="general">General Scan · all accepted sources</option>
            <option value="section">Section scan · one section assigned sources</option>
            <option value="custom">Custom sources · exact set, or a saved pack</option>
          </select>
        </label>
        {scope === "section" ? (
          <label>Section{" "}
            <select
              className="ml-2 border border-rule bg-transparent p-2"
              value={sectionKey}
              onChange={(e) => { setSectionKey(e.target.value); setBlocked(null); }}
              disabled={scanning}
            >
              <option value="">Choose a section…</option>
              {sections.filter((s) => !["about", "opinion"].includes(s.key)).map((s) => (
                <option value={s.key} key={s.key}>{s.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {scope === "section" ? (
        <p className="astra-note">
          Uses this section accepted assigned sources and saved reporting brief.{" "}
          <Link to="/desk/ops" className="underline">Configure sections in Paper setup</Link>.
        </p>
      ) : null}
      {scope === "custom" ? (
        <CustomSourcePicker
          sources={accepted.data ?? []}
          packs={packs.data ?? []}
          pickedIds={pickedIds}
          setPickedIds={setPickedIds}
          filter={sourceFilter}
          setFilter={setSourceFilter}
          kindFilter={kindFilter}
          setKindFilter={setKindFilter}
          tierFilter={tierFilter}
          setTierFilter={setTierFilter}
          packId={packId}
          setPackId={setPackId}
          packName={packName}
          setPackName={setPackName}
          disabled={scanning}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ["scan-packs"] }); }}
        />
      ) : null}
      <div className="scan-bar">
        <ModelPicker scope="scan" value={modelChoice} onChange={(choice) => { setModelChoice(choice); setModelEffort(defaultModelEffort(choice)); }} effort={modelEffort} onEffortChange={setModelEffort} disabled={scanning} compact />
        <InkButton disabled={scanning} onClick={() => scan.mutate()}>
          {scanning ? "Scanning sources…" : "Run scan"}
        </InkButton>
        <p className="meta">
          {watch} sources on watch
          {last ? ` · last ran ${formatDateTime(last.started_at)}` : ""}
        </p>
      </div>
      {/*
        FB1, unit 4 / FB1b, item 3: THE SCAN'S OWN CARD, IN THE PANEL.

        This was one shimmering `Busy` sentence -- "Fetching accepted sources,
        then one pass for leads. Stay on this page." -- with no stage, no count,
        no elapsed clock, no stall flag and no way to stop it, on the longest
        and most expensive job the desk runs.

        FB1 put the card on the page; FB1b put it HERE, inside the panel that
        owns the Run scan button. The card used to render below the panel, and
        on a laptop the editor who pressed the button got no visible change at
        all -- the one thing they had just asked for was under the fold. The
        press and its progress are the same thought, so they are the same box.

        "Stay on this page" is gone with the sentence. It was advice the desk
        could not keep (the job is durable and survives navigation) and it was
        the only thing the line said about the wait.

        Until the query answers there is a `Busy` line, because a scan can be
        queued before its row arrives -- but it promises nothing and it names no
        stage it does not know.
      */}
      {scanJob ? (
        <div className="scan-job-card">
          <DeskJobCard job={scanJob} />
        </div>
      ) : scanning ? (
        <Busy label="Starting the scan…" />
      ) : null}
            <p className="astra-note">
              Scans file leads only. They never draft or publish.
            </p>
          </div>
      {!scanning && stalled ? <Notice kind="err">{stalledRunCopy("scan")}</Notice> : null}
      {!scanning && !stalled && last && !last.error && last.leads_created > 0 ? (
        <div className="scan-result">
          <p className="wire-line">
            <b>Done.</b>{" "}
            {scanCoverageLine(last) ??
              scanCountsLine({
                sources_fetched: last.sources_fetched,
                leads_created: last.leads_created,
                sources_proposed: last.sources_proposed,
              })}
          </p>
          {failedSourcesLine(parseFailedSources(last.failed_sources)) ? (
            <p className="wire-warn">{failedSourcesLine(parseFailedSources(last.failed_sources))}</p>
          ) : null}
          {last.summary ? <p className="wire-sum">{last.summary}</p> : null}
          <Link to="/desk/queue">
            <InkButton>Open the queue</InkButton>
          </Link>
        </div>
      ) : null}
      {!scanning && !stalled && last && !last.error && last.leads_created === 0 ? (
        <div className="scan-result zero">
          <p className="wire-line">
            <b>
              {scanCoverageLine(last)?.startsWith("Partial")
                ? "Scan finished with partial coverage."
                : `Fetched ${last.sources_fetched}. Filed nothing.`}
            </b>
          </p>
          {scanCoverageLine(last) ? <p className="wire-sum">{scanCoverageLine(last)}</p> : null}
          {failedSourcesLine(parseFailedSources(last.failed_sources)) ? (
            <p className="wire-warn">{failedSourcesLine(parseFailedSources(last.failed_sources))}</p>
          ) : null}
          <p className="wire-sum">{scanZeroWhy(last)}</p>
          <InkButton tone="ghost" disabled={scanning} onClick={() => scan.mutate()}>
            Run again
          </InkButton>
        </div>
      ) : null}
      {!scanning && last?.error ? (
        <Notice kind="err">
          {editorScanError(last.error)}
          <ProviderSignInButton detail={last.error} />
        </Notice>
      ) : null}
      {blocked ? (
        <Notice kind="err">
          <b>The desk cannot scan yet.</b>
          <br />
          {blocked.guidance}
          {blocked.detail ? (
            <>
              <br />
              <span className="meta">{blocked.detail}</span>
            </>
          ) : null}
          {/*
            The refusal already names the provider whose login lapsed; this is
            the button that acts on it, rather than sending the editor to a
            terminal. Reads the raw detail AND the guidance, because a preflight
            refusal carries the provider's own words in one and the desk's
            in the other.
          */}
          <ProviderSignInButton detail={`${blocked.guidance} ${blocked.detail}`} />
        </Notice>
      ) : null}
      {scan.error ? (
        // "Select all shown" adds every visible accepted source, and
        // `runScanInput.customSourceIds` caps the pack at 200: a paper with
        // more than that selected reached this line with the issues array.
        <Notice kind="err">
          {editorActionError(scan.error instanceof Error ? scan.error.message : "", "start that scan") ??
            "Scan failed"}
        </Notice>
      ) : null}

      <MeetingsActivity />
        </div>
        {/*
          Previous scans, in the right-hand column the design draws. The
          `SecHead` stays: it carries the section's own count, which the
          scan-desk walk reads as ".sechead .sec-count" and asserts is 0 on a
          fresh desk. Paging stays here rather than becoming a link to itself
          -- /desk/scan is where the full history lives.
        */}
        <aside className="astra-col">
          <div className="astra-panel">
        <SecHead
          title="Previous scans"
          count={totalScans}
          sub={`Showing latest ${history.length} of ${totalScans}`}
        />
      {scans.isError && history.length === 0 ? (
        <ScreenError
          message={scans.error instanceof Error ? scans.error.message : "Could not load previous scans."}
          onRetry={() => void scans.refetch()}
          retrying={scans.isRefetching}
        />
      ) : scans.isPending && history.length === 0 ? (
        <ListSkeleton rows={3} />
      ) : history.length === 0 ? (
        <p className="wire-sum">No scans yet. Click Run scan when you want a new pass — not on a loop.</p>
      ) : (
        <div className="scan-hist">
          {history.map((s) => (
            <div key={s.id} className="scan-row">
              {/*
                The design puts a result chip on every previous scan, so the
                one fact an editor is scanning for -- did it work -- is readable
                without reading the line under it. The variants are the shared
                chip family, not new colours: a failure keeps the danger
                border, a stall the amber one, and a clean pass the plain rule.
              */}
              <div className="astra-row-acts">
                {s.error ? (
                  <span className="astra-chip fail">Failed</span>
                ) : s.stalled ? (
                  <span className="astra-chip warn">Stalled</span>
                ) : !s.finished_at ? (
                  <span className="astra-chip run">Running</span>
                ) : s.leads_created > 0 ? (
                  <span className="astra-chip found">
                    Filed {s.leads_created} lead{s.leads_created === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="astra-chip">No leads</span>
                )}
              </div>
              <p className="meta">
                {formatDateTime(s.started_at)} ·{" "}
                {s.execution_origin === "scheduled" ? "Scheduled daily scan" : "Manual scan"}
              </p>
              {/*
                ONE LINE, AND IT IS THE RUN'S OWN STATE (FB1b, item 2).

                This used to hand an OPEN run to `scanCoverageLine` and
                `scanZeroWhy`, which are sentences about a FINISHED run: a scan
                thirty seconds into its fetch read "Partial coverage: 0 selected
                · 2 fetched · 0 analyzed · 0 leads." and "Nothing in the fetched
                pages crossed the filing bar." -- three claims about the end of
                a run nobody had reached. `scanRowLine` answers for the running
                case first and totally; the failed-source line and the "why"
                below it are verdicts on a result and are gated on there being
                one.
              */}
              <p className="scan-line">{scanRowLine(s)}</p>
              {/*
                WHAT THE RUN FOUND IS NOT A VERDICT ON HOW IT ENDED, so this
                line sits OUTSIDE the gate below.

                The gate is for the sentences that assert a RESULT -- the
                failed-source line, the "why", the stall copy, the error. This
                is not one of those: it is the run's own record, and a row that
                has not settled is making no claim by carrying it. FB1b swept it
                into the same fragment, which no scan this desk writes could
                tell apart (the receipt sets `summary` and `finished_at` in one
                statement) and every row a worker died on could:
                `stalled-run.e2e.test.ts` (unit CR) seeds an orphan and rows
                whose jobs are terminal or gone, identifies them by this column,
                and drew four rows -- right chips, and none of them saying which
                run it was.
              */}
              {s.leads_created > 0 && s.summary ? (
                <p className="wire-sum">{s.summary}</p>
              ) : null}
              {s.finished_at || s.error ? (
                <>
                  {failedSourcesLine(parseFailedSources(s.failed_sources)) ? (
                    <p className="wire-warn">
                      {failedSourcesLine(parseFailedSources(s.failed_sources))}
                    </p>
                  ) : null}
                  {s.stalled ? (
                    <p className="wire-warn">{stalledRunCopy("scan")}</p>
                  ) : s.leads_created === 0 ? (
                    <p className="wire-sum">{scanZeroWhy(s)}</p>
                  ) : s.error ? (
                    <p className="wire-warn">{editorScanError(s.error)}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
          {!exhausted ? (
            <div className="mt-4">
              <InkButton
                tone="ghost"
                disabled={scans.isFetching}
                onClick={() => setPages((n) => n + 1)}
              >
                {scans.isFetching ? "Loading older scans…" : `Show more (${totalScans - history.length} older)`}
              </InkButton>
            </div>
          ) : null}
        </div>
      )}
          </div>
        </aside>
      </div>
    </DeskShell>
  );
}
/**
 * P0-1 / P0-2 Custom sources picker.
 *
 * Functional controls only (no visual redesign): search accepted sources by
 * name/URL, filter by kind/tier, select any number with a live count, clear
 * all, select all, and save/run/edit/rename/delete a named pack. Proposed,
 * rejected and unavailable sources are never listed because the query only
 * returns accepted rows.
 */
function CustomSourcePicker(props: {
  sources: { id: number; title: string; url: string; kind: string; tier: string; status: string }[];
  packs: { id: number; name: string; sourceIds: number[]; acceptedCount: number }[];
  pickedIds: number[];
  setPickedIds: (next: number[]) => void;
  filter: string;
  setFilter: (v: string) => void;
  kindFilter: string;
  setKindFilter: (v: string) => void;
  tierFilter: string;
  setTierFilter: (v: string) => void;
  packId: number | null;
  setPackId: (v: number | null) => void;
  packName: string;
  setPackName: (v: string) => void;
  disabled: boolean;
  onSaved: () => void;
}) {
  const {
    sources, packs, pickedIds, setPickedIds, filter, setFilter,
    kindFilter, setKindFilter, tierFilter, setTierFilter,
    packId, setPackId, packName, setPackName, disabled, onSaved,
  } = props;
  const picked = new Set(pickedIds);
  const term = filter.trim().toLowerCase();
  const visible = sources.filter(
    (s) =>
      (!term || s.title.toLowerCase().includes(term) || s.url.toLowerCase().includes(term)) &&
      (!kindFilter || s.kind === kindFilter) &&
      (!tierFilter || s.tier === tierFilter),
  );
  const kinds = [...new Set(sources.map((s) => s.kind))].sort();
  const tiers = [...new Set(sources.map((s) => s.tier))].sort();

  const mutation = useMutation({
    mutationFn: async (input: { name: string; sourceIds: number[]; packId?: number }) =>
      saveScanSourcePackFn({ data: input }),
    onSuccess: () => {
      onSaved();
    },
  });
  /*
    FB5: the two presses that could fail without a word (FB0-REPORT.md Table B,
    Scan: "Delete pack … SILENT FAIL + NO UNDO + no confirm", "Rename … SILENT
    FAIL"). Unlike the mutations converted this unit, each of these has exactly
    ONE press site, so the press itself is what carries the states: the button
    disables itself and draws "Deleting…", and the outcome — the pack gone, or
    the reason the server refused — arrives as a toast. That is the
    press→pending→done/failed shape of `useDeskAction`, and it is why these two
    keep a plain `useMutation` underneath: the work is one call, not a shared
    mutation reporting for four different buttons.
  */
  const del = useMutation({
    mutationFn: async (id: number) => deleteScanSourcePackFn({ data: { packId: id } }),
    onSuccess: () => onSaved(),
  });
  const deletePack = useDeskAction<unknown>({
    pending: "Deleting…",
    done: () => "Pack deleted: the saved set is gone from this list.",
    failedLead: "Could not delete that pack. ",
  });
  const rename = useMutation({
    mutationFn: async (input: { packId: number; name: string }) =>
      renameScanSourcePackFn({ data: input }),
    onSuccess: () => onSaved(),
  });
  const renamePack = useDeskAction<{ name: string }>({
    pending: "Renaming…",
    /*
      The name comes back from the press rather than read from `renameTo` at
      the end: the work clears the box, and a toast that read the live field
      would race that clear and finish the sentence with an empty name.
    */
    done: (result) => `Pack renamed to “${result.name}”.`,
    failedLead: "Could not rename that pack. ",
  });
  const [renameTo, setRenameTo] = useState("");

  return (
    <div className="astra-panel plain">
      {/*
        A nested panel: the exact set a Custom scan runs on. Everything under it
        -- the saved pack, the search, the kind and tier filters, select all,
        clear all, save as pack, and the checkbox list -- is unchanged; only the
        wrapper and the button sizes moved, because ".btn.small" is a 36px
        control and every button on this desk has to clear 44px.
      */}
      <h3 className="astra-panel-h">Custom sources</h3>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <label>
          Saved pack{" "}
          <select
            className="border border-rule bg-transparent p-2"
            value={packId ?? ""}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setPackId(id);
              if (id) {
                const p = packs.find((x) => x.id === id);
                if (p) setPickedIds([...p.sourceIds]);
              }
            }}
            disabled={disabled}
          >
            <option value="">No pack — pick sources below</option>
            {packs.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} ({p.acceptedCount} accepted)
              </option>
            ))}
          </select>
        </label>
        {packId ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={disabled || rename.isPending}
              onClick={() => {
                const p = packs.find((x) => x.id === packId);
                if (p) { setRenameTo(p.name); }
              }}
            >
              Rename…
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={disabled || deletePack.isPending}
              aria-busy={deletePack.isPending || undefined}
              onClick={() => {
                if (packId) void deletePack.run(() => del.mutateAsync(packId));
              }}
            >
              {deletePack.isPending ? deletePack.pendingLabel : "Delete pack"}
            </button>
          </>
        ) : null}
      </div>
      {renameTo ? (
        <div className="mb-2 flex items-center gap-2">
          <input
            className="border border-rule bg-transparent p-2"
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            aria-label="New pack name"
          />
          <button
            type="button"
            className="btn"
            disabled={renamePack.isPending || !renameTo.trim()}
            aria-busy={renamePack.isPending || undefined}
            onClick={() => {
              const name = renameTo.trim();
              if (!packId || !name) return;
              void renamePack.run(async () => {
                await rename.mutateAsync({ packId, name });
                setRenameTo("");
                return { name };
              });
            }}
          >
            {renamePack.isPending ? renamePack.pendingLabel : "Save name"}
          </button>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <input
          className="border border-rule bg-transparent p-2"
          placeholder="Search accepted sources by name or URL…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search accepted sources"
          disabled={disabled}
        />
        <label>Kind{" "}
          <select className="border border-rule bg-transparent p-2" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} disabled={disabled}>
            <option value="">All kinds</option>
            {kinds.map((k) => <option value={k} key={k}>{k}</option>)}
          </select>
        </label>
        <label>Tier{" "}
          <select className="border border-rule bg-transparent p-2" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} disabled={disabled}>
            <option value="">All tiers</option>
            {tiers.map((t) => <option value={t} key={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <p className="mb-2 meta">
        <b>{pickedIds.length} selected</b> · {visible.length} shown · only accepted sources are selectable
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => setPickedIds([...new Set([...pickedIds, ...visible.map((s) => s.id)])])}
        >
          Select all shown
        </button>
        <button type="button" className="btn" disabled={disabled || !pickedIds.length} onClick={() => setPickedIds([])}>
          Clear all
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || mutation.isPending || (!pickedIds.length && !packName.trim())}
          onClick={() => {
            const name = packName.trim() || window.prompt("Name this pack")?.trim() || "";
            if (!name) return;
            mutation.mutate({ name, sourceIds: pickedIds, packId: packId ?? undefined });
          }}
        >
          {packId ? "Update pack with selection" : "Save selection as pack"}
        </button>
      </div>
      {!packId ? (
        <input
          className="mb-2 border border-rule bg-transparent p-2"
          placeholder="Optional: name this pack"
          value={packName}
          onChange={(e) => setPackName(e.target.value)}
          aria-label="Pack name"
          disabled={disabled}
        />
      ) : null}
      {mutation.isError ? (
        // The pack name box has no `maxLength` and `packSaveInput` caps it at
        // 120, so a long name printed the schema here.
        <p className="wire-warn">
          {editorActionError(mutation.error instanceof Error ? mutation.error.message : "", "save that pack") ??
            "Could not save the pack."}
        </p>
      ) : null}

      <div className="max-h-72 overflow-auto border border-rule">
        {visible.length === 0 ? (
          <p className="p-2 wire-sum">No accepted sources match this filter.</p>
        ) : (
          visible.map((s) => (
            <label key={s.id} className="flex items-start gap-2 border-b border-rule p-2 last:border-b-0">
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                disabled={disabled}
                onChange={(e) => {
                  setPickedIds(
                    e.target.checked ? [...new Set([...pickedIds, s.id])] : pickedIds.filter((id) => id !== s.id),
                  );
                }}
              />
              <span>
                <b>{s.title}</b>
                <span className="meta"> · {s.tier} · {s.kind}</span>
                <br />
                <span className="meta">{s.url}</span>
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}