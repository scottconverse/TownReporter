import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { isMiscTopic } from "@/lib/news/section-types";

/**
 * The yellow section label that sits over a lead or article headline.
 *
 * Ported from `design-system/components/paper/SectionTag.jsx` (the handoff is
 * the reference, not the file: the .jsx is a static prototype with inline
 * styles and a bare `#111` on yellow, and it is not importable here). The
 * markup is the same shape -- an inline-block that paints exactly its own text
 * box, so adding the tag never reflows the headline beside it.
 *
 * Yellow is a *fill* token, never a text one: on cream, `--a` is 1.42:1
 * against the page, which is why the label sits ON the yellow rather than in
 * it, and why the ink on it is fixed `#111` in both themes -- `--ink` flips to
 * bone in the dark theme, and bone on yellow is the one pairing the design
 * system rules out.
 *
 * `topic` makes the tag a link to that section's front-page listing. It is a
 * section *key* rather than an href so the tag goes through the router like
 * every other link on the paper; the label text is the caller's.
 *
 * `className` adds the article page's own `.tag` hook. The prototype keeps the
 * section tag inside the article's breadcrumb row (`design/Article
 * Daily.dc.html:29-31`: "Front page / <a background:var(--yel)>Housing"), and
 * a `.tag` class is what that markup carried before the redesign -- the browser
 * walks that import and paste a story read the section an editor chose from
 * `.articlehead .tag` (`scripts/import-stories-e2e.mjs:463`,
 * `scripts/paste-one-story-e2e.mjs:523`). It is a hook, not a style: `sectiontag`
 * already sets every declaration this element needs and still wins the `tag`
 * rules it does not set here.
 *
 * A "misc" topic renders NOTHING (unit BX): the catch-all is a filing
 * instruction rather than a part of the paper, and the reader side never shows
 * it. Every caller here is reader-facing (the lead, the article's breadcrumb),
 * so the suppression belongs in this one place. A caller that prints a
 * separator beside the tag must check `isMiscTopic` itself.
 */
export function SectionTag({
  children,
  topic,
  className,
}: {
  children: ReactNode;
  topic?: string;
  /** Extra classes for the element, e.g. the article head's `tag` hook. */
  className?: string;
}) {
  if (isMiscTopic(topic)) return null;
  const cls = className ? `sectiontag ${className}` : "sectiontag";
  if (topic) {
    return (
      <Link className={cls} to="/" search={{ topic }}>
        {children}
      </Link>
    );
  }
  return <span className={cls}>{children}</span>;
}
