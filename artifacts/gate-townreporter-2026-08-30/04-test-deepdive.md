# TownReporter — Test Engineer Deep-Dive
Date: 2026-08-30
Auditor role: Test Engineer (GauntletGate)
Repo copy: `C:\Users\scott\Desktop\Code\townreporter-dev\.claude\worktrees\wf_191e7625-b76-4` (isolated worktree)

## Environment attestation
- `npm install` from scratch in the worktree: 428 packages, clean.
- `npm test` run at repo root (full suite: 10 `scripts/**/*.test.mjs` files + 43 `src/**/*.test.ts` files via `node --experimental-strip-types`).
- `npm run typecheck` (`tsc --noEmit`).
- `npx eslint .` run directly — **`npm run lint` does not exist in `package.json`** (see TEST-02).
- No Postgres integration lane run (`TEST_POSTGRES_ADMIN_URL` not set) — heavyweight DB-backed tests are opt-in and out of scope for this pass; noted as a coverage gap, not a failure.
- All source defects I injected for adversarial testing were reverted; `git status --porcelain` at the end shows only `package-lock.json` (from `npm install`), zero source diffs.

## Severity counts
- Blocker: 1
- Critical: 1
- Major: 3
- Minor: 2
- Nit: 1

## Findings

### TEST-01 (Critical) — The only test protecting "a second identity cannot become owner/editor" is a source-text regex, and it stays green while the real check is broken
**Category:** test-coverage / authorization
**Evidence:** `scripts/newsroom-security.test.mjs:45-55`, real logic at `src/lib/news/membership.ts:79-110` (`requireEditor`).
Reproduction:
1. In `src/lib/news/membership.ts:91`, changed `if ((n[0]?.c ?? 0) === 0) {` to `if ((n[0]?.c ?? 0) <= 1) {` — a one-character off-by-one that lets a *second* signed-in user claim the `owner` role instead of hitting `throw new ForbiddenError()`.
2. Ran `node --test scripts/newsroom-security.test.mjs` — **all 12 assertions still pass**, including the one titled `"membership rejects a second identity (unauthorized publish path)"`, because that test only checks that the literal strings `class ForbiddenError`, `readonly status = 403`, and `role === "owner" || mine[0]?.role === "editor"` still appear somewhere in the file — it never calls `requireEditor` with two different user ids.
3. Ran `node --experimental-strip-types --test src/lib/news/membership.test.ts` (the behavioral suite) — it passes too, because **it never exercises the second-identity-rejected path either**: its only coverage of `requireEditor`-adjacent behavior is `SetupRequiredError is a 403`, `leave as editor refuses a stranger`, and `leave as editor deletes this newsroom's members, not every row`. No test calls `requireEditor(userA)` then `requireEditor(userB)` and asserts the second throws.
4. Reverted the change; confirmed `membership.ts` byte-identical to start (`git status` clean).

**Why it matters:** this is the exact authorization boundary the operator's single-editor threat model depends on (a stranger who signs in cannot become a second owner/editor). Both the "security" test file and the behavioral test file miss it — the security file because it's a string search, the behavioral file because the scenario simply isn't written. A one-line off-by-one here would ship to production undetected by `npm test`.
**Impact scope:** any deploy; a real attacker or accidental double-signup during the operator's own onboarding could silently mint a second editor with full publish/dark-desk rights.
**Fix path:** add a real `requireEditor` test: seed one owner via a fake/pglite `newsroom_members` row, call `requireEditor` with a second `userId`, assert it throws `ForbiddenError` with status 403. Then either delete or clearly re-scope `newsroom-security.test.mjs`'s membership test as "shape check only, not a substitute for behavior."

### TEST-02 (Blocker) — `npm run lint` does not exist; ESLint has never been part of the gate, and 13 real lint errors are sitting in the tree uncaught
**Category:** correctness / CI gap
**Evidence:** `package.json` scripts block has no `lint` entry (only `dev`, `build`, `start`, `db:migrate`, `build:dev`, `preview`, `playwright:install`, `check:auth`, `test:lifecycle`, `test`, `typecheck`, `format`). The audit brief itself instructs "Run the suite: npm test, npm run typecheck, npm run lint" — that third command fails immediately with `npm error Missing script: "lint"`.
Running `npx eslint .` directly surfaces **13 real errors**, including:
- `src/lib/ops/health.server.ts:332-337` — six `no-control-regex` errors (`\x08` control characters in a regex, in the health-monitoring code path).
- `src/lib/news/storable-text.ts:20` — `no-control-regex` (`\x00,\x08,...`) — notably, this is the function whose whole job is stripping unsafe control characters from stored text; the regex itself trips the same lint rule it's meant to guard against, and nobody has looked at it because lint never runs.
- `src/lib/news/extract.ts:8-10` — three `no-useless-escape` errors.
- `src/lib/app-data/client.server.ts:214` — empty `catch`/block (`no-empty`) — a silently swallowed error path.
- `src/lib/news/fetch-url.ts:210`, `src/lib/news/ingest.ts:274` — `prefer-const` (`let` never reassigned) in the SSRF-adjacent fetch/ingest code — not a bug today, but a live example of unreviewed diffs landing without lint.

**Why it matters:** `npm test` is the only gate anyone (including CI, if any exists) actually runs, and it never touches these files. Lint has silently regressed to decoration — the `eslint.config.mjs` and its dependencies are installed and configured but wired to nothing. This is a Blocker rather than Major because the audit's own verification instructions assume `npm run lint` works, and a reviewer following the documented process gets a hard failure with zero output, which could easily be misread as "lint passed" if not inspected carefully (it errors loudly here, but a future flaky wrapper script could swallow it).
**Impact scope:** every future contribution; any file, not just the ones flagged today.
**Fix path:** add `"lint": "eslint ."` to `package.json` scripts, fix the 13 existing errors (the control-char ones need `/* eslint-disable no-control-regex */` with a comment explaining the NUL-stripping intent is deliberate, not a real defect), and wire `npm run lint` into whatever pre-merge/pre-deploy check exists.

### TEST-03 (Major) — `desk.ts` and `public.ts`, the two files that own every published-content mutation and the entire public read surface, have no dedicated behavioral test file
**Category:** test-coverage
**Evidence:** `ls src/lib/news/*.ts` (52 non-test source files) vs `src/lib/news/*.test.ts` (43 test files) — `desk.ts` and `public.ts` are absent from the test-file list. Their only "coverage" is the regex assertions in `scripts/newsroom-security.test.mjs` (see TEST-01's methodology — those never call the exported server functions) plus indirect exercise through `report.test.ts`, `report.pipeline.test.ts`, and `dark.open.test.ts`, which test surrounding logic (provenance merge, rewrite detection) but not `desk.ts`'s own exported `createServerFn` handlers (`publishLead`, `scanLead`, etc.) end to end with a real or fake db.
**Why it matters:** `desk.ts` is named explicitly in the security test as the file every mutation must route through `deskMiddleware`, rate limiting, and transactions — but nothing calls `publishLead` and asserts what actually happens to the database or the returned value. The suite proves the file *contains* the right tokens; it does not prove `publishLead` behaves correctly under a real invocation.
**Impact scope:** the entire editor's-desk publish flow — the core feature of the product.
**Fix path:** add `desk.test.ts` and `public.test.ts` using the same pglite-backed pattern already used in `evidence.public.test.ts` / `app-data.test.ts`, calling the exported server functions directly (bypassing the TanStack `createServerFn` wrapper as needed) and asserting on DB state.

### TEST-04 (Major) — Full-suite run is flaky under WASM memory pressure; four suites intermittently fail with `RangeError: WebAssembly.Memory(): could not allocate memory` when run as part of `npm test`, but pass cleanly in isolation
**Category:** test-infra / flakiness
**Evidence:** `npm test` (full run) failed 4/147 suites: `src/lib/app-data/app-data.test.ts`, `src/lib/news/evidence.public.test.ts` (`RangeError: WebAssembly.Memory(): could not allocate memory` at `node_modules/@electric-sql/pglite/dist/index.js:3:289014`, called from `src/lib/db.ts:141`), `src/lib/news/investigate.forensics.test.ts`, `src/lib/news/report.test.ts`. Re-running each of the four in isolation (`node --experimental-strip-types --test <file>`) — all pass 100%. Node's test runner parallelizes suites by default, and many suites spin up their own in-process pglite (WASM Postgres) instance concurrently; on this machine that occasionally exceeds available WASM linear memory.
**Why it matters:** a suite that fails ~2-3% of full runs for reasons unrelated to code correctness trains reviewers to re-run-and-ignore red, which is exactly how a real regression gets waved through ("oh, it's just the flaky pglite thing"). This is the mechanism, not the symptom — worth fixing before it hides a real failure.
**Impact scope:** every CI/local `npm test` run; non-deterministic, more likely on constrained machines.
**Fix path:** either cap `node --test`'s concurrency (`--test-concurrency=1` for the pglite-heavy files, or split them into a serial group) or give each pglite instance an explicit lower memory ceiling; at minimum, document the flake and its known cause so it isn't mistaken for a real regression.

### TEST-05 (Major) — `scripts/no-destructive-migrate.test.mjs` and `scripts/ssrf-check.test.mjs` are trivially defeated by any dynamically-constructed string
**Category:** test-coverage / gate-strength
**Evidence:** `scripts/no-destructive-migrate.test.mjs:34-43` strips comments from `scripts/migrate.mjs` and regexes for literal `TRUNCATE`/`DROP`/`DELETE FROM` tokens.
Reproduction: inserted `const _dangerParts = ["TRUN","CATE articles CASCADE"]; const _dangerSql = _dangerParts.join("");` into `main()` in `scripts/migrate.mjs` (never executed — just present in source). Ran `node --test scripts/no-destructive-migrate.test.mjs`: **all 3 assertions still pass.** Reverted the file (confirmed via `git status` — clean).
This is the same class of gate the prior adversarial round (2026-08-29) found and rewrote six instances of ("stayed green while the defect they named was live... asserting a string appeared in a file"). It is unlikely a real accidental regression would use string concatenation to build `TRUNCATE` — but it means the gate is a documentation/tripwire against a *literal* reintroduction of the old factory-reset code, not a structural guarantee against any destructive statement, and a reviewer reading the test's own docstring ("This is the gate, not a note asking the next person to be careful") could reasonably believe it's stronger than it is.
`scripts/ssrf-check.test.mjs` is lower-risk by comparison: it only checks that `v4FromMapped6` exists and that `fetch-url.test.ts` contains specific IPv6-mapped literal test cases — the actual SSRF blocking behavior is separately and genuinely exercised by real behavioral tests (`fetch-url.test.ts`, `ssrf-agent.test.ts`'s `guardedLookup`/"outbound fetch blocks at connect time" — confirmed below in What's Working). So this file is best read as "did anyone delete the SSRF test cases," which is a legitimate, narrow purpose, not a claim of blocking real SSRF.
**Why it matters:** distinguishing "the gate proves the property" from "the gate proves the property wasn't re-typed verbatim" matters for how much confidence a reviewer should place in a green run.
**Impact scope:** migration safety documentation/trust, not an active exploit path today.
**Fix path:** for `no-destructive-migrate.test.mjs`, additionally assert that `migrate.mjs` only ever calls `sql.query` with statements read from `migrations/*.sql` (i.e., structurally, not textually) — or accept and document explicitly that this is a tripwire against literal reintroduction, not a semantic guarantee.

### TEST-06 (Minor) — `no migration file empties a table` reads `migrations/*.sql` fresh each run with no fixture, so it silently degrades to `assert.ok(true)`-equivalent if the directory is ever renamed
**Category:** test-coverage
**Evidence:** `scripts/no-destructive-migrate.test.mjs:57-59` does assert `files.length > 0`, which is good — this one *does* have a floor. Filed as Minor only because the assertion message ("expected migration files") would be the only signal if `migrations/` were ever moved, and nothing cross-checks the count against a known-good baseline.
**Why it matters:** low — the floor check exists and would fail loudly. Noted for completeness since it's adjacent to TEST-05.
**Fix path:** none required; optionally assert a minimum count greater than 1 to also catch an accidental `rm -rf migrations/*`.

### TEST-07 (Nit) — `src/lib/news/dark.ts:5` imports `DARK_SYSTEM` and never uses it (would have been caught by lint, see TEST-02)
**Category:** dead-code
**Evidence:** ESLint output, `@typescript-eslint/no-unused-vars`.
**Fix path:** remove the import or use it; rolled into whatever PR fixes TEST-02.

## What's working (specific, verified)

- **Full suite, run in isolation per-file (i.e., discounting the WASM flake in TEST-04): 472/472 tests pass.** `typecheck` is clean with zero errors.
- **The SSRF outbound-fetch guard is genuinely behaviorally tested and I could not defeat it in one edit.** `src/lib/news/ssrf-agent.test.ts`'s `"the outbound fetch blocks at connect time"` suite stands up a real loopback HTTP server, confirms plain `fetch` can reach it, then confirms the guarded fetch cannot — this is a real network-level assertion, not a string check. Separately, `src/lib/news/fetch-url.test.ts`'s `"blocks loopback, RFC1918, link-local, CGNAT, multicast, ULA"` and `"rejects blocked IP literals before fetch"` tests call `isBlockedAddress`/`assertHttpUrl` directly. I removed the `169.254.x.x` (cloud-metadata) block from `src/lib/news/url-guard.ts:39` and re-ran these tests: **both failed immediately and specifically** (`AssertionError: 169.254.169.254 ... false !== true`, and the "rejects blocked IP literals" throw-check also failed) — this is exactly the outcome a real regression should produce, and it's a meaningful, non-string-based catch. Reverted; confirmed restored.
- **`guardedLookup`'s DNS-rebinding defense is real and tested with actual DNS resolution** (`src/lib/news/ssrf-agent.test.ts`), not mocked away.
- **The public-bundle/Node-import leakage tests (`scripts/newsroom-security.test.mjs`'s "Node-only imports out of the browser bundle") document a real, previously-shipped incident** (`node:crypto` reaching the client, breaking hydration) and, while still string-based, are anchored to a documented regression with specific audit finding IDs (UIUX-01/QA-001/ENG-007) rather than speculative hardening — appropriately scoped even though the technique is the same as the weaker gates above.
- **`scripts/browser-smoke-verdict.test.mjs` and `scripts/grok-pwa-plugin.test.mjs`, despite reading files, are genuinely behavioral** — they call real exported functions (diff/divergence logic, boundary conditions like "50 tolerated, 51 diverges") rather than grepping source text for tokens.
- **`no-destructive-migrate.test.mjs` does have a real floor**: it fails if `migrations/` is empty, and it does catch a literal, non-obfuscated reintroduction of `TRUNCATE`/`DROP`/`DELETE FROM` — its weakness (TEST-05) is specifically against deliberate obfuscation, not against an honest mistake, which is the more likely real-world failure mode it's actually guarding against.

## Not assessed / could not verify
- **Postgres-backed integration lane** (`TEST_POSTGRES_ADMIN_URL` opt-in tests) — not run this pass; scope note says these are opt-in and heavyweight. Given TEST-01 and TEST-03 concern exactly the DB-mutation code paths, this lane (if it exists and covers `requireEditor`/`desk.ts`) would be the natural place to check whether my findings are already mitigated there. I did not find such tests in the file list gated behind `TEST_POSTGRES_ADMIN_URL` specifically — `db.ts` uses pglite (in-memory WASM Postgres) for the existing tests, not a real Postgres connection — but I have not exhaustively read every test file's setup to confirm no test additionally branches on `TEST_POSTGRES_ADMIN_URL`. Flagging as unverified rather than absent.
- **CI wiring** — I don't have visibility into whether a CI system (GitHub Actions or otherwise) runs `npm test`/`typecheck`/lint on PRs; TEST-02 is scoped to what `package.json` and direct invocation show, not to CI config (no `.github/workflows` was inspected in this pass since it's outside `src`/`scripts`; noting this as a gap, not a claim it doesn't exist).
- **Playwright/E2E tests** — `test:lifecycle` script exists (`scripts/lifecycle-e2e.mjs`) but was not run this pass; out of scope for a unit/gate-focused Test Engineer pass, and not requested in the brief's explicit run list.
