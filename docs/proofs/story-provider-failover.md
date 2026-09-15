# Story provider failover proof

## Scope

Story Automatic now moves from Claude Opus to Codex Terra when the active
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
  uploaded a real text document. Claude reported ready, then returned a
  provider-shaped 429 during document interpretation. Automatic switched to
  Codex Terra, the running workbench displayed the durable switch reason, the
  completed job retained that reason, and the exact marker from the uploaded
  file appeared in the finished story.

## Review

The Luna first pass was rejected by an independent Sol reviewer because
document interpretation was still outside the failover boundary, stale UI and
batch restrictions remained, ordinary unavailable messages were missed, and
one terminal error lost the attempted-provider detail. Sol then rejected the
integrated candidate again because a stale Story commit test still enforced
the removed Codex supplied-material restriction. Those findings were corrected.

Sol independently accepted the final integrated tree after a production build,
focused routing and supplied-document suites, TypeScript, focused ESLint, and a
separate production-build browser run on isolated port 3499. That run uploaded
a real text document, forced Claude's document-reading call to return a 429,
observed the running provider-switch state, and required Codex Terra to carry
the upload's exact marker (`AUTOMATIC_DOCUMENT_MARKER_1789500258003`) into the
finished Story body. Sol reported no material defect remaining in this change.
