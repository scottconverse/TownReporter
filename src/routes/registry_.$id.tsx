import { createFileRoute, notFound } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { PhoneLink } from "@/components/registry-phone";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import {
  getPublicRegistryOrigin,
  getPublicRegistryServicePage,
} from "@/lib/news/registry/registry-public";
import {
  safeWebUrl,
  registryCorrectionArticle,
  registryCorrectionHref,
  registryServicePath,
} from "@/lib/news/registry/registry-correction";
import { verifyMethodWords } from "@/lib/news/registry/registry-verify-methods";

/**
 * One community resource at its own address, `/registry/<service id>`
 * (Phase 4, P4-2 and P4-3).
 *
 * Shows every public field of the service and leaves out an empty one. Only a
 * published, active, not-removed service is listed: an unknown, unpublished or
 * removed id answers the 404 page below. A registry that cannot be read says so
 * with the same words the list page uses, and is never reported as "not listed".
 *
 * Never shown: contact person names, the verification basis, checker names,
 * review notes or audit data. The read does not return them.
 */

export const Route = createFileRoute("/registry_/$id")({
  loader: async ({ params }) => {
    const [result, origin] = await Promise.all([
      getPublicRegistryServicePage({ data: { id: params.id } }),
      getPublicRegistryOrigin().catch(() => ""),
    ]);
    // `notFound()` rather than a 200 panel: a service that is not listed must
    // answer 404 to crawlers and link checkers, the way a missing story does
    // (src/routes/articles.$slug.tsx).
    if (result.status === "ok" && !result.entry) throw notFound();
    return { result, origin };
  },
  notFoundComponent: () => <NotListed />,
  head: ({ loaderData, match }) => {
    const paper = (match.context.paper ?? DEFAULT_PAPER_IDENTITY).name;
    const entry = loaderData?.result.status === "ok" ? loaderData.result.entry : null;
    if (!entry) return { meta: [{ title: `Community resources — ${paper}` }] };
    const description = (
      entry.description ||
      `${entry.serviceName} from ${entry.organizationName}: where it is, when it is open and how to reach it.`
    )
      .replace(/\s+/g, " ")
      .trim();
    return {
      meta: [
        { title: `${entry.organizationName} — ${entry.serviceName} — ${paper}` },
        {
          name: "description",
          content: description.length > 160 ? `${description.slice(0, 157)}...` : description,
        },
      ],
    };
  },
  component: RegistryServicePage,
});

function NotListed() {
  return (
    <PaperShell compact>
      <div className="infopage standing-page registry-page">
        <div className="pagehead">
          <span className="eyebrow">COMMUNITY RESOURCES</span>
          <h1>This service is not listed.</h1>
        </div>
        <div className="empty">
          <p>
            It may have been removed, or the address may be wrong.{" "}
            <a className="textlink" href="/registry">
              Back to community resources
            </a>
            .
          </p>
        </div>
      </div>
    </PaperShell>
  );
}

function titleCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function RegistryServicePage() {
  const { result, origin } = Route.useLoaderData();
  const { formatShortDate } = usePaperDateFormatters();

  if (result.status === "unavailable") {
    return (
      <PaperShell compact>
        <div className="infopage standing-page registry-page">
          <div className="pagehead">
            <span className="eyebrow">COMMUNITY RESOURCES</span>
            <h1>Community resource</h1>
          </div>
          <div className="empty" role="alert">
            <p>
              The list of community resources could not be loaded just now. Nothing was lost; the
              page could not read it. <a href="">Try again</a>.{" "}
              <a href="/registry">Back to community resources</a>.
            </p>
          </div>
        </div>
      </PaperShell>
    );
  }

  const entry = result.entry;
  if (!entry) return <NotListed />;

  /*
    Scott, Nov 20 2026: the page says when the entry was last checked, using
    the newer of the editor's check and the robot's recheck. A robot recheck is
    never called "verified" -- it says which site it was checked against.
  */
  const timeOf = (when: string | Date | null): number =>
    when == null ? 0 : new Date(when).getTime();
  const editorCheckedAt = timeOf(entry.verifiedAt);
  const robotCheckedAt = timeOf(entry.robotCheckedAt);
  const verification =
    robotCheckedAt > 0 && robotCheckedAt >= editorCheckedAt
      ? `Last checked ${formatShortDate(entry.robotCheckedAt)} — checked against ${
          entry.robotCheckedSite ?? "its source page"
        }`
      : entry.verifiedAt
        ? `Verified ${formatShortDate(entry.verifiedAt)}${
            verifyMethodWords(entry.verifiedMethod)
              ? ` (${verifyMethodWords(entry.verifiedMethod)})`
              : ""
          }`
        : entry.lastVerifiedAt
          ? `Last updated ${formatShortDate(entry.lastVerifiedAt)}. Not verified yet.`
          : "Not verified yet";
  const article = registryCorrectionArticle({
    id: entry.serviceId,
    organizationName: entry.organizationName,
    serviceName: entry.serviceName,
    url: `${origin}${registryServicePath(entry.serviceId)}`,
  });
  const heading = `${entry.organizationName} — ${entry.serviceName}`;
  const status = entry.status.trim();
  const hasServiceWide =
    entry.servicePhones.length > 0 ||
    entry.serviceHours.length > 0 ||
    entry.accessibility.length > 0;

  return (
    <PaperShell compact>
      <div className="infopage standing-page registry-page">
        <nav aria-label="Breadcrumb">
          <a className="textlink" href="/registry">
            All community resources
          </a>
        </nav>
        <div className="pagehead">
          <span className="eyebrow">COMMUNITY RESOURCES</span>
          <h1>{heading}</h1>
          {entry.categoryName ? <p>Category: {entry.categoryName}</p> : null}
        </div>

        <article className="correction-entry">
          <section aria-label="About this service">
            <ul className="needlist">
              <li>
                <b>Organization:</b> {entry.organizationName}
              </li>
              <li>
                <b>Service:</b> {entry.serviceName}
              </li>
              {status ? (
                <li>
                  <b>Status:</b> {titleCase(status)}
                </li>
              ) : null}
              {entry.description ? <li>{entry.description}</li> : null}
              {entry.fees ? (
                <li>
                  <b>Fees:</b> {entry.fees}
                </li>
              ) : null}
              {entry.applicationProcess ? (
                <li>
                  <b>How to apply:</b> {entry.applicationProcess}
                </li>
              ) : null}
              {entry.serviceUrl ? (
                <li>
                  <b>Website:</b>{" "}
                  {safeWebUrl(entry.serviceUrl) ? (
                    <a className="textlink break-words" href={entry.serviceUrl} rel="noreferrer">
                      {entry.serviceUrl}
                    </a>
                  ) : (
                    <span className="break-words">{entry.serviceUrl}</span>
                  )}
                </li>
              ) : null}
              {entry.serviceEmails.map((email) => (
                <li key={`email-${email}`}>
                  <b>Email:</b>{" "}
                  <a className="textlink break-words" href={`mailto:${email}`}>
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {entry.eligibility.length ? (
            <section aria-labelledby="registry-eligibility">
              <h2 id="registry-eligibility">Who can use it</h2>
              <ul className="needlist">
                {entry.eligibility.map((text, index) => (
                  <li key={`${index}-${text}`}>{text}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.requiredDocuments.length ? (
            <section aria-labelledby="registry-documents">
              <h2 id="registry-documents">What to bring</h2>
              <ul className="needlist">
                {entry.requiredDocuments.map((doc, index) => (
                  <li key={`${index}-${doc.document}`}>
                    {doc.document}
                    {doc.required ? " (required)" : " (if you have it)"}
                    {doc.description ? `: ${doc.description}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.languages.length ? (
            <section aria-labelledby="registry-languages">
              <h2 id="registry-languages">Languages</h2>
              <p>Languages: {entry.languages.join(", ")}</p>
            </section>
          ) : null}

          {entry.locations.length ? (
            <section aria-labelledby="registry-places">
              <h2 id="registry-places">Places</h2>
              {entry.locations.map((location) => (
                <section key={location.locationId} aria-label="Location">
                  <h3>{location.name ?? "Location"}</h3>
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
                    {location.accessibility.map((text) => (
                      <li key={`acc-${text}`}>Accessibility at this location: {text}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ) : null}

          {hasServiceWide ? (
            <section aria-labelledby="registry-service-wide">
              <h2 id="registry-service-wide">For the whole service</h2>
              <ul className="needlist">
                {entry.servicePhones.map((phone) => (
                  <li key={`service-${phone}`}>
                    Phone for this service: <PhoneLink phone={phone} />
                  </li>
                ))}
                {entry.serviceHours.map((hours) => (
                  <li key={`service-${hours}`}>Hours for this service: {hours}</li>
                ))}
                {entry.accessibility.map((text) => (
                  <li key={`service-acc-${text}`}>Accessibility of this service: {text}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.organizationPhones.length ? (
            <section aria-labelledby="registry-organization">
              <h2 id="registry-organization">{entry.organizationName}</h2>
              <ul className="needlist">
                {entry.organizationPhones.map((phone) => (
                  <li key={`org-${phone}`}>
                    Main phone of {entry.organizationName}: <PhoneLink phone={phone} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.sources.length ? (
            <section aria-labelledby="registry-sources">
              <h2 id="registry-sources">Sources</h2>
              <ul className="needlist">
                {entry.sources.map((source) => (
                  <li key={`${source.appliesTo}-${source.url}`}>
                    {source.appliesTo === "organization" ? "Source for the organization" : "Source"}
                    :{" "}
                    {safeWebUrl(source.url) ? (
                      <a className="textlink break-words" href={source.url} rel="noreferrer">
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span className="break-words">{source.title || source.url}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p>{verification}</p>
          {entry.editorNote ? (
            <p>
              <b>Editor's note:</b> {entry.editorNote}
            </p>
          ) : null}

          <section aria-labelledby="registry-correction">
            <h2 id="registry-correction">Correct this entry</h2>
            <p>
              <a className="textlink registry-text" href={registryCorrectionHref(article)}>
                Something wrong here?
              </a>
            </p>
            <p>
              The link opens a correction form that is filled in with this service. Sending it
              opens an email in your own email program, addressed to the editor, for you to read
              and send.
            </p>
          </section>
        </article>
      </div>
    </PaperShell>
  );
}
