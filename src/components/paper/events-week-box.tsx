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
  type EventColumnKey,
  type EventsWeekData,
} from "@/lib/news/events-week";
import { EventsWeekEventList } from "./events-week-event-list.ts";

/** The front page's compact seven-day event box (design 1b). */
export function EventsWeekBox({ data }: { data: EventsWeekData }) {
  const paper = usePaper();
  const [selected, setSelected] = useState(0);
  const [expandedColumns, setExpandedColumns] = useState<EventColumnKey[]>([]);
  const [allExpanded, setAllExpanded] = useState(false);
  if (!data.days.length || !hasEvents(data.days)) return null;

  const index = Math.min(selected, data.days.length - 1);
  const day = data.days[index]!;
  const strip = weekStripItems(data.days);
  const columns = eventColumns(day.events, true);
  const today = index === 0;
  const storySlug = today ? data.todayStorySlug : null;

  const toggleColumn = (key: EventColumnKey) => {
    if (allExpanded) {
      setAllExpanded(false);
      setExpandedColumns(
        columns
          .filter((column) => column.key !== key && column.items.length > 2)
          .map((column) => column.key),
      );
      return;
    }
    setExpandedColumns((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };

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
              setExpandedColumns([]);
              setAllExpanded(false);
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
              <EventsWeekEventList
                key={column.key}
                column={column}
                expanded={allExpanded || expandedColumns.includes(column.key)}
                listId={`eventweek-${day.date}-${column.key}`}
                onToggle={toggleColumn}
              />
            ))}
          </div>
          <div className="eventweek-foot">
            {storySlug ? (
              <Link className="eventweek-all" to="/articles/$slug" params={{ slug: storySlug }}>
                All {eventCountLabel(day.events.length)} →
              </Link>
            ) : !allExpanded ? (
              <button
                className="eventweek-all"
                type="button"
                aria-expanded={allExpanded}
                onClick={() => {
                  setAllExpanded(true);
                  setExpandedColumns(columns.map((column) => column.key));
                }}
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
