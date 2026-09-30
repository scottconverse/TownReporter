import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome-utils";
import { getPublicEvidence } from "@/lib/news/evidence";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

export const Route = createFileRoute("/evidence/$versionId")({
  loader: ({ params }) => getPublicEvidence({ data: Number(params.versionId) }),
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
      <p className="text-[11px] tracking-[0.16em] text-rust uppercase">Captured record</p>
      <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight">
        {record.title || record.url}
      </h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        {record.disappeared
          ? "Original source no longer available. This is TownReporter’s capture."
          : "TownReporter’s capture of a public record used in a published story."}
      </p>
      <dl className="mt-6 max-w-2xl space-y-2 text-sm">
        <div>
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Source URL</dt>
          <dd className="mt-1 break-all">
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
              <a
                href={record.url}
                className="text-rust hover:text-rust-2"
                target="_blank"
                rel="noreferrer"
              >
                {record.url}
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">This observation</dt>
          <dd className="mt-1">
            {record.captured_at ? `Captured ${formatDateTime(record.captured_at)}` : "Captured"}
            {record.disappeared ? " — source unavailable at this check" : ""}
          </dd>
        </div>
        {record.content_label ? (
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Content</dt>
            <dd className="mt-1">{record.content_label}</dd>
          </div>
        ) : null}
        {record.previously_observed_at ? (
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Previously observed</dt>
            <dd className="mt-1">{formatDateTime(record.previously_observed_at)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">
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
          <dd className="mt-1 break-all font-mono text-xs">{record.content_hash || "—"}</dd>
        </div>
        {record.has_original_bytes ? (
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Original file</dt>
            <dd className="mt-1">
              TownReporter kept the original bytes. The excerpt below is from its extracted text.
            </dd>
          </div>
        ) : null}
      </dl>
      {record.timeline.length > 1 ? (
        <section className="mt-8 max-w-2xl">
          <h2 className="text-[11px] tracking-[0.16em] text-muted uppercase">Capture history</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {record.timeline.map((entry) => (
              <li key={entry.capture_event_id} className="border-b border-rule pb-2 last:border-0">
                <p>
                  {entry.observed_at ? formatDateTime(entry.observed_at) : "Observed"}
                  {" — "}
                  {observationLabel(entry.observation, entry.disappeared)}
                </p>
                {entry.content_label && !entry.disappeared ? (
                  <p className="text-muted">{entry.content_label}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {/*
        An excerpt, and it says so -- or the notice, when the publisher asked
        for this one capture to come down (unit U11b).

        This block used to print up to 80,000 characters of the page we
        captured -- somebody else's article, whole, on a public page. The
        record still shows what we cited and where it came from; the reading
        happens at the source, which is what the link below is for.

        The notice is what a citation pointing here now lands on: the story
        that cited the capture still prints its citation, this address still
        resolves, and what it says is that the excerpt was removed -- not why,
        and not what an editor wrote about it. `excerpt` is empty for these
        rows because the text is gone from the database, not hidden from this
        page, so the notice is driven by `excerpt_removed` rather than by the
        excerpt being blank: "(no extractable text in this capture)" is a
        different fact and would be a false one here.
      */}
      <section className="mt-8 max-w-2xl">
        <h2 className="text-[11px] tracking-[0.16em] text-muted uppercase">
          Excerpt of the captured record
        </h2>
        {record.excerpt_removed ? (
          <div
            role="status"
            className="mt-3 border-l-2 border-rule pl-4 text-sm leading-6 text-ink-2"
          >
            This excerpt was removed at the publisher’s request.
            {record.excerpt_removed_link_kept && record.url ? (
              <>
                {" "}
                The original is at:{" "}
                <a
                  href={record.url}
                  className="break-all text-rust underline hover:text-rust-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {record.url}
                </a>
                .
              </>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 whitespace-pre-wrap border-l-2 border-rule pl-4 text-sm leading-6 text-ink-2">
            {record.disappeared && !record.excerpt
              ? "(source unavailable at this check)"
              : record.excerpt || "(no extractable text in this capture)"}
          </div>
        )}
        <p className="mt-3 text-sm text-muted">
          {record.excerpt_removed
            ? "The excerpt and the text and file TownReporter stored for this capture are deleted. We keep the page’s address, when we captured it and a fingerprint of what we captured, so citations still resolve. Notes taken from the page, other working copies in our reporting files and backups may take longer to clear."
            : "A short excerpt. TownReporter keeps the full capture for its own records and does not republish the original page."}
        </p>
        {record.url && !record.excerpt_removed ? (
          <p className="mt-4 text-base">
            {record.disappeared ? (
              <span className="text-muted">
                The original is no longer available at{" "}
                <span className="break-all">{record.url}</span>.
              </span>
            ) : (
              <a
                href={record.url}
                className="text-rust underline hover:text-rust-2"
                target="_blank"
                rel="noreferrer"
              >
                Read the original on {originalHost(record.url)}
              </a>
            )}
          </p>
        ) : null}
      </section>
      {record.timeline.length > 1 ? (
        <p className="mt-8">
          <Link
            to="/evidence/compare"
            search={{ url: record.url }}
            className="text-rust hover:text-rust-2"
          >
            Compare observed states of this record
          </Link>
        </p>
      ) : null}
    </PaperShell>
  );
}
