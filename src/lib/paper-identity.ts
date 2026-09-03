/*
  The React-free half of the paper identity: the type, the shipped default,
  and the fallback logic. Pulled out of paper-context.tsx (which is .tsx,
  imports React, and cannot be loaded by node:test's plain --experimental-
  strip-types runner) so this pure logic can be unit-tested directly, the way
  every other pure helper in src/lib is (see paper.test.ts).

  Client-safe only -- no server/db import here, ever. See paper-context.tsx
  for why.
*/
import { PAPER, COUNCIL_VOTES_URL, EDITOR_EMAIL } from "./paper.ts";

export type PaperIdentity = {
  name: string;
  city: string;
  state: string;
  location: string;
  timezone: string;
  tagline: string;
  kicker: string;
  deck: string;
  trust: string;
  councilVotesUrl: string;
  /** Runtime-configurable editor contact address; falls back to the build-time EDITOR_EMAIL. */
  editorEmail: string | null;
};

/**
 * Same shape `defaultConfig()` in src/lib/news/paper-settings.ts builds from
 * PAPER -- duplicated here (not imported) because that module pulls in
 * src/lib/db.ts and must never reach the client bundle.
 */
export const DEFAULT_PAPER_IDENTITY: PaperIdentity = {
  name: PAPER.name,
  city: PAPER.city,
  state: PAPER.state,
  location: PAPER.location,
  timezone: PAPER.timezone,
  tagline: PAPER.tagline,
  kicker: PAPER.kicker,
  deck: PAPER.deck,
  trust: PAPER.trust,
  councilVotesUrl: COUNCIL_VOTES_URL,
  editorEmail: EDITOR_EMAIL,
};

/**
 * Coerce whatever the identity fetch produced into a real `PaperIdentity`,
 * never `undefined`/`null`.
 *
 * `<PaperContext.Provider value={undefined}>` overrides the context's own
 * `DEFAULT_PAPER_IDENTITY` default -- React only falls back to a context's
 * default when there is NO Provider above a consumer, not when a Provider
 * exists and explicitly passes `undefined`. So if the server-side identity
 * fetch ever resolves to `undefined` (a DB hiccup that doesn't throw, a
 * short-circuited server function, a stale/partial route context during a
 * client transition) without this coercion, every `usePaper()` /
 * `usePaperDateFormatters()` call downstream throws "Cannot destructure
 * property 'timezone' of undefined" and white-screens the public page. Call
 * this at every boundary where a fetched identity enters route context or a
 * `<PaperProvider>` value, not just one of them.
 */
export function resolvePaperIdentity(fetched: PaperIdentity | null | undefined): PaperIdentity {
  return fetched ?? DEFAULT_PAPER_IDENTITY;
}
