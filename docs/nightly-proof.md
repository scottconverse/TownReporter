# Nightly proof: scan -> draft, with a real model

Every browser walk elsewhere in this repo (`scripts/*-e2e.mjs`) is
deliberately model-free: fake CLIs under `scripts/fakes/` stand in for
Claude Code and Codex so CI never spends money and never depends on a real
login. That is correct for CI, but it also means the actual expensive path
-- scan a real watch list with a real model, then draft a real lead with a
real model -- had never been proven to run end to end on its own, on a
schedule, without someone watching it.

This is that proof. It runs once a night, on this box, against a disposable
copy of real production data, using the operator's own Claude Code / Codex
logins.

## What it does

`scripts/live-pipeline-proof.mjs`:

1. Starts its own dev server on port 3318, with `DATABASE_URL` pointed at
   `townreporter_dev` on `127.0.0.1:5433` -- **never** the live database. The
   script refuses to run against any other database name; see
   `assertDevDatabase` at the top of the file.
2. Signs in as the staging editor, `staging@townreporter.test` /
   `staging-walk-2026` -- created by `scripts/stage-editor.mjs`, which
   `ops/nightly-proof.ps1 -Now` always runs first.
3. Runs one Scan on **Automatic**, waiting up to 6 minutes.
4. Picks the newest draftable lead (not killed, not already published) and
   runs Draft with AI on **Automatic**, waiting up to 8 minutes.
5. **Stops.** It never publishes -- publishing against the dev copy is
   harmless but proves nothing extra; the draft existing is the proof.
6. Writes `artifacts/nightly/<YYYY-MM-DD>.json` and
   `artifacts/nightly/LATEST.txt` (a one-line pointer to the day's file).

The concrete provider each phase actually ran on, and how long it took, are
not shown on either screen -- Scan and Story show the model *picker*, never
which rung Automatic landed on. Those two details are read straight out of
`desk_jobs` / `scan_runs` / `drafts` in `townreporter_dev` after each phase
completes, with a plain `pg` connection (the same approach
`scripts/stage-editor.mjs` already uses; no server-only app code is
imported).

## The artifact

```json
{
  "ranAt": "2026-09-02T09:07:41.331Z",
  "version": "0.6.1",
  "scan": {
    "ok": true,
    "provider": "Claude Opus",
    "seconds": 42.1,
    "leads": 2,
    "resurfaced": 0,
    "sourcesFetched": 31,
    "summary": "..."
  },
  "draft": {
    "ok": true,
    "provider": "Claude Opus",
    "seconds": 58.3,
    "chars": 3120,
    "leadId": 214,
    "headline": "..."
  },
  "errors": []
}
```

`scan.ok` / `draft.ok` are `false` (with a message pushed onto `errors`)
whenever a phase does not land cleanly -- a refusal, a timeout, or a real
provider error is never silently swallowed into a "done" result.

## Running it

Once, if the staging account does not exist yet on this copy of the database
(`ops/nightly-proof.ps1 -Now` always does this step first, so this is only
needed for a bare `node` invocation):

```
DATABASE_URL=postgres://postgres@127.0.0.1:5433/townreporter_dev node scripts/stage-editor.mjs
```

Then, from this checkout:

```
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1          # register/refresh the 03:30 task
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Now     # run it right now
powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Status  # print the last result
```

`-Now` is exactly what the scheduled task's own action runs, so a manual run
and the 03:30 run behave identically.

### The scheduled task

`ops\nightly-proof.ps1` (no switches) registers `TownReporter Nightly Proof`,
triggered daily at 03:30, running **as an interactive logon** under the
operator's own account -- not "whether the user is logged on or not". The
Claude Code and Codex CLIs look for the operator's login in the interactive
session's profile; a batch/S4U task here would find nothing and report every
provider signed out, every night, on a machine that is plainly signed in.

That has one real consequence: if the operator is logged out (or the machine
is locked at the wrong moment for this Windows version's interpretation of
"interactive"), the 03:30 run will not have a session to run in. That is the
tradeoff this task makes on purpose -- see the comment in
`ops\nightly-proof.ps1` above the `New-ScheduledTaskPrincipal` line.

## What "the AI read timed out" looks like

0.6.1 raised Scan's own AI-read budget from a flat 90s to the same
per-provider budget a draft gets (150s on the CLI providers,
`providerBudget()` in `src/lib/news/ai.ts`). If a scan run still times out --
a slow night, a very large watch list, a provider having a bad day -- it
shows up in the artifact as `scan.ok: false` with the provider's own timeout
message in `errors`, never as a silent zero-lead "success". Report it
honestly rather than re-running until it happens to pass.

## Safety notes

- This spends real money on the operator's Claude/Codex accounts every night
  it runs. That is accepted and is the whole point: it is the only proof in
  this repo that the expensive path still works, unattended, without a
  human paying for it by hand first.
- `townreporter_dev` is a restored copy of production, not the live database
  (`townreporter`, port 5432). The nightly proof only ever reads/writes
  `townreporter_dev` on port 5433 -- see `assertDevDatabase` in
  `scripts/live-pipeline-proof.mjs`, which refuses anything else by name,
  the same guard `scripts/stage-editor.mjs` already uses.
- It never touches port 3000 or the live paper. Its own dev server binds
  port 3318 only.
- It never publishes. A landed draft in `townreporter_dev` is the proof;
  nothing here puts anything on a public page, live or staged.
