# TownReporter next patch — Unit AL, machine upkeep (unreleased)

**State:** Candidate work in progress. This document does not assert a release,
tag, GitHub publication, production deployment, or a promoted candidate. The
version number is not bumped by this work.

Four pieces of machine upkeep, three of them about the paper staying up and
backed up while nobody is watching, and the fourth about the middle rung of the
writing ladder no longer naming a model that may not be the one in memory.

## 1. The hash check no longer needs a PowerShell module

`ops/promote.ps1` and `installer/Install.ps1` checked a downloaded file with
`Get-FileHash`. On this machine that command is missing from a Windows
PowerShell 5.1 session whose `PSModulePath` was inherited from PowerShell 7 —
measured 2026-09-26 — so a promotion or an install run from that shell stopped
at the first hash. Both now hash with the same .NET SHA-256 code
`ops/lib-backup.ps1` already used (`Get-TownReporterFileHash`); the installer
carries its own copy of that code, because it cannot dot-source `ops/`.

Evidence: `node --test scripts/ops-scripts.test.mjs` exit 0, 57/57 — including
the case that runs the changed paths under `powershell.exe` with a
`PSModulePath` that cannot reach `Get-FileHash`, and was checked red against the
old code first.

## 2. Hand-named backups get an off-disk copy too

The nightly backup copied the timestamped `*.sql` series to the second drive,
and a hand-named safety copy — `townreporter_2026-09-24_1510_pre-provider-recovery.sql`,
the kind made before touching anything risky — was never copied anywhere. Every
other `*.sql` and `*.dump` in the local backup folder now goes to
`<offsite>\other-safety-copies\` with the same discipline as the series: written
as `.partial`, verified by size and SHA-256, then renamed onto the real name; a
file already there with the same hash is skipped; the keep-three local prune
never counts them and never deletes them, and nothing on the second drive is
deleted by any code path.

Evidence: `powershell -ExecutionPolicy Bypass -File scripts/ci-backup.ps1` —
"backups and alerts: every check passed", exit 0. It covers a hand-named `.sql`
and `.dump` arriving on the second drive byte-identical, a second run copying
neither again, a `.incomplete` and a `.partial` copied nowhere, a safety copy
that cannot be copied reported without stopping the series copy, and a safety
copy still on this machine after the prune.

## 3. The test copy on 3100 comes back after a reboot

The owner's rule is that the test copy on 3100 is always running, but nothing
started it after a reboot and the Control page said "nothing is answering on
3100 (that is normal; it is not always running)". `ops/stage.ps1` restores a
backup over the test copy each time it runs, so running that at boot would wipe
test data. The new `ops/start-stage.ps1` is **start-only**: it starts the
already-staged copy on 3100 with the same environment and database stage.ps1
recorded, and if nothing was ever staged it does nothing and says so. It is
reached three ways — by hand, by a **Start the test copy** button on the Control
page, and by the watchdog that already runs every five minutes (no new scheduled
task). The watchdog starts it only when 3100 is not answering *and* the paper on
3000 is healthy, at most once per 30 minutes, and it checks the command line of
whatever holds 3100 before touching it — anything that is not ours is left
alone. The Control page's 3100 card now says **down — the watchdog will start
it**, **starting**, or **up, version X**, and the two other cards that assumed
3100 never runs (the soft-failure count and the start window) were corrected.

Evidence: `node --test scripts/ops-scripts.test.mjs` exit 0, 57/57, including
the 18-second case that proves the start path is start-only and never names 3000
or 3100 as something to stop; `node --test scripts/control-page-server.test.mjs`
exit 0, 32/32; and `node scripts/control-page-walk.mjs` exit 0, which drives the
real page in a browser and presses the start button against a stub runner.

## 4. "Local model" means whatever LM Studio has loaded

The middle rung of the writing ladder — DeepSeek v4.1 Flash, then the local
model, then Codex Terra — was fixed to `halo/qwen3.6-35b-a3b`. The owner runs LM
Studio for other work and switches the loaded model, so that rung skipped all
day while he had something else loaded, and asking LM Studio for the named model
would have paged a 35B in from disk. The rung now reads LM Studio's own load
state — the native `/api/v0/models` listing, the endpoint the code already
probed, because `/v1/models` lists what is on disk and not what is in memory —
and runs the loaded chat model (never an embedding model). Two loaded picks the
lowest id, so two calls in a row pick the same one and the receipt can name what
ran. Zero loaded, or a listing that cannot say, skips the rung with "Local model
skipped: nothing loaded in LM Studio". The picker entry and the job receipt read
**Local model (halo/…)**, and the Control page's LM Studio card names the loaded
model. `TOWNREPORTER_QWEN_MODEL` still pins the rung to one exact model when it
is set, and is skipped unless LM Studio reports that one loaded. Nothing in the
app ever asks a local server for a model that is not loaded, and nothing loads
or unloads one on the owner's behalf.

Evidence: `npx tsc --noEmit` exit 0; `npm run typecheck:test` exit 0; ESLint on
every changed code file exit 0; the focused source tests — the ai ladder, the
daily scan, the model choice and picker suites, provider registry, local model
discovery, failover and OCR routing — 307 tests in 50 suites, 0 fail, exit 0.
The whole script suite (`node --test "scripts/**/*.test.mjs"`: 515 tests, 512
pass, 3 skipped, 0 fail) is green, including the picker-render test that reads
the ladder sentence out of the registry.

**What is not proved here.** The two browser ladder walks
(`scripts/failover-e2e.mjs`, `scripts/story-quota-failover-e2e.mjs`,
`scripts/daily-scan-automatic-e2e.mjs`) and their fake LM Studio endpoint were
updated for the new rule and syntax-checked, but not driven end to end in this
unit — they need a built server and are driven by CI. The fake endpoint's model
now reports itself **not loaded** by default, which is what keeps those walks
from calling a real local model; `FAKE_LMSTUDIO_STATE=loaded` flips it if the
opposite case is ever wanted. No claim is made about a real LM Studio's loaded
model: this unit never loaded, unloaded or chatted with one. The loaded-model
pick is deterministic by id, not by any measure of which model is better.
