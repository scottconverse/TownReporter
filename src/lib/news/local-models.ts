/*
  Finds a local, OpenAI-compatible model server on the machine running this
  desk, without asking the operator to type anything.

  Two probes, always at the same two ports, plus whatever LLM_BASE_URL
  already names: LM Studio's default (http://127.0.0.1:1234/v1) and Ollama's
  default (http://127.0.0.1:11434/v1). Owner rule "out of the box, with LM
  Studio or Ollama running, Local model is live with no config" -- this is
  the module that makes that true.

  Server-only by the `.server.ts` suffix: it makes outbound fetches to
  localhost ports and holds an in-memory cache, neither of which belongs in
  a browser bundle. `provider-registry.ts` stays pure and never imports this
  file directly -- it only exposes `setLocalDiscoveryReachable` /
  `localDiscoveryReachable`, a plain synchronous flag this module updates
  after a probe. That is what lets `local-model.enabled()` stay synchronous
  (client-safe callers keep working) while still reflecting a real,
  just-probed answer once this module has run at least once on the server.

  Never throws. A server that does not answer, times out, or answers with
  something that is not the expected JSON shape (port 8080 on this machine
  serves an unrelated web app that returns HTML) is treated as absent, not
  as an error -- discovery's whole job is to tell the rest of the desk
  what is safely usable, not to diagnose the operator's network.
*/

import { setLocalDiscoveryReachable } from "./provider-registry.ts";

export type LocalModelKind = "chat" | "vision" | "embedding" | "unknown";

export type LocalModelEntry = {
  id: string;
  label: string;
  /** null when the server does not report load state (plain OpenAI-compatible). */
  loaded: boolean | null;
  kind: LocalModelKind;
  /** Answers with reasoning_content/reasoning instead of content by default. */
  thinking: boolean;
};

export type LocalServerKind = "lmstudio" | "ollama" | "openai-compatible";

export type LocalServer = {
  kind: LocalServerKind;
  baseUrl: string;
  /**
   * False only for a server that came from LLM_BASE_URL and did not answer
   * -- the operator pointed at it on purpose, so the editor should see it is
   * down. A probed default port that does not answer is left OUT of
   * `servers` entirely (see `discoverLocalModels`), not included as
   * `reachable: false` -- there is nothing there to report as down.
   */
  reachable: boolean;
  models: LocalModelEntry[];
};

export type LocalCatalog = {
  servers: LocalServer[];
  defaultModel: { baseUrl: string; id: string } | null;
  checkedAt: number;
};

function env(key: string): string | undefined {
  const value = process.env[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function notSwitchedOff(key: string): boolean {
  return env(key) !== "0";
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** http://127.0.0.1:1234/v1 -> http://127.0.0.1:1234 */
function serverRoot(baseUrl: string): string {
  return trimSlash(baseUrl).replace(/\/v1$/, "");
}

const THINKING_RE = /gemma-?4|qwen3(?:\.\d+)?|deepseek-r1|gpt-oss|o[134]-|reasoning|think/i;

function isThinking(id: string): boolean {
  return THINKING_RE.test(id);
}

function inferKind(baseUrl: string): LocalServerKind {
  if (/:1234\b/.test(baseUrl)) return "lmstudio";
  if (/:11434\b/.test(baseUrl)) return "ollama";
  return "openai-compatible";
}

const PROBE_TIMEOUT_MS = 1_500;

async function fetchJson(url: string, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  // Port 8080 on this machine serves an unrelated web app that answers 200
  // with HTML. Refuse to parse it as JSON at all rather than let `.json()`
  // throw a confusing SyntaxError further down.
  if (contentType && !/json/i.test(contentType)) throw new Error(`${url} is not JSON`);
  return res.json();
}

/** `{data:[{id}...]}` — the one shape every OpenAI-compatible `/models` list shares. */
function parseModelIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const ids = data
    .map((entry) => (entry && typeof entry === "object" ? (entry as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids;
}

type LmStudioNativeModel = { id?: string; state?: string; type?: string };

async function enrichLmStudio(root: string, ids: string[]): Promise<LocalModelEntry[]> {
  let native: LmStudioNativeModel[] = [];
  try {
    const body = (await fetchJson(`${root}/api/v0/models`)) as { data?: LmStudioNativeModel[] };
    native = Array.isArray(body?.data) ? body.data : [];
  } catch {
    // No native endpoint (older server, or blocked) -- fall back to the
    // plain list below with no load/type information.
  }
  const byId = new Map(native.map((m) => [m.id, m]));
  const out: LocalModelEntry[] = [];
  for (const id of ids) {
    const meta = byId.get(id);
    if (meta?.type === "embeddings") continue; // never offered as a chat model
    const kind: LocalModelKind = meta?.type === "vlm" ? "vision" : meta ? "chat" : "unknown";
    out.push({
      id,
      label: id,
      loaded: meta ? meta.state === "loaded" : null,
      kind,
      thinking: isThinking(id),
    });
  }
  return out;
}

async function enrichOllama(root: string, ids: string[]): Promise<LocalModelEntry[]> {
  let running = new Set<string>();
  try {
    const body = (await fetchJson(`${root}/api/ps`)) as { models?: { name?: string; model?: string }[] };
    running = new Set(
      (body?.models ?? [])
        .map((m) => m.name ?? m.model)
        .filter((name): name is string => typeof name === "string"),
    );
  } catch {
    // /api/ps missing or unreachable -- loaded state stays unknown, not an error.
  }
  return ids.map((id) => ({
    id,
    label: id,
    loaded: running.size > 0 ? running.has(id) : null,
    kind: "chat" as const,
    thinking: isThinking(id),
  }));
}

async function probeServer(
  baseUrl: string,
  kind: LocalServerKind,
  alwaysInclude: boolean,
): Promise<LocalServer | null> {
  const base = trimSlash(baseUrl);
  let ids: string[] | null = null;
  try {
    ids = parseModelIds(await fetchJson(`${base}/models`));
  } catch {
    ids = null;
  }
  if (ids === null) {
    // Dropped a non-JSON 200, a timeout, a connection refusal, or a body
    // that did not parse as `{data:[{id}]}` -- all the same outcome here.
    return alwaysInclude ? { kind, baseUrl: base, reachable: false, models: [] } : null;
  }
  const models =
    kind === "lmstudio"
      ? await enrichLmStudio(serverRoot(base), ids)
      : kind === "ollama"
        ? await enrichOllama(serverRoot(base), ids)
        : ids.map((id) => ({ id, label: id, loaded: null, kind: "chat" as const, thinking: isThinking(id) }));
  return { kind, baseUrl: base, reachable: true, models };
}

function pickDefault(servers: LocalServer[]): { baseUrl: string; id: string } | null {
  const priority: LocalServerKind[] = ["lmstudio", "ollama", "openai-compatible"];
  const ordered = servers
    .filter((s) => s.reachable)
    .slice()
    .sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));

  for (const server of ordered) {
    const loaded = server.models.find((m) => m.loaded === true && m.kind !== "embedding");
    if (loaded) return { baseUrl: server.baseUrl, id: loaded.id };
  }
  const wantedModel = env("LLM_MODEL");
  if (wantedModel) {
    for (const server of ordered) {
      if (server.models.some((m) => m.id === wantedModel)) {
        return { baseUrl: server.baseUrl, id: wantedModel };
      }
    }
  }
  for (const server of ordered) {
    const first = server.models.find((m) => m.kind !== "embedding");
    if (first) return { baseUrl: server.baseUrl, id: first.id };
  }
  return null;
}

const CACHE_MS = 20_000;
let cache: { catalog: LocalCatalog; at: number } | null = null;

/**
 * The live catalog. Cached 20s -- the picker may re-query on every mount,
 * and there is no reason to hit three local ports again inside that window.
 * Pass `force: true` (used by `refreshLocalCatalog`'s background tick and
 * the picker's Refresh button) to bypass the cache.
 */
export async function discoverLocalModels(force = false): Promise<LocalCatalog> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) return cache.catalog;

  const servers: LocalServer[] = [];
  const seen = new Set<string>();

  const configuredBase = env("LLM_BASE_URL");
  if (configuredBase) {
    const base = trimSlash(configuredBase);
    const server = await probeServer(base, inferKind(base), true);
    if (server) {
      servers.push(server);
      seen.add(base);
    }
  }

  if (notSwitchedOff("TOWNREPORTER_LOCAL_DISCOVERY")) {
    const defaults: [string, LocalServerKind][] = [
      ["http://127.0.0.1:1234/v1", "lmstudio"],
      ["http://127.0.0.1:11434/v1", "ollama"],
    ];
    for (const [base, kind] of defaults) {
      if (seen.has(base)) continue;
      const server = await probeServer(base, kind, false);
      if (server) servers.push(server);
    }
  }

  const catalog: LocalCatalog = { servers, defaultModel: pickDefault(servers), checkedAt: now };
  cache = { catalog, at: now };
  return catalog;
}

let timerStarted = false;

/**
 * `discoverLocalModels`, plus the side effect that keeps
 * `provider-registry.ts`'s synchronous `local-model.enabled()` current: a
 * flag it flips after every probe, and a lazily-started 60s background
 * refresh so the flag does not go stale between picker queries. Started
 * lazily (on first call, from whichever server function needed the catalog
 * first) rather than at module load, so importing this file in a test never
 * leaves a timer running.
 */
export async function refreshLocalCatalog(force = false): Promise<LocalCatalog> {
  const catalog = await discoverLocalModels(force);
  setLocalDiscoveryReachable(catalog.servers.some((s) => s.reachable));
  if (!timerStarted) {
    timerStarted = true;
    const timer = setInterval(() => {
      discoverLocalModels(true)
        .then((c) => setLocalDiscoveryReachable(c.servers.some((s) => s.reachable)))
        .catch(() => {
          // A failed background refresh leaves the flag as it was -- it will
          // try again in 60s. Never let a rejected promise become an
          // unhandled rejection.
        });
    }, 60_000);
    if (typeof timer.unref === "function") timer.unref();
  }
  return catalog;
}

/** Test-only: drop the cache and the lazy-timer flag between test files. */
export function resetLocalCatalogCacheForTests(): void {
  cache = null;
  timerStarted = false;
}
