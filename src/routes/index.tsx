import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { PaperShell } from "@/components/paper-chrome";
import { ReaderRow, SaveStory } from "@/components/reader-controls";
import { DatesPanel } from "@/components/paper/dates-panel";
import { GeoPills } from "@/components/paper/geo-pills";
import { SectionTag } from "@/components/paper/section-tag";
import { StoryCell, StoryGrid } from "@/components/paper/story-grid";
import { useReader } from "@/components/reader-context";
import { ReadBeacon } from "@/components/read-beacon";
import { ViewBeacon } from "@/components/view-beacon";
import { readerArticles } from "@/lib/news/reader-public";
import { thisWeekDates } from "@/lib/news/story-dates-public";
import { storyDateRows } from "@/lib/story-dates";
import { headlineWithTag, opinionHeadlineDisplay } from "@/lib/news/editorial";
import { dekOrFallback } from "@/lib/news/dek-fallback";
import { HOME_AREA, STORY_AREAS } from "@/lib/story-area";
import { readerSearch, readMinutes } from "@/lib/reader";
import { usePublicSections } from "@/lib/use-sections";
import { useAreaLabels, usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { topicReportingSentence } from "@/lib/paper-phrases";

/**
 * How many stories "Latest stories" prints.
 *
 * Six, then an "All stories →" link to the archive (unit BX, design round 1).
 * It used to be the first batch of an infinite scroll -- twelve, then more as a
 * sentinel below the list came into view, with a "Load more stories" button as
 * the no-JavaScript fallback. The design has no scroll-for-more on the front
 * page: the paper's newest six are the front page's, and everything else is one
 * link away on the archive, which is a real page a crawler and a keyboard can
 * both reach. The whole machinery is gone with it.
 */
const RIVER_BATCH = 6;
/**
 * How many cells the front page's ruled story grid prints: three across, two
 * down (design-system/README.md, "Story grid"). On a phone the stylesheet
 * collapses it to one column and the last two cells are hidden, which is the
 * handoff's "four story cells instead of six" -- done in CSS so the server
 * prints one list rather than two.
 */
const GRID_CELLS = 6;
/**
 * How many stories the top of the front page prints in all: the lead and the
 * six cells. The region band and the river start below them, so no story is
 * printed twice.
 */
const TOP_STORIES = 1 + GRID_CELLS;
/** The latest four published stories beyond the home town. */
const REGION_ROWS = 4;
/**
 * How many stories the lead column carries under "Read the story".
 *
 * Unit CN, item 1(b) (owner review, 2026-09-27). The lead and "This week" are
 * one grid row, so a lead column four fields tall beside a five-row panel
 * leaves blank paper under the lead; the owner's target is that the two columns
 * end within 40px of each other at 1790 and 1440. Two rows is what closes it
 * (the lead column's own 36px bottom padding and the row's 1px gap are the rest
 * of the difference) -- measured, `reports/CN-front-gap-and-clause.md`.
 *
 * The drawing has no such list: its lead column is the tag, headline, dek and
 * date and nothing else, and its own `week` aside is a fixed six rows. The
 * owner's instruction for that case is to use the grid cell's own type styles,
 * smaller, and the rows reuse the grid cell itself (`StoryCell`) under a
 * `.leadalso` wrapper that takes its padding down.
 */
const ALSO_ROWS = 2;

/**
 * The stories the lead column prints under its own button.
 *
 * Read from the stories AFTER the top of the page -- the lead and the six grid
 * cells, `TOP_STORIES` -- so nothing the page prints below is chosen, and a
 * story the "This week" panel already names is skipped as well: the panel sits
 * three inches to the right of these rows, and the same story twice in one
 * glance is not a service to the reader. The one exception is the band's own
 * opinion piece, which the edition read has already excluded; it is skipped
 * here too rather than assumed away.
 *
 * Both callers -- the loader, which needs the ids for the river's exclusion,
 * and the component, which renders them -- call this on the same list, so the
 * stories the lead prints are exactly the ones the river leaves out.
 */
function alsoUnderLead<T extends { id: number; slug: string }>(
  stories: T[],
  week: readonly { slug?: string }[],
  opinionSlug: string | undefined,
): T[] {
  const spoken = new Set(week.map((row) => row.slug).filter(Boolean));
  const chosen: T[] = [];
  for (const story of stories.slice(TOP_STORIES)) {
    if (chosen.length >= ALSO_ROWS) break;
    if (story.slug === opinionSlug || spoken.has(story.slug)) continue;
    chosen.push(story);
  }
  return chosen;
}

export const Route = createFileRoute("/")({
  validateSearch: readerSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const listing = Boolean(deps.topic || deps.q || deps.view);
    /*
      The edition's read is the HOME TOWN's, not the whole paper. The prototype
      draws the home pill pressed and Unit BD did not follow it, on the grounds
      that a pressed pill over an unfiltered page would print a filtered state
      that was not true; the claim is what was wrong, so the read is what
      changed. `HOME_AREA` matches a null or unrecognized stored area as well
      (`readStoryArea`), so a story printed before migration 0098 counts as
      home. A listing screen is a search across the whole paper and has no pills
      to press, so it keeps the old behavior and filters only on an explicit
      `?area=`.
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
        /*
          The edition read skips opinion (unit BZ, item 9). The lead and the
          ruled grid are the paper's reporting; an unsigned editorial printed
          there took the Opinion box's own story -- the newest opinion the paper
          has -- off the box. A listing screen is a search across the whole
          paper, opinion included, so this predicate is the edition's alone.
        */
        ...(listing ? {} : { notTopic: "opinion" }),
      },
    });
    if (listing) return { listing: page, river: null, opinion: null, week: [], region: [] };
    // The lead and the six cells: what is printed above the band and the river.
    const above = page.stories.slice(0, TOP_STORIES).map((s) => s.id);
    /*
      The opinion band is above the river, so its story is read here -- once --
      both to print that band on the server and to keep the piece out of the
      river.

      It is the newest opinion piece the paper has published, full stop (unit
      BZ, item 9). It used to be "the newest the top of the page has NOT
      printed", which meant a fresh editorial landing in the story grid pushed
      the box down to a week-old one -- the box would not show the paper's own
      newest editorial. Since the edition read above now skips opinion, the
      newest piece is never one the top has printed, and the exclusion has
      nothing left to exclude.
    */
    const opinion = await readerArticles({
      data: { topic: "opinion", page: 1, oldest: false, limit: 1 },
    });
    /*
      "This week". The dated items printed stories carry for the next seven
      days; see `story-dates.ts`. It is read here rather than in the opinion
      query because it sweeps the whole paper, not one section.
    */
    const week = await thisWeekDates();
    /*
      The lead column's own rows under the button (unit CN, item 1(b)). Read
      here rather than in the component because the river has to leave them
      out: `alsoUnderLead` is the same rule both callers apply to the same
      stories, so what the lead prints is exactly what the river does not.
    */
    const also = alsoUnderLead(page.stories, week, opinion.stories[0]?.slug).map((s) => s.id);
    const region = await readRegion();
    const river = await readerArticles({
      data: {
        limit: RIVER_BATCH,
        // Everything the top of the page prints -- the lead, the six cells,
        // the band's piece, the lead column's own rows -- each story once.
        exclude: [...above, ...opinion.stories.map((s) => s.id), ...also],
      },
    });
    return { listing: page, river, opinion, week, region };
  },
  component: FrontPage,
});

/**
 * The latest four published stories across Nearby, county and state.
 * Four from each ground suffice to find the newest four across all three.
 */
async function readRegion() {
  const grounds = STORY_AREAS.filter((area) => area !== HOME_AREA);
  const rows = await Promise.all(
    grounds.map(async (area) =>
      (await readerArticles({ data: { area, limit: REGION_ROWS, oldest: false } })).stories
        .map((story) => ({ area, story })),
    ),
  );
  return rows
    .flat()
    .sort((a, b) =>
      new Date(b.story.published_at!).getTime() - new Date(a.story.published_at!).getTime() ||
      b.story.id - a.story.id,
    )
    .slice(0, REGION_ROWS);
}
/**
 * The masthead's geography row, and the page under it.
 *
 * The pills belong to the front page and to its search object -- they set
 * `?area=`, which is the archive query's own predicate -- so they are built
 * here, where the route's search is in reach, and handed to the shell as a
 * slot. The archive and the listing screens print no pills: a reader who has
 * gone looking for something has already chosen what they are looking at.
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
  // "Around the region" names the ground each story stands on; the words are
  // this paper's own (see `useAreaLabels`), not the shipped default's.
  const labels = useAreaLabels();
  const { sections } = usePublicSections();
  const visible = sections.filter((s) => s.visible);
  const { formatShortDate } = usePaperDateFormatters();
  const search = Route.useSearch();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const reader = useReader();
  const [q, setQ] = useState(search.q || "");
  useEffect(() => setQ(search.q || ""), [search.q]);
  const listing = Boolean(search.topic || search.q || search.view);
  const label = sections.find((s) => s.key === search.topic)?.name ?? search.topic;
  // The same read the loader made, including the home-town default on the
  // edition: a client query without it would refetch the whole paper as soon as
  // the page hydrated and print stories the pressed home pill does not cover.
  const area = listing ? search.area : (search.area ?? HOME_AREA);
  const args = {
    q: search.q,
    topic: search.topic,
    page: search.page ?? 1,
    oldest: search.sort === "oldest",
    ...(area ? { area } : {}),
    ...(search.view === "saved" ? { saved: reader.saved } : {}),
    // The edition read's own predicate; see the loader. A listing has none.
    ...(listing ? {} : { notTopic: "opinion" }),
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
  /*
    The band asks the same question the loader asked: the newest opinion piece
    the paper has published, with no exclusion (unit BZ, item 9). The key holds
    no story ids for the same reason the query holds no `exclude` -- the answer
    does not depend on what the top of the page printed, so a client query that
    refetched it would get the same piece the server rendered.
  */
  const opinion = useQuery({
    queryKey: ["reader-opinion"],
    queryFn: () => readerArticles({ data: { topic: "opinion", page: 1, oldest: false, limit: 1 } }),
    enabled: !listing,
    initialData: initial.opinion ?? undefined,
  });
  const featuredOpinion = opinion.data?.stories[0];
  /* The section name for a stored key; sections are configurable (0045). */
  const sectionName = (topic: string) => sections.find((s) => s.key === topic)?.name ?? topic;
  /**
   * The six cells of the ruled grid. The lead is the seventh story, so the
   * grid starts at index 1; a paper with fewer than seven printed stories
   * simply prints fewer cells and the grid rules close on the last one.
   */
  const gridStories = stories.slice(1, TOP_STORIES);
  /*
    "Around the region". The loader reads each ground for itself (`readRegion`),
    because the edition above it is the home town's read and prints no story
    from any other ground.
  */
  const regionRows = (initial.region?.length ?? 0) >= 2 ? initial.region! : [];
  /*
    "This week". The loader server-renders it and the panel takes the rows
    already split into the weekday and day columns; see `story-dates.ts` for
    where a dated item comes from and why a short panel is the honest read.
  */
  const week = storyDateRows(initial.week);
  /*
    The lead column's own rows, under its button (unit CN, item 1(b)). The same
    rule the loader applied to the same stories, so what the lead prints is
    exactly what the river was told to leave out.
  */
  const also = alsoUnderLead(stories, week, featuredOpinion?.slug);
  /*
    The "Latest stories" river. The loader server-renders the whole list --
    six stories, newest first, and nothing behind them (unit BX). It used to
    be the first batch of an infinite scroll; the design's front page ends
    here, with "All stories →" in the section head as the way to the rest.
  */
  const listed = initial.river?.stories ?? [];
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
        <div className="listing">
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
            onSubmit={(e) => {
              e.preventDefault();
              nav({ q: q.trim() || undefined, view: search.view ?? "archive" });
            }}
          >
            <input
              className="field"
              aria-label="Search published stories"
              type="search"
              maxLength={80}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stories, names or places"
            />
            <button className="btn primary" type="submit">
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
                  onChange={(e) =>
                    nav({ topic: e.target.value || undefined, view: search.view ?? "archive" })
                  }
                >
                  <option value="">All sections</option>
                  {visible.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort{" "}
                <select
                  aria-label="Sort stories"
                  value={search.sort ?? "newest"}
                  onChange={(e) =>
                    nav({ sort: e.target.value === "oldest" ? "oldest" : undefined })
                  }
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </label>
            </div>
          </div>
          {stories.map((s) => (
            <ReaderRow key={s.id} story={s} />
          ))}
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
              <Link className="btn" to="/" search={{}}>
                Front page
              </Link>{" "}
              <Link className="btn" to="/" search={{ view: search.view ?? "archive" }}>
                Clear filters
              </Link>
            </div>
          )}
          {data.total > data.pageSize && (
            <nav className="pagination" aria-label="Archive pages">
              <button
                className="btn"
                disabled={(search.page ?? 1) <= 1 || query.isFetching}
                onClick={() => nav({ page: (search.page ?? 1) - 1 })}
              >
                Previous
              </button>
              <span>
                Page {search.page ?? 1} of {Math.ceil(data.total / data.pageSize)}
              </span>
              <button
                className="btn"
                disabled={(search.page ?? 1) * data.pageSize >= data.total || query.isFetching}
                onClick={() => nav({ page: (search.page ?? 1) + 1 })}
              >
                Next <ArrowRight aria-hidden />
              </button>
            </nav>
          )}
        </div>
      ) : (
        <>
          {/*
            The front page's one heading. The edition's title is the dateline
            in the top bar, so this is for a screen reader and a crawler only
            -- the page's first *visible* type is the lead headline, which is
            what a front page is.
          */}
          <h1 className="vh">
            {paper.name} — {paper.location}
          </h1>
          {lead ? (
            <>
              {/*
                The lead and "This week", side by side in the 1.7fr / 1fr grid.
                The 1px rules between the two columns and the 3px rule under
                them come from the container's own background showing through a
                1px gap, so no cell carries a border that doubles where two
                meet.
              */}
              <section
                className={`ledgerow${week.length ? "" : " solo"}`}
                aria-label="Featured story"
              >
                {/*
                  The lead column: the lead itself, then the paper's next
                  stories under it (unit CN, item 1(b)). The rows are the
                  COLUMN's, not the lead's, and the wrapper is what says so:
                  `river-e2e` reads `.lead` as one story and refuses a card
                  that links more than one (`assertEveryStoryIsPrintedOnce`),
                  which printing them inside the article made it look like.
                  The wrapper is also the row's grid item, so the column's
                  padding and background sit in one place for both parts.
                */}
                <div className="leadcolumn">
                  <article className="lead">
                    <SectionTag topic={lead.topic}>{sectionName(lead.topic)}</SectionTag>
                    <h2 className="leadhead">
                      <Link to="/articles/$slug" params={{ slug: lead.slug }}>
                        {headlineWithTag(lead.topic, lead.headline)}
                      </Link>
                    </h2>
                    <p className="dek">{dekOrFallback(lead.dek, lead.body)}</p>
                    <div className="meta">
                      <span>{formatShortDate(lead.published_at)}</span>
                      <span className="dot" />
                      <span>{readMinutes(lead.body)} min read</span>
                    </div>
                    <div className="leadbottom">
                      <Link
                        className="btn primary"
                        to="/articles/$slug"
                        params={{ slug: lead.slug }}
                      >
                        Read the story <ArrowRight aria-hidden />
                      </Link>
                      <SaveStory story={lead} />
                    </div>
                  </article>
                  {/*
                    The lead column's own rows (unit CN, item 1(b)). The lead
                    and "This week" are one grid row, so the lead column's box
                    is stretched to the panel's height whatever it prints --
                    a four-field lead beside a five-row panel left blank paper
                    under the button. These are the paper's next stories, in
                    the grid cell's own shapes: kicker, headline link, date ·
                    min read. No story here prints below: the loader leaves
                    these ids out of the river (`alsoUnderLead`).
                  */}
                  {also.length ? (
                    <div className="leadalso">
                      {also.map((s) => (
                        <StoryCell
                          key={s.id}
                          section={sectionName(s.topic)}
                          title={headlineWithTag(s.topic, s.headline)}
                          date={formatShortDate(s.published_at)}
                          read={String(readMinutes(s.body))}
                          slug={s.slug}
                          topic={s.topic}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                {/*
                  No dated items, no panel: the lead runs the full width instead
                  and no sentence explains the absence (unit BX). A panel whose
                  only content is a note about why it has nothing to say tells
                  the reader about the newsroom's filing, not about their town.
                  The rule underneath is unchanged -- a date prints only when a
                  published story reports it (`story-dates.ts`).
                */}
                {week.length ? <DatesPanel title="This week" items={week} /> : null}
              </section>
              {/*
                The ruled story grid: three across on a desktop, two on a
                tablet, one on a phone, with the last two cells dropped on a
                phone so the front page reaches "Around the region" sooner.
              */}
              <StoryGrid columns={3}>
                {gridStories.map((s) => (
                  <StoryCell
                    key={s.id}
                    section={sectionName(s.topic)}
                    title={headlineWithTag(s.topic, s.headline)}
                    date={formatShortDate(s.published_at)}
                    read={String(readMinutes(s.body))}
                    slug={s.slug}
                    topic={s.topic}
                  />
                ))}
              </StoryGrid>
            </>
          ) : !query.isError ? (
            <div className="empty">
              <h2>The edition is still being set.</h2>
              <p>
                No published stories yet. Read about the newsroom while the editor prepares the
                paper.
              </p>
              <Link to="/about" className="btn">
                About this paper
              </Link>
            </div>
          ) : null}
          {/*
            "Around the region" beside "Opinion": the places this paper
            covers beyond the home town, and the paper's own voice. Both are
            printed from stories already loaded, and neither repeats a story
            from above.

            Fewer than two regional stories hides "Around the region", and
            Opinion runs the full width; no opinion piece at all -> no Opinion
            panel, and the region column runs the full width. Neither absence
            gets a sentence: the reader is told what the paper has, not what it
            does not. With both missing the whole band goes.
          */}
          {(regionRows.length > 0 || featuredOpinion) && (
            <section className={`regionband${regionRows.length && featuredOpinion ? "" : " solo"}`}>
              {regionRows.length ? (
                <div className="regioncol">
                  <div className="sectionhead">
                    <h2>Around the region</h2>
                  </div>
                  <ul className="regionlist">
                    {regionRows.map(({ area, story }) => (
                      <li key={story.id}>
                        <span className="regionplace">{labels[area]}</span>
                        <Link to="/articles/$slug" params={{ slug: story.slug }}>
                          {story.headline}
                        </Link>
                        <span className="meta">{formatShortDate(story.published_at)}</span>
                      </li>
                    ))}
                  </ul>
                  <Link className="textlink" to="/" search={{ view: "archive" }}>
                    All stories <ArrowRight aria-hidden />
                  </Link>
                </div>
              ) : null}
              {featuredOpinion ? (
                <aside className="opinionpanel">
                  <h2>Opinion</h2>
                  <Link to="/articles/$slug" params={{ slug: featuredOpinion.slug }}>
                    {/*
                      The stored headline carries the literal "OPINION: "
                      prefix that makes an unsigned editorial unmistakable in a
                      feed or a reprint; this block is already titled
                      "Opinion", so it prints the headline without it (unit
                      BX). Display only -- nothing is rewritten.
                    */}
                    <h3>{opinionHeadlineDisplay(featuredOpinion.headline)}</h3>
                  </Link>
                  <p>{dekOrFallback(featuredOpinion.dek, featuredOpinion.body)}</p>
                  <Link className="textlink" to="/" search={{ topic: "opinion" }}>
                    All opinion <ArrowRight aria-hidden />
                  </Link>
                </aside>
              ) : null}
            </section>
          )}
          {listed.length > 0 && (
            <section className="river" aria-labelledby="latest-stories">
              <div className="sectionhead">
                <h2 id="latest-stories">Latest stories</h2>
                <Link className="textlink" to="/" search={{ view: "archive" }}>
                  All stories <ArrowRight aria-hidden />
                </Link>
              </div>
              {/*
                `datebox={false}`: the row's own meta line under the headline
                already carries the date, and the front page printed it twice --
                once in the left gutter, once there (unit BX). The archive keeps
                the gutter, which is what it is for: a run of stories read in
                order, where the date is the thing you scan.
              */}
              {listed.map((s) => (
                <ReaderRow
                  key={s.id}
                  story={s}
                  datebox={false}
                  title={headlineWithTag(s.topic, s.headline)}
                />
              ))}
            </section>
          )}
          {/*
            The three sidebarcards that used to close the page -- "Find your
            way around.", "Useful around town" and "A little easier on the
            eyes." -- are gone (unit BX, design round 1) together with "Your
            community. An open record.". The design's front page ends at the
            river. Nothing was dropped with them: the sections they listed are
            the section nav in the masthead and the archive's own section
            filter, the two town links moved into the footer, text size is in
            the top bar, and About is in the footer too.
          */}
        </>
      )}
    </>
  );
}
