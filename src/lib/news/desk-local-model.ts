import type { LocalCatalog, LocalServer } from "./local-models.ts";

export const USE_LOADED_RECOMMENDED_LABEL = "Use whatever model is loaded (recommended)";

const isCloud = (id: string) => /[:.-]cloud$/i.test(id);

function serverLabel(server: LocalServer): string {
  if (server.kind === "lmstudio") return "LM Studio";
  if (server.kind === "ollama") return "Ollama";
  if (server.kind === "llamacpp") return "llama.cpp";
  try {
    const port = new URL(server.baseUrl).port;
    if (port === "11434") return "Ollama";
    if (port === "1234") return "LM Studio";
  } catch {
    /* ignore */
  }
  return "Local";
}

function findServer(catalog: LocalCatalog, baseUrl: string): LocalServer | null {
  return catalog.servers.find((s) => s.baseUrl === baseUrl) ?? null;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function deskLocalModelSentence(choice: {
  override: { baseUrl: string; id: string } | null;
  catalog: LocalCatalog;
}): string {
  if (!choice.override) return "No model is loaded on this computer.";
  const { baseUrl, id } = choice.override;
  const server = findServer(choice.catalog, baseUrl);
  const label = serverLabel(
    server ?? { kind: "openai-compatible", baseUrl, reachable: false, models: [] },
  );
  const local = server?.models.find((m) => m.id === id);
  const cloud = local ? local.cloud || isCloud(id) : isCloud(id);
  if (cloud)
    return `The desk uses ${id} on Ollama Cloud — not this computer, spends credits for Local model.`;
  const host = new URL(baseUrl).hostname;
  const location = ["127.0.0.1", "localhost", "[::1]"].includes(host)
    ? "this computer"
    : `remote server at ${hostOf(baseUrl)}`;
  return `The desk uses ${id} on ${label}, ${location} for Local model.`;
}

/**
 * The next step for a desk with no local model loaded (decision D277).
 *
 * "No model is loaded on this computer." is a fact, not a way out. This is the
 * one short line printed under it: where to load a model, or where to pick one
 * instead. It is its own pure function so the page can print it as plain words
 * (the Models page is already the destination) while a caller elsewhere can
 * link "Models page" to `/desk/models`.
 */
export function deskLocalModelNextStep(choice: {
  override: { baseUrl: string; id: string } | null;
}): string | null {
  if (choice.override) return null;
  return "Next: load a model in LM Studio or Ollama, or pick one on the Models page.";
}

export function localServerStatus(server: LocalServer): string {
  if (!server.reachable) return "Could not reach";
  const loaded = server.models.find(
    (m) => m.loaded === true && !m.cloud && !isCloud(m.id) && !isCloud(m.id),
  );
  if (loaded) return "Ready";
  return "Running, no model loaded — load one in LM Studio (Developer tab) or press Use this one";
}
