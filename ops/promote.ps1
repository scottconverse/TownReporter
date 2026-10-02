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
    4b. waits for every connection to the live database to close, then copies
        it: `townreporter` -> `townreporter_prerollout_<date><time>` (unit PR2)
    5. fetches and fast-forwards to origin/main
    6. installs dependencies only if the lockfile actually moved
    7. builds (which migrates), keeping the build that is running now aside so
       a build that does not work can be undone
    8. starts, and waits for the port
    9. verifies: local page, public page, and the same number of stories

  If step 9 fails it says so loudly and tells you where the backup is. It does
  not roll back on its own there: the app is up and serving, and an automatic
  rollback of a half-applied migration is a worse problem than a paper whose
  story count moved. The operator decides -- and by then the new app has been
  taking writes, so the script prints the exact command that puts the copy back
  by hand and says plainly what that costs.

  THE DATABASE COPY, AND WHY THE BUILD FALLBACK WAS NOT ENOUGH (unit PR2).

  `npm run build` ends in `npm run db:migrate` (package.json), so step 7
  migrates the live database with the paper stopped. The build-that-failed
  fallback above puts the previous BUILD back -- but if the migration died
  half way, or the new app cannot read the schema the migration left, the
  previous build is then serving a database that has already moved on, and a
  page reading a table or column a migration changed answers wrongly rather
  than failing. That is the worst way for a newspaper to be wrong, so the
  owner's answer is in step 4b: copy the database first, and put the copy back
  when the rollout fails.

  The order is the whole design, and it is not arbitrary:

    * the copy is taken AFTER the app is stopped, because PostgreSQL refuses to
      copy a database anybody is connected to, and the app IS the connection.
      The script waits for every session to close and REFUSES if they do not --
      it never ends a session, because on this machine those sessions belong to
      the live paper, the development copy and thirty test databases;
    * everything that can be known earlier is asked BEFORE the stop: the
      database's name, that it starts with `townreporter` (this machine's
      Postgres serves other databases, and a typo must not rename one of them),
      that the copy's name is free, that the role may create a database, and
      that the disk holding PostgreSQL's data directory has room for the copy
      plus a quarter of its size or 2 GB, whichever is larger;
    * the copy is before `ff` and therefore before the build, which is the step
      that runs the migration.

  On a failure after the copy -- the dependency install, the fast-forward, the
  build/migration, or a new build that never answers -- step 9's failure path
  stops whatever is serving, puts the copy back (`townreporter` becomes
  `townreporter_failed_<stamp>`, the copy becomes `townreporter`), restores the
  previous build and starts it. No data is lost, because the paper was stopped
  from before the copy was taken. The `_failed_` database is KEPT: it is the
  only record of what the half-finished migration did, and nothing is ever
  deleted automatically by this script.

  A SWAP CANNOT BE UNDONE, WHICH IS WHY THERE IS NO AUTOMATIC ONE LATE. Once
  the new app has started and taken writes, putting the copy back throws those
  writes away. So past step 8 the script never swaps by itself; it prints the
  one command that does it (`-RollbackDatabase <copy>`) and a warning saying
  what running it costs. See "Rolling the database back by hand" below.

  HEAVY IO, IN PLAIN WORDS. `CREATE DATABASE ... TEMPLATE` forces a checkpoint
  on the whole Postgres cluster. It is not a background copy, and on this
  shared server every other database waits for it. Measured on a throwaway
  Postgres 18.6 with nobody connected: 4.4 s to copy a 545 MB database and
  0.47 s for the two renames of a swap-back. Expect more on a busy server.

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

  ROLLING THE DATABASE BACK BY HAND.

  A promotion that got as far as serving the new build prints the one command
  that undoes just the database half of it:

    powershell -NoProfile -ExecutionPolicy Bypass -File "...\ops\promote.ps1" `
      -RollbackDatabase townreporter_prerollout_20261001120000

  IT REFUSES WHILE THE PAPER IS ANSWERING. The promotion's own health-check
  failure leaves the app UP and serving -- that is the case this command is
  printed for -- and swapping a database out from under a running app is not
  something to do by accident. So the first thing it does is ask whether the
  paper answers on its port, and if it does it stops, having changed nothing:

    The paper is answering on port 3000. Stop it first, or run the promote's
    own recovery; nothing was changed.

  Pass -StopApp to have it stop the app by PID (exactly as the promotion does)
  and carry on; or stop the app by hand and run it again.

  Before it renames anything it prints, in plain words and with sizes, which
  database becomes live and which is set aside:

    townreporter_prerollout_20261001120000 (570.2 MB) becomes townreporter;
    the current townreporter (610.4 MB) is kept as townreporter_failed_20261001120000.

  Under -WhatIf it prints that and changes nothing.

  Then it waits for every connection to the live database to close (refusing
  rather than ending anyone's session), renames the live database aside as
  `townreporter_failed_<stamp>`, renames the copy into its place, puts the
  build that was running before the promotion back and starts it. It says what
  it costs before it does it, and it means it: ANYTHING WRITTEN SINCE THE NEW
  APP STARTED IS LOST. That is what the copy is -- a picture of the database as
  it was before the rollout -- and it is why nothing rolls back by itself once
  the new app is serving.

  It never deletes a database: the database that was live keeps its rows under
  the `_failed_` name, and old copies are the owner's to remove by hand.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -WhatIf
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -WaitForJobs
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -Force
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -Resume
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -RollbackDatabase <copy-name>
    powershell -ExecutionPolicy Bypass -File ops\promote.ps1 -RollbackDatabase <copy-name> -StopApp
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
  [switch]$Resume,
  # Put a pre-rollout database copy back, by hand, and stop there. This is the
  # command the script prints when a promotion has gone wrong AFTER the new app
  # started taking writes -- the one case it refuses to undo by itself. It
  # promotes nothing, backs nothing up and touches no checkout.
  [string]$RollbackDatabase = "",
  # Only meaningful with -RollbackDatabase, and only for the case the script
  # cannot see for itself: it refuses to roll back while the paper is
  # answering on its port, and this is the operator saying "stop it for me".
  # Without it the app has to be stopped first, by hand.
  [switch]$StopApp
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
  <#
    WHICH DATABASE HOLDS WHAT, as soon as there is a copy to hold anything.

    A failed promotion leaves two or three databases where the operator is
    used to one, and the log is what they read at 2 AM. The names go in here,
    early and unconditionally, so they are in the log whether the failure was
    before the copy (nothing to say about a copy), after it (both names), or
    during the swap-back (the failed name as well).

    Set as script-scope variables by the flow below; guarded, because Die is
    reachable from the first line of this script.
  #>
  $dbNote = ""
  if ($dbName) {
    $dbNote = "the paper's database is $dbName"
    if ($dbCopy -and $dbTaken) { $dbNote += "; this promotion's pre-rollout copy is $dbCopy ($dbCopySize)" }
    elseif ($dbCopy) { $dbNote += "; this run's copy would have been $dbCopy and was never taken" }
    if ($dbFailed -and $dbSwapped) { $dbNote += "; what the failed rollout wrote is kept as $dbFailed" }
    elseif ($dbFailed) { $dbNote += "; $dbFailed is only used if the copy is swapped back" }
    Write-PromoteLog $log "databases: $dbNote"
  }
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
  <#
    The LAST line of a failed run's log: which database holds what.

    Log file only, through Write-PromoteLogFileOnly -- the command that brings
    the paper back is the last thing an operator SEES, and it has to stay
    that way. But the tail of the log is where somebody works out what state
    the machine is in, and "the paper's database is X, the copy is Y, the
    failed rollout's schema is Z" is the answer to the only question that
    matters when a promotion has stopped: is the paper's data where I think it
    is.
  #>
  $closing = "END. $msg"
  if ($dbNote) { $closing += " Databases: $dbNote." }
  $closing += " No database was deleted and no database was renamed except as logged above. The log for this run is $($log.Path)."
  Write-PromoteLogFileOnly $log $closing
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
  # NOT an inline `& powershell -File ...` here: a function's output is its
  # return value, and a native command whose output is captured is waited for
  # until every holder of its pipe has gone -- which includes the app it starts.
  # See Start-PromoteApp in ops\lib-promote.ps1 for the hang this replaced.
  return (Start-PromoteApp -Log $log -StartScript (Join-Path $ops "start-townreporter.ps1") `
      -OutDir (Join-Path $app "logs") -Port ([int]$port) -HealthSeconds (Get-PromoteHealthTimeoutSeconds))
}

<#
  Stop this install's app, and nothing else. Returns
  @{ Stopped = @('PID 123'); Foreign = '' }.

  Used from two places now -- step 4, and the failure path that has to stop
  whatever is serving the new build before it can put the database copy back --
  which is why it is a function rather than the block of code step 4 used to
  be. Both have to stop exactly one process: whatever holds THIS install's
  port, and only when it is this install's own node.exe.

  `Foreign` names a port holder that is not this app. The caller decides what
  to do about that; this function never touches it. On this machine the
  development copy, the live paper and every test are node.exe, so "stop
  whatever is on the port" is the one command that turns a bad promotion into
  an outage.
#>
function Stop-TheApp {
  $stopped = @()
  $foreign = ""
  $owners = @(Get-TownReporterPortOwner $port)
  foreach ($owner in $owners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.Name -ne 'node.exe' -or -not (Test-TownReporterServerProcess -Process $proc -App $app)) {
      $foreign = "PID $owner ($($proc.Name))"
      continue
    }
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    $stopped += "PID $owner"
  }
  if ($stopped.Count -gt 0) { Start-Sleep -Seconds 2 }
  return [pscustomobject]@{ Stopped = $stopped; Foreign = $foreign }
}

<#
  `-RollbackDatabase <copy>`: put a pre-rollout copy back by hand, and stop.

  This is the command the promotion prints when it has gone wrong AFTER the new
  app started serving, which is the one case it will not undo by itself: by
  then the new app has been taking writes, and the copy is a picture of the
  database from before those writes. So this path says what it is about to cost
  BEFORE it does anything, and the operator who runs it has already decided.

  It is deliberately independent of the promotion's own flow: no resume check,
  no backup, no checkout, no build. An operator reaching for this is usually
  mid-incident with a promotion that stopped half way, and "an earlier
  promotion did not finish" must not be what stands between them and the paper
  coming back.

  THE ORDER LIVES IN ops\lib-promote.ps1 (Invoke-PromoteDatabaseRollback), so
  that scripts\promote-step-runner.test.mjs can drive it with fakes: the port
  probe first, then the plan with the sizes, then -- only if the paper is not
  answering, or the operator passed -StopApp -- the swap. What is left here is
  the operator's own words and turning the answer into an exit code.
#>
function Invoke-PromoteRollback {
  param(
    [Parameter(Mandatory = $true)][string]$Copy,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [string]$AdminUrl = "",
    [switch]$StopApp
  )
  # NOT Add-PromoteStep. This path is not a promotion and must not look like
  # one in the log: Get-PromoteResumePoint reads the newest promote log to
  # decide where an interrupted run would carry on from, and a rollback's own
  # lines sitting in that grammar would hide the run that actually stopped half
  # way. The plain lines below are outside it on purpose.
  Write-PromoteLog $log "database rollback started: put $Copy back as $Database (this is not a promotion)"

  $result = Invoke-PromoteDatabaseRollback -Log $log -App $app -Port ([int]$port) `
    -TestThePort { Test-PromotePaperUp -Port ([int]$port) } `
    -StopTheApp { Stop-TheApp } `
    -StartTheApp { Start-TheApp } `
    -Copy $Copy -Database $Database -DatabaseUrl $DatabaseUrl -AdminUrl $AdminUrl `
    -StopApp:$StopApp -DryRun:$WhatIfPreference `
    -Announce {
      param($plan)
      Show ""
      Show "  Rolling the database back by hand" Yellow
      Show "  ------------------------------------------------------------" Yellow
      Show "  $plan" Yellow
      Show "  The paper will be serving $Copy, the copy taken before that rollout." Yellow
      Show "  ANYTHING WRITTEN SINCE THE NEW APP STARTED IS LOST. The copy is a" Yellow
      Show "  picture of the database from before those writes." Yellow
      Show ""
    }

  <#
    Refused before anything was read, planned, stopped or renamed: the paper was
    answering, and neither the operator nor this script had any business going
    further. A Die rather than a quiet exit, because the command did not do what
    it was asked to, and the sentence says what to do instead.
  #>
  if ($result.Refused) {
    Die $result.Failure '' "Stop the app first (a promote does that itself), or re-run this command with -StopApp to have it stop the app by PID for you. Nothing was changed."
  }
  <#
    -WhatIf gets the same respect here as everywhere else in this script. It
    matters more on this path than on the others: an operator who typed -WhatIf
    to see what the rollback WOULD do is one keystroke from losing a day's
    writing, and this is the only place in the script where the thing being
    undone cannot be redone.
  #>
  if ($result.DryRun) {
    Write-PromoteLog $log "database rollback: -WhatIf, so nothing was stopped, renamed or started. $($result.Plan)"
    Show "  -WhatIf: nothing was stopped, renamed or started." Yellow
    Show "  It would have: stopped the app on port $port, waited for every connection to"
    Show "  $Database to close, renamed $Database to $($result.Failed), renamed $Copy to"
    Show "  $Database, put the build from before the promotion back and started it."
    Show ""
    exit 0
  }

  $failed = $result.Failed
  if (-not $result.Swapped) {
    Die "The database was NOT rolled back. $($result.Failure)" '' "Read the log above, deal with whatever is still connected, then run this command again."
  }
  if ($result.PaperUp) {
    Say "the build from before the promotion is back, and the paper is answering on port $port"
  } else {
    Die "The database was rolled back, but the app did not answer on port $port afterwards." '' "Read logs\townreporter.log for why it did not start. The database the paper is serving is $Database; what was serving it before this rollback is kept as $failed."
  }

  Write-PromoteLog $log "database rollback ok: $Copy is now $Database; what the rollout left is kept as $failed"
  Clear-PromoteMarker -App $app
  Write-PromoteLog $log "done: the database is rolled back. The paper is up on $Database, and $failed holds what the failed rollout wrote."
  Show ""
  Show "  Rolled back. The paper is answering on port $port." Green
  Show "  The paper is serving $Database (the copy taken before that rollout)." Green
  Show "  What the rollout left behind is kept as $failed -- nothing was deleted." Green
  Show "  Remember anything written since that rollout started is gone: it was not in the copy." Yellow
  Show "  Log: $($log.Path)"
  Show ""
  exit 0
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

<#
  The hand rollback, and it comes FIRST -- before the unfinished-run check
  below, before the backup, before anything this script normally does.

  An operator runs this mid-incident: a promotion went wrong after the new app
  had started serving, and they have decided the writes since then are worth
  losing. Anything this script normally insists on first -- "an earlier
  promotion did not finish", "the checkout is dirty", "an editor has a job
  running" -- is a reason to wait, and waiting is the one thing that is not
  wanted here.
#>
if ($RollbackDatabase) {
  $rollbackUrl = Read-OpsEnvValue -EnvFile (Join-Path $app ".env") -Name 'DATABASE_URL'
  if (-not $rollbackUrl) { Die "No DATABASE_URL in .env, so there is no database to roll back." }
  $rollbackDatabase = (($rollbackUrl -split '/')[-1] -split '\?')[0].Trim()
  $rollbackAdmin = Read-OpsEnvValue -EnvFile (Join-Path $app ".env") -Name 'PROMOTE_ADMIN_DATABASE_URL'
  Write-PromoteLog $log "database rollback asked for: $RollbackDatabase (this install's database is $rollbackDatabase)"
  Invoke-PromoteRollback -Copy $RollbackDatabase -Database $rollbackDatabase -DatabaseUrl $rollbackUrl -AdminUrl $rollbackAdmin -StopApp:$StopApp
  exit 0
}

# --- 0. is there an unfinished run to pick up? ------------------------------
<#
  Read BEFORE anything destructive, and acted on before step 1, because the
  whole point is not to start over on top of a run that stopped half way with
  the paper down.

  The marker alone does not say enough: logs\promote-in-progress only records
  that a run did not finish. The log beside it records how far it got, so
  Get-PromoteResumePoint (ops\lib-promote.ps1) reads the newest one that is
  really a promotion and says which step to carry on from.

  AND NOT THIS RUN'S OWN. The log opened at the top of this script -- before
  anything could fail, so that a run which dies on its first check still leaves
  a file saying so -- is by now the newest promote-*.log in the directory and
  has nothing in it. Reading it back would answer "no step, no backup" every
  time, which is why -Resume could never resume anything. The path is passed so
  the lookup can leave it out.
#>
$resumePoint = Get-PromoteResumePoint -App $app -ExcludeLog $log.Path
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
# The last path segment, with any query string dropped -- the same rule
# ops\lib-promote-db.mjs derives the name by, so the two cannot disagree about
# which database is being backed up, copied and migrated.
$dbName = (($dbUrl -split '/')[-1] -split '\?')[0].Trim()

<#
  The database copy's own names, and the connection used to make it (unit PR2).

  $dbStamp is this run's stamp with the dash taken out of the log's
  `yyyyMMdd-HHmmss`, so the log, the copy and the failed-rollout database all
  name the same second of the same run -- reading the log and listing the
  databases on the server then shows an operator the same set of names.

  $dbAdminUrl is PROMOTE_ADMIN_DATABASE_URL when the install sets one, and
  DATABASE_URL otherwise. The first is for an install whose app role is
  deliberately not allowed to create databases: a promotion has to create one
  to copy the paper's, and the alternative would be handing the app's role
  CREATEDB for the rest of the year to use it for four seconds.
#>
$dbStamp = $log.Stamp -replace '-', ''
$dbAdminUrl = Read-OpsEnvValue -EnvFile (Join-Path $app ".env") -Name 'PROMOTE_ADMIN_DATABASE_URL'
$dbCopy = ""
$dbFailed = ""
$dbCopyFromPreviousRun = $false
# What Die's "which database holds what" line needs to be able to say. Set as
# the run goes: taken (a copy is on the server), size (a person's words for
# it), swapped (a failed rollout's schema has a name of its own now).
$dbTaken = $false
$dbCopySize = "size unknown"
$dbSwapped = $false

<#
  A resumed run and the copy.

  Two rules, and both are the reason this is not left to the step-skipping
  alone:

    1. NEVER A SECOND COPY. If the run being resumed got as far as taking one,
       that copy IS this promotion's pre-rollout copy. Taking another would be
       another four seconds of the whole cluster waiting on a checkpoint, and
       would leave two 570 MB databases behind instead of one.
    2. NEVER A COPY OLDER THAN THE LAST STOP. A copy is a picture of the
       database; one taken before the app went down is a picture of a database
       that was still being written to. The promotion cannot make one in that
       order -- dbcopy is after stop -- so a copy that fails this check did not
       come from where its name says it did, and the run stops rather than
       putting it back.

  The names themselves come out of the interrupted run's own log (the
  `promote-db:` line), which is also how the names of a copy that already
  exists survive a process that died holding them only in memory.
#>
if ($resumeAt -and $resumePoint) {
  $resumeRank = Get-PromoteStepRank $resumeAt
  if ($resumeRank -ge (Get-PromoteStepRank 'dbcopy')) {
    if (-not $resumePoint.Copy -or -not $resumePoint.Failed) {
      Die "The interrupted run's log does not say which database copy it took, so this run will not carry on from a step past that point." 'preflight' "Delete logs\promote-in-progress, then run this script again without -Resume. Nothing was changed and the paper was not touched."
    }
    <#
      ...and the copy has to have been TAKEN after the stop, which is a
      question about two times in the interrupted run's log: the stop's step
      line and the copy's step line. NOT the stamp inside the copy's name --
      that is the second the run STARTED, which is always before the stop by
      however long the backup took.
    #>
    if (-not (Test-PromoteCopyFreshness -CopyAt $resumePoint.CopyAt -StopAt $resumePoint.StopAt)) {
      Die "The interrupted run's log names the copy $($resumePoint.Copy), but does not show it being taken after the paper was stopped (stop at $($resumePoint.StopAt), copy step at $($resumePoint.CopyAt)), so putting it back could silently drop whatever the app was writing at the time." 'preflight' "Look at the databases on the server and delete anything you no longer want by hand, then delete logs\promote-in-progress and run this script again without -Resume. Nothing was changed and the paper was not touched."
    }
    <#
      The database must be the same one the interrupted run copied. .env is a
      file an operator can edit between two runs, and a copy of one database
      swapped over another is the worst thing this unit could do.
    #>
    if ($resumePoint.Database -and $resumePoint.Database -ne $dbName) {
      Die "The interrupted run copied the database $($resumePoint.Database), and DATABASE_URL now names $dbName. Refusing to carry on: putting one database's copy over another is how the wrong paper gets served." 'preflight' "Put DATABASE_URL back the way it was, or delete logs\promote-in-progress and run this script again without -Resume. Nothing was changed and the paper was not touched."
    }
    $dbCopy = $resumePoint.Copy
    $dbFailed = $resumePoint.Failed
    $dbCopyFromPreviousRun = $true

    $state = Invoke-PromoteDatabaseState -Log $log -App $app -Database $resumePoint.Database -Copy $dbCopy -Failed $dbFailed -Stamp $dbStamp -DatabaseUrl $dbUrl -AdminUrl $dbAdminUrl
    $copyExists = $false
    if ($state.Ok -and $state.Data.databases.$dbCopy) { $copyExists = [bool]$state.Data.databases.$dbCopy.exists }
    $copySize = 0
    if ($state.Ok -and $state.Data.databases.$dbCopy) { $copySize = $state.Data.databases.$dbCopy.sizeBytes }
    if (-not $state.Ok) {
      Write-PromoteLog $log "could not read the database state: $($state.Failure)"
    }
    if ($copyExists) {
      $dbTaken = $true
      $dbCopySize = Format-PromoteDbSize $copySize
      Write-PromoteLog $log "the database copy this promotion took is on the server: $dbCopy ($dbCopySize)"
      Say "the copy the interrupted run took is still on the server: $dbCopy ($dbCopySize)"
    } else {
      Write-PromoteLog $log "the database copy this promotion took is NOT on the server: $dbCopy"
      Say "the copy the interrupted run took is NOT on the server: $dbCopy" Yellow
      if ($resumeAt -ne 'dbcopy') {
        Die "The copy $dbCopy is not on the server, so this run cannot put the database back after a failure and will not carry on past that step." 'preflight' "Start over: delete logs\promote-in-progress, then run this script again without -Resume. Nothing was changed and the paper was not touched."
      }
      # Resuming exactly AT the copy step with no copy on the server is the one
      # case where taking it is not a second copy: the interrupted run died
      # before PostgreSQL finished it. The names stay the interrupted run's, so
      # its log and the database list agree.
      $dbCopyFromPreviousRun = $false
    }
  }
}

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
  <#
    A resumed run that already passed this step still needs the copy's name:
    everything after `dbcopy` names it in the log and in the sentence printed
    to the operator. It came from the interrupted run's log when that run got
    as far as taking a copy (the resume block above); when it did not, this run
    will take the copy with its OWN stamp, and the names are derived by the
    same library that will validate them.
  #>
  if (-not $dbCopy) {
    $named = Invoke-PromoteDatabaseNames -Log $log -App $app -DatabaseUrl $dbUrl -Stamp $dbStamp
    if (-not $named.Ok) { Die "Could not work out the database copy's name: $($named.Failure)" 'preflight' "Check DATABASE_URL in the install's .env, then run this script again. Nothing was changed and the paper was not touched." }
    $dbName = $named.Data.database
    $dbCopy = $named.Data.copy
    $dbFailed = $named.Data.failed
    Write-PromoteLog $log "this run's database: $dbName; its copy will be $dbCopy if one has to be taken"
  }
} else {
  Add-PromoteStep -Log $log -Name 'preflight' -Detail "checkout, fast-forward, the editor's jobs, and the database"
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

  <#
    The database, asked BEFORE the app is stopped.

    Everything here can fail without consequence, which is exactly what the
    preflight step is for. By the time the copy runs the paper is already down,
    and finding out then that the role cannot create a database, or that the
    disk has no room for 570 MB, would be the first real promotion's mistake
    all over again -- the paper down while somebody sorts out something that
    was knowable an hour earlier.

    Nothing was changed by any of it: the library only reads.
  #>
  $dbPre = Invoke-PromoteDatabasePreflight -Log $log -App $app -DatabaseUrl $dbUrl -Stamp $dbStamp -AdminUrl $dbAdminUrl
  if (-not $dbPre.Ok) {
    Die "$($dbPre.Failure)" 'preflight' "Fix what the sentence above names, then run this script again. The paper was never stopped."
  }
  if ($dbPre.Data.database -ne $dbName) {
    Die "The database this run would copy ($($dbPre.Data.database)) is not the one .env names ($dbName). Refusing rather than copying one database and migrating another." 'preflight' "Check DATABASE_URL in the install's .env, then run this script again."
  }
  $dbCopy = $dbPre.Data.copy
  $dbFailed = $dbPre.Data.failed
  $dbSize = Format-PromoteDbSize $dbPre.Data.sizeBytes
  $dbFree = Format-PromoteDbSize $dbPre.Data.freeBytes
  Say "database: $dbName ($dbSize), copy will be $dbCopy"
  Write-PromoteLog $log "database: $dbName is $dbSize; the copy will be $dbCopy and the failed-rollout database $dbFailed"
  Write-PromoteLog $log "database: PostgreSQL keeps its data in $($dbPre.Data.dataDirectory), which has $dbFree free; this copy needs $(Format-PromoteDbSize $dbPre.Data.requiredBytes)"
  Write-PromoteLog $log "database: the role is $($dbPre.Data.role) (may create databases: $($dbPre.Data.roleMayCreate))"
  foreach ($note in @($dbPre.Data.notes)) { Write-PromoteLog $log "database: note: $note" }
  Complete-PromoteStep -Log $log -Name 'preflight' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "no uncommitted work, fast-forward to $($target.Substring(0,7)) is possible, $dbName can be copied"
}

<#
  The one line every later step and every later run reads the names out of.

  Written outside the branch above so a resumed run writes it too: a run that
  resumed, failed and left a marker must leave the same account of which
  database it copied as a run that did everything itself.
#>
Write-PromoteLog $log "promote-db: database=$dbName copy=$dbCopy failed=$dbFailed"

<#
  What happens when the rollout fails and this run has a copy of the database.

  ONE RULE, NO EXCEPTIONS: every failure after the copy runs this. The
  dependency install, the fast-forward, the build (which is the migration), and
  a new build that never answers. At 2 AM a rule with exceptions is a rule that
  gets applied wrongly, and the cost of applying it when it was not strictly
  needed is a database renamed aside -- the rows are all still there, nothing is
  deleted, and the log says which name holds what.

  The order is the whole point and it cannot be rearranged: stop whatever is
  serving the new build, wait for its connections to close, put the copy back,
  and only THEN put the old build back and start it. Starting the old build
  first would reconnect to the half-migrated database and hold it open, and the
  swap would then refuse -- correctly, and uselessly.

  The order of the two halves of the sentence matters too: which database the
  paper is serving now, then where the failed rollout's schema went.
#>
function Invoke-PromoteRolloutFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Why,
    [ValidateSet('none', 'maybe', 'yes')][string]$MigrationsRan = 'none',
    [string]$BuildOutput = "",
    [string]$Previous = "",
    [bool]$RestoreBuild = $true
  )
  $copy = $dbCopy
  if ($WhatIfPreference) { $copy = "" }   # -WhatIf never took one
  $result = Invoke-PromoteFailedRollout -Log $log -App $app -StopTheApp { Stop-TheApp } -StartTheApp { Start-TheApp } `
    -Database $dbName -Copy $copy -Failed $dbFailed -Stamp $dbStamp -DatabaseUrl $dbUrl -AdminUrl $dbAdminUrl `
    -Previous $Previous -MigrationsRan $MigrationsRan -BuildOutput $BuildOutput -Why $Why -RestoreBuild $RestoreBuild
  # Script scope, so the Die that follows this call can say in the log whether
  # the failed rollout's schema has a name of its own.
  $script:dbSwapped = [bool]$result.Swapped
  return $result
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

    # Stop-TheApp (above) does the port-owner check and the kill; the failure
    # path uses the same function, so the rule about what may be stopped -- this
    # install's own node.exe on this install's port, and nothing else -- is
    # written down once. Get-TownReporterPortOwner (lib-port.ps1) is the
    # address-aware check: an unfiltered one would also catch some other
    # program's IPv6-only listener on the same port number and wrongly refuse
    # to promote, or refuse to touch nothing at all.
    $stopResult = Stop-TheApp
    if ($stopResult.Foreign) {
      Die "Port $port is held by $($stopResult.Foreign), which is not this app. Not touching it." 'stop' "Find out what owns port $port and stop it, then run this script again."
    }
    $stopped = $stopResult.Stopped
    foreach ($who in $stopped) { Say "stopping the app, $who" }
    # Postgres is deliberately left running: one cluster serves the live paper,
    # the development copy and every scratch database on this machine.
  }
  $stopDetail = if ($stopped.Count -gt 0) { "stopped $($stopped -join ', ')" } else { "nothing was listening on $port" }
  Complete-PromoteStep -Log $log -Name 'stop' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail $stopDetail
}

# --- 4b. copy the database, with nobody connected to it ---------------------
<#
  The copy, and it can only happen here.

  PostgreSQL refuses `CREATE DATABASE ... TEMPLATE` while anybody is connected
  to the database being copied, and the paper IS that connection -- which is
  why this step sits after the stop and before everything that can change the
  database. It is deliberately before `ff` as well as before `build`: the copy
  has to be a picture of the database as it was BEFORE this promotion touched
  anything at all.

  The wait is short (Get-PromoteDbWaitSeconds), and the step REFUSES rather
  than terminating anything: on this machine the sessions that can hold this
  database open belong to the live paper, the development copy and thirty test
  databases, and none of them is this script's to end.

  If the copy cannot be taken the promotion STOPS here rather than continuing
  without one. A rollout with no way back is exactly what this unit was written
  to stop doing; the paper is down and the command that brings it back is the
  last line printed.
#>
if (Skip-Step 'dbcopy') {
  # A resumed run past this point took its copy in the run before. The names --
  # and whether the copy is really on the server -- were checked and logged at
  # the top of this run.
  $dbTaken = $true
  Write-PromoteLog $log "step=dbcopy skipped -- the previous run already took the copy $dbCopy"
} elseif ($dbCopyFromPreviousRun) {
  # Resuming exactly AT this step, with the interrupted run's copy already on
  # the server: taking a second one would be another checkpoint on a shared
  # cluster and another 570 MB kept forever. The first one IS this promotion's
  # pre-rollout copy -- it was taken after the same stop.
  Add-PromoteStep -Log $log -Name 'dbcopy' -Detail "copy $dbName to $dbCopy (already taken by the interrupted run)"
  Write-PromoteLog $log "step=dbcopy not taken again: $dbCopy is already on the server from the interrupted run"
  Complete-PromoteStep -Log $log -Name 'dbcopy' -Seconds 0 -Detail "reusing $dbCopy from the interrupted run"
  $dbTaken = $true
} else {
  Add-PromoteStep -Log $log -Name 'dbcopy' -Detail "copy $dbName to $dbCopy"
  $t0 = Get-Date
  if ($PSCmdlet.ShouldProcess($dbName, "copy to $dbCopy with CREATE DATABASE ... TEMPLATE")) {
    Say "copying the database (this forces a checkpoint, so every database on the server waits for it)"
    $copied = Invoke-PromoteDatabaseCopy -Log $log -App $app -Database $dbName -Copy $dbCopy -Failed $dbFailed -Stamp $dbStamp -DatabaseUrl $dbUrl -AdminUrl $dbAdminUrl
    if (-not $copied.Ok) {
      Fail-PromoteStep -Log $log -Name 'dbcopy' -Detail $copied.Failure
      Die "$($copied.Failure) The paper is still down and the database was not copied, so nothing has been built or migrated." 'dbcopy' "Read the sentence above and the log at $($copied.OutFile), fix what it names, then run this script again. The backup is at $backupNote"
    }
    $copySize = Format-PromoteDbSize $copied.Data.sizeBytes
    $dbTaken = $true
    $dbCopySize = $copySize
    Say "copy: $dbCopy ($copySize, $([math]::Round([double]$copied.Data.seconds,1))s)"
    Complete-PromoteStep -Log $log -Name 'dbcopy' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail "copied $dbName -> $dbCopy ($copySize)"
    Write-PromoteLog $log "the copy is $dbCopy ($copySize). Nothing will delete it: after a failed rollout it is put back, and after a successful one it is kept until you remove it by hand."
  } else {
    Complete-PromoteStep -Log $log -Name 'dbcopy' -Seconds 0 -Detail "skipped (-WhatIf)"
  }
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
        # Nothing has touched .output -- this step is before the build -- so
        # -RestoreBuild $false: what is on disk IS the build that was serving,
        # and putting .output-previous (an EARLIER promotion's build) over it
        # would replace a working build with an older one.
        Say "the fast-forward failed; bringing the paper back on the build it already had"
        $recovered = Invoke-PromoteRolloutFailure -Why "the fast-forward could not run" -RestoreBuild $false
        Die "Could not fast-forward. This checkout has diverged from origin/main. $($recovered.Failure)" 'ff' "Reconcile the checkout with origin/main by hand, then run this script again. The backup is at $backupNote"
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

# --- 6. dependencies, unless node_modules is already built from this lockfile
<#
  WHAT WAS node_modules INSTALLED FROM?

  Not "did this run move the lockfile". The before/after pair above answers
  that, and on the first rollout it answers it wrongly: the live checkout is
  fast-forwarded BY HAND before the promotion -- it has to be, it is still
  running the old promote script -- so `before` is already the new lockfile,
  the two are equal, and the promotion used to skip `npm ci` and build a
  release on the previous node_modules. Nothing failed; the release was just
  built against the wrong dependency tree.

  So the decider is the marker `npm ci` leaves behind when it succeeds:
  node_modules\.promote-lock-hash, holding the SHA256 of the lockfile it
  installed from. The install runs unless that file is there and holds exactly
  the hash of the lockfile on disk. See Test-PromoteNeedsInstall in
  ops\lib-promote.ps1 -- including why a missing marker means install.
#>
$install = Test-PromoteNeedsInstall -App $app -LockHash $lockAfter -ResumeAt "$resumeAt"
$mustInstall = $install.Needed
Write-PromoteLog $log "the lockfile hash before this run's fast-forward was '$lockBefore' and after it '$lockAfter'"
Write-PromoteLog $log "node_modules was last installed from '$(Get-PromoteInstalledLockHash -App $app)'; install needed: $mustInstall ($($install.Reason))"
if (Skip-Step 'deps') {
  # nothing to do
} else {
  Add-PromoteStep -Log $log -Name 'deps' -Detail "npm ci"
  $t0 = Get-Date
  if (-not $mustInstall) {
    Say "not installing: $($install.Reason)"
    Complete-PromoteStep -Log $log -Name 'deps' -Seconds ((Get-Date) - $t0).TotalSeconds -Detail $install.Reason
  } elseif ($PSCmdlet.ShouldProcess("dependencies", "npm ci")) {
    Say "installing dependencies: $($install.Reason)"
    $r = Invoke-PromoteChild -Log $log -Step 'deps' -Command 'npm ci'
    if ($r.ExitCode -ne 0) {
      $code = if ($r.TimedOut) {
        "it ran past its $(Get-PromoteChildTimeoutSeconds -Step 'deps')-second limit and was stopped"
      } elseif ($null -eq $r.ExitCode) {
        "it did not reach its end, so there is no exit code"
      } else {
        "exit $($r.ExitCode)"
      }
      # Again -RestoreBuild $false: the build has not run yet, so .output is
      # still the build that was serving. Its output is where a failed install
      # explains itself, and it is named here because the recovery below writes
      # its own lines into the log after this one.
      Say "npm ci did not succeed; putting the database back and bringing the paper up"
      $recovered = Invoke-PromoteRolloutFailure -Why "npm ci did not succeed ($code)" -RestoreBuild $false
      Die "npm ci did not succeed ($code). Its output is in $($r.OutFile). $($recovered.Failure)" 'deps' "Read that file, fix the install, then run this script again. The backup is at $backupNote"
    }
    <#
      ONLY HERE, after exit 0, and nowhere else. The marker is the record of a
      finished install; writing it anywhere a failure can reach would turn
      "node_modules is built from this lockfile" into a guess, and the whole
      point of it is that it is not a guess. npm ci deletes node_modules on
      the way in, so a marker that survived means the install it belongs to
      completed.
    #>
    if (Set-PromoteInstalledLockHash -App $app -Hash $lockAfter) {
      Write-PromoteLog $log "recorded that node_modules was installed from lockfile $lockAfter"
    } else {
      Write-PromoteLog $log "could not record what node_modules was installed from; the next promotion will install again rather than guess"
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
    <#
      -Recover: this is the failure path the unit exists for. `npm run build`
      ends in db:migrate, so a build that dies inside the migration leaves a
      database that has moved on -- and the old build cannot serve it. The
      scriptblock is handed how far the build's own output says the migration
      got, so the sentence it returns can tell the operator whether the
      database may have been touched at all.

      Invoke-PromoteBuild runs the child and decides this step failed; what to
      DO about it lives here, because it needs the app stop, the port and the
      copy's name, none of which a library about promotion steps should know.
    #>
    $built = Invoke-PromoteBuild -Log $log -App $app -Command 'npm run build' -StartTheApp { Start-TheApp } -Previous $previousBuild -Recover {
      param($migrations, $output, $previous)
      Invoke-PromoteRolloutFailure -Why "the build did not succeed" -MigrationsRan $migrations -BuildOutput $output -Previous $previous
    }
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
        `npm run db:migrate`. So the database IS moved on, which is exactly the
        case the copy exists for, and the recovery puts it back before the old
        build goes on.

        It is still the OLD BUILD that is put back: the new one exists and is
        simply not serving, and a paper on yesterday's code beats a paper on
        nothing. The sentence the recovery returns says both things -- which
        database the paper is serving and where the failed rollout's schema
        went -- and the message below repeats it so the operator sees it without
        opening the log.
      #>
      $recovered = Invoke-PromoteRolloutFailure -Why "the new build did not answer on port $port" -MigrationsRan 'yes' -BuildOutput $buildOutputFile -Previous $previousBuild
      if ($recovered.PaperUp) {
        Say $recovered.Failure
        Die "The new build did not answer on port $port. $($recovered.Failure)" 'start' "Read logs\townreporter.log for why the new build did not start. The backup is at $backupNote"
      }
      Die "The new build did not answer on port $port, and the paper could not be brought back. $($recovered.Failure)" 'start' "Read logs\townreporter.log for why it did not start. The backup is at $backupNote"
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

<#
  Past this point the new app has been serving and taking writes, so this
  script WILL NOT put the copy back by itself: the copy is a picture of the
  database from before those writes, and an automatic rollback here would
  silently throw away an editor's work.

  What it does instead is print the exact command that does it, and say what
  running it costs. That is the whole of requirement five of this unit: the
  decision moves to the person who knows whether anything was written yet.

  $rollbackCommand is empty when this run has no copy (a -WhatIf run, or a
  failure before the copy was taken), and then there is nothing to offer.
#>
$rollbackCommand = ""
if ($dbCopy) { $rollbackCommand = Get-PromoteRollbackCommand -App $app -Copy $dbCopy }

function Show-RollbackOffer([string]$Command, [string]$Copy) {
  if (-not $Command) { return }
  Show ""
  Show "  To put the database back by hand, one command:" Yellow
  Show "  $Command" Yellow
  Show "  It stops the app, puts $Copy back as the paper's database, puts the build" Yellow
  Show "  from before the promotion back and starts it. ANYTHING WRITTEN SINCE THE" Yellow
  Show "  NEW APP STARTED IS LOST. The copy is a picture from before those writes." Yellow
  Write-PromoteLog $log "to put the database back by hand (this loses everything written since the new app started): $Command"
}

if ($fail.Count -gt 0) {
  $fail | ForEach-Object { Show "  [FAIL] $_" Yellow }
  Show-RollbackOffer $rollbackCommand $dbCopy
  Die "Promotion finished but the paper is not healthy. The backup is at $backupNote" '' "The paper is up but something about it is wrong -- read the checks above and logs\townreporter.log. The backup is at $backupNote"
}
Write-PromoteLog $log "done: promoted. The paper is up and the archive is intact."
Write-PromoteLog $log "backup kept at $backupNote"
if ($dbCopy) {
  Write-PromoteLog $log "the database copy is kept at $dbCopy. Nothing deletes it; remove it by hand when you are sure this release is good."
  Show "  Database copy kept at $dbCopy (nothing deletes it automatically)."
  Write-PromoteLog $log "to put the database back by hand (this loses everything written since the new app started): $rollbackCommand"
}
Show "  Promoted. The paper is up and the archive is intact." Green
Show "  Backup kept at $backupNote"
if ($dbCopy) {
  Show ""
  Show "  If this release turns out wrong, the database half is undone with one command:"
  Show "  $rollbackCommand"
  Show "  It loses everything written since the new app started, and it keeps what it"
  Show "  replaces as ${dbName}_failed_<date><time> -- nothing is ever deleted."
}
Show "  Log: $($log.Path)"
Show ""
