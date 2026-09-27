import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * A front-page story cell, and the ruled grid the cells sit in.
 *
 * Ported from `design-system/components/paper/StoryCell.jsx`. The grid is not
 * a `gap`: the 1px lines between cells are the `--grid` background showing
 * through a 1px gap, and the cells paint their own `--bg` on top. That is how
 * the paper gets rules that stop at the cell edge instead of a border on every
 * cell doubling to 2px where two meet.
 *
 * `section` is the resolved display name, never the stored key: sections come
 * from `newsroom_sections` (`0045_configurable_sections.sql`) and a paper can
 * rename one at any time. Callers resolve with `usePublicSections`, which is
 * what `index.tsx` already does for every other section label.
 */
export function StoryCell({
  section,
  title,
  date,
  read,
  slug,
  topic,
}: {
  section: string;
  title: string;
  date: string;
  read: string;
  slug: string;
  topic?: string;
}) {
  return (
    <article className="storycell">
      {topic ? (
        <Link className="storysec" to="/" search={{ topic }}>
          {section}
        </Link>
      ) : (
        <span className="storysec">{section}</span>
      )}
      <h3>
        <Link to="/articles/$slug" params={{ slug }}>
          {title}
        </Link>
      </h3>
      <span className="storymeta">
        {date} · {read} read
      </span>
    </article>
  );
}

/**
 * The ruled grid the cells sit in.
 *
 * `columns` is the desktop count; the stylesheet collapses it to one column on
 * a phone so the front page's top grid goes 3-across, then 2, then 1 without
 * the caller having to know the breakpoints.
 */
export function StoryGrid({ children, columns = 3 }: { children: ReactNode; columns?: number }) {
  return (
    <div className={`storygrid cols-${columns}`}>{children}</div>
  );
}
