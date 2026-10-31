import { Link } from "@tanstack/react-router";

export type MoreTopStory = {
  id: number;
  slug: string;
  number: number;
  kicker: string | null;
  kickerTopic: string | null;
  headline: string;
  meta: string;
};

/** The front page's numbered companion to the lead and its pair. */
export function MoreTopStories({ items }: { items: readonly MoreTopStory[] }) {
  if (!items.length) return null;
  return (
    <aside className="moretop" aria-labelledby="more-top-stories">
      <h2 id="more-top-stories">More top stories</h2>
      <ol>
        {items.map((story) => (
          <li key={story.id}>
            <span className="moretop-number" aria-hidden="true">
              {story.number}
            </span>
            <div>
              {story.kicker === null || story.kickerTopic === null ? (
                <span className="storysec" aria-hidden="true">
                  &nbsp;
                </span>
              ) : (
                <Link className="storysec" to="/" search={{ topic: story.kickerTopic }}>
                  {story.kicker}
                </Link>
              )}
              <h3>
                <Link to="/articles/$slug" params={{ slug: story.slug }}>
                  {story.headline}
                </Link>
              </h3>
              <span className="storymeta">{story.meta}</span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
