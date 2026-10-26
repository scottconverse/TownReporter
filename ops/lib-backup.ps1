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

  What the owner asked for first (2026-09-25), in his words: "Keep ONLY 3 days
  worth and keep only the latest three on the server disk. Keep ALL backups (as
  long as there's room) on drive D:". Plus an alert when a backup has not
  happened, when the copy to D: is failing, and when D: is filling up.

  What he asked for on 2026-10-25, which REPLACES the keep rules above, word
  for word: "Keep 3 days of backups. No more. Delete the rest. and keep them on
  D: not C:". His reason: a backup is for recovering from fresh damage to the
  paper, and an old one only wastes space. So since then:

    * C: (the folder beside the app) keeps NOTHING once a backup is verified
      on D:. The dump is still written to C: first -- that is where pg_dump
      writes, and it is the copy that survives a missing D: -- and it is
      deleted from C: the moment its copy on D: is proven identical. An empty
      C: folder is the normal state now, not a warning.
    * D: keeps the newest backup of each of the 3 newest DAYS that have a
      backup, read from the date in the file name. Everything else in the
      dated series on D: is deleted. "The 3 newest days that have a backup",
      not "the last 3 calendar days": a week with no backups never empties the
      drive. The newest backup is never deleted.
    * One-off safety copies (Get-TownReporterSafetyCopyList): deleted from C:
      once verified on D:, and deleted from D: once they are more than 3 days
      old there.
    * Every reader of "the newest backup" looks at D: and C: and takes the
      newest of either (Get-TownReporterNewestBackup), so an empty C: never
      makes the nightly run think no backup exists.

  The rules this file exists to keep, each of which is a way to lose data if
  it is written the other way round (2 and 3 are the 2026-10-25 versions):

    1. A dump that does not END like a complete pg_dump is a failed backup. The
       caller is told so and must not treat the file as a backup. pg_dump
       writes a plain-SQL file whose last line is a closing marker; a full disk
       or a killed process leaves a file that looks like a backup by name and
       size and is not one. Such a file is not a backup and is not kept: the
       log gets the size pg_dump reached and the file's last 2 KB, and then the
       file is deleted, so a database that is down at 2 AM cannot fill the disk
       with dumps that failed. A dump that is still valid, or older than the
       rule allows, is a different case and is kept like any other backup.
    2. A file is deleted from C: only after THAT file is proven identical on
       D: -- same length AND same SHA256. A delete is the one operation here
       that cannot be undone, so it goes last and only after a proof. A file
       that does not verify stays on C:, and the log names it.
    3. D: is pruned only to the keep rule above, only among files whose names
       are this series' (<db>_YYYY-MM-DD_HHmm.sql), and never below one
       complete backup: a day only counts toward the 3 when its backup ENDS
       like a complete pg_dump, and nothing newer than the newest kept backup
       is ever deleted.
    4. Any problem with D: -- the drive missing, not writable, short of room,
       or the same folder as C: under another name -- deletes NOTHING, on
       either drive, and returns a reason the caller turns into an alert. The
       backup itself still runs and stays on C:. Failing closed on a backup is
       not a conservative choice, it is the only safe one.

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
      # The database the dump is of, from the name. The D: keep rule counts
      # days per database, so a dump of another database in the same folder
      # can never push the paper's own backups out of the 3 days.
      Db      = $m.Groups['db'].Value
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

# --- The newest backup, wherever it is -------------------------------------
<#
  Since 2026-10-25 a verified backup lives on D: only, so "the newest backup"
  is the newest of the two folders, never the newest in C: alone. Read C: alone
  and an emptied C: looks like "no backup has ever been taken" -- which would
  start a fresh dump every five minutes, and tell the owner his backups were
  missing while three days of them sat on D:.

  Returns $null when neither folder holds one, else the list item (Name, Path,
  Bytes, Stamp, Written, Db) plus Dir (the folder it is in) and Where ('local'
  for C:, 'offsite' for D:). A missing D: is simply an empty list here; it is
  never an error, because "is a backup due" must still be answerable with the
  drive unplugged.
#>
function Get-TownReporterNewestBackup {
  param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [string]$OffsiteDir
  )
  $best = $null
  $where = $null
  $dir = $null
  $local = Get-TownReporterBackupList -Dir $BackupDir
  if ($local.Count -gt 0) { $best = $local[0]; $where = 'local'; $dir = $BackupDir }
  if ($OffsiteDir) {
    $offsite = @()
    try { $offsite = Get-TownReporterBackupList -Dir $OffsiteDir } catch { $offsite = @() }
    if ($offsite.Count -gt 0 -and ($null -eq $best -or $offsite[0].Stamp -gt $best.Stamp)) {
      $best = $offsite[0]; $where = 'offsite'; $dir = $OffsiteDir
    }
  }
  if ($null -eq $best) { return $null }
  return [pscustomobject]@{
    Name    = $best.Name
    Path    = $best.Path
    Bytes   = $best.Bytes
    Stamp   = $best.Stamp
    Written = $best.Written
    Db      = $best.Db
    Dir     = $dir
    Where   = $where
  }
}

<#
  Where a named backup is now: C: if it is still there (D: was not ready, or
  the copy did not verify), else D:, else $null. promote.ps1 prints this as
  "the backup is at ..." -- since 2026-10-25 the file it just took is usually
  on D: by the time the run returns, and printing a C: path for a file that is
  no longer there would send a person looking in the wrong place on the worst
  day.
#>
function Get-TownReporterBackupPath {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [string]$OffsiteDir
  )
  $local = Join-Path $BackupDir $Name
  if (Test-Path -LiteralPath $local -PathType Leaf) { return $local }
  if ($OffsiteDir) {
    $off = Join-Path $OffsiteDir $Name
    if (Test-Path -LiteralPath $off -PathType Leaf) { return $off }
  }
  return $null
}

<#
  Are the local folder and the offsite folder really two folders?

  Since C: keeps nothing, this is the check that stands between a typo in
  BACKUP_OFFSITE_DIR and the paper's only backup. If the two names point at the
  same folder, every file "verifies" against itself -- same size, same SHA256,
  because it IS the same file -- and the C: prune would then delete it, from
  the only place it was. The old keep-three rule happened to survive that
  mistake; keep-nothing does not, so it is checked outright before any delete:

    * the two full paths, case-insensitively, including one inside the other
      (an offsite folder inside the local one would also be listed as a
      one-off "safety copy" folder and copied into itself);
    * then a probe file written in the offsite folder and looked for in the
      local one, which catches the same folder reached under two names -- a
      junction, a symlink, a subst drive letter -- that no string compare can.

  Returns @{ Ok; Reason }. Ok = $false means "delete nothing".
#>
function Test-TownReporterBackupDirsSeparate {
  param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir
  )
  try {
    $a = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($BackupDir)).TrimEnd('\', '/')
    $b = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OffsiteDir)).TrimEnd('\', '/')
  } catch {
    return @{ Ok = $false; Reason = "the local folder $BackupDir and the offsite folder $OffsiteDir could not be compared ($($_.Exception.Message))" }
  }
  if ([string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)) {
    return @{ Ok = $false; Reason = "the offsite folder $OffsiteDir is the same folder as the local one $BackupDir, so nothing there is a second copy" }
  }
  if ($b.StartsWith($a + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return @{ Ok = $false; Reason = "the offsite folder $OffsiteDir is inside the local folder $BackupDir, so it is not a second drive" }
  }
  if ($a.StartsWith($b + '\', [StringComparison]::OrdinalIgnoreCase)) {
    return @{ Ok = $false; Reason = "the local folder $BackupDir is inside the offsite folder $OffsiteDir, so it is not a second drive" }
  }
  if ((Test-Path -LiteralPath $a -PathType Container) -and (Test-Path -LiteralPath $b -PathType Container)) {
    $name = ".townreporter-same-folder-test-{0}-{1}" -f $PID, ([guid]::NewGuid().ToString('N'))
    $probe = Join-Path $b $name
    $seen = $false
    try {
      Set-Content -LiteralPath $probe -Value 'probe' -Encoding ASCII -ErrorAction Stop
      $seen = Test-Path -LiteralPath (Join-Path $a $name)
    } catch {
      return @{ Ok = $false; Reason = "a test file could not be written to $OffsiteDir to prove it is a different folder from $BackupDir ($($_.Exception.Message))" }
    } finally {
      try { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue } catch { }
    }
    if ($seen) {
      return @{ Ok = $false; Reason = "the offsite folder $OffsiteDir is the local folder $BackupDir under another name (a link or a mapped drive), so nothing there is a second copy" }
    }
  }
  return @{ Ok = $true; Reason = 'two separate folders' }
}

<#
  The one gate every delete in this file goes through, on either drive: D: is
  there and writable, its free space is known and at least MinFreeGb, and it
  is not the local folder under another name. Any "no" means nothing is
  deleted anywhere this run -- the owner's rule for a missing, unwritable or
  full D: -- and the reason is the sentence the log and the Control page show.
#>
function Test-TownReporterDeleteAllowed {
  param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [long]$MinFreeGb = 100
  )
  $ready = Test-TownReporterOffsiteReady -Dir $OffsiteDir
  if (-not $ready.Ok) { return @{ Ok = $false; Reason = $ready.Reason; FreeGb = $ready.FreeGb } }
  if ($null -eq $ready.FreeGb -or $ready.FreeGb -lt $MinFreeGb) {
    $reason = if ($null -eq $ready.FreeGb) { "$OffsiteDir free space could not be read" } else { ("{0} has only {1} GB free, below the {2} GB limit" -f $OffsiteDir, $ready.FreeGb, $MinFreeGb) }
    return @{ Ok = $false; Reason = $reason; FreeGb = $ready.FreeGb }
  }
  $separate = Test-TownReporterBackupDirsSeparate -BackupDir $BackupDir -OffsiteDir $OffsiteDir
  if (-not $separate.Ok) { return @{ Ok = $false; Reason = $separate.Reason; FreeGb = $ready.FreeGb } }
  return @{ Ok = $true; Reason = 'ready'; FreeGb = $ready.FreeGb }
}

# --- The files and folders in that folder that are NOT part of the series ---
<#
  Everything else in the local backup folder that looks like a one-off safety
  copy: a hand-made .sql export, an old pg_dump custom-format .dump, or a
  whole top-level FOLDER someone left there ("configuration_..._live-recovery",
  a pre-upgrade "output-..." snapshot, and so on -- CF-unfinished-steps-sweep.md
  item 14 and design/FEATURE-BACKLOG.md's "Backup series pattern ignores
  suffixed names"). The owner's rule is that these are safety copies too, so
  they go to D: exactly like the series does.

  Read: this list is what the SERIES prune never sees. The prune works from
  Get-TownReporterBackupList, so an item in this list can never be deleted
  by the series rule -- that is deliberate, and it is why these
  two lists are separate functions rather than one with a flag. Deleting a
  one-off item locally is Remove-TownReporterOneOffOld's job, below, and it
  is a different rule (verified on D: AND at least MinAgeMinutes -- see there).

  The extension test on files is what keeps the walking wounded out, and it is
  the whole reason this is a -match on the name instead of -Filter '*.sql*':
  a copy that died is <name>.sql.partial, and an <name>.sql.incomplete is a
  dump that died under the version of this file that kept those -- either way
  it does not end in .sql. A file that is not a backup must never be presented
  to the offsite copy wearing a backup's name, and it must never be hashed and
  copied to D: as though it were one. A folder is judged the same way but by
  what it holds: any .incomplete or .partial file inside it, at any depth,
  means the folder itself is treated as not-yet-settled.

  Skip = $true marks an item that is not copied or pruned THIS run because it
  looks like it may still be being written: a .incomplete/.partial file inside
  it (folders) or its own newest write is younger than MinAgeMinutes. This is
  a possibly-in-progress guard, not a backup-completeness check -- a hand-named
  item has no pg_dump trailer to look for, so recency is the only signal there
  is. The caller logs Skip items and leaves them alone; they are picked up
  again on the next run once they have settled.

  Oldest first, same as the series pass, so a run that is cut off leaves the
  newest safety copies already on the other drive.
#>
function Get-TownReporterSafetyCopyList {
  param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [string[]]$Exclude = @(),
    [datetime]$Now = (Get-Date),
    [double]$MinAgeMinutes = 10
  )
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Dir)) { return ,@() }
  $skip = @{}
  foreach ($name in @($Exclude)) { if ($name) { $skip[$name] = $true } }

  foreach ($file in @(Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue)) {
    if ($file.Name -notmatch '\.(sql|dump)$') { continue }
    if ($skip.ContainsKey($file.Name)) { continue }
    $ageMinutes = ($Now - $file.LastWriteTime).TotalMinutes
    $isSkip = $false
    $skipReason = ''
    if ($ageMinutes -lt $MinAgeMinutes) {
      $isSkip = $true
      $skipReason = ("it was written {0} minute(s) ago, under the {1}-minute settle time -- it may still be being written" -f [math]::Round($ageMinutes, 1), $MinAgeMinutes)
    }
    [void]$out.Add([pscustomobject]@{
      Name        = $file.Name
      Path        = $file.FullName
      Bytes       = $file.Length
      Written     = $file.LastWriteTime
      # When THIS copy of it was made, which on D: is when it arrived there
      # (a copy keeps the source's LastWriteTime but gets a new CreationTime).
      # The D: one-off rule counts its 3 days from the later of the two.
      Created     = $file.CreationTime
      IsDirectory = $false
      FileCount   = 1
      Skip        = $isSkip
      SkipReason  = $skipReason
    })
  }

  foreach ($d in @(Get-ChildItem -LiteralPath $Dir -Directory -ErrorAction SilentlyContinue)) {
    if ($skip.ContainsKey($d.Name)) { continue }
    $files = @(Get-ChildItem -LiteralPath $d.FullName -File -Recurse -ErrorAction SilentlyContinue)
    # An empty folder has nothing to verify (no bytes, no hash), so it is not a
    # one-off item -- there is nothing here Test-TownReporterFolderCopyMatches
    # could ever prove.
    if ($files.Count -eq 0) { continue }
    $inProgress = @($files | Where-Object { $_.Name -match '\.(incomplete|partial)$' })
    $newest = ($files | Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    $ageMinutes = ($Now - $newest).TotalMinutes
    $isSkip = $false
    $skipReason = ''
    if ($inProgress.Count -gt 0) {
      $isSkip = $true
      $skipReason = ("it holds {0} .incomplete/.partial file(s), so it looks like it is still being written" -f $inProgress.Count)
    } elseif ($ageMinutes -lt $MinAgeMinutes) {
      $isSkip = $true
      $skipReason = ("its newest file was written {0} minute(s) ago, under the {1}-minute settle time -- it may still be being written" -f [math]::Round($ageMinutes, 1), $MinAgeMinutes)
    }
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    [void]$out.Add([pscustomobject]@{
      Name        = $d.Name
      Path        = $d.FullName
      Bytes       = $bytes
      Written     = $newest
      Created     = $d.CreationTime
      IsDirectory = $true
      FileCount   = $files.Count
      Skip        = $isSkip
      SkipReason  = $skipReason
    })
  }

  # The unary comma again: one item in the folder must still come back as an
  # array of one, or .Count is $null in Windows PowerShell 5.1.
  return ,@($out | Sort-Object -Property Written, Name)
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

<#
  A path as the FULL path PowerShell means by it.

  [IO.File]::Open and every other .NET call resolve a relative path against the
  PROCESS directory, not against the PowerShell location that Set-Location
  moved. The two are only the same when the script was started from the folder
  it works in. On 2026-10-10 11:33 PM a promotion started from a deploy
  wrapper in another folder hashed "package-lock.json" in THAT folder, got
  nothing, decided there was no lockfile, skipped npm ci, and a release that
  added a dependency died at the build and rolled back
  (logs\promote-20261010-233305.log). Every [IO.File] call in this library
  resolves its path through here first.
#>
function Resolve-TownReporterFilePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
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
    $stream = [IO.File]::Open((Resolve-TownReporterFilePath -Path $Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
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
  A relative path is taken from the PowerShell location, not the process
  directory -- see Resolve-TownReporterFilePath above.

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
    # .NET resolves a relative path against the process directory, not the
    # PowerShell location promote.ps1 set with Set-Location. Run from another
    # folder, the open failed, the hash came back '' and `npm ci` was skipped.
    $Path = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::Open((Resolve-TownReporterFilePath -Path $Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
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
  The folder version of the rule above, for a one-off item that is a whole
  directory rather than a single file: same file COUNT, same total BYTES, and
  the same SHA256 for every file at the same relative path. A count-and-bytes
  match with a swapped or corrupted file inside would still look identical in
  aggregate, which is why every file is hashed individually rather than
  hashing, say, a concatenation of them -- the owner's rule is "same size AND
  same SHA256" per file here just as it is for a single-file backup.

  Get-FileHash is not used here for the same measured reason as
  Get-TownReporterFileHash above: it calls that function, not the cmdlet.
#>
function Test-TownReporterFolderCopyMatches {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Dest
  )
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return $false }
  if (-not (Test-Path -LiteralPath $Dest -PathType Container)) { return $false }
  try {
    $srcRoot = (Get-Item -LiteralPath $Source).FullName
    $dstRoot = (Get-Item -LiteralPath $Dest).FullName
    $srcFiles = @(Get-ChildItem -LiteralPath $srcRoot -File -Recurse -ErrorAction Stop | Sort-Object -Property FullName)
    $dstFiles = @(Get-ChildItem -LiteralPath $dstRoot -File -Recurse -ErrorAction Stop | Sort-Object -Property FullName)
    if ($srcFiles.Count -eq 0 -or $srcFiles.Count -ne $dstFiles.Count) { return $false }
    $srcBytes = ($srcFiles | Measure-Object -Property Length -Sum).Sum
    $dstBytes = ($dstFiles | Measure-Object -Property Length -Sum).Sum
    if ($srcBytes -ne $dstBytes) { return $false }
    for ($i = 0; $i -lt $srcFiles.Count; $i++) {
      $relSrc = $srcFiles[$i].FullName.Substring($srcRoot.Length).TrimStart('\', '/')
      $relDst = $dstFiles[$i].FullName.Substring($dstRoot.Length).TrimStart('\', '/')
      if ($relSrc -ne $relDst) { return $false }
      $sh = Get-TownReporterFileHash -Path $srcFiles[$i].FullName
      $dh = Get-TownReporterFileHash -Path $dstFiles[$i].FullName
      if (-not $sh -or -not $dh -or $sh -ne $dh) { return $false }
    }
    return $true
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

# --- What a failed dump's last words look like -----------------------------
<#
  The last few bytes of a file, as ONE line of ASCII, for the backup log.

  Read as bytes, not text: the point is a dying pg_dump's last words, and the
  file may end mid-character or hold bytes that are not valid UTF-8. Reading it
  as text would either throw or turn the rest of the line into mojibake, and a
  mojibake byte in a BOM-less UTF-8 file is exactly what truncates the line
  when PS 5.1 reads it back (see this file's ASCII-only note in the header).

  So: any run of whitespace collapses to one space -- the tail is a diagnostic,
  and 2 KB of a SQL file is mostly newlines otherwise -- and every byte left
  outside plain printable ASCII becomes '.'. The result is one line, always, of
  a length an operator can read. A read that fails says so rather than
  pretending the file ended there.
#>
function Read-TownReporterDumpTail {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Bytes = 2048
  )
  try {
    $stream = [IO.File]::Open((Resolve-TownReporterFilePath -Path $Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
      $length = $stream.Length
      $take = [int][Math]::Min([int64]$Bytes, $length)
      if ($take -le 0) { return '(the file is empty)' }
      $null = $stream.Seek([int64]($length - $take), [IO.SeekOrigin]::Begin)
      $buffer = New-Object byte[] $take
      $read = $stream.Read($buffer, 0, $take)
      $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $read)
    } finally {
      $stream.Dispose()
    }
  } catch {
    return "(the tail could not be read: $($_.Exception.Message))"
  }
  $text = $text -replace '\s+', ' '
  $text = $text -replace '[^\x20-\x7E]', '.'
  return $text.Trim()
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

  It used to be renamed to <name>.sql.incomplete and the newest two were kept
  "for inspection". The owner ended that, in his words: "this is how my disk
  fills with junk". Nobody reads them. A database that is down at 2 AM is asked
  again every five minutes, so a pg_dump that wrote 300 MB before dying left
  300 MB behind 288 times in one night, and the folder on C: is the one that
  fills.

  So the file is read one last time -- its size, and its last 2 KB as one line
  of text -- that line goes to the log, and then the file is deleted. An
  operator still sees exactly how far pg_dump got, from the log, without the
  bytes staying on the disk. A file this function deletes is the output of a
  dump that FAILED, which is the one thing in this file that is provably not a
  backup, so this is not the "never delete a backup" rule being bent.

  It also sweeps <name>.sql.incomplete files the older version of this file
  left in that same folder, which is the only reason that pattern is still
  named here. Only *.sql.incomplete, and only in the folder a dump was just
  attempted in -- never a .sql or a .dump, which are the backups and the
  owner's safety copies.
#>
function Remove-TownReporterFailedDump {
  param(
    [string]$Path,
    [string]$LogFile
  )
  $dir = Split-Path -Parent $Path
  if ($dir) {
    foreach ($item in @(Get-ChildItem -LiteralPath $dir -Filter '*.sql.incomplete' -File -ErrorAction SilentlyContinue)) {
      try {
        $leftover = $item.Length
        Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
        Write-TownReporterBackupLog $LogFile "dropped the leftover failed dump $($item.Name) ($leftover bytes) from an older version that kept these"
      } catch {
        Write-TownReporterBackupLog $LogFile "could not drop the leftover failed dump $($item.Name): $($_.Exception.Message)"
      }
    }
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $size = (Get-Item -LiteralPath $Path).Length
  $tail = Read-TownReporterDumpTail -Path $Path -Bytes 2048
  # Logged before the delete, not after: what an operator would have opened the
  # file to find out, written down while the file is still there to be read.
  Write-TownReporterBackupLog $LogFile "dropping the failed dump ${Path}: $size bytes were written; last up to 2048 bytes: $tail"
  try {
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    return $Path
  } catch {
    Write-TownReporterBackupLog $LogFile "the failed dump could not be deleted ($($_.Exception.Message)); it is still at $Path and is NOT a backup -- delete it by hand"
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

  A dump that fails, or that does not END like a complete pg_dump, is dropped
  by Remove-TownReporterFailedDump -- logged first (its size and last 2 KB),
  then deleted -- so it can never be mistaken for a backup by the copy step or
  the prune. What is returned in that case is Ok = $false plus the plain
  reason; DroppedPath is the file that was deleted, or $null when there was
  nothing there to delete. No backup is ever deleted: what goes is the output
  of a dump that failed.

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
      Remove-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: the dump command threw $($_.Exception.Message)"
      return @{ Ok = $false; Reason = "the dump command threw $($_.Exception.Message)"; Name = $name; Path = $path }
    }
    if (-not $ran) {
      Remove-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
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
      Remove-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: pg_dump would not run ($($_.Exception.Message))"
      return @{ Ok = $false; Reason = "pg_dump would not run ($($_.Exception.Message))"; Name = $name; Path = $path }
    }
    if ($LASTEXITCODE -ne 0) {
      Remove-TownReporterFailedDump -Path $path -LogFile $LogFile | Out-Null
      Write-TownReporterBackupLog $LogFile "$name FAILED: pg_dump exited $LASTEXITCODE"
      return @{ Ok = $false; Reason = "pg_dump exited $LASTEXITCODE"; Name = $name; Path = $path }
    }
  }

  $check = Test-TownReporterDumpComplete -Path $path -MinBytes $MinBytes
  if (-not $check.Ok) {
    $badBytes = (Get-Item -LiteralPath $path -ErrorAction SilentlyContinue).Length
    Write-TownReporterBackupLog $LogFile "$name FAILED: $($check.Reason)"
    $dropped = Remove-TownReporterFailedDump -Path $path -LogFile $LogFile
    return @{ Ok = $false; Reason = $check.Reason; Name = $name; Path = $path; DroppedPath = $dropped; Bytes = $badBytes }
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

  A second pass then does the same thing for every other .sql/.dump FILE and
  every top-level FOLDER in the backup folder (Get-TownReporterSafetyCopyList),
  into <offsite>\other-safety-copies\. Those are the owner's one-off items --
  hand-named exports and old pre-upgrade snapshot folders -- and the same four
  rules apply with two changes: step 1 (the completeness check) is not run on
  them, and an item Get-TownReporterSafetyCopyList marked Skip (a .incomplete/
  .partial file inside it, or written under 10 minutes ago) is logged and left
  alone this run rather than copied. A .dump is pg_dump's binary custom format
  and has no text trailer to look for, and a hand-named .sql or a folder is not
  this series' pg_dump output at all -- so the guarantee for these is "the
  bytes on D: are the bytes that are on C:", which is exactly what
  Test-TownReporterCopyMatches (a file) and Test-TownReporterFolderCopyMatches
  (a folder: file count, total bytes, and a SHA256 of every file at the same
  relative path) prove. They are never added to the series list, so the
  series prune cannot touch them. Removing a verified one-off item from C: is
  Remove-TownReporterOneOffOld's job, and removing one that has been on D: for
  more than 3 days is Remove-TownReporterOffsiteOneOffOld's -- both below, and
  both separate rules from the series'. This function itself never deletes a
  backup or a safety copy from either drive.
#>
function Copy-TownReporterBackupOffsite {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [long]$MinFreeGb = 100,
    [datetime]$Now = (Get-Date)
  )
  $ready = Test-TownReporterOffsiteReady -Dir $OffsiteDir
  if (-not $ready.Ok) {
    Write-TownReporterBackupLog $LogFile "offsite copy: NOT copying anything -- $($ready.Reason)"
    return @{ Ok = $false; Reason = $ready.Reason; Copied = 0; Verified = 0; Failed = 0; FreeGb = $ready.FreeGb; OtherCopied = 0; OtherVerified = 0; OtherFailed = 0; OtherTotal = 0 }
  }
  # A "copy" into the same folder would verify against itself and prove
  # nothing, so it is reported as a failing copy -- which raises the
  # offsite-failing alert -- rather than as a success.
  $separate = Test-TownReporterBackupDirsSeparate -BackupDir $BackupDir -OffsiteDir $OffsiteDir
  if (-not $separate.Ok) {
    Write-TownReporterBackupLog $LogFile "offsite copy: NOT copying anything -- $($separate.Reason)"
    return @{ Ok = $false; Reason = $separate.Reason; Copied = 0; Verified = 0; Failed = 0; FreeGb = $ready.FreeGb; OtherCopied = 0; OtherVerified = 0; OtherFailed = 0; OtherTotal = 0 }
  }

  $local = Get-TownReporterBackupList -Dir $BackupDir
  # Items that look like they may still be being written (a .incomplete /
  # .partial file, or written less than 10 minutes ago) are left alone this
  # run and logged as skipped -- they are not counted in $safety, so they
  # never show up as a "failure" in the tally below, and are picked up again
  # once they have settled.
  $safetyAll = Get-TownReporterSafetyCopyList -Dir $BackupDir -Exclude @($local | ForEach-Object { $_.Name }) -Now $Now
  foreach ($sk in @($safetyAll | Where-Object { $_.Skip })) {
    Write-TownReporterBackupLog $LogFile "offsite copy: skipping the one-off $($sk.Name) -- $($sk.SkipReason)"
  }
  $safety = @($safetyAll | Where-Object { -not $_.Skip })
  if ($local.Count -eq 0 -and $safety.Count -eq 0) {
    return @{ Ok = $true; Reason = 'there are no local backups to copy'; Copied = 0; Verified = 0; Failed = 0; FreeGb = $ready.FreeGb; OtherCopied = 0; OtherVerified = 0; OtherFailed = 0; OtherTotal = 0 }
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

  # --- every other .sql and .dump in the folder -----------------------------
  # The owner's hand-named safety copies, into a folder of their own so they
  # can never be mistaken for the series and can never collide with its names.
  # Same four rules, minus the completeness check: a .dump is binary and has no
  # text trailer to find, and a hand-made .sql is not this series' pg_dump
  # output, so the promise here is the hash -- the bytes on D: are the bytes on
  # C: -- and Test-TownReporterCopyMatches is what proves it. Nothing here is
  # deleted from either side; the two one-off prunes below do that, later.
  $copiesDir = Join-Path $OffsiteDir 'other-safety-copies'
  $otherCopied = 0
  $otherVerified = 0
  $otherFailed = 0
  $dirReady = $true
  if ($safety.Count -gt 0 -and -not (Test-Path -LiteralPath $copiesDir -PathType Container)) {
    try {
      New-Item -ItemType Directory -Force -Path $copiesDir -ErrorAction Stop | Out-Null
      # New-Item -Force is silent when something that is NOT a folder is
      # sitting at the path, so the folder is looked for again rather than
      # assumed. Measured 2026-09-26 in the harness below: with a file at
      # <offsite>\other-safety-copies, New-Item threw nothing, the first
      # Copy-Item failed with "could not find a part of the path", and the
      # run reported a file that could not be copied instead of the folder
      # that could not be made -- the right verdict for the wrong reason,
      # which is the kind of thing that hides a real problem for a year.
      if (-not (Test-Path -LiteralPath $copiesDir -PathType Container)) {
        throw "there is a file at $copiesDir, so it cannot be used as a folder"
      }
      Write-TownReporterBackupLog $LogFile "offsite copy: made $copiesDir for the other safety copies"
    } catch {
      $dirReady = $false
      $otherFailed = $safety.Count
      if (-not $firstFailure) { $firstFailure = "the other-safety-copies folder could not be made on $OffsiteDir ($($_.Exception.Message))" }
      Write-TownReporterBackupLog $LogFile "offsite copy: NOT copying the $($safety.Count) other safety copies -- $copiesDir could not be made: $($_.Exception.Message)"
    }
  }

  if ($dirReady) {
    foreach ($f in $safety) {
      # A folder is verified by file count, total bytes, and a SHA256 of every
      # file at the same relative path (Test-TownReporterFolderCopyMatches); a
      # single item uses the same same-size-and-SHA256 test as the series.
      $dest = Join-Path $copiesDir $f.Name
      $kind = if ($f.IsDirectory) { 'folder' } else { 'file' }
      $already = if ($f.IsDirectory) { Test-TownReporterFolderCopyMatches -Source $f.Path -Dest $dest } else { Test-TownReporterCopyMatches -Source $f.Path -Dest $dest }
      if ($already) {
        $otherVerified++
        Write-TownReporterBackupLog $LogFile "offsite copy: the one-off $kind $($f.Name) is already on $OffsiteDir (verified)"
        continue
      }

      if ($null -ne $free -and ($free - ($f.Bytes / 1GB)) -lt $MinFreeGb) {
        $otherFailed++
        if (-not $firstFailure) { $firstFailure = ("{0} was not copied because {1} would drop below {2} GB free" -f $f.Name, $OffsiteDir, $MinFreeGb) }
        Write-TownReporterBackupLog $LogFile ("offsite copy: NOT copying the other safety copy $($f.Name) -- {0} has only $free GB free and the limit is $MinFreeGb GB" -f $OffsiteDir)
        continue
      }

      $partial = $dest + '.partial'
      $sizeText = if ($f.IsDirectory) { "{0} file(s), {1} MB" -f $f.FileCount, [math]::Round($f.Bytes / 1MB, 1) } else { "{0} MB" -f [math]::Round($f.Bytes / 1MB, 1) }
      Write-TownReporterBackupLog $LogFile ("offsite copy: copying the one-off $kind $($f.Name) ($sizeText) to $copiesDir")
      Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
      try {
        # Copy-Item -Recurse against a directory SOURCE creates $partial as a
        # copy of that directory (not a copy placed inside it); a plain file
        # source is copied the same way the series files are.
        Copy-Item -LiteralPath $f.Path -Destination $partial -Recurse:$f.IsDirectory -Force -ErrorAction Stop
      } catch {
        $otherFailed++
        if (-not $firstFailure) { $firstFailure = "$($f.Name) could not be copied to the other-safety-copies folder ($($_.Exception.Message))" }
        Write-TownReporterBackupLog $LogFile "offsite copy: the one-off $kind $($f.Name) could not be copied: $($_.Exception.Message)"
        Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
        continue
      }

      $verifies = if ($f.IsDirectory) { Test-TownReporterFolderCopyMatches -Source $f.Path -Dest $partial } else { Test-TownReporterCopyMatches -Source $f.Path -Dest $partial }
      if (-not $verifies) {
        $otherFailed++
        if (-not $firstFailure) { $firstFailure = "$($f.Name) did not verify after the copy (same size/count and SHA256 required)" }
        Write-TownReporterBackupLog $LogFile "offsite copy: the one-off $kind $($f.Name) did NOT verify on $OffsiteDir -- the copy is discarded, nothing is deleted"
        Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
        continue
      }

      try {
        Move-Item -LiteralPath $partial -Destination $dest -Force -ErrorAction Stop
      } catch {
        $otherFailed++
        if (-not $firstFailure) { $firstFailure = "$($f.Name) verified but could not be put in place ($($_.Exception.Message))" }
        Write-TownReporterBackupLog $LogFile "offsite copy: the one-off $kind $($f.Name) verified but could not be put in place: $($_.Exception.Message)"
        Remove-TownReporterStaleCopy -Path $partial -LogFile $LogFile
        continue
      }

      $otherCopied++
      $otherVerified++
      if ($null -ne $free) { $free = [math]::Round($free - ($f.Bytes / 1GB), 1) }
      $verifyText = if ($f.IsDirectory) { "$($f.FileCount) file(s), same bytes and SHA256 each" } else { 'same size and SHA256' }
      Write-TownReporterBackupLog $LogFile "offsite copy: the one-off $kind $($f.Name) verified in $copiesDir ($verifyText)"
    }
  }

  # The tally goes in the log on every path, including the one where the folder
  # itself could not be made -- that is the case where a person most needs the
  # count, and it is one line rather than one per file.
  if ($safety.Count -gt 0) {
    if ($otherFailed -gt 0) {
      Write-TownReporterBackupLog $LogFile "offsite copy: $otherFailed of $($safety.Count) other safety copies did not make it. Those stay on this machine; none of them is deleted."
    } else {
      Write-TownReporterBackupLog $LogFile "offsite copy: all $otherVerified of $($safety.Count) other safety copies are in $copiesDir ($otherCopied copied now, $($otherVerified - $otherCopied) already there)"
    }
  }

  $freeNow = Get-TownReporterDriveFreeGb -Dir $OffsiteDir
  $totals = @{
    Copied = $copied; Verified = $verified; Failed = $failed
    FreeGb = $freeNow; Total = $local.Count
    OtherCopied = $otherCopied; OtherVerified = $otherVerified; OtherFailed = $otherFailed; OtherTotal = $safety.Count
  }
  if ($failed -gt 0) {
    Write-TownReporterBackupLog $LogFile "offsite copy: $failed of $($local.Count) did not make it ($firstFailure). Those stay on this machine; none of them is deleted."
    return (@{ Ok = $false; Reason = $firstFailure } + $totals)
  }
  if ($local.Count -gt 0) {
    Write-TownReporterBackupLog $LogFile "offsite copy: all $verified of $($local.Count) backups are on $OffsiteDir ($copied copied now, $($verified - $copied) already there)"
  }
  if ($otherFailed -gt 0) {
    # The backups themselves are all safe on D:, but a file the owner put in
    # that folder on purpose is not, and silence about a copy that did not
    # happen is the one thing this whole file exists to prevent. So the run is
    # reported as not Ok even though the series part of it worked.
    return (@{ Ok = $false; Reason = $firstFailure } + $totals)
  }
  return (@{ Ok = $true; Reason = 'all verified' } + $totals)
}

# --- C: keeps nothing that is safe on D: -----------------------------------
<#
  Delete each local series backup that is proven identical on D: -- same
  length AND same SHA256 -- one file at a time. The owner's rule since
  2026-10-25: "keep them on D: not C:". So C: is a staging area: pg_dump
  writes there, the copy step puts the file on D:, and this deletes it from C:
  the moment the D: copy is proven. An empty C: folder is the normal result.

    - Per file, not all-or-nothing. A file that does not verify on D: stays on
      C: and is named in the log; the ones that DID verify are still deleted,
      because their second copy is proven and their first is now only taking
      room. A C: file that is not on D: is never deleted, whatever its age.
    - Nothing is deleted at all while D: is missing, not writable, short of
      MinFreeGb, or is the local folder under another name
      (Test-TownReporterDeleteAllowed). Then the backups simply stay on C:
      and the reason goes back to the caller for the alert.
    - Keep is how many of the newest local backups to leave on C: even when
      verified. The owner's number is 0; the switch is kept so a call that
      passes it still works.

  Returns the names it deleted so the caller can log them and put them in the
  state file -- a delete with no record of the name is a delete nobody can
  account for afterwards.
#>
function Remove-TownReporterBackupOld {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [int]$Keep = 0,
    [long]$MinFreeGb = 100
  )
  if ($Keep -lt 0) { $Keep = 0 }
  $empty = @{ Ok = $true; Deleted = @(); Kept = 0; Unverified = @(); Reason = 'nothing to prune'; FreeGb = $null }
  $local = Get-TownReporterBackupList -Dir $BackupDir
  if ($local.Count -eq 0) { return $empty }
  if ($local.Count -le $Keep) {
    return @{ Ok = $true; Deleted = @(); Kept = $local.Count; Unverified = @(); Reason = "only $($local.Count) local backup(s), which is not more than $Keep"; FreeGb = (Get-TownReporterDriveFreeGb -Dir $OffsiteDir) }
  }

  $gate = Test-TownReporterDeleteAllowed -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb
  if (-not $gate.Ok) {
    $reason = "$($gate.Reason); nothing is deleted and the backups stay on this machine"
    Write-TownReporterBackupLog $LogFile "prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Kept = $local.Count; Unverified = @(); Reason = $reason; FreeGb = $gate.FreeGb }
  }

  $deleted = New-Object System.Collections.ArrayList
  $failed = New-Object System.Collections.ArrayList
  $unverified = New-Object System.Collections.ArrayList
  foreach ($b in @($local | Select-Object -Skip $Keep)) {
    $dest = Join-Path $OffsiteDir $b.Name
    if (-not (Test-TownReporterCopyMatches -Source $b.Path -Dest $dest)) {
      [void]$unverified.Add($b.Name)
      Write-TownReporterBackupLog $LogFile "prune: kept $($b.Name) on this machine -- it is not verified on $OffsiteDir yet"
      continue
    }
    try {
      Remove-Item -LiteralPath $b.Path -Force -ErrorAction Stop
      [void]$deleted.Add($b.Name)
      Write-TownReporterBackupLog $LogFile ("prune: deleted $($b.Name) ({0} MB) from this machine -- it is verified on $OffsiteDir" -f [math]::Round($b.Bytes / 1MB, 1))
    } catch {
      [void]$failed.Add($b.Name)
      Write-TownReporterBackupLog $LogFile "prune: could not delete $($b.Name): $($_.Exception.Message)"
    }
  }

  $kept = $local.Count - $deleted.Count
  if ($failed.Count -gt 0) {
    return @{ Ok = $false; Deleted = @($deleted); Kept = $kept; Unverified = @($unverified); Reason = "could not delete $($failed -join ', ')"; FreeGb = $gate.FreeGb }
  }
  if ($unverified.Count -gt 0) {
    $reason = ("{0} of {1} local backups are not verified on {2} yet ({3}), so they stay on this machine" -f $unverified.Count, $local.Count, $OffsiteDir, ($unverified -join ', '))
    Write-TownReporterBackupLog $LogFile "prune: deleted $($deleted.Count) verified backup(s) from this machine; $reason"
    return @{ Ok = $false; Deleted = @($deleted); Kept = $kept; Unverified = @($unverified); Reason = $reason; FreeGb = $gate.FreeGb }
  }
  Write-TownReporterBackupLog $LogFile "prune: deleted $($deleted.Count) backup(s) from this machine, each verified on $OffsiteDir; $kept left here"
  return @{ Ok = $true; Deleted = @($deleted); Kept = $kept; Unverified = @(); Reason = "every local backup is verified on $OffsiteDir"; FreeGb = $gate.FreeGb }
}

# --- D: keeps the newest backup of each of the 3 newest days ---------------
<#
  The owner's words: "Keep 3 days of backups. No more. Delete the rest." This
  is the rule for the dated series on D:, and it is the only thing in this
  file that deletes a series backup from D:.

    - The day is the date in the FILE NAME (<db>_YYYY-MM-DD_HHmm.sql), the
      record of when the dump was taken -- never the file's modified time,
      which a copy or a restore can change.
    - The keep set is, per database, the newest backup of each of the
      KeepDays newest days that HAVE a backup. Not "the last 3 calendar
      days": after a week with no backups, the last three days that had one
      are still kept, so a stopped backup never empties the drive.
    - A day only counts when its backup ENDS like a complete pg_dump
      (Test-TownReporterDumpComplete). The copy step never puts an
      incomplete dump on D:, so this should never matter; if it ever does, a
      broken file cannot take a good day's place among the three.
    - The newest backup is never deleted, and neither is anything newer than
      the newest kept one. A database with no complete backup on D: at all
      has nothing deleted.
    - Nothing is deleted while D: is missing, not writable, short of
      MinFreeGb, or is the local folder under another name.
    - Only names that match the series are ever seen here
      (Get-TownReporterBackupList), so a hand-named file, a .partial copy or
      the other-safety-copies folder can never be touched by this rule.

  Returns Deleted (names), Kept (names) and Ok/Reason.
#>
function Remove-TownReporterOffsiteOld {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [int]$KeepDays = 3,
    [long]$MinFreeGb = 100
  )
  if ($KeepDays -lt 1) { $KeepDays = 1 }
  $list = @()
  try { $list = Get-TownReporterBackupList -Dir $OffsiteDir } catch { $list = @() }
  if ($list.Count -eq 0) { return @{ Ok = $true; Deleted = @(); Kept = @(); Reason = "there are no backups on $OffsiteDir to prune" } }

  $gate = Test-TownReporterDeleteAllowed -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb
  if (-not $gate.Ok) {
    $reason = "$($gate.Reason); nothing is deleted from $OffsiteDir"
    Write-TownReporterBackupLog $LogFile "offsite prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Kept = @($list | ForEach-Object { $_.Name }); Reason = $reason }
  }

  $deleted = New-Object System.Collections.ArrayList
  $keptNames = New-Object System.Collections.ArrayList
  $failed = New-Object System.Collections.ArrayList
  $notes = New-Object System.Collections.ArrayList

  foreach ($group in @($list | Group-Object -Property Db)) {
    $files = @($group.Group | Sort-Object -Property Stamp -Descending)
    $keep = @{}
    $days = @{}
    foreach ($f in $files) {
      if ($days.Count -ge $KeepDays) { break }
      $day = $f.Stamp.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
      if ($days.ContainsKey($day)) { continue }
      $check = Test-TownReporterDumpComplete -Path $f.Path
      if (-not $check.Ok) {
        Write-TownReporterBackupLog $LogFile "offsite prune: $($f.Name) does not count toward the $KeepDays days -- $($check.Reason)"
        continue
      }
      $days[$day] = $true
      $keep[$f.Name] = $true
    }

    if ($keep.Count -eq 0) {
      $note = "$OffsiteDir holds no complete backup of $($group.Name), so none of its $($files.Count) file(s) is deleted"
      [void]$notes.Add($note)
      Write-TownReporterBackupLog $LogFile "offsite prune: NOT deleting anything of $($group.Name) -- $note"
      foreach ($f in $files) { [void]$keptNames.Add($f.Name) }
      continue
    }

    $newestKept = ($files | Where-Object { $keep.ContainsKey($_.Name) } | Select-Object -First 1).Stamp
    $newestName = $files[0].Name
    foreach ($f in $files) {
      if ($keep.ContainsKey($f.Name)) { [void]$keptNames.Add($f.Name); continue }
      if ($f.Name -eq $newestName -or $f.Stamp -gt $newestKept) {
        # Newer than every backup that counts, which means it is not complete:
        # a person should look at it, and this rule never deletes the newest.
        [void]$keptNames.Add($f.Name)
        Write-TownReporterBackupLog $LogFile "offsite prune: kept $($f.Name) -- it is newer than the newest complete backup, and the newest is never deleted"
        continue
      }
      try {
        Remove-Item -LiteralPath $f.Path -Force -ErrorAction Stop
        [void]$deleted.Add($f.Name)
        Write-TownReporterBackupLog $LogFile ("offsite prune: deleted $($f.Name) ({0} MB) from $OffsiteDir -- it is not the newest backup of one of the $KeepDays newest days" -f [math]::Round($f.Bytes / 1MB, 1))
      } catch {
        [void]$failed.Add($f.Name)
        [void]$keptNames.Add($f.Name)
        Write-TownReporterBackupLog $LogFile "offsite prune: could not delete $($f.Name): $($_.Exception.Message)"
      }
    }
  }

  if ($failed.Count -gt 0) {
    return @{ Ok = $false; Deleted = @($deleted); Kept = @($keptNames); Reason = "could not delete $($failed -join ', ') from $OffsiteDir" }
  }
  if ($deleted.Count -gt 0) {
    Write-TownReporterBackupLog $LogFile "offsite prune: kept $($keptNames.Count) on $OffsiteDir (the newest of each of the $KeepDays newest days), deleted $($deleted.Count)"
  }
  $reason = if ($notes.Count -gt 0) { $notes -join '; ' } else { "kept the newest backup of each of the $KeepDays newest days" }
  return @{ Ok = $true; Deleted = @($deleted); Kept = @($keptNames); Reason = $reason }
}

# --- Removing one-off items from C:, once they are safe on D: ----------------
<#
  The one-off items (Get-TownReporterSafetyCopyList: hand-named .sql/.dump
  files and old top-level folders) are never touched by the series rules
  above -- those only ever see the dated series. Left alone forever is what
  CF-unfinished-steps-sweep.md item 14 found: 51 one-off files, 3.4 GB,
  accumulating on C: because nothing ever cleaned them up automatically.

  Since 2026-10-25 they follow the series' rule on C:: an item is deleted
  from C: once it is verified on D: (same size AND SHA256 for a file, same
  file count/bytes/per-file SHA256 for a folder). There is no age floor any
  more; MinAgeDays is kept, at 0, so a caller that passes it still works.

    - Per item, independently: an item that fails to verify is kept, and the
      log says which.
    - D: missing, not writable, short of MinFreeGb, or the local folder under
      another name blocks the WHOLE pass, exactly like the series prune --
      nothing here is deleted while the only other copy of it cannot be
      proven safe.
    - Nothing here can ever touch a dated-series file: SeriesNames is passed
      straight to Get-TownReporterSafetyCopyList's -Exclude, the same list
      that keeps a series backup out of the one-off scan in
      Copy-TownReporterBackupOffsite.
    - An item Get-TownReporterSafetyCopyList marks Skip (looks like it may
      still be being written) is left alone and logged, the same as the copy
      pass does -- a partial write is never a candidate for deletion.

  Returns the names it deleted, for the same reason the series prune does: a
  delete with no record of the name is a delete nobody can account for later.
#>
function Remove-TownReporterOneOffOld {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [string[]]$SeriesNames = @(),
    [int]$MinAgeDays = 0,
    [long]$MinFreeGb = 100,
    [datetime]$Now = (Get-Date)
  )
  $empty = @{ Ok = $true; Deleted = @(); Reason = 'no one-off items to consider' }
  $items = Get-TownReporterSafetyCopyList -Dir $BackupDir -Exclude $SeriesNames -Now $Now
  if ($items.Count -eq 0) { return $empty }

  $gate = Test-TownReporterDeleteAllowed -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb
  if (-not $gate.Ok) {
    $reason = "$($gate.Reason); nothing is deleted and the one-off copies stay on this machine"
    Write-TownReporterBackupLog $LogFile "one-off prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Reason = $reason }
  }

  $copiesDir = Join-Path $OffsiteDir 'other-safety-copies'
  $deleted = New-Object System.Collections.ArrayList
  foreach ($item in $items) {
    if ($item.Skip) {
      Write-TownReporterBackupLog $LogFile "one-off prune: skipped $($item.Name) -- $($item.SkipReason)"
      continue
    }

    $dest = Join-Path $copiesDir $item.Name
    $verified = if ($item.IsDirectory) { Test-TownReporterFolderCopyMatches -Source $item.Path -Dest $dest } else { Test-TownReporterCopyMatches -Source $item.Path -Dest $dest }
    if (-not $verified) {
      Write-TownReporterBackupLog $LogFile "one-off prune: kept $($item.Name) -- not verified on $OffsiteDir yet"
      continue
    }

    $ageDays = [math]::Round(($Now - $item.Written).TotalDays, 1)
    if ($MinAgeDays -gt 0 -and $ageDays -lt $MinAgeDays) {
      Write-TownReporterBackupLog $LogFile ("one-off prune: kept {0} -- only {1} day(s) old, younger than the {2}-day floor" -f $item.Name, $ageDays, $MinAgeDays)
      continue
    }

    try {
      Remove-Item -LiteralPath $item.Path -Force -Recurse -ErrorAction Stop
      [void]$deleted.Add($item.Name)
      Write-TownReporterBackupLog $LogFile ("one-off prune: deleted $($item.Name) from this machine -- it is verified on $OffsiteDir")
    } catch {
      Write-TownReporterBackupLog $LogFile "one-off prune: could not delete $($item.Name): $($_.Exception.Message)"
    }
  }

  return @{ Ok = $true; Deleted = @($deleted); Reason = "$($deleted.Count) one-off item(s) deleted from this machine" }
}

# --- Removing one-off items from D: after 3 days ---------------------------
<#
  The other half of the one-off rule: on D:, in other-safety-copies, an item
  is deleted once it is more than MaxAgeDays (3) days old.

  "Old" counts from the LATER of two times: when the item was last written
  (its LastWriteTime, or its newest file's for a folder -- the time a copy
  keeps from the source) and when this copy was made on D: (its
  CreationTime). The later one, so a safety copy someone made weeks ago and
  only just put in the folder still gets 3 days on D: before it goes -- it is
  never copied, deleted from C: and deleted from D: in the same run.

    - Only items in other-safety-copies, through the same list function the
      copy uses (.sql/.dump files and top-level folders). A name ending
      .partial or .incomplete is a copy in progress or a dead one, and is
      never this rule's to delete.
    - An item marked Skip (written in the last few minutes) is left alone.
    - Nothing is deleted while D: is missing, not writable, short of
      MinFreeGb, or is the local folder under another name.
#>
function Remove-TownReporterOffsiteOneOffOld {
  param(
    [string]$LogFile,
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [Parameter(Mandatory = $true)][string]$OffsiteDir,
    [double]$MaxAgeDays = 3,
    [long]$MinFreeGb = 100,
    [datetime]$Now = (Get-Date)
  )
  $copiesDir = Join-Path $OffsiteDir 'other-safety-copies'
  $exists = $false
  try { $exists = Test-Path -LiteralPath $copiesDir -PathType Container } catch { $exists = $false }
  if (-not $exists) { return @{ Ok = $true; Deleted = @(); Reason = "there is no $copiesDir" } }
  $items = @()
  try { $items = Get-TownReporterSafetyCopyList -Dir $copiesDir -Now $Now } catch { $items = @() }
  if ($items.Count -eq 0) { return @{ Ok = $true; Deleted = @(); Reason = "there are no one-off copies in $copiesDir" } }

  $gate = Test-TownReporterDeleteAllowed -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb
  if (-not $gate.Ok) {
    $reason = "$($gate.Reason); nothing is deleted from $copiesDir"
    Write-TownReporterBackupLog $LogFile "offsite one-off prune: NOT deleting anything -- $reason"
    return @{ Ok = $false; Deleted = @(); Reason = $reason }
  }

  $deleted = New-Object System.Collections.ArrayList
  foreach ($item in $items) {
    if ($item.Name -match '\.(partial|incomplete)$') { continue }
    if ($item.Skip) {
      Write-TownReporterBackupLog $LogFile "offsite one-off prune: skipped $($item.Name) -- $($item.SkipReason)"
      continue
    }
    $since = $item.Written
    if ($item.Created -and $item.Created -gt $since) { $since = $item.Created }
    $ageDays = [math]::Round(($Now - $since).TotalDays, 1)
    if ($ageDays -le $MaxAgeDays) { continue }
    try {
      Remove-Item -LiteralPath $item.Path -Force -Recurse -ErrorAction Stop
      [void]$deleted.Add($item.Name)
      Write-TownReporterBackupLog $LogFile ("offsite one-off prune: deleted {0} from {1} -- it is {2} day(s) old, past the {3}-day keep" -f $item.Name, $copiesDir, $ageDays, $MaxAgeDays)
    } catch {
      Write-TownReporterBackupLog $LogFile "offsite one-off prune: could not delete $($item.Name): $($_.Exception.Message)"
    }
  }
  return @{ Ok = $true; Deleted = @($deleted); Reason = "$($deleted.Count) one-off item(s) deleted from $copiesDir" }
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

  It is deliberately not the only source for the cards: the page lists the
  local folder itself, live, and takes what is on D: from here (offsiteCount,
  offsiteNewest*), since listing a sleeping removable drive can hang the page.
  This file adds the things a folder listing cannot say
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
    oneOffPrunedAt    = $null
    oneOffPrunedCount = 0
    # Since 2026-10-25 (backups live on D:, 3 days kept). The Control page
    # reads these instead of listing D: itself, because listing a sleeping
    # removable drive can hang the page while it spins up.
    offsiteCount             = 0
    offsiteNewestName        = $null
    offsiteNewestAt          = $null
    offsiteNewestBytes       = 0
    newestName               = $null
    newestAt                 = $null
    newestWhere              = $null
    newestDir                = $null
    lastPath                 = $null
    offsitePrunedAt          = $null
    offsitePrunedCount       = 0
    offsiteOneOffPrunedAt    = $null
    offsiteOneOffPrunedCount = 0
    # The reason nothing was deleted this run (D: missing, full, the same
    # folder...), or $null when the deletes ran. The page says it plainly.
    pruneBlocked             = $null
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

  Since 2026-10-25 "the newest backup" is the newest on C: OR D:
  (Get-TownReporterNewestBackup). C: is emptied once a backup is verified on
  D:, so a rule that read C: alone would see "no backup has ever been taken"
  every five minutes and start a fresh dump each time. With OffsiteDir left
  out, only C: is read, exactly as before.
#>
function Test-TownReporterBackupDue {
  param(
    [Parameter(Mandatory = $true)][string]$BackupDir,
    [string]$OffsiteDir,
    [datetime]$Now = (Get-Date),
    [int]$Hour = 2,
    [double]$MaxAgeHours = 20
  )
  $best = Get-TownReporterNewestBackup -BackupDir $BackupDir -OffsiteDir $OffsiteDir
  $newest = $null
  $ageHours = $null
  $where = ''
  if ($null -ne $best) {
    $newest = $best.Stamp
    $ageHours = [math]::Round(($Now - $newest).TotalHours, 2)
    $where = if ($best.Where -eq 'offsite') { " (on $($best.Dir))" } else { '' }
  }
  if ($Now.Hour -lt $Hour) {
    return @{ Due = $false; Newest = $newest; AgeHours = $ageHours; Where = $(if ($best) { $best.Where } else { $null }); Reason = "it is before $Hour in the morning" }
  }
  if ($null -eq $ageHours) {
    $none = if ($OffsiteDir) { "no backup has ever been taken here (none on this machine and none on $OffsiteDir)" } else { 'no backup has ever been taken here' }
    return @{ Due = $true; Newest = $null; AgeHours = $null; Where = $null; Reason = $none }
  }
  if ($ageHours -lt $MaxAgeHours) {
    return @{ Due = $false; Newest = $newest; AgeHours = $ageHours; Where = $best.Where; Reason = "the newest backup$where is only $ageHours hour(s) old" }
  }
  return @{ Due = $true; Newest = $newest; AgeHours = $ageHours; Where = $best.Where; Reason = "the newest backup$where is $ageHours hour(s) old" }
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

    backup-stale      the two FOLDERS, C: and D: (Get-TownReporterNewestBackup),
                      the same instrument Test-TownReporterBackupDue uses, so
                      the due rule and the alert can never disagree about how
                      old the newest backup is. lastSuccessAt is the fallback
                      when neither folder can be read.
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

  # The newest of C: and D:, the same instrument the due rule uses -- C: is
  # empty on a normal day now, so C: alone would raise "backup-stale" every
  # night with three days of backups sitting on D:.
  $newest = $null
  $whereText = ''
  $best = Get-TownReporterNewestBackup -BackupDir $BackupDir -OffsiteDir $OffsiteDir
  if ($null -ne $best) {
    $newest = $best.Stamp
    $whereText = if ($best.Where -eq 'offsite') { " (it is on $($best.Dir))" } else { " (it is on this machine, $($best.Dir))" }
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
      Detail = ("the newest backup is {0} hour(s) old{1}" -f $ageHours, $whereText)
    })
  } else {
    [void]$conditions.Add(@{
      Id     = 'backup-stale'
      Active = $null
      Detail = 'no backup has ever been taken on this machine, so there is no last good one to be late'
    })
  }

  # When the last run deleted nothing because of D: (missing, not writable,
  # short of room, or the local folder under another name), the alerts that
  # fire for it say so in plain words: the backups are safe, on this machine.
  # No new alert id -- a missing or full D: already raises offsite-failing or
  # offsite-low-space, and one problem should be one message on the phone.
  $heldBack = if ($state.pruneBlocked) { ' Nothing was deleted; the backups stay on this machine (C:) until D: works again.' } else { '' }

  if ($null -ne $state.offsiteOk) {
    [void]$conditions.Add(@{
      Id     = 'offsite-failing'
      Active = (-not [bool]$state.offsiteOk)
      Detail = $(if ($state.offsiteOk) { "the copy to $OffsiteDir verified" } else { "${OffsiteDir}: $($state.offsiteReason).$heldBack" })
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
      Detail = ("{0} has {1} GB free and this machine keeps {2} GB in reserve.{3}" -f $OffsiteDir, $freeGb, $MinFreeGb, $(if ($freeGb -lt $MinFreeGb) { $heldBack } else { '' }))
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
  Backup, copy to D:, clear C:, keep 3 days on D:. One function so the
  watchdog, the manual
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

  A failed dump is dropped -- logged, then deleted -- by New-TownReporterBackup
  (see Remove-TownReporterFailedDump), so lastError is a record of something
  that happened, never a file that is still sitting in the backup folder
  blocking tonight's run or filling the disk.
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
    # How many of the newest backups to leave on C: even once they are verified
    # on D:. The owner's rule since 2026-10-25 is none: "keep them on D: not C:".
    [int]$Keep = 0,
    # How many days of backups D: keeps: the newest backup of each of the
    # KeepDays newest days that have one. "Keep 3 days of backups."
    [int]$KeepDays = 3,
    [long]$MinFreeGb = 100,
    [int]$MaxAgeHours = 20,
    [int]$NightHour = 2,
    [int]$LockWaitSeconds = 0,
    # How old a verified one-off item (a hand-named .sql/.dump or an old
    # top-level folder) must be before it is deleted from C:. Since
    # 2026-10-25 there is no floor: verified on D: is enough.
    [int]$OneOffMinAgeDays = 0,
    # How long a one-off item is kept on D: (other-safety-copies).
    [double]$OffsiteOneOffMaxAgeDays = 3,
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
      $due = Test-TownReporterBackupDue -BackupDir $BackupDir -OffsiteDir $OffsiteDir -Now $Now -Hour $NightHour -MaxAgeHours $MaxAgeHours
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
    $copy = Copy-TownReporterBackupOffsite -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MinFreeGb $MinFreeGb -Now $Now
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
    # The hand-named safety copies are reported on their own line, whether or
    # not the series part worked: they are not backups in the series and a
    # person reading the receipt should not have to guess which count is which.
    if ($copy.OtherTotal -gt 0) {
      [void]$lines.Add("offsite: $($copy.OtherVerified) of $($copy.OtherTotal) other safety copies are in $OffsiteDir\other-safety-copies")
    }

    # 3. Clearing C:. Each local backup that is verified on D: is deleted from
    #    this machine; one that is not stays. Not gated on $copy.Ok: the prune
    #    proves every file against D: itself, so a copy that failed for ONE
    #    file never keeps the verified others on C:.
    $blocked = New-Object System.Collections.ArrayList
    $prune = Remove-TownReporterBackupOld -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -Keep $Keep -MinFreeGb $MinFreeGb
    $prunedHere = @($prune.Deleted).Count
    if ($prunedHere -gt 0) {
      $state['prunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['prunedCount'] = $prunedHere
      [void]$lines.Add("cleared this machine: deleted $prunedHere backup(s) from C:, each verified on $OffsiteDir")
    } elseif ($prune.Ok) {
      $state['prunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['prunedCount'] = 0
    }
    if (-not $prune.Ok) {
      if ($prunedHere -gt 0 -or @($prune.Unverified).Count -gt 0) {
        [void]$lines.Add("kept on this machine: $($prune.Reason)")
      } else {
        [void]$lines.Add("deleted nothing from this machine: $($prune.Reason)")
        [void]$blocked.Add($prune.Reason)
      }
    }

    # 3b. The one-off items on C: (hand-named files and old folders): each is
    # deleted from C: once it is verified in D:\...\other-safety-copies.
    $seriesNamesNow = @((Get-TownReporterBackupList -Dir $BackupDir) | ForEach-Object { $_.Name })
    $oneOffPrune = Remove-TownReporterOneOffOld -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -SeriesNames $seriesNamesNow -MinAgeDays $OneOffMinAgeDays -MinFreeGb $MinFreeGb -Now $Now
    if ($oneOffPrune.Ok) {
      $state['oneOffPrunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['oneOffPrunedCount'] = @($oneOffPrune.Deleted).Count
      if (@($oneOffPrune.Deleted).Count -gt 0) { [void]$lines.Add("cleared this machine: deleted $(@($oneOffPrune.Deleted).Count) one-off item(s) from C:, each verified on $OffsiteDir") }
    } else {
      [void]$lines.Add("one-off items: deleted nothing from this machine: $($oneOffPrune.Reason)")
      if ($blocked.Count -eq 0) { [void]$blocked.Add($oneOffPrune.Reason) }
    }

    # 4. D: keeps the newest backup of each of the $KeepDays newest days that
    #    have one, and deletes the rest of the series there. AFTER the C:
    #    prune on purpose: by then every C: file that could be proven against
    #    its D: copy has been, so the D: rule never removes a copy that a C:
    #    file was about to be checked against in this same run.
    $offPrune = Remove-TownReporterOffsiteOld -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -KeepDays $KeepDays -MinFreeGb $MinFreeGb
    if ($offPrune.Ok) {
      $state['offsitePrunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['offsitePrunedCount'] = @($offPrune.Deleted).Count
      if (@($offPrune.Deleted).Count -gt 0) { [void]$lines.Add("kept $KeepDays days on ${OffsiteDir}: deleted $(@($offPrune.Deleted).Count) older backup(s) there, kept $(@($offPrune.Kept).Count)") }
    } else {
      [void]$lines.Add("deleted nothing from ${OffsiteDir}: $($offPrune.Reason)")
      if ($blocked.Count -eq 0) { [void]$blocked.Add($offPrune.Reason) }
    }

    # 4b. One-off items on D: older than $OffsiteOneOffMaxAgeDays days.
    $offOneOff = Remove-TownReporterOffsiteOneOffOld -LogFile $LogFile -BackupDir $BackupDir -OffsiteDir $OffsiteDir -MaxAgeDays $OffsiteOneOffMaxAgeDays -MinFreeGb $MinFreeGb -Now $Now
    if ($offOneOff.Ok) {
      $state['offsiteOneOffPrunedAt'] = Get-TownReporterIsoTime -Time (Get-Date)
      $state['offsiteOneOffPrunedCount'] = @($offOneOff.Deleted).Count
      if (@($offOneOff.Deleted).Count -gt 0) { [void]$lines.Add("deleted $(@($offOneOff.Deleted).Count) one-off item(s) from $OffsiteDir\other-safety-copies, older than $OffsiteOneOffMaxAgeDays days") }
    } else {
      [void]$lines.Add("one-off items: deleted nothing from ${OffsiteDir}: $($offOneOff.Reason)")
      if ($blocked.Count -eq 0) { [void]$blocked.Add($offOneOff.Reason) }
    }
    $state['pruneBlocked'] = if ($blocked.Count -gt 0) { [string]$blocked[0] } else { $null }

    # 5. What is where now, for the Control page and the alerts. D: is listed
    #    here, by the run, so the page never has to list it.
    $local = Get-TownReporterBackupList -Dir $BackupDir
    $state['localCount'] = $local.Count
    $state['localNewestAt'] = if ($local.Count -gt 0) { Get-TownReporterIsoTime -Time $local[0].Stamp } else { $null }
    $offList = @()
    try { $offList = Get-TownReporterBackupList -Dir $OffsiteDir } catch { $offList = @() }
    $state['offsiteCount'] = $offList.Count
    $state['offsiteNewestName'] = if ($offList.Count -gt 0) { $offList[0].Name } else { $null }
    $state['offsiteNewestAt'] = if ($offList.Count -gt 0) { Get-TownReporterIsoTime -Time $offList[0].Stamp } else { $null }
    $state['offsiteNewestBytes'] = if ($offList.Count -gt 0) { $offList[0].Bytes } else { 0 }
    $newestNow = Get-TownReporterNewestBackup -BackupDir $BackupDir -OffsiteDir $OffsiteDir
    $state['newestName'] = if ($newestNow) { $newestNow.Name } else { $null }
    $state['newestAt'] = if ($newestNow) { Get-TownReporterIsoTime -Time $newestNow.Stamp } else { $null }
    $state['newestWhere'] = if ($newestNow) { $newestNow.Where } else { $null }
    $state['newestDir'] = if ($newestNow) { $newestNow.Dir } else { $null }
    if ($state['lastName']) {
      $state['lastPath'] = Get-TownReporterBackupPath -Name $state['lastName'] -BackupDir $BackupDir -OffsiteDir $OffsiteDir
    }
    Save-TownReporterBackupState -StateFile $StateFile -State $state | Out-Null

    $ok = ($copy.Ok -and $dumpOk -ne $false)
    $reason = if ($copy.Ok) { 'all verified' } else { $copy.Reason }
    return @{ Ok = $ok; DumpOk = $dumpOk; Skipped = $false; Reason = $reason; State = $state; Lines = @($lines) }
  } finally {
    Exit-TownReporterBackupLock -LockFile $LockFile
  }
}
