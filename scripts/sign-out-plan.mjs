// @ts-check
/**
 * The sign-out sequence used by `src/lib/auth/client.ts`, kept here as a pure
 * module so its effects can be unit-tested (`node --test` only covers
 * `scripts/`), the same split `migration-plan.mjs` uses for the two appliers.
 *
 * The session rides an HttpOnly, Secure `__Host-tr-auth.session_token` cookie
 * that JS cannot delete, and `server.ts` enables `session.cookieCache`
 * (maxAge 300), so `/get-session` would keep answering from the cached cookie
 * for minutes afterwards. Only a completed sign-out response clears it.
 * Redirecting on a timeout would show the visitor "signed out" while their
 * session is still live — so a sign-out that was not confirmed fails loudly
 * instead of pretending.
 */

/**
 * How long a sign-out may take before it is reported as failed. Generous,
 * because only the server can end this session — but bounded, so a wedged
 * request reports a failure the visitor can retry instead of spinning forever.
 * A sign-out still unanswered at 10s is not going to land.
 */
export const SIGN_OUT_TIMEOUT_MS = 10_000;

/**
 * Run `start()` but give up after `timeoutMs`, reporting which happened. Never
 * rejects — callers decide what a failure means, and a `try/catch` around an
 * `await` does nothing for a promise that never settles.
 * @param {() => unknown} start
 * @param {number} timeoutMs
 * @returns {Promise<"ok" | "failed" | "timeout">}
 */
export function settleWithin(start, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    /** @param {"ok" | "failed"} outcome */
    const done = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    try {
      Promise.resolve(start()).then(
        () => done("ok"),
        () => done("failed"),
      );
    } catch {
      done("failed");
    }
  });
}

/**
 * @typedef {object} SignOutSteps
 * @property {() => unknown} requestSignOut Ask the server to end the session; must reject on a failed response.
 * @property {() => void} redirect Leave the page.
 * @property {number} [timeoutMs]
 */

/**
 * End the session, then redirect.
 *
 * The redirect happens only if the server confirmed, because nothing else can
 * clear the cookie — a failed or timed-out sign-out throws rather than
 * reporting a sign-out that did not happen.
 * @param {SignOutSteps} steps
 * @returns {Promise<void>}
 */
export async function runSignOut({ requestSignOut, redirect, timeoutMs }) {
  const outcome = await settleWithin(requestSignOut, timeoutMs ?? SIGN_OUT_TIMEOUT_MS);
  if (outcome !== "ok") {
    throw new Error(
      outcome === "timeout"
        ? "Sign-out timed out — you are still signed in. Please try again."
        : "Sign-out failed — you are still signed in. Please try again.",
    );
  }
  redirect();
}
