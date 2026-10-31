import { createElement } from "react";
import type { EventColumn, EventColumnKey } from "../../lib/news/events-week.ts";

const COLLAPSED_ITEMS = 2;

type Props = {
  column: EventColumn;
  expanded: boolean;
  listId: string;
  onToggle: (key: EventColumnKey) => void;
};

/** The one column body the front-page box and its markup test share. */
export function EventsWeekEventList({ column, expanded, listId, onToggle }: Props) {
  const visible = expanded ? column.items : column.items.slice(0, COLLAPSED_ITEMS);
  const hidden = Math.max(0, column.items.length - COLLAPSED_ITEMS);
  return createElement(
    "section",
    { className: "eventweek-col", "aria-label": column.label },
    createElement("h3", null, column.label),
    column.items.length
      ? createElement(
          "ul",
          { className: "eventweek-list", id: listId },
          visible.map((event) =>
            createElement(
              "li",
              { className: "eventweek-event", key: event.matchKey },
              createElement("span", { className: "eventweek-time" }, event.time),
              event.href
                ? createElement("a", { className: "eventweek-title", href: event.href }, event.title)
                : createElement("span", { className: "eventweek-title" }, event.title),
              event.description
                ? createElement("span", { className: "eventweek-description" }, event.description)
                : null,
              event.sourceName
                ? createElement(
                    "span",
                    { className: "eventweek-source" },
                    `From ${event.sourceName}`,
                  )
                : null,
              event.place
                ? createElement("span", { className: "eventweek-place" }, event.place)
                : null,
            ),
          ),
        )
      : null,
    hidden > 0
      ? createElement(
          "button",
          {
            type: "button",
            className: "eventweek-more",
            "aria-expanded": expanded,
            "aria-controls": listId,
            onClick: () => onToggle(column.key),
          },
          expanded ? "Show fewer" : `+ ${hidden} more`,
        )
      : null,
  );
}
