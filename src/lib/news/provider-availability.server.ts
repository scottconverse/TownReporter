import { PICKER_PROVIDER_IDS, providerEnabled } from "./provider-registry.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";

/** Compute machine readiness; this module is server-only because it reads env. */
export function computeProviderAvailability(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of PICKER_PROVIDER_IDS) out[id] = providerEnabled(id);
  return out;
}

export async function getProviderAvailability(
  newsroomId: number,
): Promise<Record<string, boolean>> {
  await refreshLocalCatalog();
  const availability = computeProviderAvailability();
  const status = await (await import("./xai-oauth.server.ts")).getXaiOauthStatus(newsroomId);
  availability["grok-oauth"] = availability["grok-oauth"] !== false && status.connected;
  return availability;
}

export function getLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog();
}

export function refreshLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog(true);
}
