import assert from "node:assert/strict";
import { it } from "node:test";
import { haloGatewaySearch } from "./halo-search.ts";

const original = process.env.TOWNREPORTER_GATEWAY_MCP_URL;
const restore = () => original === undefined ? delete process.env.TOWNREPORTER_GATEWAY_MCP_URL : process.env.TOWNREPORTER_GATEWAY_MCP_URL = original;

it("is disabled when no operator endpoint is configured", async () => {
  delete process.env.TOWNREPORTER_GATEWAY_MCP_URL;
  await assert.rejects(() => haloGatewaySearch("election"), /not configured/);
  restore();
});

it("performs initialize then web_search and validates public hits", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  const calls: any[] = [];
  const result = await haloGatewaySearch("Longmont election", { fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (body.method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ schema_version: "1.5", ok: true, tool: "web_search", provider: "ddgs-accountless", coverage: { available: 2 }, warnings: ["PROVIDER_FALLBACK_USED"], items: [{ title: "Candidate PDF", url: "https://example.com/a", snippet: "result" }, { title: "private", url: "http://127.0.0.1/private" }] }) }] } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  }});
  assert.equal(calls[0].method, "initialize"); assert.equal(calls.at(-1).method, "tools/call");
  assert.deepEqual(result.hits, [{ title: "Candidate PDF", url: "https://example.com/a", snippet: "result" }]);
  assert.deepEqual(result.warnings, ["PROVIDER_FALLBACK_USED"]);
  restore();
});

it("accepts the Gateway's stateless 202 initialized notification and SSE tool result", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  const calls: any[] = [];
  const gatewayEnvelope = {
    schema_version: "1.5", ok: true, tool: "web_search", provider: "searxng",
    coverage: { available: 11, complete: false }, page: { number: 1, next_cursor: "signed-next" },
    warnings: ["RESULT_TRUNCATED"], items: [{ title: "Primary", url: "https://example.com/primary", snippet: "source" }],
  };
  const result = await haloGatewaySearch("Longmont election", { fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/call") {
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { isError: false, content: [{ type: "text", text: JSON.stringify(gatewayEnvelope) }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26" } }));
  }});
  assert.deepEqual(calls.map((call) => call.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(result.complete, false);
  assert.equal(result.nextCursor, "signed-next");
  assert.equal(result.available, 11);
  assert.deepEqual(result.warnings, ["RESULT_TRUNCATED"]);
  restore();
});

it("rejects MCP and Gateway envelopes without echoing remote error detail", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  const remoteSecret = "internal stack trace and token";
  await assert.rejects(
    () => haloGatewaySearch("q", { fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: remoteSecret } })) }),
    (error: Error) => /Gateway MCP request failed/.test(error.message) && !error.message.includes(remoteSecret),
  );
  await assert.rejects(
    () => haloGatewaySearch("q", { fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { isError: true, content: [] } }));
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    }}),
    /Gateway tool call failed/,
  );
  restore();
});

it("preserves a valid Gateway error envelope's stable code and coverage without its remote message", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  const remoteSecret = "upstream detail must not leave the Gateway";
  await assert.rejects(
    () => haloGatewaySearch("q", { fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ schema_version: "1.5", ok: false, tool: "web_search", provider: "ddgs-accountless", error: { code: "PROVIDER_UNAVAILABLE", message: remoteSecret }, coverage: { available: 0, complete: false }, page: { next_cursor: null }, warnings: ["PROVIDER_FALLBACK_USED"], items: [] }) }] } }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
    }}),
    (error: unknown) => typeof error === "object" && error !== null && (error as any).code === "PROVIDER_UNAVAILABLE" && (error as any).complete === false && (error as any).warnings[0] === "PROVIDER_FALLBACK_USED" && !(error as Error).message.includes(remoteSecret),
  );
  restore();
});

it("cancels a streamed response once it passes the 1 MiB cap", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  let cancelled = false;
  await assert.rejects(
    () => haloGatewaySearch("q", { fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method !== "tools/call") return new Response(body.method === "notifications/initialized" ? null : JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: body.method === "notifications/initialized" ? 202 : 200 });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(1_000_001))); },
        cancel() { cancelled = true; },
      });
      return new Response(stream, { headers: { "content-type": "application/json" } });
    }}),
    /response exceeded limit/,
  );
  assert.equal(cancelled, true);
  restore();
});

it("uses one deadline signal across initialize, notification, and the tool call", async () => {
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://127.0.0.1:8765/mcp";
  let operationSignal: AbortSignal | undefined;
  await assert.rejects(
    () => haloGatewaySearch("q", { timeoutMs: 5, fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (!operationSignal) operationSignal = init?.signal as AbortSignal;
      assert.equal(init?.signal, operationSignal, "each RPC must share the one operation deadline");
      if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("transport aborted"))));
    }}),
    /timed out/,
  );
  restore();
});

it("rejects credentials, non-local endpoints, malformed envelopes, and timeouts", async () => {
  for (const endpoint of ["https://user:pass@127.0.0.1:8765/mcp", "http://192.168.1.4:8765/mcp"]) {
    process.env.TOWNREPORTER_GATEWAY_MCP_URL = endpoint;
    await assert.rejects(() => haloGatewaySearch("q"), /localhost/);
  }
  process.env.TOWNREPORTER_GATEWAY_MCP_URL = "http://localhost:8765/mcp";
  await assert.rejects(() => haloGatewaySearch("q", { fetchImpl: async () => new Response("{}") }), /Gateway MCP request failed/);
  await assert.rejects(() => haloGatewaySearch("q", { timeoutMs: 1, fetchImpl: async (_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))) }), /timed out/);
  restore();
});
