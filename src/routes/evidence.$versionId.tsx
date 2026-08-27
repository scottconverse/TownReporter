import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { getPublicEvidence } from "@/lib/news/evidence";
import { formatDateTime } from "@/lib/paper";

export const Route = createFileRoute("/evidence/$versionId")({
  loader: ({ params }) => getPublicEvidence({ data: Number(params.versionId) }),
  component: EvidencePage,
});

function observationLabel(kind: string, disappeared: boolean): string {
  if (disappeared || kind === "unavailable") return "Source unavailable at this check";
  if (kind === "changed") return "Changed";
  if (kind === "reverted") return "Reverted to an earlier content version";
  if (kind === "restored") return "Restored";
  if (kind === "unchanged") return "Observed again, same content";
  return "Captured";
}

function EvidencePage() {
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
            {record.disappeared ? (
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
            {record.has_original_bytes ? "SHA-256 of original file" : "SHA-256 of extracted text"}
          </dt>
          <dd className="mt-1 break-all font-mono text-xs">{record.content_hash || "—"}</dd>
        </div>
        {record.has_original_bytes ? (
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Original file</dt>
            <dd className="mt-1">
              TownReporter kept the original bytes. The extracted text is below.
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
      <div className="mt-8 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-ink-2">
        {record.disappeared
          ? "(source unavailable at this check)"
          : record.extraction_text || "(no extractable text in this capture)"}
      </div>
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
