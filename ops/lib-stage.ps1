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
  anything being started.

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
