import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice, ScreenError } from "@/components/states";
import { listScans, listSources, runScan } from "@/lib/news/desk";
import { editorScanError, scanCountsLine, scanZeroWhy, stalledRunCopy } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context";
import { ProviderSignInButton } from "@/components/provider-signin-button";
import { ModelPicker } from "@/components/model-picker";
import type { StoryModelChoice } from "@/lib/news/model-choice";

export const Route = createFileRoute("/desk/scan")({ component: ScanPage });

function ScanPage() {
  const { formatDateTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  const scans = useQuery({
    queryKey: ["scans"],
    queryFn: () => listScans(),
    refetchInterval: (q) => {
      const row = q.state.data?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
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

  const scan = useMutation({
    mutationFn: () => runScan({ data: { modelChoice } }),
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

  const history = scans.data ?? [];
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
      <p className="lede">
        One pass over the watch list: fetch every accepted source, then one AI read for leads and
        proposed sources. It runs only when you click — this is the expensive button, not a loop.
      </p>
      <div className="scan-bar">
        <ModelPicker value={modelChoice} onChange={setModelChoice} disabled={scanning} compact />
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
            <b>Done.</b> {scanCountsLine({
              sources_fetched: last.sources_fetched,
              leads_created: last.leads_created,
              sources_proposed: last.sources_proposed,
            })}
          </p>
          {last.summary ? <p className="wire-sum">{last.summary}</p> : null}
          <Link to="/desk/queue">
            <InkButton small>Open the queue</InkButton>
          </Link>
        </div>
      ) : null}
      {!scanning && !stalled && last && !last.error && last.leads_created === 0 ? (
        <div className="scan-result zero">
          <p className="wire-line">
            <b>Fetched {last.sources_fetched}. Filed nothing.</b>
          </p>
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

      <SecHead title="Previous scans" count={history.length} />
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
              <p className="meta">{formatDateTime(s.started_at)}</p>
              <p className="scan-line">
                {scanCountsLine({
                  sources_fetched: s.sources_fetched,
                  leads_created: s.leads_created,
                  sources_proposed: s.sources_proposed,
                })}
              </p>
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
        </div>
      )}
    </DeskShell>
  );
}
