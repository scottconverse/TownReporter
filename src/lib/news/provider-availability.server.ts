import { readinessFailureMessage, type ProviderAvailability } from "./writer-bar.ts";
import { PICKER_PROVIDER_IDS, providerEnabled, providerEntry } from "./provider-registry.ts";
import { probeProvider } from "./ai.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";

/** Compute machine readiness; this module is server-only because it reads env. */
export function computeProviderAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of PICKER_PROVIDER_IDS) out[id] = providerEnabled(id);
  return out;
}

export async function getProviderAvailability(
  newsroomId: number,
  deps: {
    probeProvider?: typeof probeProvider;
    refreshLocalCatalog?: () => Promise<unknown>;
  } = {},
): Promise<ProviderAvailability> {
  await (deps.refreshLocalCatalog ?? refreshLocalCatalog)();
  const availability: ProviderAvailability = Object.assign(computeProviderAvailability(), { reasons: {} as Record<string, string> });
  for (const id of PICKER_PROVIDER_IDS) {
    if (!availability[id]) availability.reasons![id] = readinessFailureMessage(id, providerEntry(id)?.label ?? id, "This provider is not configured on this server.");
  }
  // The CLI off switch alone cannot tell whether Claude is signed in. Use
  // the same probe as draft preflight, including its API-key transport.
  await Promise.all(PICKER_PROVIDER_IDS.filter((id) => providerEntry(id)?.kind === "claude-code")
    .map(async (id) => {
      const result = await (deps.probeProvider ?? probeProvider)(id, newsroomId, undefined, "story");
      availability[id] = result.ok;
      if (!result.ok) availability.reasons![id] = readinessFailureMessage(id, providerEntry(id)?.label ?? id, result.error);
      else delete availability.reasons![id];
    }));
  return availability;
}

export function getLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog();
}

export function refreshLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog(true);
}
