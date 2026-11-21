import type { ReactNode } from "react";
import type { DeskEntryFacts } from "@/lib/news/registry/registry-desk";
import { mapsUrl, NOT_LISTED, NO_SOURCE } from "@/lib/news/registry/registry-entry-copy";

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

function orNotListed(value: string | null | undefined): ReactNode {
  return value && value.trim() !== "" ? value : NOT_LISTED;
}

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
 */
export function EntryFacts({
  entry,
  formatDate,
}: {
  entry: DeskEntryFacts;
  formatDate: (when: string | Date | null | undefined) => string;
}) {
  return (
    <dl className="registry-facts">
      <dt>Organization</dt>
      <dd>{orNotListed(entry.organizationName)}</dd>
      <dt>Service</dt>
      <dd>{orNotListed(entry.serviceName)}</dd>
      <dt>Category</dt>
      <dd>{orNotListed(entry.categoryName)}</dd>
      <dt>What it offers</dt>
      <dd>{orNotListed(entry.description)}</dd>
      <dt>Phone</dt>
      <dd>
        {entry.phones.length === 0 ? (
          NOT_LISTED
        ) : (
          <>
            {entry.phones.map((phone, index) => (
              <span key={phone}>
                {index > 0 ? ", " : ""}
                {phone}
              </span>
            ))}
          </>
        )}
      </dd>
      <dt>Address</dt>
      <dd>
        {entry.address ? (
          <a
            className="inline-link"
            href={mapsUrl(entry.address)}
            target="_blank"
            rel="noreferrer"
          >
            {entry.address} (map) ↗
          </a>
        ) : (
          NOT_LISTED
        )}
      </dd>
      <dt>Hours</dt>
      <dd>
        {entry.hours.length === 0 ? (
          NOT_LISTED
        ) : (
          <ul className="registry-fact-list">
            {entry.hours.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </dd>
      <dt>Website</dt>
      <dd>{entry.website ? <WebLink href={entry.website} /> : NOT_LISTED}</dd>
      <dt>Who can use it</dt>
      <dd>{orNotListed(entry.eligibility)}</dd>
      <dt>Fees</dt>
      <dd>{orNotListed(entry.fees)}</dd>
      <dt>How to apply</dt>
      <dd>{orNotListed(entry.applicationProcess)}</dd>
      <dt>Languages</dt>
      <dd>{entry.languages.length === 0 ? NOT_LISTED : entry.languages.join(", ")}</dd>
      <dt>Source page</dt>
      <dd>
        {entry.sourceUrl ? (
          <>
            <a
              className="inline-link"
              href={entry.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {entry.sourceTitle || entry.sourceUrl} ↗
            </a>
            {entry.sourceCapturedAt
              ? ` · captured ${formatDate(entry.sourceCapturedAt)}`
              : " · capture date not recorded"}
          </>
        ) : (
          NO_SOURCE
        )}
      </dd>
    </dl>
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
        {entry.crisis ? <span className="registry-tag">Crisis service</span> : null}
        {!entry.published ? <span className="registry-tag">Not published</span> : null}
      </div>
      <EntryFacts entry={entry} formatDate={formatDate} />
      {children ? <div className="registry-card-actions">{children}</div> : null}
    </article>
  );
}
