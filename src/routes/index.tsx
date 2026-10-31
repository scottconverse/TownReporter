import { EmptyEdition } from "@/components/empty-edition";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { PaperShell } from "@/components/paper-chrome";
import { ReaderRow, SaveStory } from "@/components/reader-controls";
import { EventsWeekBox } from "@/components/paper/events-week-box";
import { GeoPills } from "@/components/paper/geo-pills";
import { MoreTopStories, type MoreTopStory } from "@/components/paper/more-top-stories";
import { useReader } from "@/components/reader-context";
import { ReadBeacon } from "@/components/read-beacon";
import { ViewBeacon } from "@/components/view-beacon";
import { readerArticles } from "@/lib/news/reader-public";
import { readerRoundups } from "@/lib/news/reader-roundups-public";
import {
  numberedMoreTopStories,
  RIVER_BATCH,
  TOP_STORIES,
  topStorySlots,
} from "@/lib/news/front-page";
import { headlineWithTag, opinionHeadlineDisplay } from "@/lib/news/editorial";
import { dekOrFallback } from "@/lib/news/dek-fallback";
import { isMiscTopic } from "@/lib/news/section-types";
import { HOME_AREA } from "@/lib/story-area";
import { readerSearch, readMinutes } from "@/lib/reader";
import { usePublicSections } from "@/lib/use-sections";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { topicReportingSentence } from "@/lib/paper-phrases";
import { editionRiverQuery } from "@/lib/news/edition-river";
import { frontEventsWeek } from "@/lib/news/events-week-public";
import { hasEvents } from "@/lib/news/events-week";

export const Route = createFileRoute("/")({
  validateSearch: readerSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const listing = Boolean(deps.topic || deps.q || deps.view);
    /*
      The edition reads the home town, while an archive/listing read searches
      the paper the reader asked for. Opinion and routine roundups are not
      story slots on the front page; listings deliberately keep both.
    */
    const area = listing ? deps.area : (deps.area ?? HOME_AREA);
    const page = await readerArticles({
      data: {
        q: deps.q,
        topic: deps.topic,
        page: deps.page ?? 1,
        oldest: deps.sort === "oldest",
        ...(area ? { area } : {}),
        ...(deps.view === "saved" ? { saved: [] } : {}),
        ...(listing ? {} : { notTopic: "opinion", notRoutine: true }),
      },
    });
    if (listing)
      return {
        listing: page,
        river: null,
        opinion: null,
        roundups: [],
        events: null,
      };

    const above = page.stories.slice(0, TOP_STORIES).map((story) => story.id);
    const [opinion, eventsWeek, roundups] = await Promise.all([
      readerArticles({
        data: { topic: "opinion", page: 1, oldest: false, limit: 1 },
      }),
      frontEventsWeek(),
      readerRoundups(),
    ]);
    const river = await readerArticles({
      data: editionRiverQuery(area!, RIVER_BATCH, [
        ...above,
        ...opinion.stories.map((story) => story.id),
      ]),
    });
    /* A seven-day read with no events is no band at all. */
    const events = hasEvents(eventsWeek.days) ? eventsWeek : null;
    return { listing: page, river, opinion, roundups, events };
  },
  component: FrontPage,
});

/** A front-page kicker: accent text, with the reserved line kept for misc. */
function FrontKicker({ topic, children }: { topic: string | null; children: string }) {
  if (isMiscTopic(topic)) {
    return (
      <span className="frontkicker" aria-hidden="true">
        &nbsp;
      </span>
    );
  }
  return topic ? (
    <Link className="frontkicker" to="/" search={{ topic }}>
      {children}
    </Link>
  ) : (
    <span className="frontkicker">{children}</span>
  );
}

/**
 * The masthead's geography row, and the page under it. Pills are a front-page
 * search object; listings have already chosen what they are looking at.
 */
function FrontPage() {
  const search = Route.useSearch();
  const listing = Boolean(search.topic || search.q || search.view);
  return (
    <PaperShell
      geography={listing ? undefined : <GeoPills active={search.area} search={search} />}
    >
      <Home />
    </PaperShell>
  );
}

function Home() {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const visible = sections.filter((section) => section.visible);
  const { formatShortDate } = usePaperDateFormatters();
  const search = Route.useSearch();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const reader = useReader();
  const [q, setQ] = useState(search.q || "");
  useEffect(() => setQ(search.q || ""), [search.q]);
  const listing = Boolean(search.topic || search.q || search.view);
  const label = sections.find((section) => section.key === search.topic)?.name ?? search.topic;
  const area = listing ? search.area : (search.area ?? HOME_AREA);
  const args = {
    q: search.q,
    topic: search.topic,
    page: search.page ?? 1,
    oldest: search.sort === "oldest",
    ...(area ? { area } : {}),
    ...(search.view === "saved" ? { saved: reader.saved } : {}),
    ...(listing ? {} : { notTopic: "opinion", notRoutine: true }),
  };
  const query = useQuery({
    queryKey: ["reader-archive", args],
    queryFn: () => readerArticles({ data: args }),
    initialData: search.view === "saved" ? undefined : initial.listing,
    enabled: search.view !== "saved" || reader.ready,
  });
  const data = query.data ?? initial.listing;
  const stories = data.stories;
  const lead = stories[0];
  const opinion = useQuery({
    queryKey: ["reader-opinion"],
    queryFn: () => readerArticles({ data: { topic: "opinion", page: 1, oldest: false, limit: 1 } }),
    enabled: !listing,
    initialData: initial.opinion ?? undefined,
  });
  const roundups = useQuery({
    queryKey: ["reader-roundups"],
    queryFn: () => readerRoundups(),
    enabled: !listing,
    initialData: initial.roundups,
  });
  const featuredOpinion = opinion.data?.stories[0];
  const roundupItems = roundups.data ?? initial.roundups;
  const sectionName = (topic: string) =>
    sections.find((section) => section.key === topic)?.name ?? topic;
  const slots = topStorySlots(stories);
  const moreItems: MoreTopStory[] = numberedMoreTopStories(stories).map((story) => ({
    id: story.id,
    slug: story.slug,
    number: story.number,
    kicker: isMiscTopic(story.topic) ? null : sectionName(story.topic),
    kickerTopic: isMiscTopic(story.topic) ? null : story.topic,
    headline: headlineWithTag(story.topic, story.headline),
    meta: `${formatShortDate(story.published_at)} · ${readMinutes(story.body)} min read`,
  }));
  const latest = initial.river?.stories ?? [];
  const nav = (change: Partial<typeof search>) =>
    void navigate({ to: "/", search: { ...search, ...change, page: change.page } });

  return (
    <>
      <ViewBeacon targets={["site"]} />
      <ReadBeacon />
      {query.isError ? (
        <div className="reader-error" role="alert">
          The stories could not load.{" "}
          <button className="btn" type="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {listing ? (
        <div className="listing bulletin-listing">
          <div className="pagehead">
            <span className="eyebrow">
              {search.view === "saved"
                ? "YOUR READING LIST"
                : search.topic
                  ? "YOUR COMMUNITY, IN FOCUS"
                  : "THE ARCHIVE"}
            </span>
            <h1>{search.view === "saved" ? "Your saved stories" : label || "Find a story."}</h1>
            <p>
              {search.view === "saved"
                ? "Saved on this browser, no account needed. Only stories still published appear here."
                : search.topic
                  ? topicReportingSentence(label?.toLowerCase() ?? "", paper.city)
                  : "Search by topic, name, place or a detail you remember."}
            </p>
          </div>
          <form
            className="searchform"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              nav({ q: q.trim() || undefined, view: search.view ?? "archive" });
            }}
          >
            <input
              className="field"
              aria-label="Search published stories"
              type="search"
              maxLength={80}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search stories, names or places"
            />
            <button className="btn primary searchsubmit" type="submit">
              <Search aria-hidden />
              Search
            </button>
          </form>
          <div className="filters">
            <span className="resultcount" role="status">
              {query.isFetching
                ? "Loading stories…"
                : `${data.total} ${data.total === 1 ? "story" : "stories"}`}
            </span>
            <div className="filter-controls">
              <label>
                Section{" "}
                <select
                  aria-label="Section"
                  value={search.topic ?? ""}
                  onChange={(event) =>
                    nav({ topic: event.target.value || undefined, view: search.view ?? "archive" })
                  }
                >
                  <option value="">All sections</option>
                  {visible.map((section) => (
                    <option key={section.key} value={section.key}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort{" "}
                <select
                  aria-label="Sort stories"
                  value={search.sort ?? "newest"}
                  onChange={(event) =>
                    nav({ sort: event.target.value === "oldest" ? "oldest" : undefined })
                  }
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
            </div>
          </div>
          <div className="listingrows">
            {stories.map((story) => (
              <ReaderRow key={story.id} story={story} archive />
            ))}
          </div>
          {!stories.length && !query.isFetching && !query.isError && (
            <div className="empty">
              <h2>
                {search.view === "saved" && !search.q && !search.topic
                  ? "Make room for a good read."
                  : "No stories found."}
              </h2>
              <p>
                {search.view === "saved"
                  ? "Tap the bookmark beside a story to save it here. Previously saved stories may no longer be published."
                  : "Try another search or explore a different section."}
              </p>
              <div className="empty-actions">
                <Link className="btn" to="/" search={{}}>
                  Front page
                </Link>{" "}
                <Link className="btn" to="/" search={{ view: search.view ?? "archive" }}>
                  Clear filters
                </Link>
              </div>
            </div>
          )}
          {data.total > data.pageSize && (
            <nav className="pagination" aria-label="Archive pages">
              <button
                className="btn previous"
                type="button"
                disabled={(search.page ?? 1) <= 1 || query.isFetching}
                onClick={() => nav({ page: (search.page ?? 1) - 1 })}
              >
                Previous
              </button>
              <span>
                Page {search.page ?? 1} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                className="btn next"
                type="button"
                disabled={(search.page ?? 1) * data.pageSize >= data.total || query.isFetching}
                onClick={() => nav({ page: (search.page ?? 1) + 1 })}
              >
                Next →
              </button>
            </nav>
          )}
        </div>
      ) : (
        <>
          <h1 className="vh">
            {paper.name} — {paper.location}
          </h1>
          {lead ? (
            <>
              <section className="fronttop" aria-label="Top stories">
                <div className="fronttop-main">
                  <article className="lead frontlead">
                    <FrontKicker topic={lead.topic}>
                      {isMiscTopic(lead.topic) ? "" : sectionName(lead.topic)}
                    </FrontKicker>
                    <h2 className="leadhead">
                      <Link to="/articles/$slug" params={{ slug: lead.slug }}>
                        {headlineWithTag(lead.topic, lead.headline)}
                      </Link>
                    </h2>
                    <p className="dek">{dekOrFallback(lead.dek, lead.body)}</p>
                    <div className="leadbottom">
                      <Link
                        className="btn primary"
                        to="/articles/$slug"
                        params={{ slug: lead.slug }}
                      >
                        Read the story <ArrowRight aria-hidden />
                      </Link>
                      <SaveStory story={lead} label />
                      <span className="frontmeta">
                        {formatShortDate(lead.published_at)} · {readMinutes(lead.body)} min read
                      </span>
                    </div>
                  </article>
                  {slots.pair.length ? (
                    <div className="frontpair">
                      {slots.pair.map((story) => (
                        <article className="frontpairstory" key={story.id}>
                          <FrontKicker topic={story.topic}>
                            {isMiscTopic(story.topic) ? "" : sectionName(story.topic)}
                          </FrontKicker>
                          <h3>
                            <Link to="/articles/$slug" params={{ slug: story.slug }}>
                              {headlineWithTag(story.topic, story.headline)}
                            </Link>
                          </h3>
                          <p>{dekOrFallback(story.dek, story.body)}</p>
                          <span className="frontmeta">
                            {formatShortDate(story.published_at)} · {readMinutes(story.body)} min read
                          </span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
                <MoreTopStories items={moreItems} />
              </section>
              {initial.events ? (
                <EventsWeekBox data={initial.events} roundups={roundupItems} />
              ) : null}
              {latest.length || featuredOpinion ? (
                <div className={`frontlatestband river${featuredOpinion ? "" : " no-opinion"}`}>
                  {latest.length ? (
                    <section className="frontlatest" aria-labelledby="latest-stories">
                      <div className="frontsectionhead">
                        <h2 id="latest-stories">Latest stories</h2>
                        <Link className="textlink" to="/" search={{ view: "archive" }}>
                          All stories <ArrowRight aria-hidden />
                        </Link>
                      </div>
                      <div className="frontlatestgrid">
                        {latest.map((story) => (
                          <article className="frontlateststory" key={story.id}>
                            <FrontKicker topic={story.topic}>
                              {isMiscTopic(story.topic) ? "" : sectionName(story.topic)}
                            </FrontKicker>
                            <h3>
                              <Link to="/articles/$slug" params={{ slug: story.slug }}>
                                {headlineWithTag(story.topic, story.headline)}
                              </Link>
                            </h3>
                            <p>{dekOrFallback(story.dek, story.body)}</p>
                            <div className="frontlatestmeta">
                              <span>
                                {formatShortDate(story.published_at)} · {readMinutes(story.body)} min
                                read
                              </span>
                              <SaveStory story={story} label />
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {featuredOpinion ? (
                    <aside className="opinionpanel frontopinion" aria-labelledby="opinion-h">
                      <h2 id="opinion-h">Opinion</h2>
                      <h3>
                        <Link
                          to="/articles/$slug"
                          params={{ slug: featuredOpinion.slug }}
                        >
                          {opinionHeadlineDisplay(featuredOpinion.headline)}
                        </Link>
                      </h3>
                      <p>{dekOrFallback(featuredOpinion.dek, featuredOpinion.body)}</p>
                      <Link className="textlink" to="/" search={{ topic: "opinion" }}>
                        All opinion <ArrowRight aria-hidden />
                      </Link>
                    </aside>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : !query.isError ? (
            <EmptyEdition area={search.area} />
          ) : null}
        </>
      )}
    </>
  );
}
