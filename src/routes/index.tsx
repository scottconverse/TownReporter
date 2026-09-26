import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Search } from "lucide-react";
import { PaperShell, ReaderResources } from "@/components/paper-chrome";
import { ReaderRow, SaveStory, ReadingButton } from "@/components/reader-controls";
import { DatesPanel } from "@/components/paper/dates-panel";
import { GeoPills } from "@/components/paper/geo-pills";
import { SectionTag } from "@/components/paper/section-tag";
import { StoryCell, StoryGrid } from "@/components/paper/story-grid";
import { useReader } from "@/components/reader-context";
import { ViewBeacon } from "@/components/view-beacon";
import { readerArticles } from "@/lib/news/reader-public";
import { thisWeekDates } from "@/lib/news/story-dates-public";
import { storyDateRows } from "@/lib/story-dates";
import { AREA_LABELS, HOME_AREA, STORY_AREAS, type StoryArea } from "@/lib/story-area";
import { readerSearch, readMinutes, type ReaderStory } from "@/lib/reader";
import { usePublicSections } from "@/lib/use-sections";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";

/** How many stories one "Latest stories" batch carries. */
const RIVER_BATCH = 12;
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
/** How many place rows the region band prints at most -- one per ground. */
const REGION_ROWS = 3;

export const Route = createFileRoute("/")({
  validateSearch: readerSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const listing = Boolean(deps.topic || deps.q || deps.view);
    const page = await readerArticles({
      data: {
        q: deps.q,
        topic: deps.topic,
        page: deps.page ?? 1,
        oldest: deps.sort === "oldest",
        ...(deps.area ? { area: deps.area } : {}),
        ...(deps.view === "saved" ? { saved: [] } : {}),
      },
    });
    if (listing) return { listing: page, river: null, opinion: null, week: [] };
    // The lead and the six cells: what is printed above the band and the river.
    const above = page.stories.slice(0, TOP_STORIES).map((s) => s.id);
    /*
      The opinion band is above the river, so its story is read here -- once --
      both to print that band on the server and to keep the piece out of the
      river. It takes the newest opinion story the top of the page has NOT
      printed: the band's own piece used to be one of "The latest" rows as well,
      so the front page carried it twice.
    */
    const opinion = await readerArticles({
      data: { topic: "opinion", page: 1, oldest: false, limit: 1, exclude: above },
    });
    /*
      "This week". The dated items printed stories carry for the next seven
      days; see `story-dates.ts`. It is read here rather than in the opinion
      query because it sweeps the whole paper, not one section.
    */
    const week = await thisWeekDates();
    const river = await readerArticles({
      data: {
        limit: RIVER_BATCH,
        // Everything the top of the page prints, and the band's piece: the
        // river carries what is left, and each story once.
        exclude: [...above, ...opinion.stories.map((s) => s.id)],
      },
    });
    return { listing: page, river, opinion, week };
  },
  component: FrontPage,
});
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
  const args = {
    q: search.q,
    topic: search.topic,
    page: search.page ?? 1,
    oldest: search.sort === "oldest",
    ...(search.area ? { area: search.area } : {}),
    ...(search.view === "saved" ? { saved: reader.saved } : {}),
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
    The band asks the same question the loader asked, with the same exclusion:
    the top of the page's own stories. A client query without it would refetch
    the newest opinion piece as soon as the page hydrated and print the story
    under "The latest" a second time.
  */
  const aboveIds = stories.slice(0, TOP_STORIES).map((s) => s.id);
  const opinion = useQuery({
    queryKey: ["reader-opinion", aboveIds],
    queryFn: () =>
      readerArticles({
        data: { topic: "opinion", page: 1, oldest: false, limit: 1, exclude: aboveIds },
      }),
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
  const printed = new Set(stories.slice(0, TOP_STORIES).map((s) => s.id));
  /**
   * "Around the region": one row per ground the paper covers beyond the home
   * town, carrying that ground's newest story that is not already printed
   * above. Stories whose area was never recorded read as the home town
   * (`readStoryArea`), so they are not here, and a ground with nothing left to
   * print is left out rather than filled with a story the reader has already
   * read.
   */
  const regionRows = STORY_AREAS.filter((area) => area !== HOME_AREA)
    .map((area) => ({
      area,
      story: stories.find((s) => s.area === area && !printed.has(s.id)),
    }))
    .filter((row): row is { area: StoryArea; story: ReaderStory } => Boolean(row.story))
    .slice(0, REGION_ROWS);
  /*
    "This week". The loader server-renders it and the panel takes the rows
    already split into the weekday and day columns; see `story-dates.ts` for
    where a dated item comes from and why a short panel is the honest read.
  */
  const week = storyDateRows(initial.week);
  /*
    The "Latest stories" river. The loader server-renders its first batch, so
    the list is there without JavaScript and for a crawler; the rest arrives
    one batch at a time as a sentinel below the list scrolls into view, and
    the Load more link under it does the same job for a keyboard, a reader
    with no JavaScript (it is a real link to the archive) or a slow connection.
  */
  const [loadedRiver, setLoadedRiver] = useState<ReaderStory[]>([]);
  const [riverCursor, setRiverCursor] = useState(initial.river?.nextCursor ?? null);
  const [riverHasMore, setRiverHasMore] = useState(initial.river?.hasMore ?? false);
  const [loadingRiver, setLoadingRiver] = useState(false);
  const [riverNote, setRiverNote] = useState("");
  // The real guard: an IntersectionObserver can fire again before the state
  // update above lands, and two batches off one cursor repeat every story.
  const riverBusy = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const listed = [...(initial.river?.stories ?? []), ...loadedRiver];
  useEffect(() => {
    // A new loader run is a new page: the batches it did not fetch are gone.
    setLoadedRiver([]);
    setRiverCursor(initial.river?.nextCursor ?? null);
    setRiverHasMore(initial.river?.hasMore ?? false);
    setRiverNote("");
  }, [initial.river]);
  const loadRiver = useCallback(async () => {
    if (!riverCursor || riverBusy.current) return;
    riverBusy.current = true;
    setLoadingRiver(true);
    try {
      const batch = await readerArticles({ data: { limit: RIVER_BATCH, cursor: riverCursor } });
      setLoadedRiver((prev) => [...prev, ...batch.stories]);
      setRiverCursor(batch.nextCursor);
      setRiverHasMore(batch.hasMore);
      setRiverNote(
        `${batch.stories.length} more ${batch.stories.length === 1 ? "story" : "stories"} loaded`,
      );
    } catch {
      setRiverNote("Those stories could not load. Try again.");
    } finally {
      riverBusy.current = false;
      setLoadingRiver(false);
    }
  }, [riverCursor]);
  const loadRiverRef = useRef(loadRiver);
  loadRiverRef.current = loadRiver;
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !riverHasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadRiverRef.current();
      },
      // Start a screen early so the next batch is usually there before the
      // reader reaches the bottom.
      { rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [riverHasMore]);
  const nav = (change: Partial<typeof search>) =>
    void navigate({ to: "/", search: { ...search, ...change, page: change.page } });
  return (
    <>
      <ViewBeacon targets={["site"]} />
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
                  ? `Reporting on ${label?.toLowerCase()} in ${paper.city}.`
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
              <section className="ledgerow" aria-label="Featured story">
                <article className="lead">
                  <SectionTag topic={lead.topic}>{sectionName(lead.topic)}</SectionTag>
                  <h2 className="leadhead">
                    <Link to="/articles/$slug" params={{ slug: lead.slug }}>
                      {lead.headline}
                    </Link>
                  </h2>
                  <p className="dek">{lead.dek}</p>
                  <div className="meta">
                    <span>{formatShortDate(lead.published_at)}</span>
                    <span className="dot" />
                    <span>{readMinutes(lead.body)} min read</span>
                  </div>
                  <div className="leadbottom">
                    <Link className="btn primary" to="/articles/$slug" params={{ slug: lead.slug }}>
                      Read the story <ArrowRight aria-hidden />
                    </Link>
                    <SaveStory story={lead} />
                  </div>
                </article>
                <DatesPanel
                  title="This week"
                  items={week}
                  empty={`No published story carries a date in the next seven days, and this panel
                    never prints a meeting that no story has reported.`}
                />
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
                    title={s.headline}
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
          <div className="trustbar">
            <span>
              <FileText aria-hidden />
              Reporting you can trace to the record.
            </span>
            <span>Corrections in the open.</span>
            <Link className="textlink" to="/how-we-report">
              How we report <ArrowRight aria-hidden />
            </Link>
          </div>
          {/*
            "Around the region" beside "Opinion": the places this paper
            covers beyond the home town, and the paper's own voice. Both are
            printed from stories already loaded, and neither repeats a story
            from above.
          */}
          <section className="regionband">
            <div className="regioncol">
              <div className="sectionhead">
                <h2>Around the region</h2>
              </div>
              {regionRows.length ? (
                <ul className="regionlist">
                  {regionRows.map(({ area, story }) => (
                    <li key={area}>
                      <span className="regionplace">{AREA_LABELS[area]}</span>
                      <Link to="/articles/$slug" params={{ slug: story.slug }}>
                        {story.headline}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="regionempty">
                  Every story in this edition is a {paper.city} story. The towns around us appear
                  here when we report from them.
                </p>
              )}
              <Link className="textlink" to="/" search={{ view: "archive" }}>
                All stories <ArrowRight aria-hidden />
              </Link>
            </div>
            {featuredOpinion ? (
              <aside className="opinionpanel">
                <h2>Opinion</h2>
                <Link to="/articles/$slug" params={{ slug: featuredOpinion.slug }}>
                  <h3>{featuredOpinion.headline}</h3>
                </Link>
                <p>{featuredOpinion.dek}</p>
                <Link className="textlink" to="/" search={{ topic: "opinion" }}>
                  All opinion <ArrowRight aria-hidden />
                </Link>
              </aside>
            ) : null}
          </section>
          {listed.length > 0 && (
            <section className="river" aria-labelledby="latest-stories">
              <div className="sectionhead">
                <h2 id="latest-stories">Latest stories</h2>
                <Link className="textlink" to="/" search={{ view: "archive" }}>
                  All stories <ArrowRight aria-hidden />
                </Link>
              </div>
              <p className="riverintro">
                Every story we have published, newest first, as it went to press.
              </p>
              {listed.map((s) => (
                <ReaderRow key={s.id} story={s} />
              ))}
              {riverHasMore ? (
                <a
                  className="btn more"
                  href="/?view=archive&page=2"
                  aria-busy={loadingRiver}
                  onClick={(e) => {
                    // No JavaScript: the href is the archive's second page.
                    e.preventDefault();
                    void loadRiver();
                  }}
                >
                  {loadingRiver ? "Loading stories…" : "Load more stories"}
                </a>
              ) : (
                <p className="riverend">You&rsquo;ve reached the first story we published.</p>
              )}
              <p className="rivernote" role="status" aria-live="polite">
                {riverNote}
              </p>
              <div className="riversentinel" ref={sentinel} aria-hidden="true" />
            </section>
          )}
          {/*
            The back of the book: the sections, the places to go deeper and
            the reading controls. These used to sit in a sidebar beside "The
            latest"; the ruled grid took that space, so they close the page
            instead. Every one of them is the same data source as before --
            `newsroom_sections`, the paper's configured tool links, and the
            reader's own text size.
          */}
          <section className="backmatter" aria-label="Ways through the paper">
            <div className="sidebarcard">
              <h2>Find your way around.</h2>
              <p>Start with what matters to you.</p>
              <div className="topiclist">
                {visible.map((s) => (
                  <Link key={s.key} to="/" search={{ topic: s.key }}>
                    {s.name}
                    <span>
                      <ArrowRight aria-hidden />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <ReaderResources />
            <div className="sidebarcard">
              <span className="eyebrow">YOUR READING, YOUR WAY</span>
              <h2>A little easier on the eyes.</h2>
              <p>Adjust the type size or switch to a darker page.</p>
              <ReadingButton label />
            </div>
          </section>
          <section className="aboutstrip">
            <div>
              <h2>Your community. An open record.</h2>
              <p>Follow the documents, see how we report and hold our work to account.</p>
            </div>
            <Link className="btn" to="/about">
              Meet the publication <ArrowRight aria-hidden />
            </Link>
          </section>
        </>
      )}
    </>
  );
}
