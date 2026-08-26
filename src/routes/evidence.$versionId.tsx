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
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Captured</dt>
          <dd className="mt-1">{record.captured_at ? formatDateTime(record.captured_at) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">SHA-256</dt>
          <dd className="mt-1 break-all font-mono text-xs">{record.content_hash}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Version</dt>
          <dd className="mt-1">v{record.version_id}</dd>
        </div>
        {record.has_original_bytes ? (
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-muted uppercase">Original artifact</dt>
            <dd className="mt-1">
              Bytes captured ({record.byte_length ? `${Math.round(record.byte_length / 1024)} KB` : "yes"}).
              Extracted text is shown below.
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-8 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-ink-2">
        {record.extraction_text || "(no extractable text in this capture)"}
      </div>
      <p className="mt-8">
        <Link
          to="/evidence/compare"
          search={{ url: record.url }}
          className="text-rust hover:text-rust-2"
        >
          Compare versions of this record
        </Link>
      </p>
    </PaperShell>
  );
}
