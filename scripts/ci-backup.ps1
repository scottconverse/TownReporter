<#
  The proof that the backups are what the owner asked for: the newest three on
  the system disk, all of them on D:, and an alert when any of that stops being
  true.

  Written after 2026-09-25, when a backup was a side effect of a promotion:
  promote.ps1 was the only file in the tree that ran pg_dump, none of the seven
  scheduled tasks ran one, and the folder held 61 files and 12.5 GB with nothing
  pruned and nothing off the system drive.

  This harness runs the real functions -- ops\lib-backup.ps1 and ops\lib-alert.ps1,
  the exact code promote.ps1, the watchdog's nightly run and the Control page's
  button all run -- against fake backup folders in a temp directory:

    * a complete dump is a backup and a truncated one is not: cut mid-line, cut
      at a line boundary, missing its closing marker, closing marker that does
      not match its opening one, and too small
    * six local backups and an empty D: end with all six on D: and exactly the
      newest three on C:, and nothing ever leaves D:
    * a local file that is not a complete dump stops the copy AND the prune.
      Nothing is deleted, and the run says which file and why
    * every other .sql and .dump in the local folder -- the hand-named safety
      copies -- is copied to <offsite>\other-safety-copies\ with the same
      .partial + size + SHA256 + rename discipline, is skipped when it is
      already there, is never touched by the keep-three prune on either side,
      and a file that is not one (.incomplete, .partial, anything else) is not
      copied at all; a safety copy that cannot be copied is reported as a
      failure of the run without stopping the series copy
    * a copy that cannot be verified deletes nothing
    * a missing D:, an unwritable D: and a D: short of room each delete nothing
      and each raise their own alert
    * an alert fires once when it starts and once when it clears, and a run that
      was not asked about the paper cannot clear a paper-down alert
    * the "after 2 AM and older than 20 hours" rule, on a fake clock, both as
      the rule itself and through a whole run
    * a dump that fails, or that fails the completeness check, is not left
      wearing a backup's name, and stops the run
    * the nightly lock: two backups never run at once, a run can wait for one
      that is in flight, and a stale lock from a killed run is taken over
    * the daily-scan rule, on a fake clock and a fake scan row
    * the three backup conditions the nightly run and the button share -- the
      30-hour rule, the copy verdict and the room left on D: -- reported the
      same way for a caller that wraps the call in @() and one that does not
    * the phone push is off until ALERT_NTFY_TOPIC is set: with no topic,
      nothing is sent anywhere

  NO DATABASE IS TOUCHED HERE, on any port. Every dump is a script block that
  writes a file (the -DumpCommand seam on New-TownReporterBackup), so this is
  safe on the machine that serves the paper and it is what CI runs. The one
  thing that is therefore NOT proven here is pg_dump itself: the real call was
  proven by hand on 2026-09-25 against a throwaway cluster on port 55432, and
  the file layout the completeness check keys on -- pg_dump 18.6's \restrict /
  \unrestrict pair, and the older "-- PostgreSQL database dump complete" trailer
  -- is what the fake dumps below are copied from.

  Run:
    powershell -ExecutionPolicy Bypass -File scripts\ci-backup.ps1
    powershell -ExecutionPolicy Bypass -File scripts\ci-backup.ps1 -Keep

  Exit 0 when every check passed. Anything else prints FAIL lines and exits 1,
  and the temp directory is left behind with -Keep.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.
#>
[CmdletBinding()]
param(
  [string]$WorkDir,
  [switch]$Keep
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot "ops\lib-backup.ps1")
. (Join-Path $repoRoot "ops\lib-alert.ps1")

$failures = New-Object System.Collections.ArrayList
function Check {
  param([string]$What, [bool]$Ok, [string]$Detail = "")
  if ($Ok) {
    Write-Host "  ok    $What"
  } else {
    Write-Host "  FAIL  $What"
    if ($Detail) { Write-Host "        $Detail" }
    [void]$failures.Add($What)
  }
}

function Read-Log {
  param([string]$Log)
  if (-not (Test-Path -LiteralPath $Log)) { return "" }
  return (Get-Content -Raw -LiteralPath $Log -ErrorAction SilentlyContinue)
}

# Every notification this harness sees, in order. Both libraries take a -Notify
# script block for exactly this: the fire-once and clear-once rule is observable
# without a desktop or a network, and no test here can reach the internet.
$script:events = New-Object System.Collections.ArrayList
$notify = { param($Event, $Alert) [void]$script:events.Add([pscustomobject]@{ Event = $Event; Id = $Alert.Id; Message = $Alert.Message; Detail = $Alert.Detail }) }
function Count-Events {
  param([string]$Event, [string]$Id)
  return @($script:events | Where-Object { $_.Event -eq $Event -and $_.Id -eq $Id }).Count
}

$temp = $WorkDir
if (-not $temp) {
  $temp = Join-Path ([IO.Path]::GetTempPath()) ("backup-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
}
New-Item -ItemType Directory -Force -Path $temp | Out-Null

Write-Host ""
Write-Host "  Backups and alerts, proven without a database"
Write-Host "  ---------------------------------------------"
Write-Host "  working in $temp"
Write-Host ""

# ---------------------------------------------------------------------------
# The fake world. Every section starts from a fresh one so a section that
# deliberately breaks something cannot leak into the next.
# ---------------------------------------------------------------------------
function Reset-World {
  param([string]$Tag)
  $script:world = Join-Path $temp ("w-" + $Tag)
  if (Test-Path -LiteralPath $script:world) { Remove-Item -LiteralPath $script:world -Recurse -Force }
  $script:app = Join-Path $script:world "app"
  $script:offsite = Join-Path $script:world "D"
  $script:backupDir = Join-Path $script:world "townreporter-backups"
  New-Item -ItemType Directory -Force -Path (Join-Path $script:app "logs") | Out-Null
  New-Item -ItemType Directory -Force -Path $script:backupDir | Out-Null
  New-Item -ItemType Directory -Force -Path $script:offsite | Out-Null
  $script:log = Join-Path $script:app "logs\backup.log"
  $script:state = Join-Path $script:app "logs\backup-state.json"
  $script:lock = Join-Path $script:app "logs\backup.lock"
  Set-Content -LiteralPath (Join-Path $script:app ".env") -Encoding ASCII -Value @(
    "DATABASE_URL=postgres://postgres@127.0.0.1:5433/townreporter",
    ("BACKUP_OFFSITE_DIR=" + $script:offsite)
  )
}

<#
  A fake dump, laid out the way pg_dump 18.6 lays one out: a head with
  \restrict <token>, a body, and the tail measured on this machine --

    --
    -- PostgreSQL database dump complete
    --
    (blank)
    \unrestrict <the same token>
    (blank)

  About 130 KB by default, which is over the 100000-byte floor the real check
  uses, so a fake dump is accepted or refused for the reason under test rather
  than for its size.
#>
function New-FakeDumpText {
  param(
    [string]$Token = 'HARNESStokenHARNESStokenHARNESStokenHARNESStokenHARNESS',
    # A different closing marker than the opening one, for the "this file is not
    # one whole dump" case.
    [string]$TailToken,
    [int]$PadLines = 1600
  )
  if (-not $TailToken) { $TailToken = $Token }
  $head = @(
    '--',
    '-- PostgreSQL database dump',
    '--',
    '',
    "\restrict $Token",
    ''
  ) -join "`r`n"
  $pad = ('-- ' + ('x' * 74) + "`r`n") * $PadLines
  $tail = @(
    '',
    '--',
    '-- PostgreSQL database dump complete',
    '--',
    '',
    "\unrestrict $TailToken",
    ''
  ) -join "`r`n"
  return $head + "`r`n" + $pad + $tail
}

<#
  The point just before the closing marker, so the two "cut short" cases below
  land exactly where they mean to rather than wherever half a file happens to
  fall: +1 ends mid-line, +2 ends on a line boundary with the marker gone.
#>
# Where a dump stops being a dump: the index of the CRLF that comes just before
# the "-- PostgreSQL database dump complete" trailer line. Cutting at +1 leaves
# the file ending in a bare CR (mid-line); cutting at +2 ends it on the line
# boundary with the trailer gone. Both must be refused, for different reasons,
# which is why the exact offset matters rather than a fraction of the length.
function Get-FakeDumpTailOffset {
  param([string]$Text)
  return $Text.IndexOf("`r`n-- PostgreSQL database dump complete")
}

function Write-FakeDump {
  param(
    [string]$Dir,
    [string]$Stamp,
    [string]$Token = 'HARNESStokenHARNESStokenHARNESStokenHARNESStokenHARNESS',
    [int]$PadLines = 1600
  )
  $path = Join-Path $Dir ("townreporter_" + $Stamp + ".sql")
  [IO.File]::WriteAllText($path, (New-FakeDumpText -Token $Token -PadLines $PadLines), (New-Object Text.UTF8Encoding $false))
  return $path
}

# Six backups, one per night, oldest first. The newest three are the ones the
# prune must keep.
$script:stamps = @(
  '2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205',
  '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205'
)
function New-SixBackups {
  foreach ($s in $script:stamps) { Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null }
}
function Get-LocalNames {
  return ,@(Get-TownReporterBackupList -Dir $script:backupDir | ForEach-Object { $_.Name })
}
function Get-OffsiteNames {
  if (-not (Test-Path -LiteralPath $script:offsite)) { return ,@() }
  return ,@(Get-ChildItem -LiteralPath $script:offsite -Filter '*.sql' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}

# ---------------------------------------------------------------------------
# 1. Where backups live and what they are called.
# ---------------------------------------------------------------------------
Reset-World "names"
Write-Host "  1. where backups live, and what they are called"
Check "the backup folder is the app folder's sibling, the path promote.ps1 has always used" ((Get-TownReporterBackupDir -App $script:app) -eq $script:backupDir) (Get-TownReporterBackupDir -App $script:app)
Check "the offsite folder comes from BACKUP_OFFSITE_DIR in .env" ((Get-TownReporterBackupOffsiteDir -App $script:app) -eq $script:offsite) (Get-TownReporterBackupOffsiteDir -App $script:app)
Check "with no .env setting at all it still defaults to D:\TownReporter-backups" ((Get-TownReporterBackupOffsiteDir -App $script:app -EnvFile (Join-Path $script:world 'missing.env')) -eq 'D:\TownReporter-backups')
$name = Get-TownReporterBackupName -Database townreporter -Now ([datetime]"2026-09-25 02:05")
Check "a backup is named <database>_YYYY-MM-DD_HHmm.sql" ($name -eq 'townreporter_2026-09-25_0205.sql') $name

$listDir = Join-Path $script:world "list-test"
New-Item -ItemType Directory -Force -Path $listDir | Out-Null
Write-FakeDump -Dir $listDir -Stamp '2026-09-25_0205' | Out-Null
Set-Content -LiteralPath (Join-Path $listDir "townreporter_2026-09-25_0205.sql.incomplete") -Value 'not a backup' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $listDir "notes.txt") -Value 'not a backup' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $listDir "townreporter_nodate.sql") -Value 'not a backup' -Encoding ASCII
$found = @(Get-TownReporterBackupList -Dir $listDir)
$foundNames = @($found | ForEach-Object { $_.Name }) -join ', '
Check "only files named like a backup are seen; .incomplete, .txt and an undated name are not" ($found.Count -eq 1) "found: $foundNames"

# ---------------------------------------------------------------------------
# 2. Is this dump finished? The decisive check.
# ---------------------------------------------------------------------------
Write-Host "  2. a dump that did not finish is not a backup"
$goodPath = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-25_0205'
$goodText = [IO.File]::ReadAllText($goodPath)
$good = Test-TownReporterDumpComplete -Path $goodPath
Check "a complete dump is accepted ($($good.Reason))" ($good.Ok -eq $true)
Check "a file that is not there is refused" ((Test-TownReporterDumpComplete -Path (Join-Path $script:backupDir "nothing.sql")).Ok -eq $false)

$tailAt = Get-FakeDumpTailOffset -Text $goodText

$midPath = Join-Path $script:world "cut-mid-line.sql"
[IO.File]::WriteAllText($midPath, $goodText.Substring(0, $tailAt + 1), (New-Object Text.UTF8Encoding $false))
$mid = Test-TownReporterDumpComplete -Path $midPath
Check "a dump cut in the middle of a line is refused ($($mid.Reason))" ($mid.Ok -eq $false)
Check "it says the file stops in the middle of a line" ($mid.Reason -match 'stops in the middle of a line')

$linePath = Join-Path $script:world "cut-at-line.sql"
[IO.File]::WriteAllText($linePath, $goodText.Substring(0, $tailAt + 2), (New-Object Text.UTF8Encoding $false))
$line = Test-TownReporterDumpComplete -Path $linePath
Check "a dump that ends on a line boundary but has no closing marker is refused ($($line.Reason))" ($line.Ok -eq $false)
Check "it says the closing marker is missing, not that the line was cut" ($line.Reason -match 'closing marker is missing') $line.Reason

$noNewline = Join-Path $script:world "no-newline.sql"
[IO.File]::WriteAllText($noNewline, $goodText.TrimEnd([char[]]"`r`n"), (New-Object Text.UTF8Encoding $false))
$nn = Test-TownReporterDumpComplete -Path $noNewline
Check "a dump whose last line has no newline is refused ($($nn.Reason))" ($nn.Ok -eq $false)

$mismatch = Join-Path $script:world "mismatched-token.sql"
[IO.File]::WriteAllText($mismatch, (New-FakeDumpText -Token 'OPENINGtokenOPENINGtokenOPENINGtokenOPENINGtokenOPENINGtoke' -TailToken 'CLOSINGtokenCLOSINGtokenCLOSINGtokenCLOSINGtokenCLOSINGto'), (New-Object Text.UTF8Encoding $false))
$mm = Test-TownReporterDumpComplete -Path $mismatch
Check "a dump whose closing marker does not match its opening one is refused ($($mm.Reason))" ($mm.Ok -eq $false)
Check "and the refusal names the mismatch, not a missing marker" ($mm.Reason -match 'does not match the opening one') $mm.Reason

$oldStyle = Join-Path $script:world "old-pg-dump.sql"
$oldText = $goodText -replace '(?m)^\\restrict\s+\S+\s*$', '' -replace '(?m)^\\unrestrict\s+\S+\s*$', ''
[IO.File]::WriteAllText($oldStyle, $oldText, (New-Object Text.UTF8Encoding $false))
$old = Test-TownReporterDumpComplete -Path $oldStyle
Check "a pre-17 pg_dump with only the 'dump complete' trailer is still accepted" ($old.Ok -eq $true)

$smallPath = Join-Path $script:world "small.sql"
[IO.File]::WriteAllText($smallPath, "nope`r`n", (New-Object Text.UTF8Encoding $false))
$small = Test-TownReporterDumpComplete -Path $smallPath
Check "a file far too small to be a dump is refused" ($small.Ok -eq $false)
Check "and the refusal names the real floor, not a made-up one" ($small.Reason -match 'the floor is 100000 bytes') $small.Reason

# ---------------------------------------------------------------------------
# 3. Copy to D:, keep three on C:, delete nothing from D:.
# ---------------------------------------------------------------------------
Reset-World "prune"
Write-Host "  3. six local backups, an empty D:, three left on C:"
New-SixBackups
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
$text = Read-Log $script:log
Check "the whole run is Ok" ($run.Ok -eq $true) $run.Reason
Check "an -Offsite run reports that it took no dump" ($null -eq $run.DumpOk)
Check "the first run copied every older backup, not just the newest (all 6 of 6)" ($run.State.offsiteVerified -eq 6) ("verified " + $run.State.offsiteVerified)
Check "all six are on the other drive" ((Get-OffsiteNames).Count -eq 6)
Check "exactly three are left on this machine" ((Get-LocalNames).Count -eq 3) ((Get-LocalNames) -join ', ')
Check "the three left are the newest three" (((Get-LocalNames) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-LocalNames) -join ', ')
Check "nothing at all was deleted from the other drive" ((Get-OffsiteNames).Count -eq 6)
Check "the log says which files were deleted and why they were safe to delete" ($text -match 'prune: deleted townreporter_2026-09-20_0205.sql')
Check "the log says the deleted files are verified on the other drive" ($text -match 'it is verified on')
Check "the state file says three local and six verified" ($run.State.localCount -eq 3 -and $run.State.offsiteVerified -eq 6)
Check "the state file records when the prune happened" ($run.State.prunedAt -and $run.State.prunedCount -eq 3)

$again = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a second run copies nothing, because it hashes what is already there and finds it identical" ($again.State.offsiteVerified -eq 3)
Check "and still leaves exactly three" ((Get-LocalNames).Count -eq 3)

# ---------------------------------------------------------------------------
# 4. The offsite folder cannot be reached: nothing is deleted, an alert fires.
# ---------------------------------------------------------------------------
Reset-World "nooffsite"
Write-Host "  4. an offsite folder that cannot be created"
New-SixBackups
$blocker = Join-Path $script:world "blocker"
Set-Content -LiteralPath $blocker -Value 'this is a file, not a directory' -Encoding ASCII
Set-Content -LiteralPath (Join-Path $script:app ".env") -Encoding ASCII -Value @(
  "DATABASE_URL=postgres://postgres@127.0.0.1:5433/townreporter",
  ("BACKUP_OFFSITE_DIR=" + (Join-Path $blocker "D"))
)
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir (Join-Path $blocker "D") `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "the run is not Ok" ($run.Ok -eq $false)
# Either wording is the same refusal: the folder is missing and was not made,
# or it is there and cannot be written to. Which one a path with a file for a
# parent produces is the filesystem's answer, not this run's.
Check "it says in plain words that the folder is not usable" ($run.Reason -match 'could not be created|cannot be written to') $run.Reason
Check "NOTHING was deleted from this machine" ((Get-LocalNames).Count -eq 6) ((Get-LocalNames).Count)
Check "the state file records the copy as failing" ($run.State.offsiteOk -eq $false)
Check "the state file says why" ([bool]$run.State.offsiteReason)
Check "the state file's name for the offsite folder is the one that failed" ($run.State.offsiteDir -eq (Join-Path $blocker "D")) $run.State.offsiteDir

$script:events.Clear()
$alertsFile = Join-Path $script:app "logs\alerts.json"
$t = [datetime]"2026-09-25 03:00:00"
$conditions = @(
  @{ Id = 'offsite-failing'; Active = ($run.State.offsiteOk -eq $false); Detail = $run.State.offsiteReason }
)
$r = Invoke-TownReporterAlertCheck -App $script:app -StateFile $alertsFile -EnvFile (Join-Path $script:app ".env") -Conditions $conditions -Now $t -Notify $notify
Check "an alert fires once" (@($script:events | Where-Object { $_.Event -eq 'started' -and $_.Id -eq 'offsite-failing' }).Count -eq 1)
Check "it is worded for a person, not for a log" (($script:events[0].Message -eq 'The copy of the backups to drive D: is failing')) ($script:events[0].Message)
Check "there were no other events" ($script:events.Count -eq 1)
$r = Invoke-TownReporterAlertCheck -App $script:app -StateFile $alertsFile -EnvFile (Join-Path $script:app ".env") -Conditions $conditions -Now $t.AddMinutes(5) -Notify $notify
Check "it does not fire again while it stays broken" ($script:events.Count -eq 1)

$onDisk = Get-Content -Raw -LiteralPath $alertsFile | ConvertFrom-Json
Check "the Control page can read the alert straight out of logs\alerts.json" ($onDisk.firing.'offsite-failing'.message -eq 'The copy of the backups to drive D: is failing')

# ---------------------------------------------------------------------------
# 5. D: short of room: nothing is deleted, and the space alert is separate.
# ---------------------------------------------------------------------------
Reset-World "lowspace"
Write-Host "  5. an offsite drive with almost no room left"
New-SixBackups
Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0 | Out-Null
foreach ($s in @('2026-09-26_0205', '2026-09-27_0205')) { Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null }
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -Keep 3 -MinFreeGb 999999999
$text = Read-Log $script:log
Check "a prune with no room on the other drive deletes nothing" ($prune.Ok -eq $false)
Check "it says in plain words that the drive is below the limit" ($prune.Reason -match 'below the .* GB limit') $prune.Reason
Check "every local file is still there" ((Get-LocalNames).Count -eq 5)
Check "the log says the prune deleted nothing" ($text -match 'prune: NOT deleting anything')

# ---------------------------------------------------------------------------
# 6. One local file not verified on D: means nothing is deleted at all.
# ---------------------------------------------------------------------------
Reset-World "unverified"
Write-Host "  6. a local backup that is not on the other drive yet"
New-SixBackups
foreach ($s in @('2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205')) {
  Copy-Item -LiteralPath (Join-Path $script:backupDir ("townreporter_" + $s + ".sql")) -Destination (Join-Path $script:offsite ("townreporter_" + $s + ".sql"))
}
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -Keep 3 -MinFreeGb 0
Check "a prune refuses when three of the six are not on the other drive" ($prune.Ok -eq $false)
Check "it names how many are missing and which" ($prune.Reason -match '3 of 6 local backups are not verified') $prune.Reason
Check "nothing was deleted" ((Get-LocalNames).Count -eq 6)
Check "and nothing was copied by the prune either" ((Get-OffsiteNames).Count -eq 3)

# ---------------------------------------------------------------------------
# 7. A half-copy left behind by a killed run, and a copy that no longer
#    matches. Both must end with nothing deleted.
# ---------------------------------------------------------------------------
Reset-World "noverify"
Write-Host "  7. a leftover half-copy from a run that was killed"
New-SixBackups
# <name>.sql.partial is what a run that was killed mid-copy leaves behind. Here
# it is created as a NON-EMPTY DIRECTORY, which is the nasty shape: in Windows
# PowerShell 5.1 Remove-Item on a non-empty directory throws a
# NullReferenceException, and -ErrorAction SilentlyContinue does not suppress
# it. Before this was handled the whole run died with a stack trace instead of
# saying what happened; the point of the case is that tonight's backup still
# happens. It is a directory on purpose -- an empty one would just be removed.
$obstructed = 'townreporter_2026-09-20_0205.sql'
$partialDir = Join-Path $script:offsite ($obstructed + '.partial')
New-Item -ItemType Directory -Force -Path $partialDir | Out-Null
Set-Content -LiteralPath (Join-Path $partialDir 'in-the-way.txt') -Value 'not a backup' -Encoding ASCII
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
$text = Read-Log $script:log
Check "a leftover from a killed run does not stop tonight's backup" ($run.Ok -eq $true) $run.Reason
Check "the log says it cleared the leftover out of the way" ($text -match 'cleared the leftover')
Check "the file that was blocked is on the other drive with the rest of them" ((Get-OffsiteNames).Count -eq 6)
Check "the leftover is gone rather than left sitting on the drive" (-not (Test-Path -LiteralPath $partialDir))
Check "and three are left on this machine" ((Get-LocalNames).Count -eq 3)

Write-Host "  7b. what 'same size and same SHA256' actually means"
$src = (Get-LocalNames)[0]
$srcPath = Join-Path $script:backupDir $src
$samePath = Join-Path $script:world "same.sql"
Copy-Item -LiteralPath $srcPath -Destination $samePath
$diffBytes = [IO.File]::ReadAllBytes($samePath)
$diffBytes[2000] = $diffBytes[2000] -bxor 0xFF
$diffPath = Join-Path $script:world "diff.sql"
[IO.File]::WriteAllBytes($diffPath, $diffBytes)
Check "an identical file matches" ((Test-TownReporterCopyMatches -Source $srcPath -Dest $samePath) -eq $true)
Check "a file of exactly the same length but different bytes does NOT match" ((Test-TownReporterCopyMatches -Source $srcPath -Dest $diffPath) -eq $false)
$shortPath = Join-Path $script:world "short.sql"
[IO.File]::WriteAllText($shortPath, "x", (New-Object Text.UTF8Encoding $false))
Check "a file of a different length does not match" ((Test-TownReporterCopyMatches -Source $srcPath -Dest $shortPath) -eq $false)
Check "a missing file does not match" ((Test-TownReporterCopyMatches -Source $srcPath -Dest (Join-Path $script:world "absent.sql")) -eq $false)
$asDir = Join-Path $script:world "a-directory"
New-Item -ItemType Directory -Force -Path $asDir | Out-Null
Check "a directory does not match a file" ((Test-TownReporterCopyMatches -Source $srcPath -Dest $asDir) -eq $false)

Write-Host "  7c. a copy on the other drive that no longer matches its original"
# The same length, one byte different: this is what a copy damaged in place
# looks like, and it is the case a size-only check would wave through.
$victim = (Get-LocalNames)[0]
$victimLocal = Join-Path $script:backupDir $victim
$victimOffsite = Join-Path $script:offsite $victim
$flip = [IO.File]::ReadAllBytes($victimOffsite)
$flip[4000] = $flip[4000] -bxor 0x5A
[IO.File]::WriteAllBytes($victimOffsite, $flip)
Check "the damaged copy is no longer the same file" ((Test-TownReporterCopyMatches -Source $victimLocal -Dest $victimOffsite) -eq $false)

$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a run notices, copies it again, and verifies it" ($run.Ok -eq $true -and $run.State.offsiteVerified -eq 3) $run.Reason
Check "and the copy on the other drive is identical again" ((Test-TownReporterCopyMatches -Source $victimLocal -Dest $victimOffsite) -eq $true)

# Damage it once more, add a fourth backup so the prune has something it could
# delete, and call the prune directly. The order matters: the hash must be what
# says no, and it must say so before anything is deleted.
$flip = [IO.File]::ReadAllBytes($victimOffsite)
$flip[4000] = $flip[4000] -bxor 0x5A
[IO.File]::WriteAllBytes($victimOffsite, $flip)
$spare = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-26_0205'
Copy-Item -LiteralPath $spare -Destination (Join-Path $script:offsite 'townreporter_2026-09-26_0205.sql')
$offsiteBefore = (Get-OffsiteNames).Count
Check "the other drive holds the six from before plus the spare" ($offsiteBefore -eq 7) "$offsiteBefore"
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -Keep 3 -MinFreeGb 0
Check "a copy that no longer matches stops the prune" ($prune.Ok -eq $false)
Check "it names how many are not verified and how many there are" ($prune.Reason -match '1 of 4 local backups are not verified') $prune.Reason
Check "nothing was deleted from this machine" ((Get-LocalNames).Count -eq 4) ((Get-LocalNames) -join ', ')
Check "and nothing was deleted from the other drive either" ((Get-OffsiteNames).Count -eq $offsiteBefore) ((Get-OffsiteNames).Count)

# ---------------------------------------------------------------------------
# 8. A local file that is not a complete dump stops the copy and the prune.
# ---------------------------------------------------------------------------
Reset-World "badlocal"
Write-Host "  8. a truncated dump sitting in the local folder"
foreach ($s in @('2026-09-21_0205', '2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205')) {
  Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null
}
$badText = New-FakeDumpText
[IO.File]::WriteAllText((Join-Path $script:backupDir 'townreporter_2026-09-20_0205.sql'), $badText.Substring(0, [int]($badText.Length / 2)), (New-Object Text.UTF8Encoding $false))
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
$text = Read-Log $script:log
Check "the run is not Ok" ($run.Ok -eq $false)
Check "it names the file that is not a complete dump" ($run.Reason -match 'townreporter_2026-09-20_0205.sql is not a complete dump') $run.Reason
Check "the five good ones are on the other drive" ((Get-OffsiteNames).Count -eq 5)
Check "the truncated one was not copied" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'townreporter_2026-09-20_0205.sql')))
Check "NOTHING was deleted from this machine" ((Get-LocalNames).Count -eq 6)
Check "the state file records the copy as failing" ($run.State.offsiteOk -eq $false)

# ---------------------------------------------------------------------------
# 9. A dump that fails, and one that does not finish, stop the run.
# ---------------------------------------------------------------------------
Reset-World "dumprun"
Write-Host "  9. a dump that fails, and a dump that is cut short"
$script:dumpCalls = 0
$dumpGood = { param($Path) $script:dumpCalls++; [IO.File]::WriteAllText($Path, (New-FakeDumpText -Token 'AUTOMATICrunAUTOMATICrunAUTOMATICrunAUTOMATICrunAUTOMATICrun'), (New-Object Text.UTF8Encoding $false)); return $true }
# Cut just after the last line of the dump body, on a line boundary, so the
# file ends with a newline (not "in the middle of a line") and the closing
# marker is simply not there -- a pg_dump that was killed before it finished.
$dumpCut = { param($Path) $t = New-FakeDumpText -Token 'CUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaC'; [IO.File]::WriteAllText($Path, $t.Substring(0, (Get-FakeDumpTailOffset -Text $t) + 2), (New-Object Text.UTF8Encoding $false)); return $true }
$dumpNo = { param($Path) return $false }
$dumpThrow = { param($Path) throw 'there is no pg_dump on this machine' }

$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:30") -MinFreeGb 0
Check "a dump that works is a backup" ($run.DumpOk -eq $true -and $run.Ok -eq $true) ($run.Reason)
Check "it put exactly one backup in the folder" ((Get-LocalNames).Count -eq 1)
Check "named for the minute it was taken" ((Get-LocalNames) -contains 'townreporter_2026-09-25_0230.sql') ((Get-LocalNames) -join ', ')
Check "it copied that one to the other drive" ((Get-OffsiteNames).Count -eq 1)
Check "the state file has the newest backup's name and size" ($run.State.lastName -eq 'townreporter_2026-09-25_0230.sql' -and $run.State.lastBytes -gt 100000)
Check "the state file has no error on it" ($null -eq $run.State.lastError)

$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpCut `
  -Now ([datetime]"2026-09-25 02:40") -MinFreeGb 0
$text = Read-Log $script:log
Check "a dump cut short is not a backup" ($run.DumpOk -eq $false -and $run.Ok -eq $false)
Check "it says the closing marker is missing" ($run.Reason -match 'closing marker is missing') $run.Reason
Check "the cut-short file is NOT left wearing a backup's name" (-not (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-25_0240.sql') -PathType Leaf))
$incomplete = @(Get-ChildItem -LiteralPath $script:backupDir -Filter '*.sql.incomplete' -File)
Check "it is kept beside the others with .incomplete on the end, so a person can look at it" ($incomplete.Count -eq 1 -and $incomplete[0].Name -eq 'townreporter_2026-09-25_0240.sql.incomplete') (($incomplete | ForEach-Object { $_.Name }) -join ', ')
Check "the log says it was kept for inspection" ($text -match 'kept for inspection as')
Check "the state file now carries the failure" ($run.State.lastError -match 'closing marker is missing')
Check "the good backup from a moment ago is still there and still the newest" ((Get-LocalNames).Count -eq 1)

$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpNo -MinFreeGb 0
Check "a dump command that reports failure is not a backup" ($run.DumpOk -eq $false)
Check "it says so in plain words" ($run.Reason -match 'the dump command reported failure') $run.Reason

$threw = $false
try {
  $run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
    -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpThrow -MinFreeGb 0
} catch { $threw = $true }
Check "a dump that throws does not take the whole run down with it" ($threw -eq $false)
Check "the run reports the throw" ($run.DumpOk -eq $false -and $run.Reason -match 'the dump command threw')
Check "nothing was deleted and no backup was lost through any of that" ((Get-LocalNames).Count -eq 1)

# ---------------------------------------------------------------------------
# 10. The lock: never two at once, and a stale one is taken over.
# ---------------------------------------------------------------------------
Reset-World "lock"
Write-Host " 10. the lock that keeps two backups apart"
New-SixBackups
$held = Enter-TownReporterBackupLock -LockFile $script:lock -LogFile $script:log
Check "the lock is taken when nobody holds it" ($held.Ok -eq $true)
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock
$text = Read-Log $script:log
Check "a run that finds the lock held does nothing and says so" ($run.Skipped -eq $true -and $run.Ok -eq $false)
Check "it reports no dump, not a failed dump" ($null -eq $run.DumpOk)
Check "it did not touch the backups" ((Get-LocalNames).Count -eq 6 -and (Get-OffsiteNames).Count -eq 0)
Check "the log says another backup is running" ($text -match 'another backup has been running for \d+ minute\(s\)')
Exit-TownReporterBackupLock -LockFile $script:lock

$waited = $true
$shortWait = { param($LockFile) $true }
$start = Get-Date
$null = Enter-TownReporterBackupLock -LockFile $script:lock -LogFile $script:log -WaitSeconds 0
$immediate = ((Get-Date) - $start).TotalSeconds
$start = Get-Date
$blocked = Enter-TownReporterBackupLock -LockFile $script:lock -LogFile $script:log -WaitSeconds 6
$longWait = ((Get-Date) - $start).TotalSeconds
$text = Read-Log $script:log
Check "with no wait asked for, a held lock gives up at once" ($immediate -lt 3) ("$immediate s")
Check "with a wait asked for, it waits for the other run" ($longWait -ge 5 -and $longWait -lt 15) ("$longWait s")
Check "and then reports the lock as still held" ($blocked.Ok -eq $false)
Check "and says in the log that it waited" ($text -match 'another backup is running; waiting up to 6 second\(s\) for it')
Exit-TownReporterBackupLock -LockFile $script:lock

[IO.File]::WriteAllText($script:lock, "9999 2020-01-01 00:00:00", (New-Object Text.UTF8Encoding $false))
(Get-Item -LiteralPath $script:lock).LastWriteTime = (Get-Date).AddMinutes(-90)
$taken = Enter-TownReporterBackupLock -LockFile $script:lock -LogFile $script:log
$text = Read-Log $script:log
Check "a lock left behind by a killed run is taken over, not honoured forever" ($taken.Ok -eq $true)
Check "and the takeover is logged, never silent" ($text -match 'which is stale; taking it over')
Exit-TownReporterBackupLock -LockFile $script:lock

# ---------------------------------------------------------------------------
# 11. The rule: after 2 AM, and only if the newest backup is over 20 hours old.
# ---------------------------------------------------------------------------
Reset-World "due"
Write-Host " 11. the 2 AM and 20 hour rule, on a fake clock"
$midnight = Test-TownReporterBackupDue -BackupDir $script:backupDir -Now ([datetime]"2026-09-25 01:30")
Check "at 1:30 in the morning it is not time" ($midnight.Due -eq $false)
Check "and it says why" ($midnight.Reason -match 'before 2 in the morning')

Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-25_0205' | Out-Null
$fresh = Test-TownReporterBackupDue -BackupDir $script:backupDir -Now ([datetime]"2026-09-25 02:10")
Check "at 2:10 with a five-minute-old backup it is not time" ($fresh.Due -eq $false)
Check "it says the newest backup is too new" ($fresh.Reason -match 'only 0.08 hour\(s\) old') $fresh.Reason

Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-23_2300' | Out-Null
$late = Test-TownReporterBackupDue -BackupDir $script:backupDir -Now ([datetime]"2026-09-25 02:10")
Check "a backup from the night before last does not count as last night's" ($late.Due -eq $false)
Check "the age comes from the file name, not the file's own time" ($late.Newest -eq [datetime]"2026-09-25 02:05") ($late.Newest)

$none = Test-TownReporterBackupDue -BackupDir (Join-Path $script:world "empty-dir") -Now ([datetime]"2026-09-25 02:10")
Check "a folder with no backups at all is due" ($none.Due -eq $true)
Check "and it says no backup has ever been taken here" ($none.Reason -match 'no backup has ever been taken here')

Reset-World "duerun"
Write-Host " 11b. the same rule through a whole run"
# Exactly the three the owner wants kept, all from before 2 AM this morning, so
# the 01:30 run below has a folder the prune has no reason to change and the
# only thing that could add a file is the dump itself.
foreach ($s in @('2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205')) {
  Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null
}
$before = (Get-LocalNames).Count
$callsBefore = $script:dumpCalls
$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 01:30") -MinFreeGb 0
$text = Read-Log $script:log
Check "run before 2 AM: no dump is taken" ($null -eq $run.DumpOk)
Check "and the file that would hold it was never even written" ($script:dumpCalls -eq $callsBefore)
Check "and the log says why" ($text -match 'not taking a backup: it is before 2 in the morning')
Check "no file was written for it" (-not (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-25_0130.sql')))
Check "the folder is unchanged" ((Get-LocalNames).Count -eq $before) ((Get-LocalNames) -join ', ')

$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:30") -MinFreeGb 0
Check "run at 2:30 with a backup from the day before: a dump IS taken" ($run.DumpOk -eq $true) $run.Reason
Check "the new backup is in the folder" ((Get-LocalNames) -contains 'townreporter_2026-09-25_0230.sql')
Check "it is copied to the other drive in the same run" ((Get-OffsiteNames) -contains 'townreporter_2026-09-25_0230.sql')
Check "the prune runs in the same run and leaves three" ((Get-LocalNames).Count -eq 3) ((Get-LocalNames) -join ', ')

$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:35") -MinFreeGb 0
Check "a run five minutes later takes no second backup" ($null -eq $run.DumpOk)

# ---------------------------------------------------------------------------
# 12. Alerts: once when they start, once when they clear, and no repeats.
# ---------------------------------------------------------------------------
Reset-World "alerts"
Write-Host " 12. an alert fires once, and clears once"
$script:events = New-Object System.Collections.ArrayList
$alertsFile = Join-Path $script:app "logs\alerts.json"
$envFile = Join-Path $script:app ".env"
$t0 = [datetime]"2026-09-25 10:00:00"
function Check-Alerts {
  param([datetime]$Now, [array]$Conditions)
  $r = Invoke-TownReporterAlertCheck -App $script:app -StateFile $alertsFile -EnvFile $envFile -Conditions $Conditions -Now $Now -Notify $notify
  return $r.State
}
function Count-Events {
  param([string]$Event, [string]$Id)
  return @($script:events | Where-Object { $_.Event -eq $Event -and $_.Id -eq $Id }).Count
}

$paperDown = @{ Id = 'paper-down'; Active = $true; Detail = 'nothing answered on 127.0.0.1:3000' }
$null = Check-Alerts -Now $t0 -Conditions @($paperDown)
Check "the first sighting starts a clock, it does not alert" ((Count-Events 'started' 'paper-down') -eq 0)
$null = Check-Alerts -Now $t0.AddMinutes(5) -Conditions @($paperDown)
Check "five minutes down is not yet ten" ((Count-Events 'started' 'paper-down') -eq 0)
$null = Check-Alerts -Now $t0.AddMinutes(9) -Conditions @($paperDown)
Check "nine minutes down is still not ten" ((Count-Events 'started' 'paper-down') -eq 0)
$null = Check-Alerts -Now $t0.AddMinutes(10) -Conditions @($paperDown)
Check "ten minutes down fires" ((Count-Events 'started' 'paper-down') -eq 1)
Check "the message is the plain one the Control page shows" ($script:events[0].Message -eq 'The paper is not answering on this machine') ($script:events[0].Message)
$null = Check-Alerts -Now $t0.AddMinutes(11) -Conditions @($paperDown)
$null = Check-Alerts -Now $t0.AddMinutes(20) -Conditions @($paperDown)
Check "and it does NOT fire again every five minutes" ((Count-Events 'started' 'paper-down') -eq 1)

$paperUp = @{ Id = 'paper-down'; Active = $false; Detail = 'the paper answered' }
$null = Check-Alerts -Now $t0.AddMinutes(21) -Conditions @($paperUp)
Check "when it clears, it says so once" ((Count-Events 'cleared' 'paper-down') -eq 1)
Check "the clear names when it had been wrong since" ($script:events[-1].Detail -match 'it had been wrong since') ($script:events[-1].Detail)
$null = Check-Alerts -Now $t0.AddMinutes(22) -Conditions @($paperUp)
Check "and it does not say so again" ((Count-Events 'cleared' 'paper-down') -eq 1)

# A second, shorter outage must fire again: this is a per-outage rule.
$null = Check-Alerts -Now $t0.AddHours(2) -Conditions @($paperDown)
$null = Check-Alerts -Now $t0.AddHours(2).AddMinutes(11) -Conditions @($paperDown)
Check "a second outage fires again, so the rule is per outage, not once ever" ((Count-Events 'started' 'paper-down') -eq 2)

Write-Host " 12b. a run that was not asked about the paper cannot clear it"
$offsiteOk = @{ Id = 'offsite-failing'; Active = $false; Detail = $null }
$null = Check-Alerts -Now $t0.AddHours(2).AddMinutes(12) -Conditions @($offsiteOk)
Check "the paper-down alert is still firing after a backup-only run" ((Count-Events 'cleared' 'paper-down') -eq 1)
$onDisk = Get-Content -Raw -LiteralPath $alertsFile | ConvertFrom-Json
Check "and it is still in logs\alerts.json for the Control page" ($onDisk.firing.PSObject.Properties.Name -contains 'paper-down')
$unevaluated = @{ Id = 'paper-down'; Active = $null; Detail = $null }
$null = Check-Alerts -Now $t0.AddHours(2).AddMinutes(13) -Conditions @($unevaluated)
Check "a condition that could not be evaluated changes nothing either" ((Count-Events 'cleared' 'paper-down') -eq 1)

Write-Host " 12c. a condition with no grace fires at once; the site one waits, like the paper"
# scan-missing has no grace of its own -- it is 8 AM or later and the scan has
# not finished, which is already a settled fact. The public site gets the same
# ten minutes the paper gets, because "a page did not answer" is the observation
# that most often means a restart, not an outage.
$script:events.Clear()
$null = Check-Alerts -Now $t0 -Conditions @(@{ Id = 'scan-missing'; Active = $true; Detail = 'no scan has ever run' }, @{ Id = 'site-down'; Active = $true; Detail = 'nothing answered' })
Check "the daily-scan alert fires on the first sighting" ((Count-Events 'started' 'scan-missing') -eq 1)
Check "the public site is given the same ten minutes the paper gets" ((Count-Events 'started' 'site-down') -eq 0)
Check "each one is worded for a person" ((($script:events | Where-Object { $_.Id -eq 'scan-missing' }).Message) -eq 'The daily scan has not run, or did not finish')
$null = Check-Alerts -Now $t0.AddMinutes(5) -Conditions @(@{ Id = 'scan-missing'; Active = $true; Detail = 'no scan has ever run' }, @{ Id = 'site-down'; Active = $true; Detail = 'nothing answered' })
Check "five minutes of the public site being down is not yet ten" ((Count-Events 'started' 'site-down') -eq 0)
$null = Check-Alerts -Now $t0.AddMinutes(10) -Conditions @(@{ Id = 'scan-missing'; Active = $false; Detail = $null }, @{ Id = 'site-down'; Active = $true; Detail = 'nothing answered' })
Check "the scan alert clears once" ((Count-Events 'cleared' 'scan-missing') -eq 1)
Check "ten minutes of the public site being down fires" ((Count-Events 'started' 'site-down') -eq 1)
Check "and it does not repeat on the next run" ((Count-Events 'started' 'site-down') -eq 1 -and (Count-Events 'cleared' 'site-down') -eq 0)

Write-Host " 12d. the phone is off until the owner turns it on"
Check "with no topic, a push returns false without opening a socket" ((Send-TownReporterAlertPush -Topic '' -Message 'test') -eq $false)
Check "a topic that is not a plain name is refused rather than turned into a different URL" ((Send-TownReporterAlertPush -Topic 'a/b c' -Message 'test') -eq $false)
$script:events.Clear()
$r = Invoke-TownReporterAlertCheck -App $script:app -StateFile $alertsFile -EnvFile $envFile -Conditions @(@{ Id = 'offsite-low-space'; Active = $true; Detail = 'D: has 12 GB free and the limit is 100 GB' }) -Now $t0 -Notify $notify
Check "an alert fires with no ALERT_NTFY_TOPIC set at all" ((Count-Events 'started' 'offsite-low-space') -eq 1)
Check "and the check reports no topic, so nothing was pushed anywhere" (-not $r.Topic)

# ---------------------------------------------------------------------------
# 13. The daily scan, on a fake clock and a fake scan row.
# ---------------------------------------------------------------------------
Write-Host " 13. the daily-scan rule, with no database"
function New-ScanState {
  param([string]$Status, [string]$LastDay = "", [string]$Error = "", [bool]$Scheduled = $true, [string]$LocalTime = '06:00', [string]$LocalDay = '2026-09-25', [string]$LocalClock = '08:30')
  return @{ Ok = $true; Reason = 'read'; Zone = 'America/Denver'; LocalDay = $LocalDay; LocalClock = $LocalClock; Scheduled = $Scheduled; LocalTime = $LocalTime; LastId = '1'; LastDay = $LastDay; LastStatus = $Status; LastError = $Error }
}
$early = Test-TownReporterScanAlert -State (New-ScanState -Status 'none' -LocalClock '07:00') -Now ([datetime]"2026-09-25 07:00")
Check "before 8 AM the scan is not late yet, so nothing is said" ($null -eq $early.Active)
Check "and the alert it did not raise leaves any existing one alone" ($early.Due -eq $false)

$never = Test-TownReporterScanAlert -State (New-ScanState -Status 'none') -Now ([datetime]"2026-09-25 08:30")
Check "after 8 AM with no scan ever run, the alert is on" ($never.Active -eq $true)
Check "it says no scan has ever run" ($never.Detail -match 'no scan has ever run') $never.Detail

$failed = Test-TownReporterScanAlert -State (New-ScanState -Status 'failed' -LastDay '2026-09-25' -Error 'the feed returned 500') -Now ([datetime]"2026-09-25 08:30")
Check "a scan that failed today raises the alert" ($failed.Active -eq $true)
Check "and the alert carries what the scan said" ($failed.Detail -match 'the feed returned 500') $failed.Detail

$done = Test-TownReporterScanAlert -State (New-ScanState -Status 'finished' -LastDay '2026-09-25') -Now ([datetime]"2026-09-25 08:30")
Check "a scan that finished today raises nothing" ($done.Active -eq $false)

$yesterday = Test-TownReporterScanAlert -State (New-ScanState -Status 'finished' -LastDay '2026-09-24') -Now ([datetime]"2026-09-25 08:30")
Check "a scan that finished yesterday and not today raises the alert" ($yesterday.Active -eq $true)
Check "it names the day it last finished" ($yesterday.Detail -match 'finished on 2026-09-24') $yesterday.Detail

$stuck = Test-TownReporterScanAlert -State (New-ScanState -Status 'running' -LastDay '2026-09-24') -Now ([datetime]"2026-09-25 08:30")
Check "a scan still marked running since yesterday counts as not having run" ($stuck.Active -eq $true)
$runningNow = Test-TownReporterScanAlert -State (New-ScanState -Status 'running' -LastDay '2026-09-25') -Now ([datetime]"2026-09-25 08:30")
Check "a scan running right now does not" ($runningNow.Active -eq $false)

$off = Test-TownReporterScanAlert -State (New-ScanState -Status 'none' -Scheduled $false) -Now ([datetime]"2026-09-25 08:30")
Check "a scan that is switched off is not a failure" ($off.Active -eq $false)
$unread = Test-TownReporterScanAlert -State @{ Ok = $false; Reason = 'the database did not answer' } -Now ([datetime]"2026-09-25 08:30")
Check "a scan row that could not be read says nothing rather than guessing" ($null -eq $unread.Active)
Check "and it passes the reason along for the log" ($unread.Detail -match 'the database did not answer')
$lateSetting = Test-TownReporterScanAlert -State (New-ScanState -Status 'none' -LocalTime '11:00' -LocalClock '10:30') -Now ([datetime]"2026-09-25 10:30")
Check "a scan set for 11:00 is not late at 10:30, whatever the 8 AM floor says" ($null -eq $lateSetting.Active)

Write-Host " 13b. asking whether the desk is busy, with no psql to ask with"
$busy = Test-TownReporterDeskBusy -EnvFile $envFile -Psql (Join-Path $script:world 'no-psql-here.exe')
Check "with no psql the answer is 'unknown'" ($busy -eq 'unknown') $busy

# ---------------------------------------------------------------------------
# 14. The three backup conditions, from the one place that defines them.
# ---------------------------------------------------------------------------
<#
  These three are what the watchdog's nightly run, a press of the Control
  page's "Back up now" button and the manual script all check. The point of the
  section is not that each rule works in isolation -- sections 6, 9, 10 and 11
  prove that against the real run -- it is that the SHARED definition reports
  them the same way for every caller, and that a caller who forgets to wrap the
  call in @() still gets three conditions rather than a bare hashtable.
#>
Reset-World "conditions"
Write-Host " 14. the backup alert conditions, as every caller sees them"
$envFile = Join-Path $script:app ".env"
$script:events = New-Object System.Collections.ArrayList

# A fresh machine: no backup has ever been taken, and no copy has been judged.
$now = [datetime]"2026-09-25 10:00"
$conds = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir $script:offsite -Now $now
Check "three conditions come back for a caller that assigns the result straight" ($conds.Count -eq 3) "got $($conds.Count)"
Check "and they are the three ids the alert table knows" ((($conds | ForEach-Object { $_.Id }) -join ',') -eq 'backup-stale,offsite-failing,offsite-low-space') (($conds | ForEach-Object { $_.Id }) -join ',')
$byId = @{}
foreach ($c in $conds) { $byId[$c.Id] = $c }
Check "a machine that has never been backed up says so, rather than calling itself late" ($null -eq $byId['backup-stale'].Active) $byId['backup-stale'].Detail
Check "a copy that has never been judged is not reported as failing" ($null -eq $byId['offsite-failing'].Active) $byId['offsite-failing'].Detail
Check "a drive with room is not reported as short of room" ($byId['offsite-low-space'].Active -eq $false) $byId['offsite-low-space'].Detail

# The newest local backup is the instrument, exactly as the due rule uses it.
New-SixBackups
$cond = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir $script:offsite -Now $now
Check "eight hours after the newest one, nothing is stale" ($cond[0].Active -eq $false) $cond[0].Detail
$at30 = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir $script:offsite -Now ([datetime]"2026-09-26 08:05")
Check "thirty hours to the minute is still not stale" ($at30[0].Active -eq $false) $at30[0].Detail
$past30 = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir $script:offsite -Now ([datetime]"2026-09-26 08:10")
Check "and a few minutes past thirty is" ($past30[0].Active -eq $true) $past30[0].Detail
Check "it says how old the newest one is, in the plain sentence the page shows" ($past30[0].Detail -match 'the newest backup on this machine is 30.1 hour') $past30[0].Detail

# An empty local folder is not "nothing to worry about": the state file's last
# success is the fallback, so a folder that lost its files is still late.
$emptyDir = Join-Path $script:world "empty-local"
New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
$successAt = [datetime]"2026-09-24 14:00"
@{ lastSuccessAt = $successAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); offsiteOk = $false; offsiteReason = 'the drive was not there' } |
  ConvertTo-Json | Set-Content -LiteralPath $script:state -Encoding ASCII
$cond = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $emptyDir -StateFile $script:state -OffsiteDir $script:offsite -Now ([datetime]"2026-09-26 06:00")
Check "with an empty folder the last success in the state file is what the age is measured from" ($cond[0].Active -eq $true) $cond[0].Detail
Check "and it is forty hours, said plainly" ($cond[0].Detail -match '40 hour\(s\) old') $cond[0].Detail
Check "a copy that failed at the drive is reported as failing" ($cond[1].Active -eq $true) $cond[1].Detail
Check "the failing copy names the drive and what it said" (($cond[1].Detail -match [regex]::Escape($script:offsite)) -and ($cond[1].Detail -match 'the drive was not there')) $cond[1].Detail

$tight = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $emptyDir -StateFile $script:state -OffsiteDir $script:offsite -MinFreeGb 999999999 -Now ([datetime]"2026-09-26 06:00")
Check "a drive with less room than this machine keeps in reserve is short of room" ($tight[2].Active -eq $true) $tight[2].Detail
Check "and on this machine at this moment all three of them are bad at once" ((@($tight | Where-Object { $_.Active -eq $true }).Count) -eq 3) ((@($tight | ForEach-Object { "$($_.Id)=$($_.Active)" })) -join ', ')
# A drive letter this machine does not have. The premise is measured rather
# than assumed, and that is the whole point of these two lines: the fixture
# this replaced was 'C:\bad|name\x', whose ROOT is C:\ -- so DriveInfo read the
# system disk, the function answered 1048.9 GB with complete confidence, and the
# check passed for the wrong reason on a path that was never unreadable. A box
# that really has a Q: must fail the first line loudly rather than quietly test
# nothing.
Check "this machine has no Q: drive, which is the premise of the next check" ((Test-Path -LiteralPath 'Q:\') -eq $false) 'a Q: drive exists on this machine, so it is not an unreadable one'
$unknownDrive = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $emptyDir -StateFile $script:state -OffsiteDir 'Q:\TownReporter-backups' -Now $now
Check "a drive that cannot be read at all leaves the room unknown, not fine and not low" ($null -eq $unknownDrive[2].Active) $unknownDrive[2].Detail

# The wrapped caller: @() around that return makes one item that IS the array.
# Every id used to collapse into a single space-joined string in
# logs\alerts.json on that path, which the Control page reads and the alerts
# fire under -- so the one that is really broken would never fire at all.
$wrapped = New-Object 'object[]' 1
$wrapped[0] = $tight
$wrapState = Join-Path $script:world "wrap-state.json"
$null = Invoke-TownReporterAlertCheck -App $script:app -StateFile $wrapState -EnvFile $envFile -Conditions $wrapped -Now ([datetime]"2026-09-26 06:00") -Notify $notify
$firing = @((Get-Content -Raw -LiteralPath $wrapState | ConvertFrom-Json).firing.PSObject.Properties.Name)
Check "a caller that wraps the list in @() still gets one alert per condition" (($firing | Sort-Object) -join ',' -eq 'backup-stale,offsite-failing,offsite-low-space') ($firing -join ' | ')
$joined = @($firing | Where-Object { $_ -match ' ' })
Check "and never one alert whose id is several ids joined into a sentence" ($joined.Count -eq 0) ($joined -join ' | ')

# And the append form, which is what the watchdog does: two of its own plus
# these three, with no @() anywhere.
$appended = @(@{ Id = 'paper-down'; Active = $false; Detail = 'the paper answered' },
              @{ Id = 'site-down';  Active = $false; Detail = 'the site answered' })
$appended += Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $emptyDir -StateFile $script:state -OffsiteDir $script:offsite -Now $now
Check "a caller that appends the result to its own list gets five conditions" ($appended.Count -eq 5) "got $($appended.Count)"
Check "and none of the five is a list wearing a condition's name" (@($appended | Where-Object { $_ -is [array] }).Count -eq 0)
Check "every one of them has an id a person could read" (@($appended | Where-Object { -not $_.Id -or $_.Id -match ' ' }).Count -eq 0) ((@($appended | ForEach-Object { $_.Id })) -join ', ')

# ---------------------------------------------------------------------------
# 15. The files in the local folder that are not part of the series.
# ---------------------------------------------------------------------------
<#
  The hand-named safety copies. The rules are the ones the series gets --
  .partial, hash the copy, rename onto the real name, skip what is already
  identical, never delete -- with one deliberate difference: no
  completeness check, because a .dump is pg_dump's binary custom format with
  no text trailer to find and a hand-made .sql is not this series' output.
  This section proves both halves of that: that the two files land on D: byte
  for byte, and that a file which is not one of them is left alone.
#>
function Get-OffsiteSafetyNames {
  $dir = Join-Path $script:offsite 'other-safety-copies'
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return ,@() }
  return ,@(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}

Reset-World "others"
Write-Host "  15. the hand-named copies in the local folder go to the other drive too"
New-SixBackups
$handSql = Join-Path $script:backupDir 'before-the-migration.sql'
[IO.File]::WriteAllText($handSql, (New-FakeDumpText -Token 'HANDnamedHANDnamedHANDnamedHANDnamedHANDnamedHANDnamedHANDnamed'), (New-Object Text.UTF8Encoding $false))
$handDump = Join-Path $script:backupDir 'old-custom-format.dump'
$dumpBytes = New-Object byte[] 65536
for ($i = 0; $i -lt $dumpBytes.Length; $i++) { $dumpBytes[$i] = [byte](($i * 31 + 7) % 256) }
[IO.File]::WriteAllBytes($handDump, $dumpBytes)
# Four things that are NOT safety copies, two of them wearing a .sql or .dump
# in the middle of their name -- which is exactly the case the name test has
# to get right.
[IO.File]::WriteAllText((Join-Path $script:backupDir 'half-written.sql.partial'), 'half a copy', (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $script:backupDir 'half-written.dump.partial'), 'half a copy', (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $script:backupDir 'townreporter_2026-09-26_0205.sql.incomplete'), 'a dump that died', (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText((Join-Path $script:backupDir 'notes.txt'), 'a note to myself', (New-Object Text.UTF8Encoding $false))

# No @() around Get-LocalNames: it returns its list with a unary comma so that
# callers get an array, and wrapping that in @() makes one item that IS the
# array -- which -Exclude would then compare every name against, and every
# series file would come back as a safety copy. That mistake is what this line
# looked like the first time it ran.
$localNames = Get-LocalNames
$safety = Get-TownReporterSafetyCopyList -Dir $script:backupDir -Exclude $localNames
Check "the safety list is the two hand-named files and nothing else" (((@($safety | ForEach-Object { $_.Name }) | Sort-Object) -join ',') -eq 'before-the-migration.sql,old-custom-format.dump') ((@($safety | ForEach-Object { $_.Name })) -join ', ')
Check "the series list still holds exactly the six backups" ((Get-LocalNames).Count -eq 6) ((Get-LocalNames).Count)
Check "a .sql.incomplete is not a safety copy, so it can never be copied as one" (-not (@($safety | ForEach-Object { $_.Name }) -contains 'townreporter_2026-09-26_0205.sql.incomplete'))
Check "the binary .dump would be refused by the dump-completeness check, which is why that check is not run on these" ((Test-TownReporterDumpComplete -Path $handDump).Ok -eq $false) (Test-TownReporterDumpComplete -Path $handDump).Reason

$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
Check "the run is Ok" ($run.Ok -eq $true) $run.Reason
Check "the series itself still went over, all six verified" ($run.State.offsiteVerified -eq 6) $run.State.offsiteVerified
Check "the receipt gives the safety copies a line of their own" (@($run.Lines | Where-Object { $_ -match 'other safety copies are in' }).Count -eq 1) ((@($run.Lines)) -join ' | ')
Check "the other-safety-copies folder was made under the offsite folder" ($text -match 'made .*other-safety-copies for the other safety copies')
# Read the list into a variable first, for the same unary-comma reason: piping
# or @()-wrapping the call itself hands the pipeline one item that IS the
# array, so a Where-Object over it would look at the array and not the names.
$safetyNames = Get-OffsiteSafetyNames
Check "both of them are now in that folder" ((($safetyNames | Sort-Object) -join ',') -eq 'before-the-migration.sql,old-custom-format.dump') ($safetyNames -join ', ')
Check "the .sql on the other drive is the same bytes as the one here" ((Test-TownReporterCopyMatches -Source $handSql -Dest (Join-Path $script:offsite 'other-safety-copies\before-the-migration.sql')) -eq $true)
Check "and so is the .dump" ((Test-TownReporterCopyMatches -Source $handDump -Dest (Join-Path $script:offsite 'other-safety-copies\old-custom-format.dump')) -eq $true)
Check "the receipt says how many of them are over there" ($text -match 'all 2 of 2 other safety copies are in')
Check "nothing that is not a .sql or a .dump was copied" ($safetyNames.Count -eq 2) ($safetyNames -join ', ')
Check "no half-copied .partial is left behind" (@($safetyNames | Where-Object { $_ -like '*.partial' }).Count -eq 0) ($safetyNames -join ', ')
Check "the .incomplete stays on this machine only" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\townreporter_2026-09-26_0205.sql.incomplete')))
Check "the note stays on this machine only" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\notes.txt')))

# A second run hashes what is over there and copies nothing.
$again = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
Check "a second run copies neither of them again -- it found them identical" ($text -match 'all 2 of 2 other safety copies are in .* \(0 copied now, 2 already there\)')
Check "and that run is Ok too" ($again.Ok -eq $true) $again.Reason

# The keep-three rule is about the series. These are not in that series, on
# either side, and no number of them changes that.
$offsiteBefore = (Get-OffsiteSafetyNames).Count
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -Keep 1 -MinFreeGb 0
Check "the prune did its job on the series: five of the six went" ($prune.Ok -eq $true -and (Get-LocalNames).Count -eq 1) ((Get-LocalNames) -join ', ')
Check "the hand-named .sql is still on this machine" (Test-Path -LiteralPath $handSql -PathType Leaf)
Check "the hand-named .dump is still on this machine" (Test-Path -LiteralPath $handDump -PathType Leaf)
Check "neither of them is in the series list the prune works from" (-not ((Get-LocalNames) -contains 'before-the-migration.sql') -and -not ((Get-LocalNames) -contains 'old-custom-format.dump'))
Check "and nothing was deleted from the other drive" ((Get-OffsiteSafetyNames).Count -eq $offsiteBefore) ((Get-OffsiteSafetyNames).Count)

# A safety copy that cannot be copied is a failure, said out loud -- but it is
# not a reason to leave the backups uncopied, and it deletes nothing anywhere.
Reset-World "others-fail"
New-SixBackups
$handOnly = Join-Path $script:backupDir 'keep-this-one.sql'
[IO.File]::WriteAllText($handOnly, (New-FakeDumpText -Token 'SECONDhandSECONDhandSECONDhandSECONDhandSECONDhandSECONDhandSECON'), (New-Object Text.UTF8Encoding $false))
# A file where the folder needs to be: the folder cannot be made, so nothing
# can be copied into it, and the run has to say so instead of saying nothing.
Set-Content -LiteralPath (Join-Path $script:offsite 'other-safety-copies') -Value 'not a folder' -Encoding ASCII
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
Check "the run is not Ok" ($run.Ok -eq $false)
Check "it names the folder it could not make" ($run.Reason -match 'other-safety-copies folder could not be made') $run.Reason
Check "the state file records the copy as failing" ($run.State.offsiteOk -eq $false)
Check "the six backups still went over -- one un-copyable safety copy does not stop them" ($run.State.offsiteVerified -eq 6) $run.State.offsiteVerified
Check "the receipt says how many safety copies did not make it" ($text -match '1 of 1 other safety copies did not make it')
Check "the log says the folder could not be made, in the machine's own words" ($text -match 'NOT copying the 1 other safety copies')
Check "the hand-named file is still on this machine, untouched" (Test-Path -LiteralPath $handOnly -PathType Leaf)
Check "and nothing was deleted from this machine" ((Get-LocalNames).Count -eq 6) ((Get-LocalNames).Count)

# ---------------------------------------------------------------------------
Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "  backups and alerts: $($failures.Count) check(s) FAILED"
  Write-Host ""
  foreach ($f in $failures) { Write-Host "    - $f" }
  Write-Host ""
  exit 1
}
Write-Host "  backups and alerts: every check passed"
Write-Host ""

if (-not $Keep -and -not $WorkDir) {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
