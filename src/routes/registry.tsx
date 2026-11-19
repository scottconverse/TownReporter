import { createFileRoute } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import {
  getPublicRegistryOrigin,
  searchPublicRegistryPage,
} from "@/lib/news/registry/registry-public";
import {
  registryCategoryNumber,
  registryPageNumber,
  safeWebUrl,
  registryCorrectionArticle,
  registryCorrectionHref,
  registryServicePath,
} from "@/lib/news/registry/registry-correction";
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

const PAGE_SIZE = 25;

type RegistrySearch = { q?: string; category?: number; language?: string; page?: number };

export const Route = createFileRoute("/registry")({
  validateSearch: (search: Record<string, unknown>): RegistrySearch => {
    const out: RegistrySearch = {};
    const q = typeof search.q === "string" ? search.q.trim().slice(0, 200) : "";
    if (q) out.q = q;
    const category = registryCategoryNumber(search.category);
    if (category) out.category = category;
    const language = typeof search.language === "string" ? search.language.trim().slice(0, 100) : "";
    if (language) out.language = language;
    const page = registryPageNumber(search.page);
    if (page > 1) out.page = page;
    return out;
  },
  loaderDeps: ({ search }) => ({
    q: search.q ?? "",
    category: search.category ?? null,
    language: search.language ?? "",
    page: search.page ?? 1,
  }),
  loader: async ({ deps }) => {
    const [result, origin] = await Promise.all([
      searchPublicRegistryPage({ data: deps }),
      getPublicRegistryOrigin().catch(() => ""),
    ]);
    return { result, origin };
  },
  head: ({ match }) => ({
    meta: [
      { title: `Community resources — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` },
      {
        name: "description",
        content:
          "Search organizations and services in our area, with the source each entry came from and the date an editor last verified it.",
      },
    ],
  }),
  component: RegistryPage,
});

/** A link to the list with these filters; empty filters are left out. */
function listHref(search: RegistrySearch): string {
  const params = new URLSearchParams();
  if (search.q) params.set("q", search.q);
  if (search.category) params.set("category", String(search.category));
  if (search.language) params.set("language", search.language);
  if (search.page && search.page > 1) params.set("page", String(search.page));
  const text = params.toString();
  return text ? `/registry?${text}` : "/registry";
}

function RegistryPage() {
  const { result, origin } = Route.useLoaderData();
  const { q, category, language, page } = Route.useSearch();
  const { formatShortDate } = usePaperDateFormatters();
  const unavailable = result.status === "unavailable";
  const entries = result.status === "ok" ? result.entries : [];
  const categories = result.status === "ok" ? result.categories : [];
  const languages = result.status === "ok" ? result.languages : [];
  const total = result.status === "ok" ? result.total : 0;
  const current = categories.find((c) => c.id === category) ?? null;
  const filtered = Boolean(q || category || language);
  const pageNumber = page ?? 1;
  const hasPrevious = pageNumber > 1;
  const hasNext = pageNumber * PAGE_SIZE < total;
  const languageChoices =
    language && !languages.some((l) => l.toLowerCase() === language.toLowerCase())
      ? [...languages, language]
      : languages;
  const withoutFilters = { q, category, language };

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

        <form
          method="get"
          action="/registry"
          role="search"
          aria-label="Search community resources"
          className="registry-search"
        >
          <div className="correction-field">
            <label htmlFor="registry-q">Search</label>
            <input
              className="field text-base registry-text"
              id="registry-q"
              name="q"
              type="search"
              maxLength={200}
              defaultValue={q ?? ""}
              key={`q-${q ?? ""}`}
            />
          </div>
          <div className="correction-field">
            <label htmlFor="registry-category">Category</label>
            <select
              className="field text-base"
              id="registry-category"
              name="category"
              defaultValue={category ? String(category) : ""}
              key={`c-${category ?? ""}`}
            >
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="correction-field">
            <label htmlFor="registry-language">Language</label>
            <select
              className="field text-base"
              id="registry-language"
              name="language"
              defaultValue={language ?? ""}
              key={`l-${language ?? ""}`}
            >
              <option value="">All languages</option>
              {languageChoices.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <button className="btn text-base registry-text" type="submit">
            Search
          </button>
        </form>

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
              <a href={listHref({ ...withoutFilters, page })}>Try again</a>.
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="empty">
            {total > 0 ? (
              <p>
                There are no services on this page. <a href={listHref(withoutFilters)}>Go to the first page</a>.
              </p>
            ) : null}
            {total === 0 && (q || language) ? (
              <p>
                No services match your search. <a href="/registry">Clear the search</a>.
              </p>
            ) : null}
            {total === 0 && category && !q && !language ? (
              <p>
                No published entries are filed under {current ? current.name : "this category"}{" "}
                yet. <a href="/registry">See all entries</a>.
              </p>
            ) : total === 0 && !filtered ? (
              <p>
                No entries are published yet. TownReporter adds entries after an editor checks
                them.
              </p>
            ) : null}
          </div>
        ) : (
          <section aria-labelledby="registry-entries-title">
            <h2 id="registry-entries-title">
              {current ? current.name : "All entries"} ({total})
            </h2>
            <p role="status">
              {total} {total === 1 ? "service" : "services"}
              {filtered ? (total === 1 ? " matches your search" : " match your search") : ""}
              {total > PAGE_SIZE ? `. Page ${pageNumber}` : ""}
            </p>
            {entries.map((entry) => {
              const heading = `${entry.organizationName} — ${entry.serviceName}`;
              return (
                <article className="correction-entry" key={entry.serviceId}>
                  <h3>
                    <a className="textlink registry-text" href={registryServicePath(entry.serviceId)}>
                      {heading}
                    </a>
                  </h3>
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
                      {safeWebUrl(entry.sourceUrl) ? (
                        <a className="textlink break-words" href={entry.sourceUrl} rel="noreferrer">
                          {entry.sourceTitle || entry.sourceUrl}
                        </a>
                      ) : (
                        <span className="break-words">{entry.sourceTitle || entry.sourceUrl}</span>
                      )}
                    </p>
                  ) : null}
                  <p>
                    <a
                      className="textlink registry-text"
                      href={registryCorrectionHref(
                        registryCorrectionArticle({
                          id: entry.serviceId,
                          organizationName: entry.organizationName,
                          serviceName: entry.serviceName,
                          url: `${origin}${registryServicePath(entry.serviceId)}`,
                        }),
                      )}
                    >
                      Something wrong here?
                    </a>
                  </p>
                </article>
              );
            })}
            {hasPrevious || hasNext ? (
              <nav aria-label="More results" className="registry-paging">
                {hasPrevious ? (
                  <a
                    className="textlink text-base"
                    rel="prev"
                    href={listHref({ ...withoutFilters, page: pageNumber - 1 })}
                  >
                    Previous page
                  </a>
                ) : null}{" "}
                {hasNext ? (
                  <a
                    className="textlink text-base"
                    rel="next"
                    href={listHref({ ...withoutFilters, page: pageNumber + 1 })}
                  >
                    Next page
                  </a>
                ) : null}
              </nav>
            ) : null}
          </section>
        )}
      </div>
    </PaperShell>
  );
}
