import { createFileRoute, Link } from "@tanstack/react-router";
import { PaperShell } from "@/components/paper-chrome";
import { EmptyState } from "@/components/states";
import { inkSolid } from "@/components/desk-chrome";

export const Route = createFileRoute("/newsletter/confirm")({
  component: ConfirmPage,
});

function ConfirmPage() {
  return (
    <PaperShell compact>
      <EmptyState
        kicker="The paper"
        title="There is no email list yet"
        body="TownReporter does not mail editions. Stories live on the paper when an editor publishes them."
        action={
          <Link to="/" className={inkSolid}>
            Back to the paper
          </Link>
        }
      />
    </PaperShell>
  );
}
