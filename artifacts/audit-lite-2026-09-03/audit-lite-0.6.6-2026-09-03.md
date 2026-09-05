# Audit Lite — TownReporter 0.6.6 (CI browser walks → built server, `FAKE_CODEX_DELAY_MS`)
**Date:** 2026-09-03
**Scope:** `git -C townreporter-dev diff 03d2043..b0eb15a` (commits 78c5709 + b0eb15a) — converts every CI browser-walk job (except the deliberate `smoke-dev` job) from `npm run dev` to a build + `npm start`, fixes `scripts/failover-e2e.mjs`'s server-fn response matcher for the built server's URL shape, and adds `FAKE_CODEX_DELAY_MS` to `scripts/fakes/fake-codex-cli.mjs`. Plus the routine 0.6.5→0.6.6 doc/version bump.
**Reviewer:** Claude (audit-lite)
**Method:** Static read of the full diff plus adjacent code (`.github/workflows/ci.yml`, `scripts/failover-e2e.mjs`, `scripts/fakes/fake-codex-cli.mjs`, `src/routes/desk.story.$leadId.tsx`, `src/lib/news/jobs.ts`, `src/lib/news/desk.ts`, `scripts/ci-jobs.test.mjs`, `scripts/smoke-built-server.mjs`, `package.json`). No runtime smoke was executed — see Runtime dimension.

## TL;DR
Ship with one caveat. The CI-to-built-server migration and the server-fn matcher fix are well-reasoned, well-evidenced (dated, specific citations), and consistently applied — this is good, honest infra work fixing a real flakiness class. The one open concern is that the new `FAKE_CODEX_DELAY_MS: "1500"` fix is racing a 1500ms fake-CLI delay against a 2000ms client poll interval with no margin and no explicit synchronization — a plausible source of the exact kind of intermittent CI flake this release is trying to eliminate. Nothing here is a Blocker or reachable production issue; the whole diff is CI/test infrastructure and docs.

## Severity rollup
- Blocker: 0
- Critical: 0
- Major: 1
- Minor: 0
- Nit: 1

## Findings

### FINDING-001 Major: `FAKE_CODEX_DELAY_MS` races the UI's 2000ms poll interval with no safety margin
**Dimension:** Tests
**Evidence:**
- `.github/workflows/ci.yml` (failover job): `FAKE_CODEX_DELAY_MS: "1500"`, and no `FAKE_CLAUDE_DELAY_MS` is set for this job, so the fake Claude CLI's `-p` failure path returns immediately (`scripts/fakes/fake-claude-cli.mjs:78-83` — delay only applies if the env var is set and non-zero).
- `src/routes/desk.story.$leadId.tsx:83-84`: `refetchInterval: waiting ? 2000 : false`.
- `src/lib/news/jobs.ts:347`: `void drainQueuedJobs();` — fired unawaited immediately after a job is enqueued, so the background draft/failover work starts essentially at the same instant the client sets `waitingSince` (the mutation's `onSuccess`/`onMutate` at `desk.story.$leadId.tsx:195`), not after some separate polling loop's own delay.
- `scripts/fakes/fake-codex-cli.mjs` (new): the transient "Switched to Codex Terra…" stage is only observable for the `FAKE_CODEX_DELAY_MS` window before the job completes.
- Net timeline: Claude fails near-instantly (no delay set) → switch stage is written → Codex "thinks" for 1500ms → job completes. The client's first automatic poll after `waiting` becomes true fires at ~2000ms. The observable window (roughly 0–1500ms from job start) and the poll cadence (first tick at ~2000ms, then every 2000ms) are close enough in magnitude that whether any poll lands inside the window depends on exact server/DB/browser overhead on the runner that run — not on a deterministic guarantee.
**Why it matters:** This is precisely the pattern the operator's own standing rule about live incidents flags: a fixed-timer race standing in for a real synchronization signal. If the window is occasionally missed on a slower/more-loaded CI runner, `failover-e2e.mjs`'s `sawSwitch` assertion (scripts/failover-e2e.mjs, "the switch happened" block) fails intermittently — reintroducing exactly the kind of CI flakiness this whole 0.6.6 release exists to remove, just relocated from dev-server hydration timing to fake-CLI/poll timing.
**Fix path:** Either (a) widen the margin well past one poll period — e.g. `FAKE_CODEX_DELAY_MS >= 4500` (≥ 2 full poll cycles) rather than 1500ms against a 2000ms cycle, or (b) remove the race entirely: have the walk assert against a DB/job-history read (or a test-only "job stage history" array) instead of relying on catching a transient value on the wire during a live poll. Cheapest fix: bump the delay; most robust fix: make the assertion insensitive to poll timing.
**Blast radius:**
- **Adjacent code:** No other e2e script uses this transient-stage-over-polling pattern (grep confirms `_serverFn` shape-matching only lives in `failover-e2e.mjs`), so this doesn't propagate — but the same 2000ms poll interval is shared by every other job-status UI on this route, so any future walk built the same way inherits the same risk.
- **Shared state:** None — purely a CI script + fake-CLI env var, not production code or shared data.
- **User-facing change:** None. This only affects a CI job's reliability, not anything a reader or editor sees.
- **Migration concern:** None.
- **Tests to update:** `scripts/failover-e2e.mjs`'s wait loop, or the `FAKE_CODEX_DELAY_MS` value in `.github/workflows/ci.yml`.

## What's working
- The core diagnosis is sound and specifically evidenced: the CHANGELOG entry and the `scripts/failover-e2e.mjs` comment cite a dated, concrete empirical finding ("confirmed 2026-09-03 against a real `npm run build` + `npm start` — e.g. `/_serverFn/3ae2ced499ba...dcdaa?payload=...`") rather than a guessed explanation — exactly the standard this operator holds work to.
- The shape-based `getLead` matcher replacement (`typeof job.stage === "string" && typeof job.model_choice === "string"`) is grounded in the real schema: `desk_jobs.model_choice` and `.stage` are both `not null` with defaults (`src/lib/news/jobs.ts:44-48`, `132-137`), so the check is a real invariant, not a coincidence of one dev-server response shape.
- `PORT`/`HOST` env vars are correctly and consistently threaded into every job switched from `npm run dev` (which hardcoded `--port 8080 --host 127.0.0.1` or took `-- --port N`) to `npm start` (which only reads env, per `package.json`'s `"start": "node scripts/with-app-env.mjs node .output/server/index.mjs"`) — verified across all 9 touched jobs in `.github/workflows/ci.yml`, no job was left pointed at the wrong port.
- `scripts/ci-jobs.test.mjs`'s "every job that runs a desk-claiming walk starts its own server" check already accepts `/npm run dev|npm start/`, so this migration doesn't silently break that existing meta-test.
- The `smoke-dev` job ("Documented dev path works in a browser") was deliberately left on `npm run dev`, and both the CHANGELOG and `docs/setup.md` explicitly explain why (it exists to prove the README's own quick-start command, not just page rendering) — no doc drift, no silent inconsistency.
- Comments describing the PID-teardown rationale (`kill "$DEV_PID"`) were correctly rewritten to describe the new `npm start` process tree instead of leaving a stale description of `vite dev`.
- Version/docs bump (`README.md`, `CHANGELOG.md`, `SELF-HOSTING.md`, `docs/editor.md`, `docs/manual.md`, `docs/setup.md`, `docs/index.html`, `package.json`, `src/lib/version.ts`) is complete and internally consistent — no file was missed, no version left at 0.6.5.
- No job in this diff was pointed at a real Postgres beyond CI's own ephemeral service containers (`DATABASE_URL: postgres://postgres:ci@127.0.0.1:5432/...` scoped to CI-only jobs; the failover, dark-picker, and other fake-CLI jobs run with `DATABASE_URL` unset, i.e. embedded PGLite) — nothing in this change touches or assumes the operator's own 5433 instance.

## Watch items
- `scripts/failover-e2e.mjs`'s untouched context comment still says the response's `.failover_note` field is "(0.6.8)" while the current release is 0.6.6 — pre-existing (not part of this diff) and harmless, but a forward-dated version reference worth cleaning up next time that file is touched.
- The shape-based matcher (`stage` + `model_choice` both strings) is intentionally broader than "getLead responses only" — it will also match any other server function that happens to return an object shaped like a `desk_jobs` row (e.g. the lead-filing response). That's fine today because the walk's assertions are semantic (specific stage text, `status === "completed"`), but if a future server function starts returning a differently-sourced object that happens to carry both fields as strings, `jobSnapshots` would start absorbing noise. Not worth a fix now — worth remembering if this walk gets flaky for an unrelated reason later.

## Runtime
Not executed. This diff's actual effect (does the failover walk go green against a real `npm run build` + `npm start`) can only be proven by running the Playwright walk end-to-end, which needs a full `npm run build` and Chromium — out of proportion for an audit-lite static pass, and the operative risk identified (FINDING-001) is a timing-margin question that a single passing run wouldn't disprove anyway (it's intermittent by nature). If a runtime smoke is wanted, it should build once, then run `FAILOVER_BASE_URL=http://127.0.0.1:3450 CLAUDE_CLI_PATH=scripts/fakes/fake-claude-cli.mjs CODEX_CLI_PATH=scripts/fakes/fake-codex-cli.mjs FAKE_CLAUDE_SIGNED_IN=1 FAKE_CLAUDE_FAIL_PROMPTS=1 FAKE_CODEX_SIGNED_IN=1 FAKE_CODEX_DELAY_MS=1500 DATABASE_URL="" PORT=3450 HOST=127.0.0.1 npm start` on a spare port ≥3430, run `node scripts/failover-e2e.mjs` several times back-to-back to check for the flake FINDING-001 predicts, then kill the server by PID — never touching 3000/5432/5433 or the postgres service.

## Escalation recommendation
No escalation needed. One Major, no Blocker/Critical, findings don't span multiple dimensions deeply, and the change is CI/test infrastructure with zero production blast radius. Fix FINDING-001's timing margin (cheap: bump `FAKE_CODEX_DELAY_MS`, or better: assert off job history instead of live-poll timing) before treating this walk as a hard release gate; audit-team is not warranted for a change this scoped.
