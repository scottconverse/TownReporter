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

/**
 * One entry's heading: the organization and the service (Nov 22 2026).
 *
 * A scan-created service hangs off an organization the scan created with the
 * same name, so a plain "organization — service" read "Community Pantry —
 * Community Pantry" on every card, heading and title. When the two names are
 * the same after trimming and ignoring case, the heading names the entry once;
 * any other pair is shown exactly as before.
 */
export function registryEntryHeading(organizationName: string, serviceName: string): string {
  const organization = organizationName.trim();
  const service = serviceName.trim();
  if (organization.toLowerCase() === service.toLowerCase()) {
    return organization || service;
  }
  return `${organizationName} — ${serviceName}`;
}
