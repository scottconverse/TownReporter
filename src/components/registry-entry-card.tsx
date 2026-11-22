import type { ReactNode } from "react";
import type { DeskEntryFacts } from "@/lib/news/registry/registry-desk";
import { mapsUrl, NOT_LISTED, NOT_RECORDED } from "@/lib/news/registry/registry-entry-copy";

/**
 * One registry entry, drawn for a person (Scott, Nov 20 2026).
 *
 * Scott's complaint was that an entry card named the site and showed nothing
 * else. So this draws the whole entry: the organization, the service, its
 * category, description, every phone, the address (with a map link), hours, a
 * clickable web address, who can use it, fees, languages and the source page
 * with the date it was captured. A field the source did not state says "Not
 * listed on the source page." rather than leaving a blank line.
 *
 * The same block is used by the entry's own page, so the card and the page
 * cannot disagree about what an entry says.
 */

function WebLink({ href }: { href: string }) {
  return (
    <a className="inline-link" href={href} target="_blank" rel="noreferrer">
      {href} ↗
    </a>
  );
}

/**
 * Every field of an entry, in the order a person asks about them. `formatDate`
 * is passed in so the page's own date wording is used everywhere.
 *
 * The facts an entry has come first. The ones it does not have share one line
 * at the end, so an editor can see the gaps without reading a column of
 * repeated "Not listed" rows. `compact` leaves out the three facts a card
 * already shows in its heading.
 */
export function EntryFacts({
  entry,
  formatDate,
  compact = false,
}: {
  entry: DeskEntryFacts;
  formatDate: (when: string | Date | null | undefined) => string;
  compact?: boolean;
}) {
  // With no source page there is nothing to be missing from: every empty
  // field says it was not recorded, not that a page failed to list it.
  const missing = entry.sourceUrl ? NOT_LISTED : NOT_RECORDED;
  const text = (value: string | null | undefined) =>
    value && value.trim() !== "" ? value : null;
  const facts: Array<[label: string, value: ReactNode]> = [
    ...(compact
      ? []
      : ([
          ["Organization", text(entry.organizationName)],
          ["Service", text(entry.serviceName)],
          ["Category", text(entry.categoryName)],
        ] as Array<[string, ReactNode]>)),
    ["What it offers", text(entry.description)],
    ["Phone", entry.phones.length ? entry.phones.join(", ") : null],
    [
      "Address",
      entry.address ? (
        <a className="inline-link" href={mapsUrl(entry.address)} target="_blank" rel="noreferrer">
          {entry.address} (map) ↗
        </a>
      ) : null,
    ],
    [
      "Hours",
      entry.hours.length ? (
        <ul className="registry-fact-list">
          {entry.hours.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null,
    ],
    ["Website", entry.website ? <WebLink href={entry.website} /> : null],
    ["Who can use it", text(entry.eligibility)],
    ["Fees", text(entry.fees)],
    ["How to apply", text(entry.applicationProcess)],
    ["Languages", entry.languages.length ? entry.languages.join(", ") : null],
    [
      "Source page",
      entry.sourceUrl ? (
        <>
          <a className="inline-link" href={entry.sourceUrl} target="_blank" rel="noreferrer">
            {entry.sourceTitle || entry.sourceUrl} ↗
          </a>
          {entry.sourceCapturedAt
            ? ` · captured ${formatDate(entry.sourceCapturedAt)}`
            : " · capture date not recorded"}
        </>
      ) : null,
    ],
  ];
  const present = facts.filter(([, value]) => value !== null);
  const absent = facts.filter(([, value]) => value === null).map(([label]) => label);
  return (
    <>
      {present.length ? (
        <dl className="registry-facts">
          {present.map(([label, value]) => (
            <div className="registry-fact" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {absent.length ? (
        <p className="registry-missing">
          <b>{missing}</b> {absent.join(", ")}
        </p>
      ) : null}
    </>
  );
}

/**
 * One entry as a card. `onOpen` is the entry's own page; `children` are the
 * actions the list it sits in offers (Publish, Edit, Take down…).
 */
export function RegistryEntryCard({
  entry,
  formatDate,
  onOpen,
  children,
}: {
  entry: DeskEntryFacts;
  formatDate: (when: string | Date | null | undefined) => string;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  return (
    <article className="registry-card" data-testid="registry-entry-card">
      <div className="registry-card-head">
        <h3 className="astra-row-t">
          {onOpen ? (
            <button type="button" className="inline-link" onClick={onOpen}>
              {entry.organizationName} — {entry.serviceName}
            </button>
          ) : (
            <>
              {entry.organizationName} — {entry.serviceName}
            </>
          )}
        </h3>
        <div className="registry-card-tags">
          <span className="registry-tag">{entry.categoryName || "No category"}</span>
          {entry.crisis ? <span className="registry-tag">Crisis service</span> : null}
          {!entry.published ? <span className="registry-tag">Not published</span> : null}
        </div>
      </div>
      <EntryFacts entry={entry} formatDate={formatDate} compact />
      {children ? <div className="registry-card-actions">{children}</div> : null}
    </article>
  );
}
