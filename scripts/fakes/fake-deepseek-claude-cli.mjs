#!/usr/bin/env node
// Hermetic D153 fixture. Echo booleans only for credentials; never credential values.
const args = process.argv.slice(2);
let user = "";
for await (const chunk of process.stdin) user += chunk;
const model = args[args.indexOf("--model") + 1];
const systemIndex = args.indexOf("--system-prompt");
const env = process.env;
const modelKeys = ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"];
let relayStatus;
if (env.FAKE_D153_RELAY === "1") {
  const response = await fetch(env.ANTHROPIC_BASE_URL + "/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}` },
    body: JSON.stringify({ model, thinking: { type: "enabled", budget_tokens: 100 }, output_config: { effort: "high", format: "kept" }, messages: [{ role: "user", content: user }], stream: true }),
  });
  relayStatus = response.status;
  await response.text();
}
const result = {
  model, user, system: systemIndex < 0 ? null : args[systemIndex + 1], args,
  relayOrigin: env.ANTHROPIC_BASE_URL ? new URL(env.ANTHROPIC_BASE_URL).origin : null,
  authMatchesExpected: env.ANTHROPIC_AUTH_TOKEN === env.FAKE_D153_EXPECTED_TOKEN,
  apiKeyEmpty: env.ANTHROPIC_API_KEY === "",
  modelsPinned: modelKeys.every(key => env[key] === model),
  nonessentialDisabled: env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1",
  contextWindow: env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
  hasDeepSeekDefaults: modelKeys.slice(1).some(key => key in env),
  relayStatus,
};
process.stdout.write(JSON.stringify({ result: JSON.stringify(result), num_turns: 3, model: "unexpected-cli-alias" }));
