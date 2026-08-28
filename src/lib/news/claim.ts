import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  claimOwner,
  deskIsClaimed,
  ForbiddenError,
  newsroomSetupToken,
  SetupRequiredError,
} from "./membership";

export const deskClaimState = createServerFn({ method: "GET" }).handler(async () => {
  return {
    claimed: await deskIsClaimed(),
    tokenRequired: Boolean(newsroomSetupToken()),
  };
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
