/**
 * Gate every request on the boot-time schema warm-up (Unit CE, release
 * 0.6.80).
 *
 * `server/plugins/schema-warmup.ts` starts `getSchemaWarmupPromise()` as soon
 * as the built server's Nitro app is created, but Nitro does not await
 * plugins before it starts accepting connections (see that file's comment).
 * This is the piece that actually delivers "before it accepts requests":
 * numbered `00-` so Nitro's alphabetical middleware scan runs it before
 * `app-chrome.ts`, `canonical-host.ts` and `security-headers.ts`, and it
 * awaits the SAME shared promise the plugin started, so the normal case (the
 * warm-up already finished by the time the first request arrives) costs one
 * resolved-promise await, not a second warm-up run.
 *
 * A module that fails to warm does not block anything here -- `runSchemaWarmup`
 * already logs it and moves on; this middleware only waits for the whole
 * batch to finish attempting (success or failure per module), never rejects.
 */
import { getSchemaWarmupPromise } from "../../src/lib/schema-warmup.ts";

export default async function schemaWarmupGate(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  await getSchemaWarmupPromise().catch((err: unknown) => {
    // Only reachable if runSchemaWarmup itself threw outside its per-module
    // try/catch (e.g. getSql() never resolves) -- log once and let the
    // request through to fail on its own, the same as before this unit.
    console.error("[schema-warmup] warm-up run failed entirely; requests proceed unwarmed:", err);
  });
  return next();
}
