import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAUDE_CLI_MISSING,
  claudeCliCandidates,
  parseCliEnvelope,
} from "./ai-claude-code.server.ts";

describe("parseCliEnvelope", () => {
  it("pulls the answer out of a success envelope", () => {
    const raw = JSON.stringify({ is_error: false, result: '{"headline":"Hi"}', subtype: "success" });
    assert.deepEqual(parseCliEnvelope(raw), { ok: true, text: '{"headline":"Hi"}' });
  });

  it("trims surrounding whitespace", () => {
    const raw = `\n  ${JSON.stringify({ is_error: false, result: "  PONG  " })}  \n`;
    assert.deepEqual(parseCliEnvelope(raw), { ok: true, text: "PONG" });
  });

  it("reports an error envelope rather than returning its text as an answer", () => {
    const raw = JSON.stringify({
      is_error: true,
      result: "rate limit reached",
      api_error_status: 429,
    });
    const out = parseCliEnvelope(raw);
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.match(out.error, /429/);
      assert.match(out.error, /rate limit/);
    }
  });

  it("treats an empty result as a failure, not as empty copy", () => {
    const out = parseCliEnvelope(JSON.stringify({ is_error: false, result: "" }));
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /empty/i);
  });

  it("does not throw on unreadable output", () => {
    const out = parseCliEnvelope("not json at all");
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /unreadable/i);
  });

  it("does not throw on no output", () => {
    const out = parseCliEnvelope("   ");
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /nothing/i);
  });

  it("ignores a non-string result", () => {
    const out = parseCliEnvelope(JSON.stringify({ is_error: false, result: { a: 1 } }));
    assert.equal(out.ok, false);
  });
});

describe("claudeCliCandidates", () => {
  it("honours an explicit CLAUDE_CLI_PATH and looks nowhere else", () => {
    const prev = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = "/custom/claude";
    try {
      assert.deepEqual(claudeCliCandidates(), ["/custom/claude"]);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CLI_PATH;
      else process.env.CLAUDE_CLI_PATH = prev;
    }
  });

  it("offers real candidates when nothing is pinned", () => {
    const prev = process.env.CLAUDE_CLI_PATH;
    delete process.env.CLAUDE_CLI_PATH;
    try {
      const found = claudeCliCandidates();
      assert.ok(found.length > 1);
      assert.ok(found.every((p) => p.includes("claude")));
    } finally {
      if (prev !== undefined) process.env.CLAUDE_CLI_PATH = prev;
    }
  });
});

describe("CLAUDE_CLI_MISSING", () => {
  it("tells the operator what to actually do", () => {
    assert.match(CLAUDE_CLI_MISSING, /npm i -g @anthropic-ai\/claude-code/);
    assert.match(CLAUDE_CLI_MISSING, /CLAUDE_CLI_PATH/);
    assert.match(CLAUDE_CLI_MISSING, /ANTHROPIC_API_KEY/);
  });
});
