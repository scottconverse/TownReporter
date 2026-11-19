/**
 * The ways an editor can check an entry (the list migration 0166 allows), and
 * the plain words the public page uses for each. No server code here, so the
 * page and the desk can both import it.
 */

export const VERIFY_METHODS = [
  "phone",
  "website",
  "visit",
  "email",
  "document",
  "organization",
] as const;

export type VerifyMethod = (typeof VERIFY_METHODS)[number];

/** A check older than this many days puts the entry back on "Needs checking". */
export const VERIFY_AFTER_DAYS = 180;

const PUBLIC_WORDS: Record<VerifyMethod, string> = {
  phone: "by phone",
  website: "on its website",
  visit: "in person",
  email: "by email",
  document: "from a document",
  organization: "confirmed by the organization",
};

export function isVerifyMethod(value: unknown): value is VerifyMethod {
  return typeof value === "string" && (VERIFY_METHODS as readonly string[]).includes(value);
}

/** "by phone", "in person", ...; empty when the method is not one we know. */
export function verifyMethodWords(method: string | null | undefined): string {
  return isVerifyMethod(method) ? PUBLIC_WORDS[method] : "";
}
