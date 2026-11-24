import { useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { CrisisLine, PhoneLink } from "@/components/registry-phone";
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
import { registryEntryHeading } from "@/lib/news/registry/registry-entry-copy";
import {
  registryCardFacts,
  registryCategoryHue,
  registryDirectionsHref,
} from "@/lib/news/registry/registry-card";
import { telHref } from "@/lib/news/registry/registry-phone";

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

/** "Helping Hands" and " helping hands " are one name, said once. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A plain left click moves inside the page; a click with a modifier key still opens a new tab. */
function softNav(e: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}

/**
 * True while the reader is typing in the search box. The page can be drawn
 * again when a search lands; this lives outside the component so the box can
 * get the cursor back at the end of what the reader typed.
 */
let readerIsTyping = false;

function RegistryPage() {
  const { result, origin } = Route.useLoaderData();
  const { q, category, language, page } = Route.useSearch();
  const { formatShortDate } = usePaperDateFormatters();
  const navigate = useNavigate();
  // True while the next search is being read. The page then shows the searching
  // animation instead of a stale list.
  const searching = useRouterState({ select: (s) => s.isLoading });
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // When the address changes and the reader is not typing, the box follows it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (readerIsTyping) {
      if (document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      return;
    }
    if (document.activeElement !== el) el.value = q ?? "";
  }, [q, searching]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const go = (next: RegistrySearch) => {
    void navigate({ to: "/registry", search: next });
  };
  const readForm = (form: HTMLFormElement): RegistrySearch => {
    const data = new FormData(form);
    const text = (name: string) => (typeof data.get(name) === "string" ? String(data.get(name)).trim() : "");
    const next: RegistrySearch = {};
    if (text("q")) next.q = text("q").slice(0, 200);
    const cat = registryCategoryNumber(text("category"));
    if (cat) next.category = cat;
    if (text("language")) next.language = text("language").slice(0, 100);
    return next;
  };

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

        <p className="rg-urgent">
          <b>Need help right now?</b>
          <a href="tel:911">
            <b>911</b> emergency
          </a>
          <a href="tel:988">
            <b>988</b> mental health crisis
          </a>
          <a href="tel:211">
            <b>2-1-1</b> any other help
          </a>
        </p>

        <form
          method="get"
          action="/registry"
          role="search"
          aria-label="Search community resources"
          className="registry-search"
          data-searching={searching ? "true" : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            go(readForm(e.currentTarget));
          }}
        >
          <div className="correction-field">
            <label htmlFor="registry-q">Search</label>
            <input
              className="field text-base registry-text"
              id="registry-q"
              name="q"
              type="search"
              maxLength={200}
              placeholder="Try food, rent help, dental, or a phone number"
              autoComplete="off"
              ref={inputRef}
              defaultValue={q ?? ""}
              onFocus={() => {
                readerIsTyping = true;
              }}
              onBlur={() => {
                // A short delay: the box can lose focus for a moment while the page redraws.
                setTimeout(() => {
                  if (document.activeElement !== inputRef.current) readerIsTyping = false;
                }, 800);
              }}
              onInput={(e) => {
                const form = e.currentTarget.form;
                if (!form) return;
                if (timer.current) clearTimeout(timer.current);
                // Search as the reader types, after a short pause.
                timer.current = setTimeout(() => go(readForm(form)), 350);
              }}
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
              onChange={(e) => e.currentTarget.form && go(readForm(e.currentTarget.form))}
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
              onChange={(e) => e.currentTarget.form && go(readForm(e.currentTarget.form))}
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
          <span className="rg-scan" aria-hidden="true" />
        </form>

        {categories.length ? (
          <nav aria-label="Browse resources by category" className="rg-chips">
            <ul className="needlist">
              <li>
                <a
                  href="/registry"
                  aria-current={!category ? "page" : undefined}
                  onClick={(e) => softNav(e, () => go({ q, language }))}
                >
                  All entries
                </a>
              </li>
              {categories.map((item) => (
                <li key={item.id} style={{ "--hue": registryCategoryHue(item.name) } as CSSProperties}>
                  <a
                    href={`/registry?category=${item.id}`}
                    aria-current={category === item.id ? "page" : undefined}
                    onClick={(e) => softNav(e, () => go({ q, language, category: item.id }))}
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
        ) : searching ? (
          <section aria-busy="true" aria-label="Searching">
            <p role="status" className="rg-searching">
              Searching the services…
            </p>
            <div className="rg-grid" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <div className="rg-skel" key={n}>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          </section>
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
            {/*
              A reader who finds nothing here still needs somewhere to turn.
              The two numbers the paper promises (spec 15.1) are always shown
              on an empty result, with real tel: links (F19).
            */}
            <CrisisLine />
          </div>
        ) : (
          <section aria-labelledby="registry-entries-title">
            <h2 id="registry-entries-title">
              {current ? current.name : "All entries"} ({total})
            </h2>
            <p role="status" className="rg-count">
              {total} {total === 1 ? "service" : "services"}
              {filtered ? (total === 1 ? " matches your search" : " match your search") : ""}
              {total > PAGE_SIZE ? `. Page ${pageNumber}` : ""}
            </p>
            <div className="rg-grid">
              {entries.map((entry, index) => {
                const heading = registryEntryHeading(entry.organizationName, entry.serviceName);
                const showOrg =
                  entry.serviceName.trim() !== "" &&
                  entry.organizationName.trim() !== "" &&
                  !sameName(entry.organizationName, entry.serviceName);
                const title = showOrg ? entry.serviceName : heading;
                const facts = registryCardFacts(entry);
                const call = telHref(facts.phone);
                const directions = registryDirectionsHref(facts.address);
                return (
                  <article
                    className="correction-entry rg-card"
                    key={entry.serviceId}
                    style={
                      {
                        "--hue": registryCategoryHue(entry.categoryName),
                        "--i": Math.min(index, 24),
                      } as CSSProperties
                    }
                  >
                    {entry.categoryName ? <p className="rg-cat">{entry.categoryName}</p> : null}
                    <h3>
                      <a className="textlink registry-text" href={registryServicePath(entry.serviceId)}>
                        {title}
                      </a>
                    </h3>
                    {showOrg ? <p className="rg-org">{entry.organizationName}</p> : null}
                    {entry.description ? <p className="rg-desc">{entry.description}</p> : null}
                    {facts.phone || facts.address || facts.hours ? (
                      <ul className="rg-facts">
                        {facts.phone ? <li className="rg-phone">{facts.phone}</li> : null}
                        {facts.address ? <li className="rg-addr">{facts.address}</li> : null}
                        {facts.hours ? <li className="rg-hours">{facts.hours}</li> : null}
                      </ul>
                    ) : null}
                    {call || directions ? (
                      <div className="rg-actions">
                        {call ? (
                          <a className="btn rg-call" href={call}>
                            Call
                          </a>
                        ) : null}
                        {directions ? (
                          <a className="btn" href={directions} target="_blank" rel="noreferrer">
                            Directions
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                    <details className="rg-more">
                      <summary>All details, source and corrections</summary>
                      {entry.locations.map((location) => (
                        <section key={location.locationId} aria-label="Location">
                          <p>
                            <b>{location.name ?? "Location"}</b>
                          </p>
                          <ul className="needlist">
                            {location.address ? <li>{location.address}</li> : null}
                            {location.phones.map((phone) => (
                              <li key={phone}>
                                Phone at this location: <PhoneLink phone={phone} />
                              </li>
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
                            <li key={`service-${phone}`}>
                              Phone for this service: <PhoneLink phone={phone} />
                            </li>
                          ))}
                          {entry.serviceHours.map((hours) => (
                            <li key={`service-${hours}`}>Hours for this service: {hours}</li>
                          ))}
                          {entry.organizationPhones.map((phone) => (
                            <li key={`org-${phone}`}>
                              Main phone of {entry.organizationName}: <PhoneLink phone={phone} />
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
                    </details>
                  </article>
                );
              })}
            </div>
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
