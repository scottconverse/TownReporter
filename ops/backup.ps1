<#
  Take a backup now, by hand. And with -Offsite, just do the copy and the
  cleanup without a new dump.

  Two reasons this exists rather than telling the operator to run promote.ps1:

    * A backup and a promotion are different decisions. The nightly run in
      watchdog.ps1 is the routine one, but the owner asked for a button, and
      "back the paper up right now, before I touch something" is a thing you
      want to be able to do without that action also rebuilding and restarting
      the paper.
    * After a night where the copy to D: failed -- drive unplugged, out of
      room, whatever -- the dump itself is fine and there is nothing wrong with
      the local folder. -Offsite retries just the copying and the pruning, which
      is the part that failed, and every local backup not yet on the other drive
      is copied. That is also the first-run behaviour: with 61 local backups and
      an empty D:, a plain run copies all of them before deleting anything.

  It runs the same function promote.ps1 runs, in the same order, with the same
  lock. There is no second code path here on purpose: a manual run that pruned
  differently from the nightly one would be a bug nobody would find until the
  day it mattered.

  The owner's rule since 2026-10-25: "Keep 3 days of backups. No more. Delete
  the rest. and keep them on D: not C:". So:

    * C: (this machine) keeps nothing once a backup is safe on D:. Each local
      backup is deleted from C: only after its D: copy is proven identical --
      same length AND same SHA256. One that does not verify stays on C:.
    * D: keeps the newest backup of each of the 3 newest days that have a
      backup (the day is read from the file name), and the rest of the dated
      series there is deleted. The newest backup is never deleted.
    * One-off safety copies (hand-named .sql/.dump files, old folders) are
      deleted from C: once verified on D:, and from D: after 3 days there.
    * It never deletes anything, on either drive, if the offsite drive is
      missing, is not writable, has less than 100 GB free, or is the local
      folder under another name. The backup still runs and stays on C:.
    * It takes the lock, so it cannot collide with the nightly run or a
      promotion. Unlike promote.ps1 it does not wait for the lock: this is an
      operator action, and "another backup is running, try again in a minute"
      is the right answer rather than a silent stall.

  Exit 0 when the backup and the copy are both good. Exit 1 with a plain
  sentence when they are not, so the Control page's button can show it.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\backup.ps1
    powershell -ExecutionPolicy Bypass -File ops\backup.ps1 -Offsite
    powershell -ExecutionPolicy Bypass -File ops\backup.ps1 -KeepDays 5
    powershell -ExecutionPolicy Bypass -File ops\backup.ps1 -Force
#>
[CmdletBinding()]
param(
  # Skip the dump and only do the copy to the offsite drive and the pruning.
  # This is the retry path after a failed copy, and it is also what the first
  # run on a machine with an existing folder of backups wants.
  [switch]$Offsite,
  # Take a dump even when the "after 2 AM and older than 20 hours" rule says
  # one is not due. The nightly run applies that rule; a person asking has
  # already decided.
  [switch]$Force,
  # How many of the newest backups to leave on this machine (C:) even after
  # they are verified on D:. The owner's number is none: "keep them on D:
  # not C:".
  [int]$Keep = 0,
  # How many days of backups D: keeps: the newest backup of each of the
  # KeepDays newest days that have one. The owner's number is three.
  [int]$KeepDays = 3,
  # Refuse to copy onto an offsite drive with less free space than this. The
  # owner's drive is 8 TB half empty, so 100 GB is room.
  [int]$MinFreeGb = 100,
  # Where to put the backup. Defaults to the app folder's sibling, which is
  # what promote.ps1 has always used. For the test harness.
  [string]$BackupDir,
  # The offsite folder. Default comes from BACKUP_OFFSITE_DIR in .env, which
  # defaults to D:\TownReporter-backups.
  [string]$OffsiteDir,
  # Postgres port. 5433 is the live cluster; the tests use another.
  [int]$PgPort = 5433
)

$ErrorActionPreference = "Stop"
$ops = $PSScriptRoot
$app = Split-Path -Parent $ops
. (Join-Path $ops "lib-backup.ps1")
. (Join-Path $ops "lib-alert.ps1")

function Say($msg) { Write-Host "  $msg" }

Write-Host ""
if ($Offsite) { Write-Host "  TownReporter backup: copy to the offsite drive and clean up" }
else { Write-Host "  TownReporter backup" }
Write-Host "  ------------------------------------------------------------"

$logFile = Join-Path $app "logs\backup.log"
$run = Invoke-TownReporterBackupRun `
  -App $app `
  -BackupDir $BackupDir `
  -OffsiteDir $OffsiteDir `
  -LogFile $logFile `
  -PgPort $PgPort `
  -Keep $Keep `
  -KeepDays $KeepDays `
  -MinFreeGb $MinFreeGb `
  -Offsite:$Offsite `
  -Force:$Force

foreach ($line in $run.Lines) { Say $line }

<#
  Report it the same way whichever way it went, and evaluate the alert
  conditions this run actually knows about -- the stale-backup one and the two
  offsite ones. The paper's own conditions are not passed, so this can neither
  raise nor clear them; the watchdog owns those, and a backup run that cleared
  a "the paper is down" alert it never checked would be the worst kind of bug.

  The three conditions come from the library, which is also where the watchdog
  gets them: one definition, so a button press and a nightly run cannot report
  the same drive two different ways.

  Assigned straight, not wrapped in @(): that function hands back an array and
  @() would make it one item that IS an array. See the note on it in
  lib-backup.ps1.
#>
$conditions = Get-TownReporterBackupAlertConditions -App $app -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb -Now (Get-Date)
$alerts = Invoke-TownReporterAlertCheck -App $app -Conditions $conditions -Now (Get-Date)
foreach ($e in $alerts.Events) {
  if ($e.Event -eq 'started') { Say "ALERT: $($e.Alert.Message) -- $($e.Alert.Detail)" }
  else { Say "cleared: $($e.Alert.Message)" }
}

Write-Host ""
if ($run.Skipped) {
  Write-Host "  No backup taken: $($run.Reason)" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}
if ($run.DumpOk -eq $false) {
  Write-Host "  The backup FAILED: $($run.Reason)" -ForegroundColor Yellow
  Write-Host "  No backup was deleted. The part of a dump pg_dump did write was not a backup:" -ForegroundColor Yellow
  Write-Host "  its size and last 2 KB are in the log, and the file itself was deleted." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}
if (-not $run.Ok) {
  Write-Host "  The backup is on this machine, but: $($run.Reason)" -ForegroundColor Yellow
  Write-Host "  Nothing that is not safe on D: was deleted. Fix the above and re-run with -Offsite." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

if ($run.DumpOk -ne $true) {
  # Not a failure: -Offsite, or the 2 AM / 20 hour rule turned the dump away.
  $why = if ($Offsite) { 'this run was asked for the copy and the cleanup only (-Offsite)' }
    elseif ($run.State.skippedReason) { $run.State.skippedReason }
    else { 'no dump was attempted' }
  Write-Host "  No new dump was taken: $why" -ForegroundColor Yellow
  Write-Host "  The copy to the offsite drive and the cleanup still ran; use -Force to dump anyway."
  Write-Host ""
  exit 0
}

$count = $run.State.localCount
$newestAt = if ($run.State.newestAt) { $run.State.newestAt } else { $run.State.localNewestAt }
$newest = if ($newestAt) { ([datetime]::Parse($newestAt)).ToLocalTime().ToString('h:mm tt') } else { 'unknown' }
$where = if ($run.State.newestWhere -eq 'offsite') { 'on the offsite drive' } elseif ($run.State.newestWhere -eq 'local') { 'on this machine' } else { '' }
Write-Host "  Backed up and copied to the offsite drive." -ForegroundColor Green
Write-Host "  Newest backup: $newest, $where. $($run.State.offsiteCount) on the offsite drive (the $KeepDays-day keep); $count still on this machine."
if ($run.State.pruneBlocked) {
  Write-Host "  Nothing was deleted: $($run.State.pruneBlocked)" -ForegroundColor Yellow
}
Write-Host ""
exit 0
