import { assertHttpUrl } from "./url-guard.ts";
import type { WebHit } from "./search-web.ts";

const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
let fetchOverride: typeof fetch | null = null;

/** Test seam for the locally validated Gateway transport only. */
export function setHaloFetchImplForTests(impl: typeof fetch | null) {
  fetchOverride = impl;
}

export type HaloSearchResult = {
  hits: WebHit[];
  provider: string;
  warnings: string[];
  available?: number;
  complete?: boolean;
  nextCursor?: string;
};

export class HaloGatewayProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly warnings: string[];
  readonly available?: number;
  readonly complete?: boolean;
  readonly nextCursor?: string;
  constructor(
    code: string,
    provider: string,
    warnings: string[],
    available?: number,
    complete?: boolean,
    nextCursor?: string,
  ) {
    super(`Gateway provider error: ${code}`);
    this.name = "HaloGatewayProviderError";
    this.code = code;
    this.provider = provider;
    this.warnings = warnings;
    this.available = available;
    this.complete = complete;
    this.nextCursor = nextCursor;
  }
}

function configuredEndpoint(): URL | null {
  const raw = process.env.TOWNREPORTER_GATEWAY_MCP_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("TOWNREPORTER_GATEWAY_MCP_URL must be a valid URL"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase())) {
    throw new Error("TOWNREPORTER_GATEWAY_MCP_URL must be an unauthenticated localhost HTTP(S) URL");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Gateway response exceeded limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseRpc(raw: string): Record<string, unknown> {
  const candidates = [raw];
  for (const line of raw.split(/\r?\n/)) if (line.startsWith("data:")) candidates.push(line.slice(5).trim());
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (isRecord(value)) return value;
    } catch { /* try the next JSON or SSE data frame */ }
  }
  throw new Error("Gateway returned an invalid MCP response");
}

async function request(url: URL, body: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<Response> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (signal.aborted) throw new Error("Gateway request timed out");
    throw error;
  }
}

async function postRpc(url: URL, body: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  let raw: string;
  try {
    raw = await readLimited(await request(url, body, signal, fetchImpl));
  } catch (error) {
    if (signal.aborted) throw new Error("Gateway request timed out");
    throw error;
  }
  const rpc = parseRpc(raw);
  if (rpc.jsonrpc !== "2.0" || "error" in rpc || !("result" in rpc)) throw new Error("Gateway MCP request failed");
  return rpc.result;
}

async function notifyInitialized(url: URL, body: unknown, signal: AbortSignal, fetchImpl: typeof fetch): Promise<void> {
  const response = await request(url, body, signal, fetchImpl);
  if (response.status === 202) return;
  const rpc = parseRpc(await readLimited(response));
  if (rpc.jsonrpc !== "2.0" || "error" in rpc) throw new Error("Gateway MCP request failed");
}

function envelope(result: unknown): HaloSearchResult {
  if (!isRecord(result) || result.isError === true) throw new Error("Gateway tool call failed");
  const content = result.content;
  const text = Array.isArray(content) ? content.find((item) => isRecord(item) && item.type === "text")?.text : undefined;
  if (typeof text !== "string") throw new Error("Gateway search response had no text envelope");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Gateway search returned an invalid envelope"); }
  if (isRecord(value) && value.schema_version === "1.5" && value.ok === false && value.tool === "web_search" && Array.isArray(value.items)) {
    const coverage = isRecord(value.coverage) ? value.coverage : undefined;
    const page = isRecord(value.page) ? value.page : undefined;
    const code = isRecord(value.error) && typeof value.error.code === "string" && /^[A-Z0-9_]{1,80}$/.test(value.error.code)
      ? value.error.code
      : "GATEWAY_ERROR";
    throw new HaloGatewayProviderError(
      code,
      typeof value.provider === "string" ? value.provider : "unknown",
      Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 20) : [],
      typeof coverage?.available === "number" ? coverage.available : undefined,
      typeof coverage?.complete === "boolean" ? coverage.complete : undefined,
      typeof page?.next_cursor === "string" ? page.next_cursor : undefined,
    );
  }
  if (!isRecord(value) || value.schema_version !== "1.5" || value.ok !== true || value.tool !== "web_search" || !Array.isArray(value.items)) {
    throw new Error("Gateway search returned an invalid envelope");
  }
  const hits: WebHit[] = [];
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.url !== "string") continue;
    try { assertHttpUrl(item.url); } catch { continue; }
    hits.push({ title: typeof item.title === "string" && item.title ? item.title : item.url, url: item.url, snippet: typeof item.snippet === "string" ? item.snippet : "" });
  }
  const coverage = isRecord(value.coverage) ? value.coverage : undefined;
  const page = isRecord(value.page) ? value.page : undefined;
  return {
    hits,
    provider: `halo-gateway:${typeof value.provider === "string" ? value.provider : "unknown"}`,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 20) : [],
    available: typeof coverage?.available === "number" ? coverage.available : undefined,
    complete: typeof coverage?.complete === "boolean" ? coverage.complete : undefined,
    nextCursor: typeof page?.next_cursor === "string" ? page.next_cursor : undefined,
  };
}

export async function haloGatewaySearch(query: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<HaloSearchResult> {
  const url = configuredEndpoint();
  if (!url) throw new Error("Halo Gateway search is not configured");
  if (!query.trim()) throw new Error("Gateway search query is empty");
  const fetchImpl = options.fetchImpl ?? fetchOverride ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await postRpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "townreporter", version: "0.6" } } }, controller.signal, fetchImpl);
    await notifyInitialized(url, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, controller.signal, fetchImpl);
    const result = await postRpc(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "web_search", arguments: { query, content_type: "web", max_results: 8, max_chars: 6000 } } }, controller.signal, fetchImpl);
    return envelope(result);
  } finally {
    clearTimeout(timer);
  }
}
