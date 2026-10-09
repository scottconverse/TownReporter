# Nightly proof: scan and draft on the Test server

The nightly proof uses the existing full Test server at
`http://127.0.0.1:3400`. It does not start a server or restage a checkout.
The Test server must already be running and connected to the newest stamped
Test database before the coordinator enables the nightly task.

## What it does

1. Finds the newest `townreporter_test_<stamp>` database on
   `127.0.0.1:5547` with one SELECT from `pg_database`, ordered by the
   `YYYYMMDD_HHMMSS` stamp in its name. Discovery uses `psql -w` as
   `tr_test_admin`, so it never asks for a password.
2. Signs in as `test-owner@townreporter.test`. The owner already exists;
   `scripts/stage-editor.mjs` is skipped. The editor password comes from
   the private file at run time, and is never put in the task definition.
3. Opens Sources & scan and clicks the button **Run scan now**. This proves
   the saved daily policy: 8 fixed + 4 rotating sources within a cap of 12.
   It waits up to ten minutes for that new `scan_runs` receipt and its scan job
   to finish. The general scan is a separate control and is not clicked.
4. Opens the newest draftable lead and presses the primary Draft with AI
   or Redraft button in the story action bar, only after the scan completes.
   A queued job gets two minutes to start; otherwise the proof reports
   `draft never started` with its queue stage or running blocker. The eight-minute
   draft budget starts at persisted `started_at`, not the click.
5. Stops after drafting. It never publishes.
6. Writes `artifacts/nightly/<YYYY-MM-DD>.json` and
   `artifacts/nightly/LATEST.txt` in the checkout that runs the script.

The browser asks the Test app to scan and draft. The proof's separate
Postgres connection only reads the scan, job and draft results, using the
SELECT-only `tr_test_admin` role and read-only transactions. The Test app
uses its own database connection to save the work.

On Test on October 8, the Slice 6 walker measured daily runs of **4 min 29 s**
and **2 min 59 s** (268.669 s and 179.210 s). Each attempted 12 sources,
read 8, recorded 4 blocked, and used one model batch. These are observed
durations, not guarantees. The artifact names `scan.kind` (`daily policy`),
`scan.policySize` (12), and `testDatabase`, and reports attempted/read/blocked,
leads, provider and model batches from the receipt.

## Configuration

Environment variables override these defaults for both a direct Node run
and `ops/nightly-proof.ps1 -Now`:

| Variable                      | Default                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `LIVE_PIPELINE_BASE_URL`      | `http://127.0.0.1:3400`                                                                            |
| `DATABASE_URL`                | Discovered at each run: `postgres://tr_test_admin@127.0.0.1:5547/townreporter_test_<newest stamp>` |
| `LIVE_PIPELINE_EDITOR_EMAIL`  | `test-owner@townreporter.test`                                                                     |
| `LIVE_PIPELINE_PASSWORD_FILE` | `C:\Users\scott\Desktop\Code\townreporter-test\test-owner.private`                                 |

Leave `DATABASE_URL` unset to follow the newest Test restore. An explicit
URL must still pass `assertDevDatabase` in `scripts/nightly-proof-config.mjs`:
a stamped Test database, `tr_test_admin`, no password, host `127.0.0.1`,
port `5547`, and no connection overrides in its query string. The guard
refuses the live `townreporter` database, dev databases and port `5433`.
The browser URL must stay on the loopback Test server on port `3400`.
Missing databases or an empty password file fail the run.

## The selector failure this fixes

The October 6 run at 03:30 exited 1. Scan finished in 179 seconds, but
Draft with AI matched two buttons: the story action bar and the empty
state. The proof now selects the button inside `.astra-story-actions`.
It keeps the 90-second navigation/button waits and the full scan and draft
budgets; selecting one button does not hide a timeout or provider failure.

An offline DOM test includes both buttons and proves that the locator
resolves only to the primary action. It does not launch a browser or call
a model.

## Running and scheduling

The coordinator registers the task from the merged checkout:

```powershell
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1
```

The task runs daily at 03:30 with interactive logon, using the operator's
Claude Code / Codex session. Its action runs the same `-Now` path as a
manual proof:

```powershell
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Now
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Status
```

`-Status` prints the latest artifact. `scan.ok` and `draft.ok` report each
phase, with the actual provider, elapsed seconds and result counts.
Refusals, timeouts and provider errors appear in `errors` and exit 1;
they are never reported as successful zero-result runs.

A real scheduled or manual proof makes real source requests and model
calls using the operator's accounts. Offline tests only prove the selector,
configuration guard and entry path; they do not establish a successful
live scan and draft. An interactive user session and the Test server must
be available when the task runs.

## Five-minute monitor and watchdog triggers

`ops/install-tasks.ps1` now omits `RepetitionDuration` from the shared
five-minute trigger, leaving indefinite repetition. Windows 11 build
26300 rejected `[TimeSpan]::MaxValue` during registration with error
`0x80041318` (value incorrectly formatted or out of range). Scheduler
registration is not testable in CI; the installer must be checked by the
coordinator when registering the merged code.
