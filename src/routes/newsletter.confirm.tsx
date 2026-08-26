import { createFileRoute, Link } from "@tanstack/react-router";
import { confirmNewsletter } from "@/lib/news/public";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState } from "@/components/states";
import { inkSolid } from "@/components/desk-chrome";

export const Route = createFileRoute("/newsletter/confirm")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    if (!deps.token) return { ok: false as const };
    return confirmNewsletter({ data: deps.token });
  },
  component: ConfirmPage,
});

function ConfirmPage() {
  const res = Route.useLoaderData();
  return (
    <PaperShell compact>
      {res.ok ? (
        <EmptyState
          kicker="Newsletter"
          title="You’re confirmed"
          body="We’ll send new editions to that address. Nothing else."
          action={
            <Link to="/" className={inkSolid}>
              Back to the paper
            </Link>
          }
        />
      ) : (
        <EmptyState
          kicker="Newsletter"
          title="That link didn’t take"
          body="The confirmation is invalid or already used. Try subscribing from the front page again."
          action={
            <Link to="/" className={inkSolid}>
              Back to the paper
            </Link>
          }
        />
      )}
    </PaperShell>
  );
}
