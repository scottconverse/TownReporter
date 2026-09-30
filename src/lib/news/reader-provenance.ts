import { canonicalPublicUrl } from "./fetch-outcome.ts";
import type { ProvenanceItem } from "./findings.ts";

/**
 * The reader's "How we reported this" list: how a story's sources are ordered
 * and deduplicated on the public page.
 *
 * WHY THIS IS ITS OWN MODULE. This rule lived inline in `articles.$slug.tsx`,
 * where nothing could test it and where it compared URLs as raw strings. It is
 * a decision about what a reader is shown -- and, since unit U11b2, about
 * whether a link an owner removed can come back -- so it belongs in a `.ts`
 * file a test can drive, the same shape as `check-gates.ts`,
 * `evidence-check-list.ts` and `finding-evidence-display.ts` beside it.
 */

/**
 * The same source is one source, however its URL is spelled.
 *
 * `canonicalPublicUrl` is the identity retrieval stores captures under and the
 * evidence page resolves them with: it lowercases the host, drops the fragment
 * and the tracking parameters, and trims a trailing slash. Comparing raw
 * strings here meant a story whose provenance held
 * `https://records.example.test/agenda` and whose `source_urls` held the same
 * address with a trailing slash printed that source TWICE: once as the record
 * card -- which may carry "the link was removed at the publisher's request" --
 * and once as a bare URL card with a live "Current source" link, handing back
 * on the same page exactly the link the owner removed.
 *
 * A URL that cannot be parsed is its own identity, which is what it was before
 * this existed.
 */
export function sourceIdentity(url: string): string {
  try {
    return canonicalPublicUrl(url);
  } catch {
    return url;
  }
}

/**
 * Records first, then the cited URLs they do not already name.
 *
 * Every URL the story cites reaches "Sources & public records", including the
 * ones the provenance records do not cover: this used to be either/or, so a
 * story with any provenance record printed those and silently dropped the rest
 * of its `source_urls`. A meeting story is exactly the shape that broke -- it
 * is written from a recording, so its one source is the video, and a single
 * captured document anywhere in the story was enough to hide it.
 *
 * The records themselves are passed through untouched, flags and all: a
 * taken-down capture's `excerpt_removed` / `excerpt_removed_link_kept` are what
 * `ProvenanceBlock` renders the card from (unit U11b2).
 */
export function readerProvenanceItems(
  recorded: readonly ProvenanceItem[],
  sources: readonly string[],
): ProvenanceItem[] {
  const named = new Set(recorded.map((item) => sourceIdentity(item.url)).filter(Boolean));
  return [
    ...recorded,
    ...sources
      .filter((url) => !named.has(sourceIdentity(url)))
      .map((url) => ({
        title: url,
        organization: "",
        document_date: "",
        url,
        captured_at: null,
        version_id: null,
        version_count: null,
        capture_event_id: null,
        disappeared: false,
        role: "source",
      })),
  ];
}
