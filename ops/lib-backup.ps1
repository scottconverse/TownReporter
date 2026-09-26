<#
  The one place a backup is taken, checked, copied to the second drive, and
  cleaned up. Used by ops\promote.ps1, ops\watchdog.ps1 (the nightly run) and
  ops\backup.ps1 (the Control page's "Back up now" button).

  Until 2026-09-25 a backup was a side effect of a promotion: promote.ps1 was
  the only file in the tree that ran pg_dump, and none of the seven scheduled
  tasks ran one. Promote has a backup check but no cadence, so the paper's only
  copy of itself was whatever the last promotion happened to leave behind, and
  the folder grew without limit -- 61 files, about 12.5 GB, none of it pruned
  and none of it off the system drive.

  What the owner asked for, in his words: "Keep ONLY 3 days worth and keep only
  the latest three on the server disk. Keep ALL backups (as long as there's
  room) on drive D: -- an 8 TB disk, half empty." Plus an alert when a backup
  has not happened, when the copy to D: is failing, and when D: is filling up.

  Four rules this file exists to keep, each of which is a way to lose data if
  it is written the other way round:

    1. A dump that does not END like a complete pg_dump is a failed backup. The
       caller is told so and must not treat the file as a backup. pg_dump
       writes a plain-SQL file whose last line is a closing marker; a full disk
       or a killed process leaves a file that looks like a backup by name and
       size and is not one. Such a file is renamed to "<name>.sql.incomplete",
       not deleted: out of the series so it cannot be copied or counted, still
       on disk so a person can look at it. The newest two of those are kept.
    2. Nothing is deleted locally until every local file is proven identical on
       D: -- same length AND same SHA256. A delete is the one operation here
       that cannot be undone, so it goes last and only after a proof.
    3. Nothing is ever deleted from D:. Pruning there is the owner's business
       ("keep ALL backups as long as there's room"), and the one-time copy of
       the existing 61 files is his to run.
    4. Any failure between here and D: -- the drive missing, not writable, or a
       copy that does not verify -- deletes NOTHING and returns a reason the
       caller turns into an alert. Failing closed on a backup is not a
       conservative choice, it is the only safe one.

  Copy-then-verify-then-rename: a copy goes to "<name>.partial" and is hashed
  there; only a verified file is moved onto its real name. A bad copy therefore
  never wears a backup's name on D:, and a good copy already on D: is never
  overwritten with a bad one.

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI, so a non-ASCII byte
  becomes mojibake and can truncate the line. Every string here is ASCII.

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-backup.ps1")
    $result = Invoke-TownReporterBackupRun -App $app
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

# --- Plain-words logging ---------------------------------------------------
<#
  Callers pass the log file they already keep: promote.ps1 and ops\backup.ps1
  use logs\backup.log, the watchdog passes its own logs\watchdog.log, so a run
  reads in one place in order.

  "backup: " is prefixed by the caller, not here, because the watchdog wants
  its lines to sit with the rest of that run's lines.
#>
function Write-TownReporterBackupLog {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (-not $LogFile) { return }
  try {
    $dir = Split-Path -Parent $LogFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $line = "{0} backup: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding ASCII
  } catch {
    # A log that cannot be written is not a reason to fail a backup.
  }
}

# The same instant, written the one way the rest of the tree writes times:
# ISO 8601 UTC. The Control page does the local-12-hour rendering, because this
# process is not the one that knows the reader's clock.
function Get-TownReporterIsoTime {
  param([datetime]$Time = (Get-Date))
  return $Time.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
}

# --- Where the backups live ------------------------------------------------
<#
  The local folder is the app folder's sibling, which is what promote.ps1 has
  always used (line 118) and what the existing 61 files are already in. Moving
  it would orphan them, so it stays exactly where it is.
#>
function Get-TownReporterBackupDir {
  param([string]$App = (Split-Path -Parent $PSScriptRoot))
  return (Join-Path (Split-Path -Parent $App) "townreporter-backups")
}

# The offsite folder, from BACKUP_OFFSITE_DIR in the app's .env. Default is
# D:\TownReporter-backups: the 8 TB drive, half empty, and the half that would
# survive losing the system disk.
function Get-TownReporterBackupOffsiteDir {
  param(
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$EnvFile,
    [string]$Fallback = 'D:\TownReporter-backups'
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  return (Read-OpsEnvValue -EnvFile $EnvFile -Name 'BACKUP_OFFSITE_DIR' -Fallback $Fallback)
}

# The name promote.ps1 has always used: <database>_YYYY-MM-DD_HHmm.sql, to the
# minute. Kept identical so the new nightly run's files sit in the same series
# and the Control page can read a time straight out of the name.
function Get-TownReporterBackupName {
  param(
    [Parameter(Mandatory = $true)][string]$Database,
    [datetime]$Now = (Get-Date)
  )
  return ("{0}_{1}.sql" -f $Database, $Now.ToString('yyyy-MM-dd_HHmm', [Globalization.CultureInfo]::InvariantCulture))
}

# --- Reading a folder of backups -------------------------------------------
<#
  Only files that look like this series' output are in the list: <db>_<stamp>.sql.
  Anything else in the folder -- a half-written .partial, a note, someone's
  stray export -- is invisible here, and invisibility is the point: the prune
  step can only delete what this function hands it.
#>
function Get-TownReporterBackupList {
  param([Parameter(Mandatory = $true)][string]$Dir)
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Dir)) { return @() }
  $pattern = '^(?<db>.+)_(?<stamp>\d{4}-\d{2}-\d{2}_\d{4})\.sql$'
  foreach ($file in @(Get-ChildItem -LiteralPath $Dir -Filter '*.sql' -File -ErrorAction SilentlyContinue)) {
    $m = [regex]::Match($file.Name, $pattern)
    if (-not $m.Success) { continue }
    $stamp = $null
    try {
      $stamp = [datetime]::ParseExact($m.Groups['stamp'].Value, 'yyyy-MM-dd_HHmm', [Globalization.CultureInfo]::InvariantCulture)
    } catch {
      continue
    }
    [void]$out.Add([pscustomobject]@{
      Name    = $file.Name
      Path    = $file.FullName
      Bytes   = $file.Length
      Stamp   = $stamp
      Written = $file.LastWriteTime
    })
  }
  <#
    The comma matters, and it is not decoration. "return @(...)" is not enough
    to hand back an array: the return value goes out through the function's
    output stream, which ENUMERATES it, so a folder holding exactly one backup
    comes back as a bare PSCustomObject -- and a bare PSCustomObject has no
    .Count at all in Windows PowerShell 5.1 ($null, not 1). Measured on
    2026-09-25: with one file in the folder, $local.Count -gt 0 was false and
    the due rule reported "no backup has ever been taken here" while the file
    sat right there. The unary comma writes the array as one object, so callers
    get an array of one and .Count is always a real number.
  #>
  return ,@($out | Sort-Object -Property Stamp -Descending)
}

# --- Is this dump finished? ------------------------------------------------
<#
  THE check this whole change is built around. Read the last few kilobytes and
  the first few, and refuse anything that does not END the way a complete
  pg_dump plain-SQL file ends.

  What pg_dump 18.6 actually writes, measured on this machine 2026-09-25 with
  od -c on the last 100 bytes:

    5th line:   \restrict <64-char token>
    last lines: --
                -- PostgreSQL database dump complete
                --
                (blank)
                \unrestrict <the same 64-char token>
                (blank)

  So the decisive test is the closer: the last non-empty line must be
  \unrestrict <token>, and when the head carries a \restrict <token> the two
  must be the SAME token -- a dump spliced from two sources or overwritten
  mid-file fails that. The classic "-- PostgreSQL database dump complete"
  trailer is accepted on its own for any pg_dump older than the 17/18 pair that
  introduced restrict/unrestrict.

  A truncated file is the failure this catches, and it is the one that matters:
  pg_dump killed by a full disk, a shutdown or the 2-hour task limit leaves a
  file with a backup's name and a fraction of its bytes, and the only thing
  that distinguishes it from a good backup is how it ends.

  The minimum size is the same 100000 bytes promote.ps1 has always refused
  below, kept because it is the check that has been running on this machine.
#>
function Test-TownReporterDumpComplete {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [long]$MinBytes = 100000,
    [int]$SliceBytes = 8192
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return @{ Ok = $false; Reason = "there is no file at $Path" }
  }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -le 0) {
    return @{ Ok = $false; Reason = "the file is empty" }
  }
  if ($item.Length -lt $MinBytes) {
    return @{ Ok = $false; Reason = ("the file is only {0} bytes, which is too small to be a complete dump of this database (the floor is {1} bytes)" -f $item.Length, $MinBytes) }
  }

  $head = Read-TownReporterFileSlice -Path $Path -Offset 0 -Count $SliceBytes
  $tailLength = [int][math]::Min([long]$SliceBytes, $item.Length)
  $tail = Read-TownReporterFileSlice -Path $Path -Offset -$tailLength -Count $tailLength
  if (-not $tail) {
    return @{ Ok = $false; Reason = "the end of the file could not be read" }
  }

  # Every complete pg_dump ends with a newline. A file that stops mid-line was
  # cut off mid-write, which is a different thing from a file missing its
  # marker and worth catching on its own.
  if (-not $tail.EndsWith("`n")) {
    return @{ Ok = $false; Reason = "the file stops in the middle of a line, so the dump was cut short" }
  }

  $restrict = ''
  $rm = [regex]::Match($head, '(?m)^\\restrict\s+(\S+)\s*$')
  if ($rm.Success) { $restrict = $rm.Groups[1].Value }

  $unrestrict = ''
  $um = [regex]::Match($tail, '(?m)^\\unrestrict\s+(\S+)\s*$')
  if ($um.Success) { $unrestrict = $um.Groups[1].Value }

  if ($unrestrict) {
    if ($restrict -and $restrict -ne $unrestrict) {
      return @{ Ok = $false; Reason = "the closing marker does not match the opening one, so the file is not one whole dump" }
    }
    return @{ Ok = $true; Reason = 'complete' }
  }

  if ([regex]::IsMatch($tail, '(?m)^-- PostgreSQL database dump complete\s*$')) {
    return @{ Ok = $true; Reason = 'complete' }
  }

  return @{ Ok = $false; Reason = "the dump's closing marker is missing, so the file was cut short before pg_dump finished" }
}

# A byte range of a file as text, without loading the whole thing: a dump is
# about 700 MB and this runs on every one of them, every night.
function Read-TownReporterFileSlice {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [long]$Offset = 0,
    [int]$Count = 8192
  )
  $stream = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $start = $Offset
    if ($start -lt 0) { $start = $stream.Length + $start }
    if ($start -lt 0) { $start = 0 }
    if ($start -ge $stream.Length) { return '' }
    $take = [int][math]::Min([long]$Count, $stream.Length - $start)
    [void]$stream.Seek($start, [IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] $take
    $read = $stream.Read($buffer, 0, $take)
    return [Text.Encoding]::UTF8.GetString($buffer, 0, $read)
  } catch {
    return ''
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

# --- The second drive ------------------------------------------------------
<#
  Free space, in GB, or $null when the drive cannot be read at all. A missing
  D: and a D: that is present but not ready both come back $null, which every
  caller treats as "do not delete anything".
#>
function Get-TownReporterDriveFreeGb {
  param([Parameter(Mandatory = $true)][string]$Dir)
  try {
    $root = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Dir))
    if (-not $root) { return $null }
    $drive = New-Object System.IO.DriveInfo $root
    if (-not $drive.IsReady) { return $null }
    return [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
  } catch {
    return $null
  }
}

<#
  Is the offsite folder there and writable? Creates it if it is not, because
  the first run on a fresh machine should just work; reports plainly if it
  cannot.

  Writability is proven by writing a file, not by asking for permissions --
  a drive can be mounted read-only, or full, or a network path can be gone.
#>
function Test-TownReporterOffsiteReady {
  param([Parameter(Mandatory = $true)][string]$Dir)
  $free = Get-TownReporterDriveFreeGb -Dir $Dir
  if (-not (Test-Path -LiteralPath $Dir)) {
    try {
      New-Item -ItemType Directory -Force -Path $Dir -ErrorAction Stop | Out-Null
    } catch {
      return @{ Ok = $false; FreeGb = $free; Reason = "$Dir is not there and could not be created ($($_.Exception.Message))" }
    }
  }
  $probe = Join-Path $Dir (".townreporter-write-test-{0}" -f $PID)
  try {
    Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII -ErrorAction Stop
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
  } catch {
    return @{ Ok = $false; FreeGb = $free; Reason = "$Dir is there but cannot be written to ($($_.Exception.Message))" }
  }
  if ($null -eq $free) {
    return @{ Ok = $false; FreeGb = $null; Reason = "$Dir is writable but its drive could not be read, so its free space is unknown" }
  }
  return @{ Ok = $true; FreeGb = $free; Reason = 'ready' }
}

<#
  SHA256 of a file as upper-case hex, or '' when it cannot be read at all.

  This calls System.Security.Cryptography directly instead of the Get-FileHash
  cmdlet, and that is not a style choice. Measured on this machine 2026-09-25:
  Windows PowerShell 5.1 inherits a PSModulePath that lists PowerShell 7's
  Modules folder ahead of Windows PowerShell's, that folder's
  Microsoft.PowerShell.Utility shadows the 5.1 one, and in a 5.1 session
  Get-FileHash then resolves to nothing -- `Get-FileHash` throws
  CommandNotFoundException while the same call with a clean PSModulePath works.
  Get-Command still LISTS the name, which is what makes it a trap: a
  verification step built on it would quietly return "these do not match" for
  every file and the backups would never be copied anywhere. The .NET call has
  no module to be missing.
#>
function Get-TownReporterFileHash {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = $null
  $sha = $null
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $bytes = $sha.ComputeHash($stream)
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').ToUpperInvariant()
  } catch {
    return ''
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($sha) { $sha.Dispose() }
  }
}

<#
  Are these two files the same file? Length first (cheap), then SHA256 -- the
  owner's rule is "same size AND same SHA256", and a size check alone is not a
  verification: two dumps of the same database truncated at the same byte are
  the same length and are not the same backup.
#>
function Test-TownReporterCopyMatches {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dest
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $Dest -PathType Leaf)) { return $false }
  try {
    $s = Get-Item -LiteralPath $Source
    $d = Get-Item -LiteralPath $Dest
    if ($s.Length -ne $d.Length) { return $false }
    $sh = Get-TownReporterFileHash -Path $Source
    $dh = Get-TownReporterFileHash -Path $Dest
    if (-not $sh -or -not $dh) { return $false }
    return ($sh -eq $dh)
  } catch {
    return $false
  }
}

<#
  Clear a leftover <name>.sql.partial from an earlier run that was killed
  mid-copy, and never throw while doing it.

  Remove-Item needs the care here for a measured reason: on a directory it
  cannot empty it does not raise a normal error, it throws a
  NullReferenceException that -ErrorAction SilentlyContinue does NOT suppress,
  and with the run's ErrorActionPreference of Stop that ends the whole backup
  with a stack trace instead of an alert. A stale partial that cannot be cleared
  is not a reason to abandon the backup, so the failure is logged and the run
  carries on to try the copy anyway -- the verification right after it decides,
  not this.
#>
function Remove-TownReporterStaleCopy {
  param(
    [string]$Path,
    [string]$LogFile
  )
  if (-not $Path) { return }
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    Remove-Item -LiteralPath $Path -Force -Recurse -ErrorAction Stop
    Write-TownReporterBackupLog $LogFile "offsite copy: cleared the leftover $([IO.Path]::GetFileName($Path)) from an earlier run"
  } catch {
    Write-TownReporterBackupLog $LogFile "offsite copy: could not clear the leftover $([IO.Path]::GetFileName($Path)) ($($_.Exception.Message)); trying the copy anyway"
  }
}

# --- Getting a failed dump out of the way ----------------------------------
<#
  A dump that failed or was cut short must not keep wearing a backup's name.
  It is not a backup, and if it stays named like one then three things go
  wrong at once, all of them silently:

    * Get-TownReporterBackupList hands it back as a backup, so the copy step
      tries to copy it, refuses (correctly), and reports the offsite copy as
      failing -- every night, from then on, over a file that is never going to
      get any better.
    * The prune refuses to delete anything at all while one local file is
      unverified, so the folder on C: grows without limit.
    * The "last backup" on the Control page is a file that is not a backup.

  So it is renamed to <name>.sql.incomplete: still on disk, still whole, still
  there for a person to look at, and no longer part of the backup series. An
  operator can read the size and the tail of the file and see exactly how far
  pg_dump got.

  The newest two of these are kept and the rest are dropped, because a database
  that is down at 2 AM is asked again every five minutes: without a cap, a
  pg_dump that wrote 300 MB before dying would leave 300 MB behind 288 times in
  one night. Dropping an old one of these is not the "never delete a backup"
  rule being bent -- a file here is the output of a dump that FAILED, which is
  the one thing in this file that is provably not a backup.
#>
function Move-TownReporterFailedDump {
  param(
    [string]$Path,
    [string]$LogFile
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $bad = $Path + '.incomplete'
  try {
    Move-Item -LiteralPath $Path -Destination $bad -Force -ErrorAction Stop
    Write-TownReporterBackupLog $LogFile "the failed dump was kept for inspection as $bad"
    # Keep the newest two and no more. A Postgres that is down at 2 AM is asked
    # again every five minutes, and a failing pg_dump that wrote 300 MB before
    # it died would otherwise leave 300 MB behind 288 times over one night.
    # These were never backups -- they are the output of dumps that failed -- so
    # deleting the old ones is not the "never delete a backup" rule being bent.
    try {
      $dir = Split-Path -Parent $bad
      $old = @(Get-ChildItem -LiteralPath $dir -Filter '*.incomplete' -File -ErrorAction SilentlyContinue | Sort-Object -Property LastWriteTime -Descending | Select-Object -Skip 2)
      foreach ($item in $old) {
        Remove-Item -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue
        Write-TownReporterBackupLog $LogFile "dropped the older failed dump $($item.Name); the newest two are kept"
      }
    } catch { }
    return $bad
  } catch {
    Write-TownReporterBackupLog $LogFile "the failed dump could not be moved aside ($($_.Exception.Message)); it is still at $Path and is NOT a backup"
    return $null
  }
}

# --- Taking the backup -----------------------------------------------------
<#
  THE backup. promote.ps1's pg_dump call moved here unchanged: same executable,
  same flags, same file naming, same 100000-byte floor. Both callers get the
  same thing, which is the whole point of the file.

  The caller holds the lock (Enter-TownReporterBackupLock). This function does
  not take it, because the copy to D: and the prune that follow are part of the
  same unit of work and must not interleave with another run.

  A dump that fails, or that does not END like a complete pg_dump, is moved
  aside by Move-TownReporterFailedDump so it cannot be mistaken for a backup by
  the copy step or the prune. What is returned in that case is Ok = $false plus
  the plain reason -- the file is never deleted and never counted.

  -DumpCommand exists for the test harness in scripts\ci-backup.ps1: a script
  block that receives the path to write and returns $true or $false, so the
  harness can produce a good dump, a truncated one, and a failed one without a
  database. Production never passes it.
#>
function New-TownReporterBackup {
  param(
    [string]$LogFile,
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$BackupDir,
    [string]$EnvFile,
    [string]$PgBin = "$env:USERPROFILE\scoop\apps\postgresql\current\bin",
    [int]$PgPort = 5433,
    [string]$Database,
    [long]$MinBytes = 100000,
    [datetime]$Now = (Get-Date),
    [scriptblock]$DumpCommand
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  if (-not $BackupDir) { $BackupDir = Get-TownReporterBackupDir -App $App }

  # The database name, read the way promote.ps1 has always read it. Without a
  # DATABASE_URL there is nothing to dump, and saying so is more useful than a
  # pg_dump usage error.
  if (-not $Database) {
    $dbUrl = Read-OpsEnvValue -EnvFile $EnvFile -Name 'DATABASE_URL'
    if (-not $dbUrl) {
      Write-TownReporterBackupLog $LogFile "NOT backing up: there is no DATABASE_URL in $EnvFile, so there is nothing to back up"
      return @{ Ok = $false; Reason = "no DATABASE_URL in $EnvFile, so there is nothing to back up" }
    }
    $Database = ($dbUrl -split '/')[-1].Trim()
  }
  if (-not $Database) {
    Write-TownReporterBackupLog $LogFile "NOT backing up: the DATABASE_URL does not name a database"
    return @{ Ok = $false; Reason = 'the DATABASE_URL does not name a database' }
  }

  try {
    New-Item -ItemType Directory -Force -Path $BackupDir -ErrorAction Stop | Out-Null
  } catch {
    Write-TownReporterBackupLog $LogFile "NOT backing up: $BackupDir could not be created ($($_.Exception.Message))"
    return @{ Ok = $false; Reason = "$BackupDir could not be created ($($_.Exception.Message))" }
  }

  $name = Get-TownReporterBackupName -Database $Database -Now $Now
  $path = Join-Path $BackupDir $name
  $started = Get-Date

  if ($DumpCommand) {
    try {
      $ran = & $DumpCommand $path
    } catch {
      Move-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: the dump command threw $($_.Exception.Message)"
      return @{ Ok = $false; Reason = "the dump command threw $($_.Exception.Message)"; Name = $name; Path = $path }
    }
    if (-not $ran) {
      Move-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: the dump command reported failure"
      return @{ Ok = $false; Reason = 'the dump command reported failure'; Name = $name; Path = $path }
    }
  } else {
    $pgDump = Join-Path $PgBin 'pg_dump.exe'
    if (-not (Test-Path -LiteralPath $pgDump)) {
      Write-TownReporterBackupLog $LogFile "NOT backing up: there is no pg_dump at $pgDump"
      return @{ Ok = $false; Reason = "there is no pg_dump at $pgDump"; Name = $name; Path = $path }
    }
    # Same call promote.ps1 made: no -h, so it uses the same default the psql
    # probes use, and no --no-comments, which is why the completeness check can
    # look for pg_dump's own header wording.
    try {
      & $pgDump -p $PgPort -U postgres -d $Database -f $path
    } catch {
      Move-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: pg_dump would not run ($($_.Exception.Message))"
      return @{ Ok = $false; Reason = "pg_dump would not run ($($_.Exception.Message))"; Name = $name; Path = $path }
    }
    if ($LASTEXITCODE -ne 0) {
      Move-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: pg_dump exited $LASTEXITCODE"
      return @{ Ok = $false; Reason = "pg_dump exited $LASTEXITCODE"; Name = $name; Path = $path }
    }
  }

  $check = Test-TownReporterDumpComplete -Path $path -MinBytes $MinBytes
  if (-not $check.Ok) {
    $badBytes = (Get-Item -LiteralPath $path -ErrorAction SilentlyContinue).Length
    Write-TownReporterBackupLog $LogFile "$name FAILED: $($check.Reason)"
    $kept = Move-TownReporterFailedDump -Path $path -LogFile $LogFile
    return @{ Ok = $false; Reason = $check.Reason; Name = $name; Path = $path; KeptPath = $kept; Bytes = $badBytes }
  }

  $bytes = (Get-Item -LiteralPath $path).Length
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  Write-TownReporterBackupLog $LogFile ("$name written and complete: {0} MB in {1}s" -f [math]::Round($bytes / 1MB, 1), $seconds)
  return @{
    Ok      = $true
    Name    = $name
    Path    = $path
    Bytes   = $bytes
    Seconds = $seconds
    Reason  = 'complete'
  }
}

# --- Copying it to the second drive ---------------------------------------
<#
  Every local backup that is not already proven on D: is copied, not just the
  newest one -- the first run of this has to move all 61 of them, and a run
  that only ever copied the newest file could never catch up after a night the
  copy failed.

  Order of operations per file, and each step is load-bearing:

    1. Is the source complete? A truncated local dump is never copied, because
       copying it would put a corrupt file on the drive the owner is counting
       on. It is reported instead, which stops the prune, which raises an alert.
    2. Is it already there and identical? Then it is verified, not copied --
       the nightly hashing of three local files and their three copies is
       seconds, and it is what makes rule 2 in the header a proof rather than a
       hope.
    3. Is there room? D: is "as long as there's room", so a copy that would
       leave less than MinFreeGb is refused rather than filling the drive. The
       alert fires; nothing is deleted.
    4. Copy to <name>.partial, hash THAT, then rename onto the real name. A
       bad copy never appears under a backup's name, and a good copy already on
       D: is never replaced by a bad one.
#>
function Copy-TownReporterBackupOffsite {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [long]$MinFreeGb = 100
  )
  $ready = Test-TownReporterOffsiteReady -Dir $OffsiteDir
  if (-not $ready.Ok) {
    Write-TownReporterBackupLog $LogFile "offsite copy: NOT copying anything -- $($ready.Reason)"
    return @{ Ok = $false; Reason = $ready.Reason; Copied = 0; Verified = 0; Failed = 0; FreeGb = $ready.FreeGb }
  }

  $local = Get-TownReporterBackupList -Dir $BackupDir
  if ($local.Count -eq 0) {
    return @{ Ok = $true; Reason = 'there are no local backups to copy'; Copied = 0; Verified = 0; Failed = 0; FreeGb = $ready.FreeGb }
  }

  $copied = 0
  $verified = 0
  $failed = 0
  $firstFailure = ''
  $free = $ready.FreeGb

  # Oldest first, so a run that is cut off leaves the newest backups -- the
  # ones the prune will want to keep -- already on D:.
  foreach ($b in @($local | Sort-Object -Property Stamp)) {
    $dest = Join-Path $OffsiteDir $b.Name
    if (Test-TownReporterCopyMatches -Source $b.Path -Dest $dest) { $verified++; continue }

    $check = Test-TownReporterDumpComplete -Path $b.Path
    if (-not $check.Ok) {
      $failed++
      if (-not $firstFailure) { $firstFailure = "$($b.Name) is not a complete dump ($($check.Reason))" }
      Write-TownReporterBackupLog $LogFile "offsite copy: NOT copying $($b.Name) -- $($check.Reason)"
      continue
    }

    if ($null -ne $free -and ($free - ($b.Bytes / 1GB)) -lt $MinFreeGb) {
      $failed++
      if (-not $firstFailure) { $firstFailure = ("{0} was not copied because {1} would drop below {2} GB free" -f $b.Name, $OffsiteDir, $MinFreeGb) }
      Write-TownReporterBackupLog $LogFile ("offsite copy: NOT copying $($b.Name) -- {0} has only $free GB free and the limit is $MinFreeGb GB" -f $OffsiteDir)
      continue
    }

    $partial = $dest + '.partial'
    Write-TownReporterBackupLog $LogFile ("offsite copy: copying $($b.Name) ({0} MB) to $OffsiteDir" -f [math]::Round($b.Bytes / 1MB, 1))
    Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
    try {
      Copy-Item -LiteralPath $b.Path -Destination $partial -Force -ErrorAction Stop
    } catch {
      $failed++
      if (-not $firstFailure) { $firstFailure = "$($b.Name) could not be copied ($($_.Exception.Message))" }
      Write-TownReporterBackupLog $LogFile "offsite copy: $($b.Name) could not be copied: $($_.Exception.Message)"
      Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
      continue
    }

    if (-not (Test-TownReporterCopyMatches -Source $b.Path -Dest $partial)) {
      $failed++
      if (-not $firstFailure) { $firstFailure = "$($b.Name) did not verify after the copy (same size and SHA256 required)" }
      Write-TownReporterBackupLog $LogFile "offsite copy: $($b.Name) did NOT verify on $OffsiteDir -- the copy is discarded, nothing is deleted"
      Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
      continue
    }

    try {
      Move-Item -LiteralPath $partial -Destination $dest -Force -ErrorAction Stop
    } catch {
      $failed++
      if (-not $firstFailure) { $firstFailure = "$($b.Name) verified but could not be put in place ($($_.Exception.Message))" }
      Write-TownReporterBackupLog $LogFile "offsite copy: $($b.Name) verified but could not be put in place: $($_.Exception.Message)"
      Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
      continue
    }

    $copied++
    $verified++
    if ($null -ne $free) { $free = [math]::Round($free - ($b.Bytes / 1GB), 1) }
    Write-TownReporterBackupLog $LogFile "offsite copy: $($b.Name) verified on $OffsiteDir (same size and SHA256)"
  }

  $freeNow = Get-TownReporterDriveFreeGb -Dir $OffsiteDir
  if ($failed -gt 0) {
    Write-TownReporterBackupLog $LogFile "offsite copy: $failed of $($local.Count) did not make it ($firstFailure). Nothing will be deleted locally."
    return @{ Ok = $false; Reason = $firstFailure; Copied = $copied; Verified = $verified; Failed = $failed; FreeGb = $freeNow; Total = $local.Count }
  }
  Write-TownReporterBackupLog $LogFile "offsite copy: all $verified of $($local.Count) backups are on $OffsiteDir ($copied copied now, $($verified - $copied) already there)"
  return @{ Ok = $true; Reason = 'all verified'; Copied = $copied; Verified = $verified; Failed = 0; FreeGb = $freeNow; Total = $local.Count }
}

# --- Keeping three on the system disk -------------------------------------
<#
  Delete local backups beyond the newest Keep -- but only after every single
  local file is proven identical on D:, and only while D: has room. Both
  conditions, in that order, and neither is negotiable:

    - One unverified file means nothing is deleted. Not the unverified one and
      not the old ones either: if the copy path is broken, the local folder is
      the only copy of the paper that exists, and it stops being a spare.
    - D: below MinFreeGb means nothing is deleted either. The owner's rule is
      "as long as there's room" on D:, so the local folder stays as it is and
      the alert tells him.

  Returns the names it deleted so the caller can log them and put them in the
  state file -- a delete with no record of the name is a delete nobody can
  account for afterwards.
#>
function Remove-TownReporterBackupOld {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [int]$Keep = 3,
    [long]$MinFreeGb = 100
  )
  $empty = @{ Ok = $true; Deleted = @(); Kept = 0; Reason = 'nothing to prune'; FreeGb = $null }
  $local = Get-TownReporterBackupList -Dir $BackupDir
  if ($local.Count -eq 0) { return $empty }
  if ($local.Count -le $Keep) {
    return @{ Ok = $true; Deleted = @(); Kept = $local.Count; Reason = "only $($local.Count) local backup(s), which is not more than $Keep"; FreeGb = (Get-TownReporterDriveFreeGb -Dir $OffsiteDir) }
  }

  $ready = Test-TownReporterOffsiteReady -Dir $OffsiteDir
  if (-not $ready.Ok) {
    Write-TownReporterBackupLog $LogFile "prune: NOT deleting anything -- $($ready.Reason)"
    return @{ Ok = $false; Deleted = @(); Kept = $local.Count; Reason = $ready.Reason; FreeGb = $ready.FreeGb }
  }

  if ($null -eq $ready.FreeGb -or $ready.FreeGb -lt $MinFreeGb) {
    $reason = if ($null -eq $ready.FreeGb) { "$OffsiteDir free space could not be read" } else { ("{0} has only {1} GB free, below the {2} GB limit" -f $OffsiteDir, $ready.FreeGb, $MinFreeGb) }
    Write-TownReporterBackupLog $LogFile "prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Kept = $local.Count; Reason = $reason; FreeGb = $ready.FreeGb }
  }

  $unverified = New-Object System.Collections.ArrayList
  foreach ($b in $local) {
    if (-not (Test-TownReporterCopyMatches -Source $b.Path -Dest (Join-Path $OffsiteDir $b.Name))) {
      [void]$unverified.Add($b.Name)
    }
  }
  if ($unverified.Count -gt 0) {
    $reason = ("{0} of {1} local backups are not verified on {2} yet ({3}), so nothing is deleted" -f $unverified.Count, $local.Count, $OffsiteDir, ($unverified -join ', '))
    Write-TownReporterBackupLog $LogFile "prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Kept = $local.Count; Reason = $reason; FreeGb = $ready.FreeGb }
  }

  $deleted = New-Object System.Collections.ArrayList
  $failed = New-Object System.Collections.ArrayList
  foreach ($b in @($local | Select-Object -Skip $Keep)) {
    try {
      Remove-Item -LiteralPath $b.Path -Force -ErrorAction Stop
      [void]$deleted.Add($b.Name)
      Write-TownReporterBackupLog $LogFile ("prune: deleted $($b.Name) ({0} MB) -- it is verified on $OffsiteDir" -f [math]::Round($b.Bytes / 1MB, 1))
    } catch {
      [void]$failed.Add($b.Name)
      Write-TownReporterBackupLog $LogFile "prune: could not delete $($b.Name): $($_.Exception.Message)"
    }
  }

  if ($failed.Count -gt 0) {
    return @{ Ok = $false; Deleted = @($deleted); Kept = ($local.Count - $deleted.Count); Reason = "could not delete $($failed -join ', ')"; FreeGb = $ready.FreeGb }
  }
  Write-TownReporterBackupLog $LogFile "prune: kept the newest $Keep on C:, deleted $($deleted.Count) older one(s) that are verified on D:"
  return @{ Ok = $true; Deleted = @($deleted); Kept = $Keep; Reason = "kept the newest $Keep"; FreeGb = $ready.FreeGb }
}

# --- The lock --------------------------------------------------------------
<#
  One backup at a time. The watchdog's task already refuses to overlap itself
  (MultipleInstances IgnoreNew), but promote.ps1 and the Control page's
  "Back up now" button are operator actions that can land in the middle of a
  nightly run, and two pg_dumps at once on this machine is two 700 MB writes
  and two copies to the same names.

  A lock older than StaleMinutes is taken over rather than honoured: a run that
  was killed leaves the file behind, and a lock nobody can clear is a backup
  that never happens again. Taking over is logged, never silent.

  WaitSeconds is the difference between the two callers. The nightly run passes
  nothing and gives up at once -- the watchdog tries again in five minutes, and
  a promotion in progress will take its own backup anyway, so there is nothing
  to wait for. promote.ps1 waits, because a promotion that refuses to proceed
  merely because a nightly dump was mid-flight would take the paper down for no
  reason at all.
#>
function Enter-TownReporterBackupLock {
  param(
    [Parameter(Mandatory = $true)][string]$LockFile,
    [int]$StaleMinutes = 60,
    [int]$WaitSeconds = 0,
    [string]$LogFile
  )
  $dir = Split-Path -Parent $LockFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $waited = 0
  while ((Test-Path -LiteralPath $LockFile) -and $waited -lt $WaitSeconds) {
    if ($waited -eq 0) { Write-TownReporterBackupLog $LogFile "another backup is running; waiting up to $WaitSeconds second(s) for it" }
    Start-Sleep -Seconds 5
    $waited += 5
  }
  if (Test-Path -LiteralPath $LockFile) {
    $age = $null
    try { $age = [int]((Get-Date) - (Get-Item -LiteralPath $LockFile).LastWriteTime).TotalMinutes } catch { $age = $null }
    if ($null -ne $age -and $age -lt $StaleMinutes) {
      return @{ Ok = $false; Reason = "another backup has been running for $age minute(s)" }
    }
    Write-TownReporterBackupLog $LogFile "the backup lock is $age minute(s) old, which is stale; taking it over"
  }
  try {
    Set-Content -LiteralPath $LockFile -Value ("{0} {1}" -f $PID, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding ASCII -ErrorAction Stop
  } catch {
    return @{ Ok = $false; Reason = "the lock file $LockFile could not be written ($($_.Exception.Message))" }
  }
  return @{ Ok = $true; Reason = 'locked' }
}

function Exit-TownReporterBackupLock {
  param([Parameter(Mandatory = $true)][string]$LockFile)
  try { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue } catch { }
}

# --- The state file the Control page and the alerts read -------------------
<#
  logs\backup-state.json, written after every run. It exists so the Control
  page and the alert check can answer three questions without running anything:
  when the last backup succeeded, whether the offsite copy is working, and how
  much room is left on D:.

  It is deliberately not the only source for the cards: the page probes both
  folders itself, live. This file adds the things a folder listing cannot say
  (the last failure, the last verification, the free space at the time), and a
  missing or unreadable file degrades to "unknown", never to "fine".
#>
function Get-TownReporterBackupStatePath {
  param([string]$App = (Split-Path -Parent $PSScriptRoot))
  return (Join-Path $App 'logs\backup-state.json')
}

function Get-TownReporterBackupState {
  param(
    [string]$StateFile,
    [string]$App = (Split-Path -Parent $PSScriptRoot)
  )
  if (-not $StateFile) { $StateFile = Get-TownReporterBackupStatePath -App $App }
  $state = [ordered]@{
    updatedAt         = $null
    lastSuccessAt     = $null
    lastAttemptAt     = $null
    lastError         = $null
    skippedReason     = $null
    lastName          = $null
    lastBytes         = 0
    localCount        = 0
    localNewestAt     = $null
    offsiteDir        = $null
    offsiteOk         = $null
    offsiteReason     = $null
    offsiteVerified   = 0
    offsiteFreeGb     = $null
    offsiteAt         = $null
    prunedAt          = $null
    prunedCount       = 0
  }
  if (-not (Test-Path -LiteralPath $StateFile)) { return $state }
  try {
    $raw = Get-Content -LiteralPath $StateFile -Raw -ErrorAction Stop
    if (-not $raw) { return $state }
    $read = $raw | ConvertFrom-Json -ErrorAction Stop
    foreach ($key in @($state.Keys)) {
      if ($read.PSObject.Properties.Name -contains $key) { $state[$key] = $read.$key }
    }
  } catch {
    # A corrupt state file is reported as "nothing is known", which is what the
    # pages and the alerts already know how to say.
    $state['lastError'] = "the backup state file could not be read ($($_.Exception.Message))"
  }
  return $state
}

function Save-TownReporterBackupState {
  param(
    [string]$StateFile,
    [Parameter(Mandatory = $true)]$State,
    [string]$App = (Split-Path -Parent $PSScriptRoot)
  )
  if (-not $StateFile) { $StateFile = Get-TownReporterBackupStatePath -App $App }
  $dir = Split-Path -Parent $StateFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $State['updatedAt'] = Get-TownReporterIsoTime
  $json = $State | ConvertTo-Json -Depth 6
  # Written to a scratch name and moved into place, so a reader never catches
  # half a file: the Control page polls this every fifteen seconds.
  $temp = "$StateFile.tmp"
  [IO.File]::WriteAllText($temp, $json, (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $temp -Destination $StateFile -Force
  return $State
}

# --- Is it time? -----------------------------------------------------------
<#
  The owner asked for one backup a night, so the rule is a window and an age,
  not a cron entry: after Hour in the morning, and only if the newest backup is
  older than MaxAgeHours. Both must hold.

  The age is read from the FILE NAME's timestamp, not the file's own modified
  time: the name is the record of when the dump was taken, it survives a copy
  to another drive with its meaning intact, and it is what the folder of 61
  existing files already means.

  A promotion takes a backup too, and that backup counts -- this is a "the
  paper is at most a day old" rule, not a "the nightly ran" rule. A promotion
  at 11 PM therefore skips the 2 AM run, which is right: there is a four-hour
  old backup and taking another one changes nothing.
#>
function Test-TownReporterBackupDue {
  param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [datetime]$Now = (Get-Date),
    [int]$Hour = 2,
    [double]$MaxAgeHours = 20
  )
  $local = Get-TownReporterBackupList -Dir $BackupDir
  $newest = $null
  $ageHours = $null
  if ($local.Count -gt 0) {
    $newest = $local[0].Stamp
    $ageHours = [math]::Round(($Now - $newest).TotalHours, 2)
  }
  if ($Now.Hour -lt $Hour) {
    return @{ Due = $false; Newest = $newest; AgeHours = $ageHours; Reason = "it is before $Hour in the morning" }
  }
  if ($null -eq $ageHours) {
    return @{ Due = $true; Newest = $null; AgeHours = $null; Reason = 'no backup has ever been taken here' }
  }
  if ($ageHours -lt $MaxAgeHours) {
    return @{ Due = $false; Newest = $newest; AgeHours = $ageHours; Reason = "the newest backup is only $ageHours hour(s) old" }
  }
  return @{ Due = $true; Newest = $newest; AgeHours = $ageHours; Reason = "the newest backup is $ageHours hour(s) old" }
}

# --- Is the desk busy? -----------------------------------------------------
<#
  "skip if an editor job is running; try again next run". A draft in progress
  is the one moment a pg_dump is worth deferring -- it is a few hundred MB of
  write against the same disk the desk is writing to, and the paper is minutes
  from a promotion that takes its own backup anyway.

  Three answers, not two, and the caller treats them differently on purpose.
  'busy' is the only one that DEFERS the backup, because "an editor job is
  running" is the one true statement in the list. 'unknown' (no psql, or
  Postgres not answering) means the question could not be asked -- and a
  question that could not be asked is not a reason to skip the backup. Skipping
  on 'unknown' would mean one wrong psql path silently stops every backup on
  this machine for good, which is the exact failure this file was written to
  end. So 'unknown' attempts the dump: it either works, or it fails with a
  reason in the log and on the Control page within five minutes.

  Read-only, one SELECT, the same query promote.ps1's Get-OpenDeskJobs runs.
#>
function Test-TownReporterDeskBusy {
  param(
    [string]$EnvFile,
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$Psql,
    [int]$PgPort = 5433,
    [string]$Database
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  if (-not $Database) {
    $dbUrl = Read-OpsEnvValue -EnvFile $EnvFile -Name 'DATABASE_URL'
    if (-not $dbUrl) { return 'unknown' }
    $Database = ($dbUrl -split '/')[-1].Trim()
  }
  if (-not $Database) { return 'unknown' }
  if (-not $Psql) { $Psql = Join-Path "$env:USERPROFILE\scoop\apps\postgresql\current\bin" 'psql.exe' }
  if (-not (Test-Path -LiteralPath $Psql)) { return 'unknown' }
  try {
    $count = & $Psql -p $PgPort -U postgres -d $Database -tAc "select count(*) from desk_jobs where status in ('running','queued')"
    if ($LASTEXITCODE -ne 0) { return 'unknown' }
    $trimmed = ([string]$count).Trim()
    if ($trimmed -notmatch '^\d+$') { return 'unknown' }
    if ([int]$trimmed -gt 0) { return 'busy' }
    return 'free'
  } catch {
    return 'unknown'
  }
}

# --- The backup half of the alert list -------------------------------------
<#
  The three conditions about backups, built from what this machine can measure
  right now, in the shape ops\lib-alert.ps1 wants:

    @{ Id = 'backup-stale';       Active = $true; Detail = '...' }
    @{ Id = 'offsite-failing';    Active = $null }   # not judged this run
    @{ Id = 'offsite-low-space';  Active = $false }

  One function because three callers ask the same question -- the watchdog, the
  manual run, and the Control page's button -- and the day they disagree is the
  day one of them says the backups are fine while another says they are not.

  Active = $null is the honest answer for a condition this machine cannot
  judge: no backup has ever been taken, the state file does not exist yet, the
  offsite drive cannot be read at all. It means "say nothing, change nothing" --
  a run that cannot see the drive never CLEARS an alert that says the drive is
  broken.

  The three readings come from three different places on purpose:

    backup-stale      the local FOLDER, the same instrument Test-TownReporterBackupDue
                      uses, so the due rule and the alert can never disagree
                      about how old the newest backup is. lastSuccessAt is the
                      fallback for a folder someone has emptied by hand.
    offsite-failing   the STATE file, because only a copy attempt can say
                      whether a copy worked; this function has not tried one.
    offsite-low-space a LIVE read of the drive, through the same function the
                      copy and the prune obey. Room is a fact about the disk,
                      not about a copy, and a stale number here would be the one
                      warning that arrives after the disk is full.

  The age threshold is 30 hours and the due threshold is 20: the backup is meant
  to be at most a day old, so a machine that has missed one night should say so
  rather than being quietly told it is fine.
#>
function Get-TownReporterBackupAlertConditions {
  param(
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$EnvFile,
    [string]$BackupDir,
    [string]$OffsiteDir,
    [string]$StateFile,
    [double]$MaxAgeHours = 30,
    [long]$MinFreeGb = 100,
    [datetime]$Now = (Get-Date)
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  if (-not $BackupDir) { $BackupDir = Get-TownReporterBackupDir -App $App }
  if (-not $StateFile) { $StateFile = Get-TownReporterBackupStatePath -App $App }
  $state = Get-TownReporterBackupState -StateFile $StateFile
  if (-not $OffsiteDir) {
    $OffsiteDir = $state.offsiteDir
    if (-not $OffsiteDir) { $OffsiteDir = Get-TownReporterBackupOffsiteDir -App $App -EnvFile $EnvFile }
  }

  $conditions = New-Object System.Collections.ArrayList

  $newest = $null
  $local = Get-TownReporterBackupList -Dir $BackupDir
  if ($local.Count -gt 0) {
    $newest = $local[0].Stamp
  } elseif ($state.lastSuccessAt) {
    try {
      $newest = [datetime]::Parse(
        $state.lastSuccessAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal).ToLocalTime()
    } catch { $newest = $null }
  }
  if ($newest) {
    $ageHours = [math]::Round(($Now - $newest).TotalHours, 1)
    [void]$conditions.Add(@{
      Id     = 'backup-stale'
      Active = ($ageHours -gt $MaxAgeHours)
      Detail = ("the newest backup on this machine is {0} hour(s) old" -f $ageHours)
    })
  } else {
    [void]$conditions.Add(@{
      Id     = 'backup-stale'
      Active = $null
      Detail = 'no backup has ever been taken on this machine, so there is no last good one to be late'
    })
  }

  if ($null -ne $state.offsiteOk) {
    [void]$conditions.Add(@{
      Id     = 'offsite-failing'
      Active = (-not [bool]$state.offsiteOk)
      Detail = $(if ($state.offsiteOk) { "the copy to $OffsiteDir verified" } else { "${OffsiteDir}: $($state.offsiteReason)" })
    })
  } else {
    [void]$conditions.Add(@{
      Id     = 'offsite-failing'
      Active = $null
      Detail = 'no backup has run since this machine started keeping the state, so the copy has not been judged yet'
    })
  }

  $freeGb = Get-TownReporterDriveFreeGb -Dir $OffsiteDir
  if ($null -eq $freeGb) {
    [void]$conditions.Add(@{
      Id     = 'offsite-low-space'
      Active = $null
      Detail = "$OffsiteDir could not be read, so its free space is unknown"
    })
  } else {
    [void]$conditions.Add(@{
      Id     = 'offsite-low-space'
      Active = ($freeGb -lt $MinFreeGb)
      Detail = ("{0} has {1} GB free and this machine keeps {2} GB in reserve" -f $OffsiteDir, $freeGb, $MinFreeGb)
    })
  }

  <#
    The unary comma, for the same reason as Get-TownReporterBackupList above:
    three conditions is three, so a plain return would work today, but the day
    this is edited down to one condition a plain return hands back a bare
    hashtable and $result.Count is $null rather than 1.

    What a caller must NOT do is wrap the call in @(). Measured on 2026-09-25:
    @() around an array handed back this way does not flatten it -- it makes a
    ONE item list whose single item is the array of conditions (count 1, item
    type Object[]). Assign the result straight, or append it with +=, which
    concatenates an array properly. Test-TownReporterAlertTransition now
    flattens one level as well, so a caller that wraps anyway still gets its
    alerts, but the count it sees will still be 1.

    scripts\ci-backup.ps1 section 14 proves both the direct form and the += form.
  #>
  return ,@($conditions)
}

# --- The whole run ---------------------------------------------------------
<#
  Backup, copy to D:, prune C:. One function so the watchdog, the manual
  script and the Control page's button all do exactly the same thing in exactly
  the same order -- three callers with three slightly different orders is how
  the prune ends up running before the copy on one of them.

  -Offsite skips the dump and only does the copy and the prune, which is what
  ops\backup.ps1 -Offsite and the retry path after a failed copy use.

  Returns the state hashtable it also wrote, so a caller can hand it straight
  to the alert check, plus the two verdicts a caller has to tell apart:

    DumpOk   was a dump taken, and was it a complete one? $null when -Offsite
             skipped the dump. promote.ps1's gate is THIS and only this: a
             promotion may not proceed without a backup, but a failed copy to
             the other drive must not stop it, because the local dump it just
             took is intact and a stopped paper helps nobody.
    Ok       the whole run. True when the dump (if attempted) and the copy are
             both good. ops\backup.ps1 reports this, because a person pressing
             "back up now" wants the copy to have worked too.

  lastError in the state means "the last dump that failed", and is cleared by
  the next dump that works. It is deliberately left alone by an -Offsite run,
  because that run did not attempt a dump and so has nothing to say about
  whether one works: the operator should keep seeing the failure until a real
  dump replaces it. That is why Ok above is not "no error in the state" -- an
  -Offsite retry that copies everything and prunes is a success, and reporting
  it as a failure would leave the operator with no way to clear it.

  A failed dump is renamed to <name>.sql.incomplete by New-TownReporterBackup,
  so lastError is a record of something that happened, never a file that is
  still sitting in the backup series blocking tonight's run.
#>
function Invoke-TownReporterBackupRun {
  param(
    [string]$App = (Split-Path -Parent $PSScriptRoot),
    [string]$EnvFile,
    [string]$BackupDir,
    [string]$OffsiteDir,
    [string]$LogFile,
    [string]$StateFile,
    [string]$LockFile,
    [string]$PgBin = "$env:USERPROFILE\scoop\apps\postgresql\current\bin",
    [int]$PgPort = 5433,
    [string]$Database,
    [int]$Keep = 3,
    [long]$MinFreeGb = 100,
    [int]$MaxAgeHours = 20,
    [int]$NightHour = 2,
    [int]$LockWaitSeconds = 0,
    [datetime]$Now = (Get-Date),
    [switch]$Offsite,
    [switch]$Force,
    [scriptblock]$DumpCommand
  )
  if (-not $EnvFile) { $EnvFile = Join-Path $App ".env" }
  if (-not $BackupDir) { $BackupDir = Get-TownReporterBackupDir -App $App }
  if (-not $OffsiteDir) { $OffsiteDir = Get-TownReporterBackupOffsiteDir -App $App -EnvFile $EnvFile }
  if (-not $StateFile) { $StateFile = Get-TownReporterBackupStatePath -App $App }
  if (-not $LockFile) { $LockFile = Join-Path $App 'logs\backup.lock' }

  $lines = New-Object System.Collections.ArrayList
  $state = Get-TownReporterBackupState -StateFile $StateFile

  # $null until a dump is actually attempted: -Offsite never takes one, and
  # neither does a run the 2 AM / 20 hour rule turns away.
  $dumpOk = $null

  $lock = Enter-TownReporterBackupLock -LockFile $LockFile -LogFile $LogFile -WaitSeconds $LockWaitSeconds
  if (-not $lock.Ok) {
    [void]$lines.Add("NOT backing up: $($lock.Reason)")
    Write-TownReporterBackupLog $LogFile "NOT backing up: $($lock.Reason)"
    $state['lastError'] = $lock.Reason
    $state['offsiteDir'] = $OffsiteDir
    Save-TownReporterBackupState -StateFile $StateFile -State $state | Out-Null
    return @{ Ok = $false; DumpOk = $null; Skipped = $true; Reason = $lock.Reason; State = $state; Lines = @($lines) }
  }

  try {
    $state['lastAttemptAt'] = Get-TownReporterIsoTime -Time $Now
    $state['offsiteDir'] = $OffsiteDir

    # 1. The dump.
    if (-not $Offsite) {
      $due = Test-TownReporterBackupDue -BackupDir $BackupDir -Now $Now -Hour $NightHour -MaxAgeHours $MaxAgeHours
      if (-not $Force -and -not $due.Due) {
        [void]$lines.Add("not taking a backup: $($due.Reason)")
        Write-TownReporterBackupLog $LogFile "not taking a backup: $($due.Reason)"
        $state['skippedReason'] = $due.Reason
      } else {
        $backup = New-TownReporterBackup -LogFile $LogFile -App $App -BackupDir $BackupDir -EnvFile $EnvFile -PgBin $PgBin -PgPort $PgPort -Database $Database -Now $Now -DumpCommand $DumpCommand
        if ($backup.Ok) {
          $dumpOk = $true
          $state['lastSuccessAt'] = Get-TownReporterIsoTime -Time $Now
          $state['lastName'] = $backup.Name
          $state['lastBytes'] = $backup.Bytes
          $state['lastError'] = $null
          $state['skippedReason'] = $null
          [void]$lines.Add("took a backup: $($backup.Name)")
        } else {
          $dumpOk = $false
          $state['lastError'] = "the backup failed: $($backup.Reason)"
          [void]$lines.Add("the backup FAILED: $($backup.Reason)")
          Save-TownReporterBackupState -StateFile $StateFile -State $state | Out-Null
          return @{ Ok = $false; DumpOk = $false; Skipped = $false; Reason = $backup.Reason; State = $state; Lines = @($lines) }
        }
      }
    }

    # 2. The copy to the second drive. Never skipped: a run that took no dump
    #    still has to catch up on anything the last one could not copy.
    $copy = Copy-TownReporterBackupOffsite -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb
    $state['offsiteOk'] = [bool]$copy.Ok
    $state['offsiteReason'] = if ($copy.Ok) { $null } else { $copy.Reason }
    $state['offsiteVerified'] = $copy.Verified
    $state['offsiteFreeGb'] = $copy.FreeGb
    $state['offsiteAt'] = Get-TownReporterIsoTime -Time (Get-Date)
    if ($copy.Ok) {
      [void]$lines.Add("offsite: $($copy.Verified) of $($copy.Total) backups are on $OffsiteDir")
    } else {
      [void]$lines.Add("offsite: COPY FAILING -- $($copy.Reason)")
    }

    # 3. The prune. Runs on the copy's verdict and nothing else.
    $prune = Remove-TownReporterBackupOld -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -Keep $Keep -MinFreeGb $MinFreeGb
    if ($prune.Ok) {
      $state['prunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['prunedCount'] = @($prune.Deleted).Count
      if (@($prune.Deleted).Count -gt 0) { [void]$lines.Add("pruned: deleted $(@($prune.Deleted).Count) older local backup(s), keeping the newest $Keep") }
    } else {
      [void]$lines.Add("pruned nothing: $($prune.Reason)")
    }

    $local = Get-TownReporterBackupList -Dir $BackupDir
    $state['localCount'] = $local.Count
    $state['localNewestAt'] = if ($local.Count -gt 0) { Get-TownReporterIsoTime -Time $local[0].Stamp } else { $null }
    Save-TownReporterBackupState -StateFile $StateFile -State $state | Out-Null

    $ok = ($copy.Ok -and $dumpOk -ne $false)
    $reason = if ($copy.Ok) { 'all verified' } else { $copy.Reason }
    return @{ Ok = $ok; DumpOk = $dumpOk; Skipped = $false; Reason = $reason; State = $state; Lines = @($lines) }
  } finally {
    Exit-TownReporterBackupLock -LockFile $LockFile
  }
}
