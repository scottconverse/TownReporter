import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { looksLikeProviderAuthFailure, providerAuthTarget, scanPreflight } from "./preflight.ts";

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

  it("keeps Codex installation failures actionable", () => {
    const missing = scanPreflight({
      ok: false,
      error:
        "Codex is not installed. Install the Codex CLI, then sign in from Codex and try again.",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.kind, "codex-missing");
      assert.match(missing.guidance, /install the Codex CLI/i);
      assert.equal(missing.retryable, false);
    }
  });

  it("gives Codex-specific recovery without losing its signed-out diagnostic", () => {
    const detail = "Codex is signed out. Open Codex, sign in, then try again.";
    const signedOut = scanPreflight({
      ok: false,
      error: detail,
    });
    assert.equal(signedOut.ok, false);
    if (!signedOut.ok) {
      assert.equal(signedOut.kind, "provider-auth");
      assert.match(signedOut.guidance, /open Codex/i);
      assert.match(signedOut.guidance, /sign in/i);
      assert.match(signedOut.guidance, /nothing was queued or spent/i);
      assert.equal(signedOut.detail, detail);
      assert.equal(signedOut.retryable, false);
    }
  });

  it("gives Claude Code-specific recovery without losing its expired-OAuth diagnostic", () => {
    const detail = "Claude Code OAuth session expired.";
    const expired = scanPreflight({ ok: false, error: detail });
    assert.equal(expired.ok, false);
    if (!expired.ok) {
      assert.equal(expired.kind, "provider-auth");
      assert.match(expired.guidance, /open Claude Code/i);
      assert.match(expired.guidance, /sign in/i);
      assert.match(expired.guidance, /nothing was queued or spent/i);
      assert.equal(expired.detail, detail);
      assert.equal(expired.retryable, false);
    }
  });

  it("classifies rejected Anthropic credentials as provider auth, not missing configuration", () => {
    const detail =
      "Claude rejected its credentials. Update ANTHROPIC_API_KEY or use a signed-in Claude Code session.";
    const rejected = scanPreflight({ ok: false, error: detail });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.kind, "provider-auth");
      assert.equal(rejected.retryable, false);
      assert.equal(rejected.detail, detail);
      assert.match(rejected.guidance, /ANTHROPIC_API_KEY|Claude Code/i);
      assert.doesNotMatch(rejected.guidance, /no model is set up|no model configured/i);
    }
  });

  it("becomes ready on a fresh probe after either provider signs in", () => {
    for (const [detail, label] of [
      ["Codex is signed out. Open Codex, sign in, then try again.", "Codex Sol"],
      ["Claude Code OAuth session expired.", "Claude Opus"],
    ] as const) {
      assert.equal(scanPreflight({ ok: false, error: detail }).ok, false);
      assert.deepEqual(scanPreflight({ ok: true, label }), { ok: true });
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

describe("provider auth detection is shared with the desk copy", () => {
  it("recognises the live 2026-09-02 expired-token error and names Claude", () => {
    const live =
      "Claude Code error (401): Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.";
    assert.equal(looksLikeProviderAuthFailure(live), true);
    assert.equal(providerAuthTarget(live), "claude");
    const p = scanPreflight({ ok: false, error: live });
    assert.equal(p.ok, false);
    if (!p.ok) {
      assert.equal(p.kind, "provider-auth");
      assert.equal(p.retryable, false);
      assert.match(p.guidance, /Claude Code needs you to sign in again/);
    }
  });

  it("does not call an ordinary failure an auth failure", () => {
    assert.equal(looksLikeProviderAuthFailure("Claude Code request timed out after 150s"), false);
    assert.equal(looksLikeProviderAuthFailure("empty model response"), false);
    assert.equal(looksLikeProviderAuthFailure(""), false);
    assert.equal(looksLikeProviderAuthFailure(null), false);
  });
});
