<#
  What is staged on this machine -- and the one thing the watchdog is allowed
  to do about it: start it again.

  ops\stage.ps1 restores a production backup into townreporter_dev, builds
  this checkout and starts the built server on 3100 for a manual walkthrough.
  Everything it stages survives a reboot -- the database, the build, the files
  it wrote -- but the running server does not. After a reboot the operator
  found the staged copy gone and had to re-run the whole restore to get it
  back, which throws away the walkthrough they were in the middle of.

  This file is the read half of the fix: what is staged, is it answering, and
  has anyone tried to start it lately -- answered from files and one HTTP
  probe. ops\start-stage.ps1 is the write half and ops\watchdog.ps1 decides
  when to call it.

  Read-only by construction: there is no Stop-Process, no Start-Process, no
  taskkill and no psql anywhere in this file, so no path through it can reach
  the staged copy, the live paper or the database. Deciding and doing are
  separate files on purpose -- the tests can then run every decision without
  anything being started. What it does write is three small JSON files: the
  start-attempt record, the machine-wide pointer below, and the note of which
  pointer refusal was already logged. The only delete in the file is
  Remove-TownReporterStagedCopyPointer, and it removes that one pointer file
  and nothing else.

  The staged copy is not always in THIS checkout (Unit AL2). The owner's rule
  is that a build never happens in the live checkout, so the copy on 3100 is
  staged from a worker or a dev checkout -- and the live watchdog, looking for
  ops\.stage.json in its own checkout, found nothing and started nothing after
  a reboot. The pointer section near the bottom is the fix: ops\stage.ps1
  writes one machine-wide file naming the checkout it staged, and
  Resolve-TownReporterStageApp decides whether that claim may be acted on.

  It does NOT dot-source lib-port.ps1, and must not start to: that file sets
  $port as a side effect (see the note in ops\stage.ps1), and the watchdog
  holds its own $port from WATCHDOG_APP_PORT. Sourcing it from here would
  silently repoint the watchdog at the .env port instead of the one it was
  told to watch -- a test run would then repair the live paper. The caller
  sources lib-port.ps1; the check at the bottom of this file makes a caller
  that forgot say so instead of failing later on a missing command.

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

if (-not (Get-Command Test-TownReporterPort -ErrorAction SilentlyContinue)) {
  throw 'lib-stage.ps1 needs lib-port.ps1 dot-sourced first (it must not be sourced from here: lib-port.ps1 sets $port as a side effect).'
}

# The same instant, written the one way the rest of the tree writes times:
# ISO 8601 UTC (identical to the definition in lib-backup.ps1 and lib-alert.ps1,
# which guard it the same way because the three are loaded in any order).
if (-not (Get-Command Get-TownReporterIsoTime -ErrorAction SilentlyContinue)) {
  function Get-TownReporterIsoTime {
    param([datetime]$Time = (Get-Date))
    return $Time.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  }
}

# Every path this library reads or writes, derived from one root so a test run
# can point the whole thing at a temporary world with WATCHDOG_STAGE_APP.
function Get-TownReporterStagePaths {
  param([Parameter(Mandatory = $true)][string]$App)
  $root = [IO.Path]::GetFullPath($App)
  [pscustomobject]@{
    App        = $root
    Ops        = Join-Path $root 'ops'
    State      = Join-Path $root 'ops\.stage.json'
    Pid        = Join-Path $root 'ops\.stage.pid'
    Start      = Join-Path $root 'ops\start-stage.ps1'
    Log        = Join-Path $root 'logs\stage-start.log'
    Record     = Join-Path $root 'logs\stage-start.json'
    OutLog     = Join-Path $root 'ops\stage.out.log'
    ErrLog     = Join-Path $root 'ops\stage.err.log'
    PrevOutLog = Join-Path $root 'ops\stage.out.prev.log'
    PrevErrLog = Join-Path $root 'ops\stage.err.prev.log'
  }
}

<#
  Is this a port a staged copy is allowed to be on? Returns $null when it is,
  and a plain-words reason when it is not.

  Three ports can never be one: 3000 is the live paper (ops\stage.ps1 refuses
  it by name), 5433 is the database, and the caller's own app/postgres ports
  are what the watchdog is already watching -- starting a second copy of the
  app on the port the paper is on turns "bring the test copy back" into "take
  the paper down". A hand-edited or corrupt ops\.stage.json is the threat
  here: it is a file, anyone can write any number into it, and this is the
  gate that number has to pass before anything acts on it.
#>
function Test-TownReporterStagePortSafe {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$AppPort = 0,
    [int]$PgPort = 0
  )
  if ($Port -lt 1024 -or $Port -gt 65535) { return "port $Port is not a usable port" }
  if ($Port -eq 3000) { return 'port 3000 belongs to the live paper' }
  if ($Port -eq 5433) { return 'port 5433 belongs to the database' }
  if ($AppPort -gt 0 -and $Port -eq $AppPort) { return "port $Port is the paper's own port" }
  if ($PgPort -gt 0 -and $Port -eq $PgPort) { return "port $Port is the database's port" }
  return $null
}

# One timestamp parser for both files this library reads, so a record written
# by ops\start-stage.ps1 and a record written by ops\watchdog.ps1 can never be
# read two different ways.
function Get-TownReporterStageMinutesSince {
  param([string]$Iso)
  if (-not $Iso) { return -1 }
  try {
    $at = [datetime]::Parse($Iso,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
    return [int]((Get-Date).ToUniversalTime() - $at.ToUniversalTime()).TotalMinutes
  } catch {
    # An unreadable timestamp is not an obstacle to acting: ops\start-stage.ps1
    # rewrites the record either way, and the watchdog treats "cannot read it"
    # as "no attempt on record" rather than as "someone just tried".
    return -1
  }
}

<#
  logs\stage-start.json: the last attempt to bring the staged copy back.

  Two things write it -- ops\watchdog.ps1 records the attempt before it spawns
  anything (that write is what makes "at most once every thirty minutes" true
  even if the spawn dies immediately), and ops\start-stage.ps1 records what
  came of it. Both go through Save- below, so the outcome and the attempt time
  are one row rather than two that can disagree.
#>
function Get-TownReporterStageStartRecord {
  param([Parameter(Mandatory = $true)][string]$App)
  $paths = Get-TownReporterStagePaths -App $App
  $blank = [pscustomobject]@{ LastAttemptAt = ''; LastOutcome = ''; LastReason = ''; LastPid = '' }
  if (-not (Test-Path -LiteralPath $paths.Record)) { return $blank }
  try {
    $parsed = Get-Content -LiteralPath $paths.Record -Raw | ConvertFrom-Json
  } catch {
    return $blank
  }
  # Key by key, not by casting the parsed object: a record written by a future
  # version (or by hand) must not be able to hand this one a property it does
  # not have.
  return [pscustomobject]@{
    LastAttemptAt = [string]$parsed.lastAttemptAt
    LastOutcome   = [string]$parsed.lastOutcome
    LastReason    = [string]$parsed.lastReason
    LastPid       = [string]$parsed.lastPid
  }
}

function Save-TownReporterStageStartRecord {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)]$Record
  )
  $paths = Get-TownReporterStagePaths -App $App
  $dir = Split-Path -Parent $paths.Record
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $doc = [ordered]@{
    lastAttemptAt = [string]$Record.LastAttemptAt
    lastOutcome   = [string]$Record.LastOutcome
    lastReason    = [string]$Record.LastReason
    lastPid       = [string]$Record.LastPid
  }
  # Same shape as the backup state file: write beside it, then move over it, so
  # a reader never sees half a document.
  $tmp = "$($paths.Record).tmp"
  [IO.File]::WriteAllText($tmp, ($doc | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $paths.Record -Force
}

function Write-TownReporterStageLog {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $paths = Get-TownReporterStagePaths -App $App
  $dir = Split-Path -Parent $paths.Log
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -LiteralPath $paths.Log -Encoding UTF8
}

<#
  Has enough time passed since the last attempt? Thirty minutes, the same
  shape as the backup section's failure back-off and for the same reason: a
  start that cannot work (a stale build, a database that is not restored) must
  not be retried every five minutes forever. Missing or unreadable counts as
  due -- refusing to act on a question that could not be asked is how a broken
  state file would silently stop this from ever happening again.
#>
function Test-TownReporterStageStartDue {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [int]$Minutes = 30
  )
  $record = Get-TownReporterStageStartRecord -App $App
  $since = Get-TownReporterStageMinutesSince -Iso $record.LastAttemptAt
  if ($since -lt 0) { return [pscustomobject]@{ Due = $true; Reason = 'no start attempt on record' } }
  if ($since -lt $Minutes) {
    return [pscustomobject]@{ Due = $false; Reason = "the last start attempt was $since minute(s) ago" }
  }
  return [pscustomobject]@{ Due = $true; Reason = "the last start attempt was $since minute(s) ago" }
}

<#
  Who holds the staged copy's port, and is it ours?

  Only ever used to say which of the two it is. The watchdog is start-only:
  it does not stop, restart or clear anything holding that port, because the
  one case where that would matter -- a stale copy of the staged server -- is
  a copy the operator started by hand and can stop by hand with
  ops\stage.ps1 -Stop. A stranger's program on 3100 is not ours to kill.

  Ours comes in two strengths, because the two start scripts do not write the
  same command line. ops\start-townreporter.ps1 (and ops\start-stage.ps1) pass
  the built server's ABSOLUTE path, which Test-TownReporterServerProcess
  matches exactly -- that is Ours. ops\stage.ps1 passes it relative to the
  checkout (" .output/server/index.mjs"), and Windows reports a command line
  as it was typed, so a copy THAT script started is a node process running
  this app's build but not a match for the absolute path. That is Likely:
  enough to stop calling our own copy "another program", never enough to act
  on. The wording is the only thing this feeds.
#>
function Get-TownReporterStageHolder {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][int]$Port
  )
  $owners = @(Get-TownReporterPortOwner -Port $Port)
  $ours = $false
  $likely = $false
  $names = @()
  foreach ($owner in $owners) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    if (-not $p) { $names += "PID $owner"; continue }
    $names += "PID $owner ($($p.Name))"
    if (Test-TownReporterServerProcess -Process $p -App $App) { $ours = $true; continue }
    if ($p.Name -eq 'node.exe' -and ([string]$p.CommandLine -replace '/', '\') -like '*.output\server\index.mjs*') { $likely = $true }
  }
  return [pscustomobject]@{ Count = $owners.Count; Ours = $ours; Likely = $likely; Names = $names }
}

# ==========================================================================
# The machine-wide pointer: which checkout was staged last (Unit AL2)
# ==========================================================================

<#
  Where ops\stage.ps1 records the checkout it just staged.

  Machine-wide and outside every checkout on purpose: one machine has one
  staged copy, and the reader is often not the checkout that staged it. Under
  %LOCALAPPDATA% because that is the one per-user location every process on
  this machine can write and read without asking anyone, and it is not a path
  either checkout can delete by cleaning up after itself.

  An empty return means there is nowhere to write or read it (no LOCALAPPDATA),
  which the callers say out loud rather than guessing a path.
#>
function Get-TownReporterStagedCopyPointerPath {
  param([string]$PointerFile = '')
  if ($PointerFile) { return [IO.Path]::GetFullPath($PointerFile) }
  $base = [string]$env:LOCALAPPDATA
  if (-not $base) { return '' }
  return (Join-Path $base 'TownReporter\staged-copy.json')
}

<#
  The pointer, read. Exists/Ok/Value/Reason, the same shape
  Get-TownReporterStageStartRecord uses: a missing file is not an error, an
  unreadable one is a refusal with a reason.
#>
function Get-TownReporterStagedCopyPointer {
  param([string]$PointerFile = '')
  $path = Get-TownReporterStagedCopyPointerPath -PointerFile $PointerFile
  if (-not $path) {
    return [pscustomobject]@{
      Path = ''; Exists = $false; Ok = $false; Value = $null
      Reason = 'there is no LOCALAPPDATA on this machine, so there is nowhere the staged-copy pointer could be'
    }
  }
  if (-not (Test-Path -LiteralPath $path)) {
    return [pscustomobject]@{ Path = $path; Exists = $false; Ok = $false; Value = $null; Reason = '' }
  }
  try {
    $parsed = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{
      Path = $path; Exists = $true; Ok = $false; Value = $null
      Reason = "the staged-copy pointer $path could not be read ($($_.Exception.Message))"
    }
  }
  return [pscustomobject]@{ Path = $path; Exists = $true; Ok = $true; Value = $parsed; Reason = '' }
}

<#
  Write it, atomically, the way every other state file in the ops layer is
  written: beside the target, then moved over it, so a reader never sees half a
  document. Returns $false when there is nowhere to write it -- a successful
  staging is not failed by a pointer nobody could store, and the caller says so
  in its own words.

  Field names are the ones the readers use, and the readers are three: the
  watchdog, ops\start-stage.ps1 and the Control page (which mirrors these
  checks in JavaScript). The four the brief asks for -- checkout, port, commit,
  version -- plus the database it was staged against and the time, which are
  what makes "is this pointer still describing what I think it does" a question
  anyone can answer without a PowerShell session.
#>
function Save-TownReporterStagedCopyPointer {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$Commit = '',
    [string]$Version = '',
    [string]$Database = '',
    [string]$Time = '',
    [string]$PointerFile = ''
  )
  $path = Get-TownReporterStagedCopyPointerPath -PointerFile $PointerFile
  if (-not $path) { return $false }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  if (-not $Time) { $Time = Get-TownReporterIsoTime }
  $doc = [ordered]@{
    app      = [IO.Path]::GetFullPath($App)
    port     = $Port
    commit   = $Commit
    version  = $Version
    database = $Database
    time     = $Time
  }
  $tmp = "$path.tmp"
  [IO.File]::WriteAllText($tmp, ($doc | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $path -Force
  return $true
}

<#
  Remove it -- and only when it names the checkout being stopped.

  ops\stage.ps1 -Stop removes the pointer of the copy it just stopped. It must
  not remove a pointer naming ANOTHER checkout: that copy is still running
  there, and deleting the record of it is exactly how "after a reboot the
  watchdog brings it back" would stop being true for the one checkout that
  needs it. $App is the checkout stopping; omit it to remove unconditionally
  (tests and cleanup want that).
#>
function Remove-TownReporterStagedCopyPointer {
  param([string]$App = '', [string]$PointerFile = '')
  $path = Get-TownReporterStagedCopyPointerPath -PointerFile $PointerFile
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $false }
  if ($App) {
    $read = Get-TownReporterStagedCopyPointer -PointerFile $path
    if (-not $read.Ok) { return $false }
    $named = [string]$read.Value.app
    if (-not $named) { return $false }
    if ($named.TrimEnd('\') -ine ([IO.Path]::GetFullPath($App)).TrimEnd('\')) { return $false }
  }
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$path.tmp" -Force -ErrorAction SilentlyContinue
  return $true
}

<#
  Has this exact refusal already been said? The watchdog runs every five
  minutes, and a pointer that cannot be trusted is not news the sixth time --
  the operator reads one plain line, not seventy-two a day. Any different
  reason (including a fixed pointer that then fails a different check) is new
  and is said.

  The memo is logs\stage-pointer.json in the checkout doing the asking, beside
  the watchdog's own log, because that is where the operator reads it.
#>
function Test-TownReporterStageNoticeIsNew {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Reason
  )
  $paths = Get-TownReporterStagePaths -App $App
  $dir = Split-Path -Parent $paths.Log
  $file = Join-Path $dir 'stage-pointer.json'
  $last = ''
  if (Test-Path -LiteralPath $file) {
    try { $last = [string](Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).lastReason } catch { $last = '' }
  }
  if ($last -ceq $Reason) { return $false }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $doc = [ordered]@{ lastReason = $Reason; lastAt = (Get-TownReporterIsoTime) }
  $tmp = "$file.tmp"
  [IO.File]::WriteAllText($tmp, ($doc | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $file -Force
  return $true
}

# The refusal, in one shape, so every caller can print it and no caller has to
# guess which fields a refusal has.
function New-TownReporterStagePointerRefusal {
  param(
    [Parameter(Mandatory = $true)][string]$Reason,
    [string]$PointerFile = '',
    [string]$PointerApp = ''
  )
  $folder = ''
  if ($PointerApp) { $folder = Split-Path -Leaf $PointerApp.TrimEnd('\') }
  return [pscustomobject]@{
    App = ''; Ok = $false; From = 'pointer'; Silent = $false; Reason = $Reason
    Folder = $folder; Port = 0; Commit = ''; Version = ''; Database = ''
    PointerFile = $PointerFile; PointerApp = $PointerApp
  }
}

<#
  WHICH CHECKOUT SHOULD BE STARTED, HERE?

  Three answers, and the caller does the same thing with the first two (start
  the checkout it is handed) and nothing at all with the third:

    this checkout   ops\.stage.json is here. The pointer is then not even read:
                    a checkout that staged its own copy is the answer to the
                    question, and a stale pointer elsewhere must not override
                    it.
    the pointer     nothing is staged here, and the machine-wide pointer names
                    a checkout this file is willing to vouch for.
    nothing         and Reason says why, unless Silent is true -- silent is the
                    ordinary "this machine has never staged anything" and the
                    watchdog stays quiet about it, the same reason the backup
                    section is quiet when no backup is due.

  The checks, in the order they run. Every one of them exists because the
  pointer is a file in the user's profile: anyone can write any path into it,
  and this is the gate that path has to pass before a server is started from
  it. A failure starts nothing and says the plain reason:

    1. it can be read as JSON at all;
    2. it names a directory that is there;
    3. that directory is under the same folder as THIS checkout. On this
       machine that folder is C:\Users\scott\Desktop\Code -- the brief's own
       words -- and it is derived from the calling checkout rather than
       hard-coded, for the reason the Control page gives about the backup
       folder: a path to one operator's Desktop, written into an ops script,
       is a claim about a machine the script cannot see. Every checkout of
       this app is a sibling of the others;
    4. it is NOT this checkout when this checkout is the live paper's. The
       live paper answers on 3000 and its checkout is not a build target --
       the owner's rule is that a build never happens there -- so a pointer
       that names it would put a second server in front of the paper's own
       build. $AppPort is how "the live one" is recognised: 3000 is the paper;
    5. it is a TownReporter checkout: package.json names townreporter. A
       folder that is not one of ours has no build to start;
    6. its ops\.stage.json is there, names a safe port, and agrees with the
       pointer on that port AND on the commit. This is the check that makes a
       STALE pointer refuse itself: the pointer says checkout X was staged at
       commit C, and if X has been staged again since -- a new backup, a new
       build -- its own state file no longer says C, so the pointer is not
       describing what is on disk and nothing is started from it;
    7. the build is there (.output\server\index.mjs) and so is
       ops\start-stage.ps1, which is what will be run.

  Commit agreement needs both sides to record one. ops\stage.ps1 wrote no
  commit into ops\.stage.json before this change, so a state file without one
  cannot agree with anything and is refused with that as the reason -- the
  self-consistent outcome, since only pairs written from now on can pass.
#>
function Resolve-TownReporterStageApp {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [int]$AppPort = 0,
    [int]$PgPort = 0,
    [string]$PointerFile = ''
  )
  $own = [IO.Path]::GetFullPath($App)
  $ownFolder = Split-Path -Leaf $own.TrimEnd('\')

  # 1 of the three answers: this checkout has its own staged copy.
  if (Test-Path -LiteralPath (Join-Path $own 'ops\.stage.json')) {
    return [pscustomobject]@{
      App = $own; Ok = $true; From = 'checkout'; Silent = $false; Reason = ''
      Folder = $ownFolder; Port = 0; Commit = ''; Version = ''; Database = ''
      PointerFile = ''; PointerApp = ''
    }
  }

  $read = Get-TownReporterStagedCopyPointer -PointerFile $PointerFile
  if (-not $read.Exists -and -not $read.Reason) {
    # Nothing staged here and no pointer anywhere: the ordinary state of a
    # machine that has never staged. Silence, by construction.
    return [pscustomobject]@{
      App = ''; Ok = $false; From = 'none'; Silent = $true; Reason = ''
      Folder = ''; Port = 0; Commit = ''; Version = ''; Database = ''
      PointerFile = ''; PointerApp = ''
    }
  }
  if (-not $read.Ok) {
    return (New-TownReporterStagePointerRefusal -Reason $read.Reason -PointerFile $read.Path)
  }
  $pointer = $read.Value
  $named = [string]$pointer.app
  if (-not $named) {
    return (New-TownReporterStagePointerRefusal -PointerFile $read.Path `
      -Reason "the staged-copy pointer $($read.Path) does not name a checkout")
  }
  if (-not [IO.Path]::IsPathRooted($named)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $named -PointerFile $read.Path `
      -Reason "the staged-copy pointer names '$named', which is not an absolute path")
  }
  $target = [IO.Path]::GetFullPath($named)
  if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, which is not there any more")
  }

  # Under the same folder as this checkout (see the list above, item 3).
  $root = [IO.Path]::GetFullPath((Split-Path -Parent $own)).TrimEnd('\')
  if ($target.TrimEnd('\') -ieq $root -or -not $target.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, which is not under $root -- the folder this checkout lives in")
  }

  # The live paper's own checkout (item 4).
  if ($AppPort -eq 3000 -and $target.TrimEnd('\') -ieq $own.TrimEnd('\')) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names this checkout ($target), which is the live paper's own -- the test copy is built in another checkout, never here")
  }

  # Ours? (item 5)
  $packageFile = Join-Path $target 'package.json'
  $packageName = ''
  if (Test-Path -LiteralPath $packageFile) {
    try { $packageName = [string](Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).name } catch { $packageName = '' }
  }
  if ($packageName -ne 'townreporter') {
    $what = if ($packageName) { "its package.json names '$packageName'" } else { 'it has no readable package.json' }
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, which is not a TownReporter checkout ($what)")
  }

  # Its own record of the staging, agreeing with the pointer (item 6).
  $targetPaths = Get-TownReporterStagePaths -App $target
  if (-not (Test-Path -LiteralPath $targetPaths.State)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, but there is no ops\.stage.json there -- nothing is staged in it")
  }
  $state = $null
  try {
    $state = Get-Content -LiteralPath $targetPaths.State -Raw | ConvertFrom-Json
  } catch {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, and its ops\.stage.json could not be read ($($_.Exception.Message))")
  }
  $rawPort = [string]$state.port
  if ($rawPort -notmatch '^\d+$') {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, whose ops\.stage.json does not name a port ('$rawPort')")
  }
  $statePort = [int]$rawPort
  $pointerPort = [string]$pointer.port
  if ($pointerPort -notmatch '^\d+$' -or [int]$pointerPort -ne $statePort) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names port $pointerPort but $target's own ops\.stage.json names port $statePort; one of the two is out of date")
  }
  $unsafe = Test-TownReporterStagePortSafe -Port $statePort -AppPort $AppPort -PgPort $PgPort
  if ($unsafe) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, whose ops\.stage.json names a port the staged copy must not use -- $unsafe")
  }
  $stateCommit = [string]$state.commit
  $pointerCommit = [string]$pointer.commit
  if (-not $stateCommit) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names commit '$pointerCommit' but $target's own ops\.stage.json records no commit, so the two cannot be shown to agree")
  }
  if ($stateCommit -ne $pointerCommit) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names commit $pointerCommit but $target's own ops\.stage.json records $stateCommit; the checkout has been staged again since, so the pointer is out of date")
  }

  # The two files that will actually be used (item 7).
  $outputServer = Join-Path $target '.output\server\index.mjs'
  if (-not (Test-Path -LiteralPath $outputServer)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, which has no build at $outputServer")
  }
  if (-not (Test-Path -LiteralPath $targetPaths.Start)) {
    return (New-TownReporterStagePointerRefusal -PointerApp $target -PointerFile $read.Path `
      -Reason "the staged-copy pointer names $target, which has no $($targetPaths.Start) -- a copy staged there could not be started")
  }

  return [pscustomobject]@{
    App = $target; Ok = $true; From = 'pointer'; Silent = $false; Reason = ''
    Folder = (Split-Path -Leaf $target.TrimEnd('\')); Port = $statePort
    Commit = $stateCommit; Version = [string]$state.version; Database = [string]$pointer.database
    PointerFile = $read.Path; PointerApp = $target
  }
}

<#
  Everything both callers need to know, in one object.

  Verdict is the decision, and there are only five:

    none      nothing is staged here, or the state file does not name a port
              this is allowed to touch. Reason says which.
    up        listening on the staged port and answering HTTP 200.
    starting  not answering, and an attempt was recorded within the last
              StartWindowSeconds -- a start is in flight. Doing nothing here
              is the whole point: a second copy would fight the first for the
              port and one of them would die.
    wedged    something is listening on the staged port but did not answer
              200. Nothing will be started: the port is taken, and a start
              would die on its own port check anyway.
    down      staged, the port is free, nothing is answering and no attempt
              is in flight. This is the reboot case, and the only verdict the
              watchdog starts anything for.
#>
function Get-TownReporterStageInfo {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [int]$AppPort = 0,
    [int]$PgPort = 0,
    [int]$StartWindowSeconds = 150
  )
  $paths = Get-TownReporterStagePaths -App $App
  $stateExists = Test-Path -LiteralPath $paths.State
  $info = [ordered]@{
    App          = $paths.App
    StateExists  = $stateExists
    Staged       = $false
    Port         = 0
    Version      = ''
    Backup       = ''
    Started      = ''
    Pid          = ''
    PidAlive     = $false
    Listening    = $false
    Code         = 0
    Error        = ''
    HolderCount  = 0
    HolderOurs   = $false
    HolderLikely = $false
    HolderNames  = @()
    LastAttemptAt = ''
    MinutesSinceAttempt = -1
    Verdict      = 'none'
    Reason       = ''
    Paths        = $paths
  }

  if (-not $stateExists) {
    $info.Reason = 'nothing is staged here (no ops\.stage.json)'
    return [pscustomobject]$info
  }

  $state = $null
  try {
    $state = Get-Content -LiteralPath $paths.State -Raw | ConvertFrom-Json
  } catch {
    $info.Reason = "ops\.stage.json could not be read ($($_.Exception.Message))"
    return [pscustomobject]$info
  }

  $rawPort = [string]$state.port
  if ($rawPort -notmatch '^\d+$') {
    $info.Reason = "ops\.stage.json does not name a port ('$rawPort')"
    return [pscustomobject]$info
  }
  $port = [int]$rawPort
  $unsafe = Test-TownReporterStagePortSafe -Port $port -AppPort $AppPort -PgPort $PgPort
  if ($unsafe) {
    $info.Reason = "ops\.stage.json names a port the staged copy must not use -- $unsafe; refusing to treat it as staged"
    return [pscustomobject]$info
  }

  $info.Staged = $true
  $info.Port = $port
  $info.Version = [string]$state.version
  $info.Backup = [string]$state.backup
  $info.Started = [string]$state.started
  if (Test-Path -LiteralPath $paths.Pid) {
    $pidText = (Get-Content -LiteralPath $paths.Pid -Raw).Trim()
    if ($pidText -match '^\d+$') {
      $info.Pid = $pidText
      $info.PidAlive = [bool](Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue)
    }
  }

  $record = Get-TownReporterStageStartRecord -App $App
  $info.LastAttemptAt = $record.LastAttemptAt
  $info.MinutesSinceAttempt = Get-TownReporterStageMinutesSince -Iso $record.LastAttemptAt

  # The probe is last: it is the only part that touches a socket, so a state
  # file that cannot be trusted never gets one.
  $code = 0
  if (Test-TownReporterPort $port) {
    try {
      $code = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 15).StatusCode
    } catch {
      $code = -1
      # A 4xx or 5xx comes back as an exception, not as a status code. Dig the
      # number out when there is one: "answered 503" is a fact about the port,
      # "did not answer" is a different fact, and the Control page and the log
      # both have to say which one happened. -1 means the socket was there and
      # nothing came back at all, which is what a half-dead listener looks like.
      $response = $_.Exception.Response
      if ($response -and $response.StatusCode) { $code = [int]$response.StatusCode } else { $info.Error = $_.Exception.Message }
    }
  }
  $info.Listening = ($code -ne 0)
  $info.Code = [int]$code

  if ($code -eq 200) {
    $info.Verdict = 'up'
    $info.Reason = "staged copy is answering 200 on 127.0.0.1:$port"
    if ($info.Version) { $info.Reason = "$($info.Reason) (version $($info.Version))" }
    return [pscustomobject]$info
  }

  if ($info.Listening) {
    $holder = Get-TownReporterStageHolder -App $App -Port $port
    $info.HolderCount = $holder.Count
    $info.HolderOurs = $holder.Ours
    $info.HolderLikely = $holder.Likely
    $info.HolderNames = $holder.Names
    $who = if ($holder.Ours) { 'a copy of the staged server' }
      elseif ($holder.Likely) { 'a node process running a build of this app' }
      else { 'another program' }
    $detail = if ($code -gt 0) { "answered $code" } else { "did not answer ($($info.Error))" }
    $info.Verdict = 'wedged'
    $info.Reason = "something is listening on 127.0.0.1:$port ($who) but $detail; not starting a second copy"
    return [pscustomobject]$info
  }

  $since = $info.MinutesSinceAttempt
  if ($since -ge 0 -and ($since * 60) -lt $StartWindowSeconds) {
    $info.Verdict = 'starting'
    $info.Reason = "a start was recorded $since minute(s) ago and nothing is answering yet"
    return [pscustomobject]$info
  }

  $info.Verdict = 'down'
  $info.Reason = if ($record.LastOutcome -eq 'failed') {
    "staged, not answering, and the last start attempt failed: $($record.LastReason)"
  } else {
    "staged (version $($info.Version)), nothing answering on 127.0.0.1:$port"
  }
  return [pscustomobject]$info
}
