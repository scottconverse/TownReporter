<#
  The start guard: do not kill a start that is still starting, and stop a
  start that hangs.

  The watchdog repairs an unhealthy app by stopping whatever built server holds
  the app's port (ops\watchdog.ps1, the port-owner loop) and then starting the
  app again. A slow start holds that port long before it answers 200, and the
  old order asked "is a start already in progress?" only AFTER that stop -- so
  the stop won, and a start that was still working was killed and started over,
  every five minutes for as long as it stayed slow.

  Two sources can say a start is in progress:

    * the marker the repair writes when it launches the start script
      (logs\watchdog-start.json: the PID of the PowerShell process running the
      script, when it began, and the FULL path of the script). Believed only
      while that PID is alive AND its command line still names that exact
      script and that path is the script this checkout would start -- a dead
      PID, a reused PID (the command line moved on to some other program) or a
      different script all mean no start is in progress.
    * the logon task still reporting 267009 (SCHED_S_TASK_RUNNING), live only.

  Under the deadline the start is in progress; over it, it is hung. The
  deadline is the same number for both sources, and the caller does the
  stopping (by PID for the marker, Stop-ScheduledTask for the task) so this
  library stays a decision and nothing else.

  Every input is a parameter, so a test can hand it fake values instead of
  building a real slow start (scripts\ci-watchdog-start-guard.ps1 does).

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

# 600 seconds (two watchdog runs) is D267: it covers the worst GOOD cold-boot
# start of about 520 s measured on 2026-10-24 by the coordinator --
# start-townreporter.ps1 can wait up to 180 s for the Postgres port, then
# Wait-TownReporterDatabase waits up to 180 s for the first query, then up to
# 3 migrate attempts 10 s apart, then the server start (75 s measured as the
# longest of 40 warm starts in the live paper's logs, "=== started" to
# "=== start finished", Oct 22 11:01 PM). A shorter deadline killed sound
# cold starts. WATCHDOG_START_DEADLINE_SECONDS overrides it ONLY in test mode
# (Get-TownReporterStartDeadline below), so the automated proof can run the
# whole guard in seconds; a stray value on the live machine must never shorten
# the window that protects a real start.
$script:TownReporterStartDeadlineSeconds = 600

function Get-TownReporterStartMarkerPath {
  param([Parameter(Mandatory = $true)][string]$App)
  return (Join-Path $App 'logs\watchdog-start.json')
}

function Get-TownReporterStartDeadline {
  param([bool]$TestMode = $false)
  if ($TestMode -and $env:WATCHDOG_START_DEADLINE_SECONDS -match '^\d+$') { return [int]$env:WATCHDOG_START_DEADLINE_SECONDS }
  return [int]$script:TownReporterStartDeadlineSeconds
}

# -ProcessId, not -Pid: PowerShell variable names are case-insensitive and $PID
# is a read-only automatic, so a parameter called $Pid cannot be bound.
function Write-TownReporterStartMarker {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Script,
    $StartedAt
  )
  $when = if ($StartedAt) { [datetime]$StartedAt } else { Get-Date }
  $path = Get-TownReporterStartMarkerPath -App $App
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $doc = [pscustomobject]@{
    pid       = $ProcessId
    startedAt = $when.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    script    = $Script
  }
  [IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
}

# $null when the marker is missing, unreadable, or missing a field this guard
# cannot trust. A caller treats $null as "no start in progress".
function Read-TownReporterStartMarker {
  param([Parameter(Mandatory = $true)][string]$App)
  $path = Get-TownReporterStartMarkerPath -App $App
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $doc = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($null -eq $doc) { return $null }
    if ("$($doc.pid)" -notmatch '^\d+$') { return $null }
    if (-not $doc.startedAt -or -not $doc.script) { return $null }
    $started = [datetime]::Parse(
      [string]$doc.startedAt,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind)
    return [pscustomobject]@{
      Pid       = [int]$doc.pid
      StartedAt = $started
      Script    = [string]$doc.script
    }
  } catch {
    return $null
  }
}

function Remove-TownReporterStartMarker {
  param([Parameter(Mandatory = $true)][string]$App)
  Remove-Item -LiteralPath (Get-TownReporterStartMarkerPath -App $App) -Force -ErrorAction SilentlyContinue
}

function Get-TownReporterFullScriptPath {
  param([string]$Path)
  if (-not $Path) { return '' }
  return ([IO.Path]::GetFullPath($Path) -replace '/', '\')
}

<#
  The decision. Returns State ('in-progress', 'hung', 'none'), AgeSeconds (-1
  when no source could say), Source ('marker', 'task', 'none') and MarkerPid
  (0 unless the marker decided).

  Inputs, all explicit so a test can fake them:
    Marker            Read-TownReporterStartMarker's object, or $null
    MarkerProcess     the lookup for Marker.Pid (Get-CimInstance result), or
                      $null when that PID is gone
    ExpectedScript    the FULL path of the script this checkout would start
    TaskLastTaskResult / TaskLastRunTime   Get-ScheduledTaskInfo, or $null
    Deadline          seconds; Get-TownReporterStartDeadline
    TestMode          live-only task source is skipped when true
    Now               the clock; defaults to Get-Date
#>
function Get-TownReporterStartState {
  param(
    $Marker,
    $MarkerProcess,
    [string]$ExpectedScript,
    $TaskLastTaskResult,
    $TaskLastRunTime,
    [int]$Deadline = 0,
    [bool]$TestMode = $false,
    $Now
  )
  $now = if ($Now) { [datetime]$Now } else { Get-Date }
  if ($Deadline -le 0) { $Deadline = [int]$script:TownReporterStartDeadlineSeconds }

  if ($Marker -and $MarkerProcess) {
    $expected = Get-TownReporterFullScriptPath $ExpectedScript
    $markerScript = Get-TownReporterFullScriptPath ([string]$Marker.Script)
    $commandLine = Get-TownReporterNormalizedCommandLine -Process $MarkerProcess
    $trusted = [bool](
      $expected -and
      $markerScript -and
      ($markerScript -eq $expected) -and
      $commandLine -and
      ($commandLine.IndexOf($markerScript, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    )
    if ($trusted) {
      $age = [int]($now - [datetime]$Marker.StartedAt).TotalSeconds
      if ($age -lt 0) { $age = 0 }
      $state = if ($age -lt $Deadline) { 'in-progress' } else { 'hung' }
      return [pscustomobject]@{ State = $state; AgeSeconds = $age; Source = 'marker'; MarkerPid = [int]$Marker.Pid }
    }
  }

  if (-not $TestMode -and $TaskLastRunTime -and "$TaskLastTaskResult" -eq '267009') {
    $age = [int]($now - [datetime]$TaskLastRunTime).TotalSeconds
    if ($age -lt 0) { $age = 0 }
    $state = if ($age -lt $Deadline) { 'in-progress' } else { 'hung' }
    return [pscustomobject]@{ State = $state; AgeSeconds = $age; Source = 'task'; MarkerPid = 0 }
  }

  return [pscustomobject]@{ State = 'none'; AgeSeconds = -1; Source = 'none'; MarkerPid = 0 }
}
