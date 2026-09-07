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
  ForbiddenError,
  leaveAsEditor,
} from "./membership";

export const deskClaimState = createServerFn({ method: "GET" }).handler(async () => {
  // tokenRequired stays in the shape, always false: the setup token is gone
  // (see membership.ts). Kept so an older client bundle cannot crash on a
  // missing field mid-deploy.
  return { claimed: await deskIsClaimed(), tokenRequired: false };
});

/** Signed-in visitor's desk role. Does not auto-claim. */
export const myDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => readMyDesk(context.userId));

export const claimDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((token: string) => String(token ?? ""))
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
  .validator((confirmEmail: unknown) => String(confirmEmail ?? ""))
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
  .validator((email: unknown) => String(email ?? ""))
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
  .validator((token: unknown) => String(token ?? ""))
  .handler(async ({ data: token }) => checkInvite(token));

export const acceptEditorInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((token: unknown) => String(token ?? ""))
  .handler(async ({ context, data: token }) => {
    try {
      const editor = await acceptInvite(context.userId, token);
      return { ok: true as const, role: editor.role };
    } catch (err) {
      if (err instanceof ForbiddenError) return { ok: false as const, error: err.message };
      throw err;
    }
  });
