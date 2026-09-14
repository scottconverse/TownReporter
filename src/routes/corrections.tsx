import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { CorrectionForm } from "@/components/correction-form";
import { listPublicCorrections } from "@/lib/news/public";
import { DEFAULT_PAPER_IDENTITY, usePaperDateFormatters } from "@/lib/paper-context";
export const Route = createFileRoute("/corrections")({
  validateSearch: (s: Record<string, unknown>): { article?: string } => ({
    article: typeof s.article === "string" ? s.article.slice(0, 2000) : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: `Corrections — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` }],
  }),
  component: Corrections,
});
function Corrections() {
  const { formatShortDate } = usePaperDateFormatters();
  const { article } = Route.useSearch();
  const query = useQuery({ queryKey: ["corrections"], queryFn: () => listPublicCorrections() });
  return (
    <PaperShell compact>
      <div className="infopage">
        <div className="pagehead">
          <span className="eyebrow">CORRECTIONS</span>
          <h1>
            Getting it right includes
            <br />
            putting it right.
          </h1>
          <p>Changes should be easy to find and easy to understand.</p>
        </div>
        <p>
          Corrections appear here and on the affected story, with a date and an explanation of what
          changed.
        </p>
        <CorrectionForm article={article} />
        <h2>Corrections to published stories</h2>
        {query.isPending ? (
          <p role="status">Loading corrections…</p>
        ) : query.isError ? (
          <div role="alert" className="reader-error">
            The correction log could not load.{" "}
            <button className="btn" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : !query.data?.length ? (
          <div className="empty">
            <h2>No corrections posted.</h2>
            <p>See an error? Use the form above to write to the editor.</p>
          </div>
        ) : (
          query.data.map((c) => (
            <section className="sourcecard" key={c.id}>
              <span className="eyebrow">{formatShortDate(c.created_at)}</span>
              <h3>{c.headline}</h3>
              <p>{c.body}</p>
              {"slug" in c && typeof c.slug === "string" && (
                <Link className="textlink" to="/articles/$slug" params={{ slug: c.slug }}>
                  Read the corrected story →
                </Link>
              )}
            </section>
          ))
        )}
      </div>
    </PaperShell>
  );
}
