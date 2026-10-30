import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePaper } from "@/lib/paper-context-state";
import {
  eventColumns,
  eventCountLabel,
  eventsWeekHeading,
  eventsWeekMeta,
  hasEvents,
  weekStripItems,
  weekdayName,
  type EventsWeekData,
} from "@/lib/news/events-week";

/** The front page's compact seven-day event box (design 1b). */
export function EventsWeekBox({ data }: { data: EventsWeekData }) {
  const paper = usePaper();
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  if (!data.days.length || !hasEvents(data.days)) return null;

  const index = Math.min(selected, data.days.length - 1);
  const day = data.days[index]!;
  const strip = weekStripItems(data.days);
  const columns = eventColumns(day.events, expanded);
  const today = index === 0;
  const storySlug = today ? data.todayStorySlug : null;

  return (
    <section className="eventweek" aria-labelledby="eventweek-title">
      <header className="eventweek-head">
        <div>
          <div className="eventweek-kicker">
            <span className="eventweek-chip">{today ? "TODAY" : "THIS WEEK"}</span>
            <span className="eventweek-meta">{eventsWeekMeta(day)}</span>
          </div>
          <h2 id="eventweek-title">{eventsWeekHeading(day, index, paper.city)}</h2>
        </div>
      </header>

      <div className="eventweek-strip" role="group" aria-label="Pick a day this week">
        {strip.map((item, i) => (
          <button
            key={data.days[i]!.date}
            type="button"
            className={i === index ? "eventweek-daybutton on" : "eventweek-daybutton"}
            aria-label={item.ariaLabel}
            aria-pressed={i === index}
            onClick={() => {
              setSelected(i);
              setExpanded(false);
            }}
          >
            <span className="eventweek-dow">{item.label}</span>
            <span className="eventweek-daynum">{item.dayNumber}</span>
            <span className="eventweek-count">{eventCountLabel(item.count)}</span>
          </button>
        ))}
      </div>

      {day.events.length ? (
        <>
          <div className="eventweek-grid">
            {columns.map((column) => (
              <section className="eventweek-col" key={column.key} aria-label={column.label}>
                <h3>{column.label}</h3>
                {column.items.length ? (
                  <ul className="eventweek-list">
                    {column.items.map((event) => (
                      <li className="eventweek-event" key={event.matchKey}>
                        <span className="eventweek-time">{event.time}</span>
                        <a className="eventweek-title" href={event.href}>
                          {event.title}
                        </a>
                        {event.place ? (
                          <span className="eventweek-place">{event.place}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {column.more > 0 ? (
                  <span className="eventweek-more">+ {column.more} more</span>
                ) : null}
              </section>
            ))}
          </div>
          <div className="eventweek-foot">
            {storySlug ? (
              <Link className="eventweek-all" to="/articles/$slug" params={{ slug: storySlug }}>
                All {eventCountLabel(day.events.length)} →
              </Link>
            ) : !expanded ? (
              <button
                className="eventweek-all"
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(true)}
              >
                All {eventCountLabel(day.events.length)} →
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="eventweek-empty">No events listed for {weekdayName(day.date)}.</p>
      )}
    </section>
  );
}
