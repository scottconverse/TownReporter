/**
 * Phone numbers on the public Registry become tappable links (F18).
 *
 * The href carries digits only, as `tel:` expects: "(303) 441-3700" becomes
 * `tel:3034413700`. A value with no digits is not a phone number, so it stays
 * plain text rather than becoming a `tel:` link that dials nothing.
 */
export function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return digits ? `tel:${digits}` : null;
}
