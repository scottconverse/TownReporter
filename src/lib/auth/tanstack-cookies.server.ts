import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";

/**
 * Hand Better Auth's `Set-Cookie` to TanStack Start's cookie store.
 *
 * This is the stock `tanstackStartCookies()` plugin, minus the way it fails.
 * The stock one does:
 *
 *   const { setCookie } = await import("@tanstack/react-start/server")
 *
 * outside a `try`. When that import resolves to nothing (Vite SSR, or no
 * StartEvent in scope), the throw propagates out of `getSession` and Redraft
 * dies even though the editor is perfectly well signed in. Same job here,
 * never throws: if the module or the export is missing the plugin simply
 * returns, the cookies stay on `responseHeaders`, and the request carries on.
 *
 * Registered LAST in `server.ts`'s `plugins` array so it runs after every
 * other plugin's hooks have finished appending to that header.
 */
export function safeTanstackStartCookies() {
  return {
    id: "tanstack-start-cookies",
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.responseHeaders;
            if ("_flag" in ctx && ctx._flag === "router") return;
            if (!(returned instanceof Headers)) return;
            const header = returned.get("set-cookie");
            if (!header) return;
            let setCookie: ((name: string, value: string, opts?: object) => void) | undefined;
            try {
              const mod = await import("@tanstack/react-start/server");
              if (typeof mod.setCookie === "function") setCookie = mod.setCookie;
            } catch {
              return;
            }
            if (!setCookie) return;
            const parsed = parseSetCookieHeader(header);
            parsed.forEach((value, key) => {
              if (!key) return;
              try {
                setCookie(key, value.value, toCookieOptions(value));
              } catch {
                /* cookie still sits on responseHeaders */
              }
            });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
