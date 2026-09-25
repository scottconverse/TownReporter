import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { AiDisclosure } from "@/components/ai-disclosure";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome-utils";
import { getPublishedArticle, listPublishedArticles } from "@/lib/news/public";
import { parseUrlList, siteUrl } from "@/lib/paper";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { usePublicSections } from "@/lib/use-sections";
import { ProvenanceBlock } from "@/components/provenance";
import { ReaderRow, SaveStory, ShareStory, ReadingButton, CopyButton } from "@/components/reader-controls";
import { readMinutes } from "@/lib/reader";
import { ViewBeacon } from "@/components/view-beacon";

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
  const paper = usePaper();
  const { sections } = usePublicSections();
  const { formatDate } = usePaperDateFormatters();
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
      <ViewBeacon targets={[`story:${slug}`, "site"]} />

      <div className="breadcrumbs">
        <Link to="/" search={{}}>
          Front page
        </Link>
        <span>/</span>
        <Link to="/" search={{ topic: article.topic }}>
          {sections.find((s) => s.key === article.topic)?.name ?? article.topic}
        </Link>
      </div>
      <article>
        <div className="articlehead">
          <Link className={`tag ${article.topic}`} to="/" search={{ topic: article.topic }}>
            {sections.find((s) => s.key === article.topic)?.name ?? article.topic}
            {article.topic === "opinion" ? " · Perspective" : ""}
          </Link>
          <h1>{article.headline}</h1>
          <p className="dek">{article.dek}</p>
          <div className="byline">
            <div className="avatar">
              <span>TR</span>
              <div>
                <strong>
                  {paper.name}
                  {article.topic === "opinion" ? " · Opinion" : ""}
                </strong>
                <span>
                  {formatDate(article.published_at)} · {readMinutes(article.body)} min read
                </span>
              </div>
            </div>
            <div className="readingtools">
              <SaveStory story={article} label />
              <ShareStory slug={slug} headline={article.headline} />
              <ReadingButton label />
            </div>
          </div>
        </div>
        <div className="articlelayout">
          <nav className="contents" aria-label="In this article">
            <strong>In this article</strong>
            <a href="#story-body">The story</a>
            {/claims and sources/i.test(article.body) && <a href="#claims">Claims and sources</a>}
            <a href="#sources">Sources &amp; records</a>
            <a href="#story-corrections">Corrections</a>
            <a href="#related">Read next</a>
          </nav>
          <div className="articlebody" id="story-body">
            <StoryBody body={article.body} publicReading />
            <section className="sources" id="sources">
              <AiDisclosure routine={article.routine_notice} text={article.disclosure_text ?? ""} />
              {/*
                FOLLOW THE EVIDENCE used to print above this section whatever was
                in it, so a story with no separate source records showed a
                heading with nothing under it (coordinator review of the Unit X
                screenshots, 2026-09-24: a published imported story read
                "FOLLOW THE EVIDENCE" and then stopped). It is a heading for the
                evidence that follows, so it is rendered only when there is
                evidence to follow -- for every story, not only imported ones.
                The branch below already says in words that there is none.
              */}
              {provenance.length ? (
                <>
                  <span className="eyebrow">FOLLOW THE EVIDENCE</span>
                  <ProvenanceBlock
                    items={provenance}
                    findings={article.findings}
                    form={article.form}
                  />
                </>
              ) : (
                <>
                  <h2>Sources &amp; public records</h2>
                  <p>
                    No separate public source records are attached to this story. See any source
                    references in the article above.
                  </p>
                </>
              )}
            </section>
            <section className="sources" id="story-corrections">
              <h2>Corrections &amp; accountability</h2>
              {article.corrections?.length ? (
                article.corrections.map((c, i) => (
                  <div className="sourcecard" key={i}>
                    <strong>{formatDate(c.date)}</strong>
                    <p>{c.body}</p>
                  </div>
                ))
              ) : (
                <p>No corrections have been posted for this story.</p>
              )}
              <Link className="textlink" to="/corrections" search={{ article: article.headline }}>
                File a correction →
              </Link>
            </section>
            <section className="sources">
              <h2>Share the reporting.</h2>
              <p>
                Free to reprint with credit to {paper.name} and a link to the original. Reprinting
                does not imply endorsement.
              </p>
              <CopyButton
                text={() =>
                  `${article.headline}\nOriginally published by ${paper.name}.\n${new URL("/articles/" + slug, window.location.origin).href}`
                }
              >
                Copy credit &amp; original link
              </CopyButton>
            </section>
          </div>
          <aside className="articleaside">
            <span className="tag">OPEN RECORD</span>
            <p>Good reporting should let you look over its shoulder.</p>
            <Link className="textlink" to="/how-we-report">
              How we report →
            </Link>
          </aside>
        </div>
      </article>
      <section id="related" className="opinionband">
        <div className="sectionhead">
          <h2>Keep reading</h2>
          <Link className="textlink" to="/" search={{ topic: article.topic }}>
            More in this section →
          </Link>
        </div>
        {more.map((a) => (
          <ReaderRow key={a.id} story={a} description={false} />
        ))}
      </section>
    </PaperShell>
  );
}
