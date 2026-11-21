/**
 * Whether a proposal carries anything an editor can check (Scott, Nov 20 2026).
 *
 * The scan used to be able to store a change that named an entity and nothing
 * else -- no old value, no new value, no sentence, no quote -- and the desk
 * drew a card with a name and blank lines. The scan now refuses to store one
 * (see `changeHasFact` in `scan-changes.server.ts`), and this reader lets the
 * desk say so plainly about a proposal that was stored before that fix.
 */

/** The words the desk shows on a proposal with nothing in it. */
export const NO_FACTS_TEXT = "This proposal has no facts. Reject it.";

export function proposalHasFacts(change: {
  beforeValue: string | null;
  afterValue: string | null;
  summary?: string | null;
  quote?: string | null;
}): boolean {
  return [change.beforeValue, change.afterValue, change.summary, change.quote].some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}
