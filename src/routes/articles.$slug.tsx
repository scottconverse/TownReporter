import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { getPublishedArticle, listPublishedArticles } from "@/lib/news/public";
import { formatDate, parseUrlList } from "@/lib/paper";

export const Route = createFileRoute("/articles/$slug")({
  loader: ({ params }) => getPublishedArticle({ data: params.slug }),
  component: ArticlePage,
});

function ArticlePage() {
  const { slug } = Route.useParams();
  const loaded = Route.useLoaderData();
  const { data: article, isPending } = useQuery({
    queryKey: ["article", slug],
    queryFn: () => getPublishedArticle({ data: slug }),
    initialData: loaded ?? undefined,
  });
  const { data: related = [] } = useQuery({
    queryKey: ["paper"],
    queryFn: () => listPublishedArticles(),
  });

  if (isPending) {
    return (
      <PaperShell compact>
        <StorySkeleton />
      </PaperShell>
    );
  }
  if (!article) {
    return (
      <PaperShell compact>
        <EmptyState
          kicker="Archive"
          title="That story is not in this edition"
          body="It may have been held, or the address is wrong. The paper is on the front page."
          action={
            <Link to="/" className={inkGhost}>
              Back to the paper
            </Link>
          }
        />
      </PaperShell>
    );
  }

  const sources = parseUrlList(article.source_urls);
  const more = related.filter((a) => a.slug !== slug).slice(0, 4);

  return (
    <PaperShell compact>
      <div className="stagger-in">
        <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
          {article.topic} · {formatDate(article.published_at)}
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl">
          {article.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-xl italic text-ink-2">{article.dek}</p>
      </div>
      <div className="enter-rise mt-8 max-w-2xl">
        <StoryBody body={article.body} />
      </div>
      {sources.length > 0 && (
        <section className="enter-rise mt-10 max-w-2xl border-t border-rule pt-4">
          <h2 className="text-[11px] tracking-[0.16em] text-muted uppercase">
            Sources
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {sources.map((u) => (
              <li key={u}>
                <a
                  href={u}
                  className="break-all text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {u}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Trust is verifiable. Check the official record before you act on a
            figure or a vote.
          </p>
        </section>
      )}
      <p className="mt-8 max-w-2xl text-sm text-muted">
        Free to reprint in whole or part with credit to TownReporter and a link
        back. Do not imply endorsement.
      </p>
      {more.length > 0 && (
        <section className="mt-12 border-t-2 border-ink pt-6">
          <h2 className="font-display text-2xl font-semibold">Also in the paper</h2>
          <ul className="stagger-in mt-4 space-y-3">
            {more.map((a) => (
              <li key={a.id}>
                <Link
                  to="/articles/$slug"
                  params={{ slug: a.slug }}
                  className="font-display text-xl transition-[color] duration-150 ease-out hover:text-rust"
                >
                  {a.headline}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PaperShell>
  );
}
