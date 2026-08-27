import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Busy, DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ListSkeleton, Notice } from "@/components/states";
import { listScans, listSources, runScan } from "@/lib/news/desk";
import { editorScanError, scanCountsLine, scanZeroWhy } from "@/lib/news/desk-copy";
import { formatDateTime } from "@/lib/paper";

export const Route = createFileRoute("/desk/scan")({ component: ScanPage });

function ScanPage() {
  const qc = useQueryClient();
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const history = scans.data ?? [];
  const watch = (sources.data ?? []).filter((s) => s.status === "accepted").length;
  const last = history[0];

  return (
    <DeskShell title="Scan" kicker="Reporter pass">
      <p className="lede">
        One pass over the watch list: fetch every accepted source, then one AI read for leads and
        proposed sources. It runs only when you click — this is the expensive button, not a loop.
      </p>
      <div className="scan-bar">
        <InkButton disabled={scan.isPending} onClick={() => scan.mutate()}>
          {scan.isPending ? "Scanning sources…" : "Run scan"}
        </InkButton>
        <p className="meta">
          {watch} sources on watch
          {last ? ` · last ran ${formatDateTime(last.started_at)}` : ""}
        </p>
      </div>
      {scan.isPending ? (
        <Busy label="Fetching accepted sources, then one pass for leads. Stay on this page." />
      ) : null}
      {scan.data && scan.data.ok && scan.data.leadsCreated > 0 ? (
        <div className="scan-result">
          <p className="wire-line">
            <b>Done.</b> {scan.data.fetchedCount} fetched · {scan.data.leadsCreated} leads filed ·{" "}
            {scan.data.proposed} source proposed
          </p>
          {scan.data.summary ? <p className="wire-sum">{scan.data.summary}</p> : null}
          <Link to="/desk/queue">
            <InkButton small>Open the queue</InkButton>
          </Link>
        </div>
      ) : null}
      {scan.data && scan.data.ok && scan.data.leadsCreated === 0 ? (
        <div className="scan-result zero">
          <p className="wire-line">
            <b>Fetched {scan.data.fetchedCount}. Filed nothing.</b>
          </p>
          <p className="wire-sum">
            {scanZeroWhy({
              leads_created: 0,
              sources_fetched: scan.data.fetchedCount,
              summary: scan.data.summary,
              error: null,
            })}
          </p>
          <InkButton tone="ghost" small disabled={scan.isPending} onClick={() => scan.mutate()}>
            Run again
          </InkButton>
        </div>
      ) : null}
      {scan.data && !scan.data.ok ? <Notice kind="err">{editorScanError(scan.data.error)}</Notice> : null}
      {scan.error ? (
        <Notice kind="err">{scan.error instanceof Error ? scan.error.message : "Scan failed"}</Notice>
      ) : null}

      <SecHead title="Previous scans" count={history.length} />
      {scans.isPending && history.length === 0 ? (
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
              {s.leads_created === 0 ? (
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
