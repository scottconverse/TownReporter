import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { getPublishedArticle, listPublishedArticles } from "@/lib/news/public";
import { formatDate, parseUrlList, siteUrl } from "@/lib/paper";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-context";
import { ProvenanceBlock } from "@/components/provenance";

export const Route = createFileRoute("/articles/$slug")({
  loader: async ({ params }) => {
    const article = await getPublishedArticle({ data: params.slug });
    /*
      A story that is not in the paper must answer 404, not 200.

      The page used to render a tidy "that story is not in this edition" panel
      and return 200 with it, so a mistyped or retired address looked like a
      real page to every crawler and link checker — and search engines index
      soft-404s as if they were content.

      `notFound()` rather than stamping the status by hand: SSR here streams, so
      anything that resolves after the loader arrives too late to change a head
      that has already gone out.
    */
    if (!article) throw notFound();
    return article;
  },
  notFoundComponent: () => (
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
  ),
  /**
   * Per-story title and share cards.
   *
   * Without this every story inherited the site's own title and description, so
   * a link pasted into Slack, Facebook or a group chat read "TownReporter —
   * Longmont, Colorado" with the generic tagline underneath, whatever the story
   * was. Browser tabs were indistinguishable, and search engines saw one title
   * repeated across the whole archive. For a paper whose distribution is people
   * sharing links, that is the difference between a story travelling and not.
   */
  head: ({ loaderData, params, match }) => {
    const article = loaderData;
    if (!article) return {};
    const paper = match.context.paper ?? DEFAULT_PAPER_IDENTITY;
    const url = siteUrl(`/articles/${params.slug}`);
    const title = `${article.headline} — ${paper.name}`;
    const description = (article.dek || paper.tagline).slice(0, 300);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: paper.name },
        { property: "og:title", content: article.headline },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        // ISO 8601, not the JS default `toString()`. "Fri Aug 28 2026 17:06:02
        // GMT-0600 (Mountain Daylight Time)" is not a date any consumer parses.
        {
          property: "article:published_time",
          content: (() => {
            const d = new Date(article.published_at);
            return Number.isNaN(d.getTime()) ? "" : d.toISOString();
          })(),
        },
        { property: "article:section", content: article.topic },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: article.headline },
        { name: "twitter:description", content: description },
        // The share image shipped in `public/` but nothing pointed at it, so
        // every shared link rendered as a bare text card.
        { property: "og:image", content: siteUrl("/og.jpg") },
        { name: "twitter:image", content: siteUrl("/og.jpg") },
      ],
      // Only when an origin is configured; `siteUrl` returns the bare path in
      // local dev, and a relative canonical is not a canonical.
      links: url.startsWith("http") ? [{ rel: "canonical", href: url }] : [],
    };
  },
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
  const provenance = article.provenance?.length
    ? article.provenance
    : sources.map((url) => ({
        title: url,
        organization: "",
        document_date: "",
        url,
        captured_at: null,
        version_id: null,
        version_count: null,
        capture_event_id: null,
        disappeared: false,
        role: "source",
      }));
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
      {article.corrections && article.corrections.length > 0 ? (
        <section className="mt-10 max-w-2xl border-t border-rule pt-6">
          <h2 className="font-display text-2xl font-semibold">Corrections</h2>
          <ul className="mt-4 space-y-4">
            {article.corrections.map((c, i) => (
              <li key={i}>
                <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                  {formatDate(c.date)}
                </p>
                <p className="mt-1 text-ink-2">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ProvenanceBlock
        items={provenance}
        findings={article.findings}
        form={article.form}
      />
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
