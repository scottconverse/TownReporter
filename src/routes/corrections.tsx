import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState, ListSkeleton } from "@/components/states";
import { inkGhost } from "@/components/desk-chrome";
import { listPublicCorrections } from "@/lib/news/public";
import { formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/corrections")({
  component: Corrections,
});

function Corrections() {
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
        nobody sees.
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
            </li>
          ))}
        </ul>
      )}
    </PaperShell>
  );
}
