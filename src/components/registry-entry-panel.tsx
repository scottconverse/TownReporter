import { useQuery } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import { EntryFacts } from "@/components/registry-entry-card";
import { NOT_LISTED } from "@/lib/news/registry/registry-entry-copy";
import { readRegistryEntryPanel } from "@/lib/news/registry/registry-desk";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import type { DeskEntryPanelView } from "@/lib/news/registry/registry-desk";

/**
 * One entry's own page (Scott, Nov 20 2026).
 *
 * Every list on the desk links here: all the entry's fields, the places, hours,
 * contacts and rules it holds, the pages it came from, and its history -- when
 * it was added, published, taken down, rechecked by the robot and changed by
 * the scan. Read-only, so an editor can look at one entry without opening a
 * form; Edit is one press away in the list that linked here.
 */

type EntryRow = DeskEntryPanelView["detail"]["places"][number];

function value(row: EntryRow, key: string): string {
  const found = row.fields[key];
  return typeof found === "string" ? found : found === true ? "Yes" : "";
}

/** One row of a read-only list, or the words that nothing is recorded. */
function Rows({
  rows,
  line,
  empty,
}: {
  rows: readonly EntryRow[];
  line: (row: EntryRow) => string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="registry-panel-text">{empty}</p>;
  return (
    <ul className="registry-fact-list">
      {rows.map((row) => (
        <li key={row.id}>{line(row) || NOT_LISTED}</li>
      ))}
    </ul>
  );
}

/** The history's plain words for each stored action. */
const HISTORY_WORDS: Record<string, string> = {
  "registry.service.publish": "Published",
  "registry.service.autopublish": "Auto-published by the scan",
  "registry.service.withdraw": "Taken down",
  "registry.service.verify": "Checked by an editor",
  "registry.service.recheck": "Rechecked by the robot",
  "registry.service.source_gone": "Source page found gone",
  "registry.change.autopublish": "Change auto-published",
  "registry.change.accept": "Change accepted",
  "registry.change.reject": "Change rejected",
  accepted: "Change accepted",
  rejected: "Change rejected",
  pending: "Change waiting for an editor",
  "needs-editor": "Change needs the editor",
};

export function RegistryEntryPanel({
  serviceId,
  onClose,
  onEdit,
}: {
  serviceId: number;
  onClose: () => void;
  onEdit?: (serviceId: number) => void;
}) {
  const { formatListDateTime } = usePaperDateFormatters();
  const query = useQuery({
    queryKey: ["registry-entry-panel", serviceId],
    queryFn: () => readRegistryEntryPanel({ data: { serviceId } }),
  });
  const panel = query.data;
  const when = (value: string | Date | null | undefined) =>
    value ? formatListDateTime(value) : "date not recorded";

  return (
    <section
      className="registry-entry-panel"
      aria-label="One registry entry"
      data-testid="registry-entry-panel"
    >
      <div className="registry-card-head">
        <h3 className="font-display text-2xl">
          {panel ? `${panel.entry.organizationName} — ${panel.entry.serviceName}` : "One entry"}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {onEdit ? (
            <InkButton tone="ghost" onClick={() => onEdit(serviceId)}>
              Edit this entry
            </InkButton>
          ) : null}
          <InkButton tone="ghost" onClick={onClose}>
            Close
          </InkButton>
        </div>
      </div>

      {query.isError ? (
        <p className="text-base text-rust" role="alert">
          {query.error instanceof Error ? query.error.message : "This entry could not be loaded."}
        </p>
      ) : !panel ? (
        <p className="text-base" role="status">
          Loading this entry…
        </p>
      ) : (
        <>
          <p className="astra-row-meta">
            {panel.entry.published ? "Published." : "Not published."}
            {" · Added "}
            {when(panel.entry.createdAt)}
            {" · Last changed "}
            {when(panel.entry.updatedAt)}
            {panel.entry.robotCheckedAt
              ? ` · Rechecked by the robot ${when(panel.entry.robotCheckedAt)}`
              : " · Not rechecked by the robot yet"}
          </p>

          <h4 className="font-display text-xl">What the registry says</h4>
          <EntryFacts entry={panel.entry} formatDate={formatListDateTime} />

          <h4 className="font-display text-xl">Places</h4>
          <Rows
            rows={panel.detail.places}
            empty="No place is recorded for this entry."
            line={(row) =>
              [
                value(row, "name"),
                [value(row, "address1"), value(row, "address2")].filter(Boolean).join(", "),
                [value(row, "city"), value(row, "stateProvince"), value(row, "postalCode")]
                  .filter(Boolean)
                  .join(" "),
              ]
                .filter(Boolean)
                .join(", ")
            }
          />

          <h4 className="font-display text-xl">Hours</h4>
          <Rows
            rows={panel.detail.schedules}
            empty="No hours are recorded for this entry."
            line={(row) => {
              if (row.fields.byAppointment === true) {
                return [value(row, "days"), "By appointment", value(row, "notes")]
                  .filter(Boolean)
                  .join(" · ");
              }
              const times = [value(row, "opensAt"), value(row, "closesAt")]
                .filter(Boolean)
                .join(" to ");
              return [value(row, "days"), times].filter(Boolean).join(": ");
            }}
          />

          <h4 className="font-display text-xl">Contacts</h4>
          {panel.detail.contacts.length === 0 ? (
            <p className="registry-panel-text">No contact is recorded for this entry.</p>
          ) : (
            <ul className="registry-fact-list">
              {panel.detail.contacts.map((contact) => (
                <li key={contact.id}>
                  {[
                    contact.name,
                    contact.role,
                    contact.phone,
                    contact.email,
                    contact.website,
                  ]
                    .filter((part) => part.trim() !== "")
                    .join(" · ") || NOT_LISTED}
                </li>
              ))}
            </ul>
          )}

          <h4 className="font-display text-xl">Who can use it</h4>
          <Rows
            rows={panel.detail.eligibilities}
            empty="No eligibility rule is recorded for this entry."
            line={(row) => value(row, "description")}
          />

          <h4 className="font-display text-xl">Required documents</h4>
          <Rows
            rows={panel.detail.requiredDocuments}
            empty="No required document is recorded for this entry."
            line={(row) => value(row, "document")}
          />

          <h4 className="font-display text-xl">Languages</h4>
          <Rows
            rows={panel.detail.languages}
            empty="No language is recorded for this entry."
            line={(row) => value(row, "language")}
          />

          <h4 className="font-display text-xl">Accessibility</h4>
          <Rows
            rows={panel.detail.accessibilities}
            empty="No accessibility note is recorded for this entry."
            line={(row) => value(row, "accessibility")}
          />

          <h4 className="font-display text-xl">Sources</h4>
          {panel.sources.length === 0 ? (
            <p className="registry-panel-text">No source page is recorded for this entry.</p>
          ) : (
            <ul className="registry-fact-list">
              {panel.sources.map((source) => (
                <li key={`${source.id}-${source.registryRole ?? ""}`}>
                  <a className="inline-link" href={source.url} target="_blank" rel="noreferrer">
                    {source.title || source.url} ↗
                  </a>
                  {source.registryRole ? ` · ${source.registryRole} feed` : ""}
                  {source.capturedAt ? ` · captured ${when(source.capturedAt)}` : ""}
                  {source.lastError ? ` · last error: ${source.lastError}` : ""}
                </li>
              ))}
            </ul>
          )}

          <h4 className="font-display text-xl">History</h4>
          <ul className="registry-fact-list" data-testid="registry-entry-history">
            <li>Added to the registry {when(panel.entry.createdAt)}.</li>
            {panel.history.length === 0 ? (
              <li>Nothing else has happened to this entry yet.</li>
            ) : (
              panel.history.map((row) => (
                <li key={`${row.source}-${row.id}`}>
                  {HISTORY_WORDS[row.action] ?? row.action} {when(row.at)}
                  {row.by ? ` by ${row.by}` : ""}. {row.detail}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </section>
  );
}
