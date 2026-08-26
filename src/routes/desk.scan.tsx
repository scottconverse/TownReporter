import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, InkButton, inkSolid } from "@/components/desk-chrome";
import { BusyLine, EmptyState, ListSkeleton, Notice } from "@/components/states";
import { listScans, runScan } from "@/lib/news/desk";
import { formatDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/scan")({ component: ScanPage });

function ScanPage() {
  const qc = useQueryClient();
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  const history = scans.data ?? [];

  return (
    <DeskShell title="Scan" kicker="Reporter pass">
      <p className="max-w-2xl text-ink-2">
        Fetches every accepted source on the watch list (up to 200), then
        Grok files leads and proposed official URLs. You review them in the
        queue, draft with Grok, edit, and print. This is the expensive button
        — not a loop.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <InkButton disabled={scan.isPending} onClick={() => scan.mutate()}>
          {scan.isPending ? "Scanning sources…" : "Run scan"}
        </InkButton>
      </div>
      {scan.isPending && (
        <div className="enter-fade-fast mt-6 border border-rule bg-paper-2 p-4">
          <BusyLine
            label="Fetching accepted sources, then one Grok pass for leads. Stay on this page."
          />
        </div>
      )}
      {scan.data && scan.data.ok && (
        <div className="enter-fade-fast mt-6 border border-ink bg-paper p-4">
          <p className="font-medium">
            Fetched {scan.data.fetchedCount} · leads {scan.data.leadsCreated} ·
            proposed {scan.data.proposed}
          </p>
          <p className="mt-2 text-ink-2">{scan.data.summary}</p>
          <Link to="/desk/queue" className={inkSolid + " mt-4"}>
            Open the queue
            {scan.data.leadsCreated ? ` (${scan.data.leadsCreated} leads)` : ""}
          </Link>
        </div>
      )}
      {scan.data && !scan.data.ok && (
        <Notice kind="err">{scan.data.error}</Notice>
      )}
      {scan.error && (
        <Notice kind="err">
          {scan.error instanceof Error ? scan.error.message : "Scan failed"}
        </Notice>
      )}

      <h2 className="mt-10 font-display text-2xl">Previous scans</h2>
      {scans.isPending && history.length === 0 ? (
        <ListSkeleton rows={3} />
      ) : history.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            kicker="Reporter pass"
            title="No scans yet"
            body="Nothing has been fetched. Click Run scan when you want a new edition — not on a loop."
          />
        </div>
      ) : (
        <ul className="stagger-in mt-3 divide-y divide-rule border border-rule bg-paper">
          {history.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <p className="text-sm text-muted">{formatDate(s.started_at)}</p>
              <p className="mt-1">
                {s.sources_fetched} sources · {s.leads_created} leads
                {s.error ? ` · ${s.error}` : ""}
              </p>
              {s.summary && <p className="mt-1 text-ink-2">{s.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </DeskShell>
  );
}
