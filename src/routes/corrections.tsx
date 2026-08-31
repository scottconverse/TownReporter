import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, ListSkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { listPublicCorrections } from "@/lib/news/public";
import { EDITOR_EMAIL } from "@/lib/paper";
import { DEFAULT_PAPER_IDENTITY, usePaperDateFormatters } from "@/lib/paper-context";

export const Route = createFileRoute("/corrections")({
  /*
    Its own title. Every standing page shared the site's title, so a reader with
    the paper open in several tabs could not tell them apart, and search results
    listed them all under one name.
  */
  head: ({ match }) => ({
    meta: [{ title: `Corrections — ${(match.context.paper ?? DEFAULT_PAPER_IDENTITY).name}` }],
  }),
  component: Corrections,
});

function Corrections() {
  const { formatShortDate } = usePaperDateFormatters();
  const { data: items = [], isPending } = useQuery({
    queryKey: ["corrections"],
    queryFn: () => listPublicCorrections(),
  });
  return (
    <PaperShell compact>
      <h1 className="enter-fade font-display text-4xl font-semibold">
        Corrections
      </h1>
      <p className="enter-rise mt-4 max-w-2xl text-lg text-ink-2">
        If we got it wrong, it lives here in the open — not buried in a rewrite
        nobody sees. Corrections also appear on the story itself.
        {EDITOR_EMAIL ? (
          <>
            {" "}To flag an error, write the editor at{" "}
            <a className="text-rust underline" href={`mailto:${EDITOR_EMAIL}`}>
              {EDITOR_EMAIL}
            </a>
            .
          </>
        ) : null}
      </p>
      {isPending ? (
        <div className="mt-8 max-w-2xl">
          <ListSkeleton rows={3} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 max-w-2xl">
          <EmptyState
            kicker="The record"
            title="No corrections posted"
            body="Nothing to walk back yet. If you spot an error, write the desk — we would rather look careful than look first."
            action={
              <Link to="/" className={inkGhost}>
                Back to the paper
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="stagger-in mt-8 max-w-2xl space-y-6">
          {items.map((c) => (
            <li key={c.id} className="border-t border-rule pt-4">
              <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                {formatShortDate(c.created_at)}
                {c.headline ? ` · ${c.headline}` : ""}
              </p>
              <p className="mt-2 text-ink-2">{c.body}</p>
              {c.slug ? (
                <p className="mt-2">
                  <Link
                    to="/articles/$slug"
                    params={{ slug: c.slug }}
                    className="text-sm text-muted hover:text-ink"
                  >
                    Read the story
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PaperShell>
  );
}
