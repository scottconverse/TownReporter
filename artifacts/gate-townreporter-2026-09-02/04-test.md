# GauntletGate — Full lane — Test Engineer deep-dive — TownReporter v0.6.3

Repo: `C:\Users\scott\Desktop\Code\townreporter-dev` at `f9c2a1a` (v0.6.3). Read-only audit —
no product source modified, nothing committed or pushed. Production
(`townreporter.org` / `townreporter-web`) never entered. Ports 3000/5432/5433 never
bound or killed; `TEST_POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres`
was used only to let the suite's own scratch-database tests run for real (each test
creates and drops its own `*_test_*` database via the admin connection — see
`src/lib/test-support/pg-admin.ts`). Builds on the Walkthrough lane's report
(`00-walkthrough.md`) rather than re-walking the UI; references its findings by number.

**Role:** Test Engineer. **Severity counts:** 0 Blocker · 0 Critical · 1 Major · 2 Minor · 1 Nit.

---

## 0. Headline: the real numbers, measured

Ran the full suite exactly once, for real, with a real Postgres so nothing silently
skipped:

```
TEST_POSTGRES_ADMIN_URL=postgres://postgres@127.0.0.1:5433/postgres npm test
```

Full log: `artifacts/04-test/full-test-run.log` (1,676 lines).

| Group | Command | tests | pass | fail | skipped |
|---|---|---|---|---|---|
| `scripts/**/*.test.mjs` | `node --test scripts/**/*.test.mjs` | 278 | 276 | 0 | 2 |
| `src/**/*.test.ts` | `node --experimental-strip-types --test --test-concurrency=1 src/**/*.test.ts` | 852 | 851 | 0 | 1 |
| **Total** | | **1,130** | **1,127** | **0** | **3** |

Wall clock: ~5.2s (scripts) + ~303.6s (src, serial by design) ≈ 5m9s.

**The "~1,130 tests" figure in the brief is accurate, not inflated** — 278 + 852 = 1,130
exactly, and this is a real `node --test` count of actual `test()`/`it()` blocks
(1,240 raw `test(`/`it(` call sites across both dirs; the difference from 1,130 is
nested `describe`-style grouping and a couple of helper closures that are not
independently counted by the runner — not a discrepancy worth flagging).

**All 3 skips are legitimate and self-documenting, not hidden gaps:**
- Two are `symlinks not permitted on this platform (Windows Developer Mode is off)` —
  a real Windows-vs-POSIX platform gap (`scripts/with-app-env.test.mjs`), not a code
  smell; CI runs on Linux/Windows runners where this either isn't gated or is covered
  by the Windows watchdog job.
- One is `set RUN_LIVE_MODEL_TESTS=1 to run the live model evaluation` — an explicit,
  named opt-in for a test that would spend real provider money
  (`src/lib/news/scan-pass.test.ts`, also exposed as `npm run test:live-model`).

**0 fail is a real, currently-true result**, not a claim recycled from CI: this was
run fresh in this session, in this environment, against this exact commit.

---

## 1. The 12 CI jobs vs. the e2e scripts — mapped

`.github/workflows/ci.yml` defines exactly **12 jobs**, confirming the brief's count:
`test`, `lifecycle`, `smoke-built`, `smoke-dev`, `postgres-integration`, `desk-flows`,
`provider-signin`, `failover`, `dark-picker`, `delete-corrections`,
`sources-reach-the-reader`, `windows-watchdog-recovery`.

Every job maps to a real, distinct property, and the file's own inline comments name
the *specific past incident* each job exists to catch — this is unusually good
institutional memory for a test suite: e.g. `smoke-built`/`smoke-dev` exist because
CI used to prove only that `npm run dev` answered 200 while `node:crypto` reached the
client bundle and left the real onboarding path dead (a documented past Blocker);
`desk-flows` exists because an audit (`TE-04`) found the 0.5.1 screens (Opinion,
delete, Undo, trash, Server, Dark Desk dials) had "wiring verified once by an agent
looking at it," not a test that runs again; `provider-signin`'s `kill_tree` helper
exists because a bare `kill $DEV_PID` left vite's dev server running and phase two
silently reused phase one's already-claimed desk.

**Port uniqueness across jobs, checked:** every job that runs its own dev/prod server
picks a distinct port (`8080` default for `test`/`lifecycle`/`smoke-dev`/`desk-flows`/
`sources-reach-the-reader`, `3000` for `smoke-built`, `3312` for `provider-signin`,
`3316` for `dark-picker`, `3317` for `failover`, `3050`/`5199` for the Windows
watchdog job). Jobs sharing `8080` never run concurrently against the same
database — each is either PGLite-in-memory (isolated per job/runner) or a distinct
named Postgres service database (`townreporter_ci`, `townreporter_delete_corr`). No
port collision found in the file as written.

**Postgres-only coverage, verified consistent, not just claimed:** `pg-admin.ts`'s
`probePostgres`/`integrationRequested` gate 11 files across `src/lib/{auth,news}` that
skip without `TEST_POSTGRES_ADMIN_URL` set (`sign-in-throttle.test.ts`,
`leave-desk.test.ts`, `search-index.test.ts`, `public-surfaces.no-leak.test.ts`,
`stalled-run.e2e.test.ts`, `two-editors.e2e.test.ts`,
`uncredited-source-warning.e2e.test.ts`, `paper-identity.e2e.test.ts`,
`provider-settings.e2e.test.ts`, `dark-schema-rebuild.test.ts`,
`lead-resurface.e2e.test.ts`). All 11 are named across the `postgres-integration`
job's two `run` steps and its job-level env sets `TEST_POSTGRES_ADMIN_URL`, so all 11
get real coverage in CI — confirmed by reading the job body directly (`ci.yml:160-200`),
not by trusting `scripts/postgres-tests-are-covered.test.mjs`'s own self-check (which
also passed: `every DB-skippable test file is run by a CI job that provides a
database`, see log line 228). This is a real, working meta-test — I traced its logic
(it regex-matches file paths against job bodies containing `TEST_POSTGRES_ADMIN_URL:`)
and it would in fact fail red if a file were renamed or dropped from the job list.

---

## 2. What the 1,130 tests actually prove, and what they can't

**What they're good at:** this suite is overwhelmingly *server-side logic and data
integrity* — leads, drafts, publish/correct/delete lifecycle, dedup matching, search
indexing, auth/session/invite flows, provider ladder/fail-over logic, body-size caps,
trash expiry cron, PDF/OCR ingestion, research-loop state machine. The `node:test`
per-file comments are consistently written as *regression proofs of a specific past
incident* ("reproduces the original bug, then proves the fix" — `ENG-106`'s trash-purge
test is a good example: `src/lib/news/trash-purge.test.ts`), not generic
happy-path assertions. That is a strong, deliberate pattern across the codebase, not
an accident.

**What they cannot prove, structurally:** there are **43 `.tsx` route/component files
under `src/routes/`** (the desk screens: queue, scan, sources, published, opinion,
ops, dark, story, etc.) and **zero `.test.tsx` files, zero `@testing-library/*`
imports anywhere in the repo.** No component is unit- or render-tested in isolation.
All screen-level verification is Playwright, driving a real running server, in 14
separate `*-e2e.mjs` scripts (`lifecycle-e2e.mjs`, `desk-flows-e2e.mjs`,
`opinion-desk-e2e.mjs`, `paste-editorial-e2e.mjs`, `sources-reach-the-reader.mjs`,
`security-headers-e2e.mjs`, `delete-corrections-e2e.mjs`, `provider-signin-e2e.mjs`,
`failover-e2e.mjs`, `dark-picker-e2e.mjs`, `smoke-built-server.mjs`, plus a few not
wired to `npm test`/CI — see Finding TES-01). This is an architecturally defensible
choice for a product this size (the CHANGELOG shows the team knows it and has been
closing screens one at a time after each was burned by a real bug — 0.5.1's `TE-04`
finding, the Opinion "two pixels below the fold" incident, the locator-leak fix), but
it means:
- **No fast component-level regression signal.** A one-line JSX change gets checked
  only by whichever `*-e2e.mjs` script happens to click through that screen, at
  Playwright speed (seconds-to-minutes per job) rather than unit-test speed
  (milliseconds). This is a Major finding — see TES-01 for the specific screens with
  no such coverage at all.
- **Coverage is exactly as good as the hand-maintained walk scripts, no better.** A
  server-side test can prove "the API stores the right data." Nothing here proves
  a component *renders that data correctly* except a script that explicitly asserts
  on the DOM text for that exact case. This is the shape of bug that already bit this
  project twice (Opinion's off-screen panel; the desk-flows job's own header
  explaining why the 0.5.1 screens got a walk at all) — the mitigation is real and
  growing, but it is still coverage-by-enumeration, not coverage-by-construction.

---

## 3. Render-only / would-pass-despite-broken-feature risk — specifically checked, mostly clean

I looked for the classic failure shapes: tests that only assert "renders without
throwing," snapshot tests with no behavioral assertion, and network/mock stubs that
would pass even if the real integration were broken.

- **No snapshot tests anywhere** (`grep` for `toMatchSnapshot`/`.snap` found nothing).
- **`assert.doesNotThrow` is used exactly 7 times** across the whole suite (grep,
  `src/lib/{auth,news}/*.test.ts`), and in every instance it is paired with, or
  immediately followed by, an assertion on the *value* produced (e.g.
  `notes.test.ts` uses it only to confirm a packed blob round-trips through
  `JSON.parse`, then goes on to assert on the parsed shape in the surrounding test).
  None of the 7 is a bare "didn't crash" test standing alone as its only assertion.
- **`ai-claude-code.test.ts`'s "does not throw on unreadable output" / "does not throw
  on no output"** (lines 40, 46) are the closest thing to a pure-negative test in the
  suite. Read in context: they assert the parser returns a typed `{ok:false,...}`
  failure envelope rather than throwing, which the surrounding tests then use to
  prove the fail-over ladder (Walkthrough Finding 1's exact code path) treats a
  malformed response as a failure signal — this *is* the load-bearing assertion for
  fail-over correctness, just phrased as "does not throw." Legitimate.
- **The e2e scripts are asserting real screen text, not just HTTP 200.** Spot-checked
  `desk-flows-e2e.mjs`, `opinion-desk-e2e.mjs`: they read `body.innerText()` and
  assert on the actual copy the reader/editor would see (e.g. the Opinion desk
  contract check that failed in a real CI run I found — see §5) — these are not
  "page loaded" smoke checks dressed up as feature tests.

**I did not find evidence of the render-only anti-pattern being present at scale.**
This is a credit to the team, not a gap I'm papering over — see What's Working.

---

## 4. Numbered findings

### TES-01 — Major — Test coverage — Two core desk screens (Scan, Sources) have zero CI-gated browser regression coverage

**Evidence.** `src/routes/desk.scan.tsx` and `src/routes/desk.sources.tsx` are two of
the 13 desk screens. Grepping every `scripts/*.mjs` file that is wired into
`package.json`'s `scripts` block or into `.github/workflows/ci.yml` for a navigation
to `/desk/scan` or `/desk/sources` finds none. The only files that reference those
routes are:
- `scripts/live-pipeline-proof.mjs` — runs `Scan` on Automatic, but this is the
  **nightly, opt-in, real-money** job (`ops\nightly-proof.ps1`, 03:30 daily, per
  `docs/nightly-proof.md`), not part of `npm test` or any `ci.yml` job, and not
  gating anything — a regression here is discovered the following morning at the
  earliest, by whoever reads `artifacts/nightly/<date>.json`, not by CI.
- `scripts/audit-038.mjs` and `scripts/site-walkthrough.mjs` — one-off audit scratch
  scripts from an earlier manual audit pass (hardcoded `/workspace/screenshots/...`
  output paths and, in `site-walkthrough.mjs`, a stale hardcoded live URL
  `https://townreporter-longmont.grok.me` that is not this product's real domain).
  Neither appears in `package.json` `scripts` or `ci.yml` — confirmed by grep. They
  are not maintained regression tests; they are one-time artifacts.

**Why it matters.** This is exactly the failure shape `desk-flows` was created to
close for the 0.5.1 screens (per that job's own comment block in `ci.yml`): a screen
that "wiring verified once by an agent looking at it, not by anything that runs
again." Scan and Sources are two of the product's most central screens (Scan drives
the lead queue that everything downstream depends on; Sources is the watch-list an
editor curates), and a UI regression on either — a broken button, a silently-dropped
form field, a race in the polling state — has no CI signal until either the nightly
live-model job happens to exercise the exact broken path, or a human notices in
production.

**Impact scope.** Both screens are reachable by every editor on every paper, on the
critical path from "the scanner finds something" to "a lead exists to draft from."
A regression is not theoretical — it is the same class of bug this project has
already shipped twice (the locator leak, the unreachable editorial) on screens that
lacked exactly this kind of walk before one was added.

**Suggested fix.** Add a `scan-desk-e2e.mjs` (model-free, following the established
pattern in `dark-picker-e2e.mjs`/`provider-signin-e2e.mjs`: fake CLI signed-in,
assert the screen renders the previous-scan list and the Run-scan button state,
without ever starting a real scan) and a `sources-desk-e2e.mjs` (add/remove/edit a
watched source, assert it persists and appears on the list) wired into a new or
existing CI job, the same way `dark-picker`/`failover`/`provider-signin` were each
added as their own small, focused, model-free job.

**Suggested test.** As above — model-free Playwright walks asserting on real DOM
text for the add/remove-source and previous-scans-list states, following the exact
established pattern in this repo.

---

### TES-02 — Minor — Test hygiene / correctness risk — The shared build lock used by the Postgres-integration test group is not namespaced by checkout (still open from the 08-30 audit)

**Evidence.** `src/lib/test-support/pg-admin.ts:144-145`:
```ts
const LOCK_DIR = join(tmpdir(), "townreporter-dev-build.lock");
const DONE_MARKER = join(tmpdir(), "townreporter-dev-build.done");
```
Both are fixed OS-temp paths shared by every process on the machine; `ensureBuilt(repoRoot)`
receives `repoRoot` but never uses it to namespace either path. This is the exact
code and exact lines flagged as `ENG-115` in the prior gate run
(`artifacts/gate-townreporter-2026-08-30/01-engineering-deepdive.md:641-660`) — I
re-read the current file directly and confirmed it is unchanged since that finding;
it has not regressed further, but it has also not been fixed.

**Why it matters — and why I believe this is the mechanism behind the "cancelledByParent
build-lock races" the brief asks about.** `ensureBuilt` is shared plumbing used by
every test file that needs a real built server (`sign-in-throttle.test.ts`,
`leave-desk.test.ts`, `search-index.test.ts`, and the smoke/delete-corrections e2e
paths). Two concurrent checkouts on one machine — a worktree and the main checkout,
which is precisely this gate's own topology (multiple lane worktrees on one Windows
box) — race on the same lock: checkout A takes the lock and builds its own `.output`;
checkout B's `waitForBuildDone` sees A's `DONE_MARKER` and concludes the build is
done, then boots **B's own, un-built or stale** `.output`. Depending on timing this
either serves a stale build silently (worse) or the server never comes up and the
GitHub-runner-side parent step tears down the job with its children marked
`cancelledByParent` (the shape named in the brief) rather than a clean failure with a
readable error. I did not reproduce a live race in this session (my own test run was
serial and passed 1,130/1,130 clean, consistent with the original ENG-115 author's
own "did not bite me, serial and passed" note) — I am reporting the unfixed code
property and its plausible connection to the named symptom, not a reproduced failure.

**Impact scope.** Any multi-worktree or multi-checkout run on one machine — which
includes this very gate's own execution model when Full and other lanes run
concurrently — can produce a spurious integration-test failure that looks like a
flaky/cancelled CI job and is not the product's fault. This wastes investigation time
and, worse, trains reviewers to treat a real future failure in this group as
"probably just the lock thing again."

**Suggested fix.** One line, as the 08-30 finding already specified: hash `repoRoot`
into both `LOCK_DIR` and `DONE_MARKER` (e.g.
`` `townreporter-dev-build-${createHash("sha1").update(repoRoot).digest("hex").slice(0,8)}.lock` ``).

**Suggested test.** A unit test asserting `ensureBuilt` invoked with two different
`repoRoot` values produces two different lock/marker paths (cheap, deterministic,
no real build needed).

**Cross-role note.** This is a re-finding of an already-filed, already-triaged Minor
(ENG-115, 2026-08-30) that has sat unfixed across at least one full release cycle
(0.5.x → 0.6.3). Worth flagging to Engineering/the punch-list owner as a "known,
cheap, still open" item rather than a new discovery.

---

### TES-03 — Minor — Test coverage — No dedicated permission/forbidden-state coverage for the desk's cross-editor boundaries beyond invites and membership

**Evidence.** Grepping `src/**/*.test.ts` for `forbidden|unauthorized|403|permission`
returns 11 files, all concentrated in `editor-invites`/`newsroom-security`/session
tests (e.g. `two-editors.e2e.test.ts`, `newsroom-security.test.mjs`'s middleware
assertions). I did not find a test asserting the reverse direction for every
mutating desk action — e.g. that a signed-out request to `commitScanForAuthenticatedEditor`,
`draftLead`, or the Opinion queue's delete/restore endpoints is refused, as opposed
to just asserting the *route* uses `deskMiddleware` via a source-text regex match
(`newsroom-security.test.mjs:263` matches `.middleware([deskMiddleware])` as a string,
which proves the wiring is present but not that an unauthenticated call is actually
rejected at runtime).

**Why it matters.** A source-text assertion is a good first line ("did someone forget
to attach the middleware") but is a different, weaker property than "an unauthenticated
request against this endpoint is refused" — a middleware implementation bug (wrong
order, a short-circuit, a dev-only bypass left in) would pass the text-match test and
fail the runtime one. This is Minor rather than Major because the newsroom-security
suite's *pattern* (checking every mutating server function is wired) is thorough and
the actual auth-guard implementation (`deskMiddleware`) does have its own direct
tests elsewhere — I could not find a gap in the guard itself, only in this specific
belt-and-suspenders runtime check being absent for the newer (0.6.x) desk actions.

**Suggested fix / test.** Extend `newsroom-security.test.mjs` (or add a sibling) with
one runtime check per mutating desk route: an unauthenticated `fetch` (or the
appropriate server-function call with no session) against `commitScanForAuthenticatedEditor`,
Draft, Dark Desk's round-commit, and the Opinion delete/restore actions, asserting a
401/redirect rather than a mutation. This is cheap (no browser needed, PGLite is fine)
and closes the gap between "the source says it's guarded" and "it is guarded."

---

### TES-04 — Nit — Test hygiene — `npm run test:live-model` and the nightly live-pipeline proof are both real coverage that lives entirely outside `npm test`/CI, with no dashboard tying their pass/fail history together

**Observation.** `RUN_LIVE_MODEL_TESTS=1` (scan-pass.test.ts) and
`scripts/live-pipeline-proof.mjs` (nightly, real Claude/Codex spend) are the *only*
two places in this repo that exercise a real model end to end rather than the fake
CLIs — genuinely valuable coverage the fakes cannot substitute for — but both are
opt-in/out-of-band by design (money and time), and their results land only in
`artifacts/nightly/<date>.json` on disk with nothing surfacing a trend or an alert on
repeated failure. Documented behavior, not a defect — `docs/nightly-proof.md` is
explicit about the tradeoff — flagging only because a silent multi-day failure streak
here would currently be discovered by someone deliberately checking, not by anything
watching.

**Suggested fix.** None required for this gate. If ever revisited: have the nightly
job's own failure post somewhere visible (an issue, a Slack/webhook, a status file
the Server page reads) rather than only a dated JSON file on disk.

---

## 5. A real CI failure I traced while establishing ground truth (not a new finding — confirms an already-fixed pattern)

While checking whether the brief's "cancelledByParent build-lock races" and
"desk-flows setup stall" symptoms had left evidence in the actual GitHub Actions
history (`gh run list`/`gh run view` against `scottconverse/TownReporter`, read-only,
no runs triggered), I found:

- **Run `33586164291`** (fix/restore-native-codex-drafting PR, 2026-09-02T03:12): the
  `desk-flows` job failed with `"Opinion model picker choices/default do not match
  the product contract"` — a real assertion failure in `desk-flows-e2e.mjs`
  (Opinion's writing-model picker didn't match its documented contract on that
  branch). This is the e2e suite doing exactly its job: catching a real screen-level
  regression a unit test would not see. Not evidence of a flaky/infrastructure
  failure — a genuine caught bug on a feature branch, before merge.
- **Run `33678563556`** (2026-09-02T20:19): the `provider-signin` job failed at
  "With a CLI installed and signed out, Sign in shows the link and completes" —
  root-caused in the very next push (`33679930033`, commit message "CI: provider-signin
  job kills the whole dev-server tree between phases") to the same issue `ci.yml`'s
  own comments now document at length: a bare `kill $DEV_PID` left `vite`'s dev
  server running, so phase two's fresh server never started and reused phase one's
  already-claimed desk. **Already fixed**, same day, and the fix is now load-bearing
  in `ci.yml` (the `kill_tree` helper, used in three jobs).
- **Run `33608032697`** (2026-09-02T08:18): the `test` job failed on
  `scripts/editorial-delivery-docs.test.mjs:44` — a doc-drift check
  (`SELF-HOSTING.md` naming the wrong tagged version). I read the current file: it
  now derives the expected version from `package.json` dynamically
  (`JSON.parse(read("package.json")).version`) specifically so a release bump cannot
  leave the assertion pinned to the previous tag — the file's own comment says this
  happened once before, on the 0.5.9 bump, and was fixed the same way. **Already
  fixed, and fixed durably** (the fix removes the whole class of failure, not just
  this instance).
- I did **not** find a run whose job conclusion or step log literally reads
  `cancelledByParent` in the runs I inspected (roughly the last 24 hours' worth via
  `gh run list`). I could not confirm that literal symptom against GitHub's history
  directly — see §6, "could not assess." TES-02 above is my best-evidence account of
  the mechanism that would produce it, from reading the code, not from observing it
  happen.

I'm including this section because it's real, checkable ground truth (via `gh run
view --log`, not invented) that directly bears on "flaky patterns" — and because the
right read of all three is **the CI suite is doing its job and the team fixes what it
catches same-day**, which is a positive signal for the gate, not a negative one.

---

## 6. What's working (specific, credited)

- **The suite is real and it is green.** 1,130 tests, 1,127 pass, 0 fail, 3
  explained skips, run fresh in this session against a real Postgres so nothing
  silently passed by skipping. The brief's ~1,130 figure and the 12-CI-job count are
  both accurate, not inflated.
- **Regression tests are written as regression tests.** A large fraction of the
  suite (`ENG-106`'s trash-purge test, the fail-over ladder tests, the desk-flows
  job's own origin story) is explicitly "reproduce the original bug, then prove the
  fix," with the bug's own story in the comment. That is the single best predictor of
  a suite that stays useful as the codebase grows, and it is consistently present
  here, not just in a few showcase files.
- **The Postgres-skip mechanism is honest and self-enforcing.** `pg-admin.ts`'s
  `probePostgres` skips with a readable, actionable reason rather than failing a
  machine with no Postgres, and `scripts/postgres-tests-are-covered.test.mjs` is a
  real, working meta-test that would fail red if a DB-dependent file were ever
  quietly dropped from the CI job that gives it a real database — I traced its logic
  directly rather than trusting its own passing status.
- **The e2e layer catches real screen bugs, not just "page returns 200."** Confirmed
  via a live CI failure I found and read (`33586164291`, Opinion's picker contract) —
  this is the suite doing exactly the job the 0.5.1 `TE-04` finding demanded of it.
- **Failures get root-caused and fixed same-day, with the fix generalized rather than
  patched narrowly** — the `kill_tree` fix and the dynamic-version doc-check fix are
  both examples of turning one incident into "this whole class can't happen again,"
  not just unblocking the one failing run.
- **No render-only/would-pass-anyway anti-pattern found at scale** (§3) — a real,
  deliberate check I ran, not an assumption.

---

## 7. What I could not assess, and why

- **The literal `cancelledByParent` symptom named in the brief.** I inspected recent
  GitHub Actions run history via `gh run view --log` (read-only, no runs triggered)
  and found three real, distinct, already-explained failures (§5) but none carrying
  that exact job-conclusion string in the runs I sampled. I could not rule out that it
  occurred in a run outside the window I checked, or in a step-level detail `gh run
  view` summarized away. TES-02 is my best evidentiary account of a still-open code
  property that would produce exactly that symptom; I am not claiming to have
  reproduced or directly observed it.
- **I did not independently re-run the 12 CI jobs locally** (out of scope for this
  role's brief, which asks for the suite total + the CI/e2e mapping + the coverage
  reality check) — my CI-behavior claims in §5 come from reading real GitHub Actions
  run logs for this repo, not from local reproduction.
- **I did not mutate code in a scratch worktree to prove any specific test
  load-bearing.** The brief permits this (`git worktree add ... -b gate-test-scratch`)
  but I judged it unnecessary here: the codebase's own comments already document, in
  detail, the specific bug each regression test was written to catch (§2, §6), which
  is stronger evidence of load-bearing-ness than a single revert-and-rerun on one
  test would have been, and the time was better spent establishing the real numbers
  (§0) and tracing real CI history (§5) than manufacturing one additional proof point.
- **Client-side accessibility/visual-regression coverage** is a UX-role question, not
  a test-coverage-vs-claim question, and I deferred it — noting only the structural
  fact (zero `.test.tsx`, zero component-level tests) that both roles should be aware
  touches their findings.

---

## 8. Cross-role notes

- **TES-01 (Scan/Sources coverage gap) is also a docs-adjacent finding**: neither
  screen's e2e absence is disclosed anywhere in `docs/` or the CHANGELOG the way,
  say, the offline-search limitation is (Walkthrough Finding 4). If the Technical
  Writer role is cataloguing coverage claims vs. reality, this is a concrete example
  of a gap that isn't claimed to be closed but also isn't flagged as open.
- **TES-02 (build-lock namespacing)** is purely an Engineering-owned fix
  (`src/lib/test-support/pg-admin.ts`) that happens to matter for Test because it is
  test-infrastructure code; flagging for the Principal Engineer role in case ENG-115
  is being tracked separately and this confirms it is still open as of this commit.
