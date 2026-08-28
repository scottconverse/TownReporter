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
  newsroomSetupToken,
  SetupRequiredError,
} from "./membership";

export const deskClaimState = createServerFn({ method: "GET" }).handler(async () => {
  return {
    claimed: await deskIsClaimed(),
    tokenRequired: Boolean(newsroomSetupToken()),
  };
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
  .handler(async ({ context, data: token }) => {
    try {
      const editor = await claimOwner(context.userId, token);
      return { ok: true as const, role: editor.role, newsroomId: editor.newsroomId };
    } catch (err) {
      if (err instanceof SetupRequiredError || err instanceof ForbiddenError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }
  });

export const leaveEditor = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      await leaveAsEditor(context.userId);
      return { ok: true as const };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return { ok: false as const, error: err.message };
      }
      throw err;
    }
  });
