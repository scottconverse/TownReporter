import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, FileText, Search } from "lucide-react";
import { PaperShell, ReaderResources } from "@/components/paper-chrome";
import { ReaderRow, SaveStory, ReadingButton } from "@/components/reader-controls";
import { useReader } from "@/components/reader-context";
import { ViewBeacon } from "@/components/view-beacon";
import { readerArticles } from "@/lib/news/reader-public";
import { readerSearch, readMinutes } from "@/lib/reader";
import { usePublicSections } from "@/lib/use-sections";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";

export const Route = createFileRoute("/")({
  validateSearch: readerSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    readerArticles({
      data: {
        q: deps.q,
        topic: deps.topic,
        page: deps.page ?? 1,
        oldest: deps.sort === "oldest",
        ...(deps.view === "saved" ? { saved: [] } : {}),
      },
    }),
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
    initialData: search.view === "saved" ? undefined : initial,
    enabled: search.view !== "saved" || reader.ready,
  });
  const opinion = useQuery({
    queryKey: ["reader-opinion"],
    queryFn: () => readerArticles({ data: { topic: "opinion", page: 1, oldest: false } }),
    enabled: !listing,
  });
  const data = query.data ?? initial;
  const stories = data.stories;
  const lead = stories[0];
  const featuredOpinion = opinion.data?.stories[0];
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
            <section className="hero" aria-label="Featured story">
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
                    {stories.slice(1, 4).map((s, i) => (
                      <li key={s.id}>
                        <span className="num">0{i + 1}</span>
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
