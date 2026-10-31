import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome-utils";
import { getPublicEvidence } from "@/lib/news/evidence";
import { parseVersionId } from "@/lib/news/request-input";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

export const Route = createFileRoute("/evidence/$versionId")({
  loader: ({ params }) => {
    /*
      A wrong address is a 404, not a 500. `Number("not-a-number")` is `NaN`,
      which the server function's `rowId` validator rejected by throwing, so a
      mistyped citation link answered as a server fault. `notFound()` gives the
      same answer this app gives any missing page (see `articles.$slug.tsx`).
      A real id with no visible capture still keeps the page's own "not in this
      edition" panel below, which is a true statement about a valid id.
    */
    const versionId = parseVersionId(params.versionId);
    if (versionId === null) throw notFound();
    return getPublicEvidence({ data: versionId });
  },
  notFoundComponent: () => (
    <PaperShell compact>
      <EmptyState
        kicker="Evidence"
        title="That capture is not in this edition"
        body="The address is not a capture TownReporter has a record of."
        action={
          <Link to="/" className={inkGhost}>
            Back to the paper
          </Link>
        }
      />
    </PaperShell>
  ),
  component: EvidencePage,
});

/** The host a reader would be reading if they followed the link out. */
function originalHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

function observationLabel(kind: string, disappeared: boolean): string {
  if (disappeared || kind === "unavailable") return "Source unavailable at this check";
  if (kind === "changed") return "Changed";
  if (kind === "reverted") return "Reverted to an earlier content version";
  if (kind === "restored") return "Restored";
  if (kind === "unchanged") return "Observed again, same content";
  return "Captured";
}

function EvidencePage() {
  const { formatDateTime } = usePaperDateFormatters();
  const { versionId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const { data, isPending } = useQuery({
    queryKey: ["evidence", versionId],
    queryFn: () => getPublicEvidence({ data: Number(versionId) }),
    initialData: loaded === undefined ? undefined : loaded,
  });
  const record = data !== undefined ? data : loaded;

  if (isPending && record === undefined) {
    return (
      <PaperShell compact>
        <StorySkeleton />
      </PaperShell>
    );
  }
  if (!record) {
    return (
      <PaperShell compact>
        <EmptyState
          kicker="Evidence"
          title="That capture is not in this edition"
          body="TownReporter only shows captured records that support a published story."
          action={
            <Link to="/" className={inkGhost}>
              Back to the paper
            </Link>
          }
        />
      </PaperShell>
    );
  }

  return (
    <PaperShell compact>
      <div className="evidence-page">
        <div className="pagehead evidencehead">
          <span className="eyebrow">Captured record</span>
          <h1>{record.title || record.url}</h1>
          <p>
            {record.disappeared
              ? "Original source no longer available. This is TownReporter’s capture."
              : "TownReporter’s capture of a public record used in a published story."}
          </p>
        </div>
        <dl className="evidence-facts">
          <div className="evidence-fact">
            <dt>Source URL</dt>
            <dd>
              {/*
                A taken-down capture whose editor ticked "remove the link too"
                prints the address and does not link it -- the same treatment a
                vanished source already gets here. The address itself is the
                record, and is not the part that was asked to come down.
              */}
              {record.disappeared ||
              (record.excerpt_removed && !record.excerpt_removed_link_kept) ? (
                record.url
              ) : (
                <a href={record.url} target="_blank" rel="noreferrer">
                  {record.url}
                </a>
              )}
            </dd>
          </div>
          <div className="evidence-fact">
            <dt>This observation</dt>
            <dd>
              {record.captured_at ? `Captured ${formatDateTime(record.captured_at)}` : "Captured"}
              {record.disappeared ? " — source unavailable at this check" : ""}
            </dd>
          </div>
          {record.content_label ? (
            <div className="evidence-fact">
              <dt>Content</dt>
              <dd>{record.content_label}</dd>
            </div>
          ) : null}
          {record.previously_observed_at ? (
            <div className="evidence-fact">
              <dt>Previously observed</dt>
              <dd>{formatDateTime(record.previously_observed_at)}</dd>
            </div>
          ) : null}
          <div className="evidence-fact">
            <dt>
              {/*
                A taken-down capture holds neither the original file nor the
                extracted text, so neither of the two ordinary labels is true of
                it. What is left -- and what a citation needs -- is the digest
                recorded when the page was captured.
              */}
              {record.excerpt_removed
                ? "SHA-256 recorded for this capture"
                : record.has_original_bytes
                  ? "SHA-256 of original file"
                  : "SHA-256 of extracted text"}
            </dt>
            <dd className="evidence-hash">{record.content_hash || "—"}</dd>
          </div>
          {record.has_original_bytes ? (
            <div className="evidence-fact">
              <dt>Original file</dt>
              <dd>
                TownReporter kept the original bytes. The excerpt below is from its extracted text.
              </dd>
            </div>
          ) : null}
        </dl>
        {record.timeline.length > 1 ? (
          <section className="evidence-section" aria-labelledby="capture-history">
            <h2 id="capture-history">Capture history</h2>
            <ol className="capture-history">
              {record.timeline.map((entry) => (
                <li key={entry.capture_event_id}>
                  <p>
                    {entry.observed_at ? formatDateTime(entry.observed_at) : "Observed"}
                    {" — "}
                    {observationLabel(entry.observation, entry.disappeared)}
                  </p>
                  {entry.content_label && !entry.disappeared ? (
                    <p className="evidence-muted">{entry.content_label}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {/*
          An excerpt, and it says so -- or the notice, when the publisher asked
          for this one capture to come down (unit U11b).

          The notice is what a citation pointing here now lands on: the story
          that cited the capture still prints its citation, this address still
          resolves, and what it says is that the excerpt was removed -- not why,
          and not what an editor wrote about it. `excerpt` is empty for these
          rows because the text is gone from the database, not hidden from this
          page, so the notice is driven by `excerpt_removed` rather than by the
          excerpt being blank: "(no extractable text in this capture)" is a
          different fact and would be a false one here.
        */}
        <section className="evidence-section" aria-labelledby="captured-excerpt">
          <h2 id="captured-excerpt">Excerpt of the captured record</h2>
          {record.excerpt_removed ? (
            <div className="evidence-notice" role="status">
              This excerpt was removed at the publisher’s request.
              {record.excerpt_removed_link_kept && record.url ? (
                <>
                  {" "}
                  The original is at:{" "}
                  <a href={record.url} target="_blank" rel="noreferrer">
                    {record.url}
                  </a>
                  .
                </>
              ) : null}
            </div>
          ) : (
            <blockquote className="evidence-excerpt">
              {record.disappeared && !record.excerpt
                ? "(source unavailable at this check)"
                : record.excerpt || "(no extractable text in this capture)"}
            </blockquote>
          )}
          <p className="evidence-note">
            {record.excerpt_removed
              ? "The excerpt and the text and file TownReporter stored for this capture are deleted. We keep the page’s address, when we captured it and a fingerprint of what we captured, so citations still resolve. Notes taken from the page, other working copies in our reporting files and backups may take longer to clear."
              : "A short excerpt. TownReporter keeps the full capture for its own records and does not republish the original page."}
          </p>
          {record.url && !record.excerpt_removed ? (
            record.disappeared ? (
              <p className="evidence-muted evidence-original">
                The original is no longer available at <span>{record.url}</span>.
              </p>
            ) : (
              <p className="evidence-original">
                <a href={record.url} target="_blank" rel="noreferrer">
                  Read the original on {originalHost(record.url)} ↗
                </a>
              </p>
            )
          ) : null}
        </section>
        {record.timeline.length > 1 ? (
          <p className="evidence-compare-action">
            <Link to="/evidence/compare" search={{ url: record.url }} className="btn">
              Compare observed states of this record →
            </Link>
          </p>
        ) : null}
      </div>
    </PaperShell>
  );
}
