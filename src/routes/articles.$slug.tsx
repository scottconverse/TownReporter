import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { AiDisclosure } from "@/components/ai-disclosure";
import { EmptyState, StorySkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome-utils";
import { getPublishedArticle, listPublishedArticles } from "@/lib/news/public";
import { articleDates } from "@/lib/news/story-dates-public";
import { storyDateRows } from "@/lib/story-dates";
import { parseUrlList, siteUrl } from "@/lib/paper";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { DEFAULT_PAPER_IDENTITY } from "@/lib/paper-identity";
import { usePublicSections } from "@/lib/use-sections";
import { ProvenanceBlock } from "@/components/provenance";
import { DatesPanel } from "@/components/paper/dates-panel";
import { SectionTag } from "@/components/paper/section-tag";
import { ReaderRow, SaveStory, ShareStory, ReadingButton, CopyButton } from "@/components/reader-controls";
import { readMinutes } from "@/lib/reader";
import { ViewBeacon } from "@/components/view-beacon";

/**
 * How much of a story a heading has to have gone past before the jump list
 * calls it current.
 *
 * The observer reports a section as current while its top is inside the band
 * between the sticky masthead's height and 60% of the viewport. Without the
 * negative bottom margin every section on the page is "intersecting" at once
 * and the mark lands wherever the browser happens to order them.
 */
const TOC_MARGIN = "-120px 0px -60% 0px";

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
    /*
      "Dates in this story" is read here, not in a client query, so the panel
      is in the first HTML a reader (or a crawler) receives. It reads dated
      records out of *published stories* only -- this story's own provenance
      rows -- which is the owner's ruling of 2026-09-26; nothing here can print
      a meeting nobody has written about.
    */
    const dates = await articleDates({ data: { slug: params.slug } });
    return { article, dates };
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
    const article = loaderData?.article;
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

type Jump = { id: string; label: string };

/**
 * Which jump link is where the reader is.
 *
 * The handoff draws the current one with a 4px yellow inset ("In this article"
 * -- Article page, item 4). Marking the first link and leaving it would be a
 * claim about the page that is false three paragraphs later, so this follows
 * the scroll; with no `IntersectionObserver` (or no sections to watch) the
 * list simply carries no current mark.
 */
function useCurrentJump(jumps: Jump[]): string {
  const [active, setActive] = useState("");
  useEffect(() => {
    const nodes = jumps
      .map((j) => document.getElementById(j.id))
      .filter((n): n is HTMLElement => n !== null);
    if (!nodes.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setActive(first.target.id);
      },
      { rootMargin: TOC_MARGIN, threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [jumps]);
  return active;
}

function ArticlePage() {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const { formatDate } = usePaperDateFormatters();
  const { slug } = Route.useParams();
  const loaded = Route.useLoaderData();
  const { data: article, isPending } = useQuery({
    queryKey: ["article", slug],
    queryFn: () => getPublishedArticle({ data: slug }),
    initialData: loaded?.article ?? undefined,
  });
  const { data: related = [] } = useQuery({
    queryKey: ["paper"],
    queryFn: () => listPublishedArticles(),
  });
  /*
    The dates panel is server-rendered from the loader and kept fresh by the
    same read, so a story printed after this page was cached still shows the
    dates it carries.
  */
  const { data: dateItems = [] } = useQuery({
    queryKey: ["article-dates", slug],
    queryFn: () => articleDates({ data: { slug } }),
    initialData: loaded?.dates ?? undefined,
  });
  const body = article?.body ?? "";
  const jumps = useMemo<Jump[]>(() => {
    const list: Jump[] = [{ id: "story-body", label: "The story" }];
    if (/claims and sources/i.test(body)) list.push({ id: "claims", label: "Claims and sources" });
    list.push({ id: "sources", label: "Sources & records" });
    list.push({ id: "story-corrections", label: "Corrections" });
    list.push({ id: "related", label: "Read next" });
    return list;
  }, [body]);
  const current = useCurrentJump(jumps);

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
  const more = related.filter((a) => a.slug !== slug).slice(0, 3);
  const sectionName = sections.find((s) => s.key === article.topic)?.name ?? article.topic;
  const isOpinion = article.topic === "opinion";
  const storyDates = storyDateRows(dateItems);

  return (
    <PaperShell compact>
      <ViewBeacon targets={[`story:${slug}`, "site"]} />

      {/* The story proper. "Keep reading" below it is about other stories, so it sits outside. */}
      <article>
        <header className="articlehead">
          <div className="breadcrumbs">
            <Link to="/" search={{}}>
              Front page
            </Link>
            <span>/</span>
            <SectionTag topic={article.topic}>
              {sectionName}
              {isOpinion ? " · Perspective" : ""}
            </SectionTag>
          </div>
          <h1>{article.headline}</h1>
          {article.dek ? <p className="dek">{article.dek}</p> : null}
        </header>
        <div className="bylinebar">
          <div className="bylinewho">
            <span className="trbadge" aria-hidden>
              TR
            </span>
            <span className="bylinenames">
              <strong>
                {paper.name}
                {isOpinion ? " · Opinion" : ""}
              </strong>
              <span>
                {formatDate(article.published_at)} · {readMinutes(article.body)} min read
              </span>
            </span>
          </div>
          <div className="readingtools">
            <SaveStory story={article} label />
            <ShareStory slug={slug} headline={article.headline} />
            <ReadingButton label />
          </div>
        </div>
        <div className="articlelayout">
        <nav className="contents" aria-label="In this article">
          <span className="contentslabel">In this article</span>
          {jumps.map((jump) => (
            <a
              key={jump.id}
              href={`#${jump.id}`}
              className={current === jump.id ? "on" : ""}
              aria-current={current === jump.id ? "location" : undefined}
            >
              {jump.label}
            </a>
          ))}
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
              "FOLLOW THE EVIDENCE" and then stopped). The kicker now lives
              inside ProvenanceBlock, above the records it introduces, so it is
              printed only when there are records to follow -- for every story,
              not only imported ones. The branch below already says in words
              that there are none.
            */}
            {provenance.length ? (
              <ProvenanceBlock
                items={provenance}
                findings={article.findings}
                form={article.form}
              />
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
          <div className="articlefoot">
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
              <Link className="btn primary" to="/corrections" search={{ article: article.headline }}>
                File a correction →
              </Link>
            </section>
            <section className="sources sharepanel">
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
        </div>
          <aside className="articleaside">
            <DatesPanel
              title="Dates in this story"
              items={storyDates}
              empty="No published record attached to this story carries a date of its own."
            />
            <div className="asidecard">
              <span className="tag">OPEN RECORD</span>
              <p>Good reporting should let you look over its shoulder.</p>
              <Link className="textlink" to="/how-we-report">
                How we report →
              </Link>
            </div>
          </aside>
        </div>
      </article>
      <section id="related" className="opinionband keepreading">
        <div className="sectionhead">
          <h2>Keep reading</h2>
          <Link className="textlink" to="/" search={{ topic: article.topic }}>
            More in this section →
          </Link>
        </div>
        <div className="keepreadinggrid">
          {more.map((a) => (
            <ReaderRow key={a.id} story={a} description={false} />
          ))}
        </div>
      </section>
    </PaperShell>
  );
}
