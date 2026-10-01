import { createAuthClient } from "better-auth/react";
import { runSignOut } from "../../../scripts/sign-out-plan.mjs";

/**
 * Better Auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*`. The session
 * is an HttpOnly, Secure `__Host-tr-auth.session_token` cookie on this origin;
 * no token is held in JS, and no request carries an `Authorization` header.
 *
 * To sign out call `signOut()` below, NOT `authClient.signOut()`: the sequence
 * that decides whether the server actually ended the session lives in
 * `scripts/sign-out-plan.mjs`, so a sign-out that never reached the server
 * reports failure rather than leaving the editor believing they left.
 */
export const authClient = createAuthClient({});

/**
 * True when sign-in UI should be shown — i.e. whenever `VITE_AUTH_ENABLED` is
 * not `"false"`. The shipped `.env.example` leaves it commented out, so
 * sign-in is real; setting it to `"false"` selects the dev user (see
 * `use-current-user`).
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/**
 * Sign out of THIS app's local session, then redirect.
 *
 * Use this, never `authClient.signOut()` — see the note on `authClient`.
 *
 * **Rejects when the server never confirms.** The session is an HttpOnly
 * cookie only the server can clear, so redirecting anyway would report a
 * sign-out that did not happen. `<UserButton />` handles that for you; a
 * hand-rolled control must catch it and let the visitor retry.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    // Better Auth resolves with `{ error }` instead of rejecting, so surface a
    // failed response as a rejection for the sequence to act on.
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}
