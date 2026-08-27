import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { PaperShell, TopicChip } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { EditionSkeleton, EmptyState, FetchingRule } from "@/components/states";
import { inkGhost, inkSolid, inputClass } from "@/components/desk-chrome";
import {
  listPublishedArticles,
  listPublishedByTopic,
  searchPublished,
} from "@/lib/news/public";
import { PAPER, TOPICS, formatShortDate } from "@/lib/paper";

type Search = { topic?: string; q?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    topic: typeof s.topic === "string" ? s.topic : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ topic: search.topic, q: search.q }),
  loader: ({ deps }) => {
    if (deps.q) return searchPublished({ data: deps.q });
    if (deps.topic) return listPublishedByTopic({ data: deps.topic });
    return listPublishedArticles();
  },
  component: Home,
});

function Home() {
  const { topic, q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState(q ?? "");

  useEffect(() => {
    setQuery(q ?? "");
  }, [q]);

  const initial = Route.useLoaderData();
  const { data, isPending, isFetching, isPlaceholderData } = useQuery({
    queryKey: ["paper", topic, q],
    queryFn: () => {
      if (q) return searchPublished({ data: q });
      if (topic) return listPublishedByTopic({ data: topic });
      return listPublishedArticles();
    },
    initialData: initial,
    placeholderData: keepPreviousData,
  });
  const articles = data ?? initial;

  const featured = articles[0];
  const rest = articles.slice(1);
  const showSkeleton = isPending && !featured && !isPlaceholderData;
  const empty = !isPending && !isPlaceholderData && !featured;
  const dimming = isFetching && !showSkeleton;

  let emptyTitle = "The edition is still being set";
  let emptyBody =
    "No stories on the paper yet. The editor is working the desk — check back, or read how we report.";
  if (q) {
    emptyTitle = `Nothing matched “${q}”`;
    emptyBody = "Try a different word, or return to the full edition.";
  } else if (topic) {
    emptyTitle = `No ${topic} stories yet`;
    emptyBody =
      "That beat is quiet in this edition. See everything that has printed, or pick another topic.";
  }

  function clearSearch() {
    setQuery("");
    void navigate({ search: {} });
  }

  return (
    <PaperShell>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="chip-rail">
          <Link
            to="/"
            className={
              "pressable inline-flex min-h-11 shrink-0 items-center border px-3 text-[11px] tracking-[0.14em] uppercase transition-[background-color,color,border-color] duration-150 ease-out " +
              (!topic && !q
                ? "border-ink bg-ink text-paper"
                : "border-rule text-ink-2 hover:border-ink hover:text-ink")
            }
          >
            all
          </Link>
          {TOPICS.filter((t) => t !== "about").map((t) => (
            <TopicChip key={t} topic={t} active={topic === t} />
          ))}
        </div>
        <form
          className="flex min-h-11 flex-col gap-2 sm:flex-row"
          aria-label="Search the archive"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({
              search: { q: query.trim() || undefined, topic: undefined },
            });
          }}
        >
          <label className="relative block min-w-0 flex-1 sm:w-56 sm:flex-none">
            <span className="sr-only">Search the archive</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the archive"
              enterKeyHint="search"
              className={twMerge(inputClass, "w-full pl-10")}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={inkGhost + " flex-1 sm:flex-none"}>
              {isFetching && q ? "Searching…" : "Search"}
            </button>
            {q ? (
              <button
                type="button"
                onClick={clearSearch}
                className={inkGhost + " flex-1 sm:flex-none"}
              >
                Clear
              </button>
            ) : null}
          </div>
        </form>
      </div>
      {q ? (
        <p className="enter-fade-fast mb-3 text-sm text-muted">
          Archive search for “{q}”
        </p>
      ) : topic ? (
        <p className="enter-fade-fast mb-3 text-sm text-muted">
          Beat: {topic}
        </p>
      ) : null}
      <FetchingRule active={dimming} />

      {!topic && !q ? (
        <p className="enter-fade mb-6 max-w-2xl text-ink-2">{PAPER.deck}</p>
      ) : null}

      {showSkeleton ? (
        <div className="mt-6">
          <EditionSkeleton />
        </div>
      ) : null}

      {empty ? (
        <div className="mt-6">
          <EmptyState
            kicker={topic ?? (q ? "Archive" : "The paper")}
            title={emptyTitle}
            body={emptyBody}
            action={
              <>
                {(topic || q) && (
                  <Link to="/" search={{}} className={inkSolid}>
                    Full edition
                  </Link>
                )}
                <Link to="/how-we-report" className={inkGhost}>
                  How we report
                </Link>
              </>
            }
          >
            {q || topic ? (
              <div className="chip-rail justify-center">
                {TOPICS.filter((t) => t !== "about" && t !== topic)
                  .slice(0, 6)
                  .map((t) => (
                    <TopicChip key={t} topic={t} />
                  ))}
              </div>
            ) : null}
          </EmptyState>
        </div>
      ) : null}

      {featured && (
        <div className={dimming ? "is-fetching" : undefined}>
          <article className="stagger-in mt-6 border-b border-ink pb-10">
            <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
              {featured.topic} · {formatShortDate(featured.published_at)}
            </p>
            <h2 className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-5xl">
              <Link
                to="/articles/$slug"
                params={{ slug: featured.slug }}
                className="transition-[color] duration-150 ease-out hover:text-rust"
              >
                {featured.headline}
              </Link>
            </h2>
            <p className="mt-3 max-w-3xl text-lg italic text-ink-2">
              {featured.dek}
            </p>
            <div className="mt-6 max-w-2xl">
              <StoryBody
                body={featured.body.split("\n\n").slice(0, 2).join("\n\n")}
              />
              <Link
                to="/articles/$slug"
                params={{ slug: featured.slug }}
                className="group mt-4 inline-flex min-h-11 items-center gap-1 text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2"
              >
                Continue reading
                <ArrowRight
                  className="size-4 transition-transform duration-150 ease-out group-hover:translate-x-1"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </div>
          </article>

          {rest.length > 0 && (
            <div className="stagger-in mt-8 grid gap-8 sm:grid-cols-2">
              {rest.map((a) => (
                <article key={a.id} className="border-t border-rule pt-4">
                  <p className="text-[11px] tracking-[0.16em] text-muted uppercase">
                    {a.topic} · {formatShortDate(a.published_at)}
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-semibold leading-snug">
                    <Link
                      to="/articles/$slug"
                      params={{ slug: a.slug }}
                      className="transition-[color] duration-150 ease-out hover:text-rust"
                    >
                      {a.headline}
                    </Link>
                  </h3>
                  <p className="mt-2 text-ink-2">{a.dek}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      <section className="mt-14 border-t-2 border-ink pt-8">
        <h2 className="font-display text-2xl font-semibold">The paper is this site</h2>
        <p className="mt-2 max-w-xl text-ink-2">
          There is no email list yet. New stories appear on the front page and
          in the RSS feed when an editor publishes them.
        </p>
        <p className="mt-6 text-sm text-muted">
          {PAPER.name} complements the local paper. The public record is only
          the beginning.
        </p>
      </section>
    </PaperShell>
  );
}
