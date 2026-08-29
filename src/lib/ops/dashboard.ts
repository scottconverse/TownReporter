import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "@/lib/news/desk-auth";
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
 * The server-only modules are imported inside the handlers so the client bundle
 * never sees `node:child_process`.
 */
export const getOpsHealth = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async (): Promise<OpsHealth> => {
    const { collectHealth } = await import("./health.server");
    return collectHealth();
  });

export const runOpsAction = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data }): Promise<OpsActionResult> => {
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
