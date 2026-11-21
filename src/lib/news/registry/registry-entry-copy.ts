/**
 * The words an empty registry field uses (Scott, Nov 20 2026).
 *
 * Scott saw a card with a name and blank lines. Every field the source did not
 * state now says so in words, so a reader can tell "the page does not list this"
 * from "the desk failed to load it".
 */

/** A field the source page did not state. */
export const NOT_LISTED = "Not listed on the source page.";

/**
 * An entry that has no source page at all. Calling its empty fields "Not
 * listed on the source page" would be false -- there is no page to list them
 * (Scott, Nov 20 2026: "not recorded" is the truth).
 */
export const NOT_RECORDED = "Not recorded.";

/** A map link for an address, the same one every card uses. */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
