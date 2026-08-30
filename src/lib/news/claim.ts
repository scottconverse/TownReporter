import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "../db.ts";
import {
  claimOwner,
  DEFAULT_NEWSROOM_ID,
  deskIsClaimed,
  ensureNewsroomSchema,
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
  .handler(async ({ context }) => {
    await ensureNewsroomSchema();
    const sql = await getSql();
    const mine = await sql<{ role: string; newsroom_id: number }>`
      select role, newsroom_id from newsroom_members where user_id = ${context.userId} limit 1
    `;
    const claimed = await deskIsClaimed();
    if (mine[0]?.role === "owner" || mine[0]?.role === "editor") {
      return {
        ok: true as const,
        role: mine[0].role as "owner" | "editor",
        newsroomId: mine[0].newsroom_id ?? DEFAULT_NEWSROOM_ID,
        claimed: true,
      };
    }
    return { ok: false as const, role: null, newsroomId: null, claimed };
  });

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
          error:
            "Type the email address you signed in with, exactly, to give up the desk.",
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
