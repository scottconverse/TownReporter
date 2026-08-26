import { createMiddleware } from "@tanstack/react-start";

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
    await requireEditor(userId);
    return next({ context: { userId } });
  });
