# Story provider failover proof

## Scope

Story Automatic now moves from Codex Terra to Claude Sonnet when the active
provider reaches a usage limit, becomes unavailable, loses its login, times
out, or returns no output. Explicit model choices and content refusals remain
terminal. The same recovery boundary covers uploaded-document interpretation
and final reporting/writing. Supplied-only scope continues to skip discovery
and external searches, while permitting every Story model to read the retained
material.

## Acceptance

- Focused routing, document-stage, batch, scope, provider-commit, picker, and
  port tests passed.
- TypeScript typecheck passed.
- Production build passed.
- `scripts/story-quota-failover-e2e.mjs` passed against the built server with an
  isolated PGLite database and process-level fake provider CLIs. The browser
  uploaded a real text document. Codex reported ready, then returned a
  provider-shaped quota error during document interpretation. Automatic switched to
  Claude Sonnet, the running workbench displayed the durable switch reason, the
  completed job retained that reason, and the exact marker from the uploaded
  file appeared in the finished story.

## Review

The Luna first pass was rejected by an independent Sol reviewer because
document interpretation was still outside the failover boundary, stale UI and
batch restrictions remained, ordinary unavailable messages were missed, and
one terminal error lost the attempted-provider detail. Sol then rejected the
integrated candidate again because a stale Story commit test still enforced
the removed Codex supplied-material restriction. Those findings were corrected.

The production-build browser run uploads a real text document, forces Codex
Terra's document-reading call to return a provider quota error, observes the
running provider-switch state, and requires Claude Sonnet to carry the upload's
exact marker into the finished Story body. The process-boundary providers are
controlled fakes; this proof spends no live provider tokens.
