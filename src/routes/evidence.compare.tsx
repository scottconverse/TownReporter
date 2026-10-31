import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome-utils";
import { comparePublicEvidence } from "@/lib/news/evidence";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

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

function captureName(label: string | null | undefined, versionId: number | null): string {
  if (label?.trim()) return label.trim();
  if (versionId != null) return `Capture ${versionId}`;
  return "—";
}

function observationLabel(kind: string, disappeared: boolean): string {
  if (disappeared || kind === "unavailable") return "source unavailable";
  if (kind === "changed") return "changed";
  if (kind === "reverted") return "reverted";
  if (kind === "restored") return "restored";
  if (kind === "unchanged") return "observed again";
  return "captured";
}

function ComparePage() {
  const { formatDateTime } = usePaperDateFormatters();
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

  const { older, newer, changes, timeline, excerpt_removed } = compared;
  const unchanged =
    older.content_hash === newer.content_hash || (!changes.added.length && !changes.removed.length);
  /*
    A total that sits on the server-side diff's own cap is a floor, not a
    count: `describeTextChanges` stops counting at 24 sentences a side, so a
    comparison of two long captures reports "24" for what may be hundreds. A
    bare number would be the page stating something it does not know.
  */
  const shown = changes.removed.length + changes.added.length;
  const totalFloor = changes.removed_total + changes.added_total;
  const totalIsFloor = changes.removed_total_at_least || changes.added_total_at_least;

  return (
    <PaperShell compact>
      <div className="compare-page">
        <div className="pagehead comparehead">
          <span className="eyebrow">Compare observations</span>
          <h1>{newer.title || newer.url}</h1>
          <p>{newer.url}</p>
        </div>
        {timeline.length > 0 ? (
          <ol className="compare-timeline">
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
        <div className="compare-states">
          <article className="compare-card">
            <span className="compare-label">Previous observed state</span>
            <b>{captureName(older.content_label, older.version_id)}</b>
            <span className="compare-when">
              {older.captured_at ? formatDateTime(older.captured_at) : "—"}
            </span>
            <code>{older.content_hash}</code>
            {older.version_id != null ? (
              <Link to="/evidence/$versionId" params={{ versionId: String(older.version_id) }}>
                Open
              </Link>
            ) : null}
          </article>
          <article className="compare-card is-latest">
            <span className="compare-label">Latest observed state</span>
            <b>{captureName(newer.content_label, newer.version_id)}</b>
            <span className="compare-when">
              {newer.captured_at ? formatDateTime(newer.captured_at) : "—"}
            </span>
            <code>{newer.content_hash}</code>
            {newer.version_id != null ? (
              <Link to="/evidence/$versionId" params={{ versionId: String(newer.version_id) }}>
                Open
              </Link>
            ) : null}
          </article>
        </div>
        {/*
          Unit U11b2: one side's excerpt was taken down, so the comparison says so
          instead of diffing. The server already returns an empty change summary
          for this case (`compareChanges`), and the sentence is what stops an
          empty "None detected" pair from reading as "these two captures are
          identical".
        */}
        {excerpt_removed ? (
          <p className="compare-status" role="status">
            An excerpt of this capture was removed at the publisher’s request, so there is nothing
            left to compare. The record’s address, capture time and fingerprint are above.
          </p>
        ) : unchanged ? (
          <p className="compare-status">No textual change between these observations.</p>
        ) : (
          <>
            <div className="compare-changes">
              <section>
                <h2>Removed</h2>
                <ul className="removed-list">
                  {changes.removed.length ? (
                    changes.removed.map((s) => <li key={s.slice(0, 80)}>{s}</li>)
                  ) : (
                    /* "None detected" is a claim about the two captures. It is
                       only true when this side's own total is zero -- the shared
                       snippet budget can leave a side with changes unshown. */
                    <li>{changes.removed_total ? "None shown." : "None detected."}</li>
                  )}
                </ul>
              </section>
              <section>
                <h2>Added</h2>
                <ul className="added-list">
                  {changes.added.length ? (
                    changes.added.map((s) => <li key={s.slice(0, 80)}>{s}</li>)
                  ) : (
                    <li>{changes.added_total ? "None shown." : "None detected."}</li>
                  )}
                </ul>
              </section>
            </div>
            {/*
              A comparison is of two captured pages, so the full difference is
              the pages. The reader gets the count and the first few sentences.
            */}
            {shown < totalFloor || totalIsFloor ? (
              <p className="compare-count">
                Showing {shown} of {totalIsFloor ? "at least " : ""}
                {totalFloor} changed passages.
              </p>
            ) : null}
          </>
        )}
      </div>
    </PaperShell>
  );
}
