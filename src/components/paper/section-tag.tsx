import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

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
 */
export function SectionTag({ children, topic }: { children: ReactNode; topic?: string }) {
  if (topic) {
    return (
      <Link className="sectiontag" to="/" search={{ topic }}>
        {children}
      </Link>
    );
  }
  return <span className="sectiontag">{children}</span>;
}
