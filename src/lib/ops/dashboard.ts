import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "@/lib/news/desk-auth";
import { assertRate, audit } from "@/lib/news/ops";
import { isOpsActionId } from "./actions";
import type { OpsHealth } from "./health.server";
import type { OpsActionResult } from "./actions.server";

/**
 * The two calls the ops dashboard makes.
 *
 * Both sit behind `deskMiddleware`, which is the same gate as the rest of the
 * desk: signed in, a member of this newsroom, and a same-origin request. That
 * last part matters more here than anywhere else in the app — these run
 * commands on the machine, so a cross-site POST that rode the session cookie
 * would be a remote shell.
 *
 * `deskMiddleware` alone only proves newsroom membership (owner OR editor) —
 * it does not check role. Both handlers below are owner-only: `getOpsHealth`
 * reports the host's disk/ports/service state, and `runOpsAction` runs a
 * fixed PowerShell command on the operator's machine (including restarting
 * the app and the tunnel). Until 2026-09-02 the only gate on either was the
 * React page hiding the panel from a non-owner (`src/routes/desk.ops.tsx`),
 * which is not a security boundary. `assertOwner` is now the first line of
 * both handlers, the same as every other operator-power surface
 * (provider-login.ts, paper-settings.ts, provider-settings.ts, membership.ts).
 * An editor still sees the rest of the Server page; only these two calls are
 * refused for them.
 *
 * The server-only modules are imported inside the handlers so the client bundle
 * never sees `node:child_process`.
 */
export const getOpsHealth = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<OpsHealth> => {
    assertOwner(context.role);
    const { collectHealth } = await import("./health.server");
    return collectHealth();
  });

export const runOpsAction = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data }): Promise<OpsActionResult> => {
    assertOwner(context.role);
    /*
      Checked against the allowlist before anything else looks at it. The id is
      the only thing a caller controls, and after this line it is one of six
      known constants rather than a string.
    */
    if (!isOpsActionId(data)) {
      return { ok: false, id: String(data).slice(0, 40), output: "Unknown action." };
    }
    // Restarts and rebuilds are cheap to ask for and expensive to repeat.
    await assertRate(context.userId, "ops-action");
    const { runOpsActionById } = await import("./actions.server");
    const result = await runOpsActionById(data);
    await audit(context.userId, "ops", `${data} ${result.ok ? "ok" : "failed"}`);
    return result;
  });
