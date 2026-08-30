import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Busy, InkButton, SecHead } from "@/components/desk-chrome";
import { LeadRowView } from "@/components/desk-leads";
import { DeskShell } from "@/components/desk-chrome";
import { ListSkeleton, ScreenError } from "@/components/states";
import {
  listLeads,
  listMemory,
  listPublishedDesk,
  listScans,
  listSources,
  runScan,
  setLeadStatus,
  setSourceStatus,
} from "@/lib/news/desk";
import { listInvestigations, listWorthALook, openDarkInvestigation } from "@/lib/news/dark";
import {
  editorKindLabel,
  editorFetchError,
  editorScanError,
  editorStatus,
  flakyFailureCopy,
  investigationStopKind,
  nearDuplicate,
  openLeads,
  pileForStatus,
  scanCountsLine,
  scanZeroWhy,
  sourceErrorKind,
  workingQueueEmptyCopy,
  worthItemOnDesk,
} from "@/lib/news/desk-copy";
import { formatDateTime, formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/")({ component: DeskHome });

const OPEN_KEY = "townreporter.dark.openId";

function DeskHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => listSources() });
  const leads = useQuery({ queryKey: ["leads"], queryFn: () => listLeads() });
  const scans = useQuery({
    queryKey: ["scans"],
    queryFn: () => listScans(),
    refetchInterval: (q) => {
      const row = q.state.data?.[0];
      if (row && !row.finished_at && !row.error) return 2000;
      return false;
    },
  });
  const investigations = useQuery({ queryKey: ["investigations"], queryFn: () => listInvestigations() });
  const worth = useQuery({ queryKey: ["worth-a-look"], queryFn: () => listWorthALook() });
  const published = useQuery({ queryKey: ["published-desk"], queryFn: () => listPublishedDesk() });
  const memory = useQuery({ queryKey: ["memory"], queryFn: () => listMemory() });

  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "held" | "killed" | "new" }) =>
      setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const srcStatus = useMutation({
    mutationFn: (input: { id: number; status: "accepted" | "rejected" }) =>
      setSourceStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
  const scan = useMutation({
    mutationFn: () => runScan(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scans"] });
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
  const [darkErr, setDarkErr] = useState<string | null>(null);
  const startDark = useMutation({
    mutationFn: (item: { seed: string; title: string }) =>
      openDarkInvestigation({ data: { paste: item.seed, title: item.title } }),
    onSuccess: (res) => {
      if (res?.ok && res.investigationId) {
        setDarkErr(null);
        try {
          sessionStorage.setItem(OPEN_KEY, String(res.investigationId));
          sessionStorage.setItem("townreporter.dark.autodig", String(res.investigationId));
        } catch {
          /* ignore */
        }
        void navigate({ to: "/desk/dark" });
        return;
      }
      setDarkErr(res && "error" in res && res.error ? String(res.error) : "Could not open that file.");
    },
    onError: (err) => {
      setDarkErr(err instanceof Error ? err.message : "Could not open that file.");
    },
  });

  const src = sources.data ?? [];
  const allLeads = leads.data ?? [];
  const queue = openLeads(allLeads).sort(
    (a, b) => (b.newsworthiness ?? 0) - (a.newsworthiness ?? 0),
  );
  const publishedCount = allLeads.filter((l) => l.status === "published").length;
  const accepted = src.filter((s) => s.status === "accepted");
  const proposed = src.filter((s) => s.status === "proposed");
  const officialFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "official");
  const flakyFail = accepted.filter((s) => s.last_error && sourceErrorKind(s) === "flaky");
  const last = scans.data?.[0];
  const scanning =
    scan.isPending || Boolean(last && !last.finished_at && !last.error);
  const invs = investigations.data ?? [];
  const onDesk = invs.filter((r) => pileForStatus(r.status) === "desk");
  const aside = invs.filter((r) => pileForStatus(r.status) === "aside");
  const inbox = (worth.data ?? []).filter((item) => !worthItemOnDesk(item, invs));
  const errStops = onDesk.filter((i) => investigationStopKind(i) === "error");
  const roundStops = onDesk.filter((i) => investigationStopKind(i) === "round");
  const drafted = allLeads.filter((l) => l.status === "drafted").length;
  const scanStale =
    last?.error ||
    (last?.started_at && Date.now() - new Date(last.started_at).getTime() > 24 * 3600_000);
  const printed = published.data ?? [];

  const needs: { t: string; to: string; openDark?: number; quiet?: boolean }[] = [];
  if (drafted) needs.push({ t: `${drafted} draft${drafted > 1 ? "s" : ""} ready to publish`, to: "/desk/queue" });
  if (errStops.length) {
    needs.push({
      t: `${errStops.length} Dark Desk file${errStops.length === 1 ? "" : "s"} stopped on an error — what it found is saved`,
      to: "/desk/dark",
      openDark: errStops[0]!.id,
    });
  }
  if (proposed.length) {
    needs.push({
      t: `${proposed.length} proposed source${proposed.length === 1 ? "" : "s"} await${proposed.length === 1 ? "s" : ""} review`,
      to: "/desk/sources",
    });
  }
  if (officialFail.length) {
    needs.push({
      t: `${officialFail.length} official source${officialFail.length === 1 ? "" : "s"} failing to fetch`,
      to: "/desk/sources",
    });
  }
  if (scanStale && last?.error) {
    needs.push({
      t:
        last.sources_fetched > 0
          ? "Last scan fetched sources but did not file leads"
          : "Last scan failed",
      to: "/desk/scan",
    });
  } else if (scanStale) needs.push({ t: "No scan in the last day", to: "/desk/scan", quiet: true });
  if (roundStops.length) {
    needs.push({
      t: `${roundStops.length} Dark Desk file${roundStops.length === 1 ? "" : "s"} ready for another round`,
      to: "/desk/dark",
      openDark: roundStops[0]!.id,
      quiet: true,
    });
  }

  const booting = (leads.isPending && !leads.data) || (sources.isPending && !sources.data);
  // The two queries the front page cannot render anything useful without.
  // Everything else on this page degrades gracefully to "empty"; these two
  // don't, so a failed fetch needs its own terminal state rather than an
  // infinite `booting` skeleton or a silently empty desk. Audit UIUX-02.
  const bootFailed =
    (leads.isError && !leads.data) || (sources.isError && !sources.data);

  return (
    <DeskShell title="The desk" kicker="Command center">
      {needs.length > 0 ? (
        <div className="needs">
          <span className="needs-label">Needs you</span>
          {needs.map((n) => (
            <Link
              key={n.t}
              to={n.to}
              className={"needs-item" + (n.quiet ? " quiet" : "")}
              onClick={() => {
                if (n.openDark == null) return;
                try {
                  sessionStorage.setItem(OPEN_KEY, String(n.openDark));
                } catch {
                  /* ignore */
                }
              }}
            >
              {n.t}
            </Link>
          ))}
        </div>
      ) : null}

      {bootFailed ? (
        <ScreenError
          message={
            (leads.error instanceof Error && leads.error.message) ||
            (sources.error instanceof Error && sources.error.message) ||
            "Could not load the desk."
          }
          onRetry={() => {
            void leads.refetch();
            void sources.refetch();
          }}
          retrying={leads.isRefetching || sources.isRefetching}
        />
      ) : booting ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="front">
          <section>
            <SecHead
              title="The queue"
              count={queue.length}
              aside={
                <Link to="/desk/queue" className="np-link">
                  Full queue
                </Link>
              }
            />
            {queue.length === 0 ? (
              !last && publishedCount === 0 ? (
                <p className="wire-sum">
                  Queue is empty —{" "}
                  <Link to="/desk/scan" className="inline-link">
                    run the first scan
                  </Link>{" "}
                  or{" "}
                  <Link to="/desk/queue" className="inline-link">
                    file a lead
                  </Link>
                  .
                </p>
              ) : (
                <p className="wire-sum">
                  {workingQueueEmptyCopy({
                    publishedCount,
                    lastScan: last
                      ? {
                          leads_created: last.leads_created,
                          sources_fetched: last.sources_fetched,
                          error: last.error,
                        }
                      : null,
                  })}{" "}
                  <Link to="/desk/scan" className="inline-link">
                    Run the scan again
                  </Link>
                  {publishedCount > 0 ? (
                    <>
                      {" · "}
                      <Link to="/desk/published" className="inline-link">
                        Published
                      </Link>
                    </>
                  ) : null}
                  .
                </p>
              )
            ) : (
              <div className="lead-list">
                {queue.slice(0, 8).map((l) => (
                  <LeadRowView
                    key={l.id}
                    lead={l}
                    dup={nearDuplicate(l, printed)}
                    onHold={() => setStatus.mutate({ id: l.id, status: "held" })}
                    onBack={() => setStatus.mutate({ id: l.id, status: "new" })}
                    onKill={() => setStatus.mutate({ id: l.id, status: "killed" })}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="nightpanel">
            <SecHead
              title="Dark Desk"
              aside={
                <Link to="/desk/dark" className="np-link">
                  Open the desk
                </Link>
              }
            />
            <p className="np-note">Investigates. Never prints.</p>
            {darkErr ? <p className="note err">{darkErr}</p> : null}
            {inbox.length === 0 && onDesk.length === 0 ? (
              <p className="wire-sum">
                Nothing new tonight.{" "}
                <Link to="/desk/dark" className="inline-link">
                  Start from a tip
                </Link>
                .
              </p>
            ) : (
              <>
                <p className="np-pile">To look at · {inbox.length}</p>
                {inbox.slice(0, 3).map((item) => (
                  <div key={item.id} className="np-item">
                    <p className="np-kind">{editorKindLabel(item.kind)}</p>
                    <p className="np-title">{item.title}</p>
                    {item.source_line ? <p className="np-meta">{item.source_line}</p> : null}
                    <div className="np-acts">
                      <InkButton
                        tone="invert"
                        small
                        disabled={startDark.isPending}
                        onClick={() => startDark.mutate({ seed: item.seed, title: item.title })}
                      >
                        Start digging
                      </InkButton>
                    </div>
                  </div>
                ))}
                <p className="np-pile">On the desk · {onDesk.length}</p>
                {onDesk.slice(0, 3).map((row) => (
                  <div key={row.id} className="np-item">
                    <p className="np-kind">{editorStatus(row.status)}</p>
                    <p className="np-title">{row.title}</p>
                    <p className="np-meta">
                      {Number(row.records ?? 0)} records · {Number(row.still_open ?? 0)} still to open
                    </p>
                    <div className="np-acts">
                      <Link
                        to="/desk/dark"
                        className="btn invert small"
                        onClick={() => {
                          try {
                            sessionStorage.setItem(OPEN_KEY, String(row.id));
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        Open file
                      </Link>
                    </div>
                  </div>
                ))}
                <p className="np-pile">
                  Set aside · {aside.length}{" "}
                  <Link to="/desk/dark" className="np-link">
                    see the pile
                  </Link>
                </p>
              </>
            )}
          </section>

          <section className="wirecol">
            <SecHead
              title="The wire"
              aside={
                <InkButton small disabled={scanning} onClick={() => scan.mutate()}>
                  {scanning ? "Scanning…" : "Run scan"}
                </InkButton>
              }
            />
            {scanning ? <Busy label="Fetching the watch list, then one pass for leads." /> : null}
            {last ? (
              <>
                <p className="wire-line">
                  <b>Last scan</b> · {formatDateTime(last.started_at)} ·{" "}
                  {last.leads_created > 0 ? (
                    scanCountsLine(last)
                  ) : (
                    <>
                      {last.sources_fetched} fetched · <b>filed nothing</b>
                    </>
                  )}
                </p>
                {scanZeroWhy(last) ? <p className="wire-sum">{scanZeroWhy(last)}</p> : null}
                {last.error && last.leads_created > 0 ? (
                  <p className="wire-warn">{editorScanError(last.error)}</p>
                ) : null}
              </>
            ) : (
              <p className="wire-sum">No scans yet — the watch list is ready.</p>
            )}
            <div className="wire-block">
              <p className="wire-line">
                <b>Source health</b> · {accepted.length} on watch
                {officialFail.length + flakyFail.length
                  ? ` · ${officialFail.length + flakyFail.length} failing`
                  : ""}
              </p>
              {officialFail.map((s) => (
                <p key={s.id} className="wire-warn">
                  {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                </p>
              ))}
              {flakyFail.length ? (
                <details className="wire-flaky">
                  <summary>{flakyFailureCopy(flakyFail.length)}</summary>
                  {flakyFail.map((s) => (
                    <p key={s.id}>
                      {s.title} — {editorFetchError(s.last_error, s.url) ?? s.last_error}
                    </p>
                  ))}
                </details>
              ) : null}
              {proposed.map((s) => (
                <p key={s.id} className="wire-row">
                  Proposed: {s.title}{" "}
                  <InkButton tone="quiet" small onClick={() => srcStatus.mutate({ id: s.id, status: "accepted" })}>
                    Accept
                  </InkButton>
                  <InkButton tone="quiet" small onClick={() => srcStatus.mutate({ id: s.id, status: "rejected" })}>
                    Drop
                  </InkButton>
                </p>
              ))}
              {!officialFail.length && !flakyFail.length && !proposed.length ? <p className="meta">All quiet.</p> : null}
            </div>
            <div className="wire-block">
              <p className="wire-line">
                <b>On the paper</b>
              </p>
              {(published.data ?? []).slice(0, 3).map((p) => (
                <p key={p.id} className="wire-row">
                  <Link to="/desk/published" className="hl-link sm">
                    {p.headline}
                  </Link>
                  <span className="meta-inline">
                    {formatShortDate(p.published_at)}
                    {p.corrections.length ? " · corrected" : ""}
                  </span>
                </p>
              ))}
              {(published.data ?? []).length === 0 ? <p className="meta">Empty until you publish.</p> : null}
            </div>
            <div className="wire-block">
              <p className="wire-line">
                <b>Beat memory</b> · what we already covered
              </p>
              {(memory.data ?? []).slice(0, 4).map((m) => (
                <p key={m.id} className="wire-row">
                  <b className="mem-e">{m.entity}</b> <span className="meta-inline">{m.last_angle}</span>
                </p>
              ))}
              {/* Every sibling widget explains its empty state; this one rendered
                  a bare heading over nothing (UX-002). */}
              {(memory.data ?? []).length === 0 ? (
                <p className="meta">No beat memory yet — it builds as you publish.</p>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </DeskShell>
  );
}
