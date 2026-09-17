import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { signupOpenFor } from "@/lib/news/membership";
import { deskTakenLoginCopy } from "@/lib/news/desk-copy";

function isEmailSignUp(request: Request) {
  return /\/sign-up\/email\/?$/.test(new URL(request.url).pathname);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) => {
        /*
          The claimed-desk door, at the route. This used to be assertSignupOpen
          -- claimed means closed, full stop -- and it is why the first invite
          walk 403'd while every invite function tested green: the invite work
          (v0.5.3) opened the databaseHooks door in auth/server.ts, and THIS
          earlier gate in front of it knew nothing about invites. Both gates
          now ask the same question: may THIS address sign up right now? An
          unreadable body falls through to better-auth, whose hook asks again.
        */
        if (isEmailSignUp(request)) {
          let email = "";
          try {
            const body = (await request.clone().json()) as { email?: unknown };
            email = typeof body.email === "string" ? body.email : "";
          } catch {
            /* not JSON -- better-auth will reject it its own way */
          }
          if (email && !(await signupOpenFor(email))) {
            return Response.json({ message: deskTakenLoginCopy().api }, { status: 403 });
          }
        }
        return auth.handler(request);
      },
    },
  },
});
