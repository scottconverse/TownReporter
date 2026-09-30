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
  // `newsroomId` is kept in the signature: this map is drawn per paper, and a
  // provider that needed a per-newsroom connection (the removed SuperGrok
  // sign-in was one) is added here. Today every entry is environment-only.
  void newsroomId;
  await refreshLocalCatalog();
  return computeProviderAvailability();
}

export function getLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog();
}

export function refreshLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog(true);
}
