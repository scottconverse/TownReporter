# RE-CHECK of PR1 follow-up, commit 0ad76e89 (branch claude/pr1-promote-log)

Auditor: HALO. Written 2026-10-01, about 4:15 PM Mountain. Re-check of my earlier report `AUDIT-PR1-8f332e8a.md` (findings P1-P5).

## VERDICT: P2 and P3 CLOSED. PR1 is CLEAR WITH WATCHLIST to merge. The rollout still waits on P1 (migration 0112), which is Scott's decision.

| Finding | Status at 0ad76e89 | How I checked |
|---|---|---|
| P2: no test for "a killed child is a failure" | CLOSED | My same mutation (`$code = $null` -> `$code = 0`) now fails 2 tests (10 pass, 2 fail). Before: 0 failed. |
| P3: no time limit on a child | CLOSED | `Get-PromoteChildTimeoutSeconds`: deps 1200 s, build 1200 s, others none. Kill by PID with `taskkill /PID <pid> /T /F` through cmd with output to nul, never by image name. Mutation: build limit set to 0 (unlimited) fails 1 test. Mutation: the kill line removed fails 1 test. I did NOT watch a real 20-minute timeout; the test uses a short limit. |
| P1: fallback after migrations (0112) | STILL OPEN, partly softened | The log and console now say "the database was already migrated to <name>; if this build reads a table or column a migration removed, tell the developer before continuing". That tells the operator; it does not make the old build work. The real fix is the 0112 change, waiting for Scott. |
| P4: Move-Item onto an existing folder in the restore | NOT addressed, still MINOR | Not part of this commit. |
| P5: concurrency | INFO, unchanged | |

## What I ran

- `scripts/promote-step-runner.test.mjs`: 12 tests, 12 pass, 0 skipped, on Node v25.9.0 and Windows PowerShell 5.1.
- `scripts/ops-scripts.test.mjs`: 61 tests, 61 pass. (Your message said 59 ops tests; I ran this one file and got 61. Probably a different count of files, not a contradiction I can resolve from here.)
- Mutations, each in my own worktree, each restored (git diff clean afterward): A (null exit is success) caught; E (no build limit) caught; G (timeout does not kill) caught.
- Read the diff: `ops/lib-promote.ps1`, `ops/promote.ps1`.

## Smaller notes (no action needed)

- `Get-PromoteAppliedMigrationName` falls back to the newest `.sql` in `migrations\` when the build output names none. That is right when the migrations finished, and the sentence says "migrated to <name>". If the migrations stopped part way, the code uses the generic "migrations may have run" sentence. I read that path; I did not run it.
- The health wait stays 60 s. Fine: it only decides when to fall back, and a slow Postgres start was seen to take longer than 60 s once (226 s in an old incident). If the live Postgres is in crash recovery, the start step could fall back to the old build too early. Watchlist only.

## NOT covered

A real promote on any machine; a real 20-minute timeout; PowerShell 7; the Windows CI step. The dev-copy dry run needs PR1 merged to main and Scott's OK.
