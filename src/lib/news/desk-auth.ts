import { createMiddleware } from "@tanstack/react-start";
import { ForbiddenError } from "./membership.ts";

/**
 * Authenticated AND a newsroom member (owner/editor).
 * First user to hit the desk becomes owner; later identities are 403.
 */
export const deskMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    const { requireUserId } = await import("@/lib/auth/verify.server");
    const { requireEditor } = await import("./membership");
    assertSameSiteRequest();
    const userId = await requireUserId(context.bearerToken);
    const editor = await requireEditor(userId);
    return next({ context: { userId, newsroomId: editor.newsroomId, role: editor.role } });
  });

/**
 * Exported so a test can prove the refusal without standing up the framework.
 * Every owner-only server fn calls it as the first line of its `.handler`.
 * Lifted out of provider-login.ts (which still re-exports it, so its imports
 * and tests keep working) so every owner-gated surface shares one guard.
 */
export function assertOwner(role: string) {
  if (role !== "owner") {
    throw new ForbiddenError("Only the owner can do that.");
  }
}
