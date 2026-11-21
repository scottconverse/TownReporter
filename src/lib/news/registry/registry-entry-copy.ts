/**
 * The words an empty registry field uses (Scott, Nov 20 2026).
 *
 * Scott saw a card with a name and blank lines. Every field the source did not
 * state now says so in words, so a reader can tell "the page does not list this"
 * from "the desk failed to load it".
 */

/** A field the source page did not state. */
export const NOT_LISTED = "Not listed on the source page.";

/** An entry whose own source page was never recorded. */
export const NO_SOURCE = "No source page recorded.";

/** A map link for an address, the same one every card uses. */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
