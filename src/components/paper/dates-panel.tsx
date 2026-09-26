import { Link } from "@tanstack/react-router";

/**
 * One dated item, already split into the panel's two columns.
 *
 * `dow` and `day` are separate because the panel sets them at two sizes --
 * the weekday at 14/700 in yellow, the number at 24/800 in the block's ink.
 * `note` is the small line under the item ("6 p.m. per posted packet"), and
 * `cancelled` is the one row type the design system treats differently: it is
 * an item that will NOT happen, and a panel of dates that prints a
 * cancellation as if it were an event is worse than no panel.
 */
export type DateItem = {
  dow: string;
  day: string;
  what: string;
  note?: string;
  cancelled?: boolean;
  /**
   * The printed story this date came out of. A panel of dates with no way back
   * to the record is a list of claims, so when the caller knows the story the
   * item's text becomes the link to it; a row with no story stays plain text.
   */
  slug?: string;
};

/**
 * "This week" (front page) and "Dates in this story" (article).
 *
 * Ported from `design-system/components/paper/DatesPanel.jsx`. A block panel
 * -- warm-black ground in the light theme, warm-grey in the dark one -- with
 * yellow day labels, so the dates carry the page's accent and the items
 * themselves stay in the block's own ink.
 *
 * The prototype's `footLink` is a bare anchor to a calendar screen that does
 * not exist. It is accepted here as a router destination and rendered only
 * when a caller has somewhere real to send a reader; Unit BD does not, so no
 * "Full calendar →" is printed. The empty state is first-class for the same
 * reason: this panel reads dated items out of *published stories* only (owner
 * ruling, 2026-09-26), and a paper whose stories carry no future dates must
 * say so rather than pad the column.
 */
export function DatesPanel({
  title,
  items,
  footLink,
  empty,
}: {
  title: string;
  items: DateItem[];
  /** Where the panel's footer link goes, when the caller has a real one. */
  footLink?: { label: string; topic: string };
  /** What to print in place of the rows when there are none. */
  empty: string;
}) {
  return (
    <aside className="datespanel" aria-labelledby="datespanel-title">
      <h2 id="datespanel-title">{title}</h2>
      {items.length ? (
        <ol className="dateslist">
          {items.map((item, i) => (
            <li key={`${item.dow}-${item.day}-${i}`} className={item.cancelled ? "cancelled" : ""}>
              <span className="dateday">
                <b className="datedow">{item.dow}</b>
                <b className="datenum">{item.day}</b>
              </span>
              <span className="datewhat">
                {item.slug ? (
                  <Link to="/articles/$slug" params={{ slug: item.slug }}>
                    {item.what}
                  </Link>
                ) : (
                  <span>{item.what}</span>
                )}
                {item.note ? <span className="datenote">{item.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="datesempty">{empty}</p>
      )}
      {footLink && items.length ? (
        <Link className="dateslink" to="/" search={{ topic: footLink.topic }}>
          {footLink.label}
        </Link>
      ) : null}
    </aside>
  );
}
