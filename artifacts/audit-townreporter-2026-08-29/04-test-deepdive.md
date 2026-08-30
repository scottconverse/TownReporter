# Test Suite Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-29
**Role:** Test Engineer
**Scope audited:** `npm test` (node:test — 12 files under `scripts/`, 46 under `src/`), the Playwright scripts under `scripts/` (`lifecycle-e2e.mjs`, `desk-flows-e2e.mjs`, `smoke-built-server.mjs`, `browser-smoke.mjs`, `site-walkthrough.mjs`, `search-index-proof.mjs`), and `.github/workflows/ci.yml`. Full scope.
**Auditor posture:** Balanced

---

## TL;DR

This is a bottom-heavy suite — 534 fast, offline, deterministic unit tests over pure functions, plus three genuinely good browser walks bolted on top. The unit layer is honest about what it can't do (it announces its skips rather than pretending), and the e2e layer, when it runs, drives a real Chromium against a real server and reads the console. But the middle is hollow in a specific and dangerous way: **roughly 6,500 lines of server-side code — including every server function in `desk.ts` and `dark.ts`, and the entire auth boundary except `gate-identity` — are imported by no test.** What stands in for them is a file of eighteen regex-over-source assertions. I removed the auth middleware from the ops-health server function; typecheck passed and all 534 tests passed. And the newest browser walk, added to close a prior audit's finding, **cannot pass in CI as wired** — I reproduced its failure and then reproduced its success on a clean desk, so the defect is in the pipeline, not the script.

## Severity roll-up (tests)

| Severity | Count |
|---|---|
| Blocker | 1 |
| Critical | 2 |
| Major | 4 |
| Minor | 3 |
| Nit | 1 |

## What's working

Credit where it is earned — several of these are better than what I usually see at this stage.

- **The default suite is deterministic, offline and free, and that is now enforced.** `npm test` completed in 16.7 s on this machine, 531 pass / 3 skip / 0 fail, with no network calls. `scripts/newsroom-security.test.mjs` has a meta-test that fails if any `src/lib/news/*.test.ts` calls `grokChat(` or `claudeCodeChat(` without either `RUN_LIVE_MODEL_TESTS` gating or the provider disabled. `src/lib/news/scan-pass.test.ts:123` is correctly gated. This closed a real prior defect (a 90-second paid model call in the default suite) and closed it with a guard, not a promise.
- **Test discovery is a glob, and a test enforces that it stays one.** `package.json` uses `scripts/**/*.test.mjs` and `src/**/*.test.ts`; `newsroom-security.test.mjs` fails if `npm test` ever names an individual `.test.ts` file again. This is the correct fix for the prior "45th test file existed but was never listed" failure — the fix is structural, not a one-time correction.
- **Skips are announced, not hidden, and CI covers the gap they leave.** `src/lib/news/search-index.test.ts` skips its two index checks with the reason `no pg_trgm on this database (PGLite or no superuser)` — and the `search-index` CI job then runs those same checks plus a 20,000-story benchmark against a real `postgres:18` service. That is exactly the right handling of an environment-limited test. Its own docstring explains why three earlier `EXPLAIN`-asserting versions were wrong. This is unusually mature.
- **The e2e scripts are real browser tests, not fetch loops.** `smoke-built-server.mjs` launches Chromium, subscribes to `pageerror` and `console`, asserts `/login` moves past its `Opening…` state and renders ≥2 form fields, and separately asserts a cold front-page load makes **zero** outside network requests. A 200 is explicitly not accepted as proof. `desk-flows-e2e.mjs` records which step each console error fired on.
- **CI runs both dev-mode and built-mode browser smokes on purpose,** with the reasoning written down (`ci.yml` comments): the built-server smoke tolerated the reintroduced `node:crypto` externalization, the dev-mode one caught it. Running both because they fail differently is the right call and it is documented as a deliberate choice.
- **`delete.test.ts` applies the real migrations from disk** rather than copying DDL into the test, and says why (`src/lib/news/delete.test.ts:16-24`). It then asserts the schema facts it depends on — `drafts.lead_id` nullable per migration 0015 — so it cannot go vacuous silently.
- **`desk-flows-e2e.mjs` covers accessibility invariants as first-class assertions**, not as an afterthought: a persistent `#desk-announcer` live region must exist, `main h3` count must be zero (no skipped heading level), and row action controls must have computed `opacity: 1` without hover. I ran it: 17/17 steps, no console errors.
- **No flakiness has been institutionalized.** There is no `retries:` config, no `--retry` flag, no `continue-on-error` anywhere in `ci.yml`. Waiting is done with Playwright locator waits, not bare sleeps, with two documented exceptions where a poll loop is genuinely needed (correction propagation in `lifecycle-e2e.mjs`).

## What couldn't be assessed

- **CI run history.** I have the workflow file, not the Actions log. I cannot say whether the `lifecycle` job is currently red, or whether it has ever been run since `desk-flows-e2e.mjs` was added — only that, as written, it cannot pass. TEST-001 is stated as a reproduced local defect in the wiring, not as an observed CI failure.
- **Server-function HTTP-level authorization.** I verified the middleware wiring by reading source and by mutation, and verified `/desk` page-level behaviour via the smoke script. I did not craft raw `POST` requests to TanStack Start's server-function endpoints to confirm an unauthenticated caller is rejected at the wire. That probe belongs to the QA lane; my finding is about the absence of a *test*, not a claim that the boundary is currently broken.
- **Mutation score.** No mutation-testing tool is configured, and installing one was out of scope. I ran two hand-mutations instead (documented in TEST-002); they are a sample, not a score.

---

## Test landscape

| Dimension | Observation |
|---|---|
| Framework(s) | `node:test` + `node:assert/strict` throughout (no Jest/Vitest). `--experimental-strip-types` for the TS half. Playwright for browser walks, invoked as plain scripts, not through a test runner. |
| Test pyramid shape | Very bottom-heavy: 534 unit tests over pure/near-pure functions; a thin band of DB-backed tests against in-process PGLite; three browser walks with no runner, no retries and no parallelism. The integration tier — server functions, middleware, routes — is essentially absent and is substituted by regex-over-source assertions. |
| Coverage tool | None. No `c8`, `nyc`, or `--experimental-test-coverage` in `package.json` or `ci.yml`. |
| Reported coverage (if any) | None reported. `docs/manual.md:444` reports a test *count* (528) which is stale — the actual run is 534. |
| Flakiness posture | Clean. No retry configuration anywhere. Three skips, all conditional and all self-explaining (2× Windows symlink permission, 1× no `pg_trgm` on PGLite; plus the opt-in live-model test). |
| CI blocking? | Yes for `test` / `typecheck` / `smoke-built` / `smoke-dev` / `search-index`. The `lifecycle` job blocks but cannot pass as wired (TEST-001). Three guard scripts that exist and are unit-tested never run in CI at all (TEST-007). |

**Suite shape in one sentence:** a fast, honest, well-documented unit suite over the pure layer, a genuinely good but very narrow browser layer, and a middle tier replaced by `assert.match(readFileSync(...))`.

---

## Findings

> **Finding ID prefix:** `TEST-`
> **Categories:** Coverage / Shortcut / Flakiness / Quality / Ergonomics / Mocking / Regression / CI

### [TEST-001] — Blocker — CI — The 0.5.1 desk-flows browser walk cannot pass in CI, because the lifecycle job claims the desk before it runs

**Evidence**

`.github/workflows/ci.yml`, job `lifecycle`, runs two Playwright scripts as two steps against **one** background `npm run dev` server:

```yaml
- name: File, publish, correct
  run: |
    npm run dev > /tmp/townreporter-dev.log 2>&1 &
    ...
    node scripts/lifecycle-e2e.mjs

- name: The 0.5.1 desk flows
  run: node scripts/desk-flows-e2e.mjs
```

Both scripts create their own throwaway owner account. `desk-flows-e2e.mjs:19` states the requirement plainly: *"Wants an UNCLAIMED desk: it creates its own throwaway owner, like the lifecycle script."* But `src/routes/login.tsx:73-74` switches the page to sign-in mode once the desk is claimed:

```ts
const claimed = claim.isError || Boolean(claim.data?.claimed);
const mode: "create" | "signin" = claimed ? "signin" : wantCreate ? "create" : "signin";
```

In sign-in mode the `Name` and `Confirm password` fields do not exist, and `desk-flows-e2e.mjs:82-87` fills them unconditionally.

I reproduced the exact CI sequence locally against my own dev instance (port 8123, scratch database `townreporter_audit_test`, since dropped):

1. `lifecycle-e2e.mjs` → `{"ok":true,...}`
2. `desk-flows-e2e.mjs` against the same server → failure at step zero:

```
{
  "ok": false,
  "error": "locator.fill: Timeout 45000ms exceeded.\n  - waiting for getByLabel('Name')",
  "url": "http://127.0.0.1:8123/login",
  "text": "TOWNREPORTER\n\nEditor sign-in\n\nThis desk already has an editor. Sign in if that's you. ...",
  "completed": []
}
```

`"completed": []` — not one of its seventeen steps ran.

I then dropped the database, restarted the server, and ran `desk-flows-e2e.mjs` first against a clean desk: **17/17 steps, `{"ok": true, "steps": 17}`**. The script is sound. The pipeline wiring is the defect.

The guard that is supposed to protect this coverage does not notice, because it greps:

```js
// scripts/newsroom-security.test.mjs
test("CI walks the 0.5.1 desk flows in a browser", () => {
  assert.match(ci, /desk-flows-e2e\.mjs/, "CI must run the desk flows walk");
```

`ci.yml` contains the string, so the test passes. It asserts the job is *mentioned*, not that it can *run*.

**Why this matters**

Everything shipped in 0.5.1 — Opinion, delete, Undo, the trash and its restore, the Server page, the Dark Desk dials — has, in practice, no automatic browser coverage. That absence is precisely what a prior audit filed as TE-04, and it is the stated reason a locator leak and an unreachable editorial reached the paper. The fix was written, it works, and it is wired into CI in a way that means either (a) the `lifecycle` job is permanently red and the team is merging past a failing required job, or (b) it has never been run since the second step was added. Both outcomes leave the release with the same blind spot it was supposed to have closed, while a green-looking guard test asserts otherwise. That combination — a coverage gap plus a test that reports it as closed — is worse than the original gap.

**Blast radius**
- Adjacent code: `scripts/lifecycle-e2e.mjs` and `scripts/desk-flows-e2e.mjs` both assume they are the first account. Any third browser walk added to this job inherits the same conflict. `scripts/site-walkthrough.mjs` and `scripts/browser-smoke.mjs` share the throwaway-account pattern and would collide identically if ever added to CI.
- Shared state: the dev server's PGLite database, which is per-process and persists for the life of the job. `newsroom_members` carries a unique partial index on `(newsroom_id) WHERE role = 'owner'` (verified: migration 0012, confirmed live on a migrated Postgres — a second owner insert raises `duplicate key value violates unique constraint "newsroom_members_one_owner"`), so "first account owns the desk" is a hard database-level fact, not a soft one that could be worked around in the app.
- User-facing: no direct change. The change is that the 0.5.1 desk flows would actually be regression-tested on every PR.
- Migration: none.
- Tests to update: `scripts/newsroom-security.test.mjs` — the `CI walks the 0.5.1 desk flows` test needs to assert the walk runs against a server the lifecycle walk has not claimed, not merely that the filename appears.
- Related findings: TEST-004 (grep-as-test is why this went unnoticed), TEST-007 (other guard scripts that exist but never run).

**Fix path**

Give the desk-flows walk its own server. Cheapest correct change — split it into its own job, mirroring `smoke-dev`:

```yaml
  desk-flows:
    name: The 0.5.1 desk flows
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Boot a fresh desk and walk it
        env:
          BETTER_AUTH_SECRET: ci-desk-flows-secret-not-for-production
          DESK_FLOWS_BASE_URL: http://127.0.0.1:8080
          TOWNREPORTER_CLAUDE_CODE: "0"
        run: |
          npm run dev > /tmp/dev.log 2>&1 &
          for i in $(seq 1 60); do
            curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/ && break
            sleep 2
          done
          curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/ || {
            echo "dev server did not come up"; tail -n 80 /tmp/dev.log; exit 1; }
          node scripts/desk-flows-e2e.mjs
```

Then strengthen the guard so it cannot pass on a mention alone — assert that `desk-flows-e2e.mjs` and `lifecycle-e2e.mjs` do not appear in the same job block. Separately, consider making both scripts fail fast and loudly on a claimed desk (`if the login page says "Editor sign-in", throw "this walk needs an unclaimed desk"`), so the next person to make this mistake gets a diagnosis in one line instead of a 45-second locator timeout.

---

### [TEST-002] — Critical — Coverage — Removing the auth middleware from a server function passes typecheck and all 534 tests

**Evidence**

The only thing standing between the desk's server functions and an unauthenticated caller is `.middleware([deskMiddleware])`. The only test of that is a regex census in `scripts/newsroom-security.test.mjs:21-38`, and it reads exactly two files:

```js
const desk = readFileSync(join(ROOT, "src/lib/news/desk.ts"), "utf8");
const dark = readFileSync(join(ROOT, "src/lib/news/dark.ts"), "utf8");
assert.deepEqual(everyServerFnHasMiddleware(desk, "deskMiddleware"), []);
assert.deepEqual(everyServerFnHasMiddleware(dark, "deskMiddleware"), []);
```

Six files in `src/` export gated server functions. Four of them are outside the census:

| File | Gated server functions | In the census? |
|---|---|---|
| `src/lib/news/desk.ts` | 22 | yes |
| `src/lib/news/dark.ts` | 19 | yes |
| `src/lib/news/opinion.ts` | 8 (incl. `publishEditorial`, `deleteEditorial`) | **no** |
| `src/lib/news/trash.ts` | 3 (incl. `purgeTrashItem` — permanent delete) | **no** |
| `src/lib/ops/dashboard.ts` | 2 (`getOpsHealth`, `runOpsAction`) | **no** |
| `src/lib/news/claim.ts` | 3 (`authMiddleware`) | **no** |

All six are correctly gated *today*. I checked each one by hand. The finding is that nothing would notice if one stopped being.

**Mutation 1** — removed `.middleware([deskMiddleware])` from `purgeTrashItem` (`src/lib/news/trash.ts:160`), the permanent-delete path:
- `npm test` → `tests 534 / pass 531 / fail 0`
- `npm run typecheck` → **caught it**, two errors, because the handler destructures `context`.

**Mutation 2** — removed `.middleware([deskMiddleware])` from `getOpsHealth` (`src/lib/ops/dashboard.ts:21`). This handler takes no `context`, so nothing types it:

```ts
export const getOpsHealth = createServerFn({ method: "GET" })
  // MUTANT
  .handler(async (): Promise<OpsHealth> => {
    const { collectHealth } = await import("./health.server");
    return collectHealth();
  });
```

- `npm run typecheck` → **clean, no output**
- `npm test` → `tests 534 / pass 531 / fail 0`

Both mutations were reverted; `git diff` is empty.

**Why this matters**

`getOpsHealth` returns what `collectHealth()` gathers — disk headroom, uptime, watchdog freshness, database state, running-job status (`src/lib/ops/health.server.ts`, 418 lines). Silently unauthenticating it hands a stranger a reconnaissance page about the operator's box, and the full pipeline says green. The class of bug this permits is the worst kind for a self-hosted product: **an authorization regression introduced by an ordinary refactor** — someone reorganising a server function, splitting a file, or copy-pasting a new endpoint from a neighbour that happens to lack the line. Every mutation of this shape in `opinion.ts`, `trash.ts` and `dashboard.ts` is invisible to both gates, and the ones in `desk.ts`/`dark.ts` are caught only by string match, not by behaviour.

The deeper point: the census function itself is fragile. `everyServerFnHasMiddleware` looks for the literal substring `` `.middleware([${middleware}])` ``. A formatter that wraps the call, a second middleware in the array, or a rename all defeat it — and the failure mode is a *pass*.

**Blast radius**
- Adjacent code: `src/lib/news/opinion.ts`, `src/lib/news/trash.ts`, `src/lib/ops/dashboard.ts`, `src/lib/news/claim.ts`, `src/lib/auth/middleware.ts`. Also `src/lib/news/evidence.ts`, whose five server functions are deliberately public — any behavioural test must know which set is which, so the fix needs an explicit allowlist of intentionally-public functions rather than an implicit one.
- Shared state: `deskMiddleware` in `src/lib/news/desk-auth.ts` is the single chokepoint composing `assertSameSiteRequest()` → `requireUserId()` → `requireEditor()`. All three are untested (see TEST-003). A behavioural test at the middleware level covers every consumer at once.
- User-facing: no change for legitimate users. Closes a class of silent regression.
- Migration: none — additive test coverage only.
- Tests to update: `scripts/newsroom-security.test.mjs` census extended to all files exporting `createServerFn`, discovered by walking `src/` rather than by a hardcoded two-file list.
- Related findings: TEST-003 (the boundary itself is untested), TEST-004 (grep-as-test pattern), TEST-001 (same guard style failed there too).

**Fix path**

Two changes, in this order.

1. **Make the census self-discovering and structural.** Walk `src/**/*.ts`, collect every `export const X = createServerFn`, and assert each is either in an explicit `PUBLIC_SERVER_FNS` allowlist (`evidence.ts`'s four, `public.ts`'s six, `claim.ts:13 deskClaimState`) or carries a middleware. Parse for `.middleware([` … `])` and check membership of the array, so a formatter or a second middleware cannot defeat it. This is cheap and catches the copy-paste case.

2. **Add one behavioural test of the chokepoint** — the higher-value half. `deskMiddleware`'s server half is three calls; a test that stubs `getRequest()` and Better Auth's session lookup and asserts (a) an absent bearer token throws, (b) a valid token for a non-member throws `ForbiddenError` with `status === 403`, (c) a valid editor gets `{ userId, newsroomId, role }` — turns the entire authorization story from "the string is in the file" into "the code refuses". Pair it with the `assertSameSiteRequest` table test in TEST-003.

---

### [TEST-003] — Critical — Coverage — The auth boundary, and ~6,500 lines of server-side code, are imported by no test

**Evidence**

I took every `from "./x"` / `from "../x"` import across all 58 test files and compared it against the module list. The following are never imported by any test — not mocked, not partially covered: **not loaded**.

| Module | Lines | What it does |
|---|---|---|
| `src/lib/news/dark.ts` | 1,307 | the Dark Desk: 19 server functions, research loop, promises, signals |
| `src/lib/news/desk.ts` | 1,273 | the desk: scan, file, draft, hold, kill, publish — 22 server functions |
| `src/lib/ops/health.server.ts` | 418 | disk / uptime / watchdog / job readings |
| `src/lib/news/opinion.ts` | 386 | the Opinion desk, incl. `publishEditorial` |
| `src/lib/auth/gate-session.server.ts` | 331 | session gate |
| `src/lib/auth/server.ts` | 304 | Better Auth server configuration |
| `src/lib/news/editorial.server.ts` | 288 | editorial requests + extras, incl. runtime DDL |
| `src/lib/auth/client.ts` | 236 | bearer-token storage and retrieval |
| `src/lib/auth/gate-identity.server.ts` | 178 | (its pure half **is** tested — `gate-identity.test.ts`, 326 lines) |
| `src/lib/auth/popup.server.ts` | 178 | OAuth popup flow |
| `src/lib/news/trash.ts` | 172 | delete / restore / purge server functions |
| `src/lib/auth/pglite-dialect.ts` | 138 | Better Auth ↔ PGLite bridge |
| `src/lib/news/voice.server.ts` | 132 | voice file loading |
| `src/lib/ops/actions.server.ts` | 131 | the ops actions that actually run |
| `server/middleware/grok-pwa.ts` | 111 | request middleware |
| `src/routes/feed.ts` | 108 | the RSS feed |
| `src/lib/auth/verify.server.ts` | 97 | **`requireUserId` — bearer-token verification** |
| `server/middleware/canonical-host.ts` | 63 | host canonicalization |
| `src/lib/auth/isolation.server.ts` | 52 | **`assertSameSiteRequest` — the sibling-tenant CSRF guard** |
| `src/lib/auth/middleware.ts` | 47 | `authMiddleware` |
| `src/lib/ops/dashboard.ts` | 45 | ops server functions |
| `src/lib/news/monitors-cron.ts` | 36 | the monitors cron |
| `src/routes/api/cron.monitors.ts` | 21 | the cron endpoint |

Total across this table: ~6,500 lines. Every route file in `src/routes/` and every component in `src/components/` is likewise unimported by tests.

The three names that matter most are the last ones in the auth column. Searching the entire test tree for them returns only regex assertions:

```
$ grep -rn "requireUserId\|assertSameSiteRequest\|requireEditor" --include="*.test.ts" --include="*.test.mjs" src scripts
scripts/newsroom-security.test.mjs:52:  assert.match(auth, /requireUserId/);
scripts/newsroom-security.test.mjs:53:  assert.match(auth, /requireEditor/);
scripts/newsroom-security.test.mjs:54:  assert.match(auth, /assertSameSiteRequest/);
```

`assertSameSiteRequest` (`src/lib/auth/isolation.server.ts:34-53`) is a pure function of four request headers with five distinct early-return branches and one throw. Its own docstring describes the attack it exists to stop: a malicious sibling app on `*.grok.me` riding this app's `SameSite=Lax` session cookie via a scripted request. It is the ideal unit test — a small table of `(sec-fetch-site, sec-fetch-mode, sec-fetch-dest, method) → allow | CrossSiteRequestError` — and it has none.

**Why this matters**

The e2e walks cover the happy authenticated path and one unauthenticated page load (`/desk`). Nothing covers the *boundary conditions* on the boundary itself: a missing bearer token, an expired one, a token belonging to a user who is not a newsroom member, a token belonging to a member of a *different* newsroom, a scripted `POST` arriving with `sec-fetch-site: same-site` from a sibling origin, a top-level GET with `sec-fetch-dest: embed` (which the code deliberately rejects — an iframe-smuggled navigation). Each of those is a one-line change away from being wrong, and each would ship green.

The same argument applies with less urgency but more breadth to `desk.ts` and `dark.ts`: 2,580 lines containing the product's entire editorial workflow, covered by regex plus whatever the two browser walks happen to click.

**Blast radius**
- Adjacent code: the whole `src/lib/auth/` tree; `deskMiddleware`/`authMiddleware`; every one of the 57 gated server functions downstream of them.
- Shared state: session cookies, `newsroom_members`, the bearer token in client storage. A test at the middleware layer covers all consumers; tests per-server-function do not.
- User-facing: none directly. What changes is that an authorization regression becomes a red build instead of a shipped defect.
- Migration: none.
- Tests to update: none — this is purely additive. Note that several of these modules import `@tanstack/react-start`, which does not load under bare `node --test`; the established workaround in this repo is the `trash.ts` / `trash-store.ts` split (documented at `src/lib/news/trash-store.ts:6-9`), and the same split is the route in for `desk.ts`'s SQL.
- Related findings: TEST-002 (same root: the boundary is only greppable), TEST-004 (the grep-as-test pattern), TEST-005 (DB-backed tests run on a schema that isn't the migration schema).

**Fix path**

Ranked by value per hour:

1. `src/lib/auth/isolation.server.ts` — a header table test. Pure function, no I/O, ~30 lines of test, covers the sibling-tenant attack the file exists for. Highest value in the repo right now.
2. `src/lib/auth/verify.server.ts` — `requireUserId` with a stubbed session lookup: absent token, malformed token, valid token. ~40 lines.
3. `deskMiddleware`'s server half end-to-end (see TEST-002 fix path step 2).
4. `desk.ts` — apply the `trash.ts`/`trash-store.ts` split to the two highest-stakes flows (`publishLead`, the scan hash-commit logic that `newsroom-security.test.mjs` currently guards by regex), so the SQL becomes callable under `node --test` against PGLite.
5. `src/routes/feed.ts` and `sitemap[.]xml.ts` — pure output-shape tests. Cheap, and both are machine-consumed surfaces where a malformed field is invisible to a human reviewer.

---

### [TEST-004] — Major — Quality — Regex-over-source assertions are standing in for behavioural tests, including for invariants the comments call load-bearing

**Evidence**

`scripts/newsroom-security.test.mjs` is 291 lines and 18 tests. Every one of them is `readFileSync` plus `assert.match` / `assert.doesNotMatch`. It is the project's entire security test file. Representative assertions:

```js
assert.match(desk, /assertRate\(context\.userId, "scan"\)/);
assert.doesNotMatch(desk, /set last_hash = \$\{hash\}, last_fetched_at = now\(\)/);
assert.doesNotMatch(desk, /tier <> 'C'/);
assert.match(dark, /Math\.min\(1,/);
assert.doesNotMatch(dark, /Math\.min\(0\.5,/);
```

Three problems, in increasing order of seriousness:

1. **Whitespace- and rename-fragile in the *passing* direction.** `assert.doesNotMatch(desk, /set last_hash = \$\{hash\}, last_fetched_at = now\(\)/)` passes the moment anyone reformats that SQL across two lines — including Prettier. A negative assertion that a formatter can satisfy is not a guard.
2. **Presence is not position.** `assert.match(desk, /assertRate\(context\.userId, "scan"\)/)` is satisfied by the string appearing *anywhere* in 1,273 lines — inside a comment, inside dead code, inside a different function. It cannot distinguish "the rate limit is called on the scan path" from "the rate limit used to be called on the scan path and the line is now unreachable."
3. **It is used for invariants the code itself says are critical.** `src/lib/news/membership.test.ts:104-116`:

```js
/**
 * The one guarantee that must survive: two people cannot both own it.
 */
it("still cannot produce two owners", async () => {
  const migration = readFileSync(".../migrations/0012_newsroom_appliance.sql", "utf8");
  assert.match(migration, /unique index/i);
  assert.match(migration, /owner/i);
});
```

That test passes if migration 0012 contains a unique index on *any* column and the word "owner" appears *anywhere* — a comment, for instance. It would also pass if a later migration (0013–0018) dropped the index entirely, since it only reads 0012.

The real check takes one statement. On a database with all 18 migrations applied I ran:

```
$ psql -d townreporter_audit_test -c "insert into newsroom_members (user_id, role, newsroom_id)
                                      values ('a','owner',1),('b','owner',1);"
ERROR:  duplicate key value violates unique constraint "newsroom_members_one_owner"
DETAIL:  Key (newsroom_id)=(1) already exists.
```

The invariant genuinely holds — `newsroom_members_one_owner UNIQUE, btree (newsroom_id) WHERE role = 'owner'::text`. It is simply not what the test measures.

`scripts/ssrf-check.test.mjs` (18 lines) is the same shape one level further out: it reads *its own source file* and asserts it does not redefine `isBlockedAddress`, then asserts that `fetch-url.test.ts` contains three specific IPv6-mapped literals.

**Why this matters**

There is a real and defensible use for this pattern: pinning a decision that has no runtime surface — "the newsletter RPC stays deleted," "`node:crypto` must not reach the client bundle." Several of the 18 tests are legitimately in that category and are good. The problem is that the pattern has spread to cover things that *do* have a runtime surface, where a behavioural test is both possible and strictly stronger. The result is a security test file that reports on the *text* of the code rather than on what the code does, and which — as TEST-001 and TEST-002 both demonstrate — passes cleanly while the thing it names is broken.

The bug class this permits: **any defect that preserves the source text while changing the behaviour.** Reordering statements so a rate-limit call becomes unreachable. Moving a guard inside a branch that is never taken. Adding a second code path that skips the check. A schema change in migration 0019 that undoes migration 0012.

**Blast radius**
- Adjacent code: `scripts/newsroom-security.test.mjs` (18 tests), `scripts/ssrf-check.test.mjs` (1), `src/lib/news/membership.test.ts:88-116` (3), `src/lib/news/schema.test.ts` and `src/lib/news/dark.open.test.ts` (spot-checked, partially source-reading). Roughly 25 of 534 tests are source-text assertions — small by count, disproportionate by what they are trusted to cover.
- Shared state: none. These tests touch no runtime state, which is the point.
- User-facing: none directly.
- Migration: none.
- Tests to update: the ones converted. Expect the converted versions to be longer and to need a PGLite fixture.
- Related findings: TEST-001, TEST-002, TEST-005.

**Fix path**

Don't delete the file — triage it. For each of the 18 tests ask: *does this assertion have a runtime surface?*

- **No runtime surface** (the newsletter RPC stays gone; `node:crypto` stays out of `public.ts`; `npm test` uses a glob; `.env.example` lists every variable read) — keep as-is. These are the pattern used correctly, and they are genuinely valuable.
- **Has a runtime surface** — convert, and keep the source assertion alongside if you like belt and braces:
  - *two owners* → `await assert.rejects(() => sql\`insert ... 'owner' ... \`)` against migrated PGLite. Four lines, and it reads every migration, not just 0012.
  - *`sanitizePublicUrls` is the URL gate, not an origin allowlist* → call it with a list of URLs and assert the output.
  - *rate limits on scan/draft/dark* → call the rate limiter twice past its ceiling and assert it throws.
  - *scan does not stamp `last_hash` until the writing pass succeeds* → run the scan path against PGLite with a failing writer and assert `last_hash` is unchanged. This is the single highest-value conversion in the file: the assertion as written is defeated by a line wrap.
  - *SSRF follows redirects manually and re-asserts each hop* → `fetch-url.test.ts` already has real IPv6-mapped cases; extend it with a stubbed redirect chain whose second hop resolves to a blocked address, and assert the throw.

Add a short rule to `AGENTS.md`: *a source-text assertion is for pinning a decision that has no runtime surface. If you can call the function, call the function.*

---

### [TEST-005] — Major — Coverage — DB-backed unit tests run against a schema that is not the migrations schema

**Evidence**

Under `node --test` there is no Vite transform, so `import.meta.glob` fails and `src/lib/db.ts:157-163` catches it and proceeds with **no migrations at all**:

```js
} catch {
  // Node unit tests have no Vite glob transform; investigate schema is applied by ensureInvestigateSchema.
  migrations = {};
}
```

Every table those tests see therefore comes from runtime `ensure*Schema()` DDL living in `src/`, not from `migrations/*.sql`:

```
src/lib/news/dark.ts:142,150,159,172,203    create table if not exists ...
src/lib/news/desk.ts:57,60                  alter table ... add column if not exists ...
src/lib/news/editorial.server.ts:70,210     create table if not exists ...
src/lib/news/investigate.ts:130-368         ~25 create table / alter table statements
```

So the project has **two schema sources**: the 18 files in `migrations/`, which is what a self-hoster's Postgres actually gets, and the inline DDL, which is what the test suite actually gets. Nothing compares them.

`delete.test.ts` is the exception and knows it — it reads `migrations/` off disk deliberately (`src/lib/news/delete.test.ts:16-24`, quoted approvingly in *What's working*). But its loader swallows every failure:

```js
try {
  await pg.exec(readFileSync(join(dir, name), "utf8"));
} catch {
  // A migration that does not apply on a bare PGLite is not this test's problem.
}
```

Its guard assertion then checks only that `leads`, `drafts`, `articles` exist and `drafts.lead_id` is nullable. A migration that fails to apply for an unrelated reason is silent.

**Why this matters**

The bug class: **a column, constraint, index or default that exists in one schema source and not the other.** Add a `not null` column to `leads` in migration 0019 but not to the `ensure*` path, and every unit test passes while the first real insert on a self-hosted Postgres fails. Reverse the direction — add it to the inline DDL only — and the tests pass, the developer's PGLite works, and the operator's production database never gets the column. Given the product is *self-hosted* (the operator's Postgres is the only one that matters), this is exactly the divergence that bites furthest from the people who could catch it.

Migration 0018 already demonstrates the hazard is live: it is written to notice `pg_trgm` is absent and skip its indexes, which is correct — but it means "migrations applied successfully" and "the schema is what you think it is" are already two different statements in this codebase.

**Blast radius**
- Adjacent code: `src/lib/db.ts:157-163`; every `ensure*Schema()` in `dark.ts`, `desk.ts`, `editorial.server.ts`, `investigate.ts`; all 18 files in `migrations/`.
- Shared state: the database schema — the single most shared piece of state in the product.
- User-facing: a schema divergence surfaces as a 500 on a desk action for self-hosters, and only for self-hosters.
- Migration: none to write; the fix is a test.
- Tests to update: potentially every DB-backed test, if the fix is to migrate PGLite properly in the test harness — they may find columns they did not have before, which is the point.
- Related findings: TEST-003 (the modules holding the inline DDL are otherwise untested), TEST-006 (same tests, different hazard).

**Fix path**

1. **One reconciliation test.** Bring up two PGLite instances: one with `migrations/*.sql` applied from disk (the `delete.test.ts` loader, minus the empty catch), one with every `ensure*Schema()` called. Diff `information_schema.columns` and `information_schema.table_constraints` for the tables both define. Assert the diff is empty, or assert it against an explicit, commented allowlist of known-and-intended differences. This turns an invisible divergence into a failing test the day it is introduced.
2. **Make the `delete.test.ts` loader loud.** Collect the failures instead of discarding them and assert the list is empty, or at minimum print it. Right now a broken migration is indistinguishable from a working one.
3. **Decide, and write down, which source is authoritative.** `newsroom-security.test.mjs` already asserts *"schema belongs in migrations/"* — but only for `public.ts`. Either apply that rule everywhere and delete the inline DDL, or state explicitly that `ensure*` is for opt-in subsystems and reconcile per step 1. Half-and-half with no reconciliation is the state that produces the bug.

---

### [TEST-006] — Major — Ergonomics — DB-backed tests write to whatever `DATABASE_URL` points at, with no guard

**Evidence**

`package.json` runs the suite directly — `"test": "node --test ..."` — not through `scripts/with-app-env.mjs`, so the repo's `.env` is not loaded and `DATABASE_URL` is normally unset. That is the safe default and it works: `getDbSource()` returns `pglite` and the tests use an in-process database.

But `getDbSource()` (`src/lib/db.ts:27-31`) reads `process.env.DATABASE_URL` at call time from the *ambient* environment. If a developer has it exported in their shell — a normal thing to do, and this repo's own `search-index` CI job does exactly that — the same tests connect to that database and mutate it. They are not read-only:

```js
// src/lib/news/membership.test.ts:39-61
await sql`insert into newsroom_members (user_id, role, newsroom_id) values (${owner}, 'owner', 1)`;
await leaveAsEditor(owner);           // DELETEs newsroom members
await sql`delete from newsroom_members where user_id = ${decoy}`;
```

`delete.test.ts` inserts into and deletes from `leads`, `drafts` and `articles`. Nothing anywhere in the suite checks which database it is pointed at:

```
$ grep -rn "DATABASE_URL" --include="*.test.ts" --include="*.test.mjs" src scripts
src/lib/news/search-index.test.ts:35: * The unit suite runs against PGLite when DATABASE_URL is unset, ...   (a comment)
scripts/with-app-env.test.mjs:56:  assert.deepEqual(parseAppEnv('{"DATABASE_URL":"postgres://x", ...   (unrelated)
```

The repo's own `.env` in this checkout points at `postgres://postgres@127.0.0.1:5433/townreporter_dev`.

**Why this matters**

`npm test` is the most-run command in any repository, and it is the one command a developer runs without thinking about their environment. `leaveAsEditor` on a live newsroom removes the owner's membership row — the operator is locked out of their own desk until someone re-inserts it. For a product whose entire premise is that one person runs one newspaper on one box, "the test suite can delete the owner" is a bad failure to leave unguarded, even at low probability.

This is also a foot-gun for the documented CI pattern: the `search-index` job deliberately sets `DATABASE_URL` and runs one test file. The day someone changes that step to `npm test` for convenience, the full destructive suite runs against the CI Postgres — harmless there, and it establishes the habit.

**Blast radius**
- Adjacent code: every test importing `getSql()` / `getPglite()` — `membership.test.ts`, `delete.test.ts`, `search-index.test.ts`, `evidence.public.test.ts`, `jobs.test.ts`, `investigate.*.test.ts`.
- Shared state: the operator's live database.
- User-facing: potential lockout or data loss on a live newsroom; recoverable by hand, but not by a user.
- Migration: none.
- Tests to update: one shared helper, imported by the DB-backed tests.
- Related findings: TEST-005 (same tests, schema-drift hazard).

**Fix path**

A ~10-line shared guard the DB-backed tests import, refusing to run against a database whose name does not look like a test database:

```ts
// src/lib/test-db.ts
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;                                   // PGLite — always fine
  if (process.env.TOWNREPORTER_ALLOW_TEST_DB_WRITES === "1") return;
  const name = new URL(url).pathname.slice(1);
  if (!/(_test|_ci|_e2e|_audit)/.test(name)) {
    throw new Error(
      `refusing to run destructive tests against "${name}" — ` +
      `point DATABASE_URL at a *_test database, or set ` +
      `TOWNREPORTER_ALLOW_TEST_DB_WRITES=1 if you meant it`,
    );
  }
}
```

Call it in a `before()` in each DB-backed test. Set `TOWNREPORTER_ALLOW_TEST_DB_WRITES=1` in the `search-index` CI job, or rename the CI database to `townreporter_ci` (it already is). Worth pairing with a line in `docs/manual.md`'s Tests section: *the suite uses an in-memory database unless `DATABASE_URL` is set; never point it at your newsroom.*

---

### [TEST-007] — Major — CI — Three guard scripts exist, are unit-tested, and never run

**Evidence**

Scripts present in `scripts/`, referenced by npm scripts or by their own tests, and absent from `.github/workflows/ci.yml`:

| Script | Status |
|---|---|
| `check-auth-invariant.mjs` | `npm run check:auth` exists; has a 130-line unit test (`check-auth-invariant.test.mjs`) | **never runs in CI** |
| `browser-smoke.mjs` | executable; its docstring says it runs the auth-invariant comparison "on every smoke" | **never runs in CI** |
| `site-walkthrough.mjs` | 9.9 KB browser walk | **never runs in CI** |
| `audit-038.mjs`, `sweep-claims.mjs`, `preview-thumbnail.mjs` | one-off / operator tools | not expected in CI |

Confirmed by grep of `ci.yml`. What CI actually invokes: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`, `npm start`, `node scripts/migrate.mjs`, `node scripts/lifecycle-e2e.mjs`, `node scripts/desk-flows-e2e.mjs` (see TEST-001), `node scripts/smoke-built-server.mjs`, `node scripts/search-index-proof.mjs`.

`check-auth-invariant.mjs`'s own docstring states what it protects: a dev server started outside npm (`npx vite dev`) resolves `VITE_AUTH_ENABLED` differently from the next build, producing *"sign-in visible in the live preview and absent from the built output, or the reverse."*

**Why this matters**

A guard that never runs is a guard that has been written, tested, documented, and then not deployed — the same shape as TEST-001, and the same shape as the meta-test that passes because a filename appears in a YAML file. The auth-invariant check specifically covers a divergence between the dev path and the built path, which is precisely the class of defect the `smoke-built` / `smoke-dev` job pair was created to catch. It is the third instrument for that failure mode and the only one not wired in.

`site-walkthrough.mjs` overlaps `desk-flows-e2e.mjs`; if it is superseded, deleting it is better than leaving 9.9 KB of executable that reads like coverage.

**Blast radius**
- Adjacent code: `.github/workflows/ci.yml`; `scripts/browser-smoke.mjs` (the intended host for the invariant check); `package.json`'s `check:auth` script.
- Shared state: `VITE_AUTH_ENABLED` resolution across `scripts/with-app-env.mjs`, `.grok/app-env.json` and `.env`.
- User-facing: a divergence shows up as sign-in present in one environment and absent in the other.
- Migration: none.
- Tests to update: none.
- Related findings: TEST-001 (a job wired in but unable to run), TEST-004 (guards asserted by presence rather than effect).

**Fix path**

Add `npm run check:auth` as a step in the existing `smoke-dev` job, after the dev server is confirmed up — it needs a live dev server and `smoke-dev` already has one, so the marginal cost is a few seconds:

```yaml
          node scripts/smoke-built-server.mjs
          DEV_URL=http://127.0.0.1:8080 npm run check:auth
```

(Confirm the environment variable name against `check-auth-invariant.mjs`'s `DEFAULT_DEV_URL` handling.) Then decide `site-walkthrough.mjs`'s fate: wire it in behind its own server like the TEST-001 fix, or delete it and say in the commit that `desk-flows-e2e.mjs` replaces it.

---

### [TEST-008] — Minor — Quality — The unauthenticated-desk smoke check passes on unrecognised page text

**Evidence**

`scripts/smoke-built-server.mjs:104-112`:

```js
const deskText = await page.locator("body").innerText();
if (/Create the desk|Sign in|password/i.test(deskText)) {
  ok("/desk sends an unauthenticated visitor to sign-in");
} else if (/Command center|The desk/i.test(deskText)) {
  bad("/desk rendered the desk to an unauthenticated visitor");
} else {
  ok("/desk did not render the desk");                    // ← passes on anything else
}
```

The failure branch is keyed to two copy strings. Any desk render whose copy no longer contains "Command center" or "The desk" — a heading rewrite, a localization, an empty-state variant — falls through to the third branch and is reported as a pass.

**Why this matters**

This is the only assertion in CI that an unauthenticated visitor cannot see the desk, and its default verdict is *ok*. A test whose unknown case is "pass" inverts the safe default: for a security assertion, unknown should be *fail*. The bug class is narrow (it requires a copy change to coincide with an auth regression) which is why this is Minor rather than Major — but the fix is three lines and it removes a soft spot from the one place that check lives.

**Fix path**

Invert the default and assert on something that does not depend on copy: the presence of desk-only navigation. A desk render always contains the Queue link that the e2e walks already rely on (`getByRole("link", { name: "Queue", exact: true })`):

```js
const deskNav = await page.getByRole("link", { name: "Queue", exact: true }).count();
if (deskNav > 0) bad("/desk rendered desk navigation to an unauthenticated visitor");
else if (/Create the desk|Sign in|password/i.test(deskText)) ok("/desk sends an unauthenticated visitor to sign-in");
else bad(`/desk showed neither the sign-in page nor a recognisable state: ${deskText.slice(0, 200)}`);
```

---

### [TEST-009] — Minor — Regression — Two documented claims about the test suite are stale, one of them describing a defect that was fixed

**Evidence**

`docs/manual.md:444`:

> 528 tests, and the default run is deterministic, offline and free.

Measured on this machine: `ℹ tests 534 / ℹ pass 531 / ℹ fail 0 / ℹ skipped 3 / duration_ms 16697`. The "deterministic, offline and free" half is accurate and verified; the count is six low.

`SELF-HOSTING.md:177`:

> `npm test` makes one real Claude call (~28s). To skip it:
> ```bash
> TOWNREPORTER_CLAUDE_CODE=0 npm test
> ```

This is no longer true, and it describes the exact defect a prior audit filed as TE-01. The fix landed — `src/lib/news/scan-pass.test.ts:123` gates the live call behind `RUN_LIVE_MODEL_TESTS=1`, and `newsroom-security.test.mjs` enforces that gating for the whole directory. I ran `npm test` with no special environment and confirmed no model call and no network traffic. `SELF-HOSTING.md` still tells a self-hoster the default suite costs them money.

**Why this matters**

From a test-engineering angle rather than a docs one: a prior audit's finding was fixed in the code and in the guard, but the fix was not propagated to every surface that asserted the old behaviour — and no test guards those surfaces. The suite already contains a working pattern for exactly this (`src/lib/version.ts` is pinned to `package.json` by `paper.test.ts`; `.env.example` is pinned to the code by `newsroom-security.test.mjs`). Neither doc claim is pinned to anything. A hardcoded number in a document is a claim with no owner, and the previous audit was burned by precisely a non-reproducible test-count claim.

**Fix path**

Fix both texts. Then either drop the exact count from `docs/manual.md` in favour of a qualitative statement ("the suite is deterministic, offline and free, and runs in about twenty seconds"), or pin it: a test that runs the suite is circular, so prefer removing the number. For `SELF-HOSTING.md`, replace the paragraph with the truth and the opt-in:

> `npm test` is deterministic, offline and free — it never calls a model. To run the live model evaluation as well:
> ```bash
> RUN_LIVE_MODEL_TESTS=1 npm run test:live-model
> ```

Consider extending the `.env.example` guard's approach: a test that greps `README.md`, `SELF-HOSTING.md` and `docs/*.md` for the string `npm test` and fails if any nearby line claims a model call. Cheap, and it is the same guard shape the team already uses well.

---

### [TEST-010] — Minor — Coverage — No coverage tooling is configured

**Evidence**

No `c8`, `nyc`, or `--experimental-test-coverage` in `package.json` or `.github/workflows/ci.yml`. No coverage thresholds, no report artifact.

**Why this matters**

Weakly. Line coverage would have told the team less than the module-import census in TEST-003 did — the untested modules are untested at the *import* level, which a coverage report would show as a wall of zeros without explaining why (they cannot load under bare `node --test` because of `@tanstack/react-start`). So the absence of a number is not the problem here.

What is worth having is the *trend*: `node --test --experimental-test-coverage` is built in, costs one flag, and would make it visible when a newly-added module joins the untested set. Recommend it as a reported artifact, not as a gate with a threshold — a coverage threshold on this codebase would mostly incentivize tests of the already-tested pure layer.

**Fix path**

Add a non-blocking CI step: `node --test --experimental-test-coverage ...` with the summary printed. Do not set a threshold. Revisit once TEST-003's items are covered.

---

### [TEST-011] — Nit — Quality — A test file asserts the contents of its own source

**Evidence**

`scripts/ssrf-check.test.mjs:9-11`:

```js
const here = readFileSync(fileURLToPath(import.meta.url), "utf8");
assert.doesNotMatch(here, /function isBlockedAddress\(/);
```

The intent is sound and worth keeping — it stops someone re-implementing the SSRF guard inside the test and then testing the copy, which is a real failure mode. It is listed here only because a file asserting things about itself is surprising to read, and the surprise costs a reviewer a minute. A one-line comment at the top saying *"this file guards the SSRF tests, not the SSRF code"* would pay for itself.

---

## Shortcut census

Across all 58 test files:

| Shortcut pattern | Count |
|---|---|
| `.skip` / `xit` / `@skip` | 4 conditional, 0 unconditional — 2× Windows symlink permission (`check-auth-invariant.test.mjs:34`, `with-app-env.test.mjs:33`), 1× PowerShell-only (`ops-scripts.test.mjs:122`), 1× `pg_trgm` absent (`search-index.test.ts`). All announce their reason in the skip message. |
| `.only` (left in) | 0 |
| `TODO: add test` / `FIXME` / similar | 0 |
| Empty assertion / placeholder / empty test body | 0 |
| `assert.ok(true)` / vacuous assertion | 0 |
| `--retry` / `retries` normalized | **no** — none in `package.json`, none in `ci.yml`, none in the Playwright scripts |
| `continue-on-error` in CI | 0 |
| Source-text (`readFileSync` + `assert.match`) assertions | ~25 tests, concentrated in `newsroom-security.test.mjs` (18), `membership.test.ts` (3), `ssrf-check.test.mjs` (1) — see TEST-004 |
| Empty `catch {}` that can hide a failure | 2 — `delete.test.ts:33` (migration apply, see TEST-005), `db.ts:157` (glob absence, by design) |

Observed run: **534 tests, 174 suites, 531 pass, 0 fail, 3 skipped, 0 todo, 16.7 s.** Reproduced identically three times, including twice with mutations applied elsewhere in the tree.

By the usual standards this census is clean — genuinely so. There is no `.only` rot, no skip graveyard, no retry culture, no placeholder assertions. The shortcuts in this codebase are not the classic ones; they are the substitution of source-text assertions for behavioural ones (TEST-004), and coverage that stops at the boundary of anything that needs a request context (TEST-003).

## Blind spots by class

Classes of bug the existing suite would allow through, ordered by how likely they are to actually happen here:

1. **Authorization regression on a server function** — verified by mutation. Removing the middleware from `getOpsHealth` passed typecheck and 534/534. Any server function whose handler does not consume `context` is mutable in this way without either gate noticing. (TEST-002)
2. **Anything on the auth boundary itself** — missing/expired/forged bearer token, a member of a different newsroom, a scripted cross-site request from a sibling origin, a top-level GET with `sec-fetch-dest: embed`. `assertSameSiteRequest` has five branches and zero tests. (TEST-003)
3. **A behaviour change that preserves the source text** — a guard made unreachable by reordering, a check moved into a branch never taken, a second code path that skips it. All 25 source-text assertions are blind to this by construction. Conversely, a *formatting* change can silently satisfy a `doesNotMatch` guard. (TEST-004)
4. **Schema divergence between `migrations/*.sql` and the inline `ensure*` DDL** — invisible to the whole unit suite, and it bites only self-hosters. (TEST-005)
5. **Concurrency** — nothing tests two editors acting on one record. Migration 0017 is named `one_open_job`, implying a concurrency invariant the suite never races. No test opens two connections. No test exercises the `withTransaction` rollback path under contention.
6. **Regressions in any of the 0.5.1 desk flows** — currently uncovered in practice, because the walk that covers them cannot run in CI. (TEST-001)
7. **Empty and partial states** — no test renders a desk with zero leads, an archive with zero published stories, a trash with nothing in it, or an article whose body is empty. `src/components/states.tsx` exists and is untested; `desk-flows-e2e.mjs` always walks a desk it has just populated.
8. **The machine-consumed surfaces** — `/feed`, `/sitemap.xml`, `robots.txt` are asserted for HTTP status only (`smoke-built-server.mjs` `ROUTES`). Nothing validates the RSS or sitemap *shape*, where malformation is invisible to a human reviewer and breaks silently for aggregators.
9. **Client-side rendering beyond four pages** — the browser layer covers `/`, `/login`, `/desk`, `/desk/opinion`, `/desk/queue`, `/desk/ops`, `/desk/dark`. Not covered in a browser: `/about`, `/how-we-report`, `/corrections`, `/get-the-code`, `/desk/scan`, `/desk/sources`, `/desk/memory`, `/desk/published`, `/evidence/*`. (`smoke-built-server.mjs` fetches some of these for status, which is explicitly not the same thing — the script's own docstring makes that argument.)
10. **The model-facing paths under real conditions** — deliberately and correctly out of the default suite, but that means malformed model output, timeouts and partial responses are covered only by whatever `coerce-draft.ts` and `claim-hygiene.ts` are handed as fixtures. The fixture set is small and hand-written.

## Patterns and systemic observations

**Pattern A — the pure half is split out and tested; the half that touches the world is not.** This is the defining shape of the suite, and it is visible as a deliberate, repeated engineering decision:

| Tested (pure) | Untested (effectful) |
|---|---|
| `src/lib/ops/health.ts` (164-line test) | `src/lib/ops/health.server.ts` (418 lines) |
| `src/lib/ops/actions.ts` (allowlist) | `src/lib/ops/actions.server.ts` (131 lines — runs them) |
| `src/lib/news/trash-store.ts` | `src/lib/news/trash.ts` (the server functions) |
| `src/lib/auth/gate-identity.test.ts` (326 lines) | the rest of `src/lib/auth/` (~1,300 lines) |
| `src/lib/news/editorial.ts` (parser) | `src/lib/news/editorial.server.ts` (288 lines) |

The split is genuinely good engineering — `trash-store.ts:6-9` explains it, and it is *why* the pure layer is so well covered. But the team stopped at the split. The effectful half was never picked back up, and the source-text assertions in `newsroom-security.test.mjs` are the scar tissue where someone noticed and reached for the only tool that worked without a request context. TEST-002, TEST-003 and TEST-004 are all this one root. The highest-leverage fix in this audit is a **test harness that can construct a server-function request context against PGLite** — one afternoon of work that unlocks behavioural tests for all ~6,500 untested lines and lets the regex file shrink to the handful of assertions that genuinely have no runtime surface.

**Pattern B — guards are asserted by presence, not by function.** `newsroom-security.test.mjs` asserts `ci.yml` *contains* `desk-flows-e2e.mjs` (TEST-001: it does, and the job cannot pass). It asserts `desk-auth.ts` *contains* `assertSameSiteRequest` (TEST-003: it does, and the function is untested). It asserts migration 0012 *contains* `unique index` (TEST-004: it does, and the test would survive the index being dropped in 0019). Three separate findings, one habit. The habit is understandable — presence assertions are cheap and they do catch deletion — but they systematically cannot catch *breakage*, which is the more common failure. Worth a written team rule (proposed in TEST-004's fix path).

**Pattern C — the team fixes findings with structural guards, and that culture is real.** This deserves saying plainly because it is rarer than the problems above. The prior audit's TE-01 (paid model call in the default suite) was fixed with a directory-walking enforcement test, not a one-line edit. TE-02 (a test file that existed but was never listed) was fixed by switching to a glob *and* adding a test that fails if anyone hardcodes a filename again. TE-05 (CI never built or opened a browser) was fixed with two jobs, and the reasoning for running both dev and built modes was verified by deliberately reintroducing the defect and recording which mode caught it. The `.env.example` completeness test walks `src/` for `process.env.X`. That is exactly the right instinct, applied consistently. TEST-001 is a lapse in that pattern's *execution*, not evidence of its absence — the walk was written, it works, and it was wired into the wrong job.

**Pattern D — the comments are unusually load-bearing, and mostly earned.** Test files here explain why a previous version was wrong (`search-index.test.ts` on three failed `EXPLAIN` attempts), why a test was deleted rather than weakened (`membership.test.ts:23-31`), and why an empty catch is acceptable (`delete.test.ts:30-35`). This is a real asset — it is how I was able to audit intent rather than guess at it, and it made several of the *credit* items above verifiable. The risk it carries is that a confident comment reads as a verified fact: the `membership.test.ts` comment says *"the one guarantee that must survive: two people cannot both own it"* directly above a test that does not check it. The prose is right about what matters; the assertion below it isn't the check the prose describes.

---

## Appendix: test artifacts reviewed

**Read in full**
- `package.json`, `.github/workflows/ci.yml`, `.env.example`
- `scripts/newsroom-security.test.mjs`, `scripts/ssrf-check.test.mjs`
- `scripts/lifecycle-e2e.mjs`, `scripts/desk-flows-e2e.mjs`, `scripts/smoke-built-server.mjs`
- `scripts/with-app-env.mjs`, `scripts/check-auth-invariant.mjs` (docstring + entry)
- `src/lib/db.ts`, `src/lib/auth/isolation.server.ts`, `src/lib/news/desk-auth.ts`
- `src/lib/news/membership.test.ts`, `src/lib/news/delete.test.ts` (harness + first block)
- `src/lib/news/trash-store.ts` (header), `src/lib/news/search-index.test.ts` (header + skip logic)
- `migrations/0016_trash.sql`

**Inspected / grepped**
- All 58 test files for skip / only / todo / placeholder / network / timing patterns
- Import census across all test files vs. the module tree
- `createServerFn` + `.middleware([` census across `src/`
- `create table` / `alter table` census across `src/` vs. `migrations/`
- `README.md`, `CHANGELOG.md`, `docs/manual.md`, `docs/setup.md`, `SELF-HOSTING.md`, `AGENTS.md` for test claims

**Commands run**
- `npm test` — 4× (baseline + 2 mutants + confirmation). Baseline: 534 tests, 531 pass, 0 fail, 3 skipped, 16.7 s.
- `node --test --test-reporter=tap "scripts/**/*.test.mjs"` and the `src` equivalent — to identify each skip and its stated reason
- `npm run typecheck` — 3× (baseline clean + 2 mutants)
- `node scripts/migrate.mjs` against a scratch database — 18 migrations applied
- `node scripts/lifecycle-e2e.mjs` — pass, against my own dev instance
- `node scripts/desk-flows-e2e.mjs` — **fail** on a claimed desk (CI order reproduced), **pass 17/17** on a clean desk
- `psql` schema inspection of `newsroom_members` and a two-owner insert attempt (rejected by `newsroom_members_one_owner`)

**Mutations performed and reverted**
1. `src/lib/news/trash.ts:160` — `.middleware([deskMiddleware])` removed from `purgeTrashItem`. Tests pass; typecheck fails.
2. `src/lib/ops/dashboard.ts:21` — `.middleware([deskMiddleware])` removed from `getOpsHealth`. Tests pass; typecheck passes.

Both reverted from backup. `git diff` is empty and `git diff --stat` reports no changes.

**Scratch resources created and destroyed**
- Database `townreporter_audit_test` on `127.0.0.1:5433` — created, migrated, used, **dropped**. Confirmed absent from `psql -l`.
- A Vite dev server on port 8123 with its own `DATABASE_URL` / `BETTER_AUTH_URL` overrides (the repo's `.env` was read but never modified) — **stopped**.
- `townreporter_dev`, `townreporter_e2e`, `townreporter_audit_ux`, `townreporter_audit_qa` were not touched. The instance on port 3200 was not used; 3300 and 3400 were not contacted. `townreporter-web` was not read and `townreporter.org` was not visited.

**Working tree state:** unchanged. `git status --porcelain` reports only `?? artifacts/audit-townreporter-2026-08-29/`, the audit's own output directory.
