/**
 * The five calls the Writing models panel makes.
 *
 * Same shape as src/lib/ops/dashboard.ts: `deskMiddleware` for signed-in,
 * newsroom-member, same-origin, and then an owner check on top. Starting a
 * sign-in spawns a process on this machine and takes a paper-wide login with
 * it — that is an owner action, the same as changing the paper's settings or
 * inviting an editor (savePaperConfig / createInvite both refuse a plain
 * editor), so it is refused the same way rather than merely hidden.
 *
 * The server-only module is imported inside each handler so the client bundle
 * never sees `node:child_process`.
 */
import { createServerFn } from "@tanstack/react-start";
import { assertOwner, deskMiddleware } from "./desk-auth.ts";
import { assertRate, audit } from "./ops.ts";
import type {
  ProviderId,
  ProviderLogin,
  ProviderStatus,
  ProviderTest,
} from "./provider-login.server.ts";

export type { ProviderId, ProviderLogin, ProviderStatus, ProviderTest };

/** Client-safe copy of the same predicate; the server module is not importable here. */
export function isProviderId(value: unknown): value is ProviderId {
  return value === "claude" || value === "codex";
}

/**
 * Re-exported so this file's own tests and any other importer keep working.
 * The guard itself now lives in desk-auth.ts (src/lib/ops/dashboard.ts uses
 * it too, and the two owner-only surfaces should share one implementation).
 */
export { assertOwner };

export const getProviderStatuses = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<ProviderStatus[]> => {
    assertOwner(context.role);
    const { providerStatuses } = await import("./provider-login.server.ts");
    return providerStatuses(context.newsroomId);
  });

export const startProviderLogin = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((provider: string) => provider)
  .handler(async ({ context, data }): Promise<ProviderLogin | { error: string }> => {
    assertOwner(context.role);
    if (!isProviderId(data)) return { error: "There is no such writing model." };
    /*
      Rated for the same reason the ops actions are: a page left open on a
      broken machine retries, and each retry is a spawned CLI holding a
      loopback listener. The cap is per hour, per editor.
    */
    await assertRate(context.userId, "provider-login");
    const mod = await import("./provider-login.server.ts");
    const row = await mod.startProviderLogin(data, context.newsroomId);
    await audit(context.userId, "provider-login", `${data} ${row.status}`);
    return row;
  });

export const pollProviderLogin = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data }): Promise<ProviderLogin | null> => {
    assertOwner(context.role);
    if (!Number.isInteger(data)) return null;
    const { pollProviderLogin: poll } = await import("./provider-login.server.ts");
    return poll(data, context.newsroomId);
  });

export const cancelProviderLogin = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data }): Promise<ProviderLogin | null> => {
    assertOwner(context.role);
    if (!Number.isInteger(data)) return null;
    const { cancelProviderLogin: cancel } = await import("./provider-login.server.ts");
    const row = await cancel(data, context.newsroomId);
    await audit(context.userId, "provider-login", `cancel ${data}`);
    return row;
  });

export const testProvider = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((provider: string) => provider)
  .handler(async ({ context, data }): Promise<ProviderTest | { error: string }> => {
    assertOwner(context.role);
    if (!isProviderId(data)) return { error: "There is no such writing model." };
    // A real model call, so it spends. Capped like every other spending action.
    await assertRate(context.userId, "provider-test");
    const { testProvider: run } = await import("./provider-login.server.ts");
    const result = await run(data);
    await audit(context.userId, "provider-test", `${data} ${result.ok ? "ok" : "failed"}`);
    return result;
  });
