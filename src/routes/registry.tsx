import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { listPublicRegistryPage } from "@/lib/news/registry/registry-public";

/**
 * The public Registry (spec 15.1, 18.2 and 24, Phase 1).
 *
 * Read-only, server-rendered, indexable. Only published rows appear: an
 * imported row starts unpublished and stays out of this page until an editor
 * confirms it, and Phase 1 has no confirm button, so today the list is empty
 * and the page says so.
 *
 * Public copy rule (spec 11, point 6): change detection is not verification.
 * This page says "Last verified" and a date. It never says a phone was called,
 * and it never says a program is confirmed open.
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
  const { entries, categories } = Route.useLoaderData();
  const { category } = Route.useSearch();
  const { formatShortDate } = usePaperDateFormatters();
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

        {entries.length === 0 ? (
          <div className="empty">
            {category && current ? (
              <p>
                No published entries are filed under {current.name} yet.{" "}
                <a href="/registry">See all entries</a>.
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
                  <ul className="needlist">
                    {entry.address ? <li>{entry.address}</li> : null}
                    {entry.phone ? <li>Phone: {entry.phone}</li> : null}
                    {entry.hours ? <li>Hours: {entry.hours}</li> : null}
                    {entry.languages.length ? (
                      <li>Languages: {entry.languages.join(", ")}</li>
                    ) : null}
                    {entry.categoryName ? <li>Category: {entry.categoryName}</li> : null}
                    <li>
                      Last verified:{" "}
                      {entry.lastVerifiedAt ? formatShortDate(entry.lastVerifiedAt) : "Not verified yet"}
                    </li>
                  </ul>
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
