import { providerErrorDetail } from "./provider-error-detail.ts";

// Catalog discovery is not a model call: only completed inference can clear
// a provider's usage failure. The map deliberately has no time-based expiry.
const warnings = new Map<string, { endpoint: string; model: string; words: string }>();
function endpointKey(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/(?:v1|api)$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch { return endpoint.trim().replace(/\/+$/, ""); }
}
function key(endpoint: string, model: string): string {
  return JSON.stringify([endpointKey(endpoint), model.trim()]);
}
export function isOllamaCloudCall(endpoint: string, model: string): boolean {
  if (/(?:[:.-])cloud$/i.test(model.trim())) return true;
  try { return /(?:^|\.)ollama\.com$/i.test(new URL(endpoint).hostname); }
  catch { return false; }
}
export function recordOllamaCloudCall(endpoint: string, model: string, status: number, detail: unknown, apiKey?: string | null): void {
  if (!isOllamaCloudCall(endpoint, model)) return;
  if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { /* Provider plain text. */ } }
  const words = providerErrorDetail(detail, apiKey);
  const id = key(endpoint, model);
  if (status === 429 || /(?:monthly )?usage limit|usage credits|out of quota|quota.{0,30}(?:exceeded|exhausted)/i.test(words)) {
    warnings.set(id, { endpoint, model, words: words || "HTTP 429: usage limit reached." });
  } else if (status >= 200 && status < 300) warnings.delete(id);
}
export function ollamaCloudWarning(endpoint: string, model: string): string | undefined {
  const warning = warnings.get(key(endpoint, model));
  return warning ? `Ollama says: ${warning.words} Add credit at ollama.com/settings, or the desk moves to the next model.` : undefined;
}
export function pendingOllamaCloudCalls(): { endpoint: string; model: string }[] {
  return [...warnings.values()].map(({ endpoint, model }) => ({ endpoint, model }));
}
