import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanPreflight } from "./preflight.ts";

/**
 * What a new editor meets when nothing is configured yet.
 *
 * An outside audit walked the paper with no model provider present and found
 * the core action dead-ends: Scan enqueued a job, fetched every watched
 * source, and only then failed at the model call. The desk showed a failure
 * with no setup guidance and told the editor to try again — which cannot
 * work, because nothing about trying again installs a model.
 *
 * A first-run dead-end on the core feature is a Blocker. These tests pin the
 * three things that make it not one: refuse before spending the work, say
 * which of the failure kinds it is, and never invite a retry that cannot help.
 */
describe("scan preflight", () => {
  it("lets the scan run when a provider answered", () => {
    const p = scanPreflight({ ok: true, label: "Claude Code" });
    assert.equal(p.ok, true);
  });

  it("refuses before any work when nothing is configured", () => {
    const p = scanPreflight({
      ok: false,
      error:
        "AI is not available. Set ANTHROPIC_API_KEY for Claude (default), or XAI_API_KEY for Grok, or LLM_BASE_URL for any OpenAI-compatible gateway.",
    });
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.equal(p.kind, "unconfigured");
    assert.equal(p.retryable, false, "trying again does not configure a model");
  });

  it("tells apart a missing CLI from nothing being configured", () => {
    const p = scanPreflight({
      ok: false,
      error:
        "Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code) and sign in with `claude`, set CLAUDE_CLI_PATH to its binary, or set ANTHROPIC_API_KEY instead.",
    });
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.equal(p.kind, "cli-missing");
    assert.equal(p.retryable, false);
  });

  it("keeps Codex installation and provider login failures actionable", () => {
    const missing = scanPreflight({
      ok: false,
      error: "Codex is not installed. Install the Codex CLI, then sign in from Codex and try again.",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.kind, "codex-missing");
      assert.match(missing.guidance, /install the Codex CLI/i);
      assert.equal(missing.retryable, false);
    }

    const signedOut = scanPreflight({
      ok: false,
      error: "Codex is signed out. Open Codex, sign in, then try again.",
    });
    assert.equal(signedOut.ok, false);
    if (!signedOut.ok) {
      assert.equal(signedOut.kind, "provider-auth");
      assert.match(signedOut.guidance, /sign in/i);
      assert.equal(signedOut.retryable, false);
    }
  });

  it("treats a timeout as the one kind worth trying again", () => {
    const p = scanPreflight({ ok: false, error: "Claude Code request timed out after 150s" });
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.equal(p.kind, "timeout");
    assert.equal(p.retryable, true, "a timeout is the only kind a retry can fix");
  });

  /**
   * The audit's specific complaint: the editor was told to retry, and no
   * amount of retrying installs a model. Guidance has to name the actual
   * next action.
   */
  it("gives a next step a person can actually take", () => {
    for (const err of [
      "AI is not available. Set ANTHROPIC_API_KEY for Claude.",
      "Claude Code CLI not found. Install it (npm i -g @anthropic-ai/claude-code).",
    ]) {
      const p = scanPreflight({ ok: false, error: err });
      assert.equal(p.ok, false);
      if (p.ok) continue;
      assert.ok(p.guidance.length > 20, "guidance must say something useful");
      assert.doesNotMatch(
        p.guidance,
        /\btry again\b|\bretry\b/i,
        "must not invite a retry that cannot help",
      );
      assert.match(
        p.guidance,
        /ANTHROPIC_API_KEY|LLM_BASE_URL|claude|setup|docs\//i,
        "guidance must name a concrete thing to set or install",
      );
    }
  });

  it("keeps the provider's own message so the operator sees the detail", () => {
    const detail = "Claude Code CLI not found. Install it and sign in.";
    const p = scanPreflight({ ok: false, error: detail });
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.equal(p.detail, detail);
  });

  it("classifies an unrecognised failure rather than guessing", () => {
    const p = scanPreflight({ ok: false, error: "some new failure nobody has seen" });
    assert.equal(p.ok, false);
    if (p.ok) return;
    assert.equal(p.kind, "unknown");
    assert.equal(p.retryable, false, "unknown is not assumed retryable");
  });
});
