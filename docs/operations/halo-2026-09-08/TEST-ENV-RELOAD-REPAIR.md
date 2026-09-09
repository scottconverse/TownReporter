# Ordinary-test environment reload repair — 2026-09-08

DEV source only; completed 17:34:30 MDT. No application database imported, queried or cleaned by this repair task. No full suite, model invocation, Vite application server or deployment was run.

## Reproduced cause

`scripts/test-environment.mjs` deleted `DATABASE_URL`, `VERCEL`, `VERCEL_ENV` and `RUN_LIVE_MODEL_TESTS`. The startup guard checked the environment once. Later, the installed TanStack plugin at `node_modules/@tanstack/start-plugin-core/src/vite/load-env-plugin/plugin.ts:9` performs:

```js
Object.assign(process.env, loadEnv(config.mode, config.root, ''))
```

That all-prefix Vite load restored values from the checkout's `.env` because the runner had removed, not overridden, them. `src/lib/db.ts:19–28` selects PostgreSQL when `DATABASE_URL` is nonempty. The earlier startup check therefore did not protect a later Vite-transformed database import.

The parent reported ordinary fixtures in the development/staging database and none in production. This worker did not independently query either database; cleanup and affected-run disposition belong to the parent incident record.

## Minimal fix

- `scripts/test-environment.mjs`: use explicit empty-string overrides for the four variables. Vite's existing-process-value precedence preserves those over `.env`.
- `scripts/test-environment-guard.mjs`: retain rejection of a real database/live-model opt-in at startup, then normalize the same four fields to empty strings. This protects even a caller that omits the fields while presenting the verified marker.
- `scripts/test-environment-safety.test.mjs`: subprocess regression invokes the **actual installed TanStack env-loading hook** against a disposable `.env` containing a fake PostgreSQL URL and live-provider/hosted-runtime sentinels. Socket connections are forbidden before importing the loader; no database module is imported. Tests cover both explicit blanks and omitted variables normalized by the guard.

No application Vite configuration override is needed: the regression exercises its real env-loading mechanism and proves the empty overrides survive it. Deliberate per-test scratch PostgreSQL opt-ins after startup remain possible; tests are not permitted to silently point those at operator databases.

## Commands and raw evidence

Commands, in order:

```powershell
node --test scripts/test-environment-safety.test.mjs *> artifacts/test-env-baseline-20260908.log; exit $LASTEXITCODE
node --test scripts/test-environment-safety.test.mjs *> artifacts/test-env-red-20260908.log; exit $LASTEXITCODE
node --test scripts/test-environment-safety.test.mjs *> artifacts/test-env-green-20260908.log; exit $LASTEXITCODE
node --test scripts/test-environment-safety.test.mjs *> artifacts/test-env-final-20260908.log; exit $LASTEXITCODE
```

Baseline exit 0:
```text
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 190.4219
```

RED exit 1:
```text
ℹ tests 4
ℹ suites 0
ℹ pass 1
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 354.5139
```

Failures: expected empty overrides but received undefined; runner source check still showed deletion; real TanStack loader subprocess asserted `DATABASE_URL revived from .env`, actual `postgres://sentinel.invalid/never-dial`, expected empty. Complete assertion errors and stacks remain in the raw RED log; no connection to that sentinel or another database occurred.

Final GREEN exit 0, including omitted-variable defense:
```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 577.8421
```

`git diff --check -- scripts/test-environment.mjs scripts/test-environment-guard.mjs scripts/test-environment-safety.test.mjs` exited 0. Only warnings: `LF will be replaced by CRLF the next time Git touches it`, naming each of those three files.

## Remaining boundary

This proves the environment loader cannot revive these four settings through the tested ordinary-suite entry path. It does not retroactively validate prior DB tests, remove fixtures, or prove every integration test avoids deliberate later environment mutation. The affected ordinary Vite fixtures require a fresh isolated run after this fix, under the parent's direction. Production configuration is unchanged.

## Subsequent authorized isolated application proof

After the sentinel was green, the parent explicitly authorized one routine-check rerun and before/after read-only staging counts. The earlier no-database-queries boundary describes the sentinel phase, not this subsequent step.

Added `assert.equal(db.getDbSource(), "pglite", ...)` immediately after the Vite database module load in `src/lib/news/routine-notice-checks.test.ts`, before test `getSql` or fixture queries. The central blank overrides also protect the earlier Vite bootstrap hook; this extra assertion makes the intended backend visible in the fixture suite.

Exact isolated run, exit 0:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/routine-notice-checks.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'}); process.exit(r.status ?? 1);" *> artifacts/test-env-routine-isolated-20260908.log; exit $LASTEXITCODE
```
```text
ℹ tests 14
ℹ suites 1
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 20506.8265
```

No warnings/errors appeared in this raw log. SHA-256: `A0A13A4C62A8238EA8426C1340CD2149D004FD1DD4E5A808550227C95F96EAB3`.

Staging read-only command below ran once before and once after, changing only `before` to `after` in the output filename. It validates the database pathname before connecting, begins a read-only transaction, queries only the count and rolls back. It does not print credentials:
```powershell
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; import pg from 'pg'; const env=parseEnv(readFileSync('.env','utf8')); const u=new URL(env.DATABASE_URL); if(u.pathname!='/townreporter_dev') throw Error('Not the authorized staging database'); const c=new pg.Client({connectionString:u.href}); await c.connect(); await c.query('BEGIN READ ONLY'); console.log(JSON.stringify((await c.query('select current_database() as database, count(*)::int as fixture_rooms from newsrooms where id between 98001 and 98015')).rows[0])); await c.query('ROLLBACK'); await c.end();" *> artifacts/test-env-staging-before-20260908.log; exit $LASTEXITCODE
```
Both reads exited 0 and returned exactly:
```json
{"database":"townreporter_dev","fixture_rooms":15}
```
Both raw count logs SHA-256: `047EF71B85E963DACE2996939329A644FAE5DB9881A45EC57C9C46C305506D0E`.
No cleanup was performed. The sentinel final raw log SHA-256 is `7C2A5518B6F4BFB0AB7CD4744626341A53CDA30A0A5A0E6B4D7E32097F7E298A`.
