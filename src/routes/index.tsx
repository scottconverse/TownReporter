import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, FileText, Search } from "lucide-react";
import { PaperShell, ReaderResources } from "@/components/paper-chrome";
import { ReaderRow, SaveStory, ReadingButton } from "@/components/reader-controls";
import { useReader } from "@/components/reader-context";
import { ViewBeacon } from "@/components/view-beacon";
import { readerArticles } from "@/lib/news/reader-public";
import { readerSearch, readMinutes, type ReaderStory } from "@/lib/reader";
import { usePublicSections } from "@/lib/use-sections";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";

/** How many stories one "Latest stories" batch carries. */
const RIVER_BATCH = 12;
/**
 * Where "The latest" ends: the lead, then the five under it. The box beside the
 * lead picks up here -- it used to print stories 2, 3 and 4, which "The latest"
 * already prints, so three of the front page's first six appeared twice.
 */
const LATEST_END = 6;
/**
 * How many stories the top of the front page prints in all: the lead, the five
 * under "The latest", and the three in the box beside the lead. The opinion
 * band and the river start below them, so no story is printed twice.
 */
const TOP_STORIES = 9;

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
        ...(deps.view === "saved" ? { saved: [] } : {}),
      },
    });
    if (listing) return { listing: page, river: null, opinion: null };
    // The lead, "The latest" and the box beside the lead: what is printed above
    // the band and the river.
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
    const river = await readerArticles({
      data: {
        limit: RIVER_BATCH,
        // Everything the top of the page prints, and the band's piece: the
        // river carries what is left, and each story once.
        exclude: [...above, ...opinion.stories.map((s) => s.id)],
      },
    });
    return { listing: page, river, opinion };
  },
  component: () => (
    <PaperShell>
      <Home />
    </PaperShell>
  ),
});
function Home() {
  const paper = usePaper();
  const { sections } = usePublicSections();
  const visible = sections.filter((s) => s.visible);
  const { formatShortDate, formatDate } = usePaperDateFormatters();
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
  /*
    The box beside the lead. It picks up where "The latest" stops rather than
    repeating it: the hero deepens the front page instead of printing three of
    its stories a second time. On a paper with nothing left at story 7 there is
    nothing for the box to add, and it is left out -- the "Explore the archive"
    button under "The latest" is the way down the page either way.
  */
  const moreStories = stories.slice(LATEST_END, TOP_STORIES);
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
          <div className="intro">
            <div>
              <h1>A clearer view of {paper.city}.</h1>
              <p>The decisions, the details and what they mean for our community.</p>
            </div>
            <span className="date" suppressHydrationWarning>
              {formatDate(new Date())}
            </span>
          </div>
          {lead ? (
            <section
              className={moreStories.length > 0 ? "hero" : "hero single"}
              aria-label="Featured story"
            >
              <article className="lead">
                <Link to="/" search={{ topic: lead.topic }} className={`tag ${lead.topic}`}>
                  {sections.find((s) => s.key === lead.topic)?.name ?? lead.topic} · THE LEAD
                </Link>
                <Link to="/articles/$slug" params={{ slug: lead.slug }}>
                  <h2>{lead.headline}</h2>
                </Link>
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
              {moreStories.length > 0 ? (
                <aside className="record">
                  <div>
                    <div className="topline">
                      <FileText aria-hidden /> Around the publication
                    </div>
                    <h3>
                      More of the story.
                      <br />
                      More of your community.
                    </h3>
                    <ol className="record-list">
                      {moreStories.map((s, i) => (
                        <li key={s.id}>
                          <span className="num">0{LATEST_END + i + 1}</span>
                          <div>
                            <Link to="/articles/$slug" params={{ slug: s.slug }}>
                              <strong>{s.headline}</strong>
                            </Link>
                            <p>{sections.find((t) => t.key === s.topic)?.name ?? s.topic}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <Link className="textlink" to="/" search={{ view: "archive" }}>
                    Explore the archive <ArrowRight aria-hidden />
                  </Link>
                </aside>
              ) : null}
            </section>
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
          <div className="content-grid">
            <section>
              <div className="sectionhead">
                <h2>The latest</h2>
                <Link className="textlink" to="/" search={{ view: "archive" }}>
                  All stories <ArrowRight aria-hidden />
                </Link>
              </div>
              {stories.slice(1, 6).map((s) => (
                <ReaderRow key={s.id} story={s} />
              ))}
              <Link className="btn more" to="/" search={{ view: "archive" }}>
                Explore the archive <ArrowRight aria-hidden />
              </Link>
            </section>
            <aside>
              <section className="sidebarcard">
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
              </section>
              <ReaderResources />
              <section className="sidebarcard">
                <span className="eyebrow">YOUR READING, YOUR WAY</span>
                <h2>A little easier on the eyes.</h2>
                <p>Adjust the type size or switch to a darker page.</p>
                <ReadingButton label />
              </section>
            </aside>
          </div>
          {featuredOpinion && (
            <section className="opinionband">
              <div className="sectionhead">
                <h2>Opinion</h2>
                <Link className="textlink" to="/" search={{ topic: "opinion" }}>
                  All opinion <ArrowRight aria-hidden />
                </Link>
              </div>
              <article className="opinionfeature">
                <div className="opinionmark" aria-hidden>
                  “
                </div>
                <div>
                  <span className="tag opinion">Perspective · Opinion</span>
                  <Link to="/articles/$slug" params={{ slug: featuredOpinion.slug }}>
                    <h3>{featuredOpinion.headline}</h3>
                  </Link>
                  <p>{featuredOpinion.dek}</p>
                </div>
                <Link className="btn" to="/articles/$slug" params={{ slug: featuredOpinion.slug }}>
                  Read opinion <ArrowRight aria-hidden />
                </Link>
              </article>
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
