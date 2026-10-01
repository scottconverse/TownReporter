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

  ...AND A KILLED CHILD MUST NOT LOOK LIKE A SUCCESSFUL ONE. The same trap has
  a second door: a child killed before it writes that line leaves nothing to
  read, and a runner that defaulted its exit code to 0 would call that step
  done. Here a missing line means $null, which means "it did not reach its
  end", which every caller already treats as a failure -- and
  scripts\promote-step-runner.test.mjs kills a child on purpose to hold that.

  A HUNG STEP IS ALSO A WAY TO KEEP THE PAPER DOWN. The marker watchdog.ps1
  stands down for is capped at 30 minutes; an npm step that never returns
  would outlive the cap, the watchdog would start the app on a half-written
  tree, and nobody would have been told. So every child has a time limit
  (Get-PromoteChildTimeoutSeconds -- 20 minutes for npm ci and for the build,
  which is the step that runs the migrations). Past it the child's PROCESS
  TREE is killed by PID -- never by image name, on a machine where the paper
  and the development copy are both node.exe -- and the step fails the
  ordinary way.

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
  How long a step is allowed to take, in seconds. 0 means no limit.

  `deps` and `build` are the two that can hang for a reason that has nothing to
  do with this script -- a registry that has stopped answering, a bundler
  waiting on something that will never arrive -- and they are the two that
  leave the paper down while they do it. Twenty minutes is roughly ten times
  the longest either has taken on this machine, so it is a backstop, not a
  budget: a step that reaches it has stopped, not slowed down.

  The number also has to stay under the watchdog's 30-minute stand-down (see
  the header of ops\promote.ps1), because past that the watchdog stops waiting
  politely and starts the app on whatever is on disk -- which, half way through
  a build, is not a build.

  Read through a function rather than written at each call site so a test can
  ask what the limit is, and so the two places that use it cannot drift.
#>
function Get-PromoteChildTimeoutSeconds {
  param([Parameter(Mandatory = $true)][string]$Step)
  switch ($Step) {
    'deps' { return 1200 }
    'build' { return 1200 }
    default { return 0 }
  }
}

<#
  How long the started app is given to answer on its port.

  The ceiling asked for is five minutes; this install already waits one, which
  is shorter, so it keeps it. Named here because the wait appears in three
  places in ops\promote.ps1 and a paper that is merely slow to boot must not
  turn into a rollback in one of them and not the others.
#>
function Get-PromoteHealthTimeoutSeconds {
  return 60
}

<#
  Kill a process and everything under it, by PID.

  /T for the tree: the child this script starts is cmd.exe running the wrapper,
  which runs npm.cmd, which runs node -- and it is node, three levels down,
  that is actually stuck. Killing only the process we started would leave the
  install running with nobody waiting for it.

  /PID, never /IM. On this machine the live paper, the development copy and
  every test are node.exe; "kill all node" is the one command that would turn
  a stuck build into an outage.

  Through cmd.exe with the output sent to nul, so nothing it writes can reach a
  PowerShell stream: `2>&1` on a native command TERMINATES a script whose
  preference is Stop in Windows PowerShell 5.1 -- the 2026-09-25 logon task
  died on exactly that (see ops\start-townreporter.ps1).
#>
function Stop-PromoteProcessTree {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  if (-not (Test-Path $taskkill)) { $taskkill = 'taskkill.exe' }
  & cmd.exe /d /c "`"$taskkill`" /PID $ProcessId /T /F >nul 2>nul"
}

<#
  Run one long step as a detached child and wait for it. Returns
  @{ ExitCode; Seconds; OutFile; ErrFile; Completed; Pid; TimedOut }.

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
    [string]$WorkingDirectory = "",
    # -1 means "ask Get-PromoteChildTimeoutSeconds for this step". 0 means no
    # limit. Anything else is taken as given -- which is how a test gets a
    # two-second limit instead of twenty minutes.
    [int]$TimeoutSeconds = -1
  )
  if (-not $WorkingDirectory) { $WorkingDirectory = $Log.App }
  if ($TimeoutSeconds -lt 0) { $TimeoutSeconds = Get-PromoteChildTimeoutSeconds -Step $Step }

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
      TimedOut  = $false
      Pid       = $null
      OutFile   = $outFile
      ErrFile   = $errFile
    }
  }
  Write-PromoteLog $Log "step=$Step child pid $($proc.Id)"

  $wait = Wait-PromoteChildProcess -Process $proc -TimeoutSeconds $TimeoutSeconds
  $hitLimit = ($wait -eq 'timeout')

  if ($hitLimit) {
    # The tree, by PID: node is three levels down, and killing only the
    # process we started would leave a build running with nobody waiting.
    Stop-PromoteProcessTree -ProcessId $proc.Id
    Write-PromoteLog $Log "step=$Step TIMED OUT after $($TimeoutSeconds)s -- killed PID $($proc.Id) and its children. If this step is genuinely that slow, raise its limit in Get-PromoteChildTimeoutSeconds (ops\lib-promote.ps1)."
  }

  $seconds = ((Get-Date) - $started).TotalSeconds

  # The last PROMOTE_EXIT= line wins: the child's own output comes before it.
  # -Tail keeps a chatty npm install from being read into memory in full.
  #
  # Read even after a timeout, and believed: the line is written by the child
  # immediately before it exits, so a child that reached the deadline with its
  # work already done still gets the credit, and the kill above was a no-op.
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
    # True only when the limit is why the step failed. A child that finished
    # just as the deadline arrived is not a timed-out step.
    TimedOut  = ($hitLimit -and ($null -eq $code))
    Pid       = $proc.Id
    OutFile   = $outFile
    ErrFile   = $errFile
  }
}

<#
  Wait for a started child, with a limit. Returns 'exited' or 'timeout'.

  WaitForExit is the fast path, but a single return value is not something to
  bet the paper on: if it cannot be trusted, this asks the process itself
  rather than concluding from a log file that is not written yet. Getting that
  wrong in the other direction is just as bad -- a step wrongly called failed
  puts the previous build back over one that worked -- so both answers have to
  agree that the process is gone.
#>
function Wait-PromoteChildProcess {
  param(
    [Parameter(Mandatory = $true)]$Process,
    [int]$TimeoutSeconds = 0
  )
  $deadline = $null
  if ($TimeoutSeconds -gt 0) { $deadline = (Get-Date).AddSeconds($TimeoutSeconds) }
  while ($true) {
    $slice = 1000
    if ($deadline) {
      $left = ($deadline - (Get-Date)).TotalMilliseconds
      if ($left -le 0) { return 'timeout' }
      if ($left -lt 1000) { $slice = [int]$left }
    }
    $exited = $false
    try { $exited = [bool]$Process.WaitForExit($slice) } catch { }
    if ($exited) { return 'exited' }
    if (-not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) { return 'exited' }
    # Only reached when WaitForExit did not block for us. Keeps a host where it
    # returns immediately from turning this into a hot loop.
    if ($slice -ge 1000) { Start-Sleep -Milliseconds 100 }
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
  The migration the database is at, when it can be named.

  Two sources, in the order this unit's brief asks for them:

    1. the migrate step's own output, which lives inside the build's log -- its
       "[migrate] applied <name>" lines are the database saying what it did;
    2. the newest .sql in this checkout's migrations\ directory, which is what
       a migration that ran to completion leaves the database at.

  Returns $null rather than a guess when neither is there. A promotion that
  names the wrong migration is worse than one that admits it does not know: the
  sentence this feeds is read by somebody deciding whether an old build can
  keep serving against a newer database.
#>
function Get-PromoteAppliedMigrationName {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$BuildOutput = ""
  )
  if ($BuildOutput -and (Test-Path $BuildOutput)) {
    $last = $null
    foreach ($line in @(Get-Content -Path $BuildOutput -Tail 200 -ErrorAction SilentlyContinue)) {
      $m = [regex]::Match("$line", '^\[migrate\] applied (.+?)\s*$')
      if ($m.Success) { $last = $m.Groups[1].Value.Trim() }
    }
    if ($last) { return $last }
  }
  $files = @(Get-ChildItem -Path (Join-Path $App "migrations") -Filter '*.sql' -File -ErrorAction SilentlyContinue |
    Sort-Object -Property Name)
  if ($files.Count -gt 0) { return $files[$files.Count - 1].Name }
  return $null
}

<#
  Did the build get as far as the migration?

  `npm run build` is `vite build && patch-ssr-exports && copy-runtime-assets &&
  npm run db:migrate`, so a build that died at the bundler never touched the
  database, and a build that died at the migration did. Its own output is the
  only place that distinction survives; anything else is a guess dressed up as
  a fact.
#>
function Test-PromoteMigrateRan {
  param([string]$BuildOutput = "")
  if (-not $BuildOutput -or -not (Test-Path $BuildOutput)) { return $false }
  foreach ($line in @(Get-Content -Path $BuildOutput -Tail 200 -ErrorAction SilentlyContinue)) {
    if ("$line" -match '^\[migrate\]') { return $true }
  }
  return $false
}

<#
  What to say about the database when the previous build goes back.

  Putting the old build back after `npm run build` has already run db:migrate
  leaves the database NEWER than the build that is now serving it. That is a
  state the operator has to be told about rather than left to discover: a build
  whose queries still name a table or column a migration dropped does not fail
  loudly, it answers wrongly.

    MigrationsRan = 'none'  -- the build never reached the migration. Nothing
                               to say; returns "" and the caller uses the plain
                               sentence.
    MigrationsRan = 'maybe' -- it did reach it and did not finish, so what the
                               database is at is not knowable from here. Says
                               so, rather than naming a migration.
    MigrationsRan = 'yes'   -- it finished. Names the migration it finished at,
                               or falls back to saying it may have run.

  Capitalised, because this is also the first sentence of the message the
  operator reads when the promotion stops.
#>
function Get-PromoteFallbackSentence {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [ValidateSet('none', 'maybe', 'yes')][string]$MigrationsRan = 'none',
    [string]$BuildOutput = ""
  )
  if ($MigrationsRan -eq 'none') { return "" }
  $tail = "if this build reads a table or column a migration removed, tell the developer before continuing"
  $name = $null
  if ($MigrationsRan -eq 'yes') { $name = Get-PromoteAppliedMigrationName -App $App -BuildOutput $BuildOutput }
  if ($name) {
    return "The paper is back on the OLD version, but the database was already migrated to $name; $tail. The promote did NOT complete."
  }
  return "The paper is back on the OLD version, but migrations may have run; $tail. The promote did NOT complete."
}

<#
  Put the previous build back and start it. $StartTheApp is the caller's "start
  the app and tell me whether it answers" -- a scriptblock so this can be
  driven by a fake in a test while the ordering that matters stays here.

  Returns $true only when the paper is answering afterwards. Everything is
  written to the log as it happens, because "the promote fell back" is exactly
  the kind of thing that needs to still be readable the next morning -- and
  because how far the database got is part of what happened.

  -MigrationsRan defaults to 'none': a caller that has not said anything about
  the database gets the plain sentence, never an invented one.
#>
function Invoke-PromoteFallback {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][scriptblock]$StartTheApp,
    [string]$Previous = "",
    [ValidateSet('none', 'maybe', 'yes')][string]$MigrationsRan = 'none',
    [string]$BuildOutput = ""
  )
  $resolved = Resolve-PromotePreviousBuild -App $App -Previous $Previous
  if (-not (Restore-PromotePreviousBuild -App $App -Previous $resolved)) {
    Write-PromoteLog $Log "there is no previous build to put back, so the paper stays down"
    return $false
  }
  Write-PromoteLog $Log "the build from before has been put back at .output"
  Write-PromoteLog $Log "starting the OLD version, so the paper is not left down"
  $started = [bool](& $StartTheApp)
  if ($started) {
    $sentence = Get-PromoteFallbackSentence -App $App -MigrationsRan $MigrationsRan -BuildOutput $BuildOutput
    if (-not $sentence) { $sentence = "the paper is back on the OLD version. The promote did NOT complete." }
    Write-PromoteLog $Log $sentence
  }
  return $started
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
    [string]$Previous = "",
    [int]$TimeoutSeconds = -1
  )
  # `npm run build` is `vite build && ... && npm run db:migrate` (package.json),
  # so this step migrates the database too. It is named in the log for that
  # reason: it is why this step runs with the server down, and it is why the
  # sentence below can turn up when this step goes wrong.
  Add-PromoteStep -Log $Log -Name 'build' -Detail "$Command (this also runs the schema migration)"

  $previous = Save-PromotePreviousBuild -App $App
  if ($previous) {
    Write-PromoteLog $Log "kept the running build at .output-previous, in case this one does not work"
  } else {
    Write-PromoteLog $Log "there is no built output here to fall back to; a build that does not work would leave the paper down"
  }

  $child = Invoke-PromoteChild -Log $Log -Step 'build' -Command $Command -TimeoutSeconds $TimeoutSeconds
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

  $code = if ($child.TimedOut) {
    "it ran past its $(Get-PromoteChildTimeoutSeconds -Step 'build')-second limit and was stopped"
  } elseif ($null -eq $child.ExitCode) {
    "it did not reach its end, so there is no exit code"
  } else {
    "exit $($child.ExitCode)"
  }
  # Did this build get as far as the migration before it died? Only the build's
  # own output can answer that -- see Test-PromoteMigrateRan.
  $migrations = if (Test-PromoteMigrateRan -BuildOutput $child.OutFile) { 'maybe' } else { 'none' }
  $paperUp = Invoke-PromoteFallback -Log $Log -App $App -StartTheApp $StartTheApp -Previous $previous -MigrationsRan $migrations -BuildOutput $child.OutFile

  $outcome = "The paper is still down."
  if ($paperUp) {
    $outcome = Get-PromoteFallbackSentence -App $App -MigrationsRan $migrations -BuildOutput $child.OutFile
    if (-not $outcome) { $outcome = "The paper is back on the OLD version; the promote did not complete." }
  }
  $failure = "$Command did not succeed ($code). $outcome"
  # The step's own FAILED line, written here rather than by the caller's
  # failure path, so this step is recorded exactly once whichever path it took.
  Fail-PromoteStep -Log $Log -Name 'build' -Detail $failure

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
