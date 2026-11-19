import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { listPublicRegistryPage } from "@/lib/news/registry/registry-public";
import { verifyMethodWords } from "@/lib/news/registry/registry-verify-methods";

/**
 * The public Registry (spec 15.1, 18.2 and 24, Phase 1).
 *
 * Read-only, server-rendered, indexable. Only published rows appear: an
 * imported row starts unpublished and stays out of this page until an editor
 * presses Publish on the desk. The page has three different empty states: the
 * data could not be read, nothing is published, and the chosen category has no
 * entries. It never says "nothing is published" when it could not read.
 *
 * Public copy rule (spec 11, point 6): change detection is not verification.
 * This page says "Verified" with a date and how only when an editor recorded a
 * check. An older date that only a save or publish set reads "Last updated ...
 * Not verified yet." It never says a program is confirmed open.
 */

function categoryFromSearch(search: Record<string, unknown>): number | null {
  const value = Number(search.category);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const Route = createFileRoute("/registry")({
  validateSearch: (search: Record<string, unknown>): { category?: number } => {
    const category = categoryFromSearch(search);
    return category ? { category } : {};
  },
  loaderDeps: ({ search }) => ({ category: search.category ?? null }),
  loader: async ({ deps }) =>
    listPublicRegistryPage({ data: { category: deps.category ?? null } }),
  head: ({ match }) => ({
    meta: [
      { title: `Community resources — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` },
    ],
  }),
  component: RegistryPage,
});

function RegistryPage() {
  const result = Route.useLoaderData();
  const { category } = Route.useSearch();
  const { formatShortDate } = usePaperDateFormatters();
  const unavailable = result.status === "unavailable";
  const entries = result.status === "ok" ? result.entries : [];
  const categories = result.status === "ok" ? result.categories : [];
  const anyPublished = result.status === "ok" ? result.anyPublished : false;
  const current = categories.find((c) => c.id === category) ?? null;

  return (
    <PaperShell compact>
      <div className="infopage standing-page registry-page">
        <div className="pagehead">
          <span className="eyebrow">COMMUNITY RESOURCES</span>
          <h1>Where to get help</h1>
          <p>
            Organizations and services in our area, with the source each entry came from and the
            date an editor last verified it.
          </p>
        </div>

        {categories.length ? (
          <nav aria-label="Browse resources by category">
            <ul className="needlist">
              <li>
                <a href="/registry" aria-current={!category ? "page" : undefined}>
                  All entries
                </a>
              </li>
              {categories.map((item) => (
                <li key={item.id}>
                  <a
                    href={`/registry?category=${item.id}`}
                    aria-current={category === item.id ? "page" : undefined}
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {unavailable ? (
          <div className="empty" role="alert">
            <p>
              The list of community resources could not be loaded just now. Nothing was lost; the
              page could not read it.{" "}
              <a href={category ? `/registry?category=${category}` : "/registry"}>Try again</a>.
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty">
            {category && anyPublished ? (
              <p>
                No published entries are filed under {current ? current.name : "this category"}{" "}
                yet. <a href="/registry">See all entries</a>.
              </p>
            ) : (
              <p>
                No entries are published yet. TownReporter adds entries after an editor checks
                them.
              </p>
            )}
          </div>
        ) : (
          <section aria-labelledby="registry-entries-title">
            <h2 id="registry-entries-title">
              {current ? current.name : "All entries"} ({entries.length})
            </h2>
            {entries.map((entry) => {
              const heading = `${entry.organizationName} — ${entry.serviceName}`;
              return (
                <article className="correction-entry" key={entry.serviceId}>
                  <h3>{heading}</h3>
                  {entry.description ? <p>{entry.description}</p> : null}
                  {entry.locations.map((location) => (
                    <section key={location.locationId} aria-label="Location">
                      <p>
                        <b>{location.name ?? "Location"}</b>
                      </p>
                      <ul className="needlist">
                        {location.address ? <li>{location.address}</li> : null}
                        {location.phones.map((phone) => (
                          <li key={phone}>Phone at this location: {phone}</li>
                        ))}
                        {location.hours.map((hours) => (
                          <li key={hours}>Hours at this location: {hours}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <section aria-label="About this service">
                    <p>
                      <b>About this service</b>
                    </p>
                    <ul className="needlist">
                      {entry.servicePhones.map((phone) => (
                        <li key={`service-${phone}`}>Phone for this service: {phone}</li>
                      ))}
                      {entry.serviceHours.map((hours) => (
                        <li key={`service-${hours}`}>Hours for this service: {hours}</li>
                      ))}
                      {entry.organizationPhones.map((phone) => (
                        <li key={`org-${phone}`}>
                          Main phone of {entry.organizationName}: {phone}
                        </li>
                      ))}
                      {entry.languages.length ? (
                        <li>Languages: {entry.languages.join(", ")}</li>
                      ) : null}
                      {entry.categoryName ? <li>Category: {entry.categoryName}</li> : null}
                      <li>
                        {entry.verifiedAt
                          ? `Verified ${formatShortDate(entry.verifiedAt)}${
                              verifyMethodWords(entry.verifiedMethod)
                                ? ` (${verifyMethodWords(entry.verifiedMethod)})`
                                : ""
                            }`
                          : entry.lastVerifiedAt
                            ? `Last updated ${formatShortDate(entry.lastVerifiedAt)}. Not verified yet.`
                            : "Not verified yet"}
                      </li>
                    </ul>
                  </section>
                  {entry.editorNote ? (
                    <p>
                      <b>Editor's note:</b> {entry.editorNote}
                    </p>
                  ) : null}
                  {entry.sourceUrl ? (
                    <p>
                      Source:{" "}
                      <a className="textlink break-words" href={entry.sourceUrl} rel="noreferrer">
                        {entry.sourceTitle || entry.sourceUrl}
                      </a>
                    </p>
                  ) : null}
                  <p>
                    <a
                      className="textlink"
                      href={`/corrections?article=${encodeURIComponent(heading)}`}
                    >
                      Something wrong here?
                    </a>
                  </p>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </PaperShell>
  );
}
