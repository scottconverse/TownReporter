<#
  Put the current main branch onto this install, safely and repeatably.

  Promotion had been a sequence of commands typed from memory, which is how a
  running server got rebuilt underneath itself earlier in this project: every
  health check answered 200 while the editor's desk was dead in the browser for
  twelve minutes. The order below is the lesson from that. Nothing is built
  while the server is up.

  What it does, in order:

    1. refuses if this checkout has uncommitted work, so nothing is lost
    2. backs the database up, and refuses to continue if the dump looks empty;
       copies it to the offsite drive and verifies it there, then prunes the
       local folder back to the newest three (see ops\lib-backup.ps1)
    3. records what is on the paper now, to compare against afterwards
    3b. refuses if an editor has a desk job running or queued, unless
        -WaitForJobs (poll up to 15 min) or -Force (proceed anyway) is passed
    4. stops THIS install's server (not the shared Postgres, not other installs)
    5. fetches and fast-forwards to origin/main
    6. installs dependencies only if the lockfile actually moved
    7. builds (which migrates), keeping the build that is running now aside so
       a build that does not work can be undone
    8. starts, and waits for the port
    9. verifies: local page, public page, and the same number of stories

  If step 9 fails it says so loudly and tells you where the backup is. It does
  not roll back on its own there: the app is up and serving, and an automatic
  rollback of a half-applied migration is a worse problem than a paper whose
  story count moved. The operator decides.

  It DOES fall back on its own earlier than that, when the new build is not
  usable at all -- the build did not succeed, or the started app never answers.
  Then the build that was running before is put back and started, and the log
  says in so many words that the paper is back on the OLD version and the
  promote did not complete. A paper serving yesterday's build beats a paper
  serving nothing.

  AND IT SAYS WHAT THAT OLD BUILD IS NOW SITTING ON. `npm run build` ends in
  `npm run db:migrate` (package.json), so putting the old build back can leave
  a database that has already moved on underneath it -- and a page reading a
  table or column a migration changed answers wrongly rather than failing. The
  same message therefore carries the migration the database is at, when that
  can be established (from the migrate step's own output, or from the newest
  file in migrations\), and "migrations may have run" when it cannot. See
  Get-PromoteFallbackSentence in ops\lib-promote.ps1.

  WHY THE BUILD IS STILL INSIDE THE STOP-THE-APP WINDOW.

  Unit PR1 asked for the build to move in front of the stop, into a side
  directory, with a swap. It has not moved, and the reason is one line of
  package.json rather than caution:

    "build": "node scripts/with-app-env.mjs vite build && node
      scripts/patch-ssr-exports.mjs && node scripts/copy-runtime-assets.mjs &&
      npm run db:migrate"

  The build IS the migration. Building before the stop would run db:migrate
  under a live desk -- the exact thing this script exists to prevent. Splitting
  the migration out of `npm run build` would change what that script means for
  every other caller (every CI job, docs\staging.md, the installer), for a
  window that the fallback in step 7 has just made survivable rather than
  dangerous. Changing both in one unit, on the script that is the only way a
  release reaches the live paper, is the risk this unit was written to avoid.

  The design, for whoever picks it up: build into a side directory
  (`.output-next`) rather than in place -- which first needs establishing how
  nitro's output directory is actually set under `nitro/vite` in this
  checkout, and `patch-ssr-exports.mjs` and `copy-runtime-assets.mjs` taught to
  take that directory instead of assuming `.output`; then stop; migrate; rename
  `.output` -> `.output-previous`, `.output-next` -> `.output`; start. The
  stopped window then covers the migration, two renames and the start, and
  every step of it is reversible. It needs its own unit and its own test: a
  swap that half-happens on the machine serving the paper is worse than a long
  window, and the copy in step 7 already keeps the long window from being the
  dangerous one.

  THE LOG, AND WHY THIS SCRIPT NOW KEEPS ONE.

  Every run writes logs\promote-<yyyyMMdd-HHmmss>.log: one line per step with
  the time, the command each child ran, its real exit code and how long it
  took. The children's own stdout and stderr go to sibling files the log names,
  because npm's output is where a failed install explains itself.

  This exists because the script died three times on the live machine -- twice
  at `npm ci`, once at `npm run build` -- after it had already stopped the
  paper, and left nothing to read. It wrote no log of its own; only the backup
  step wrote logs\backup.log, so there was no evidence of what happened. The
  long steps now run as detached children with their output redirected to
  files, so closing the console that started the promote (or killing its shell)
  cannot reach in and kill npm mid-install. What actually killed them, measured
  and reproduced in scripts\promote-step-runner.test.mjs, is in the header of
  ops\lib-promote.ps1.

  RESUMING.

  If logs\promote-in-progress is still there from an earlier run, this script
  reads that run's log, says which step it reached, and stops -- offering
  -Resume to carry on from that step rather than starting over. Whenever it
  stops with the paper down, the exact command that brings the paper back is
  the last line it prints.

  It promotes the install it LIVES IN, found from its own location, not a path
  passed to it. Running the development copy promotes the development copy.
  That is deliberate: the alternative is a script that can be pointed at the
  live paper by accident from a checkout that is mid-edit.

  Between steps 3 and 4 it also refuses to promote while an editor has a desk
  job (a draft, a scan, a Dark Desk round, an Opinion piece) running or
  queued -- see the "3b" section below for why: on 2026-09-02 a promotion
  restarted the app under a running draft, and the story page showed three
  contradictory things at once while the stale-reclaim spent about two
  minutes quietly re-running the orphaned job. The reclaim recovers correctly;
  this guard is about not creating the situation on purpose when it is easy
  to just wait a few minutes.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -WhatIf
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -WaitForJobs
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -Force
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -Resume
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  # Poll every 15s, up to 15 minutes, for open desk jobs to clear instead of
  # refusing immediately.
  [switch]$WaitForJobs,
  # Proceed even though an editor has a job running or queued. Loud on
  # purpose: this is the one flag that knowingly recreates the 2026-09-02
  # situation.
  [switch]$Force,
  # Carry on from the step the last run reached, instead of stopping to ask.
  # Only meaningful when logs\promote-in-progress is present; without it this
  # is a no-op and the promotion runs from the beginning.
  [switch]$Resume
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib-ownership.ps1")
Assert-TownReporterLegacyOwnership
$ops = $PSScriptRoot
$app = Split-Path -Parent $ops
. (Join-Path $ops "lib-port.ps1")
. (Join-Path $ops "lib-backup.ps1")
. (Join-Path $ops "lib-promote.ps1")

# The log is opened before anything else can fail, so a run that dies on its
# first check still leaves a file behind saying so.
$log = New-PromoteLog -App $app
$recovery = Get-PromoteRecoveryCommand -App $app

<#
  Console output is best effort, on purpose.

  A promotion started from an agent's shell tool or a console window can
  outlive the thing that started it, and then every write to that console
  fails. That must not be what stops the promotion: the script still has a
  child to wait on, a marker to clear and, if the worst happens, a paper to
  bring back up. Both of these swallow a failed write for that reason. The
  log file, not the console, is the record.
#>
function Show($msg, [string]$Color = "") {
  try {
    if ($Color) { Write-Host $msg -ForegroundColor $Color } else { Write-Host $msg }
  } catch { }
}
function Say($msg) { Show "  $msg" }

<#
  Stop the promotion, in the log and on the console, and make the last line
  the thing the operator has to do next.

  The recovery command is printed last, and only when the paper is not
  answering, because that is the one case where the next move is not optional:
  every other failure leaves a paper that is still up, and the operator can
  read the log at leisure.

  The marker comes off when the paper is up: an unfinished promote that left
  the paper down is what -Resume is for, and a run that did not leave the paper
  down has nothing to resume. The "unfinished promote, no -Resume" path below
  goes its own way and deliberately keeps it.
#>
function Die($msg, [string]$Step = "", [string]$Next = "") {
  if ($Step) { Fail-PromoteStep -Log $log -Name $Step -Detail $msg }
  Write-PromoteLog $log "STOP. $msg"
  $paperUp = Test-PromotePaperUp -Port ([int]$port)
  if ($Next) { Write-PromoteLog $log "what to do next: $Next" }
  if ($paperUp) { Clear-PromoteMarker -App $app }
  Show ""
  Show "  STOP. $msg" Yellow
  Show ""
  Show "  The log for this run: $($log.Path)"
  if ($Next) { Show "  What to do next: $Next" }
  if (-not $paperUp) {
    Write-PromoteLog $log "the paper is NOT answering on port $port."
    Write-PromoteLog $log "to bring it back now: $recovery"
    Show ""
    Show "  The paper is not answering on port $port. To bring it back now:" Yellow
    Show "  $recovery" Yellow
  }
  exit 1
}

<#
  Every job kind (draft, scan, dark, editorial, brief -- see JobKind in
  src/lib/news/jobs.ts) lives in the one desk_jobs table, so one query covers
  all of them. Called after $dbName is set (step 2); reads through the same
  psql binary and port the rest of this script already uses for $dbName.

  Age is measured from started_at, falling back to created_at for a job that
  is still queued and has not started -- both are timestamptz, so this stays
  correct across whatever timezone the server runs in.
#>
function Get-OpenDeskJobs {
  $sql = "select id || '|' || kind || '|' || coalesce(stage, '') || '|' || floor(extract(epoch from (now() - coalesce(started_at, created_at))))::text from desk_jobs where status in ('running', 'queued') order by id"
  $rows = & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\psql.exe" -p 5433 -U postgres -d $dbName -tAc $sql
  $jobs = @()
  foreach ($line in $rows) {
    $line = "$line".Trim()
    if (-not $line) { continue }
    $parts = $line -split '\|', 4
    if ($parts.Count -lt 4) { continue }
    $jobs += [pscustomobject]@{ Id = $parts[0]; Kind = $parts[1]; Stage = $parts[2]; AgeSec = [int]$parts[3] }
  }
  return , $jobs
}

function Format-OpenDeskJob($job) {
  $stage = $job.Stage
  if (-not $stage) { $stage = "(no stage)" }
  return "    #$($job.Id)  $($job.Kind)  $stage  -- $($job.AgeSec)s old"
}

<#
  Skip a step when -Resume has already carried the run past it. Says so in the
  log every time, so a resumed log still reads as a complete account of the
  promotion rather than one with holes in it.
#>
function Skip-Step([string]$name) {
  if (-not $resumeAt) { return $false }
  $mine = Get-PromoteStepRank $name
  $target = Get-PromoteStepRank $resumeAt
  if ($mine -lt 0 -or $target -lt 0) { return $false }
  if ($mine -ge $target) { return $false }
  Write-PromoteLog $log "step=$name skipped -- the previous run already passed it"
  return $true
}

<#
  Start whatever is in .output now and wait for it to answer. Returns $true
  only when the paper really is answering, so nobody writes "the paper is
  back" about a process that never came up.

  The wait is bounded (Get-PromoteHealthTimeoutSeconds), because this is the
  other place a promotion can sit and hold the paper down: the start script
  itself is not detached, and a Postgres still in crash recovery is the
  documented reason it can take a while. It is a wait, not a give-up -- see
  the note on the marker's 30-minute cap in ops\lib-promote.ps1.
#>
function Start-TheApp {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ops "start-townreporter.ps1")
  $healthSeconds = Get-PromoteHealthTimeoutSeconds
  for ($i = 0; $i -lt $healthSeconds -and -not (Test-PromotePaperUp -Port ([int]$port)); $i++) {
    Start-Sleep -Seconds 1
  }
  return (Test-PromotePaperUp -Port ([int]$port))
}

Set-Location $app
Show ""
Show "  Promoting $app (port $port)"
Show "  ------------------------------------------------------------"

$argNames = @($PSBoundParameters.Keys) -join ' '
Write-PromoteLog $log "promote started: $app (port $port), pid $PID, arguments: '$argNames'"
Write-PromoteLog $log "this run's log: $($log.Path)"
Show "  Log: $($log.Path)"
Show ""

# --- 0. is there an unfinished run to pick up? ------------------------------
<#
  Read BEFORE anything destructive, and acted on before step 1, because the
  whole point is not to start over on top of a run that stopped half way with
  the paper down.

  The marker alone does not say enough: logs\promote-in-progress only records
  that a run did not finish. The log beside it records how far it got, so
  Get-PromoteResumePoint (ops\lib-promote.ps1) reads the newest one and says
  which step to carry on from.
#>
$resumePoint = Get-PromoteResumePoint -App $app
$resumeAt = $null
if ($resumePoint) {
  $reached = if ($resumePoint.Step) { "the step '$($resumePoint.Step)' ($($resumePoint.Status))" } else { "no step it can name" }
  Say "an earlier promotion did not finish -- logs\promote-in-progress is still here."
  Say "it was started $($resumePoint.StartedAt) and reached $reached."
  if ($resumePoint.LogPath) { Say "its log: $($resumePoint.LogPath)" }
  if ($resumePoint.Backup) { Say "its backup: $($resumePoint.Backup)" }
  Write-PromoteLog $log "unfinished promote found: reached $reached, log $($resumePoint.LogPath)"

  if (-not $Resume) {
    $paperUp = Test-PromotePaperUp -Port ([int]$port)
    $nextStep = $resumePoint.NextStep
    Show ""
    Show "  This promotion will not start over on top of that run." Yellow
    if ($paperUp) {
      Show "  The paper is answering on port $port." Yellow
    } else {
      Show "  The paper is NOT answering on port $port." Yellow
    }
    Show ""
    if ($nextStep) {
      Show "  To carry on from '$nextStep': re-run this script with -Resume" Yellow
      Write-PromoteLog $log "stopped: -Resume was not passed. To carry on from '$nextStep', re-run with -Resume. To start over, delete logs\promote-in-progress."
    } else {
      Show "  Its log does not say where it stopped; re-run with -Resume to go through the steps again." Yellow
      Write-PromoteLog $log "stopped: -Resume was not passed. To start over, delete logs\promote-in-progress."
    }
    Show "  To start over instead: delete logs\promote-in-progress, then run this script again." Yellow
    if (-not $paperUp) {
      Write-PromoteLog $log "to bring the paper back now: $recovery"
      Show ""
      Show "  To bring the paper back now:" Yellow
      Show "  $recovery" Yellow
    }
    exit 1
  }

  $resumeAt = $resumePoint.NextStep
  New-PromoteMarker -App $app | Out-Null
  if ($resumeAt) {
    Write-PromoteLog $log "resuming with -Resume: every step before '$resumeAt' is skipped"
    Say "resuming from '$resumeAt'"
  } else {
    Write-PromoteLog $log "resuming with -Resume, but the previous log does not say where it stopped; going through every step again"
  }
  Show ""
}

# --- 1/2. backup, then everything that can fail without consequence ---------
$backupNote = "(no backup taken: -WhatIf)"
$dbUrl = Read-OpsEnvValue -EnvFile (Join-Path $app ".env") -Name 'DATABASE_URL'
if (-not $dbUrl) { Die "No DATABASE_URL in .env, so there is nothing to back up and no paper to promote." }
$dbName = ($dbUrl -split '/')[-1].Trim()

<#
  The dump itself moved to ops\lib-backup.ps1 on 2026-09-25, unchanged: same
  pg_dump, same flags, same <database>_YYYY-MM-DD_HHmm.sql name, same 100000
  byte floor. It is a library because this was the ONLY place in the tree that
  ran pg_dump -- no scheduled task did -- so the paper's only copy of itself
  was whatever the last promotion happened to leave behind. The nightly run in
  watchdog.ps1 needs exactly this code, and a second copy of it would be a
  second place for the flags to drift.

  What is new here is what happens after the dump: it is copied to the offsite
  drive and verified there, and the local folder is pruned back to the newest
  three -- but only for files proven identical on the other drive. The library
  refuses to delete anything locally if the copy did not verify, and refuses
  again if the offsite drive is short of room. So a promotion can no longer
  quietly be the reason there is nowhere left to restore from.

  The gate is still the backup, and only the backup: a failed dump stops the
  promotion here, as it always has. A failed COPY does not, because the local
  backup it just wrote is intact and the paper being down is the worse problem
  -- it prints, it alerts, and it deletes nothing.

  -LockWaitSeconds: a promotion that refused to run because a nightly dump was
  mid-flight would take the paper down for nothing. Wait for it.

  A RESUMED run does not take a second one when the interrupted run's log
  names the backup it already took: that dump IS this promotion's
  pre-promotion backup, and taking another would only lengthen a window that
  is already open. If the previous log does not name one, this run takes one.
#>
$reuseBackup = $false
if ($resumePoint -and $resumeAt -and (Get-PromoteStepRank 'backup') -lt (Get-PromoteStepRank $resumeAt)) {
  if ($resumePoint.Backup) {
    $backupNote = $resumePoint.Backup
    $reuseBackup = $true
    Write-PromoteLog $log "step=backup skipped -- reusing the backup the interrupted run took: $backupNote"
    Write-PromoteLog $log "the previous run already passed it"
    Say "backup (from the interrupted run): $backupNote"
  } else {
    Write-PromoteLog $log "step=backup skipped by -Resume, but the interrupted run's log does not name a backup, so this run takes one"
    $resumeAt = 'backup'
  }
}
if (-not $reuseBackup) {
  Add-PromoteStep -Log $log -Name 'backup' -Detail "database $dbName"
  $t0 = Get-Date
  if ($PSCmdlet.ShouldProcess($dbName, "back up, copy the backup to the offsite drive, and prune the local backups")) {
    $run = Invoke-TownReporterBackupRun -Database $dbName -App $app -Force -LockWaitSeconds 120 -LogFile (Join-Path $app "logs\backup.log")
    if ($run.Skipped) { Die "Could not take a backup ($($run.Reason)). Not promoting without one." 'backup' "Fix whatever stopped the backup (it is in logs\backup.log), then run this script again." }
    # DumpOk, not Ok: -Force means this run always attempts a dump, so a $null or
    # $false here means there is no backup on this machine and the promotion must
    # not proceed. Ok would also fail on a failed COPY, and refusing to promote
    # over a full D: drive would take the paper down for no reason at all.
    if ($run.DumpOk -ne $true) { Die "Could not take a backup ($($run.Reason)). Not promoting without one." 'backup' "Fix whatever stopped the backup (it is in logs\backup.log), then run this script again." }

    $backup = Join-Path (Get-TownReporterBackupDir -App $app) $run.State.lastName
    $backupNote = "$backup ($([math]::Round($run.State.lastBytes/1MB,1)) MB)"
    Say "backup: $backupNote"
    foreach ($line in $run.Lines) {
      if ($line -notlike 'took a backup:*') { Say "  $line" }
    }
  }
  Complete-PromoteStep -Log $log -Name 'backup' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail $backupNote
}

<#
  Everything that can fail without consequence, asked BEFORE anything is
  stopped.

  The first real run took the paper down, then discovered the merge could not
  proceed because an untracked file sat where an incoming one belonged. The
  paper stayed down while that was sorted out. Everything that can fail without
  consequence must fail before the first destructive step, not after it.
#>
if (Skip-Step 'preflight') {
  # nothing to do
} else {
  Add-PromoteStep -Log $log -Name 'preflight' -Detail "checkout, fast-forward, and the editor's jobs"
  $t0 = Get-Date
  $dirty = (& git status --porcelain) | Where-Object { $_ -notmatch '^\?\?' }
  if ($dirty) {
    Say "uncommitted changes here:"
    $dirty | ForEach-Object { Say "    $_" }
    Die "Commit or stash them first. A build would bury them." 'preflight' "Commit or remove the listed files, then run this script again."
  }

  & git fetch origin --quiet
  $head = (& git rev-parse HEAD).Trim()
  $target = (& git rev-parse origin/main).Trim()
  if ($head -ne $target) {
    $ahead = (& git rev-list --count origin/main..HEAD).Trim()
    if ($ahead -ne '0') { Die "This checkout has $ahead commit(s) origin/main does not. Push or reset them first." 'preflight' "Push those commits, or reset the checkout to origin/main, then run this script again." }
    <#
      Ask git whether a fast-forward is POSSIBLE, without performing one.

      The first version of this check ran `git merge --ff-only --no-commit
      --no-ff`, which is self-contradictory -- and git resolved it by doing a
      real merge and stopping before the commit. A check that changes the thing
      it is checking is not a check. It left the live checkout mid-merge with
      everything staged, on a run whose whole purpose was to find problems
      BEFORE touching anything.

      `merge-base --is-ancestor` answers the same question and reads nothing but
      the commit graph.
    #>
    & git merge-base --is-ancestor HEAD origin/main
    if ($LASTEXITCODE -ne 0) {
      Die "origin/main is not ahead of this checkout in a straight line. A fast-forward is not possible." 'preflight' "Reconcile this checkout with origin/main by hand, then run this script again."
    }
    # A file is a collision when it is arriving from origin/main, already exists
    # on disk, and git is not tracking it -- git refuses to overwrite those.
    $incoming = @(& git diff --name-only HEAD origin/main)
    $tracked = @(& git ls-files)
    $collisions = @()
    foreach ($f in $incoming) {
      if (-not (Test-Path $f)) { continue }
      if ($tracked -contains $f) { continue }
      $collisions += $f
    }
    if ($collisions.Count -gt 0) {
      Say 'these untracked files sit where incoming ones belong:'
      $collisions | ForEach-Object { Say "    $_" }
      Die 'Move or delete them first. Stopping now would take the paper down for a merge that cannot run.' 'preflight' "Move or delete the listed files, then run this script again."
    }
  }
  Say "checkout can fast-forward to $($target.Substring(0,7))"
  Complete-PromoteStep -Log $log -Name 'preflight' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "no uncommitted work, fast-forward to $($target.Substring(0,7)) is possible"
}

# --- 3. what is on the paper now -------------------------------------------
# Read here, and not inside the preflight step, because -Resume can skip that
# step and step 9 still needs a number to compare against. Read-only and cheap.
$before = & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\psql.exe" -p 5433 -U postgres -d $dbName -tAc "select count(*) from articles where status='published'"
$before = "$before".Trim()
Say "published stories now: $before"
Write-PromoteLog $log "published stories now: $before"

# --- 3b. refuse to restart the app under a running editor job --------------
<#
  On 2026-09-02 an operator promoted while the editor had a draft running.
  Step 4 below stops the app; that orphaned the running desk_job. The 120s
  stale-reclaim in src/lib/news/jobs.ts correctly picked it back up and
  re-ran it to completion about two minutes later -- the recovery worked --
  but for those two minutes the story page showed contradictory things at
  once, and there was no reason to put the editor through that at all: the
  job would have finished in the time it takes to notice it is running.

  This checks BEFORE step 4 stops anything, same reasoning as the preflight
  fast-forward check above: everything that can fail without consequence
  must fail before the first destructive step.
#>
$openJobs = Get-OpenDeskJobs
if ($openJobs.Count -gt 0 -and $WaitForJobs) {
  Say "waiting for $($openJobs.Count) open job(s) to clear (checking every 15s, up to 15 minutes)..."
  Write-PromoteLog $log "waiting for $($openJobs.Count) open desk job(s) to clear, up to 15 minutes"
  $deadline = (Get-Date).AddMinutes(15)
  while ($openJobs.Count -gt 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    $openJobs = Get-OpenDeskJobs
    if ($openJobs.Count -gt 0) {
      Say "  still $($openJobs.Count) open:"
      foreach ($j in $openJobs) { Say (Format-OpenDeskJob $j) }
    }
  }
  if ($openJobs.Count -eq 0) { Say "clear -- no open jobs." }
}
if ($openJobs.Count -gt 0 -and -not $Force) {
  Say "an editor has $($openJobs.Count) job(s) running:"
  foreach ($j in $openJobs) { Say (Format-OpenDeskJob $j) }
  Die "Promoting now would restart the app under them. Wait for them to finish, or re-run with -WaitForJobs to poll until clear (max 15 min), or -Force to proceed anyway." '' "Wait for the listed job(s) to finish, or re-run with -WaitForJobs."
}
if ($openJobs.Count -gt 0 -and $Force) {
  Show ""
  Show "  WARNING: proceeding with $($openJobs.Count) job(s) still running (-Force):" Yellow
  foreach ($j in $openJobs) { Show "  $(Format-OpenDeskJob $j)" Yellow }
  Show "  The stale-reclaim will re-run them once the app is back up, about 2 minutes after this restart." Yellow
  Show ""
  Write-PromoteLog $log "WARNING: proceeding with $($openJobs.Count) desk job(s) still open (-Force)"
}

# --- 4. stop this install ---------------------------------------------------
<#
  Stop the app here, not through stop-townreporter.ps1.

  That script is part of what is being upgraded, so on the run that matters it
  is whatever version the OLD checkout had. On the first real promotion the old
  one stopped the shared Postgres cluster as well -- serving the live paper, the
  development copy and every test database -- and recovery from an unclean stop
  took 226 seconds of fsync while the site returned 500.

  A promotion must not depend on a fix arriving in the same promotion. This
  stops exactly one process: whatever holds this install's port.
#>
if (Skip-Step 'stop') {
  # A resumed run is already past this: the app was stopped by the run that
  # came before, and the marker it left is why this script is here at all.
  # Refreshed anyway, so the watchdog's 30-minute stand-down starts now rather
  # than at whatever o'clock the interrupted run left it.
  New-PromoteMarker -App $app | Out-Null
} else {
  Add-PromoteStep -Log $log -Name 'stop' -Detail "the app on port $port"
  $t0 = Get-Date
  $stopped = @()
  if ($PSCmdlet.ShouldProcess("the app on port $port", "stop")) {
    <#
      Hold the watchdog off BEFORE the first destructive step. During the
      v0.5.4 promotion the five-minute watchdog saw the deliberately-stopped
      app, "repaired" it 45 seconds before the build finished writing, and the
      paper served a half-written build -- old pages naming script files that
      no longer existed. watchdog.ps1 stands down while this marker is under
      30 minutes old; the age cap keeps a promote that dies here from
      silencing the watchdog forever.
    #>
    New-PromoteMarker -App $app | Out-Null

    # Get-TownReporterPortOwner (lib-port.ps1): an unfiltered port check would
    # also catch some other program's IPv6-only listener on the same port
    # number and wrongly refuse to promote, or refuse to touch nothing at all.
    $owners = Get-TownReporterPortOwner $port
    foreach ($owner in $owners) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
      if (-not $proc) { continue }
      if ($proc.Name -ne 'node.exe' -or -not (Test-TownReporterServerProcess -Process $proc -App $app)) {
        Die "Port $port is held by PID $owner ($($proc.Name)), which is not this app. Not touching it." 'stop' "Find out what owns port $port and stop it, then run this script again."
      }
      Say "stopping the app, PID $owner"
      Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
      $stopped += "PID $owner"
    }
    Start-Sleep -Seconds 2
    # Postgres is deliberately left running: one cluster serves the live paper,
    # the development copy and every scratch database on this machine.
  }
  $stopDetail = if ($stopped.Count -gt 0) { "stopped $($stopped -join ', ')" } else { "nothing was listening on $port" }
  Complete-PromoteStep -Log $log -Name 'stop' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail $stopDetail
}

# --- 5. fetch and fast-forward ---------------------------------------------
# Get-FileHash lives in Microsoft.PowerShell.Utility, which a PowerShell 5.1
# session that inherited PowerShell 7's PSModulePath cannot reach (measured
# 2026-09-26: CommandNotFoundException). lib-backup.ps1 is dot-sourced above
# and has a module-free SHA256, so use that instead -- a promote that dies on
# the lockfile hash dies with the paper already stopped.
$lockBefore = if (Test-Path "package-lock.json") { Get-TownReporterFileHash -Path "package-lock.json" } else { "" }
if (Skip-Step 'ff') {
  # Already at origin/main: the interrupted run fetched and merged, so the
  # before/after comparison cannot answer "did this promotion bring a new
  # lockfile" any more, and does not need to -- see the note on the deps step
  # below, which is why reaching 'deps' at all means "install again".
} else {
  Add-PromoteStep -Log $log -Name 'ff' -Detail "fetch and fast-forward to origin/main"
  $t0 = Get-Date
  $ffDetail = "already at origin/main"
  if ($PSCmdlet.ShouldProcess("origin/main", "fast-forward")) {
    & git fetch origin --quiet
    $head = (& git rev-parse HEAD).Trim()
    $target = (& git rev-parse origin/main).Trim()
    if ($head -eq $target) {
      Say "already at origin/main ($($head.Substring(0,7)))"
      $ffDetail = "already at $($head.Substring(0,7))"
    } else {
      & git merge --ff-only origin/main
      if ($LASTEXITCODE -ne 0) {
        # Nothing has touched .output: what is on disk is the build that was
        # running before the stop, so it can simply be started again.
        Say "the fast-forward failed; bringing the paper back on the build it already had"
        $back = Start-TheApp
        if ($back) { Write-PromoteLog $log "the paper is back on the version it was running. The promote did NOT complete." }
        Die "Could not fast-forward. This checkout has diverged from origin/main." 'ff' "Reconcile the checkout with origin/main by hand, then run this script again. The backup is at $backupNote"
      }
      Say "moved $($head.Substring(0,7)) -> $($target.Substring(0,7))"
      $ffDetail = "moved $($head.Substring(0,7)) -> $($target.Substring(0,7))"
    }
  }
  Complete-PromoteStep -Log $log -Name 'ff' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail $ffDetail
}
# Hashed here rather than inside the branches, and hashed on the resumed path
# too. These two lines are the pair scripts\ci-hash-no-module.ps1 lifts out and
# runs in a PowerShell 5.1 session that cannot reach Get-FileHash; a step that
# stopped hashing on one path would quietly take that check with it.
$lockAfter = if (Test-Path "package-lock.json") { Get-TownReporterFileHash -Path "package-lock.json" } else { "" }

# --- 6. dependencies, only if the lockfile moved ---------------------------
<#
  The fast-forward happened above, so the lockfile hash before it and after it
  answers "did this promotion bring a new lockfile".

  A RESUMED run sitting at this step cannot answer that question any more --
  the checkout is already at origin/main, so before and after are equal -- and
  it does not need to: reaching 'deps' at all means the install the previous
  run started never finished, so it runs again. Reporting "lockfile unchanged,
  skipping install" there would be exactly the wrong answer on the one run
  where npm ci is the thing that died.
#>
$mustInstall = ($lockBefore -ne $lockAfter) -or ($resumeAt -eq 'deps')
if (Skip-Step 'deps') {
  # nothing to do
} else {
  Add-PromoteStep -Log $log -Name 'deps' -Detail "npm ci"
  $t0 = Get-Date
  if (-not $mustInstall) {
    Say "lockfile unchanged; skipping install"
    Complete-PromoteStep -Log $log -Name 'deps' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "lockfile unchanged, no install needed"
  } elseif ($PSCmdlet.ShouldProcess("dependencies", "npm ci")) {
    Say "the lockfile changed; installing dependencies"
    $r = Invoke-PromoteChild -Log $log -Step 'deps' -Command 'npm ci'
    if ($r.ExitCode -ne 0) {
      $code = if ($r.TimedOut) {
        "it ran past its $(Get-PromoteChildTimeoutSeconds -Step 'deps')-second limit and was stopped"
      } elseif ($null -eq $r.ExitCode) {
        "it did not reach its end, so there is no exit code"
      } else {
        "exit $($r.ExitCode)"
      }
      Die "npm ci did not succeed ($code). The paper is still down. Its output is in $($r.OutFile)" 'deps' "Read that file, fix the install, then re-run this script with -Resume to carry on from here. The backup is at $backupNote"
    }
    Complete-PromoteStep -Log $log -Name 'deps' -Seconds $r.Seconds -Detail "npm ci exit 0"
  } else {
    Complete-PromoteStep -Log $log -Name 'deps' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "skipped (-WhatIf)"
  }
}

# --- 7. build (the server is DOWN here, on purpose) ------------------------
<#
  `npm run build` is `vite build && patch-ssr-exports && copy-runtime-assets &&
  npm run db:migrate` (package.json), so this step migrates the database as
  well. That is why it runs with the server down and why it cannot simply be
  moved in front of the stop: a migration under a running desk is the thing
  this script exists to prevent. The migration half is named in the log so
  nobody has to work it out from package.json at 2 AM.

  The build that is running now is copied aside first. A build that fails
  leaves .output half-written, and the paper cannot be brought back on half a
  build -- so that copy is what makes "put the old version back" a real option
  rather than a hopeful sentence in a log.
#>
$previousBuild = $null
# The step's own stdout, kept for step 8: if that step has to put the old build
# back, what the database is at is read out of this file. On a resumed run the
# build did not happen here, and the answer comes from the migrations directory
# instead -- see Get-PromoteAppliedMigrationName.
$buildOutputFile = $null
if (Skip-Step 'build') {
  # A resumed run past this point already has a build it liked, and the run it
  # resumed left the one before THAT at .output-previous -- which is what a
  # failed start would fall back to.
  $previousBuild = Resolve-PromotePreviousBuild -App $app
} else {
  if ($PSCmdlet.ShouldProcess("the app", "build")) {
    Say "building"
    $built = Invoke-PromoteBuild -Log $log -App $app -Command 'npm run build' -StartTheApp { Start-TheApp } -Previous $previousBuild
    if ($built.Previous) { $previousBuild = $built.Previous }
    if ($built.OutFile) { $buildOutputFile = $built.OutFile }
    if (-not $built.Ok) {
      Say "the build did not succeed"
      # No step name: Invoke-PromoteBuild has already written this step's FAILED
      # line into the log, carrying the same sentence, and a second one would
      # make a reader think the step failed twice.
      Die "$($built.Failure) The build's output is in $($built.OutFile)" '' "Read that file, fix the build, then run this script again (without -Resume: the checkout is already at origin/main). The backup is at $backupNote"
    }
  } else {
    Add-PromoteStep -Log $log -Name 'build' -Detail "npm run build (this also runs the schema migration)"
    Complete-PromoteStep -Log $log -Name 'build' -Seconds 0 -Detail "skipped (-WhatIf)"
  }
}

# --- 8. start ---------------------------------------------------------------
if (Skip-Step 'start') {
  # nothing to do
} else {
  Add-PromoteStep -Log $log -Name 'start' -Detail "start-townreporter.ps1, then wait for port $port"
  $t0 = Get-Date
  if ($PSCmdlet.ShouldProcess("the app", "start")) {
    if (-not (Start-TheApp)) {
      <#
        The new build is not usable: it exists, but nothing is serving it.
        A paper on the previous build is worth more than a paper on nothing,
        so put the old one back and start that -- and say so plainly, because
        "the paper is up" and "the promote worked" are different sentences.
      #>
      Say "the new build did not come up on port $port"
      Write-PromoteLog $log "the new build was started but nothing answered on port $port within $(Get-PromoteHealthTimeoutSeconds)s"
      <#
        MigrationsRan 'yes': getting here means the build step finished, this
        run or the one this run resumed -- and the build step ends in
        `npm run db:migrate`. So the database is at the newest migration this
        checkout knows about, while the build going back on is the older one.
        Invoke-PromoteFallback logs that sentence; the message below repeats it
        so the operator sees it without opening the log.
      #>
      if (Invoke-PromoteFallback -Log $log -App $app -StartTheApp { Start-TheApp } -Previous $previousBuild -MigrationsRan 'yes' -BuildOutput $buildOutputFile) {
        $sentence = Get-PromoteFallbackSentence -App $app -MigrationsRan 'yes' -BuildOutput $buildOutputFile
        if (-not $sentence) { $sentence = "The paper is back on the OLD version; the promote did not complete." }
        Say $sentence
        Die "The new build did not answer on port $port. $sentence" 'start' "Read logs\townreporter.log for why the new build did not start. The backup is at $backupNote"
      }
      Die "The new build did not answer on port $port, and there was no previous build to put back." 'start' "Read logs\townreporter.log for why it did not start. The backup is at $backupNote"
    }
  }
  Complete-PromoteStep -Log $log -Name 'start' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "the paper answers on port $port"
}

<#
  A 200 is not proof of a working page.

  This is exactly how a broken promote slipped through undetected: the public
  page was rendering an error boundary ("Something went wrong" plus the
  thrown message) and every check here still went green, because a rendered
  error page is still a 200. Fetching /, checking the status code, and
  stopping there proves the server answered, not that the paper it answered
  with is real.

  So this checks the actual bytes for two things, on BOTH the local origin
  and the public URL:

    1. real content is present -- the masthead's <title> tag (set from the
       live paper identity in every response, error pages included -- so this
       alone is not sufficient, only necessary) and a real HTML document of a
       plausible size, not a near-empty error shell;
    2. none of the literal strings the app's own error boundary renders
       (src/lib/error-component.tsx's AppErrorComponent, wired as the
       router's defaultErrorComponent) appear anywhere in the response.

  A near-empty page that also happens to dodge every denylisted string would
  still fail on the minimum-length check, so the two checks cover each
  other's blind spot.
#>
function Test-RealPageContent {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSec = 30
  )
  $result = @{ Ok = $false; Failures = @() }
  try {
    $resp = Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec $TimeoutSec
  } catch {
    $result.Failures += "$Label did not answer: $($_.Exception.Message)"
    return $result
  }
  if ($resp.StatusCode -ne 200) {
    $result.Failures += "$Label answered $($resp.StatusCode)"
    return $result
  }
  $html = $resp.Content

  # A rendered error page is a real HTML document too, so status 200 plus
  # "it has a body" is not enough -- but a genuinely broken response (an
  # empty body, a bare "OK", a proxy's own error page) is usually far
  # shorter than a real edition, so a floor still catches that class of
  # failure the string checks below cannot.
  if ($html.Length -lt 2000) {
    $result.Failures += "$Label response is only $($html.Length) bytes -- too small to be a real page"
  }

  $titleMatch = [regex]::Match($html, '<title>([^<]*)</title>')
  if (-not $titleMatch.Success -or $titleMatch.Groups[1].Value.Trim().Length -lt 3) {
    $result.Failures += "$Label served no real <title> (masthead identity missing)"
  }

  # The literal strings AppErrorComponent renders on any uncaught error --
  # see src/lib/error-component.tsx and src/router.tsx's defaultErrorComponent.
  $errorMarkers = @(
    "Something went wrong",
    "Cannot destructure",
    "is not a function",
    "is not defined",
    "ChunkLoadError",
    "Failed to fetch dynamically imported module"
  )
  foreach ($marker in $errorMarkers) {
    if ($html -like "*$marker*") {
      $result.Failures += "$Label response contains error-boundary text: `"$marker`""
    }
  }

  if ($result.Failures.Count -eq 0) {
    $result.Ok = $true
  }
  return $result
}

# --- 9. verify --------------------------------------------------------------
$fail = @()
if (Skip-Step 'verify') {
  # nothing to do
} else {
  Add-PromoteStep -Log $log -Name 'verify' -Detail "local page, its script asset, public page, story count"
  $t0 = Get-Date
  Show ""
  Say "checking"

  $localCheck = Test-RealPageContent -Url "http://127.0.0.1:$port/" -Label "local ($port)"
  if ($localCheck.Ok) { Say "[ OK ] the paper answers on $port with real content, no error boundary" }
  else { $fail += $localCheck.Failures }

  <#
    A 200 from the front page is server-side HTML and proves nothing about the
    client: during the watchdog-race incident the paper answered 200 while
    every script asset 500d and every click was dead. So fetch a script the
    page itself names -- if the served HTML and the on-disk build disagree,
    this is the line that catches it.
  #>
  try {
    $html = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 30).Content
    $m = [regex]::Match($html, '/assets/[A-Za-z0-9_.-]+\.js')
    if (-not $m.Success) {
      $fail += "the served page names no script asset at all"
    } else {
      $assetCode = (Invoke-WebRequest "http://127.0.0.1:$port$($m.Value)" -UseBasicParsing -TimeoutSec 30).StatusCode
      if ($assetCode -eq 200) { Say "[ OK ] the page's own script asset serves ($($m.Value))" }
      else { $fail += "script asset $($m.Value) answered $assetCode -- served HTML and built assets disagree" }
    }
  } catch { $fail += "script asset check failed: $($_.Exception.Message)" }

  $site = $env:PUBLIC_SITE_URL
  if (-not $site) { $site = "https://townreporter.org" }
  $pubCheck = Test-RealPageContent -Url $site -Label $site -TimeoutSec 40
  if ($pubCheck.Ok) { Say "[ OK ] $site answers with real content, no error boundary" }
  else { $fail += $pubCheck.Failures }

  $after = & "$env:USERPROFILE\scoop\apps\postgresql\current\bin\psql.exe" -p 5433 -U postgres -d $dbName -tAc "select count(*) from articles where status='published'"
  $after = "$after".Trim()
  if ($after -eq $before) { Say "[ OK ] still $after published stories" }
  else { $fail += "published stories went from $before to $after" }

  Write-PromoteLog $log "verify: published stories $before -> $after"
  if ($fail.Count -eq 0) {
    Complete-PromoteStep -Log $log -Name 'verify' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "every check passed"
  } else {
    foreach ($f in $fail) { Write-PromoteLog $log "verify check failed: $f" }
    Fail-PromoteStep -Log $log -Name 'verify' -Detail "$($fail.Count) check(s) failed after the promotion"
  }
}

Show ""
<#
  The marker comes off on BOTH paths. On success the promote is over; on
  failure the watchdog is the only automatic thing that can still help, so
  muzzling it for the rest of the 30-minute cap would make a bad promote
  worse. The operator message stays the authority either way.
#>
Clear-PromoteMarker -App $app
if ($fail.Count -gt 0) {
  $fail | ForEach-Object { Show "  [FAIL] $_" Yellow }
  Die "Promotion finished but the paper is not healthy. The backup is at $backupNote" '' "The paper is up but something about it is wrong -- read the checks above and logs\townreporter.log. The backup is at $backupNote"
}
Write-PromoteLog $log "done: promoted. The paper is up and the archive is intact."
Write-PromoteLog $log "backup kept at $backupNote"
Show "  Promoted. The paper is up and the archive is intact." Green
Show "  Backup kept at $backupNote"
Show "  Log: $($log.Path)"
Show ""
