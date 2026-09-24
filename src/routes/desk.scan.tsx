import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { MeetingsActivity } from "@/components/meetings-activity";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { deleteScanSourcePackFn, listAcceptedScanSources, listScanSourcePacksFn, listScans, listSources, renameScanSourcePackFn, runScan, saveScanSourcePackFn } from "@/lib/news/desk";
import { editorScanError, scanCountsLine, scanCoverageLine, parseFailedSources, failedSourcesLine, scanZeroWhy, stalledRunCopy } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import { defaultModelEffort, type ModelEffort } from "@/lib/news/provider-registry";
import { useEditorSections } from "@/lib/use-sections";
import { pageOffset, nextWindowSize, isHistoryExhausted, accumulateScanPages } from "@/lib/news/scan-history";

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

  const scan = useMutation({
    mutationFn: () =>
      runScan({
        data: {
          modelChoice,
          modelEffort,
          sectionKey: scope === "section" ? sectionKey || undefined : undefined,
          customSourceIds: scope === "custom" && !packId ? pickedIds : undefined,
          packId: scope === "custom" && packId ? packId : undefined,
        },
      }),
    onSuccess: (res) => {
      if (res && "ok" in res && res.ok === false) {
        setBlocked({
          guidance: res.error,
          detail: res.detail ?? "",
          retryable: Boolean(res.retryable),
        });
        return;
      }
      setBlocked(null);
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });

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
  const scanning = scan.isPending || Boolean(last && !last.finished_at && !last.error && !stalled);

  return (
    <DeskShell title="Scan" kicker="Reporter pass">
      {/* P0-1/P0-2: three scan scopes. Functional controls only, reusing the
          existing section/label patterns; no visual redesign. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
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
        <p className="mb-4 text-sm">
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
      <p className="lede">
        One pass over the watch list: fetch every accepted source, then one AI read for leads and
        proposed sources. It runs only when you click — this is the expensive button, not a loop.
      </p>
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
      {scanning ? (
        <Busy label="Fetching accepted sources, then one pass for leads. Stay on this page." />
      ) : null}
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
            <InkButton small>Open the queue</InkButton>
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
          <InkButton tone="ghost" small disabled={scanning} onClick={() => scan.mutate()}>
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
        <Notice kind="err">{scan.error instanceof Error ? scan.error.message : "Scan failed"}</Notice>
      ) : null}

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
              <p className="meta">
                {formatDateTime(s.started_at)} ·{" "}
                {s.execution_origin === "scheduled" ? "Scheduled daily scan" : "Manual scan"}
              </p>
              <p className="scan-line">
                {scanCoverageLine(s) ??
                  scanCountsLine({
                    sources_fetched: s.sources_fetched,
                    leads_created: s.leads_created,
                    sources_proposed: s.sources_proposed,
                  })}
              </p>
              {failedSourcesLine(parseFailedSources(s.failed_sources)) ? (
                <p className="wire-warn">{failedSourcesLine(parseFailedSources(s.failed_sources))}</p>
              ) : null}
              {s.leads_created > 0 && s.summary ? <p className="wire-sum">{s.summary}</p> : null}
              {s.stalled ? (
                <p className="wire-warn">{stalledRunCopy("scan")}</p>
              ) : s.leads_created === 0 ? (
                <p className="wire-sum">{scanZeroWhy(s)}</p>
              ) : s.error ? (
                <p className="wire-warn">{editorScanError(s.error)}</p>
              ) : null}
            </div>
          ))}
          {!exhausted ? (
            <div className="mt-4">
              <InkButton
                tone="ghost"
                small
                disabled={scans.isFetching}
                onClick={() => setPages((n) => n + 1)}
              >
                {scans.isFetching ? "Loading older scans…" : `Show more (${totalScans - history.length} older)`}
              </InkButton>
            </div>
          ) : null}
        </div>
      )}
      <MeetingsActivity />
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
  const del = useMutation({
    mutationFn: async (id: number) => deleteScanSourcePackFn({ data: { packId: id } }),
    onSuccess: () => onSaved(),
  });
  const rename = useMutation({
    mutationFn: async (input: { packId: number; name: string }) =>
      renameScanSourcePackFn({ data: input }),
    onSuccess: () => onSaved(),
  });
  const [renameTo, setRenameTo] = useState("");

  return (
    <div className="mb-4 border border-rule p-3 text-sm">
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
              className="btn small"
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
              className="btn small danger"
              disabled={disabled || del.isPending}
              onClick={() => { if (packId) del.mutate(packId); }}
            >
              Delete pack
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
            className="btn small"
            disabled={rename.isPending || !renameTo.trim()}
            onClick={() => {
              if (packId) rename.mutate({ packId, name: renameTo }, { onSuccess: () => setRenameTo("") });
            }}
          >
            Save name
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
          className="btn small"
          disabled={disabled}
          onClick={() => setPickedIds([...new Set([...pickedIds, ...visible.map((s) => s.id)])])}
        >
          Select all shown
        </button>
        <button type="button" className="btn small" disabled={disabled || !pickedIds.length} onClick={() => setPickedIds([])}>
          Clear all
        </button>
        <button
          type="button"
          className="btn small"
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
      {mutation.isError ? <p className="wire-warn">{mutation.error instanceof Error ? mutation.error.message : "Could not save the pack."}</p> : null}

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