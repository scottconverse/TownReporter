import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DeskShell } from "@/components/desk-chrome";
import { StoryBody } from "@/components/story-body";
import { getFiledReportingDraft } from "@/lib/news/desk";

export const Route = createFileRoute("/desk/filed-draft/$draftId")({
  head: () => ({ meta: [{ title: "Filed draft — TownReporter" }] }),
  component: FiledDraftPage,
});

function FiledDraftPage() {
  const { draftId } = Route.useParams();
  const query = useQuery({
    queryKey: ["filed-draft", Number(draftId)],
    queryFn: () => getFiledReportingDraft({ data: Number(draftId) }),
  });
  return (
    <DeskShell title="Draft this run filed" kicker="Reporting">
      {query.isPending ? (
        <p>Loading the filed draft…</p>
      ) : query.isError ? (
        <p>The filed draft could not be read.</p>
      ) : query.data ? (
        <>
          <p className="meta">
            Saved draft {query.data.id}. This view keeps the version the run filed.
          </p>
          <article>
            <h1>{query.data.headline}</h1>
            <p>{query.data.dek}</p>
            <StoryBody body={query.data.body} />
          </article>
          <Link
            to="/desk/story/$leadId"
            params={{ leadId: String(query.data.lead_id) }}
            className="inline-link"
          >
            Back to the story
          </Link>
        </>
      ) : (
        <p>This filed draft is no longer available.</p>
      )}
    </DeskShell>
  );
}
