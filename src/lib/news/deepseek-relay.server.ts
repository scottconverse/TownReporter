/** Server-only Anthropic transport for DeepSeek. One lazy loopback listener;
 * each unguessable route owns its endpoint, credential and observer. */
import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { deepSeekRunEffort, type ModelEffort } from "./provider-registry.ts";

export type DeepSeekRelayEvidence = {
  kind: "messages" | "tool-use";
  /**
   * The effort this request went upstream with (G25-EF-1, rule 24): "none"
   * unless the editor picked another effort DeepSeek offers.
   */
  effort: ModelEffort;
  /** Thinking was turned off and no output_config.effort was sent ("none"). */
  thinkingDisabled: boolean;
  /** Thinking is enabled at low effort (the D168 shape; true only for "low"). */
  thinkingLow: boolean;
  effortLow: boolean;
  authMatchesExpected: boolean;
  forwardedAuthMatchesExpected: boolean;
  forwardedAuthorization?: "Bearer ollama";
  toolId?: string;
  toolName?: string;
  toolUses: number;
  toolResults: number;
};
export type DeepSeekRelayObserver = (evidence: DeepSeekRelayEvidence) => void;
type Route = { baseUrl: string; token: string; effort: ModelEffort; onEvidence?: DeepSeekRelayObserver };
const routes = new Map<string, Route>();
/** Thinking budget the relay gives DeepSeek at low effort (measured Oct 20 2026, D168). */
const DEEPSEEK_THINKING_BUDGET = 2048;
/**
 * Thinking budgets for the efforts above low. UNVERIFIED: only "none" (D153)
 * and "low" (D168) were measured on Ollama. They stay well inside the 32,768
 * output ceiling so the answer always has room.
 */
const DEEPSEEK_THINKING_BUDGETS: Partial<Record<ModelEffort, number>> = {
  low: DEEPSEEK_THINKING_BUDGET,
  medium: 4096,
  high: 8192,
  xhigh: 12_288,
  max: 16_384,
};
/**
 * Output ceiling for deepseek-v4.1-flash:1017-cloud: 32,768 (Scott, Oct 20 2026,
 * DSH standard). Thinking shares it with the answer, so anything smaller cuts
 * drafts off at low effort. The relay never sends less than this.
 */
const DEEPSEEK_OUTPUT_TOKENS = 32_768;
let listener: Promise<string> | undefined;

function emit(route: Route, evidence: DeepSeekRelayEvidence) {
  // Instrumentation must never change transport behavior or expose headers/body.
  try { route.onEvidence?.({ ...evidence }); } catch { /* observer only */ }
}

function forwardingHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const out = { ...headers };
  const connectionHeaders = String(out.connection ?? "").split(",").map(value => value.trim().toLowerCase());
  for (const name of ["host", "connection", "content-length", "transfer-encoding", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "authorization", "x-api-key", "cookie", ...connectionHeaders]) delete out[name];
  return out;
}

async function startListener(): Promise<string> {
  const http = await import("node:http");
  const https = await import("node:https");
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1");
    const key = path.pathname.split("/")[1];
    const route = routes.get(key);
    if (!route) { res.writeHead(404).end(); return; }
    const suffix = path.pathname.slice(key.length + 1) || "/";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      let body = Buffer.concat(chunks);
      let evidence: DeepSeekRelayEvidence | undefined;
      if (suffix === "/v1/messages" && req.method === "POST") {
        const payload = JSON.parse(body.toString("utf8"));
        /*
          G25-EF-1 (rule 24, Oct 24 2026): DeepSeek runs at the route's effort,
          "none" unless the editor picked another. "none" is the D153 shape
          measured Oct 18 2026: thinking disabled and no output_config.effort.
          Any other effort is the D168 shape measured for "low" on Oct 20
          2026: thinking enabled with a budget plus output_config.effort.
        */
        if (route.effort === "none") {
          payload.thinking = { type: "disabled" };
          if (payload.output_config && typeof payload.output_config === "object") delete payload.output_config.effort;
        } else {
          payload.thinking = {
            type: "enabled",
            budget_tokens: DEEPSEEK_THINKING_BUDGETS[route.effort] ?? DEEPSEEK_THINKING_BUDGET,
          };
          payload.output_config = {
            ...(payload.output_config && typeof payload.output_config === "object" ? payload.output_config : {}),
            effort: route.effort,
          };
        }
        if (!(typeof payload.max_tokens === "number" && payload.max_tokens >= DEEPSEEK_OUTPUT_TOKENS)) {
          payload.max_tokens = DEEPSEEK_OUTPUT_TOKENS;
        }
        const toolResults = Array.isArray(payload.messages)
          ? payload.messages.reduce((count: number, message: { content?: unknown }) => count + (Array.isArray(message.content)
            ? message.content.filter(block => block?.type === "tool_result").length : 0), 0)
          : 0;
        body = Buffer.from(JSON.stringify(payload));
        evidence = {
          kind: "messages",
          effort: route.effort,
          thinkingDisabled: payload.thinking.type === "disabled" && !Object.hasOwn(payload.output_config ?? {}, "effort"),
          thinkingLow: payload.thinking.type === "enabled" && route.effort === "low",
          effortLow: payload.output_config?.effort === "low",
          authMatchesExpected: req.headers.authorization === `Bearer ${route.token}`,
          forwardedAuthMatchesExpected: false,
          toolUses: 0, toolResults,
        };
      }
      const target = new URL(route.baseUrl + suffix + path.search);
      const headers = forwardingHeaders(req.headers);
      headers.authorization = `Bearer ${route.token}`;
      headers["content-length"] = String(body.length);
      if (evidence) {
        evidence.forwardedAuthMatchesExpected = headers.authorization === `Bearer ${route.token}`;
        if (route.token === "ollama" && headers.authorization === "Bearer ollama") evidence.forwardedAuthorization = "Bearer ollama";
        emit(route, evidence);
      }
      const upstream = (target.protocol === "https:" ? https : http).request(target, {
        method: req.method, headers,
      }, response => {
        const responseHeaders = { ...response.headers };
        delete responseHeaders["transfer-encoding"];
        res.writeHead(response.statusCode ?? 502, responseHeaders);
        // Observe only complete SSE data lines; pipe forwards each chunk immediately.
        // The bounded parser retains no response body and never delays the pipe.
        let pending = "";
        if (evidence && String(response.headers["content-type"]).includes("text/event-stream")) {
          response.on("data", chunk => {
            pending += String(chunk);
            let newline: number;
            while ((newline = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, newline).trim();
              pending = pending.slice(newline + 1);
              if (!line.startsWith("data:")) continue;
              try {
                const event = JSON.parse(line.slice(5));
                if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
                  evidence = { ...evidence!, kind: "tool-use", toolUses: evidence!.toolUses + 1,
                    toolId: typeof event.content_block.id === "string" ? event.content_block.id : undefined,
                    toolName: typeof event.content_block.name === "string" ? event.content_block.name : undefined };
                  emit(route, evidence);
                }
              } catch { /* non-JSON SSE data */ }
            }
            if (pending.length > 65536) pending = "";
          });
        }
        response.on("error", () => res.destroy());
        response.pipe(res);
      });
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502).end("DeepSeek relay upstream failed.");
        else res.destroy();
      });
      res.on("close", () => upstream.destroy());
      upstream.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(502).end("DeepSeek relay request failed.");
      else res.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("DeepSeek relay address unavailable.");
  return `http://127.0.0.1:${address.port}`;
}

/** Lease survives until the child exits. No target or token is a global default. */
export async function deepSeekRelayRoute(input: {
  baseUrl: string; apiKey?: string; onEvidence?: DeepSeekRelayObserver;
  /** The effort DeepSeek runs with. No effort (or one DeepSeek does not offer) is "none". */
  effort?: ModelEffort | null;
}): Promise<{ baseUrl: string; release: () => void }> {
  listener ??= startListener().catch(error => { listener = undefined; throw error; });
  const origin = await listener;
  const key = randomUUID();
  routes.set(key, Object.freeze({
    baseUrl: input.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
    token: input.apiKey || "ollama", onEvidence: input.onEvidence,
    effort: deepSeekRunEffort(input.effort),
  }));
  return { baseUrl: `${origin}/${key}`, release: () => { routes.delete(key); } };
}
