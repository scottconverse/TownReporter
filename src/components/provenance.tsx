import { Link } from "@tanstack/react-router";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import { SourceCard } from "@/components/paper/source-card";
import type { ProvenanceItem } from "@/lib/news/findings";

/**
 * The record line under a card's title.
 *
 * The organization is the hostname for a source discovered from a URL
 * (`describeSourceUrl` in findings.ts sets it), and a real newsroom name when a
 * fetch found one. Printing both when they are the same string would read
 * "longmont.primegov.com · longmont.primegov.com", so the duplicate is dropped;
 * when they differ the reader gets the newsroom and its address, which is the
 * pair that lets them judge it.
 */
function hostOf(item: ProvenanceItem): string {
  const organization = item.organization.trim();
  let hostname = "";
  try {
    hostname = item.url ? new URL(item.url).hostname.replace(/^www\./i, "") : "";
  } catch {
    hostname = "";
  }
  if (!organization) return hostname;
  if (!hostname) return organization;
  const same =
    organization.toLowerCase().replace(/^www\./i, "") === hostname.toLowerCase();
  return same ? organization : `${organization} · ${hostname}`;
}

/**
 * "How we reported this" -- the evidence behind a story, as cards.
 *
 * Restyled into the handoff's 2-column card grid (`design-system/README.md`,
 * "Article page": a "Follow the evidence" kicker, source cards, and the
 * closing trust line). It is a restyle of a section that already existed, not
 * a replacement: every branch below -- the disappeared-source notice, the
 * citation with no page to open, View captured version, Compare versions -- is
 * the feature that was already here.
 *
 * The heading is a `<h2>` reading exactly "How we reported this" inside this
 * `<section>`. That is not decoration: `scripts/sources-reach-the-reader.mjs`
 * locates the block that way and asserts the story's own source is inside it,
 * because a check that searched the whole page passed against a build whose
 * source list was empty.
 *
 * It carries an `id` because the block is the `#sources` anchor itself (in
 * `articles.$slug.tsx`). It used to be wrapped in a `<section id="sources">`
 * that also held the AI disclosure; two walks read `#sources` for the heading,
 * so wrapping it again would put "How we reported this" inside two nested
 * sections and make the `section:has(h2:text-is(...))` locator ambiguous.
 *
 * The "What TownReporter found" appendix that used to close this block is
 * gone (unit DA2): the drawing has no such block, and every row it printed
 * was already a card above it -- its finding named the story's source URL and
 * its artifact version, which are the "Current source" and "View captured
 * version" actions of the card for that same record. Recorded as a DA2 line
 * in `design/SPEC-GAPS-0681.md`.
 */
export function ProvenanceBlock({
  id,
  items,
  form,
}: {
  id?: string;
  items: ProvenanceItem[];
  form?: string | null;
}) {
  const { formatDateTime, formatShortDate } = usePaperDateFormatters();
  if (!items.length) return null;
  return (
    <section className="evidence" id={id}>
      {form && form !== "reported" ? <p className="evidenceform">{form}</p> : null}
      <div className="evidencehead">
        <span className="kicker">Follow the evidence</span>
        <h2>How we reported this</h2>
      </div>
      <div className="sourcegrid">
        {items.map((item, index) => (
          <SourceCard
            key={item.url || `${item.title}-${index}`}
            role={item.role && item.role !== "source" ? item.role : "Source"}
            title={item.title}
            host={hostOf(item)}
            {...(item.document_date ? { documentDate: item.document_date } : {})}
            {...(item.captured_at ? { captured: formatDateTime(item.captured_at) } : {})}
            actions={
              <>
                {item.disappeared ? (
                  <p className="sourcecardnote">
                    Original source no longer available
                    {item.captured_at
                      ? ` — captured by TownReporter on ${formatShortDate(item.captured_at)}`
                      : " — captured by TownReporter"}
                    .
                  </p>
                ) : null}
                {!item.url ? (
                  /*
                    A citation, not a link. The report the story came from
                    named this document and nobody has a page for it; a
                    "Current source" pointing at nothing would be worse than
                    saying so.
                  */
                  <p className="sourcecardnote">
                    Named in the report we worked from — there is no page to open for this one.
                  </p>
                ) : null}
                {item.url && !item.disappeared ? (
                  <a href={item.url} className="sourcelink" target="_blank" rel="noreferrer">
                    Current source
                  </a>
                ) : null}
                {item.version_id != null ? (
                  <Link
                    to="/evidence/$versionId"
                    params={{ versionId: String(item.version_id) }}
                    className="sourcelink"
                  >
                    View captured version
                  </Link>
                ) : null}
                {item.url && (item.version_count ?? 0) > 1 ? (
                  <Link to="/evidence/compare" search={{ url: item.url }} className="sourcelink">
                    Compare versions
                  </Link>
                ) : null}
              </>
            }
          />
        ))}
      </div>
      <p className="trustline">
        Trust is verifiable. Check the official record before you act on a figure or a vote.
      </p>
    </section>
  );
}
