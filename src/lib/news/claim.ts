import { getRequest } from "@tanstack/react-start/server";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "../db.ts";
import {
  acceptInvite,
  checkInvite,
  claimOwner,
  createInvite,
  deskIsClaimed,
  readMyDesk,
  requireEditor,
  ForbiddenError,
  leaveAsEditor,
} from "./membership";
import { claimEmail, claimToken, recoveryCodeInput, setupCodeInput } from "./request-input.ts";
import { burnSetupCode, isSetupCodeRequired, verifySetupCode } from "./setup-code.ts";
import { generateRecoveryCodes, recoveryCodesRemaining, redeemRecoveryCode } from "./recovery-codes.ts";
import { createAccountLockout } from "@/lib/auth/account-lockout.server";
import { audit } from "./ops.ts";

/**
 * The IP the setup-code and recovery-code throttles key on -- same headers
 * `src/lib/auth/server.ts` already documents for the sign-in throttle
 * (`cf-connecting-ip` from the Cloudflare Tunnel edge, `x-forwarded-for` as
 * the fallback for any other front end). Neither caller here has a session
 * yet, so there is no user id to key on instead.
 */
function callerIp(): string {
  try {
    const headers = getRequest().headers;
    return (
      headers.get("cf-connecting-ip")?.trim() ||
      headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export const deskClaimState = createServerFn({ method: "GET" }).handler(async () => {
  // tokenRequired now answers for real (Unit CJ, 0.6.80): true only while a
  // fresh install has a pending, unconsumed setup code. An install that
  // already has an owner -- the live paper included -- never has one, so
  // this stays false there exactly as it always has.
  return { claimed: await deskIsClaimed(), tokenRequired: await isSetupCodeRequired() };
});

/** Signed-in visitor's desk role. Does not auto-claim. */
export const myDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => readMyDesk(context.userId));

export const claimDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  // Bounded at the boundary, then answered as text: `String(7)` used to
  // become a token lookup of "7"; now anything that is not a real token is ""
  // and the caller gets the same "that link is not valid" it always gave.
  .validator((token: unknown) => claimToken.parse(token))
  .handler(async ({ context }) => {
    try {
      const editor = await claimOwner(context.userId);
      return { ok: true as const, role: editor.role, newsroomId: editor.newsroomId };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }
  });

/**
 * Claim an unclaimed desk THROUGH the first-owner setup code (Unit CJ, 0.6.80).
 *
 * The one path allowed to claim while `isSetupCodeRequired()` is true:
 * verify the typed code (rate-limited, 5/15min per IP -- `setup-code.ts`),
 * and only on a match call `requireEditor(userId, { bypassSetupCodeGate: true
 * })`, which still runs the same one-transaction, index-backed claim
 * `claimOwner` always has. `burnSetupCode()` runs only AFTER that call
 * returns successfully, never merely for typing the code correctly -- if
 * `requireEditor` throws (this request lost the race to claim the desk), the
 * catch below turns it into a plain refusal and the code is left untouched,
 * so a caller who lost the race has not burned a code that never bought
 * anything.
 *
 * When no code is pending (`isSetupCodeRequired()` is false -- nothing to
 * verify, including every existing install with an owner already) this falls
 * straight through to the ordinary `claimOwner`, so it is safe to call
 * unconditionally from the login form regardless of which mode the desk is in.
 */
export const claimDeskWithCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((code: unknown) => setupCodeInput.parse(code))
  .handler(async ({ context, data: code }) => {
    try {
      if (await isSetupCodeRequired()) {
        const check = await verifySetupCode(code, callerIp());
        if (!check.ok) return { ok: false as const, error: check.reason };
        const editor = await requireEditor(context.userId, { bypassSetupCodeGate: true });
        await burnSetupCode();
        return { ok: true as const, role: editor.role, newsroomId: editor.newsroomId };
      }
      const editor = await claimOwner(context.userId);
      return { ok: true as const, role: editor.role, newsroomId: editor.newsroomId };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }
  });

/**
 * Give up the desk. Requires typing your own email address.
 *
 * This used to be a button in the header of every desk page, two positions from
 * "Sign out", behind one inline confirm. An audit walked it end to end: click,
 * confirm, and the newsroom is unclaimed -- at which point the next anonymous
 * visitor to /login owns the published archive, the Dark Desk investigation
 * files, the reporting notes, and the Server page that restarts services on the
 * journalist's own machine. There is no password reset, so the previous owner
 * had no route back from inside the product. The desk is reachable from the
 * internet through the tunnel. One misread word, and the paper is gone.
 *
 * Two changes, and this one is the load-bearing half: the RPC now refuses
 * unless the caller sends back the email address of the account it is signed in
 * as. A stray click cannot produce that string, and neither can a request the
 * operator did not deliberately compose. The other half -- moving the control
 * off the persistent header -- is in the interface, and an interface guard
 * alone would be a fence in front of an open door.
 *
 * Deliberately NOT a password prompt. This is a one-person newsroom and the
 * operator asked for less ceremony, not more. Typing your own address is the
 * same weight as the Delete confirmation, on an action that is far less
 * reversible.
 */
export const leaveEditor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((confirmEmail: unknown) => claimEmail.parse(confirmEmail))
  .handler(async ({ context, data: confirmEmail }) => {
    try {
      const sql = await getSql();
      const rows = await sql<{ email: string }>`
        select email from "user" where id = ${context.userId} limit 1
      `;
      const mine = rows[0]?.email?.trim().toLowerCase();
      const typed = confirmEmail.trim().toLowerCase();
      if (!mine || !typed || typed !== mine) {
        return {
          ok: false as const,
          error: "Type the email address you signed in with, exactly, to give up the desk.",
        };
      }
      await leaveAsEditor(context.userId);
      return { ok: true as const };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }
  });

/*
  Invites (v0.5.3). Owner mints a one-time link for a named address; the link
  opens the create-account door for exactly that address; accepting burns it
  and seats an editor, not an owner. Full mechanics in membership.ts.
*/
export const inviteEditor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((email: unknown) => claimEmail.parse(email))
  .handler(async ({ context, data: email }) => {
    try {
      const token = await createInvite(context.userId, email);
      return { ok: true as const, token };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
      throw err;
    }
  });

/** Anonymous: is this invite link live? Names only the invited address. */
export const inviteState = createServerFn({ method: "GET" })
  .validator((token: unknown) => claimToken.parse(token))
  .handler(async ({ data: token }) => checkInvite(token));

export const acceptEditorInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((token: unknown) => claimToken.parse(token))
  .handler(async ({ context, data: token }) => {
    try {
      const editor = await acceptInvite(context.userId, token);
      return { ok: true as const, role: editor.role };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
      throw err;
    }
  });

/*
  Owner recovery codes (Unit CJ, 0.6.80). Mechanics in recovery-codes.ts;
  this is the RPC boundary: owner-only for minting/counting, and the
  redemption call is the one deliberately-public exception (see the
  allowlist comment in `scripts/newsroom-security.test.mjs`) because the
  owner asking for it has, by definition, lost the ability to sign in.
*/

const recoveryRedeemAttempts = createAccountLockout({ maxAttempts: 5, windowSeconds: 900 });

/** Owner-only: mint a fresh set of 10 codes, invalidating the old set. */
export const regenerateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const me = await requireEditor(context.userId);
    if (me.role !== "owner") {
      throw new ForbiddenError("Only the owner can generate recovery codes.");
    }
    const codes = await generateRecoveryCodes(me.newsroomId);
    await audit(context.userId, "recovery-codes-regenerated", `${codes.length} new codes minted`, me.newsroomId);
    return { codes };
  });

/** Owner-only: how many of the current set are still unused. Never the codes themselves. */
export const myRecoveryCodesStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const me = await requireEditor(context.userId);
    if (me.role !== "owner") {
      throw new ForbiddenError("Only the owner can see recovery-code status.");
    }
    return { remaining: await recoveryCodesRemaining(me.newsroomId) };
  });

/**
 * Redeem a recovery code. Deliberately unauthenticated: this exists for the
 * owner who cannot sign in at all any more. Rate-limited by IP (5/15min,
 * same shape as the sign-in throttle in `account-lockout.server.ts`) before
 * the code is even looked up, so this cannot be used to grind the hash space.
 *
 * On success this does NOT sign the caller in -- it sets a fresh one-time
 * temporary password on the owner's account and hands it back once. The
 * owner still has to go sign in with it, same as they would with any
 * password, and is expected to change it from the desk afterward.
 */
export const redeemMyRecoveryCode = createServerFn({ method: "POST" })
  .validator((code: unknown) => recoveryCodeInput.parse(code))
  .handler(async ({ data: code }) => {
    const ip = callerIp();
    const decision = recoveryRedeemAttempts.check(ip);
    if (decision.blocked) {
      const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
      return { ok: false as const, error: `Too many attempts. Try again in about ${minutes} minute(s).` };
    }
    const result = await redeemRecoveryCode(code);
    if (!result.ok) {
      recoveryRedeemAttempts.recordFailure(ip);
      return { ok: false as const, error: result.reason };
    }
    recoveryRedeemAttempts.recordSuccess(ip);
    // The "recovery-code-used" audit event is written by `redeemRecoveryCode`
    // itself, in the same transaction as the burn and the password change
    // (review finding 2, Unit CR 0.6.81). Auditing here instead would put it
    // outside that transaction, where a failure could not be rolled back and
    // the owner would lose the desk the code was meant to recover.
    return { ok: true as const, tempPassword: result.tempPassword };
  });
