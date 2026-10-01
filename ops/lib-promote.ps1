<#
  The parts of a promotion that have to survive the promotion.

  ops\promote.ps1 died three times on the live machine -- twice at `npm ci`,
  once at `npm run build` -- and left no evidence of why. It had already
  backed up, stopped the paper and fast-forwarded the checkout by then, so the
  paper stayed down until somebody finished by hand. Every one of those runs
  was started from an agent's shell tool rather than a scheduled task.

  WHAT ACTUALLY KILLS AN NPM STEP (measured 2026-10-01, Windows PowerShell
  5.1.26100, this machine, with a fake 20-second child):

    `& npm ci` runs npm with this script's own stdout handle. When the console
    or tool that started the script goes away -- its pipe is closed, or its
    shell is killed -- that handle has no reader left. Writes then fill the
    pipe buffer and fail, node raises EPIPE, and npm dies mid-install. The
    child is not killed by its parent dying; it is killed by writing to a pipe
    nobody is reading. A small write survives (it just sits in the buffer),
    which is why a short step can look fine while `npm ci` never finishes.

    Reproduced both ways, side by side, in scripts\promote-step-runner.test.mjs:
      - inline `& node chatty.mjs 20000`, launcher's stdout pipe closed at 3s
        -> the child never reached its end; no output, no record anywhere;
      - Start-Process with -RedirectStandardOutput, same pipe closed at 3s
        -> the child ran its full 20s and its output was in the log file.

  So every child here runs through Start-Process with its stdout and stderr
  redirected to FILES (never inherited pipes), and this script waits on it.

  THE EXIT CODE, WHICH IS NOT WHERE YOU EXPECT IT. On this machine
  (Windows PowerShell 5.1.26100) `Start-Process -PassThru` returns a Process
  whose `ExitCode` is EMPTY even after WaitForExit() and Refresh() -- measured
  with a child that exits 7:

      HasExited = True, ExitCode = ''

  A promotion that read `$process.ExitCode` would take every failed npm step
  for a success. So the child records its own exit code as the last line of
  its own redirected stdout ("PROMOTE_EXIT=<n>", written by the tiny wrapper
  .cmd this script generates), and that line is the authority -- it is also
  still there, in the log file, if the promotion itself is killed while the
  child is running.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

<#
  One log file per run: logs\promote-<yyyyMMdd-HHmmss>.log.

  Returns a hashtable carried through every call below. `Dir` and `Stamp` name
  the sibling files a child's own output goes to, so the log can name them.
#>
function New-PromoteLog {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')
  )
  $dir = Join-Path $App "logs"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return @{
    App   = $App
    Dir   = $dir
    Stamp = $Stamp
    Path  = (Join-Path $dir "promote-$Stamp.log")
  }
}

<#
  One line per step, timestamped, written to the file AND shown on the
  console. The two are deliberately separate: the file is the record that
  outlives the console, and the console is what the operator watches.

  Neither write may stop a promotion. A closed console pipe is exactly what
  this unit exists for, so a failed console write is swallowed; a failed log
  write is swallowed too, because losing the log is bad and losing the paper
  is worse.
#>
function Write-PromoteLog {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Line
  )
  $stamped = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Line
  try { Add-Content -Path $Log.Path -Value $stamped -Encoding ASCII -ErrorAction Stop } catch { }
  try { Write-Host "  $Line" } catch { }
  # Nothing is emitted to the pipeline, deliberately. In PowerShell a function
  # returns everything it did not capture, so a logging helper that returned
  # its line would make every caller of every function below return an array of
  # log lines instead of an answer -- and `$child.ExitCode` on an array of
  # strings is empty, which is the same "a failed step looks like a success"
  # trap this library exists to close.
}

<#
  The steps, in the order they must happen. Ranks drive -Resume: a run that
  resumes at a step skips every step ranked before it.

  `preflight` is everything that can fail without consequence (the checkout is
  clean, origin/main is a straight-line fast-forward away, no editor job is
  running) and it stays before `stop` for exactly that reason.
#>
function Get-PromoteStepOrder {
  return @('backup', 'preflight', 'stop', 'ff', 'deps', 'build', 'start', 'verify')
}

function Get-PromoteStepRank {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [array]::IndexOf((Get-PromoteStepOrder), $Name)
}

function Add-PromoteStep {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Detail = ""
  )
  if ($Detail) { Write-PromoteLog $Log "step=$Name started -- $Detail"; return }
  Write-PromoteLog $Log "step=$Name started"
}

function Complete-PromoteStep {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Name,
    [double]$Seconds = -1,
    [string]$Detail = ""
  )
  $line = "step=$Name ok"
  if ($Seconds -ge 0) { $line += " ($([math]::Round($Seconds,1))s)" }
  if ($Detail) { $line += ": $Detail" }
  Write-PromoteLog $Log $line
}

function Fail-PromoteStep {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  Write-PromoteLog $Log "step=$Name FAILED: $Detail"
}

<#
  The marker watchdog.ps1 stands down for. Refreshing it on a resumed run
  matters: the age cap is what stops a promote that died here from silencing
  the watchdog forever, and a run that resumes an hour later has to re-earn
  that grace rather than inherit nothing.
#>
function New-PromoteMarker {
  param([Parameter(Mandatory = $true)][string]$App)
  $dir = Join-Path $App "logs"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $path = Join-Path $dir "promote-in-progress"
  Set-Content -Path $path -Value (Get-Date -Format o) -Encoding ASCII
  return $path
}

function Clear-PromoteMarker {
  param([Parameter(Mandatory = $true)][string]$App)
  Remove-Item (Join-Path (Join-Path $App "logs") "promote-in-progress") -Force -ErrorAction SilentlyContinue
}

<#
  Is the paper answering on its port right now?

  Only used to decide whether a failure has to print the command that brings
  it back. Goes through ops\lib-port.ps1's check when that has been
  dot-sourced -- which filters out another program's IPv6-only listener on the
  same port number -- and falls back to a plain listen check when it has not,
  so this library stays usable on its own from a test.
#>
function Test-PromotePaperUp {
  param([Parameter(Mandatory = $true)][int]$Port)
  # Never throws. It is called from the failure path to decide whether to print
  # the command that brings the paper back, and a probe that threw there would
  # take the STOP message with it. An unanswerable question answers "no", which
  # is the safe way round: it prints a command that is a no-op if the paper is
  # in fact up, and clears nothing.
  try {
    # Captured, not called inline: Get-Command emits the command object into
    # the pipeline on success, which would make this function return two things.
    $shared = Get-Command Test-TownReporterPort -ErrorAction SilentlyContinue
    if ($shared) {
      return [bool](Test-TownReporterPort -Port $Port)
    }
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

<#
  The exact command that brings the paper back, for printing as the last line
  of any failure that leaves it down. Plain words, copy-and-paste ready.
#>
function Get-PromoteRecoveryCommand {
  param([Parameter(Mandatory = $true)][string]$App)
  $start = Join-Path (Join-Path $App "ops") "start-townreporter.ps1"
  return "powershell -NoProfile -ExecutionPolicy Bypass -File `"$start`""
}

<#
  Run one long step as a detached child and wait for it. Returns
  @{ ExitCode; Seconds; OutFile; ErrFile; Completed }.

  ExitCode is the child's REAL code, read from the PROMOTE_EXIT line the child
  wrote into its own stdout -- see the header for why $process.ExitCode cannot
  be used here. $null means the step never reached its end (killed, or the
  machine went away), which is itself the answer: it did not succeed.

  The command runs through a generated .cmd wrapper because Start-Process
  cannot execute a batch shim or an .cmd (npm is npm.cmd) directly, and
  because `%ERRORLEVEL%` in a batch file is expanded per line -- on a single
  cmd.exe command line it would be expanded before the command even ran.
#>
function Invoke-PromoteChild {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$WorkingDirectory = ""
  )
  if (-not $WorkingDirectory) { $WorkingDirectory = $Log.App }

  $base    = Join-Path $Log.Dir "promote-$($Log.Stamp)-$Step"
  $wrapper = "$base.cmd"
  $outFile = "$base.out.log"
  $errFile = "$base.err.log"

  # `call`, and it is load-bearing.
  #
  # npm is npm.cmd -- a batch file. When cmd.exe runs one batch file from
  # another WITHOUT `call`, it abandons the caller: the rest of this wrapper
  # never runs, so no exit code is ever written. Measured 2026-10-01 against a
  # fake npm.cmd: `npm ci` printed its output and the wrapper stopped dead
  # there, "no exit code written". With `call`, control comes back and
  # %ERRORLEVEL% is the step's real code.
  $wrapperLines = @(
    "@echo off",
    "call $Command",
    "set PROMOTE_EXIT=%ERRORLEVEL%",
    "echo(",
    "echo PROMOTE_EXIT=%PROMOTE_EXIT%",
    "exit /b %PROMOTE_EXIT%"
  )
  Set-Content -Path $wrapper -Value $wrapperLines -Encoding ASCII

  Write-PromoteLog $Log "step=$Step child: $Command"
  Write-PromoteLog $Log "step=$Step child output: $outFile (errors: $errFile)"

  $comspec = $env:ComSpec
  if (-not $comspec) { $comspec = "cmd.exe" }

  $started = Get-Date
  $proc = $null
  try {
    $proc = Start-Process -FilePath $comspec `
      -ArgumentList @('/d', '/c', "`"$wrapper`"") `
      -WorkingDirectory $WorkingDirectory `
      -NoNewWindow -PassThru `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  } catch {
    # Never let "could not start it" escape as an unhandled error: the caller
    # has a stop-the-paper window to close and needs the failure, not a crash.
    Write-PromoteLog $Log "step=$Step child: $Command could not be started: $($_.Exception.Message)"
    return [pscustomobject]@{
      ExitCode  = $null
      Seconds   = ((Get-Date) - $started).TotalSeconds
      Completed = $false
      OutFile   = $outFile
      ErrFile   = $errFile
    }
  }
  Write-PromoteLog $Log "step=$Step child pid $($proc.Id)"

  try { $proc.WaitForExit() } catch { }

  # Belt and braces, because the cost of being wrong here is asymmetric: a step
  # wrongly called failed takes the previous build back over one that worked.
  # If the wait could not be trusted, watch the process itself rather than
  # concluding from a file that is not there yet.
  for ($i = 0; $i -lt 60 -and (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }

  $seconds = ((Get-Date) - $started).TotalSeconds

  # The last PROMOTE_EXIT= line wins: the child's own output comes before it.
  # -Tail keeps a chatty npm install from being read into memory in full.
  $code = $null
  if (Test-Path $outFile) {
    foreach ($line in @(Get-Content -Path $outFile -Tail 25 -ErrorAction SilentlyContinue)) {
      $m = [regex]::Match("$line", '^PROMOTE_EXIT=(\d+)\s*$')
      if ($m.Success) { $code = [int]$m.Groups[1].Value }
    }
  }

  if ($null -eq $code) {
    Write-PromoteLog $Log "step=$Step child: $Command did not reach its end (no exit code written after $([math]::Round($seconds,1))s)"
  } else {
    Write-PromoteLog $Log "step=$Step child: $Command exit $code ($([math]::Round($seconds,1))s)"
  }

  return [pscustomobject]@{
    ExitCode  = $code
    Seconds   = $seconds
    Completed = ($null -ne $code)
    OutFile   = $outFile
    ErrFile   = $errFile
  }
}

<#
  What did the last run reach, and where should a -Resume pick up?

  Reads the newest logs\promote-*.log, not the marker alone: the marker says a
  run is unfinished, the log says how far it got. The last step line decides:

    ok       -> resume at the step after it
    started  -> it was interrupted mid-flight; run that step again
    failed   -> run that step again

  Returns $null when there is no marker, so the caller can tell "nothing to
  resume" from "a run is unfinished".
#>
function Get-PromoteResumePoint {
  param([Parameter(Mandatory = $true)][string]$App)

  $logs = Join-Path $App "logs"
  if (-not (Test-Path (Join-Path $logs "promote-in-progress"))) { return $null }

  $point = [pscustomobject]@{
    LogPath   = $null
    Step      = $null
    Status    = "unknown"
    StartedAt = $null
    Backup    = $null
    NextStep  = $null
  }

  $file = Get-ChildItem -Path $logs -Filter 'promote-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $file) { return $point }
  $point.LogPath = $file.FullName

  $stepRe = '^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] step=(?<name>[a-z]+) (?<status>started|ok|failed)\b(?<rest>.*)$'
  $startRe = '^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] promote started\b'
  # Fail-PromoteStep writes "FAILED" in capitals so a failure stands out in the
  # log; matching it case-insensitively keeps the two spellings one status.
  $opts = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  $last = $null
  foreach ($line in @(Get-Content -Path $file.FullName -ErrorAction SilentlyContinue)) {
    $sm = [regex]::Match($line, $startRe)
    if ($sm.Success -and -not $point.StartedAt) { $point.StartedAt = $sm.Groups['ts'].Value }
    $m = [regex]::Match($line, $stepRe, $opts)
    if (-not $m.Success) { continue }
    $last = $m
    if ($m.Groups['name'].Value -eq 'backup' -and $m.Groups['status'].Value -match '^(?i)ok$') {
      # "ok (93.2s): C:\...\townreporter_....sql (12.4 MB)" -- drop the duration
      # and the colon, keep everything after them. A run that resumes reuses
      # this path, so it has to come out exactly as the backup step wrote it.
      $point.Backup = ($m.Groups['rest'].Value -replace '^\s*(\([^)]*\))?\s*:?\s*', '')
    }
  }
  if (-not $last) { return $point }

  $point.Step = $last.Groups['name'].Value
  $point.Status = $last.Groups['status'].Value.ToLower()

  $order = Get-PromoteStepOrder
  $rank = [array]::IndexOf($order, $point.Step)
  if ($rank -lt 0) { return $point }
  if ($point.Status -eq 'ok') {
    if ($rank + 1 -lt $order.Count) { $point.NextStep = $order[$rank + 1] }
  } else {
    $point.NextStep = $point.Step
  }
  return $point
}

<#
  Keep the build that is running now, so a build that fails can be undone.

  A copy rather than a rename, on purpose: between here and a working new
  build the install must never be left with no built output at all. `.output`
  is a built bundle, not the database -- the backup step is what protects the
  paper's data, and this only protects the paper's ability to come back up.

  Returns the rollback path, or $null when there was no build to keep.
#>
function Save-PromotePreviousBuild {
  param([Parameter(Mandatory = $true)][string]$App)
  $out = Join-Path $App ".output"
  $previous = Join-Path $App ".output-previous"
  if (-not (Test-Path (Join-Path $out "server\index.mjs"))) { return $null }
  if (Test-Path $previous) { Remove-Item $previous -Recurse -Force -ErrorAction SilentlyContinue }
  Copy-Item -Path $out -Destination $previous -Recurse -Force
  return $previous
}

<#
  Put the kept build back where the start script expects it.

  Only claims success when the restored tree really is a built server, so the
  caller never says "the paper is back on the old version" about a directory
  that cannot serve anything.
#>
function Restore-PromotePreviousBuild {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$Previous = ""
  )
  if (-not $Previous) { return $false }
  if (-not (Test-Path (Join-Path $Previous "server\index.mjs"))) { return $false }
  $out = Join-Path $App ".output"
  if (Test-Path $out) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue }
  Move-Item -Path $Previous -Destination $out -Force -ErrorAction SilentlyContinue
  return (Test-Path (Join-Path $out "server\index.mjs"))
}

<#
  Which build to fall back to.

  Normally the one this run put aside. A run that RESUMED past the build step
  never put one aside, but the run it resumed did -- so .output-previous on
  disk is the second answer, and it is the right one.
#>
function Resolve-PromotePreviousBuild {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$Previous = ""
  )
  if ($Previous -and (Test-Path (Join-Path $Previous "server\index.mjs"))) { return $Previous }
  $candidate = Join-Path $App ".output-previous"
  if (Test-Path (Join-Path $candidate "server\index.mjs")) { return $candidate }
  return $null
}

<#
  Put the previous build back and start it. $StartTheApp is the caller's "start
  the app and tell me whether it answers" -- a scriptblock so this can be
  driven by a fake in a test while the ordering that matters stays here.

  Returns $true only when the paper is answering afterwards. Everything is
  written to the log as it happens, because "the promote fell back" is exactly
  the kind of thing that needs to still be readable the next morning.
#>
function Invoke-PromoteFallback {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][scriptblock]$StartTheApp,
    [string]$Previous = ""
  )
  $resolved = Resolve-PromotePreviousBuild -App $App -Previous $Previous
  if (-not (Restore-PromotePreviousBuild -App $App -Previous $resolved)) {
    Write-PromoteLog $Log "there is no previous build to put back, so the paper stays down"
    return $false
  }
  Write-PromoteLog $Log "the build from before has been put back at .output"
  Write-PromoteLog $Log "starting the OLD version, so the paper is not left down"
  return [bool](& $StartTheApp)
}

<#
  The whole of step 7: keep the running build, run the build, and when it does
  not work put the running build back and start it.

  The decision lives here rather than in ops\promote.ps1 so that
  scripts\promote-step-runner.test.mjs can drive this exact code -- the
  ordering, the restore, the start -- with a fake build that fails and a fake
  start, and check that the paper really does end up serving the old build
  with the promote reporting failure. A copy of the logic in a test would
  prove nothing about the script that runs at 2 AM.

  Returns @{ Ok; ExitCode; Seconds; OutFile; Previous; Fallback; PaperUp;
  Failure }, where Failure is a plain-words sentence for the operator.
#>
function Invoke-PromoteBuild {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][scriptblock]$StartTheApp,
    [string]$Previous = ""
  )
  # `npm run build` is `vite build && ... && npm run db:migrate` (package.json),
  # so this step migrates the database too. It is named in the log for that
  # reason: it is why this step runs with the server down.
  Add-PromoteStep -Log $Log -Name 'build' -Detail "$Command (this also runs the schema migration)"

  $previous = Save-PromotePreviousBuild -App $App
  if ($previous) {
    Write-PromoteLog $Log "kept the running build at .output-previous, in case this one does not work"
  } else {
    Write-PromoteLog $Log "there is no built output here to fall back to; a build that does not work would leave the paper down"
  }

  $child = Invoke-PromoteChild -Log $Log -Step 'build' -Command $Command
  if ($child.ExitCode -eq 0) {
    Complete-PromoteStep -Log $Log -Name 'build' -Seconds $child.Seconds -Detail "$Command exit 0"
    return [pscustomobject]@{
      Ok       = $true
      ExitCode = 0
      Seconds  = $child.Seconds
      OutFile  = $child.OutFile
      Previous = $previous
      Fallback = $false
      PaperUp  = $false
      Failure  = ""
    }
  }

  $code = if ($null -eq $child.ExitCode) { "it did not reach its end, so there is no exit code" } else { "exit $($child.ExitCode)" }
  $paperUp = Invoke-PromoteFallback -Log $Log -App $App -StartTheApp $StartTheApp -Previous $previous
  $failure = "$Command did not succeed ($code) and there was no previous build to put back. The paper is still down."
  if ($paperUp) {
    Write-PromoteLog $Log "the paper is back on the OLD version. The promote did NOT complete."
    $failure = "$Command did not succeed ($code). The paper is back on the OLD version; the promote did not complete."
  }

  return [pscustomobject]@{
    Ok       = $false
    ExitCode = $child.ExitCode
    Seconds  = $child.Seconds
    OutFile  = $child.OutFile
    Previous = $previous
    Fallback = $paperUp
    PaperUp  = $paperUp
    Failure  = $failure
  }
}
