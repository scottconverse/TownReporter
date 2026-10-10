/**
 * Pure newsletter constants. Safe to import from a client bundle: no DB, no
 * secrets, no server modules. `newsletter-store.server.ts` re-exports these so
 * server callers that already import them keep working.
 */

export const NEWSLETTER_DEFAULT_HOST = "imap.hostinger.com";
export const NEWSLETTER_DEFAULT_PORT = 993;
