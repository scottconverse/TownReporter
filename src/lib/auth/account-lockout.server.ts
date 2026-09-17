import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";

/**
 * Per-ACCOUNT sign-in lockout -- the backstop for when the network-address
 * throttle in `server.ts` cannot be trusted.
 *
 * That throttle buckets by `cf-connecting-ip` / `x-forwarded-for`, both of
 * which are ordinary request headers: Cloudflare overwrites them at its edge
 * for a real visitor, but they are plain client-supplied text to anything
 * that reaches the port directly (LAN, or a misconfigured `HOST`). A gate
 * audit measured it: 25 wrong passwords with one header value got 10
 * refusals then 15 blocks; the same 25 rotating the header through 25
 * values got 24 through to the password check. Rotating the header rotates
 * the bucket, and the bucket is the only thing standing guard.
 *
 * The email in the sign-in body is not something the caller can rotate their
 * way around -- it IS the thing being attacked. Every wrong guess against
 * "editor@example.com" counts against the same bucket no matter what address
 * or header sent it, so spraying requests from 25 different addresses buys
 * an attacker nothing here.
 *
 * Design choice for a single-account desk with no password reset: this is a
 * LOCKOUT, not a delay, and it blocks the correct password too once tripped
 * -- there is no way to verify a password is correct without checking it,
 * and checking it is exactly what an attacker uses as an oracle. The
 * tradeoff is real and deliberate: during an active attack the real
 * journalist cannot sign in either, for up to `windowSeconds`. What makes
 * that acceptable rather than a second outage is that it is bounded and
 * self-healing -- nobody has to notice, page anyone, or touch the database.
 * The lock anchors to the last COUNTED failure, and attempts made while
 * already locked do not extend it (see `recordFailure` below), so an
 * attacker who keeps knocking cannot hold the lock open forever; it always
 * clears `windowSeconds` after the failure that tripped it, attacker
 * cooperation or not. A correct sign-in clears it immediately.
 *
 * Storage is in memory, matching the network-address throttle's own
 * documented tradeoff in `server.ts`: bounded by how often the process
 * restarts, not by anything an attacker controls.
 */

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_SECONDS = 900;

/** Read a positive integer from an env var, or fall back to `fallback`. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Attempts allowed per account before the lock trips.
 *
 * Overridable via `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` / `ACCOUNT_LOCKOUT_WINDOW_SECONDS`
 * purely so tests can shrink the window instead of waiting 15 real minutes for
 * one to expire -- the production defaults (10 attempts / 15 minutes) are
 * deliberately conservative for a desk with no password reset, and nothing in
 * a normal deployment sets either variable.
 */
export function lockoutConfig(): { maxAttempts: number; windowSeconds: number } {
  return {
    maxAttempts: envInt("ACCOUNT_LOCKOUT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    windowSeconds: envInt("ACCOUNT_LOCKOUT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS),
  };
}

/** Trim + lowercase so "Editor@Example.com " and "editor@example.com" share a bucket. */
export function normalizeAccountKey(email: string): string {
  return email.trim().toLowerCase();
}

type Entry = { count: number; lastFailure: number };

export type LockoutClock = () => number;

export type LockoutDecision =
  | { blocked: false }
  | { blocked: true; retryAfterSeconds: number };

/**
 * The pure throttle: an in-memory map plus the rolling-window algorithm,
 * independent of Better Auth so it can be unit-tested directly (see
 * `account-lockout.server.test.ts`) without booting a server or a database.
 * `accountSignInLockout()` below is the thin adapter that wires this into
 * Better Auth's hook pipeline for the real app.
 */
export function createAccountLockout(options?: {
  maxAttempts?: number;
  windowSeconds?: number;
  clock?: LockoutClock;
}) {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const windowSeconds = options?.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const now: LockoutClock = options?.clock ?? Date.now;
  const store = new Map<string, Entry>();

  function windowExpired(entry: Entry): boolean {
    return now() - entry.lastFailure > windowSeconds * 1000;
  }

  /**
   * Would a request against `email` right now be let through to the password
   * check? Does NOT record anything -- call `recordFailure` / `recordSuccess`
   * once the real outcome is known.
   */
  function check(email: string): LockoutDecision {
    const key = normalizeAccountKey(email);
    const entry = store.get(key);
    if (!entry || windowExpired(entry)) return { blocked: false };
    if (entry.count < maxAttempts) return { blocked: false };
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(windowSeconds - (now() - entry.lastFailure) / 1000),
    );
    return { blocked: true, retryAfterSeconds };
  }

  /**
   * A wrong password reached the check. Starts a fresh window if the
   * previous one lapsed, otherwise increments it.
   *
   * Deliberately NOT called for a request `check()` already blocked -- an
   * already-tripped lock's `lastFailure` must stay anchored to the failure
   * that tripped it, or an attacker who keeps guessing through the block
   * would keep pushing the window forward and never let it expire. That
   * would turn a bounded, self-healing lock into an attacker-controlled
   * permanent one, which is precisely the outcome a single-account desk
   * with no password reset cannot afford.
   */
  function recordFailure(email: string): void {
    const key = normalizeAccountKey(email);
    const entry = store.get(key);
    if (!entry || windowExpired(entry)) {
      store.set(key, { count: 1, lastFailure: now() });
    } else {
      entry.count += 1;
      entry.lastFailure = now();
    }
  }

  /** The right password came through -- clear the bucket immediately. */
  function recordSuccess(email: string): void {
    store.delete(normalizeAccountKey(email));
  }

  return { check, recordFailure, recordSuccess, maxAttempts, windowSeconds };
}

/** One shared lockout for the real app -- the module-level default all requests hit. */
const sharedLockout = createAccountLockout(lockoutConfig());

/** True for the failure this plugin cares about: a rejected email/password check. */
function isSignInFailure(returned: unknown): boolean {
  return isAPIError(returned);
}

/**
 * The Better Auth plugin wiring `createAccountLockout` into `/sign-in/email`.
 *
 * `before` blocks an already-tripped account before Better Auth ever touches
 * the password hash. `after` reads the real outcome -- `ctx.context.returned`
 * is an `APIError` for a rejected credential, anything else for a session --
 * and records it, so only genuine wrong-password attempts count toward the
 * limit (a request already turned away by `before`, or by the network-level
 * throttle, never reaches `after` and cannot pad the count).
 */
export function accountSignInLockout(
  lockout: ReturnType<typeof createAccountLockout> = sharedLockout,
): BetterAuthPlugin {
  const isSignInEmail = (ctx: { path?: string }) => ctx.path === "/sign-in/email";

  return {
    id: "account-sign-in-lockout",
    hooks: {
      before: [
        {
          matcher: isSignInEmail,
          handler: createAuthMiddleware(async (ctx) => {
            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            if (typeof email !== "string" || !email) return;
            const decision = lockout.check(email);
            if (!decision.blocked) return;
            throw new APIError(
              429,
              {
                message:
                  "Too many failed sign-in attempts for this account. Try again later.",
                code: "ACCOUNT_LOCKED",
              },
              // Same header Better Auth's own network-address throttle stamps
              // on its 429s (see getRetryAfter in the rate-limiter source) --
              // matching it means a caller (or a test) doesn't need to know
              // which of the two layers actually blocked the request.
              { "X-Retry-After": String(decision.retryAfterSeconds) },
            );
          }),
        },
      ],
      after: [
        {
          matcher: isSignInEmail,
          handler: createAuthMiddleware(async (ctx) => {
            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            if (typeof email !== "string" || !email) return;
            // A request `before` blocks throws out of the hook pipeline before
            // the endpoint (and this `after` hook) ever runs, so this only
            // sees requests that actually reached a real password comparison
            // -- nothing here can double-count a block as a failure. The
            // `check()` guard is a defensive re-read against a concurrent
            // request for the same account tripping the lock in between this
            // request's `before` and `after` hooks; without it that request
            // could still be recorded as one more failure after the account
            // is already locked.
            if (lockout.check(email).blocked) return;
            if (isSignInFailure(ctx.context.returned)) {
              lockout.recordFailure(email);
            } else {
              lockout.recordSuccess(email);
            }
          }),
        },
      ],
    },
  };
}
