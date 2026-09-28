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
import { isMiscTopic } from "@/lib/news/section-types";
import { dekOrFallback } from "@/lib/news/dek-fallback";
import { ProvenanceBlock } from "@/components/provenance";
import { DatesPanel } from "@/components/paper/dates-panel";
import { SectionTag } from "@/components/paper/section-tag";
import { ReaderRow, SaveStory, ShareStory, ReadingButton, CopyButton } from "@/components/reader-controls";
import { readMinutes } from "@/lib/reader";
import {
  LEGAL_GONE_BODY,
  LEGAL_GONE_TITLE,
  isLegallyRemovedForReader,
  isLegallyRemovedSlug,
  legalGoneResponse,
} from "@/lib/news/legal-gone";
import { ReadBeacon } from "@/components/read-beacon";
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
    /*
      A story that is missing from the paper is missing for one of two reasons,
      and they are not the same answer.

      A mistyped or retired address is 404 -- that is what `notFound()` below
      still means, and its panel still says "not in this edition". A story the
      desk removed on legal advice is not a wrong address: it was here, the desk
      decided it may not be published, and the record of that decision is in
      `legal_removal_slugs`. BH4 made the URL answer 410 for it; this is the
      same claim on the path that never makes a request for the URL.

      A reader who reaches the story by clicking a link -- or by pressing Back
      to a story they had open when it was live -- never asks the server for the
      URL: the router runs this loader in the BROWSER and re-renders. So the
      answer has to come back as data, not as a status, and the page has to be
      the removal page itself. Returning a flag rather than throwing
      `notFound({ data })` is deliberate: a loader that throws leaves the
      PREVIOUS match's `loaderData` in place, which the route's own `head` then
      reads -- measured, and it is how the removed story's headline, dek,
      `og:title`, `twitter:title` and `article:published_time` stayed on the
      not-found panel. A load that SUCCEEDS replaces that data, so the head can
      say "removed" and nothing else (BH6).
    */
    if (!article) {
      if (await isLegallyRemovedForReader({ data: params.slug })) {
        return { article: null, dates: null, legalGone: true };
      }
      throw notFound();
    }
    /*
      "Dates in this story" is read here, not in a client query, so the panel
      is in the first HTML a reader (or a crawler) receives. It reads dated
      records out of *published stories* only -- this story's own provenance
      rows -- which is the owner's ruling of 2026-09-26; nothing here can print
      a meeting nobody has written about.
    */
    const dates = await articleDates({ data: { slug: params.slug } });
    return { article, dates, legalGone: false };
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
    /*
      A removed story's head is the removal notice, and nothing else.

      "Nothing else" is the load-bearing half. The head is what a share card,
      a browser tab and a crawler read, and the story's head here is its
      headline, its dek, its publication time and its canonical URL -- so
      leaving it in place on a removal page republishes the story at a second
      URL, which is the one thing a legal removal exists to stop. This runs on
      the in-app path too: the framework projects `head` for the match on every
      client-side navigation, so a reader who arrives by link or by Back gets
      the removal title and `noindex` in the tab, not the story's.

      `noindex` on the in-app path is a belt to the 410's braces: the URL
      already answers 410 to a plain request, and this covers the crawler that
      runs the page's JavaScript instead.
    */
    if (loaderData?.legalGone) {
      return {
        meta: [
          { title: LEGAL_GONE_TITLE },
          { name: "description", content: LEGAL_GONE_BODY },
          { name: "robots", content: "noindex" },
        ],
      };
    }
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
  /*
    A legally removed story answers 410 Gone, not 404.

    The two are not the same claim and the desk makes the difference
    deliberately: `removeLegally` deletes the row, so without this the read
    below finds nothing and the page answers 404 -- the answer a mistyped
    address gets. But the removal dialog the owner confirms promises, on the
    record, "Removed now; the URL returns 410 Gone" (README Dialogs table,
    drawing `dialog-15-legal.png`), and a promise the UI makes about a URL has
    to be true of the URL. 410 also tells a crawler something 404 cannot: it
    was here, it is gone for good, stop asking.

    This lives in the route's own handler because the status cannot be set any
    other way here. SSR streams: the head leaves before the loader has
    resolved, the router hardcodes 404 for `notFound()` and 500 for a thrown
    error, and h3 keeps a returned `Response`'s own status -- which is why the
    feed and the sitemap build their responses this way. A route WITH a
    component is the one case where a handler may hand the request back:
    `next()` falls through to the ordinary render, so a story that was not
    legally removed is served exactly as before.
  */
  server: {
    handlers: {
      GET: async ({ params, next }) => {
        if (await isLegallyRemovedSlug(params.slug)) return legalGoneResponse();
        return next();
      },
    },
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

  /*
    The reader reached a story the desk removed on legal advice -- by a link, or
    by pressing Back to a story they had open when it was still live. They get
    the same words a real request to the URL gets (BH4's 410 page), with none of
    the story on it: not the headline, not the dek, not one word of the body.

    This branch is FIRST, above the pending state and above `!article`. The
    query below is keyed by slug and the browser may still be holding this
    story's own response from the visit that put it in the reader's history --
    `initialData` comes from the loader, but react-query's cache does not, and a
    removal page that flashed the cached story before settling would have shown
    it anyway. Nothing from that query is rendered here.
  */
  if (loaded.legalGone) {
    return (
      <PaperShell compact>
        <EmptyState
          kicker="Archive"
          title={LEGAL_GONE_TITLE}
          body={LEGAL_GONE_BODY}
          action={
            <Link to="/" className={inkGhost}>
              Back to the paper
            </Link>
          }
        />
      </PaperShell>
    );
  }
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

  const dekText = dekOrFallback(article.dek, article.body);
  const sources = parseUrlList(article.source_urls);
  /*
    Every URL the story cites reaches "Sources & public records", including the
    ones the provenance records do not cover.

    This used to be either/or: a story with any provenance record printed those
    and silently dropped the rest of its `source_urls`; only a story with none
    fell through to the URL list. A meeting story is exactly the shape that
    broke -- it is written from a recording, so its one source is the video, and
    a single captured document anywhere in the story was enough to hide it.
    Records first, then the cited URLs they do not already name.
  */
  const recordedProvenance = article.provenance ?? [];
  const recordedUrls = new Set(recordedProvenance.map((item) => item.url).filter(Boolean));
  const provenance = [
    ...recordedProvenance,
    ...sources
      .filter((url) => !recordedUrls.has(url))
      .map((url) => ({
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
      })),
  ];
  const more = related.filter((a) => a.slug !== slug).slice(0, 3);
  const sectionName = sections.find((s) => s.key === article.topic)?.name ?? article.topic;
  const isOpinion = article.topic === "opinion";
  const storyDates = storyDateRows(dateItems, slug);

  return (
    <PaperShell compact>
      <ViewBeacon targets={[`story:${slug}`, "site"]} />
      <ReadBeacon />

      {/* The story proper. "Keep reading" below it is about other stories, so it sits outside. */}
      <article>
        <header className="articlehead">
          <div className="breadcrumbs">
            <Link to="/" search={{}}>
              Front page
            </Link>
            {/*
              A "misc" story prints no tag anywhere on the reader side, so it
              also prints no separator: the crumb would otherwise read
              "Front page /" and trail off (unit BX). The desk keeps its labels.
            */}
            {isMiscTopic(article.topic) ? null : (
              <>
                <span>/</span>
                <SectionTag topic={article.topic} className="tag">
                  {sectionName}
                  {isOpinion ? " · Perspective" : ""}
                </SectionTag>
              </>
            )}
          </div>
          <h1>{article.headline}</h1>
          {dekText ? <p className="dek">{dekText}</p> : null}
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
