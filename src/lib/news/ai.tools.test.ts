import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile, writeFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { grokChat } from "./ai.ts";
import { executeModelTool, rejectsTools } from "./model-tools.server.ts";
import { setFetchImplForTests } from "./fetch-url.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answer = () =>
  json({
    model: "fake-model",
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Finished." } }],
  });
const tool = (name: string, args: Record<string, unknown>, id = "call-1") =>
  json({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  });
const anthropic = (content: unknown[], stop_reason = "end_turn") =>
  json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "fake-claude",
    content,
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

async function fixture(handler: typeof fetch, work: () => Promise<void>, api = false) {
  const vars: Record<string, string | undefined> = {
    LLM_BASE_URL: "http://127.0.0.1:9/v1",
    LLM_MODEL: "fake-model",
    LLM_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: api ? "test-key" : undefined,
    ANTHROPIC_MODEL: "fake-claude",
    ANTHROPIC_EFFORT: "high",
    TOWNREPORTER_CLAUDE_CODE: "0",
    TOWNREPORTER_CODEX: "0",
    TOWNREPORTER_LOCAL: "1",
    LLM_REASONING_EFFORT: undefined,
    TOWNREPORTER_GATEWAY_MCP_URL: "http://127.0.0.1:9/mcp",
  };
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = handler;
  // A referenced timer lets AbortSignal.timeout fire even with a fake stalled fetch.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await work();
  } finally {
    clearInterval(keepAlive);
    globalThis.fetch = originalFetch;
    setFetchImplForTests(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
const chat = (api = false, timeoutMs = 3000) =>
  grokChat("original system", "original user", 200, {
    choice: api ? "claude-frontier" : "local-model",
    timeoutMs,
  });

it("OpenAI web_search executes desk search exactly once and returns results to the model", async () => {
  let modelCalls = 0;
  let searches = 0;
  await fixture(
    async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/mcp")) {
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        if (body.method === "initialize") return json({ jsonrpc: "2.0", id: 1, result: {} });
        searches++;
        assert.equal(body.params.arguments.query, "town election");
        return json({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  schema_version: "1.5",
                  ok: true,
                  tool: "web_search",
                  provider: "fake",
                  items: [
                    {
                      title: "Election record",
                      url: "https://example.com/election",
                      snippet: "Election evidence",
                    },
                  ],
                }),
              },
            ],
          },
        });
      }
      modelCalls++;
      assert.equal(body.messages[0].content, "original system");
      if (modelCalls === 1) {
        assert.equal(body.tools.length, 6);
        return tool("web_search", { query: "town election" });
      }
      assert.equal(body.messages[2].tool_calls[0].id, "call-1");
      assert.equal(body.messages[3].tool_call_id, "call-1");
      assert.match(body.messages[3].content, /Election evidence/);
      return answer();
    },
    async () => {
      const result = await chat();
      assert.equal(result.ok, true);
      assert.equal(modelCalls, 2);
      assert.equal(searches, 1);
      assert.deepEqual(result.meta?.toolExecutions, { web_search: 1 });
    },
  );
});

for (const api of [false, true]) {
  it(`${api ? "Anthropic" : "OpenAI"} actually runs a command and sends its output in the next request`, async () => {
    let calls = 0;
    const command = `"${process.execPath}" -e "process.stdout.write('D149-command-proof')"`;
    await fixture(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls++;
        if (calls === 1)
          return api
            ? anthropic(
                [
                  { type: "thinking", thinking: "retained", signature: "sig" },
                  { type: "tool_use", id: "call-1", name: "run_command", input: { command } },
                ],
                "tool_use",
              )
            : tool("run_command", { command });
        if (api) {
          assert.equal(body.messages[1].content[0].signature, "sig");
          assert.equal(body.messages[2].content[0].tool_use_id, "call-1");
          assert.match(body.messages[2].content[0].content, /D149-command-proof/);
          assert.equal(body.max_tokens, 8000);
          assert.deepEqual(body.thinking, { type: "adaptive" });
          return anthropic([{ type: "text", text: "Finished." }]);
        }
        assert.match(body.messages[3].content, /D149-command-proof/);
        assert.equal(JSON.parse(body.messages[3].content).code, 0);
        return answer();
      },
      async () => {
        const result = await chat(api);
        assert.equal(result.ok, true);
        assert.equal(calls, 2);
        assert.deepEqual(result.meta?.toolExecutions, { run_command: 1 });
      },
      api,
    );
  });

  it(`${api ? "Anthropic" : "OpenAI"} retries an explicit tools rejection once without tools`, async () => {
    const requests: any[] = [];
    await fixture(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        if (requests.length === 1)
          return json(
            {
              error: {
                type: "invalid_request_error",
                message: "This endpoint does not support tools",
              },
            },
            400,
          );
        return api ? anthropic([{ type: "text", text: "Finished." }]) : answer();
      },
      async () => {
        const result = await chat(api);
        assert.equal(result.ok, true);
        assert.equal(requests.length, 2);
        assert.equal(requests[0].tools.length, 6);
        assert.equal("tools" in requests[1], false);
        const { tools: _tools, ...first } = requests[0];
        assert.deepEqual(requests[1], first);
        assert.equal(result.meta?.toolsFallback, true);
        assert.deepEqual(result.meta?.toolExecutions, {});
      },
      api,
    );
  });

  it(`${api ? "Anthropic" : "OpenAI"} never falls back for unrelated errors`, async () => {
    let calls = 0;
    await fixture(
      async () => {
        calls++;
        return json(
          {
            error: {
              type: "invalid_request_error",
              message: "Context length exceeded while using tools",
            },
          },
          400,
        );
      },
      async () => {
        const result = await chat(api);
        assert.equal(result.ok, false);
        assert.equal(calls, 1);
        assert.equal(result.meta?.toolsFallback, false);
      },
      api,
    );
  });

  it(`${api ? "Anthropic" : "OpenAI"} includes stalled response bodies in the whole-call timeout`, async () => {
    await fixture(
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "application/json" },
        }),
      async () => {
        const start = Date.now();
        const result = await chat(api, 100);
        assert.equal(result.ok, false);
        assert.equal(result.meta?.timedOut, true);
        assert.ok(Date.now() - start < 1000);
      },
      api,
    );
  });

  it(`${api ? "Anthropic" : "OpenAI"} shares its deadline with a stalled fetch_page tool`, async () => {
    let calls = 0;
    let toolAborted = false;
    setFetchImplForTests(
      async (_url, init) =>
        new Promise(() => {
          init.signal?.addEventListener("abort", () => {
            toolAborted = true;
          });
        }),
    );
    await fixture(
      async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 80));
        return api
          ? anthropic(
              [
                {
                  type: "tool_use",
                  id: "call-1",
                  name: "fetch_page",
                  input: { url: "https://93.184.215.14/article" },
                },
              ],
              "tool_use",
            )
          : tool("fetch_page", { url: "https://93.184.215.14/article" });
      },
      async () => {
        const start = Date.now();
        const result = await chat(api, 150);
        assert.ok(Date.now() - start < 220, "model and tool share the 150ms deadline");
        assert.equal(toolAborted, true);
        assert.equal(result.ok, false);
        assert.equal(result.meta?.timedOut, true);
        assert.deepEqual(result.meta?.toolExecutions, { fetch_page: 1 });
        assert.equal(calls, 1);
      },
      api,
    );
  });
}

it("tools rejection fallback is attempted only once", async () => {
  let calls = 0;
  await fixture(
    async () => {
      calls++;
      return json({ error: { message: "tools not supported" } }, 400);
    },
    async () => {
      const result = await chat();
      assert.equal(result.ok, false);
      assert.equal(calls, 2);
      assert.equal(result.meta?.toolsFallback, true);
    },
  );
});

it("file tools read, write and list a real disposable file without a path allowlist", async () => {
  const dir = await mkdtemp(resolve(".tmp-d149-tools-"));
  try {
    await writeFile(resolve(dir, "tool-fixture.txt"), "before");
    const signal = AbortSignal.timeout(3000);
    assert.equal(
      await executeModelTool("read_file", { path: resolve(dir, "tool-fixture.txt") }, signal),
      '"before"',
    );
    await executeModelTool(
      "write_file",
      { path: resolve(dir, "tool-fixture.txt"), content: "after" },
      signal,
    );
    assert.equal(await readFile(resolve(dir, "tool-fixture.txt"), "utf8"), "after");
    assert.deepEqual(
      JSON.parse(await executeModelTool("list_dir", { path: dir }, signal)),
      await readdir(dir),
    );
    assert.match(await executeModelTool("read_file", {}, signal), /Missing string argument/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("recognizes explicit tools rejections without swallowing authentication or context errors", () => {
  assert.equal(rejectsTools(400, "Unknown parameter: tools"), true);
  assert.equal(rejectsTools(400, "Unsupported parameter: 'tools'"), true);
  assert.equal(rejectsTools(422, "tool_choice is not supported"), true);
  assert.equal(rejectsTools(400, '"tools" is not supported'), true);
  assert.equal(rejectsTools(400, "Unrecognized request argument supplied: tools"), true);
  assert.equal(rejectsTools(401, "tools not supported"), false);
  assert.equal(rejectsTools(403, '"tools" is not supported'), false);
  assert.equal(rejectsTools(400, "Unknown model for tools"), false);
  assert.equal(rejectsTools(400, "context window exceeded for tools"), false);
  assert.equal(
    rejectsTools(400, "Unrecognized request argument supplied: context; tools enabled"),
    false,
  );
  assert.equal(rejectsTools(400, 'Context window exceeded; "tools" were supplied'), false);
});

it("fetch_page reads public page text through the desk fetch implementation", async () => {
  await fixture(
    async () => {
      throw new Error("Unexpected model request");
    },
    async () => {
      let fetches = 0;
      setFetchImplForTests(async (url, init) => {
        fetches++;
        assert.equal(url.href, "https://93.184.215.14/article");
        assert.ok(init.signal);
        return new Response(
          "A civic meeting record with enough readable public source text to extract and return.",
          { headers: { "content-type": "text/plain" } },
        );
      });
      const result = JSON.parse(
        await executeModelTool(
          "fetch_page",
          { url: "https://93.184.215.14/article" },
          AbortSignal.timeout(1000),
        ),
      );
      assert.match(result.text, /civic meeting record/);
      assert.equal(fetches, 1);
    },
  );
});

for (const api of [false, true]) {
  it(`${api ? "Anthropic" : "OpenAI"} continues across multiple tool rounds and returns tool errors`, async () => {
    let calls = 0;
    await fixture(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls++;
        if (calls > 1) {
          const result = api
            ? body.messages.at(-1).content[0].content
            : body.messages.at(-1).content;
          assert.match(result, /Missing string argument: path/);
        }
        if (calls <= 3)
          return api
            ? anthropic(
                [{ type: "tool_use", id: `call-${calls}`, name: "read_file", input: {} }],
                "tool_use",
              )
            : tool("read_file", {}, `call-${calls}`);
        return api ? anthropic([{ type: "text", text: "Finished." }]) : answer();
      },
      async () => {
        const result = await chat(api);
        assert.equal(result.ok, true);
        assert.equal(calls, 4);
        assert.deepEqual(result.meta?.toolExecutions, { read_file: 3 });
      },
      api,
    );
  });
}

it("a 501 tools rejection retries directly without tools", async () => {
  let calls = 0;
  await fixture(
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      if (calls === 1) return json({ error: { message: "tools not supported" } }, 501);
      assert.equal("tools" in body, false);
      return answer();
    },
    async () => {
      const result = await chat();
      assert.equal(result.ok, true);
      assert.equal(calls, 2);
      assert.equal(result.meta?.toolsFallback, true);
    },
  );
});
