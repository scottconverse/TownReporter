import type { ReactNode } from "react";

/**
 * One "How we reported this" record card.
 *
 * Ported from `design-system/components/paper/SourceCard.jsx`. The card is
 * deliberately plain -- it is a record, and the reader is meant to read it,
 * not admire it -- so everything that could carry meaning is carried by type
 * and by the three underlined links.
 *
 * Those links are the provenance features that already existed on the article
 * page (View captured version, Compare versions, the correction form's
 * prefill): this is a *restyle* of them, not a replacement. A card with one
 * capture shows one link; a card with more shows the comparison. The caller
 * decides which exist and passes them already built, because the capture
 * routes are the article page's business, not this component's.
 *
 * The underline is 3px of `--a`: yellow under ink text on cream, which is a
 * decoration and not a signal, so the 1.42:1 yellow-on-cream rule that governs
 * text does not apply here. The link text itself stays `--ink`.
 */
export function SourceCard({
  role,
  title,
  host,
  captured,
  actions,
}: {
  role: string;
  title: string;
  host: string;
  captured?: string;
  actions: ReactNode;
}) {
  return (
    <div className="sourcecard-new">
      <span className="sourcerole">{role}</span>
      <b>{title}</b>
      <span className="sourcehost">
        {host}
        {captured ? ` · Captured ${captured}` : ""}
      </span>
      <div className="sourceactionrow">{actions}</div>
    </div>
  );
}
