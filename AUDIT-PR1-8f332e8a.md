# AUDIT of PR1, the promote.ps1 fix (branch claude/pr1-promote-log, commit 8f332e8a)

Auditor: HALO (Claude, on Scott's Windows machine, the machine that runs this script). Written 2026-10-01, about 3:36 PM Mountain.
Diff base: fba5a4a3. Seven files: `ops/lib-promote.ps1` (new, 530 lines), `ops/promote.ps1` (rewritten, 860 lines), `scripts/promote-step-runner.test.mjs` (new), `scripts/ops-scripts.test.mjs`, `.github/workflows/ci.yml`, `.gitignore`, `SELF-HOSTING.md`.

## VERDICT: CLEAR WITH WATCHLIST to merge. NOT proof that a real promote works.

The logic reads as correct and careful, and its tests pass on the real machine type (Windows PowerShell 5.1, Node 25.9). But nobody has run a real promote with it. The first real run is the real test. One watchlist item (W1) affects THIS rollout and needs a decision before I run it.

## Findings, most serious first

**P1 [MAJOR for this rollout] The fallback puts the OLD build back on a database the migrations already changed. Migration 0112 makes that unsafe.**
- `npm run build` runs the migrations (`... && npm run db:migrate`). PR1 keeps `.output-previous` and restores it if the build or the start fails. But if the migrations ran and THEN the app failed to start, the old build starts on the new schema.
- 0112 drops `xai_oauth_connections`. The live build (batch 4) reads it with no error handling in `provider-availability.server.ts:16`, which feeds the model picker. So after a fallback, every screen with a model picker would fail to load its availability. The log line "the paper is back on the OLD version" would be true, and writing would still be broken.
- Fix options (also in AUDIT-f7479574.md as W1): move the `drop table` to a later migration, after the rollout; or make the old check tolerate the missing table (not possible, the old build is already live). Recommended: move the drop.
- How I checked: read the old code at 32ef34ea; rehearsed the migrations on a copy of the real data (the table is gone afterward). I did NOT start the old build on that copy.
- Not a defect in the PR1 code. It is a limit of the fallback idea that this rollout runs into. Please also check 0115-0117 for the same: any drop, rename, or type change that the batch 4 build still uses.

**P2 [MINOR, but on the most important line] No test pins "a child that never writes PROMOTE_EXIT is a FAILURE".**
- Mutation I made in my own copy: in `Invoke-PromoteChild`, start `$code = 0` instead of `$null` (so a killed `npm ci` that wrote no exit line counts as success). Result: all 6 tests still pass (exit 0).
- Failing case in practice: if a future edit makes that change, a killed `npm ci` becomes "ok", and the promote goes on to build on a half-installed `node_modules`. The code as written is correct (`Completed = ($null -ne $code)`); the tests would not notice a regression.
- Fix: one test with a child that is killed before it writes the exit line, expecting `ExitCode = $null`, `Completed = $false`, and a failed step.
- Two other mutations WERE caught: a fallback that never starts the old app (1 test failed), and a fallback with no previous build kept (1 test failed).

**P3 [MINOR] A child has no time limit.** `Invoke-PromoteChild` waits with `WaitForExit()` and no timeout. A hung `npm ci` or `npm run build` keeps the paper down. The comment says the watchdog stands down for a marker under 30 minutes old; after that it may start the app while `node_modules` or `.output` is half-written (the exact v0.5.4 incident the script names). Suggest a limit (for example 25 minutes) that fails the step and runs the fallback.

**P4 [MINOR, untested edge] `Restore-PromotePreviousBuild`** does `Remove-Item .output` with errors silenced, then `Move-Item .output-previous .output`. If the remove leaves anything behind (a locked file), PowerShell moves the folder INSIDE the existing `.output`, and the next check (`.output\server\index.mjs` exists) could pass on the leftovers of the failed new build. Needs a locked file to happen. Fix: check that `.output` is gone before the move, else fail the restore.

**P5 [INFO] Concurrency.** Two promotes at once are only stopped by the marker; a second run with `-Resume` would go on. Rare; note only.

## What I ran, and what came out

| Check | Result |
|---|---|
| `scripts/promote-step-runner.test.mjs` in my own worktree on Node 25.9 + Windows PowerShell 5.1 | 6 tests, 6 pass, 0 skipped (so they really ran on Windows). Fakes only; no service, no port, no database. |
| `scripts/ops-scripts.test.mjs` | 61 tests, 61 pass |
| Mutation A (null exit counts as success) | NOT caught: 6 of 6 still pass (P2) |
| Mutation B (fallback never starts the old app) | caught: 5 pass, 1 fail |
| Mutation C (previous build not kept) | caught: 5 pass, 1 fail |
| Code read | All code lines of both PowerShell files, comments partly. Step order, resume, fallback, verify, the marker. |
| My test of the worry "the inline start step could die from a closed pipe" | Not confirmed. A stand-in start script (Write-Host lines, then a marker file), run inline with the launcher's stdout pipe destroyed at 2 s, finished and wrote its marker, same as the detached version. I did not run the real `start-townreporter.ps1` (that would start the app on port 3000). Blind spot: the stand-in is PowerShell only; the real script starts node with `Start-Process`. |
| What the old promote did for the start step | Same inline `& powershell -File start-townreporter.ps1` (32ef34ea, line 341). So not a new risk. |

## What I did NOT cover

- A real promote, on any machine. A real `npm ci` and `npm run build` through the new runner. PowerShell 7. The Windows CI step (it runs only in CI). The `-WhatIf` and `-WaitForJobs` paths. `Get-OpenDeskJobs` (unchanged code, uses port 5433).
- The dry run on the dev copy. It needs: PR1 merged to main first (the dev copy fast-forwards to origin/main), Scott's OK, and a quiet time. Be aware: the dev copy's real promote takes a `pg_dump` of its database on the shared Postgres (5433) and runs the build and migrations there. It does not touch the live database, but it uses the same server as the live paper.

## What I need from the coder

1. P1: decide how 0112 is handled; check 0115-0117 for the same trap.
2. P2: add the killed-child test. P3 and P4: your call, but P3 is cheap.
3. Tell me the merged commit. I re-check that commit, then plan the dry run.
