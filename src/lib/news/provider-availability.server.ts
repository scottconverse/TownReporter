import { readinessFailureMessage, type ProviderAvailability } from "./writer-bar.ts";
import { PICKER_PROVIDER_IDS, providerEnabled, providerEntry } from "./provider-registry.ts";
import { probeProvider, resolveProvider } from "./ai.ts";
import { refreshLocalCatalog, type LocalCatalog } from "./local-models.ts";
import { ollamaCloudWarning, pendingOllamaCloudCalls, recordOllamaCloudCall } from "./ollama-cloud-readiness.server.ts";

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
    resolveLocal?: () => Promise<{ baseUrl: string; id: string } | null>;
  } = {},
): Promise<ProviderAvailability> {
  await (deps.refreshLocalCatalog ?? refreshLocalCatalog)();
  const availability: ProviderAvailability = Object.assign(computeProviderAvailability(), { reasons: {} as Record<string, string> });
  availability.cloudWarnings = pendingOllamaCloudCalls().map(({ endpoint, model }) => ({ baseUrl: endpoint, id: model, reason: ollamaCloudWarning(endpoint, model)! }));
  for (const id of PICKER_PROVIDER_IDS) {
    if (!availability[id]) availability.reasons![id] = readinessFailureMessage(id, providerEntry(id)?.label ?? id, "This provider is not configured on this server.");
  }
  // The CLI off switch alone cannot tell whether Claude is signed in. Use
  // the same probe as draft preflight, including its API-key transport.
  const statusProbeIds = PICKER_PROVIDER_IDS.filter((id) => ["claude-code", "gemini-cli"].includes(providerEntry(id)?.kind ?? ""));
  const codexIds = PICKER_PROVIDER_IDS.filter((id) => providerEntry(id)?.kind === "codex");
  await Promise.all(statusProbeIds
    .map(async (id) => {
      const result = await (deps.probeProvider ?? probeProvider)(id, newsroomId, undefined, "story");
      availability[id] = result.ok;
      if (!result.ok) availability.reasons![id] = readinessFailureMessage(id, providerEntry(id)?.label ?? id, result.error);
      else delete availability.reasons![id];
    }));
  const codexProbeId = codexIds.find((id) => availability[id]);
  if (codexProbeId) {
    const result = await (deps.probeProvider ?? probeProvider)(codexProbeId, newsroomId, undefined, "story");
    for (const id of codexIds) {
      availability[id] = result.ok;
      if (!result.ok) availability.reasons![id] = readinessFailureMessage(id, providerEntry(id)?.label ?? id, result.error);
      else delete availability.reasons![id];
    }
  }
  // These are warnings, not preflight refusals. Inference still tries the
  // editor's selected model; catalog reads never erase a usage-limit receipt.
  for (const id of PICKER_PROVIDER_IDS.filter(id => id !== "local-model")) {
    const provider = resolveProvider(id);
    if (provider?.kind !== "openai") continue;
    const warning = ollamaCloudWarning(provider.baseUrl, provider.model);
    if (warning) { availability[id] = false; availability.reasons![id] = warning; }
  }
  if (pendingOllamaCloudCalls().length) {
    const local = await (deps.resolveLocal ?? (async () =>
      (await (await import("./provider-settings.ts")).resolveLocalModelChoice(newsroomId, "story")).override))();
    const fallback = resolveProvider("local-model");
    const pair = local ?? (fallback?.kind === "openai" ? { baseUrl: fallback.baseUrl, id: fallback.model } : null);
    const warning = pair ? ollamaCloudWarning(pair.baseUrl, pair.id) : undefined;
    if (warning) { availability["local-model"] = false; availability.reasons!["local-model"] = warning; }
  }
  return availability;
}

/** An explicit Test all press may spend one short completion on each model
 * with a retained cloud warning. Mere model listings cannot verify quota. */
export async function testOllamaCloudWarnings(fetcher: typeof fetch = fetch): Promise<void> {
  await Promise.all(pendingOllamaCloudCalls().map(async ({ endpoint, model }) => {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const provider = resolveProvider("deepseek-flash");
      const apiKey = provider?.kind === "openai" && provider.baseUrl === endpoint
        ? provider.apiKey : process.env.LLM_API_KEY;
      if (apiKey && apiKey !== "not-needed") headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetcher(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST", headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 64 }),
      });
      const text = await response.text();
      if (!response.ok) { recordOllamaCloudCall(endpoint, model, response.status, text, apiKey); return; }
      const body = JSON.parse(text) as { error?: unknown; choices?: { message?: { content?: string } }[] };
      if (body.error) recordOllamaCloudCall(endpoint, model, 500, body, apiKey);
      else if (body.choices?.[0]?.message?.content?.trim()) recordOllamaCloudCall(endpoint, model, response.status, "");
    } catch { /* Keep the last measured warning until a model answers. */ }
  }));
}

export function getLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog();
}

export function refreshLocalModelCatalog(): Promise<LocalCatalog> {
  return refreshLocalCatalog(true);
}
