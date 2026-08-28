import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { assertSignupOpen, ForbiddenError } from "@/lib/news/membership";
import { deskTakenLoginCopy } from "@/lib/news/desk-copy";

function isEmailSignUp(request: Request) {
  return /\/sign-up\/email\/?$/.test(new URL(request.url).pathname);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) => {
        if (isEmailSignUp(request)) {
          try {
            await assertSignupOpen();
          } catch (err) {
            const message =
              err instanceof ForbiddenError ? err.message : deskTakenLoginCopy().api;
            return Response.json({ message }, { status: 403 });
          }
        }
        return auth.handler(request);
      },
    },
  },
});
