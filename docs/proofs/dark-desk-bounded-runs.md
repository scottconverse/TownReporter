# Dark Desk bounded runs and model controls

Date: 2026-09-15

## Goal

Give the editor an explicit choice of every supported Codex and Claude model, make long investigations stop for editorial reasons or hard run limits, preserve completed stages across provider failover, report real progress and usage, and keep the final brief within the evidence status the file actually earned.

## Implementation evidence

- The shared picker exposes Codex Astra, Sol, Terra, and Luna; Claude Fable, Opus, Sonnet, and Haiku; and Local model on Story, Scan, Opinion, and Dark Desk.
- Dark Desk Automatic uses a configured gateway exclusively when present. Otherwise it starts with Claude Sonnet and can retry a timed-out or signed-out unfinished stage on Codex Terra.
- Research, synthesis, verification, and brief generation share one wall-clock, model-call, search, and document-read budget.
- Research stops on evidence sufficiency, diminishing returns, repeated sources, no materially new finding, frontier exhaustion, or a hard budget.
- Frontier ingestion rejects fragments, merges equivalent questions, caps additions per hop, and defers lower-priority questions instead of deleting them.
- Each run stores provider, model, duration, outcome, timeout status, and provider-reported token counts. The Dark Desk shows live call, search, document, elapsed-time, and token counters with the current stage.
- Brief headlines truncate at a word boundary. Incomplete evidence is labelled `Unverified lead` and certainty terms are removed.
- The old internal database status `verified` remains for compatibility, but the editor-facing label is `Protocol complete`. That label means the four-search/four-gate protocol completed; it does not claim the underlying facts are true.

## Delegation

- Lead and integration: Codex Astra (`gpt-6-astra`).
- Shared model picker and registry: Codex Luna (`gpt-5.6-luna`).
- Bounded investigation engine: Codex Sol (`gpt-5.6-sol`).
- Provider usage metadata and independent final review: Codex Terra (`gpt-5.6-terra`).

No live Claude or Codex generation was used for verification. Provider behavior was exercised with fixtures, fakes, and the built application so this work did not consume the editor's Claude weekly allowance.

## Verification

- TypeScript: `npx tsc --noEmit` passed.
- Focused changed-file logic suite: 226 passed, 0 failed.
- Dark database, verification, preferences, preflight, and job suite: 82 passed, 0 failed, 1 skipped. The skipped test requires `TEST_POSTGRES_ADMIN_URL` and drops/recreates a scratch database; CI supplies it.
- Production build: `npm run build` passed.
- Built-server smoke: all public routes, browser hydration, unauthenticated desk redirect, console checks, and outside-request check passed.
- Dark picker walkthrough uses a fake Claude CLI and starts no research run. It verifies the full picker, explicit no-fallback copy, the Sonnet-to-Terra Automatic ladder, and persisted per-provider timeout controls.

## Limits of this proof

Fable availability was validated as a model selector accepted by the installed Claude CLI and through provider-routing tests. No paid live generation was made. Exact token counts appear only when a provider reports them; the interface leaves unavailable counts unavailable instead of estimating them.
