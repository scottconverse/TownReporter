<#
  Be polite to the paper while a big disk job runs (G25-DK-2).

  On Oct 25 2026 the live paper was slow or down for about 12 minutes while
  three big disk jobs ran on C: at once. Which job did most of it is UNVERIFIED.
  This file does not guess; it adds two things and kills nothing:

    Wait-TownReporterDiskJobTurn
      A big disk job (a backup copy, a prune, a folder move) calls this BETWEEN
      small batches. It asks the paper for its front page. If the paper is slow
      or not answering it waits, logging each wait, up to a cap, and then goes
      on. It never fails the job: a cap that runs out just means "go on".

      A refused connection (nothing listens on the port) is not a slow paper
      and is not waited for: the paper is down for some other reason, and a
      backup that stalls behind a stopped app helps nobody. It is logged.

    Get-TownReporterTopDiskProcesses
      The few busiest processes by disk bytes per second right now, name and
      PID, so the log can name the cause next time. Never throws.

  Every seam (-Probe, -Sleep, -Log) exists so a test needs no real :3000 and
  no real wait.
#>

# Total time one job may spend waiting across all its batches, so a paper that
# stays slow cannot hold a backup forever. Reset with Reset-TownReporterDiskJobBudget.
$script:TownReporterDiskJobWaitedSeconds = 0
$script:TownReporterDiskJobBudgetSeconds = 900

function Reset-TownReporterDiskJobBudget {
  param([int]$BudgetSeconds = 900)
  $script:TownReporterDiskJobWaitedSeconds = 0
  $script:TownReporterDiskJobBudgetSeconds = $BudgetSeconds
}

# One look at the paper. Returns @{ Kind; Detail; Seconds } where Kind is
# 'fast' (200 inside -SlowSeconds), 'slow' (200, but slow), 'bad' (an error
# status or a timeout) or 'refused' (nothing is listening).
function Test-TownReporterPaperResponsive {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$SlowSeconds = 3,
    [int]$TimeoutSec = 10,
    [scriptblock]$Probe
  )
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    if ($Probe) {
      $code = [int](& $Probe $Port)
    } else {
      $code = (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec $TimeoutSec).StatusCode
    }
  } catch {
    $msg = $_.Exception.Message
    $kind = if ($msg -match 'refused|actively refused|Unable to connect|No connection could be made|Connection refused') { 'refused' } else { 'bad' }
    return @{ Kind = $kind; Detail = $msg; Seconds = [math]::Round($clock.Elapsed.TotalSeconds, 1) }
  }
  $secs = [math]::Round($clock.Elapsed.TotalSeconds, 1)
  if ($code -ne 200) { return @{ Kind = 'bad'; Detail = "status $code"; Seconds = $secs } }
  if ($secs -gt $SlowSeconds) { return @{ Kind = 'slow'; Detail = "answered 200 in $secs s"; Seconds = $secs } }
  return @{ Kind = 'fast'; Detail = "answered 200 in $secs s"; Seconds = $secs }
}

<#
  Returns @{ Waited = <seconds waited>; Capped = <bool>; Kind = <last look> }.
#>
function Wait-TownReporterDiskJobTurn {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$MaxWaitSeconds = 120,
    [int]$PollSeconds = 5,
    [int]$SlowSeconds = 3,
    [string]$JobName = 'disk job',
    [scriptblock]$Probe,
    [scriptblock]$Sleep,
    [scriptblock]$Log
  )
  $waited = 0
  $look = $null
  try {
    while ($true) {
      $look = Test-TownReporterPaperResponsive -Port $Port -SlowSeconds $SlowSeconds -Probe $Probe
      if ($look.Kind -eq 'fast') { break }
      if ($look.Kind -eq 'refused') {
        if ($Log) { & $Log "disk guard: $JobName -- nothing listens on :$Port, so there is no slow paper to wait for; going on" }
        break
      }
      $left = [math]::Min($MaxWaitSeconds - $waited, $script:TownReporterDiskJobBudgetSeconds - $script:TownReporterDiskJobWaitedSeconds)
      if ($left -le 0) {
        if ($Log) { & $Log "disk guard: $JobName -- the paper on :$Port is still $($look.Kind) ($($look.Detail)) after waiting $waited s; the wait cap is used up, going on" }
        return @{ Waited = $waited; Capped = $true; Kind = $look.Kind }
      }
      $step = [math]::Min($PollSeconds, $left)
      if ($Log) { & $Log "disk guard: $JobName -- the paper on :$Port is $($look.Kind) ($($look.Detail)); pausing $step s ($waited s waited so far)" }
      if ($Sleep) { & $Sleep $step } else { Start-Sleep -Seconds $step }
      $waited += $step
      $script:TownReporterDiskJobWaitedSeconds += $step
    }
  } catch {
    # A guard that throws would fail the job it exists to protect.
    if ($Log) { try { & $Log "disk guard: $JobName -- the check failed ($($_.Exception.Message)); going on" } catch { } }
    return @{ Waited = $waited; Capped = $false; Kind = 'error' }
  }
  if ($waited -gt 0 -and $Log) { & $Log "disk guard: $JobName -- the paper on :$Port is $($look.Kind) again after $waited s; going on" }
  return @{ Waited = $waited; Capped = $false; Kind = $look.Kind }
}

# "name (PID n) 12.3 MB/s, ..." for the busiest processes by disk bytes per
# second. -Rows is a seam: objects with Name, IDProcess and IODataBytesPersec.
function Get-TownReporterTopDiskProcesses {
  param([int]$Count = 3, [object[]]$Rows)
  try {
    if (-not $PSBoundParameters.ContainsKey('Rows')) {
      $Rows = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop)
    }
    $top = @($Rows |
      Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' -and [double]$_.IODataBytesPersec -gt 0 } |
      Sort-Object -Property { [double]$_.IODataBytesPersec } -Descending |
      Select-Object -First $Count)
    if ($top.Count -eq 0) { return 'none above zero' }
    return (($top | ForEach-Object { "{0} (PID {1}) {2:N1} MB/s" -f $_.Name, $_.IDProcess, ([double]$_.IODataBytesPersec / 1MB) }) -join ', ')
  } catch {
    return 'unknown'
  }
}
