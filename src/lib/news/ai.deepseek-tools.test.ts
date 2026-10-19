import assert from "node:assert/strict";
import { it } from "node:test";
import { resetClaudeCliCache } from "./ai-claude-code.server.ts";
import { grokChat, scanSystem, DRAFT_OUTPUT_TOKEN_FLOOR } from "./ai.ts";
import { RESEARCH_GUIDANCE } from "./research-guidance.ts";
import { reportResearchSystem, reportWriteSystem, REPORT_EDIT_SYSTEM, CITATION_REPAIR_SYSTEM } from "./report.ts";
import { DARK_SYSTEM, DARK_PLANNER } from "./dark-prompt.ts";
import { BRIEF_SYSTEM } from "./dark-brief.ts";
import { DARK_VERIFY_SYSTEM } from "./dark-gates.ts";
import { DESK_PLAN_ASK } from "./editorial.ts";
import { NAME_INVENTORY_SYSTEM, NAME_EVIDENCE_SYSTEM } from "./name-check-work.ts";
import { responsiveActionPrompt } from "./research-actions.ts";
import { runForcedChat } from "./forced-runtime.server.ts";

const ids = ["deepseek-v4.1-flash", "deepseek-v4.1-flash:cloud"];
const paper = { name: "Test Paper", city: "Longmont", state: "Colorado" };
const systems = [
  "Caller stage text: café and JSON.",
  scanSystem(paper), reportResearchSystem(paper), reportWriteSystem(paper),
  REPORT_EDIT_SYSTEM, CITATION_REPAIR_SYSTEM, DARK_SYSTEM, DARK_PLANNER,
  BRIEF_SYSTEM, DARK_VERIFY_SYSTEM, DESK_PLAN_ASK, NAME_INVENTORY_SYSTEM, NAME_EVIDENCE_SYSTEM,
];
const action = responsiveActionPrompt({ investigation: "Supplied evidence", receiptHistory: [], availableLinks: [], decision: 1, limit: 2 });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const answer = () => json({ model: "served-model-id", choices: [{ finish_reason: "stop", message: { content: "Finished." } }] });
const toolReply = () => json({ choices: [{ finish_reason: "tool_calls", message: {
  content: "Finished without executing tools.",
  tool_calls: [{ id: "call-1", type: "function", function: { name: "unknown_d151_tool", arguments: "{}" } }],
} }] });
type Request = { model: string; tools?: unknown[]; reasoning_effort?: string; max_tokens: number; messages: { role: string; content: string }[] };

// Every transport is intercepted. Unknown tool names cannot execute commands or contact MCP.
async function fixture(work: (requests: Request[]) => Promise<void>, unsolicitedTool = false) {
  const vars = { CLAUDE_CLI_PATH: "d153-missing-claude-binary", TOWNREPORTER_LOCAL: "1", TOWNREPORTER_DEEPSEEK: "1", TOWNREPORTER_DEEPSEEK_BASE_URL: "http://127.0.0.1:9/v1", TOWNREPORTER_DEEPSEEK_MODEL: ids[0], LLM_REASONING_EFFORT: "" };
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  const fetch = globalThis.fetch;
  const requests: Request[] = [];
  Object.assign(process.env, vars);
  resetClaudeCliCache();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:9/v1/chat/completions");
    requests.push(JSON.parse(String(init?.body)));
    return unsolicitedTool && requests.length === 1 ? toolReply() : answer();
  };
  try { await work(requests); }
  finally {
    globalThis.fetch = fetch;
    resetClaudeCliCache();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
const deepseek = (model: string, system = systems[0], user = "Supplied evidence") =>
  grokChat(system, user, 200, { choice: "deepseek-flash", model, rungModel: null, timeoutMs: 3000, reasoningEffort: "none" });

for (const model of ids) {
  it(`D151 missing-CLI fallback ${model} actual request omits tools and retains effort, output floor and returned model`, async () => {
    await fixture(async requests => {
      const result = await deepseek(model);
      assert.equal(result.ok, true);
      assert.equal(requests.length, 1);
      assert.equal(Object.hasOwn(requests[0], "tools"), false);
      assert.equal(requests[0].model, model);
      assert.equal(requests[0].reasoning_effort, "none");
      assert.equal(requests[0].max_tokens, DRAFT_OUTPUT_TOKEN_FLOOR);
      assert.equal(result.meta?.model, "served-model-id");
      assert.equal(result.meta?.toolsFallback, false);
      assert.equal(JSON.stringify(requests).includes("Time left for this answer:"), false);
    });
  });

  it(`D151 missing-CLI fallback ${model} excludes shared guidance from every stage and user prompt on the wire`, async () => {
    await fixture(async requests => {
      for (const system of systems) {
        const result = await deepseek(model, system, action);
        assert.equal(result.ok, true);
        const sent = requests.at(-1)!;
        assert.equal(sent.messages[0].content, system.replaceAll(RESEARCH_GUIDANCE, ""));
        assert.equal(sent.messages[1].content, action.replaceAll(RESEARCH_GUIDANCE, ""));
        assert.equal(JSON.stringify(sent).includes(RESEARCH_GUIDANCE), false);
        assert.equal(JSON.stringify(sent).includes("Time left for this answer:"), false);
      }
      assert.equal(requests.length, systems.length);
    });
  });

  it(`D151 missing-CLI fallback ${model} ignores unsolicited tool calls without a tool loop or time-left results`, async () => {
    await fixture(async requests => {
      const result = await deepseek(model);
      assert.equal(result.ok, true);
      assert.equal(requests.length, 1);
      assert.deepEqual(result.meta?.toolExecutions, {});
      assert.equal(result.meta?.toolRounds, 0);
      assert.equal(result.meta?.toolResultChars, 0);
      assert.deepEqual(result.meta?.toolRoundDetails, []);
      assert.equal(JSON.stringify(requests).includes("Time left for this answer:"), false);
    }, true);
  });

  it(`D151 missing-CLI fallback forced ${model} removes upstream guidance before the actual request`, async () => {
    await fixture(async requests => {
      const result = await runForcedChat({ runtime: "deepseek-flash", modelChoice: "deepseek-flash", transport: "local", localModel: { baseUrl: "http://127.0.0.1:9/v1", id: model }, modelEffort: "none" }, reportWriteSystem(paper), action, 200, { timeoutMs: 3000 }, {
        local: (system, user, maxTokens, options) => grokChat(system, user, maxTokens, options),
        claude: async () => { throw new Error("Unexpected Claude call"); },
        codex: async () => { throw new Error("Unexpected Codex call"); },
      });
      assert.equal(result.ok, true);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].model, model);
      assert.equal(Object.hasOwn(requests[0], "tools"), false);
      assert.equal(JSON.stringify(requests).includes(RESEARCH_GUIDANCE), false);
      assert.equal(JSON.stringify(requests).includes("Time left for this answer:"), false);
    });
  });
}

for (const custom of [false, true]) {
  it(`D151 ${custom ? "Custom" : "Local"} retains tools, guidance, time-left and tool records`, async () => {
    await fixture(async requests => {
      const localModel = { baseUrl: "http://127.0.0.1:9/v1", id: "fixture-model" };
      const result = await grokChat(reportWriteSystem(paper), "Supplied evidence", 200, {
        choice: custom ? "custom:11111111-1111-4111-8111-111111111111" : "local-model",
        newsroomId: 42, localModel, timeoutMs: 3000,
      }, { resolveCustom: async () => ({ baseUrl: localModel.baseUrl, modelId: localModel.id, apiKey: null, name: "Fixture" }) });
      assert.equal(result.ok, true);
      assert.equal(requests.length, 2);
      for (const request of requests) {
        assert.equal(request.tools?.length, 6);
        assert.equal(request.messages[0].content, reportWriteSystem(paper));
        assert.equal(request.messages[0].content.split(RESEARCH_GUIDANCE).length - 1, 1);
      }
      const toolResult = requests[1].messages.find(message => message.role === "tool")!.content;
      assert.match(toolResult, /Unknown tool/);
      assert.match(toolResult, /Time left for this answer: about \d+ seconds\./);
      assert.deepEqual(result.meta?.toolExecutions, { unknown_d151_tool: 1 });
      assert.equal(result.meta?.toolRounds, 1);
      assert.equal(result.meta?.toolResultChars, toolResult.length);
      assert.equal(result.meta?.toolRoundDetails?.[0].tools[0].name, "unknown_d151_tool");
      assert.equal(result.meta?.model, "served-model-id");
    }, true);
  });
}
