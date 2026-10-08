import { Link } from "@tanstack/react-router";
import { SecHead } from "./desk-chrome";
import type { JobProgressView } from "../lib/news/job-progress";
import { todayInProgressJobs, todayClosedLeadIds } from "../lib/news/today-in-progress";

// Keep the Today strip's selection and cards together so the editor sees only open story work.
export function TodayInProgress({ jobs, leads, isError, isPending, refetch }: {
  jobs: JobProgressView[];
  leads: { id: number; status: string; article_slug?: string | null }[];
  isError: boolean;
  isPending: boolean;
  refetch: () => unknown;
}) {
  const inProgress = todayInProgressJobs(jobs, todayClosedLeadIds(leads)).slice(0, 5);
  return (
    <section className="recent-story-work in-progress" aria-label="In progress">
      <SecHead
        title="In progress"
        count={inProgress.length}
        sub="Nothing here prints until you press Publish."
        aside={
          <Link to="/desk/drafts" className="np-link">
            All drafts
          </Link>
        }
      />
      {isError ? (
        <p role="alert">
          Recent drafts could not load.{" "}
          <button type="button" className="btn" onClick={() => void refetch()}>
            Try again
          </button>
        </p>
      ) : isPending ? (
        <p role="status">Loading your drafts…</p>
      ) : !inProgress.length ? (
        <p>No drafts started yet. Add your sources below to begin.</p>
      ) : (
        <div className="today-cards">
          {inProgress.map((story) => (
            /*
            The drawn card carries the stage in its 4px top rule: yellow
            while the desk is writing, ink once the draft is ready to
            edit, line for everything else (queued, or stopped with a
            reason). The stage is also in words, because the rule alone
            is a color and the desk never says a state in color only.
    
            FB1: this reads the one desk-jobs query now. The rows are the
            same rows (one per lead, the story kinds) -- only the reader
            changed, so the strip and the card above it cannot disagree.
            The headline falls back to the card title for a job whose
            drafts row has not been written yet.
          */
            <article
              className={
                "today-card " +
                (story.status === "running"
                  ? "live"
                  : story.status === "completed"
                    ? "mine"
                    : "idle")
              }
              key={story.id}
            >
              <span className="today-card-stage">
                {story.status === "completed"
                  ? "Ready to edit"
                  : story.status === "failed"
                    ? "Needs attention"
                    : story.status === "queued"
                      ? "Queued"
                      : "Writing in progress"}
              </span>
              <h3 className="today-card-hl">
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(story.leadId) }}
                  className="hl-link"
                >
                  {story.headline?.trim() || story.title}
                </Link>
              </h3>
              <p className="meta">
                {story.status === "completed"
                  ? "Draft saved. Review it before publishing."
                  : story.status === "failed"
                    ? "Open the story to see what stopped and resume."
                    : story.step || "Waiting to start"}
              </p>
              {/*
              One press, not two: the drawn card's "next action and
              Open" both land on the story page, and two buttons that go
              to the same place make the editor choose for nothing.
            */}
              <Link
                to="/desk/story/$leadId"
                params={{ leadId: String(story.leadId) }}
                className="btn"
              >
                {story.status === "running" || story.status === "queued"
                  ? "View progress"
                  : "Open draft"}
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
