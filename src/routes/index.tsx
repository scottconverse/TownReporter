import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PaperShell, TopicChip } from "@/components/paper-chrome";
import { StoryBody } from "@/components/story-body";
import { EditionSkeleton, EmptyState, FetchingRule } from "@/components/states";
import { inkGhost, inkSolid } from "@/components/desk-chrome";
import { ViewBeacon } from "@/components/view-beacon";
import {
  listPublishedArticles,
  listPublishedByTopic,
  searchPublished,
} from "@/lib/news/public";
import { TOPICS } from "@/lib/paper";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context";

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
  const PAPER = usePaper();
  const { formatShortDate } = usePaperDateFormatters();
  const { topic, q } = Route.useSearch();
  const initial = Route.useLoaderData();
  const { data, isPending, isFetching, isPlaceholderData, isError, refetch } = useQuery({
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
  /*
    A failed refresh must not leave the paper dimmed forever.

    `dimming` was driven by isFetching alone and the error branch was never
    consumed, so a rejected query left already-printed stories visually
    disabled with no explanation and no way back. An audit called it a
    permanent dead end (UIUX-02). Stale stories are still worth reading; the
    honest thing is to show them at full strength and say the refresh failed.
  */
  const dimming = isFetching && !isError && !showSkeleton;

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

  return (
    <PaperShell>
      <ViewBeacon targets={["site"]} />
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
        {/*
          The archive search lives in the top bar now, as a magnifying glass.

          It used to sit here permanently, taking a row of the paper's most
          valuable space to serve the thing readers do least often — and only on
          this page. As a glass it is one click from every page, and the front
          page gets the room back for stories.
        */}
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
      {isError ? (
        <p role="alert" className="mb-6 border border-danger/35 bg-paper-2 px-3 py-2.5 text-sm text-danger">
          The paper could not refresh. What is below is the last version that
          loaded.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Try again
          </button>
        </p>
      ) : null}

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
