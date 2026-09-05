import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth.ts";
import { PICKER_PROVIDER_IDS, providerEnabled } from "./provider-registry.ts";

/**
 * Per-machine readiness for every picker-offered provider.
 *
 * `provider-registry.ts`'s `enabled()` reads `process.env` -- that has to
 * run on the server. `model-choice.ts`'s `STORY_MODEL_CHOICES` etc. are
 * computed once at module load and shared by both the server and the
 * browser bundle (`model-picker.tsx` is a plain client component), so they
 * cannot carry a live `enabled` flag without leaking env-dependent state
 * into a constant that a browser evaluates with no environment at all.
 *
 * This is the one function that crosses that boundary: the picker calls the
 * exported server function below (over the same `createServerFn` transport
 * every other desk mutation uses) instead of ever calling `entry.enabled()`
 * itself. Before this existed, the picker rendered every `PROVIDER_REGISTRY`
 * entry as a plain, always-selectable `<option>` regardless of `enabled()` --
 * `providersFor()` (provider-registry.ts) filters by `offeredFor[surface]`
 * only, never by readiness -- so "Local model" showed up and could be
 * chosen with `LLM_BASE_URL` unset, and the draft it started could only fail
 * (owner report 2026-09-05).
 */
export function computeProviderAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of PICKER_PROVIDER_IDS) {
    // `providerEnabled` (no per-paper overrides passed) is exactly
    // `entry.enabled()` -- the machine-level check -- reused rather than
    // re-derived, so this and the Server settings page
    // (`provider-settings.ts`'s `availableOnThisMachine`) can never read
    // "enabled" two different ways.
    out[id] = providerEnabled(id);
  }
  return out;
}

export const providerAvailability = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async () => computeProviderAvailability());
