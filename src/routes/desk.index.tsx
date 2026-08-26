import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell, inkGhost, inkSolid } from "@/components/desk-chrome";
import { EmptyState, StatSkeleton } from "@/components/states";
import { listLeads, listScans, listSources } from "@/lib/news/desk";

export const Route = createFileRoute("/desk/")({ component: DeskHome });

function DeskHome() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => listScans() });

  const booting =
    (sources.isPending && !sources.data) ||
    (leads.isPending && !leads.data) ||
    (scans.isPending && !scans.data);

  const accepted = (sources.data ?? []).filter((s) => s.status === "accepted").length;
  const proposed = (sources.data ?? []).filter((s) => s.status === "proposed").length;
  const openLeads = (leads.data ?? []).filter(
    (l) => l.status === "new" || l.status === "drafted",
  ).length;
  const last = scans.data?.[0];

  return (
    <DeskShell title="The desk" kicker="Editor-in-chief">
      <p className="max-w-2xl text-ink-2">
        You are the editor. Grok fetches Longmont’s public sources, files leads,
        and drafts recaps. Nothing prints until you say so. Scans and drafts
        spend your Grok quota — they only run when you click.
      </p>
      {booting ? (
        <div className="mt-8">
          <StatSkeleton />
        </div>
      ) : (
        <dl className="stagger-in mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Sources on watch" value={accepted} />
          <Stat label="Proposed sources" value={proposed} />
          <Stat label="Open leads" value={openLeads} />
          <Stat label="Scans run" value={scans.data?.length ?? 0} />
        </dl>
      )}
      {last ? (
        <section className="enter-fade-fast mt-8 border border-rule bg-paper p-4">
          <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
            Last scan
          </p>
          {last.summary ? (
            <p className="mt-2 text-ink-2">{last.summary}</p>
          ) : last.error ? (
            <p className="mt-2 text-danger">{last.error}</p>
          ) : (
            <p className="mt-2 text-ink-2">
              {last.sources_fetched} sources · {last.leads_created} leads
            </p>
          )}
          {last.leads_created > 0 && (
            <Link
              to="/desk/queue"
              className="mt-3 inline-flex min-h-11 items-center text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
            >
              {last.leads_created} leads in the queue
            </Link>
          )}
        </section>
      ) : !booting ? (
        <div className="mt-8">
          <EmptyState
            kicker="Reporter pass"
            title="No scans yet"
            body="The watch list is ready. Run a scan when you want a new edition — not on a loop."
            action={
              <Link to="/desk/scan" className={inkSolid}>
                Run the first scan
              </Link>
            }
          />
        </div>
      ) : null}
      <div className="mt-8 flex flex-wrap gap-3">
        {booting || last ? (
          <Link to="/desk/scan" className={inkSolid}>
            Run a scan
          </Link>
        ) : null}
        <Link to="/desk/queue" className={inkGhost}>
          Open the queue
        </Link>
        <Link to="/desk/dark" className={inkSolid}>
          Dark desk
        </Link>
        <Link to="/desk/sources" className={inkGhost}>
          Review sources
        </Link>
      </div>
    </DeskShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-rule bg-paper p-4">
      <dt className="text-[11px] tracking-[0.12em] text-muted uppercase">{label}</dt>
      <dd className="mt-1 font-display text-3xl tabular-nums">{value}</dd>
    </div>
  );
}
