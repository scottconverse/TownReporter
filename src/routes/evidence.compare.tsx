import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { comparePublicEvidence } from "@/lib/news/evidence";
import { formatDateTime } from "@/lib/paper";

type Search = { url?: string; a?: number; b?: number };

export const Route = createFileRoute("/evidence/compare")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    url: typeof s.url === "string" ? s.url : undefined,
    a: typeof s.a === "string" || typeof s.a === "number" ? Number(s.a) : undefined,
    b: typeof s.b === "string" || typeof s.b === "number" ? Number(s.b) : undefined,
  }),
  loaderDeps: ({ search }) => ({ url: search.url, a: search.a, b: search.b }),
  loader: ({ deps }) => comparePublicEvidence({ data: deps }),
  component: ComparePage,
});

function observationLabel(kind: string, disappeared: boolean): string {
  if (disappeared || kind === "unavailable") return "source unavailable";
  if (kind === "changed") return "changed";
  if (kind === "reverted") return "reverted";
  if (kind === "restored") return "restored";
  if (kind === "unchanged") return "observed again";
  return "captured";
}

function ComparePage() {
  const search = Route.useSearch();
  const loaded = Route.useLoaderData();
  const { data, isPending } = useQuery({
    queryKey: ["evidence-compare", search.url, search.a, search.b],
    queryFn: () => comparePublicEvidence({ data: search }),
    initialData: loaded === undefined ? undefined : loaded,
  });
  const compared = data !== undefined ? data : loaded;

  if (isPending && compared === undefined) {
    return (
      <PaperShell compact>
        <StorySkeleton />
      </PaperShell>
    );
  }
  if (!compared) {
    return (
      <PaperShell compact>
        <EmptyState
          kicker="Evidence"
          title="Nothing to compare"
          body="Version comparison is only available for records cited in a published story."
          action={
            <Link to="/" className={inkGhost}>
              Back to the paper
            </Link>
          }
        />
      </PaperShell>
    );
  }

  const { older, newer, changes, timeline } = compared;
  const unchanged =
    older.content_hash === newer.content_hash ||
    (!changes.added.length && !changes.removed.length);

  return (
    <PaperShell compact>
      <p className="text-[11px] tracking-[0.16em] text-rust uppercase">Compare observations</p>
      <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight">
        {newer.title || newer.url}
      </h1>
      <p className="mt-3 max-w-2xl break-all text-sm text-muted">{newer.url}</p>
      {timeline.length > 0 ? (
        <ol className="mt-6 max-w-2xl space-y-2 text-sm">
          {timeline.map((entry) => (
            <li key={entry.capture_event_id}>
              {entry.observed_at ? formatDateTime(entry.observed_at) : "Observed"}
              {" — "}
              {observationLabel(entry.observation, entry.disappeared)}
              {entry.content_label && !entry.disappeared ? ` — ${entry.content_label}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="border border-rule p-4">
          <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Previous observed state</p>
          <p className="mt-2">{older.content_label || (older.version_id != null ? `v${older.version_id}` : "—")}</p>
          <p className="text-sm text-muted">
            {older.captured_at ? formatDateTime(older.captured_at) : "—"}
          </p>
          <p className="mt-2 break-all font-mono text-xs">{older.content_hash}</p>
          {older.version_id != null ? (
            <p className="mt-2">
              <Link
                to="/evidence/$versionId"
                params={{ versionId: String(older.version_id) }}
                className="text-rust hover:text-rust-2"
              >
                Open
              </Link>
            </p>
          ) : null}
        </div>
        <div className="border border-rule p-4">
          <p className="text-[11px] tracking-[0.14em] text-muted uppercase">Latest observed state</p>
          <p className="mt-2">{newer.content_label || (newer.version_id != null ? `v${newer.version_id}` : "—")}</p>
          <p className="text-sm text-muted">
            {newer.captured_at ? formatDateTime(newer.captured_at) : "—"}
          </p>
          <p className="mt-2 break-all font-mono text-xs">{newer.content_hash}</p>
          {newer.version_id != null ? (
            <p className="mt-2">
              <Link
                to="/evidence/$versionId"
                params={{ versionId: String(newer.version_id) }}
                className="text-rust hover:text-rust-2"
              >
                Open
              </Link>
            </p>
          ) : null}
        </div>
      </div>
      {unchanged ? (
        <p className="mt-8 max-w-2xl text-ink-2">No textual change between these observations.</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl">Removed</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-2">
              {changes.removed.length ? (
                changes.removed.map((s) => <li key={s.slice(0, 80)}>{s}</li>)
              ) : (
                <li>None detected.</li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="font-display text-2xl">Added</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-2">
              {changes.added.length ? (
                changes.added.map((s) => <li key={s.slice(0, 80)}>{s}</li>)
              ) : (
                <li>None detected.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </PaperShell>
  );
}
