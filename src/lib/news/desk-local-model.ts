import type { LocalCatalog, LocalServer, LocalModelEntry } from "./local-models.ts";

export const USE_LOADED_RECOMMENDED_LABEL = "Use whatever model is loaded (recommended)";

const isCloud = (id: string) => /[:.-]cloud$/i.test(id);

export type LocalServerReadiness = {
  state: "unreachable" | "ready" | "no-model-loaded" | "load-state-unknown";
  loadedModel: LocalModelEntry | null;
  loadedCount: number;
  help: string;
};

/**
 * One answer for Server and Models: an answering endpoint is not enough to
 * call a local writer ready. A non-cloud chat model has to be in memory.
 */
export function localServerReadiness(server: LocalServer): LocalServerReadiness {
  if (!server.reachable) {
    return {
      state: "unreachable",
      loadedModel: null,
      loadedCount: 0,
      help: "This server did not answer. Check that it is running and that its address is correct.",
    };
  }
  const onDeviceLoaded = server.models
    .filter((model) => model.kind !== "embedding" && model.loaded === true && !model.cloud && !isCloud(model.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const loadedModel = onDeviceLoaded[0] ?? null;
  if (loadedModel) {
    return {
      state: "ready",
      loadedModel,
      loadedCount: onDeviceLoaded.length,
      help: `${loadedModel.label || loadedModel.id} is loaded on this server and ready for a local writing job.`,
    };
  }
  const chatModels = server.models.filter((model) => model.kind !== "embedding" && !model.cloud && !isCloud(model.id));
  const loadStateUnknown = chatModels.some((model) => model.loaded === null);
  return loadStateUnknown
    ? {
        state: "load-state-unknown",
        loadedModel: null,
        loadedCount: 0,
        help: "This server answers, but does not report whether a model is loaded, so TownReporter cannot confirm that it is ready to write.",
      }
    : {
        state: "no-model-loaded",
        loadedModel: null,
        loadedCount: 0,
        help: "This server answers, but no on-device chat model is loaded. A local writing job will skip it until one is loaded.",
      };
}

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

export function localServerStatus(server: LocalServer): string {
  const readiness = localServerReadiness(server);
  if (readiness.state === "unreachable") return "Could not reach";
  if (readiness.state === "ready") return "Ready";
  if (readiness.state === "load-state-unknown") {
    return "Server reachable; this server does not report whether a model is loaded.";
  }
  return "Server reachable; no on-device chat model is loaded. Load one on this server or choose an already loaded model.";
}
