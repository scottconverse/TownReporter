/**
 * Remembering that a search provider just refused us.
 *
 * The live defect this exists for: Scott pressed PULL three times on three
 * reporting lines, and every one of the three runs listed the SAME thirteen
 * failures -- Exa answered HTTP 429, DuckDuckGo answered SEARCH_BLOCKED, and
 * nine guessed pages were then fetched anyway. Each pull re-asked a provider
 * that had just told us to stop, which is both useless and rude, and is how a
 * rate limit turns into a block.
 *
 * A block is not like a timeout or a parse error: those say "this attempt
 * failed", while 429/SEARCH_BLOCKED says "this client, for a while". So only a
 * block starts a cooldown, and a provider that answers again clears its own.
 *
 * The store is process memory on purpose. A restart may re-ask once; that is a
 * far smaller thing than a table, a lock and a migration for a fact with a
 * ten-minute life. The clock is injectable so a test can move time instead of
 * sleeping through it.
 */

/** Default cooldown after a block, when the provider sends no `Retry-After`. */
export const SEARCH_COOLDOWN_MS = 10 * 60_000;

/** Ceiling on a provider's own `Retry-After`, so one header cannot stop search
 * for the rest of the day. */
export const SEARCH_COOLDOWN_MAX_MS = 30 * 60_000;

type Block = { startedAt: number; until: number };

const blocks = new Map<string, Block>();

let clock: () => number = () => Date.now();

/** Injectable clock. Pass null to go back to the wall clock. */
export function setSearchCooldownClock(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}

/** Forget every cooldown. Tests start here; nothing else calls it. */
export function clearSearchCooldowns(): void {
  blocks.clear();
}

/**
 * `Retry-After` in milliseconds: either a number of seconds or an HTTP date.
 * Null when the header is absent or unreadable -- a header we cannot read must
 * not become a cooldown we invented.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now = clock(),
): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** How long to wait: the provider's own answer when it gave one, capped. */
export function cooldownMsFor(retryAfterMs?: number | null): number {
  const asked = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? retryAfterMs
    : SEARCH_COOLDOWN_MS;
  return Math.min(SEARCH_COOLDOWN_MAX_MS, asked);
}

export function startSearchCooldown(
  provider: string,
  options: { retryAfterMs?: number | null } = {},
): void {
  const now = clock();
  blocks.set(provider, { startedAt: now, until: now + cooldownMsFor(options.retryAfterMs) });
}

/** A provider that answered clears its own cooldown. */
export function clearSearchCooldown(provider: string): void {
  blocks.delete(provider);
}

export function cooldownRemainingMs(provider: string, now = clock()): number {
  const block = blocks.get(provider);
  if (!block) return 0;
  return Math.max(0, block.until - now);
}

export function isCoolingDown(provider: string, now = clock()): boolean {
  return cooldownRemainingMs(provider, now) > 0;
}

/**
 * The run line's words for a provider being skipped: "blocked 3 minutes ago".
 *
 * Null when the provider is not cooling, so a caller can use the return value
 * as the whole decision.
 */
export function cooldownSkipNote(provider: string, now = clock()): string | null {
  const block = blocks.get(provider);
  if (!block || cooldownRemainingMs(provider, now) <= 0) return null;
  const minutes = Math.floor(Math.max(0, now - block.startedAt) / 60_000);
  if (minutes < 1) return "blocked just now";
  return `blocked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}
