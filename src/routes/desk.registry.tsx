import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell, SecHead } from "@/components/desk-chrome";
import { ScreenError, ListSkeleton } from "@/components/states";
import { listRegistryDesk } from "@/lib/news/registry/registry-desk.server";
import { evidenceTierLabel } from "@/lib/news/desk-copy";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/**
 * The desk's read-only view of what the community resource scan found
 * (spec 24, Phase 1).
 *
 * Spec 24 puts accept / reject / needs-editor / redraft in Phase 2, so this
 * page has no controls that write. It prints one line saying so, rather than
 * leaving an editor to wonder where the buttons went.
 *
 * Three blocks, each with its own honest empty state:
 *   1. the changes the scan detected, filterable by review state;
 *   2. the HSDS imports;
 *   3. the sources carrying a registry role, and whether the desk could read
 *      them last time.
 */

const REVIEW_STATES = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting for an editor" },
  { key: "needs-editor", label: "Needs the editor" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
] as const;

type ReviewStateFilter = (typeof REVIEW_STATES)[number]["key"];

const ENTITY_LABELS: Record<string, string> = {
  organization: "Organization",
  service: "Service",
  location: "Location",
  service_at_location: "Service at a location",
  schedule: "Schedule",
  contact: "Contact",
  eligibility: "Eligibility",
  required_document: "Required document",
  language: "Language",
  accessibility: "Accessibility",
  taxonomy: "Category",
};

const CHANGE_KIND_LABELS: Record<string, string> = {
  field_change: "Field change",
  eligibility_change: "Eligibility change",
  hours_change: "Hours change",
  closure: "Closure",
  move: "Move",
  contact_change: "Contact change",
  funding_change: "Funding change",
  non_informational: "Not a factual change",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  pending: "Waiting for an editor",
  "needs-editor": "Needs the editor",
  accepted: "Accepted",
  rejected: "Rejected",
};

const ROLE_LABELS: Record<string, string> = {
  organization: "Organization feed",
  service: "Service feed",
  location: "Location feed",
  directory: "Directory to import",
};

export const Route = createFileRoute("/desk/registry")({
  validateSearch: (search: Record<string, unknown>): { state?: ReviewStateFilter } => {
    const state = String(search.state ?? "");
    return REVIEW_STATES.some((option) => option.key === state)
      ? { state: state as ReviewStateFilter }
      : {};
  },
  head: () => ({ meta: [{ title: "Registry — TownReporter" }] }),
  component: RegistryDeskPage,
});

function RegistryDeskPage() {
  const search = Route.useSearch();
  const state: ReviewStateFilter = search.state ?? "all";
  const { formatShortDate, formatListDateTime } = usePaperDateFormatters();
  const query = useQuery({ queryKey: ["registry-desk"], queryFn: () => listRegistryDesk() });
  const changes = query.data?.changes ?? [];
  const visible = state === "all" ? changes : changes.filter((c) => c.reviewState === state);

  return (
    <DeskShell
      title="Registry"
      kicker="What the scan found in the community resource directory"
      lede="Every change the scan detected in a registry source, the imports that filled the directory, and the sources it watches."
    >
      <p className="note">
        Review buttons come in a later phase. This page only shows what the scan found.
      </p>

      {query.isError ? (
        <ScreenError
          message={
            query.error instanceof Error ? query.error.message : "Could not load the registry."
          }
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : query.isPending ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          <section className="src-sec">
            <SecHead
              title="Detected changes"
              count={changes.length}
              sub="One row per change the scan proposed. Nothing here has been applied to the directory."
            />
            <div className="astra-toolbar">
              <div className="astra-seg" role="group" aria-label="Filter changes by review state">
                {REVIEW_STATES.map((option) => {
                  const count =
                    option.key === "all"
                      ? changes.length
                      : changes.filter((c) => c.reviewState === option.key).length;
                  return (
                    <a
                      key={option.key}
                      className={"astra-seg-opt" + (state === option.key ? " on" : "")}
                      aria-current={state === option.key ? "page" : undefined}
                      href={option.key === "all" ? "/desk/registry" : `/desk/registry?state=${option.key}`}
                    >
                      {option.label} · {count}
                    </a>
                  );
                })}
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="wire-sum">
                {changes.length === 0
                  ? "The scan has not found a change in a registry source yet."
                  : `No change is ${REVIEW_STATE_LABELS[state]?.toLowerCase() ?? "in this group"}.`}
              </p>
            ) : (
              <ul className="astra-plain registry-changes">
                {visible.map((change) => {
                  const entityLabel = ENTITY_LABELS[change.entityType] ?? change.entityType;
                  const entity =
                    change.entityId === null
                      ? "New entry proposal"
                      : `${entityLabel}${change.entityName ? `: ${change.entityName}` : ""} · #${change.entityId}`;
                  return (
                    <li key={change.id}>
                      <div className="astra-row-t">{entity}</div>
                      <p className="astra-row-meta">
                        {REVIEW_STATE_LABELS[change.reviewState] ?? change.reviewState}
                        {" · "}
                        {CHANGE_KIND_LABELS[change.changeKind] ?? change.changeKind}
                        {" · "}
                        {evidenceTierLabel(change.evidenceTier)}
                      </p>
                      <p className="astra-row-meta">
                        <b>{change.fieldName}</b>
                        {" — before: "}
                        {change.beforeValue ?? "nothing recorded"}
                        {" · after: "}
                        {change.afterValue ?? "nothing recorded"}
                      </p>
                      {change.summary ? <p className="astra-row-meta">{change.summary}</p> : null}
                      <p className="astra-row-meta">
                        Source:{" "}
                        {change.sourceUrl ? (
                          <a
                            className="inline-link"
                            href={change.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {change.sourceTitle || change.sourceUrl} ↗
                          </a>
                        ) : (
                          (change.sourceTitle ?? "not recorded")
                        )}
                        {change.captureDate
                          ? ` · Capture: ${formatListDateTime(change.captureDate)}`
                          : " · No capture date recorded"}
                      </p>
                      <p className="astra-row-meta">
                        Scan run {change.scanRunId ?? "not recorded"} ·{" "}
                        {change.createdAt ? formatListDateTime(change.createdAt) : "date not recorded"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="src-sec">
            <SecHead
              title="Imports"
              count={query.data?.imports.length ?? 0}
              sub="Directories the desk read into the registry. Every imported row starts unpublished."
            />
            {!query.data?.imports.length ? (
              <p className="wire-sum">No directory has been imported yet.</p>
            ) : (
              <ul className="astra-plain">
                {query.data.imports.map((row) => (
                  <li key={row.id}>
                    <div className="astra-row-t">{row.directoryName}</div>
                    <p className="astra-row-meta">
                      {row.importedAt ? formatShortDate(row.importedAt) : "Date not recorded"}
                      {" · "}
                      {row.format.toUpperCase()}
                      {" · "}
                      {row.recordCount} record{row.recordCount === 1 ? "" : "s"}
                      {" · "}
                      {row.conflictCount} conflict{row.conflictCount === 1 ? "" : "s"}
                    </p>
                    {row.sourceUrl ? (
                      <p className="astra-row-meta">
                        <a
                          className="inline-link"
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.sourceUrl} ↗
                        </a>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="src-sec">
            <SecHead
              title="Registry sources"
              count={query.data?.sources.length ?? 0}
              sub="Sources the scan may read for the registry, and what they are to it."
            />
            {!query.data?.sources.length ? (
              <p className="wire-sum">No source carries a registry role yet.</p>
            ) : (
              <ul className="astra-plain">
                {query.data.sources.map((row) => (
                  <li key={row.id}>
                    <div className="astra-row-t">{row.title || row.url}</div>
                    <p className="astra-row-meta">
                      {ROLE_LABELS[row.registryRole] ?? row.registryRole}
                      {row.directoryName ? ` · ${row.directoryName}` : ""}
                      {" · "}
                      <a className="inline-link" href={row.url} target="_blank" rel="noreferrer">
                        {row.url} ↗
                      </a>
                    </p>
                    <p className="astra-row-meta">
                      {row.lastFetchedAt
                        ? `Last fetched ${formatListDateTime(row.lastFetchedAt)}`
                        : "Not fetched yet"}
                      {row.lastError ? ` · Last error: ${row.lastError}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </DeskShell>
  );
}
