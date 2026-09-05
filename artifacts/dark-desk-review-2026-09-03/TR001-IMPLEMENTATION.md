# TR-001 implementation receipt

This repository patch corrects Reddit request scheduling and short-link routing. It does not claim deployment, live Reddit availability, or coordination across separate processes. The historical operator receipts remain unchanged.

## Behavior

Before: three concurrent calls could send at [0, 8003, 8003]ms with two in flight. Short links were rewritten to old.reddit.com instead of resolved. A document 429 doubled spacing but imposed no shared minute cooldown. Redirect sends bypassed pacing.

After: one process-shared promise queue owns each actual send through response-body completion. Every send waits at least 8 seconds after the previous send; a 429 imposes a shared 60 second cooldown and doubles spacing up to 60 seconds. Already queued callers observe updated cooldowns. Failed transport/body reads release the queue. Sweep, RSS, fallback and redirect hops share the same queue; sweep still stops after three 429 s.

redd.it resolves through bounded, validated Reddit-only redirects to a canonical thread RSS URL. Fragments and already-RSS targets normalize correctly. Generic non-Reddit behavior retains the existing guarded transport and redirects; no dependencies, version, schema or UI changes.

## Evidence

Existing affected baseline:29 passed, 0 failed. New regression suite against old source:4 passed, 13 failed. A later independent review found the fragment edge; three normalization regressions failed before its correction and passed afterward.

Independent reviewer ran:

    node --experimental-strip-types --test --test-concurrency=1 src/lib/news/reddit-pacing.test.ts src/lib/news/fetch-url.test.ts src/lib/news/reddit.test.ts

53 passed, 0 failed, 0 skipped. Its real-clock mocked requests started at [0, 8007, 16020]ms, max in flight 1. Tests mock external transport/DNS; no real Reddit request was needed. Queue-bypass, cooldown-removal and early-body-release mutations were detected. The independent body mutation produced '2 !== 1' concurrent requests; byte-exact restoration made the same check pass.

Full local npm test (Node 24.17.0, Windows; DATABASE_URL and TEST_POSTGRES_ADMIN_URL empty, live-model opt-in cleared):

    scripts: tests 287, pass 285, fail 0, skipped 2
    application: tests 1047, pass 1012, fail 0, skipped 35

Total 1297 passed, 0 failed, 37 skipped. Skipped opt-in integration/provider checks are not local passes. GitHub's separate real-Postgres and browser jobs must pass on the exact commit.

npm run lint:0 errors, 11 warnings in unchanged files. npm run typecheck:exit 0. npm run build:exit 0; environment wrapper reported PGLite and migrator skipped absent DATABASE_URL. Scoped independent engineering/test/runtime and docs/response-contract reviews found no unresolved acceptance blocker. No UI was changed or newly browser-walked. Raw local logs accompany the owner's task output.

## Remaining boundary

CI must be confirmed for this exact commit before calling it ready to promote. No version bump: owner bundles the release. Only the separate local Claude session on the Halo, when directed by the owner, performs staging and promotion. This remote work performs neither. Verify staged mixed tip-scan/dig behavior and honest rate-limit display there; external Reddit acceptance is not guaranteed by local timing tests.

Pre-existing separate follow-up: fewer than three failed sweep feeds can still yield incomplete=false and a Nothing new message. This patch preserves the existing response contract; correcting that UI/result meaning is outside TR-001.
