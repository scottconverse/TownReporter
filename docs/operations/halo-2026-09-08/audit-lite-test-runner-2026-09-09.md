# Test-runner argument repair — independent audit

Scope: `scripts/run-tests-safe.mjs` and `scripts/run-tests-safe.test.mjs`.
Reviewer: separate Codex subagent, read-only audit-lite; no full suite, app
build, server, provider, or production operation. Parent transcribed its result.

Verdict: ship this bounded tooling repair. Blocker 0, Critical 0, Major 0,
Minor 0, Nit 0. This is not a whole-product release verdict.

The runner previously ignored `npm test -- --run <file>` and ran both complete
suite groups. Extra arguments now exit 2 before spawning, with the correct
focused command. Plain `npm test` retains both original isolated groups.
The entry-point tests replace child spawning before imports load; no real
database or full suite starts even when the regression test fails.

Independent verification:

```text
node scripts/with-app-env.mjs node --test scripts/run-tests-safe.test.mjs
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 249.4653
```

No error or warning emitted. Parent's pre-fix run of that same command had
3 tests, 1 pass, 2 failures (duration268.3622ms). Both failing assertions
expected exit2 but observed exit0. Parent's wider wrapper regression command
passed18/19 with the pre-existing Windows symlink case skipped; the incident
record preserves those exact summaries and scope. No test was weakened.

An actual unmocked `node scripts/run-tests-safe.mjs --run
src/lib/news/search-web.test.ts` subsequently printed the correction and
reported Node exit code2. Only the test runner changed; the frozen application
output used for editorial acceptance was not rebuilt.
