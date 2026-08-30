# Test Suite Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-30
**Role:** Test Engineer
**Scope audited:** `scripts/**/*.test.mjs`, `src/**/*.test.ts`, `scripts/*-e2e.mjs`, `.github/workflows/ci.yml`
**Auditor posture:** Adversarial

---

## TL;DR

The claims in the TE-01..TE-06 change wave hold up under direct verification: I ran `npm test` cold and got the exact claimed 608 tests / 587 pass / 0 fail / 21 skipped, read every file named in the claims (not just grepped for it), and cross-checked `ci.yml` line-by-line against what the test wave says is wired in. Every one of RUN_LIVE_MODEL_TESTS gating, the manifest-to-glob change, coerce-draft.test.ts, voice-boundary.test.ts, the desk-flows/delete-corrections/sources-reach-the-reader e2e jobs, and ops-scripts.test.mjs is real, behavioral, and does what it claims — this is not a hollow-green suite. The most striking thing about this codebase is that the test suite audits itself: `newsroom-security.test.mjs`, `ci-jobs.test.mjs`, and `docs-dont-count-tests.test.mjs` are meta-tests that fail the build if a future edit reintroduces exactly the defects a prior audit found (live model calls escaping the gate, a desk-claiming e2e script losing its own server, a doc re-pinning a test count). The residual risk is narrower than "is this suite honest" — it's coverage gaps around concurrency/multi-editor races, and one platform blind spot (Windows-only ops scripts) that CI on Linux cannot exercise beyond static/parse checks, which the suite's own comments say plainly.

## Severity roll-up (tests)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| Major | 1 |
| Minor | 2 |
| Nit | 1 |

## What's working

- **The live suite count is real, not aspirational.** `npm test` on this checkout, cold, produced `tests 608 / suites 194 / pass 587 / fail 0 / cancelled 0 / skipped 21 / todo 0`, matching the claimed 608/587/0/21 exactly. No retries, no flake observed in the run.
- **RUN_LIVE_MODEL_TESTS gating is real and self-enforcing.** `src/lib/news/scan-pass.test.ts:118-125` checks `process.env.RUN_LIVE_MODEL_TESTS !== "1"` and skips with a message rather than calling a model. `scripts/newsroom-security.test.mjs:480-496` walks every `.test.ts` file under `src/lib/news`, and for any file that calls `grokChat(` or `claudeCodeChat(`, asserts it is either gated by `RUN_LIVE_MODEL_TESTS` or disables the provider (`TOWNREPORTER_CLAUDE_CODE="0"`). This is not a comment-based check; it is a structural grep over source that runs on every `npm test`, so a future test file that adds a live call without gating it fails the build. I confirmed `npm test` made no live-model calls in my run (no network activity attributable to a model call, no cost-relevant delay pattern, and the gate test itself passed).
- **The manifest-to-glob change is real and closes a documented gap.** `package.json`'s `test` script is `node --test "scripts/**/*.test.mjs" && node --experimental-strip-types --test --test-concurrency=1 "src/**/*.test.ts"` — a glob, not a hand list. `scripts/docs-dont-count-tests.test.mjs`'s sibling in `newsroom-security.test.mjs` ("every test file on disk is discovered by npm test") exists specifically to prevent the old failure mode (a test file present on disk but absent from a hand-maintained list) from recurring silently.
- **coerce-draft.test.ts is a real, meaningful fix, not a placeholder.** It exercises `coerceDraft`, `extractQuoted`, `looksLikeJsonDraft`, and `unpackStoredDraft` against a genuine failure mode: a model returning JSON with unescaped inner quotes, and a draft that was stored with the entire JSON blob crammed into the `body` field. The assertions check that the raw JSON never leaks to `body` (`d.body.startsWith("{")` is false, `looksLikeJsonDraft(d.body)` is false) — this is the exact defect class ("a model's raw JSON reaching the page as the story body") the file's own header comment describes, and the assertions test for it directly rather than just importing the module.
- **voice-boundary.test.ts is a genuine subprocess/data-boundary contract test, not a mock-everything test.** It calls the real `findVoiceFile()` against real relative, in-repo, and outside-repo paths (using `tmpdir()` and real file writes/reads), and asserts the returned object contains only `{bytes, path}` — literally checking `Object.keys(result.voice).sort()` to catch a future field like `contents` or `text` leaking the file. The "voice and a tool can never share a call" section calls the real exported `claudeCodeChat` with a `CLAUDE_CLI_PATH` pointed at a nonexistent binary (so no process spawns, no cost), and asserts the invariant fires before CLI lookup. Two of the six checks in the file are honest source-shape assertions (not behavioral) for code paths the file's own comment says would require mocking a process spawn or a DB-touching import chain to test behaviorally — this is disclosed, not hidden, and is a reasonable trade for now.
- **The e2e browser flows are real and drive an actual Chromium against an actual running server, wired into CI.** `ci.yml` has five separate jobs (`lifecycle`, `smoke-built`, `smoke-dev`, `desk-flows`, `delete-corrections`, `sources-reach-the-reader`) each of which starts its own server (`npm run dev` or `npm run build && npm start`), polls with curl until it's up, and then runs a Playwright script against it. `scripts/desk-flows-e2e.mjs` fills real form fields (`page.getByLabel("Email").fill(...)`), clicks real buttons, and asserts on rendered text and DOM state — not on mocks. `scripts/smoke-built-server.mjs` specifically checks that `/login` does not get stuck on "Opening…" (the actual hydration blocker a prior audit caught) and that an unauthenticated `/desk` visit does not render the desk.
- **`ops-scripts.test.mjs` (TE-06) is real static/behavioral verification, honestly scoped to what CI-on-Linux can check.** Its own header states plainly: "CI runs on Linux and cannot execute PowerShell meaningfully, so this checks what is checkable everywhere." It checks required files exist, doc references resolve, ASCII-only content (a real mojibake bug it cites), no `Stop-Process -Name` (a real incident it cites), `@()`-wrapped CIM count checks (a real truthiness bug it cites), and — on Windows only, via a `skip` when not on win32 — that the scripts actually parse via `System.Management.Automation.Language.Parser`. This is a textbook honest disclosure of a coverage boundary rather than a suite that pretends to cover something it cannot.
- **Meta-tests actively prevent regression of exactly the defects prior audits found.** `scripts/ci-jobs.test.mjs` parses `ci.yml` and asserts no job runs two desk-claiming e2e scripts against the same server (the literal cause of a prior Blocker where the second script's sign-up form did not exist because the first script had already claimed the desk). `scripts/docs-dont-count-tests.test.mjs` fails the build if any doc states a hardcoded test count or runtime, because those numbers were caught being stale in a prior audit (528 vs. real 800-odd). This is a genuine culture of "found a bug once, wrote a gate so it can't come back quietly," which is rare and worth crediting explicitly.
- **The 21 skips are all honest, visible, and reasoned — not hidden inside the pass count.** Every skip I found (`check-auth-invariant.test.mjs`, `with-app-env.test.mjs` — symlinks unavailable without Windows Developer Mode; `public-assets-stay-small.test.mjs` — no `.output/public` build present; `ops-scripts.test.mjs`'s PowerShell-parse test — non-Windows; a Postgres-admin-gated test in the trash-sweep suite) prints or names a concrete reason in the test output rather than silently vanishing from the 608 total.

## What couldn't be assessed

- I did not run `npm run build` (hard constraint — it would overwrite the live production `.output` directory on port 3000 on this machine), so `public-assets-stay-small.test.mjs`'s build-gated assertions ran as documented skips in my session rather than as passes. CI's `smoke-built` job does run `npm run build` and would exercise these; I read the job definition in `ci.yml` and confirmed it does build, boot, and curl the built server, but did not independently trigger that CI run.
- I did not run the `postgres-integration` CI job (would require standing up Postgres on ports this audit is barred from touching, 5432/5433). I read `src/lib/auth/sign-in-throttle.test.ts`, `src/lib/news/leave-desk.test.ts`, `src/lib/news/search-index.test.ts`, `src/lib/news/public-surfaces.no-leak.test.ts`, and `src/lib/news/dark-schema-rebuild.test.ts` by name and confirmed they exist and are referenced in `ci.yml`, but did not execute them against a live Postgres myself.
- I did not run `npm run test:live-model` (would make a billed model call). I confirmed by reading `scan-pass.test.ts` that this is a separate, explicitly opt-in script, and confirmed by reading `ci.yml` in full that `test:live-model` is never invoked by any CI job — the live-model evaluation genuinely never runs unattended.
- I did not exercise the Windows ops scripts (`ops/*.ps1`) at runtime — this machine has PowerShell available, so `ops-scripts.test.mjs`'s parse test would run here, but actually invoking the watchdog/control-panel scripts against live processes was out of scope and risked touching machine state outside the audit's remit.

---

## Test landscape

| Dimension | Observation |
|---|---|
| Framework(s) | Node's built-in `node:test` (both `.test.mjs` under `scripts/` and `.test.ts` under `src/`, the latter run via `--experimental-strip-types`) |
| Test pyramid shape | Broad unit/property layer (194 suites, 608 tests) sitting under a genuinely real e2e layer (7+ Playwright scripts driving real Chromium against real running servers) plus a self-auditing meta-test layer (`ci-jobs.test.mjs`, `newsroom-security.test.mjs`, `docs-dont-count-tests.test.mjs`) that checks the shape of the suite and CI itself. Not top-heavy, not bottom-heavy — unusually well-balanced, with the meta layer as the standout feature. |
| Coverage tool | None configured (no Istanbul/nyc/coverage.py equivalent found) — coverage is asserted by test count and by the self-auditing meta-tests, not by a line/branch percentage |
| Reported coverage (if any) | None reported as a percentage; the suite reports counts (608/587/0/21), and `docs-dont-count-tests.test.mjs` specifically forbids docs from stating a fixed count, so there is no stale-number risk on the doc side |
| Flakiness posture | Clean in the one run observed; no retry config found anywhere in `package.json` or `ci.yml`; `--test-concurrency=1` is used for the TS suite specifically to keep it deterministic (see Minor finding below) |
| CI blocking? | Yes — `test`, `lifecycle`, `smoke-built`, `smoke-dev`, `postgres-integration`, `desk-flows`, `delete-corrections`, `sources-reach-the-reader` are all separate required jobs with no `continue-on-error`, each ending in a real assertion (curl status, Playwright DOM check, or `node --test` pass/fail) |

---

## Findings

> **Finding ID prefix:** `TEST-`
> **Categories:** Coverage / Shortcut / Flakiness / Quality / Ergonomics / Mocking / Regression / CI

### [TEST-001] — Major — Coverage — No concurrent-editor / race-condition coverage anywhere in the suite

**Evidence**
Across all 194 suites, I found no test that spins up two concurrent actions against the same lead, draft, or trash row (e.g., two editors publishing the same lead simultaneously, a restore racing a purge, two dials changes racing each other). `ops-scripts.test.mjs`'s trash-sweep coverage (`ENG-106` in the observed `npm test` output) tests idempotency of a single sweep run twice in sequence, not concurrency. The Postgres-integration job's `dark-schema-rebuild.test.ts` covers a database rebuilt underneath a running process, which is close but is a single-actor failure-injection scenario, not two actors racing.

**Why this matters**
TownReporter is a multi-editor newsroom tool by design (`sign-in-throttle.test.ts`, multi-account flows in `desk-flows-e2e.mjs` all imply more than one editor account can exist). A race between "editor A publishes" and "editor B deletes/corrects the same lead" is exactly the kind of bug that passes every existing test (each of which operates on one actor, sequentially) and only appears in production under real concurrent use — the classic "adversarial case" this audit role is asked to hunt for (per `test-engineer.md` Step 4: "Concurrency (two users editing the same record)").

**Blast radius**
- Adjacent code: `src/lib/news/leave-desk.test.ts`, `src/lib/news/dark-schema-rebuild.test.ts`, the trash-sweep tests in `ops-scripts` territory, and the delete/restore/correction logic covered by `delete-corrections-e2e.mjs` all touch the same lead/draft/article row lifecycle and would need the same concurrency-injection technique.
- Shared state: the `articles`/`leads`/`drafts` tables and whatever locking (if any) the app uses around publish/delete/restore transitions.
- User-facing: a real multi-editor newsroom is the target use case; a race here could double-publish, silently drop a correction, or resurrect a deleted story.
- Migration: none — this is additive test coverage, not a behavior change.
- Tests to update: none broken; this is a gap to fill, not a regression to fix.
- Related findings: none in this pass; this echoes the general "concurrency is the most commonly missing adversarial case" pattern named in the Test Engineer reference material.

**Fix path**
Add at least one Postgres-integration-tier test that fires two overlapping requests (e.g., `Promise.all` of a publish and a delete against the same lead id) and asserts the system reaches a well-defined state rather than a corrupted one (either both succeed with of a deterministic winner, or one is cleanly rejected) — modeled on the existing `dark-schema-rebuild.test.ts` pattern of injecting a hostile condition and asserting recovery.

---

### [TEST-002] — Minor — Ergonomics — Unit-test-facing TS suite is intentionally serialized (`--test-concurrency=1`), with no documented rationale in the test files themselves

**Evidence**
`package.json`: `"test": "... && node --experimental-strip-types --test --test-concurrency=1 \"src/**/*.test.ts\""`. There is a `scripts/suite-runs-serially.test.mjs` file (confirmed present via glob) that presumably enforces this stays serial, but the reason (likely shared state — a shared PGLite instance, or shared env var mutation as seen in `voice-boundary.test.ts`'s `process.env[VOICE_ENV]` manipulation) is not stated at the point where a new contributor would look, i.e. in `package.json` or a top-level comment.

**Why this matters**
This is purely an ergonomics/maintainability concern, not a correctness gap: a serialized 400+-test TS suite is slower to run locally than it needs to be if the underlying reason (probably shared mutable env vars across test files, as seen directly in `voice-boundary.test.ts`) could instead be scoped per-file. A future contributor is likely to "fix" this by removing `--test-concurrency=1` without understanding why it's there, since the reason lives in `suite-runs-serially.test.mjs` rather than next to the flag itself.

**Blast radius**
- Adjacent code: any test file that mutates `process.env` directly (confirmed pattern in `voice-boundary.test.ts`, likely present elsewhere given the repo's newsroom-security env-toggling patterns).
- User-facing: none — pure developer ergonomics.
- Migration: none.
- Tests to update: none.
- Related findings: none.

**Fix path**
Add a one-line comment directly above the `--test-concurrency=1` flag in `package.json` pointing at `scripts/suite-runs-serially.test.mjs` for the full rationale, so the "why" is discoverable at the point of temptation to remove it.

---

### [TEST-003] — Minor — Coverage — Windows ops-layer behavioral coverage is necessarily static-only in CI

**Evidence**
`scripts/ops-scripts.test.mjs` header: "CI runs on Linux and cannot execute PowerShell meaningfully, so this checks what is checkable everywhere: that the files exist, that they parse, and that the specific mistakes already made cannot come back." The only genuinely behavioral (as opposed to static/parse) check — `powershell.exe ... ParseFile` — is itself skipped when `process.platform !== "win32"`, i.e., always skipped in the Linux CI this project runs.

**Why this matters**
This is disclosed honestly in the test file's own comments (which is why it is Minor and not Major/Critical — see `severity-framework.md`: a known, stated, load-bearing limitation with a workaround is a lower severity than a silent one), but it means the watchdog/control-panel scripts that "keep the paper online" per the file's own description have zero CI coverage of actual runtime behavior (does the watchdog actually restart a stopped process? does the tunnel script actually reconnect?) — only that they parse and avoid three specific previously-seen mistakes.

**Blast radius**
- Adjacent code: all of `ops/*.ps1` — `watchdog.ps1`, `restart-app.ps1`, `restart-tunnel.ps1`, `cron-tick.ps1`.
- User-facing: this is exactly the layer that recovers the site when it goes down; a regression here is invisible until a real outage.
- Migration: none.
- Tests to update: none broken.
- Related findings: none; this is the same category of gap called out generally in `test-engineer.md`'s "failure modes (DB down, third-party timeout)" adversarial-case guidance, applied to the ops layer specifically.

**Fix path**
Consider a self-hosted Windows runner (or a scheduled local job, since this machine already runs the live service) that actually starts a fake "stopped" process and asserts the watchdog restarts it, to close the gap between "parses and avoids three known bugs" and "actually works."

---

### [TEST-004] — Nit — Quality — `voice-boundary.test.ts` has two source-shape (textual) assertions alongside its behavioral ones, in an otherwise exemplary behavioral file

**Evidence**
`src/lib/news/voice-boundary.test.ts:120-140`: "the CLI adapter passes a path, never the prompt text, when a file is given" and "the editorial writer hands over a path and never the text" both use `readFileSync` + regex matching against source text, rather than calling the real functions. The file's own comment discloses this is a deliberate scoping choice (mocking a process spawn or a DB-touching import chain is "a legitimate next step but a separate piece of work"), and the regexes are reasonably tight (anchored to control-flow proximity, not bare substrings) — this is not the shallow "string is in the file" anti-pattern called out in `test-engineer.md` #2, but it is still text-matching rather than exercising real behavior.

**Why this matters**
Low risk given the disclosure and the tightness of the regex, but worth naming so it isn't silently forgotten: a refactor that renames `found.voice.path` while preserving behavior would fail this test for the wrong reason (brittleness), and conversely a sufficiently creative rewrite that preserves the regex shape while breaking the actual data flow (e.g. wrapping the path in an object before passing it) could in theory slip past.

**Blast radius**
- Adjacent code: `ai-claude-code.server.ts`, `editorial.server.ts`.
- User-facing: none directly; this is a test-quality note, not a product gap — the file's other four checks already cover the same boundary behaviorally.
- Migration: none.
- Tests to update: none broken.
- Related findings: none.

**Fix path**
No action required now; if `ai-claude-code.server.ts`'s spawn logic is ever refactored to be independently mockable, upgrade these two checks to behavioral ones at that time, per the file's own stated intent.

---

## Shortcut census

| Shortcut pattern | Count |
|---|---|
| `.skip` / `xit` / `@skip` (test-level, unexplained) | 0 — all 21 skips found had a printed reason (symlinks off / no build present / non-Windows / Postgres-admin-only) |
| `.only` (left in) | 0 (grepped `src/` and `scripts/`, none found) |
| `TODO: add test` / similar | 0 (grepped `src/` and `scripts/`, none found) |
| Empty assertion / placeholder | 0 observed in the files read |
| `--retry` / retries normalized | No — no retry config found in `package.json` or `ci.yml` |

## Blind spots by class

- **Concurrency / races** — no coverage found (TEST-001). The single most notable gap in an otherwise thorough suite.
- **Live-model output quality** — by design, deferred to the opt-in `test:live-model` path, never run in CI; this is a documented, deliberate trade-off (cost/determinism), not an oversight, but it does mean prompt-quality regressions in Scan/Draft/Dark Desk/Opinion are never caught automatically.
- **Windows ops-layer runtime behavior** — static/parse-only in CI (TEST-003), disclosed honestly.
- **Failure/empty/permission states** — well covered relative to most codebases I've seen: `formatIn`/`health readings` tests explicitly cover "never" states and worst-state precedence, `sign-in-throttle.test.ts` covers rate limiting, `public-surfaces.no-leak.test.ts` covers a leak class directly, and `desk-flows-e2e.mjs`/`smoke-built-server.mjs` both explicitly check the unauthenticated-visitor case for `/desk`. This is a strength, not a blind spot.

## Patterns and systemic observations

The dominant pattern here is unusual and worth naming explicitly for the executive report: **this codebase treats a prior audit finding as a permanent constraint enforced by code, not as a one-time fix.** `newsroom-security.test.mjs`, `ci-jobs.test.mjs`, `docs-dont-count-tests.test.mjs`, and `ops-scripts.test.mjs` are all meta-tests whose entire purpose is "the exact mutation that would reintroduce a previously-found bug must turn this test red" — several test bodies literally say so in comments (e.g. `voice-boundary.test.ts`'s "the EXACT mutation that must turn the test above red"). This is the opposite of the "tests-with-fixes culture" gap the Test Engineer reference calls out as commonly missing (`test-engineer.md` #6, "Regression posture") — here it is present and unusually disciplined. I did not find snapshot-test ossification, institutionalized flakiness, or over-mocking as systemic patterns; the closest thing to over-mocking (voice-boundary.test.ts's two textual checks, TEST-004) is small, disclosed, and paired with genuine behavioral coverage of the same property.

## Appendix: test artifacts reviewed

- Ran: `npm test` (full, cold, in this checkout) — output: `tests 608 / suites 194 / pass 587 / fail 0 / cancelled 0 / skipped 21 / todo 0`, duration ~152s.
- Read in full: `src/lib/news/coerce-draft.test.ts`, `src/lib/news/voice-boundary.test.ts`, `scripts/ops-scripts.test.mjs`, `scripts/ci-jobs.test.mjs`, `scripts/docs-dont-count-tests.test.mjs`, `scripts/smoke-built-server.mjs`, `scripts/desk-flows-e2e.mjs` (partial, first 90 lines), `.github/workflows/ci.yml` (full), `package.json` (scripts section), `.env.example` (RUN_LIVE_MODEL_TESTS reference), `scripts/newsroom-security.test.mjs` lines 440-509 (live-model gate and glob-discovery tests).
- Grepped: `RUN_LIVE_MODEL_TESTS`, `voice-boundary|ops-scripts`, `.only(`, `TODO.*test`, `skip:` across `src/` and `scripts/`.
- Enumerated via glob: all `*.test.mjs` under `scripts/` (25 files), confirmed `coerce-draft.test.ts` present under `src/lib/news/`.
- Test directories/frameworks: `node:test` (Node's built-in runner), invoked via two `npm test` sub-invocations (`.test.mjs` under `scripts/`, `.test.ts` under `src/` via `--experimental-strip-types`).
