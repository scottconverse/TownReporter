<#
  The proof that the backups are what the owner asked for -- "Keep 3 days of
  backups. No more. Delete the rest. and keep them on D: not C:" (2026-10-25)
  -- and an alert when any of that stops being true.

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
    * six local backups and an empty D: end with all six copied and verified,
      C: EMPTY, and D: holding exactly the newest backup of each of the 3
      newest days -- and the log shows each C: delete came after its D: copy
      verified
    * the D: rule itself: one per day (the newest of that day), for the 3
      newest days that HAVE a backup (gaps are skipped, not counted), a broken
      newest file never takes a good day's place and is never deleted, two
      databases are counted apart, -KeepDays changes the number, and nothing
      that is not in the dated series is ever touched
    * a C: backup is deleted only once its own D: copy is proven (same size AND
      same SHA256); one that is not on D:, or whose D: copy is damaged, stays
      on C: and is named, while the verified ones still go
    * a local file that is not a complete dump is not copied, and so stays on
      C:; the run says which file and why
    * a missing D:, an unwritable D:, a D: short of room, and a D: setting that
      points at the C: folder itself (the same path, or a folder inside it) each
      delete NOTHING anywhere: the backup still runs, it stays on C:, and the
      state and the alert say "Nothing was deleted" in plain words
    * the "after 2 AM and older than 20 hours" rule reads D: too, so an empty
      C: with a fresh backup on D: does not start a dump, on a fake clock both
      as the rule itself and through a whole run
    * every other .sql and .dump in the local folder -- the hand-named one-off
      safety copies, files and folders -- is copied to
      <offsite>\other-safety-copies\ with the same .partial + size + SHA256 +
      rename discipline, is deleted from C: as soon as it is verified there (no
      waiting period), is deleted from D: once it has been there more than 3
      days, and is never touched by the series rules on either side
    * a dump that fails, or that fails the completeness check, is not left
      wearing a backup's name, and stops the run: the part of it pg_dump did
      write is logged (its size and its last 2 KB) and then deleted, and any
      .sql.incomplete an older version left in that folder goes with it
    * the nightly lock: two backups never run at once, a run can wait for one
      that is in flight, and a stale lock from a killed run is taken over
    * an alert fires once when it starts and once when it clears, and a run that
      was not asked about the paper cannot clear a paper-down alert
    * the daily-scan rule, on a fake clock and a fake scan row
    * the three backup conditions the nightly run and the button share -- the
      30-hour rule (newest of C: and D:), the copy verdict and the room left on
      D: -- reported the same way for a caller that wraps the call in @() and
      one that does not
    * the phone push is off until ALERT_NTFY_TOPIC is set: with no topic,
      nothing is sent anywhere

  NO DATABASE IS TOUCHED HERE, on any port. Every dump is a script block that
  writes a file (the -DumpCommand seam on New-TownReporterBackup), so this is
  safe on the machine that serves the paper and it is what CI runs. The one
  thing that is therefore NOT proven here is pg_dump itself: the real call was
  proven by hand on 2026-09-25 against a throwaway cluster on port 55432, and
  the file layout the completeness check keys on -- pg_dump 18.6's \restrict /
  \unrestrict pair, and the older "-- PostgreSQL database dump complete" trailer
  -- is what the fake dumps below are copied from. Neither real backup folder
  is ever read: "C:" and "D:" here are two folders in the temp world.

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

# Six backups, one per night, oldest first. D: keeps the newest three days;
# C: keeps none of them once they are verified on D:.
$script:stamps = @(
  '2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205',
  '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205'
)
function New-SixBackups {
  foreach ($s in $script:stamps) { Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null }
}
function Get-LocalNames {
  # Into a variable first: the list comes back as one array, and piped as is an
  # EMPTY array would reach ForEach-Object as a single item and come out as $null.
  $list = Get-TownReporterBackupList -Dir $script:backupDir
  return ,@($list | ForEach-Object { $_.Name })
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

# The dated series as it stands on D:, newest first -- only names that match
# <database>_YYYY-MM-DD_HHmm.sql, the same list every rule works from.
function Get-OffsiteSeries {
  param([string]$Dir = $script:offsite)
  $list = Get-TownReporterBackupList -Dir $Dir
  return ,@($list | ForEach-Object { $_.Name })
}

# The dump stubs. Every dump in this harness is one of these script blocks,
# handed to the real run through its -DumpCommand seam, so no pg_dump is ever
# launched and no database is ever touched.
$script:dumpCalls = 0
$dumpGood = { param($Path) $script:dumpCalls++; [IO.File]::WriteAllText($Path, (New-FakeDumpText -Token 'AUTOMATICrunAUTOMATICrunAUTOMATICrunAUTOMATICrunAUTOMATICrun'), (New-Object Text.UTF8Encoding $false)); return $true }
# Cut just after the last line of the dump body, on a line boundary, so the
# file ends with a newline (not "in the middle of a line") and the closing
# marker is simply not there -- a pg_dump that was killed before it finished.
$dumpCut = { param($Path) $t = New-FakeDumpText -Token 'CUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaCUTSHORTaC'; $body = $t.Substring(0, (Get-FakeDumpTailOffset -Text $t) + 2); $script:cutBytes = (New-Object Text.UTF8Encoding $false).GetByteCount($body); [IO.File]::WriteAllText($Path, $body, (New-Object Text.UTF8Encoding $false)); return $true }
$dumpNo = { param($Path) return $false }
$dumpThrow = { param($Path) throw 'there is no pg_dump on this machine' }

# ---------------------------------------------------------------------------
# 3. Copy to D:, then empty C:, then keep 3 days on D:.
# ---------------------------------------------------------------------------
Reset-World "prune"
Write-Host "  3. six local backups and an empty D: end with C: empty and 3 days on D:"
New-SixBackups
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
$text = Read-Log $script:log
Check "the whole run is Ok" ($run.Ok -eq $true) $run.Reason
Check "an -Offsite run reports that it took no dump" ($null -eq $run.DumpOk)
Check "the first run copied and verified every backup, not just the newest (all 6 of 6)" ($run.State.offsiteVerified -eq 6) ("verified " + $run.State.offsiteVerified)
Check "C: is EMPTY: every backup on it was verified on D: and then deleted" ((Get-LocalNames).Count -eq 0) ((Get-LocalNames) -join ', ')
Check "D: holds exactly three" ((Get-OffsiteSeries).Count -eq 3) ((Get-OffsiteSeries) -join ', ')
Check "the three on D: are the newest of each of the 3 newest days" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-OffsiteSeries) -join ', ')
$orderOk = $true
$orderDetail = ''
foreach ($s in $script:stamps) {
  $n = [regex]::Escape("townreporter_$s.sql")
  $v = [regex]::Match($text, "offsite copy: $n verified on")
  $d = [regex]::Match($text, "backup: prune: deleted $n \(")
  if (-not $v.Success -or -not $d.Success -or $d.Index -lt $v.Index) { $orderOk = $false; $orderDetail += " $s" }
}
Check "each one was deleted from C: only AFTER its own D: copy verified, in the log's own order" $orderOk ("out of order or missing:" + $orderDetail)
Check "the log says each C: delete was safe because the file is verified on D:" ($text -match 'prune: deleted townreporter_2026-09-20_0205\.sql \([\d.]+ MB\) from this machine -- it is verified on')
Check "the log says which D: files went and why" ($text -match 'offsite prune: deleted townreporter_2026-09-20_0205\.sql .* -- it is not the newest backup of one of the 3 newest days')
Check "the state file says none on C: and three on D:" ($run.State.localCount -eq 0 -and $run.State.offsiteCount -eq 3) ("local " + $run.State.localCount + ", D: " + $run.State.offsiteCount)
Check "the state file records the C: delete (6) and the D: delete (3)" ($run.State.prunedAt -and $run.State.prunedCount -eq 6 -and $run.State.offsitePrunedAt -and $run.State.offsitePrunedCount -eq 3) ("C: " + $run.State.prunedCount + ", D: " + $run.State.offsitePrunedCount)
Check "the state file says the newest backup is on D:, and names it" ($run.State.newestWhere -eq 'offsite' -and $run.State.newestName -eq 'townreporter_2026-09-25_0205.sql' -and $run.State.offsiteNewestName -eq 'townreporter_2026-09-25_0205.sql') ("" + $run.State.newestWhere + " " + $run.State.newestName)
Check "and nothing was held back" ($null -eq $run.State.pruneBlocked) ("" + $run.State.pruneBlocked)

$again = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a second run is Ok with an empty C:" ($again.Ok -eq $true) $again.Reason
Check "and leaves exactly the same three on D:" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-OffsiteSeries) -join ', ')
Check "and deletes nothing more from D:" ($again.State.offsitePrunedCount -eq 0) ("" + $again.State.offsitePrunedCount)
Check "and C: is still empty" ((Get-LocalNames).Count -eq 0)

# ---------------------------------------------------------------------------
# 3b. The D: rule on its own: one per day, the 3 newest days that have one.
# ---------------------------------------------------------------------------
Write-Host "  3b. D: keeps the newest backup of each of the 3 newest days that have one"
function Write-OffsiteDumps {
  param([string[]]$Stamps)
  foreach ($s in $Stamps) { Write-FakeDump -Dir $script:offsite -Stamp $s | Out-Null }
}

Reset-World "keepdays-perday"
Write-OffsiteDumps @('2026-09-22_1400', '2026-09-23_0205', '2026-09-23_1400', '2026-09-24_0205', '2026-09-24_1400', '2026-09-25_0205', '2026-09-25_1400')
# Things on D: that are not in the dated series, and must never be touched by it.
$handOnD = Join-Path $script:offsite 'before-the-migration.sql'
[IO.File]::WriteAllText($handOnD, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
$partialOnD = Join-Path $script:offsite 'townreporter_2026-09-01_0205.sql.partial'
[IO.File]::WriteAllText($partialOnD, 'half a copy', (New-Object Text.UTF8Encoding $false))
$copiesOnD = Join-Path $script:offsite 'other-safety-copies'
New-Item -ItemType Directory -Force -Path $copiesOnD | Out-Null
$oneOffOnD = Join-Path $copiesOnD 'townreporter_2026-09-01_0205.sql'
[IO.File]::WriteAllText($oneOffOnD, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
Check "two backups on one day: the newer of the two is the one kept, for each of the 3 newest days" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_1400.sql,townreporter_2026-09-24_1400.sql,townreporter_2026-09-23_1400.sql') ((Get-OffsiteSeries) -join ', ')
Check "the prune is Ok and says what it deleted (4)" ($kd.Ok -eq $true -and @($kd.Deleted).Count -eq 4) ("" + $kd.Reason + ' | ' + (@($kd.Deleted) -join ', '))
Check "a hand-named .sql on D: is not in the series and is left alone" (Test-Path -LiteralPath $handOnD -PathType Leaf)
Check "a .partial on D: is left alone" (Test-Path -LiteralPath $partialOnD -PathType Leaf)
Check "the other-safety-copies folder, even a file in it with a series name, is left alone" (Test-Path -LiteralPath $oneOffOnD -PathType Leaf)
$text = Read-Log $script:log
Check "the log has a summary line in plain words" ($text -match 'offsite prune: kept 3 on .* \(the newest of each of the 3 newest days\), deleted 4')

Reset-World "keepdays-gaps"
Write-OffsiteDumps @('2026-09-01_0205', '2026-09-10_0205', '2026-09-20_0205', '2026-09-25_0205')
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
Check "days with no backup are skipped, not counted: the 3 newest days that HAVE one are kept" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-20_0205.sql,townreporter_2026-09-10_0205.sql') ((Get-OffsiteSeries) -join ', ')
Check "so a week with no backups never empties D:" ((Get-OffsiteSeries).Count -eq 3)

Reset-World "keepdays-broken"
Write-OffsiteDumps @('2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205')
$brokenText = New-FakeDumpText
$brokenNewest = Join-Path $script:offsite 'townreporter_2026-09-26_0205.sql'
[IO.File]::WriteAllText($brokenNewest, $brokenText.Substring(0, [int]($brokenText.Length / 2)), (New-Object Text.UTF8Encoding $false))
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
$text = Read-Log $script:log
Check "a broken newest file on D: is never deleted (the newest is never deleted)" (Test-Path -LiteralPath $brokenNewest -PathType Leaf)
Check "and it does not take a good day's place: the 3 complete days are still kept" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-26_0205.sql,townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-OffsiteSeries) -join ', ')
Check "the log says the broken one does not count" ($text -match 'offsite prune: townreporter_2026-09-26_0205\.sql does not count toward the 3 days')

Reset-World "keepdays-allbroken"
foreach ($s in @('2026-09-24_0205', '2026-09-25_0205')) {
  [IO.File]::WriteAllText((Join-Path $script:offsite "townreporter_$s.sql"), $brokenText.Substring(0, [int]($brokenText.Length / 2)), (New-Object Text.UTF8Encoding $false))
}
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
Check "a D: with no complete backup at all has nothing deleted" ((Get-OffsiteSeries).Count -eq 2 -and @($kd.Deleted).Count -eq 0) ((Get-OffsiteSeries) -join ', ')

Reset-World "keepdays-twodbs"
Write-OffsiteDumps @('2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205')
foreach ($s in @('2026-09-12_0205', '2026-09-13_0205', '2026-09-14_0205', '2026-09-15_0205')) {
  [IO.File]::WriteAllText((Join-Path $script:offsite "otherdb_$s.sql"), (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
}
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
$names = (Get-OffsiteSeries) | Sort-Object
Check "two databases are counted apart: 3 days of each" (($names -join ',') -eq 'otherdb_2026-09-13_0205.sql,otherdb_2026-09-14_0205.sql,otherdb_2026-09-15_0205.sql,townreporter_2026-09-23_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-25_0205.sql') ($names -join ', ')

Reset-World "keepdays-five"
Write-OffsiteDumps @('2026-09-19_0205', '2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205')
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -KeepDays 5 -MinFreeGb 0
Check "-KeepDays 5 keeps five days" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql,townreporter_2026-09-22_0205.sql,townreporter_2026-09-21_0205.sql') ((Get-OffsiteSeries) -join ', ')

Reset-World "keepdays-lowspace"
Write-OffsiteDumps @('2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205', '2026-09-25_0205')
$kd = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 999999999
$text = Read-Log $script:log
Check "a D: short of room has NOTHING deleted from it" ($kd.Ok -eq $false -and (Get-OffsiteSeries).Count -eq 6) ("" + $kd.Reason)
Check "and the log says so in plain words" ($text -match 'offsite prune: NOT deleting anything -- .*below the .* GB limit; nothing is deleted from')

# ---------------------------------------------------------------------------
# 3c. Where is a backup now, and which one is the newest?
# ---------------------------------------------------------------------------
Reset-World "where"
Write-Host "  3c. the newest backup is the newest of C: and D:"
Check "with nothing on either drive there is no newest backup" ($null -eq (Get-TownReporterNewestBackup -BackupDir $script:backupDir -OffsiteDir $script:offsite))
$c24 = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-24_0205'
$d24 = Write-FakeDump -Dir $script:offsite -Stamp '2026-09-24_0205'
$best = Get-TownReporterNewestBackup -BackupDir $script:backupDir -OffsiteDir $script:offsite
Check "the same backup on both drives: C: is the answer (it is not on D: alone yet)" ($best.Where -eq 'local' -and $best.Path -eq $c24) ("" + $best.Where + ' ' + $best.Path)
$d25 = Write-FakeDump -Dir $script:offsite -Stamp '2026-09-25_0205'
$best = Get-TownReporterNewestBackup -BackupDir $script:backupDir -OffsiteDir $script:offsite
Check "a newer one on D: is the newest, and it says it is on D:" ($best.Where -eq 'offsite' -and $best.Name -eq 'townreporter_2026-09-25_0205.sql' -and $best.Dir -eq $script:offsite) ("" + $best.Where + ' ' + $best.Name + ' ' + $best.Dir)
$c26 = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-26_0205'
$best = Get-TownReporterNewestBackup -BackupDir $script:backupDir -OffsiteDir $script:offsite
Check "a newer one on C: (not copied yet) is the newest, and it says it is on this machine" ($best.Where -eq 'local' -and $best.Name -eq 'townreporter_2026-09-26_0205.sql') ("" + $best.Where + ' ' + $best.Name)
$best = Get-TownReporterNewestBackup -BackupDir $script:backupDir -OffsiteDir (Join-Path $script:world 'no-such-drive')
Check "a missing D: is not an error: the newest on C: is still found" ($best.Where -eq 'local' -and $best.Name -eq 'townreporter_2026-09-26_0205.sql')
Check "a backup still on C: is found on C:" ((Get-TownReporterBackupPath -Name 'townreporter_2026-09-24_0205.sql' -BackupDir $script:backupDir -OffsiteDir $script:offsite) -eq $c24)
Check "a backup only on D: is found on D:" ((Get-TownReporterBackupPath -Name 'townreporter_2026-09-25_0205.sql' -BackupDir $script:backupDir -OffsiteDir $script:offsite) -eq $d25)
Check "a backup on neither drive is not found, rather than given a made-up path" ($null -eq (Get-TownReporterBackupPath -Name 'townreporter_2026-09-01_0205.sql' -BackupDir $script:backupDir -OffsiteDir $script:offsite))

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
$text = Read-Log $script:log
Check "the run is not Ok" ($run.Ok -eq $false)
# Either wording is the same refusal: the folder is missing and was not made,
# or it is there and cannot be written to. Which one a path with a file for a
# parent produces is the filesystem's answer, not this run's.
Check "it says in plain words that the folder is not usable" ($run.Reason -match 'could not be created|cannot be written to') $run.Reason
Check "NOTHING was deleted from this machine" ((Get-LocalNames).Count -eq 6) ((Get-LocalNames).Count)
Check "the log says the C: prune deleted nothing, and that the backups stay on this machine" ($text -match 'prune: NOT deleting anything -- .*nothing is deleted and the backups stay on this machine')
Check "the state file records the copy as failing" ($run.State.offsiteOk -eq $false)
Check "the state file says why" ([bool]$run.State.offsiteReason)
Check "the state file says nothing was deleted, and why" ($run.State.pruneBlocked -match 'nothing is deleted') ("" + $run.State.pruneBlocked)
Check "the state file's name for the offsite folder is the one that failed" ($run.State.offsiteDir -eq (Join-Path $blocker "D")) $run.State.offsiteDir
Check "and it still says where the newest backup is: on this machine" ($run.State.newestWhere -eq 'local' -and $run.State.localCount -eq 6) ("" + $run.State.newestWhere + ' ' + $run.State.localCount)

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

# The nightly run itself, with D: still gone: the backup is still taken, it
# stays on C:, and nothing anywhere is deleted. It warns; it never blocks.
$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir (Join-Path $blocker "D") `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-26 02:30") -MinFreeGb 0
Check "with D: missing, tonight's backup is STILL taken" ($run.DumpOk -eq $true) $run.Reason
Check "it stays on this machine" (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-26_0230.sql') -PathType Leaf)
Check "and nothing was deleted: the six older ones are all still on C: too" ((Get-LocalNames).Count -eq 7) ((Get-LocalNames) -join ', ')
Check "the state file says the prune was held back" ([bool]$run.State.pruneBlocked) ("" + $run.State.pruneBlocked)
Check "and promote's 'the backup is at' points at C:, where it really is" ($run.State.lastPath -eq (Join-Path $script:backupDir 'townreporter_2026-09-26_0230.sql')) ("" + $run.State.lastPath)
$held4 = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile (Join-Path $script:app ".env") -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir (Join-Path $blocker "D") -MinFreeGb 1 -Now ([datetime]"2026-09-26 03:00")
$held4Failing = @($held4 | Where-Object { $_.Id -eq 'offsite-failing' })[0]
Check "the alert is on" ($held4Failing.Active -eq $true) $held4Failing.Detail
Check "and the alert says plainly that nothing was deleted and the backups are on C:" ($held4Failing.Detail -match 'Nothing was deleted; the backups stay on this machine \(C:\) until D: works again') $held4Failing.Detail
$held4Stale = @($held4 | Where-Object { $_.Id -eq 'backup-stale' })[0]
Check "a fresh backup on C: is not stale just because D: is gone" ($held4Stale.Active -eq $false) $held4Stale.Detail

# ---------------------------------------------------------------------------
# 5. D: short of room: nothing is deleted on either drive.
# ---------------------------------------------------------------------------
Reset-World "lowspace"
Write-Host "  5. an offsite drive with almost no room left"
New-SixBackups
Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0 | Out-Null
Check "the setup: C: is empty and D: has its three" ((Get-LocalNames).Count -eq 0 -and (Get-OffsiteSeries).Count -eq 3)
foreach ($s in @('2026-09-26_0205', '2026-09-27_0205')) { Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null }
# An extra old one on D:, so the D: rule has something it would delete.
Write-FakeDump -Dir $script:offsite -Stamp '2026-09-19_0205' | Out-Null
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 999999999
$text = Read-Log $script:log
Check "a C: prune with no room on the other drive deletes nothing" ($prune.Ok -eq $false)
Check "it says in plain words that the drive is below the limit" ($prune.Reason -match 'below the .* GB limit') $prune.Reason
Check "every local file is still there" ((Get-LocalNames).Count -eq 2)
Check "the log says the prune deleted nothing" ($text -match 'prune: NOT deleting anything')
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 999999999
$text = Read-Log $script:log
Check "a whole run with D: short of room is not Ok" ($run.Ok -eq $false) $run.Reason
Check "nothing was deleted from C:" ((Get-LocalNames).Count -eq 2) ((Get-LocalNames) -join ', ')
Check "and nothing was deleted from D:, not even the old extra one" ((Get-OffsiteSeries).Count -eq 4) ((Get-OffsiteSeries) -join ', ')
Check "the log says the D: prune deleted nothing" ($text -match 'offsite prune: NOT deleting anything')
Check "the state file says the prune was held back because of the room" ($run.State.pruneBlocked -match 'below the .* GB limit') ("" + $run.State.pruneBlocked)

# ---------------------------------------------------------------------------
# 6. A local file not verified on D: stays on C:; the verified ones still go.
# ---------------------------------------------------------------------------
Reset-World "unverified"
Write-Host "  6. local backups that are not on the other drive yet"
New-SixBackups
foreach ($s in @('2026-09-20_0205', '2026-09-21_0205', '2026-09-22_0205')) {
  Copy-Item -LiteralPath (Join-Path $script:backupDir ("townreporter_" + $s + ".sql")) -Destination (Join-Path $script:offsite ("townreporter_" + $s + ".sql"))
}
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
$text = Read-Log $script:log
Check "the prune is not Ok while three of the six are not on the other drive" ($prune.Ok -eq $false)
Check "it names how many are missing and which" ($prune.Reason -match '3 of 6 local backups are not verified') $prune.Reason
Check "the three verified ones were deleted from C:" (((@($prune.Deleted) | Sort-Object) -join ',') -eq 'townreporter_2026-09-20_0205.sql,townreporter_2026-09-21_0205.sql,townreporter_2026-09-22_0205.sql') (@($prune.Deleted) -join ', ')
Check "the three that are not on D: are still on C:" (((Get-LocalNames) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-LocalNames) -join ', ')
Check "the log names each one kept and why" ($text -match 'prune: kept townreporter_2026-09-25_0205\.sql on this machine -- it is not verified on')
Check "and nothing was copied or deleted on D: by the prune" ((Get-OffsiteSeries).Count -eq 3)

# ---------------------------------------------------------------------------
# 7. A half-copy left behind by a killed run, and a copy that no longer
#    matches. Neither may cost a backup.
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
Check "the file that was blocked was copied and verified with the rest of them" ($text -match 'offsite copy: townreporter_2026-09-20_0205\.sql verified on' -and $run.State.offsiteVerified -eq 6) ("verified " + $run.State.offsiteVerified)
Check "the leftover is gone rather than left sitting on the drive" (-not (Test-Path -LiteralPath $partialDir))
Check "C: is empty and D: has its three days" ((Get-LocalNames).Count -eq 0 -and (Get-OffsiteSeries).Count -eq 3) ("C: " + (Get-LocalNames).Count + ", D: " + ((Get-OffsiteSeries) -join ', '))

Write-Host "  7b. what 'same size and same SHA256' actually means"
$srcDir = Join-Path $script:world "src7b"
New-Item -ItemType Directory -Force -Path $srcDir | Out-Null
$srcPath = Write-FakeDump -Dir $srcDir -Stamp '2026-09-25_0205'
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
Reset-World "damaged"
# The same length, one byte different: this is what a copy damaged in place
# looks like, and it is the case a size-only check would wave through.
$victim = 'townreporter_2026-09-25_0205.sql'
$victimLocal = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-25_0205'
$victimOffsite = Join-Path $script:offsite $victim
$victimRef = Join-Path $script:world 'reference-copy.sql'
Copy-Item -LiteralPath $victimLocal -Destination $victimRef
Copy-Item -LiteralPath $victimLocal -Destination $victimOffsite
$flip = [IO.File]::ReadAllBytes($victimOffsite)
$flip[4000] = $flip[4000] -bxor 0x5A
[IO.File]::WriteAllBytes($victimOffsite, $flip)
Check "the damaged copy is no longer the same file" ((Test-TownReporterCopyMatches -Source $victimLocal -Dest $victimOffsite) -eq $false)

$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a run notices, copies it again, and verifies it" ($run.Ok -eq $true -and $run.State.offsiteVerified -eq 1) $run.Reason
Check "the copy on D: is the original's bytes again" ((Test-TownReporterCopyMatches -Source $victimRef -Dest $victimOffsite) -eq $true)
Check "and only THEN was it deleted from C:" (-not (Test-Path -LiteralPath $victimLocal) -and (Get-LocalNames).Count -eq 0)

# The same file back on C:, its D: copy damaged once more, and a second good
# backup beside it, then the C: prune on its own. The hash must be what says
# no for the damaged one, and it must not stop the good one from going.
Copy-Item -LiteralPath $victimRef -Destination $victimLocal
$flip = [IO.File]::ReadAllBytes($victimOffsite)
$flip[4000] = $flip[4000] -bxor 0x5A
[IO.File]::WriteAllBytes($victimOffsite, $flip)
$spare = Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-26_0205'
Copy-Item -LiteralPath $spare -Destination (Join-Path $script:offsite 'townreporter_2026-09-26_0205.sql')
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0
Check "a copy that no longer matches keeps its original on C:" ((Test-Path -LiteralPath $victimLocal -PathType Leaf) -and $prune.Ok -eq $false)
Check "it names how many are not verified and how many there are" ($prune.Reason -match '1 of 2 local backups are not verified') $prune.Reason
Check "the one that IS verified is deleted from C:" (-not (Test-Path -LiteralPath $spare) -and ((Get-LocalNames) -join ',') -eq $victim) ((Get-LocalNames) -join ', ')
Check "and nothing on D: was touched by the C: prune" ((Get-OffsiteSeries).Count -eq 2 -and (Test-TownReporterCopyMatches -Source $victimRef -Dest $victimOffsite) -eq $false)

# ---------------------------------------------------------------------------
# 8. A local file that is not a complete dump is not copied, so it stays.
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
Check "the five good ones were copied and verified" ($run.State.offsiteVerified -eq 5) ("verified " + $run.State.offsiteVerified)
Check "the truncated one was not copied" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'townreporter_2026-09-20_0205.sql')))
Check "the truncated one is still on this machine, and it is the only one there" (((Get-LocalNames) -join ',') -eq 'townreporter_2026-09-20_0205.sql') ((Get-LocalNames) -join ', ')
Check "the log says it stays because it is not verified on D:" ($text -match 'prune: kept townreporter_2026-09-20_0205\.sql on this machine -- it is not verified on')
Check "D: keeps its three days of good ones" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0205.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-OffsiteSeries) -join ', ')
Check "the state file records the copy as failing" ($run.State.offsiteOk -eq $false)

# ---------------------------------------------------------------------------
# 8b. A D: setting that is really the C: folder: nothing is deleted anywhere.
# ---------------------------------------------------------------------------
Write-Host "  8b. an offsite folder that is the local folder, or inside it"
Reset-World "samefolder"
New-SixBackups
$sep = Test-TownReporterBackupDirsSeparate -BackupDir $script:backupDir -OffsiteDir $script:backupDir
Check "the same folder for both is caught" ($sep.Ok -eq $false -and $sep.Reason -match 'is the same folder as the local one') $sep.Reason
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:backupDir `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a run whose D: is the C: folder is not Ok" ($run.Ok -eq $false) $run.Reason
Check "and every backup is still there -- not one 'verified against itself'" ((Get-LocalNames).Count -eq 6) ((Get-LocalNames) -join ', ')
Check "the state file says the prune was held back, and why" ($run.State.pruneBlocked -match 'same folder') ("" + $run.State.pruneBlocked)
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:backupDir -MinFreeGb 0
$offPrune = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:backupDir -MinFreeGb 0
Check "the C: prune refuses on its own, too" ($prune.Ok -eq $false -and @($prune.Deleted).Count -eq 0) $prune.Reason
Check "and so does the D: prune" ($offPrune.Ok -eq $false -and @($offPrune.Deleted).Count -eq 0) $offPrune.Reason
Check "six still there after all of that" ((Get-LocalNames).Count -eq 6)

$inside = Join-Path $script:backupDir 'D'
New-Item -ItemType Directory -Force -Path $inside | Out-Null
foreach ($n in (Get-LocalNames)) { Copy-Item -LiteralPath (Join-Path $script:backupDir $n) -Destination (Join-Path $inside $n) }
$sep = Test-TownReporterBackupDirsSeparate -BackupDir $script:backupDir -OffsiteDir $inside
Check "an offsite folder inside the local one is caught" ($sep.Ok -eq $false -and $sep.Reason -match 'is inside the local folder') $sep.Reason
$sep = Test-TownReporterBackupDirsSeparate -BackupDir $inside -OffsiteDir $script:backupDir
Check "and so is a local folder inside the offsite one" ($sep.Ok -eq $false -and $sep.Reason -match 'the local folder .* is inside the offsite folder') $sep.Reason
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $inside -MinFreeGb 0
Check "with a perfect copy of every file sitting there, the C: prune still deletes nothing" ($prune.Ok -eq $false -and (Get-LocalNames).Count -eq 6) $prune.Reason
$offPrune = Remove-TownReporterOffsiteOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $inside -MinFreeGb 0
Check "and the D: prune deletes nothing from it" ($offPrune.Ok -eq $false -and (Get-OffsiteSeries -Dir $inside).Count -eq 6) $offPrune.Reason
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $inside `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -MinFreeGb 0
Check "a whole run against it deletes nothing on either side" ((Get-LocalNames).Count -eq 6 -and (Get-OffsiteSeries -Dir $inside).Count -eq 6 -and (Test-Path -LiteralPath $inside -PathType Container)) ("C: " + (Get-LocalNames).Count + ", inside: " + (Get-OffsiteSeries -Dir $inside).Count)

# The same folder under another name -- a junction -- which no string compare
# can see. Made with no admin rights, and removed as a link (never recursed).
$link = Join-Path $script:world 'D-link'
$linkMade = $false
try { New-Item -ItemType Junction -Path $link -Target $script:backupDir -ErrorAction Stop | Out-Null; $linkMade = $true } catch { $linkMade = $false }
Check "a junction to the local folder can be made here (the premise of the next check)" $linkMade
if ($linkMade) {
  try {
    $sep = Test-TownReporterBackupDirsSeparate -BackupDir $script:backupDir -OffsiteDir $link
    Check "the local folder under another name (a junction) is caught" ($sep.Ok -eq $false -and $sep.Reason -match 'under another name') $sep.Reason
    $prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $link -MinFreeGb 0
    Check "and the C: prune deletes nothing through it" ($prune.Ok -eq $false -and (Get-LocalNames).Count -eq 6) $prune.Reason
  } finally {
    [IO.Directory]::Delete($link)
  }
}
Check "the local folder is intact after the link is gone" ((Get-LocalNames).Count -eq 6)
# ---------------------------------------------------------------------------
# 9. A dump that fails, and one that does not finish, stop the run.
# ---------------------------------------------------------------------------
Reset-World "dumprun"
Write-Host "  9. a dump that fails, and a dump that is cut short"

# One of the files the version of the library that kept failed dumps left
# behind. Planted before a run that WORKS, which is the point: the sweep is
# scoped to the moment a dump of this run's own failed, so a good run must
# leave this exactly where it is. The next run, the cut-short one, takes it.
$leftover = Join-Path $script:backupDir 'townreporter_2026-09-25_0235.sql.incomplete'
[IO.File]::WriteAllText($leftover, 'a dump that died under the older version of the library', (New-Object Text.UTF8Encoding $false))

$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:30") -MinFreeGb 0
Check "a dump that works is a backup" ($run.DumpOk -eq $true -and $run.Ok -eq $true) ($run.Reason)
Check "it put exactly one backup on D:, and C: is empty again" ((Get-OffsiteSeries).Count -eq 1 -and (Get-LocalNames).Count -eq 0) ("C: " + ((Get-LocalNames) -join ', ') + " | D: " + ((Get-OffsiteSeries) -join ', '))
Check "named for the minute it was taken" ((Get-OffsiteSeries) -contains 'townreporter_2026-09-25_0230.sql') ((Get-OffsiteSeries) -join ', ')
Check "it copied that one to the other drive" ((Get-OffsiteNames).Count -eq 1)
Check "the state file has the newest backup's name and size" ($run.State.lastName -eq 'townreporter_2026-09-25_0230.sql' -and $run.State.lastBytes -gt 100000)
Check "and the state file's path to it is the one on D:, where it really is now" ($run.State.lastPath -eq (Join-Path $script:offsite 'townreporter_2026-09-25_0230.sql')) ("" + $run.State.lastPath)
Check "the state file has no error on it" ($null -eq $run.State.lastError)
Check "a run whose dump worked sweeps nothing out of the folder" (Test-Path -LiteralPath $leftover -PathType Leaf)

$run = Invoke-TownReporterBackupRun -App $script:app -Force -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpCut `
  -Now ([datetime]"2026-09-25 02:40") -MinFreeGb 0
$text = Read-Log $script:log
Check "a dump cut short is not a backup" ($run.DumpOk -eq $false -and $run.Ok -eq $false)
Check "it says the closing marker is missing" ($run.Reason -match 'closing marker is missing') $run.Reason
Check "the cut-short file is NOT left wearing a backup's name" (-not (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-25_0240.sql') -PathType Leaf))
Check "the cut-short dump is deleted, not renamed and kept beside the others" `
  (-not (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-25_0240.sql.incomplete') -PathType Leaf)) `
  ((Get-ChildItem -LiteralPath $script:backupDir -File | ForEach-Object { $_.Name }) -join ', ')
Check "the .incomplete the old version left behind goes in the same breath" (-not (Test-Path -LiteralPath $leftover -PathType Leaf))
Check "no .incomplete file is left in the backup folder at all" `
  (@(Get-ChildItem -LiteralPath $script:backupDir -Filter '*.sql.incomplete' -File).Count -eq 0) `
  ((Get-ChildItem -LiteralPath $script:backupDir -File | ForEach-Object { $_.Name }) -join ', ')
$dropLines = @($text -split "`r?`n" | Where-Object { $_ -match 'dropping the failed dump' })
Check "the log says it dropped the failed dump, with the size pg_dump had reached" `
  ($dropLines.Count -eq 1 -and $dropLines[0] -match ('\b{0} bytes were written\b' -f $script:cutBytes)) `
  ($dropLines -join ' | ')
Check "the log shows the last 2 KB it saw, so a person can see how far pg_dump got" `
  ($dropLines.Count -eq 1 -and $dropLines[0] -match '(-- x{74} ){2,}' -and $dropLines[0].Length -ge 2000) `
  ("$($dropLines[0].Length) characters, ending: " + $dropLines[0].Substring([Math]::Max(0, $dropLines[0].Length - 40)))
Check "the log says the leftover went too, and how big it was" `
  ($text -match 'dropped the leftover failed dump townreporter_2026-09-25_0235\.sql\.incomplete \(\d+ bytes\)')
Check "the state file now carries the failure" ($run.State.lastError -match 'closing marker is missing')
Check "the good backup from a moment ago is still there (on D:) and still the newest" ((Get-OffsiteSeries).Count -eq 1 -and ((Get-OffsiteSeries) -contains 'townreporter_2026-09-25_0230.sql')) ((Get-OffsiteSeries) -join ', ')

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
Check "nothing was deleted and no backup was lost through any of that" ((Get-OffsiteSeries).Count -eq 1)

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
# 11. The rule: after 2 AM, and only if the newest backup -- on C: OR D: --
#     is over 20 hours old.
# ---------------------------------------------------------------------------
Reset-World "due"
Write-Host " 11. the 2 AM and 20 hour rule, on a fake clock"
$midnight = Test-TownReporterBackupDue -BackupDir $script:backupDir -OffsiteDir $script:offsite -Now ([datetime]"2026-09-25 01:30")
Check "at 1:30 in the morning it is not time" ($midnight.Due -eq $false)
Check "and it says why" ($midnight.Reason -match 'before 2 in the morning')

Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-25_0205' | Out-Null
$fresh = Test-TownReporterBackupDue -BackupDir $script:backupDir -OffsiteDir $script:offsite -Now ([datetime]"2026-09-25 02:10")
Check "at 2:10 with a five-minute-old backup it is not time" ($fresh.Due -eq $false)
Check "it says the newest backup is too new" ($fresh.Reason -match 'only 0.08 hour\(s\) old') $fresh.Reason

Write-FakeDump -Dir $script:backupDir -Stamp '2026-09-23_2300' | Out-Null
$late = Test-TownReporterBackupDue -BackupDir $script:backupDir -OffsiteDir $script:offsite -Now ([datetime]"2026-09-25 02:10")
Check "a backup from the night before last does not count as last night's" ($late.Due -eq $false)
Check "the age comes from the file name, not the file's own time" ($late.Newest -eq [datetime]"2026-09-25 02:05") ($late.Newest)

$emptyC = Join-Path $script:world "empty-dir"
$emptyD = Join-Path $script:world "empty-D"
New-Item -ItemType Directory -Force -Path $emptyD | Out-Null
$none = Test-TownReporterBackupDue -BackupDir $emptyC -OffsiteDir $emptyD -Now ([datetime]"2026-09-25 02:10")
Check "no backup on C: and none on D: is due" ($none.Due -eq $true)
Check "and it says there is none on either drive" ($none.Reason -match 'none on this machine and none on') $none.Reason
$none = Test-TownReporterBackupDue -BackupDir $emptyC -Now ([datetime]"2026-09-25 02:10")
Check "a caller that names no D: still gets an answer: due" ($none.Due -eq $true -and $none.Reason -match 'no backup has ever been taken here') $none.Reason

# The case this whole change hinges on: C: is empty, which is the normal state
# now, and last night's backup is on D:. That must NOT look like "no backup".
$onlyD = Join-Path $script:world "only-D"
New-Item -ItemType Directory -Force -Path $onlyD | Out-Null
Write-FakeDump -Dir $onlyD -Stamp '2026-09-25_0205' | Out-Null
$dOnly = Test-TownReporterBackupDue -BackupDir $emptyC -OffsiteDir $onlyD -Now ([datetime]"2026-09-25 02:10")
Check "an EMPTY C: with a five-minute-old backup on D: is NOT due -- no extra dump" ($dOnly.Due -eq $false) $dOnly.Reason
Check "it says the newest backup is on D:, and how old it is" ($dOnly.Where -eq 'offsite' -and $dOnly.Reason -match '\(on ' -and $dOnly.Reason -match 'only 0.08 hour\(s\) old') $dOnly.Reason
$dOnlyLate = Test-TownReporterBackupDue -BackupDir $emptyC -OffsiteDir $onlyD -Now ([datetime]"2026-09-25 22:30")
Check "and once that D: backup is over 20 hours old, it IS due" ($dOnlyLate.Due -eq $true) $dOnlyLate.Reason

Reset-World "duerun"
Write-Host " 11b. the same rule through a whole run, with C: emptied every time"
foreach ($s in @('2026-09-22_0205', '2026-09-23_0205', '2026-09-24_0205')) {
  Write-FakeDump -Dir $script:backupDir -Stamp $s | Out-Null
}
$callsBefore = $script:dumpCalls
$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 01:30") -MinFreeGb 0
$text = Read-Log $script:log
Check "run before 2 AM: no dump is taken" ($null -eq $run.DumpOk)
Check "and the file that would hold it was never even written" ($script:dumpCalls -eq $callsBefore)
Check "and the log says why" ($text -match 'not taking a backup: it is before 2 in the morning')
Check "no file was written for it on either drive" (-not (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-25_0130.sql')) -and -not (Test-Path -LiteralPath (Join-Path $script:offsite 'townreporter_2026-09-25_0130.sql')))
Check "the copy still ran: C: is empty and the three are on D:, and no backup was added anywhere" ((Get-LocalNames).Count -eq 0 -and (Get-OffsiteSeries).Count -eq 3) ("C: " + (Get-LocalNames).Count + ", D: " + ((Get-OffsiteSeries) -join ', '))

$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:30") -MinFreeGb 0
Check "run at 2:30 with yesterday's backup on D: only: a dump IS taken" ($run.DumpOk -eq $true) $run.Reason
Check "it is on D: in the same run, the oldest day went, and C: is empty again" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_0230.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql' -and (Get-LocalNames).Count -eq 0) ("C: " + ((Get-LocalNames) -join ', ') + " | D: " + ((Get-OffsiteSeries) -join ', '))

$callsBefore = $script:dumpCalls
Check "the setup for the next check: C: is empty" ((Get-LocalNames).Count -eq 0)
$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 02:35") -MinFreeGb 0
$text = Read-Log $script:log
Check "a run five minutes later, with C: EMPTY, takes no second backup" ($null -eq $run.DumpOk -and $script:dumpCalls -eq $callsBefore)
Check "because it saw the backup on D:, and the log says so" ($text -match 'not taking a backup: the newest backup \(on ')

$run = Invoke-TownReporterBackupRun -App $script:app -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -DumpCommand $dumpGood `
  -Now ([datetime]"2026-09-25 22:40") -MinFreeGb 0
Check "over 20 hours after the last one, a run takes the next backup" ($run.DumpOk -eq $true) $run.Reason
Check "and D: keeps only the newer of the two from that day" (((Get-OffsiteSeries) -join ',') -eq 'townreporter_2026-09-25_2240.sql,townreporter_2026-09-24_0205.sql,townreporter_2026-09-23_0205.sql') ((Get-OffsiteSeries) -join ', ')

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
# This fake D: shares the temp volume. Use a small explicit reserve so the
# fixture does not assume the CI host has the production 100 GB reserve free.
$conds = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $script:backupDir -StateFile $script:state -OffsiteDir $script:offsite -MinFreeGb 1 -Now $now
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
Check "it says how old the newest one is, and where, in the plain sentence the page shows" ($past30[0].Detail -match 'the newest backup is 30.1 hour' -and $past30[0].Detail -match '\(it is on this machine') $past30[0].Detail

# C: empty, which is the normal state now, and a backup on D: from eight
# hours ago: NOT stale. Read from C: alone, this is the alert that would fire
# every night with three days of backups sitting on D:.
$staleC = Join-Path $script:world "stale-empty-C"
$staleD = Join-Path $script:world "stale-D"
New-Item -ItemType Directory -Force -Path $staleC | Out-Null
New-Item -ItemType Directory -Force -Path $staleD | Out-Null
Write-FakeDump -Dir $staleD -Stamp '2026-09-25_0205' | Out-Null
$noState = Join-Path $script:world "no-state.json"
$dOnlyConds = Get-TownReporterBackupAlertConditions -App $script:app -EnvFile $envFile -BackupDir $staleC -StateFile $noState -OffsiteDir $staleD -MinFreeGb 1 -Now $now
Check "an EMPTY C: with an 8-hour-old backup on D: is not stale" ($dOnlyConds[0].Active -eq $false) $dOnlyConds[0].Detail
Check "and the sentence says the newest backup is on D:" ($dOnlyConds[0].Detail -match ('\(it is on ' + [regex]::Escape($staleD) + '\)')) $dOnlyConds[0].Detail

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
  identical, delete from C: only once verified -- with one deliberate difference: no
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
# Backdated past the 10-minute settle time (Get-TownReporterSafetyCopyList's
# in-progress guard, added for the one-off feature) so this section's runs see
# them as settled, not as something that might still be being written.
(Get-Item -LiteralPath $handSql).LastWriteTime = (Get-Date).AddHours(-1)
(Get-Item -LiteralPath $handDump).LastWriteTime = (Get-Date).AddHours(-1)
# Reference copies, kept outside both folders: once verified on D: the two
# are deleted from C:, so D: is checked against these.
$handSqlRef = Join-Path $script:world 'ref-before-the-migration.sql'
$handDumpRef = Join-Path $script:world 'ref-old-custom-format.dump'
Copy-Item -LiteralPath $handSql -Destination $handSqlRef
Copy-Item -LiteralPath $handDump -Destination $handDumpRef
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
Check "the .sql on the other drive is the same bytes as the one here" ((Test-TownReporterCopyMatches -Source $handSqlRef -Dest (Join-Path $script:offsite 'other-safety-copies\before-the-migration.sql')) -eq $true)
Check "and so is the .dump" ((Test-TownReporterCopyMatches -Source $handDumpRef -Dest (Join-Path $script:offsite 'other-safety-copies\old-custom-format.dump')) -eq $true)
Check "the receipt says how many of them are over there" ($text -match 'all 2 of 2 other safety copies are in')
Check "nothing that is not a .sql or a .dump was copied" ($safetyNames.Count -eq 2) ($safetyNames -join ', ')
Check "no half-copied .partial is left behind" (@($safetyNames | Where-Object { $_ -like '*.partial' }).Count -eq 0) ($safetyNames -join ', ')
Check "the .incomplete stays on this machine only" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\townreporter_2026-09-26_0205.sql.incomplete')))
Check "the note stays on this machine only" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\notes.txt')))
Check "both are gone from C: now that they are verified on D:" (-not (Test-Path -LiteralPath $handSql) -and -not (Test-Path -LiteralPath $handDump))
Check "the .partial files, the .incomplete and the note stay on C: -- they are not one-off copies" ((Test-Path -LiteralPath (Join-Path $script:backupDir 'half-written.sql.partial')) -and (Test-Path -LiteralPath (Join-Path $script:backupDir 'half-written.dump.partial')) -and (Test-Path -LiteralPath (Join-Path $script:backupDir 'townreporter_2026-09-26_0205.sql.incomplete')) -and (Test-Path -LiteralPath (Join-Path $script:backupDir 'notes.txt')))

# A second run has nothing of theirs left on C: to copy, and deletes nothing
# of theirs from D: -- they arrived there today.
$again = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
Check "a second run is Ok too" ($again.Ok -eq $true) $again.Reason
Check "and both are still on D:, the original's bytes" ((Test-TownReporterCopyMatches -Source $handSqlRef -Dest (Join-Path $script:offsite 'other-safety-copies\before-the-migration.sql')) -and (Test-TownReporterCopyMatches -Source $handDumpRef -Dest (Join-Path $script:offsite 'other-safety-copies\old-custom-format.dump')))

# The series rules never see a hand-named file, on either side: the C: series
# prune leaves one alone even when it is not on D: at all.
$handAfter = Join-Path $script:backupDir 'after-the-migration.sql'
[IO.File]::WriteAllText($handAfter, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
$offsiteBefore = (Get-OffsiteSafetyNames).Count
$prune = Remove-TownReporterBackupOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -Keep 0 -MinFreeGb 0
Check "the C: series prune leaves a hand-named .sql alone, even one not on D:" (Test-Path -LiteralPath $handAfter -PathType Leaf)
Check "it is not in the series list the prune works from" (-not ((Get-LocalNames) -contains 'after-the-migration.sql'))
Check "the prune only ever deleted dated-series names" (@(@($prune.Deleted) | Where-Object { $_ -notmatch '^townreporter_\d{4}-\d{2}-\d{2}_\d{4}\.sql$' }).Count -eq 0) (@($prune.Deleted) -join ', ')
Check "and nothing was deleted from the other drive" ((Get-OffsiteSafetyNames).Count -eq $offsiteBefore) ((Get-OffsiteSafetyNames).Count)

# A safety copy that cannot be copied is a failure, said out loud -- but it is
# not a reason to leave the backups uncopied, and it deletes nothing anywhere.
Reset-World "others-fail"
New-SixBackups
$handOnly = Join-Path $script:backupDir 'keep-this-one.sql'
[IO.File]::WriteAllText($handOnly, (New-FakeDumpText -Token 'SECONDhandSECONDhandSECONDhandSECONDhandSECONDhandSECONDhandSECON'), (New-Object Text.UTF8Encoding $false))
(Get-Item -LiteralPath $handOnly).LastWriteTime = (Get-Date).AddHours(-1)
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
# 16. A one-off FOLDER, not just a file (CF-unfinished-steps-sweep.md item 14 /
#     design/FEATURE-BACKLOG.md: configuration_..., output-...-swap, and the
#     rest of the real folders sitting in the live backups folder outside the
#     dated series -- never touched here, only the shape is copied).
# ---------------------------------------------------------------------------
function New-OneOffFolder {
  param([string]$Dir, [string]$Name, [int]$FileCount = 3)
  $path = Join-Path $Dir $Name
  New-Item -ItemType Directory -Force -Path $path | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $path "sub") | Out-Null
  for ($i = 0; $i -lt $FileCount; $i++) {
    $bytes = New-Object byte[] 4096
    for ($j = 0; $j -lt $bytes.Length; $j++) { $bytes[$j] = [byte](($i * 17 + $j) % 256) }
    $target = if ($i -eq 0) { Join-Path $path "file$i.dat" } else { Join-Path (Join-Path $path "sub") "file$i.dat" }
    [IO.File]::WriteAllBytes($target, $bytes)
  }
  Get-ChildItem -LiteralPath $path -File -Recurse | ForEach-Object { $_.LastWriteTime = (Get-Date).AddHours(-1) }
  return $path
}

Reset-World "folder"
Write-Host "  16. a hand-left FOLDER in the backups directory is a one-off item too"
New-SixBackups
$folderPath = New-OneOffFolder -Dir $script:backupDir -Name "pre-0.6.34-local-files-20260908-125442" -FileCount 3
$localNames16 = Get-LocalNames
$oneOffs16 = Get-TownReporterSafetyCopyList -Dir $script:backupDir -Exclude $localNames16
Check "the folder is seen as a one-off item, marked as a directory" ((@($oneOffs16 | Where-Object { $_.Name -eq 'pre-0.6.34-local-files-20260908-125442' }).IsDirectory) -eq $true)
Check "its file count is right (3 files, one nested)" ((@($oneOffs16 | Where-Object { $_.Name -eq 'pre-0.6.34-local-files-20260908-125442' }).FileCount) -eq 3)
# A reference copy, kept outside both folders: once verified on D: the
# folder is deleted from C:, so D: is checked against this.
$folderRef = Join-Path $script:world 'ref-folder16'
Copy-Item -LiteralPath $folderPath -Destination $folderRef -Recurse

$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
Check "the run is Ok" ($run.Ok -eq $true) $run.Reason
$offsiteFolder = Join-Path $script:offsite 'other-safety-copies\pre-0.6.34-local-files-20260908-125442'
Check "the folder now exists on the other drive" (Test-Path -LiteralPath $offsiteFolder -PathType Container)
Check "and it verifies file-by-file: same count, same bytes, same SHA256 each" ((Test-TownReporterFolderCopyMatches -Source $folderRef -Dest $offsiteFolder) -eq $true)
Check "the log calls it a folder, not a file" ($text -match 'the one-off folder pre-0\.6\.34-local-files-20260908-125442 \(3 file\(s\)')
Check "no .partial folder is left behind" (-not (Test-Path -LiteralPath ($offsiteFolder + '.partial')))
Check "and, verified, it is deleted from C:" (-not (Test-Path -LiteralPath $folderPath))
Check "the log says so" ($text -match 'one-off prune: deleted pre-0\.6\.34-local-files-20260908-125442 from this machine')

# A byte flipped inside the copy on D: must be caught -- count and total bytes
# alone would miss it, which is why every file is hashed individually.
$corrupted = Join-Path $offsiteFolder 'sub\file1.dat'
$bytes = [IO.File]::ReadAllBytes($corrupted)
$bytes[0] = $bytes[0] -bxor 0xFF
[IO.File]::WriteAllBytes($corrupted, $bytes)
Check "a single flipped byte inside the copy is caught (same count and bytes, different hash)" ((Test-TownReporterFolderCopyMatches -Source $folderRef -Dest $offsiteFolder) -eq $false)
# Restore it so the rest of this section's runs see a clean copy again.
$bytes[0] = $bytes[0] -bxor 0xFF
[IO.File]::WriteAllBytes($corrupted, $bytes)
Check "restoring the byte makes it verify again" ((Test-TownReporterFolderCopyMatches -Source $folderRef -Dest $offsiteFolder) -eq $true)

# ---------------------------------------------------------------------------
# 17. Skip anything that looks like it might still be being written.
# ---------------------------------------------------------------------------
Write-Host "  17. a one-off item that looks like it might still be being written is skipped, not copied"
Reset-World "settling"
New-SixBackups
# A file written moments ago: under the 10-minute settle time.
$freshSql = Join-Path $script:backupDir 'just-written.sql'
[IO.File]::WriteAllText($freshSql, (New-FakeDumpText -Token 'FRESHfileFRESHfileFRESHfileFRESHfileFRESHfileFRESHfileFRESHfil'), (New-Object Text.UTF8Encoding $false))
# A folder holding a .partial file: looks like a copy still in flight.
$busyFolder = Join-Path $script:backupDir 'output-0.6.51-pre-0.6.54-swap'
New-Item -ItemType Directory -Force -Path $busyFolder | Out-Null
[IO.File]::WriteAllBytes((Join-Path $busyFolder 'done.dat'), (New-Object byte[] 2048))
[IO.File]::WriteAllText((Join-Path $busyFolder 'still-copying.dat.partial'), 'not finished', (New-Object Text.UTF8Encoding $false))
Get-ChildItem -LiteralPath $busyFolder -File | ForEach-Object { $_.LastWriteTime = (Get-Date).AddHours(-1) }

$localNames17 = Get-LocalNames
$oneOffs17 = Get-TownReporterSafetyCopyList -Dir $script:backupDir -Exclude $localNames17
$freshItem = @($oneOffs17 | Where-Object { $_.Name -eq 'just-written.sql' })
$busyItem = @($oneOffs17 | Where-Object { $_.Name -eq 'output-0.6.51-pre-0.6.54-swap' })
Check "the fresh file is marked Skip -- it is under the 10-minute settle time" ($freshItem[0].Skip -eq $true) $freshItem[0].SkipReason
Check "the busy folder is marked Skip -- it holds a .partial file" ($busyItem[0].Skip -eq $true) $busyItem[0].SkipReason

$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
Check "the run is still Ok -- a skip is not a failure" ($run.Ok -eq $true) $run.Reason
Check "neither the fresh file nor the busy folder made it to the other drive yet" (-not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\just-written.sql')) -and -not (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\output-0.6.51-pre-0.6.54-swap')))
Check "the log says why the file was skipped" ($text -match "skipping the one-off just-written\.sql -- it was written")
Check "the log says why the folder was skipped" ($text -match "skipping the one-off output-0\.6\.51-pre-0\.6\.54-swap -- it holds 1 \.incomplete/\.partial file")
Check "both still sit untouched on this machine" ((Test-Path -LiteralPath $freshSql -PathType Leaf) -and (Test-Path -LiteralPath $busyFolder -PathType Container))

# Once they have settled (no longer fresh, no longer holding a .partial), the
# very next run picks them up -- nothing here is skipped forever.
(Get-Item -LiteralPath $freshSql).LastWriteTime = (Get-Date).AddHours(-1)
Remove-Item -LiteralPath (Join-Path $busyFolder 'still-copying.dat.partial') -Force
$run2 = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
Check "once settled, the file is copied on the very next run" (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\just-written.sql'))
Check "and so is the folder" (Test-Path -LiteralPath (Join-Path $script:offsite 'other-safety-copies\output-0.6.51-pre-0.6.54-swap') -PathType Container)
Check "and once verified on D:, both are gone from C:" (-not (Test-Path -LiteralPath $freshSql) -and -not (Test-Path -LiteralPath $busyFolder))

# ---------------------------------------------------------------------------
# 18. Pruning one-off items from C:: verified on D: is enough, at any age.
# ---------------------------------------------------------------------------
Write-Host "  18. a one-off item is deleted from C: as soon as it is verified on D: -- no waiting period"
Reset-World "oneoffprune"
New-SixBackups
$youngPath = New-OneOffFolder -Dir $script:backupDir -Name "configuration_2026-09-01_203359_live-recovery" -FileCount 2
$youngRef = Join-Path $script:world 'ref-young-folder'
Copy-Item -LiteralPath $youngPath -Destination $youngRef -Recurse
$oldSql = Join-Path $script:backupDir 'townreporter_acceptance_20260809_1805-final-1844.dump'
[IO.File]::WriteAllBytes($oldSql, (New-Object byte[] 8192))
(Get-Item -LiteralPath $oldSql).LastWriteTime = (Get-Date).AddDays(-30)
$oldRef = Join-Path $script:world 'ref-old.dump'
Copy-Item -LiteralPath $oldSql -Destination $oldRef

# Copy and prune happen in the same call (Invoke-TownReporterBackupRun always
# runs the one-off prune right after the copy), so both items -- a folder made
# an hour ago and a dump from 30 days ago -- are copied, verified, and only
# then deleted from C:, in this one run.
$run = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
$text = Read-Log $script:log
$youngOnD = Join-Path $script:offsite 'other-safety-copies\configuration_2026-09-01_203359_live-recovery'
$oldOnD = Join-Path $script:offsite 'other-safety-copies\townreporter_acceptance_20260809_1805-final-1844.dump'
Check "the run is Ok" ($run.Ok -eq $true) $run.Reason
Check "the folder is on D:, and it is the original's files" ((Test-TownReporterFolderCopyMatches -Source $youngRef -Dest $youngOnD) -eq $true)
Check "the old dump is on D:, and it is the original's bytes" ((Test-TownReporterCopyMatches -Source $oldRef -Dest $oldOnD) -eq $true)
Check "the folder made an hour ago is deleted from C: -- there is no age floor" (-not (Test-Path -LiteralPath $youngPath))
Check "the 30-day-old dump is deleted from C: too" (-not (Test-Path -LiteralPath $oldSql))
Check "the log says each was deleted because it is verified on D:" ($text -match 'one-off prune: deleted configuration_2026-09-01_203359_live-recovery from this machine -- it is verified on' -and $text -match 'one-off prune: deleted townreporter_acceptance_20260809_1805-final-1844\.dump from this machine -- it is verified on')
Check "the log never mentions a day floor" (-not ($text -match 'day floor'))
Check "the state file records the one-off prune (2)" ($run.State.oneOffPrunedAt -and $run.State.oneOffPrunedCount -eq 2) $run.State.oneOffPrunedCount
Check "the 30-day-old dump is NOT deleted from D: the run it arrived -- its 3 days on D: count from when it got there" (Test-Path -LiteralPath $oldOnD -PathType Leaf)
Check "and neither is the folder" (Test-Path -LiteralPath $youngOnD -PathType Container)
Check "the series was not touched by any of that (-Keep 10 keeps all six on C:)" ((Get-LocalNames).Count -eq 6)

$run2 = Invoke-TownReporterBackupRun -App $script:app -Offsite -BackupDir $script:backupDir -OffsiteDir $script:offsite `
  -LogFile $script:log -StateFile $script:state -LockFile $script:lock -Keep 10 -MinFreeGb 0
Check "a second run is still Ok" ($run2.Ok -eq $true) $run2.Reason
Check "and deletes nothing new from C:" ($run2.State.oneOffPrunedCount -eq 0) $run2.State.oneOffPrunedCount
Check "and both are still on D:" ((Test-Path -LiteralPath $oldOnD -PathType Leaf) -and (Test-Path -LiteralPath $youngOnD -PathType Container))

# A one-off item whose D: copy cannot be verified (corrupt, or never copied)
# is never pruned, no matter how old it is -- proven directly against
# Remove-TownReporterOneOffOld, the function the run above calls.
Write-Host "  18b. an item that is old but NOT verified on D: is left alone"
Reset-World "oneoffcorrupt"
New-SixBackups
$corruptDump = Join-Path $script:backupDir 'townreporter_acceptance_20260809_1805-final-1844.dump'
$goodBytes = New-Object byte[] 8192
for ($i = 0; $i -lt $goodBytes.Length; $i++) { $goodBytes[$i] = [byte]($i % 256) }
[IO.File]::WriteAllBytes($corruptDump, $goodBytes)
(Get-Item -LiteralPath $corruptDump).LastWriteTime = (Get-Date).AddDays(-30)
$copiesDir18 = Join-Path $script:offsite 'other-safety-copies'
New-Item -ItemType Directory -Force -Path $copiesDir18 | Out-Null
$badBytes = [byte[]]$goodBytes.Clone()
$badBytes[0] = $badBytes[0] -bxor 0xFF
[IO.File]::WriteAllBytes((Join-Path $copiesDir18 'townreporter_acceptance_20260809_1805-final-1844.dump'), $badBytes)
$seriesNames18 = Get-LocalNames
$prune18 = Remove-TownReporterOneOffOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -SeriesNames $seriesNames18 -MinAgeDays 14 -MinFreeGb 0
$text = Read-Log $script:log
Check "the prune run is Ok (blocking one item is not itself a run failure)" ($prune18.Ok -eq $true) $prune18.Reason
Check "the corrupt-on-D: item is NOT deleted, even though it is 30 days old" (Test-Path -LiteralPath $corruptDump -PathType Leaf)
Check "nothing was reported as pruned" (@($prune18.Deleted).Count -eq 0) (@($prune18.Deleted) -join ', ')
Check "the log says it is being kept because it is not verified yet" ($text -match "kept townreporter_acceptance_20260809_1805-final-1844\.dump -- not verified on .* yet")

# D: missing or short of room blocks the one-off prune entirely, same as the
# series prune -- nothing here is deleted while the only other copy of it
# cannot be proven safe.
Write-Host "  18c. a missing D: blocks the one-off prune, exactly like the series prune"
Reset-World "oneoffnodrive"
New-SixBackups
$oldDump18c = Join-Path $script:backupDir 'townreporter_acceptance_20260809_1805-final-1844.dump'
[IO.File]::WriteAllBytes($oldDump18c, (New-Object byte[] 8192))
(Get-Item -LiteralPath $oldDump18c).LastWriteTime = (Get-Date).AddDays(-30)
Remove-Item -LiteralPath $script:offsite -Recurse -Force
$missingBlocker = Join-Path $script:world "missing-drive"
Set-Content -LiteralPath $missingBlocker -Value 'a file, not a drive' -Encoding ASCII
$prune18c = Remove-TownReporterOneOffOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir (Join-Path $missingBlocker "D") -SeriesNames (Get-LocalNames) -MinAgeDays 14 -MinFreeGb 0
Check "the prune reports not Ok" ($prune18c.Ok -eq $false)
Check "and it deleted nothing" (@($prune18c.Deleted).Count -eq 0)
Check "the 30-day-old dump is still on this machine, untouched" (Test-Path -LiteralPath $oldDump18c -PathType Leaf)

# ---------------------------------------------------------------------------
# 19. One-off items on D: are deleted once they have been there over 3 days.
# ---------------------------------------------------------------------------
Write-Host "  19. a one-off item on D: is kept 3 days, counted from when it got there"
Reset-World "offsiteoneoff"
$copies19 = Join-Path $script:offsite 'other-safety-copies'
New-Item -ItemType Directory -Force -Path $copies19 | Out-Null
$now19 = Get-Date
function Set-ItemTimes19 {
  param([string]$Path, [datetime]$Written, [datetime]$Created)
  $item = Get-Item -LiteralPath $Path
  $item.LastWriteTime = $Written
  $item.CreationTime = $Created
}
$old19 = Join-Path $copies19 'old.sql'
[IO.File]::WriteAllText($old19, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
Set-ItemTimes19 -Path $old19 -Written $now19.AddDays(-5) -Created $now19.AddDays(-5)
$oldFolder19 = Join-Path $copies19 'oldfolder'
New-Item -ItemType Directory -Force -Path (Join-Path $oldFolder19 'sub') | Out-Null
[IO.File]::WriteAllBytes((Join-Path $oldFolder19 'a.dat'), (New-Object byte[] 2048))
[IO.File]::WriteAllBytes((Join-Path $oldFolder19 'sub\b.dat'), (New-Object byte[] 2048))
Get-ChildItem -LiteralPath $oldFolder19 -File -Recurse | ForEach-Object { $_.LastWriteTime = $now19.AddDays(-5); $_.CreationTime = $now19.AddDays(-5) }
# The folder's own CreationTime last: writing into it above does not change it,
# but setting it before the files were made would be setting it on nothing.
(Get-Item -LiteralPath $oldFolder19).CreationTime = $now19.AddDays(-5)
$young19 = Join-Path $copies19 'young.sql'
[IO.File]::WriteAllText($young19, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
Set-ItemTimes19 -Path $young19 -Written $now19.AddDays(-1) -Created $now19.AddDays(-1)
# Made 30 days ago, but only just put on D:: its 3 days start now.
$arrived19 = Join-Path $copies19 'arrived.sql'
[IO.File]::WriteAllText($arrived19, (New-FakeDumpText), (New-Object Text.UTF8Encoding $false))
Set-ItemTimes19 -Path $arrived19 -Written $now19.AddDays(-30) -Created $now19
$partial19 = Join-Path $copies19 'half.sql.partial'
[IO.File]::WriteAllText($partial19, 'half a copy', (New-Object Text.UTF8Encoding $false))
Set-ItemTimes19 -Path $partial19 -Written $now19.AddDays(-9) -Created $now19.AddDays(-9)
$note19 = Join-Path $copies19 'notes.txt'
[IO.File]::WriteAllText($note19, 'a note', (New-Object Text.UTF8Encoding $false))
Set-ItemTimes19 -Path $note19 -Written $now19.AddDays(-9) -Created $now19.AddDays(-9)
$series19 = Write-FakeDump -Dir $script:offsite -Stamp '2026-09-01_0205'
Set-ItemTimes19 -Path $series19 -Written $now19.AddDays(-9) -Created $now19.AddDays(-9)

$low19 = Remove-TownReporterOffsiteOneOffOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 999999999 -Now $now19
$text = Read-Log $script:log
Check "a D: short of room has no one-off deleted from it" ($low19.Ok -eq $false -and @($low19.Deleted).Count -eq 0 -and (Test-Path -LiteralPath $old19) -and (Test-Path -LiteralPath $oldFolder19)) $low19.Reason
Check "and the log says so" ($text -match 'offsite one-off prune: NOT deleting anything')

$p19 = Remove-TownReporterOffsiteOneOffOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0 -Now $now19
$text = Read-Log $script:log
Check "the prune is Ok and deleted exactly the two old items" ($p19.Ok -eq $true -and ((@($p19.Deleted) | Sort-Object) -join ',') -eq 'old.sql,oldfolder') ((@($p19.Deleted)) -join ', ')
Check "a file 5 days on D: is deleted" (-not (Test-Path -LiteralPath $old19))
Check "a folder 5 days on D: is deleted, whole" (-not (Test-Path -LiteralPath $oldFolder19))
Check "the log says why, with its age" ($text -match 'offsite one-off prune: deleted old\.sql from .* -- it is 5(\.\d)? day\(s\) old, past the 3-day keep')
Check "a file 1 day on D: is kept" (Test-Path -LiteralPath $young19 -PathType Leaf)
Check "a file made 30 days ago that only just arrived on D: is kept" (Test-Path -LiteralPath $arrived19 -PathType Leaf)
Check "a .partial is never this rule's to delete" (Test-Path -LiteralPath $partial19 -PathType Leaf)
Check "a file that is not a .sql or .dump is left alone" (Test-Path -LiteralPath $note19 -PathType Leaf)
Check "a dated-series backup in the D: root is not a one-off, at any age" (Test-Path -LiteralPath $series19 -PathType Leaf)

Reset-World "offsiteoneoff-none"
$none19 = Remove-TownReporterOffsiteOneOffOld -LogFile $script:log -BackupDir $script:backupDir -OffsiteDir $script:offsite -MinFreeGb 0 -Now (Get-Date)
Check "with no other-safety-copies folder on D: there is nothing to do, and that is Ok" ($none19.Ok -eq $true -and @($none19.Deleted).Count -eq 0) $none19.Reason

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
