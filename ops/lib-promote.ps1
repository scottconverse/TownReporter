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
  Append one line to the run's log, and do not lose it to a reader.

  `Add-Content` opens the file EXCLUSIVELY, so on Windows a write that lands
  while anyone else has the log open -- an operator tailing it, a text editor,
  anything -- fails with a sharing violation. Write-PromoteLog swallows that
  (it must: losing the log is bad, losing the paper is worse), so the line is
  gone for good and the record quietly stops matching what happened. Measured
  on 2026-10-01: a run that only polled the file with a reader dropped the
  `step=build child pid N` line about one time in eleven, and the log simply
  ended a line early.

  So the file is opened here by hand, Append + FileShare.ReadWrite: a reader
  can hold it open for as long as it likes and the append still lands. That is
  the opposite of what Add-Content does, and it is the difference between a
  log an operator can watch and one that erases itself while they watch it.

  Best effort, like everything else on this path: a genuine failure to write is
  still swallowed, because the promotion has a paper to bring back up and the
  log is not worth stopping for.
#>
function Add-PromoteLogLine {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Line
  )
  try {
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($Line + [Environment]::NewLine)
    $stream = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Append,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::ReadWrite)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  } catch { }
}

<#
  One line per step, timestamped, written to the file AND shown on the
  console. The two are deliberately separate: the file is the record that
  outlives the console, and the console is what the operator watches.

  Neither write may stop a promotion. A closed console pipe is exactly what
  this unit exists for, so a failed console write is swallowed; a failed log
  write is swallowed too, because losing the log is bad and losing the paper
  is worse. What must NOT happen is a line going missing because somebody had
  the log open -- see Add-PromoteLogLine.
#>
function Write-PromoteLog {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Line
  )
  $stamped = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Line
  Add-PromoteLogLine -Path $Log.Path -Line $stamped
  try { Write-Host "  $Line" } catch { }
  # Nothing is emitted to the pipeline, deliberately. In PowerShell a function
  # returns everything it did not capture, so a logging helper that returned
  # its line would make every caller of every function below return an array of
  # log lines instead of an answer -- and `$child.ExitCode` on an array of
  # strings is empty, which is the same "a failed step looks like a success"
  # trap this library exists to close.
}

<#
  One line into the log FILE, and deliberately not onto the console.

  Only one caller needs this, and it is worth its own function rather than a
  second Add-Content: Die's last act is to print the exact command that brings
  the paper back, and scripts\promote-step-runner.test.mjs holds that as the
  last thing an operator sees. The line written through here is the one that
  has to come after it -- which database holds what -- because an operator
  reading the tail of a failed run's log is asking exactly that question. It
  goes in the record, not over the top of the command they are about to run.

  Like Write-PromoteLog, a failed write is swallowed: losing the line is bad,
  losing the promotion is worse. And like it, it emits nothing to the pipeline.
#>
function Write-PromoteLogFileOnly {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$Line
  )
  $stamped = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Line
  Add-PromoteLogLine -Path $Log.Path -Line $stamped
}

<#
  The steps, in the order they must happen. Ranks drive -Resume: a run that
  resumes at a step skips every step ranked before it.

  `preflight` is everything that can fail without consequence (the checkout is
  clean, origin/main is a straight-line fast-forward away, no editor job is
  running, and -- since the database copy landed -- the database name, the room
  on the disk for a copy of it, and whether the role we connect as may create
  one) and it stays before `stop` for exactly that reason.

  `dbcopy` sits between `stop` and `ff` because a copy of a database can only be
  taken with nobody connected to it: `CREATE DATABASE ... TEMPLATE` refuses
  otherwise, and the app IS the connection. It is before `ff` and therefore
  before `build`, which is the step that runs the migration -- the copy has to
  exist before anything can move the database forward.

  `deps` may or may not install anything; `build` always migrates.
#>
function Get-PromoteStepOrder {
  return @('backup', 'preflight', 'stop', 'dbcopy', 'ff', 'deps', 'build', 'start', 'verify')
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

  The database steps have their own numbers, and they are much smaller because
  the work is a different size. Measured on a throwaway Postgres 18.6 with
  nobody connected: copying a 545 MB database took 4.4 s, and the two
  `ALTER DATABASE ... RENAME`s of a swap-back took 0.47 s together. Ten minutes
  is therefore roughly a hundred times the measured cost -- a backstop, not a
  budget, and the same reasoning as the npm steps: a database step that reaches
  it has stopped, not slowed down. `preflight` only reads, so two minutes is
  already generous for a connection that is refusing to answer.

  Note what a COPY costs the machine, because it is not like the npm steps:
  `CREATE DATABASE ... TEMPLATE` forces a checkpoint on the whole cluster. On a
  shared server every other database waits for it.
#>
function Get-PromoteChildTimeoutSeconds {
  param([Parameter(Mandatory = $true)][string]$Step)
  switch ($Step) {
    'deps' { return 1200 }
    'build' { return 1200 }
    'preflight' { return 120 }
    'dbcopy' { return 600 }
    'dbswap' { return 600 }
    'dbstate' { return 120 }
    default { return 0 }
  }
}

<#
  How long the copy and the swap wait for the app's connections to drain.

  The app was stopped a couple of seconds earlier, so its sessions normally go
  in about a second and this is invisible. It is bounded because the wait is
  inside the stop-the-app window: past it the promotion refuses in plain words
  rather than holding the paper down. It NEVER ends anybody's session -- see
  the header of ops\lib-promote-db.mjs for why that is not this script's call
  to make on a machine whose Postgres also serves the development copy and
  thirty test databases.
#>
function Get-PromoteDbWaitSeconds {
  return 30
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
  Start the app, then wait for it to answer. Returns ONE boolean.

  THE HANG THIS REPLACES (production auditor's lab, gate 3, 2026-10-01). The
  start step used to be a function that ran
      & powershell -File start-townreporter.ps1
  inline. A function's output is its return value, so PowerShell read the native
  command's stdout through a pipe and waited for end-of-file -- and the node
  server that start script launches holds a copy of that pipe's write end, so the
  wait lasted as long as the paper stayed up. The promote sat on
  "step=start started" with the paper serving and the 30-minute marker in place.
  A stand-in with a 25-second sleeper took 25 seconds and returned an ARRAY of
  three things, so `-not (Start-TheApp)` did not mean what it looked like either.

  So: the start script's output goes to FILES (there is no pipe for a child to
  keep open), the wait is on that ONE process by PID (never on its descendants),
  nothing it prints can reach the return value, and the answer is a boolean from
  the port probe. A start script that has not finished by $StartSeconds is left
  alone and the health wait decides: the paper either answers or it does not.
#>
function Start-PromoteApp {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$StartScript,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$HealthSeconds = 60,
    [int]$StartSeconds = 300,
    [scriptblock]$TestThePort = $null
  )
  if (-not $TestThePort) { $TestThePort = { param($p) Test-PromotePaperUp -Port $p } }
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $outFile = Join-Path $OutDir "promote-$stamp-start.out.log"
  $errFile = Join-Path $OutDir "promote-$stamp-start.err.log"
  Write-PromoteLog $Log "step=start child: powershell -File $StartScript (output: $outFile)"
  $proc = $null
  try {
    $proc = Start-Process -FilePath 'powershell' `
      -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $StartScript + '"')) `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  } catch {
    Write-PromoteLog $Log "step=start could not launch the start script: $($_.Exception.Message)"
    return $false
  }
  Write-PromoteLog $Log "step=start child pid $($proc.Id)"
  # That ONE process, by PID. Wait-Process does not wait for its descendants,
  # which is the point: the app it launches is meant to outlive it.
  try { $null = Wait-Process -Id $proc.Id -Timeout $StartSeconds -ErrorAction SilentlyContinue } catch { }
  $finished = $false
  try { $finished = [bool]$proc.HasExited } catch { $finished = $true }
  if (-not $finished) {
    Write-PromoteLog $Log "step=start the start script had not finished after $StartSeconds s; the health wait decides"
  }
  for ($i = 0; $i -lt $HealthSeconds; $i++) {
    if ([bool](& $TestThePort $Port)) { break }
    Start-Sleep -Seconds 1
  }
  return [bool](& $TestThePort $Port)
}

# --- what node_modules was installed from (the lockfile marker) -------------
#
# THE TRAP THIS CLOSES. Whether to run `npm ci` used to be decided from the
# hash of package-lock.json before and after this script's own fast-forward:
#
#     $mustInstall = ($lockBefore -ne $lockAfter) -or ($resumeAt -eq 'deps')
#
# That answers "did THIS run move the lockfile". It is the wrong question, and
# on the first rollout it is wrong in the worst possible way: the live checkout
# is fast-forwarded BY HAND before the promotion (it has to be -- it is still
# running the OLD promote script, which does not know about the copy), so
# `before` is already the new lockfile, `after` is the same new lockfile, the
# two are equal, and the promotion skips `npm ci` and then builds a release on
# node_modules from the previous one. Nothing fails. The build succeeds. The
# page serves whatever the old dependency tree happens to do.
#
# So the question asked now is the one that matters: WHAT WAS node_modules
# ACTUALLY INSTALLED FROM? `npm ci` writes its answer to
# node_modules\.promote-lock-hash when it succeeds, and the install runs unless
# that file is there and holds exactly the hash of the lockfile on disk.
#
# A marker that is missing, unreadable or unparseable means INSTALL. That is
# the direction to fail in: an unnecessary `npm ci` costs a few minutes with
# the paper stopped, and a skipped one costs a release built on the wrong
# dependency tree, quietly.

<#
  Where the marker lives. Inside node_modules on purpose: `npm ci` deletes
  node_modules and recreates it, so a marker that survived an install that
  failed half way cannot survive one that succeeded.
#>
function Get-PromoteLockMarkerPath {
  param([Parameter(Mandatory = $true)][string]$App)
  return (Join-Path (Join-Path $App "node_modules") ".promote-lock-hash")
}

<#
  The hash of the lockfile node_modules was last installed from, or "" when
  that is not knowable. "" always means install.
#>
function Get-PromoteInstalledLockHash {
  param([Parameter(Mandatory = $true)][string]$App)
  $path = Get-PromoteLockMarkerPath -App $App
  if (-not (Test-Path $path)) { return "" }
  try {
    $value = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop)
    if ($null -eq $value) { return "" }
    $value = "$value".Trim()
    # A marker holding something that is not a hash is not a marker: treat it
    # exactly like a missing one rather than trusting a half-written file.
    if ($value -notmatch '^[0-9A-Fa-f]{64}$') { return "" }
    return $value.ToUpperInvariant()
  } catch {
    return ""
  }
}

<#
  Write the marker, AFTER a successful install and never before.

  Returns $true when it was written. A write that fails is not an error: the
  next promotion installs again, which is slower and never wrong. Nothing is
  ever reported as installed on the strength of this failing.
#>
function Set-PromoteInstalledLockHash {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$Hash = ""
  )
  if (-not $Hash) { return $false }
  $path = Get-PromoteLockMarkerPath -App $App
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    Set-Content -LiteralPath $path -Value $Hash -Encoding ASCII -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

<#
  Should this run install dependencies? Returns @{ Needed; Reason }.

  `Reason` is written into the promotion's log, because "the install was
  skipped" is a sentence an operator reading a bad release needs to be able to
  find and believe -- and it has to say WHICH of the two questions was asked,
  not just that the answer was no.

  The before/after pair is deliberately NOT the decider any more. It is still
  computed by the caller (scripts\ci-hash-no-module.ps1 lifts those two lines
  out and runs them in a PowerShell session that cannot reach Get-FileHash), and
  it is still worth having in the log, but a run that fast-forwarded the
  checkout by hand makes the two equal and that says nothing at all about what
  node_modules holds.
#>
function Test-PromoteNeedsInstall {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [string]$LockHash = "",
    [string]$ResumeAt = ""
  )
  if ($ResumeAt -eq 'deps') {
    return [pscustomobject]@{
      Needed = $true
      Reason = "the previous run stopped at this step, so the install it started never finished"
    }
  }
  if (-not $LockHash) {
    return [pscustomobject]@{
      Needed = $false
      Reason = "there is no package-lock.json here, so there is nothing to install from"
    }
  }
  $installed = Get-PromoteInstalledLockHash -App $App
  if (-not $installed) {
    return [pscustomobject]@{
      Needed = $true
      Reason = "there is no record here of what node_modules was installed from (node_modules\.promote-lock-hash is missing), so it is installed again rather than guessed at"
    }
  }
  if ($installed -ne $LockHash.ToUpperInvariant()) {
    return [pscustomobject]@{
      Needed = $true
      Reason = "node_modules was installed from a different lockfile ($installed, now $($LockHash.ToUpperInvariant()))"
    }
  }
  return [pscustomobject]@{
    Needed = $false
    Reason = "node_modules was installed from exactly this lockfile"
  }
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

  Reads the newest logs\promote-*.log -- the newest one that is a PROMOTION,
  and not the log of the run asking the question. The marker says a run is
  unfinished; the log says how far it got. The last step line decides:

    ok       -> resume at the step after it
    started  -> it was interrupted mid-flight; run that step again
    failed   -> run that step again

  $ExcludeLog is the caller's OWN log, and it is not optional in practice.
  promote.ps1 opens its log as its first act -- so a run that dies on its first
  check still leaves a file behind -- and only looks for an unfinished run
  much later. By then its own log is the newest file in the directory, so
  "read the newest log" answers with a file that has just been created and has
  nothing in it: no step, no backup, no next step. The run then either refuses
  to resume or starts from the beginning on top of the interrupted one, which
  is the failure this parameter exists to prevent.

  A log is only a candidate when it carries a `promote started` line. That is
  what makes a `promote-*.log` a promotion at all: a hand-rollback
  (Invoke-PromoteRollback) writes its own lines into a promote-*.log and
  deliberately keeps them outside the step grammar, and a run killed before its
  first line leaves an empty file. Neither can say where an interrupted run
  stopped, so neither is allowed to hide the log that can.

  Returns $null when there is no marker, so the caller can tell "nothing to
  resume" from "a run is unfinished".
#>
function Get-PromoteResumePoint {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    # The log this run has already opened, to leave out of the search.
    [string]$ExcludeLog = ""
  )

  $logs = Join-Path $App "logs"
  if (-not (Test-Path (Join-Path $logs "promote-in-progress"))) { return $null }

  $point = [pscustomobject]@{
    LogPath   = $null
    Step      = $null
    Status    = "unknown"
    StartedAt = $null
    Backup    = $null
    NextStep  = $null
    # The database copy, since unit PR2. All three are read back out of the
    # log's own "promote-db:" line, which is written as soon as the names are
    # known -- before the app is stopped -- so a run that died anywhere after
    # that can be picked up without deriving (or worse, guessing) them again.
    Database  = $null
    Copy      = $null
    Failed    = $null
    # When the previous run stopped the paper, and when it took the copy. A
    # resumed run refuses to put a copy back that was taken BEFORE its own
    # stop: that copy would predate whatever the app was doing when it went
    # down. Both are the timestamps of the log's own step lines -- NOT the
    # stamp inside the copy's name, which is the second the RUN started and is
    # therefore always earlier than the stop. See Test-PromoteCopyFreshness.
    StopAt    = $null
    CopyAt    = $null
  }

  $stepRe = '^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] step=(?<name>[a-z]+) (?<status>started|ok|failed)\b(?<rest>.*)$'
  $startRe = '^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] promote started\b'

  # Newest first, this run's own log left out, and the first one that is really
  # a promotion taken. Compared by full path, case-insensitively, because
  # Windows paths differ in case more often than they differ in meaning.
  $exclude = ""
  if ($ExcludeLog) { $exclude = [System.IO.Path]::GetFullPath($ExcludeLog) }
  $file = $null
  foreach ($candidate in @(Get-ChildItem -Path $logs -Filter 'promote-*.log' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)) {
    if ($exclude -and [System.IO.Path]::GetFullPath($candidate.FullName) -ieq $exclude) { continue }
    foreach ($line in @(Get-Content -Path $candidate.FullName -ErrorAction SilentlyContinue)) {
      if ([regex]::Match($line, $startRe).Success) { $file = $candidate; break }
    }
    if ($file) { break }
  }
  if (-not $file) { return $point }
  $point.LogPath = $file.FullName

  # The line the promotion writes once the database names are settled:
  #   promote-db: database=<db> copy=<copy> failed=<failed>
  # The LAST one wins, so a resumed run's log carries the names of the run that
  # actually took the copy rather than of the run that resumed it.
  $dbRe = '^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] promote-db: database=(?<db>\S+) copy=(?<copy>\S+) failed=(?<failed>\S+)\s*$'
  # Fail-PromoteStep writes "FAILED" in capitals so a failure stands out in the
  # log; matching it case-insensitively keeps the two spellings one status.
  $opts = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  $last = $null
  foreach ($line in @(Get-Content -Path $file.FullName -ErrorAction SilentlyContinue)) {
    $sm = [regex]::Match($line, $startRe)
    if ($sm.Success -and -not $point.StartedAt) { $point.StartedAt = $sm.Groups['ts'].Value }
    $dm = [regex]::Match($line, $dbRe)
    if ($dm.Success) {
      $point.Database = $dm.Groups['db'].Value
      $point.Copy = $dm.Groups['copy'].Value
      $point.Failed = $dm.Groups['failed'].Value
    }
    $m = [regex]::Match($line, $stepRe, $opts)
    if (-not $m.Success) { continue }
    $last = $m
    if ($m.Groups['name'].Value -eq 'backup' -and $m.Groups['status'].Value -match '^(?i)ok$') {
      # "ok (93.2s): C:\...\townreporter_....sql (12.4 MB)" -- drop the duration
      # and the colon, keep everything after them. A run that resumes reuses
      # this path, so it has to come out exactly as the backup step wrote it.
      $point.Backup = ($m.Groups['rest'].Value -replace '^\s*(\([^)]*\))?\s*:?\s*', '')
    }
    if ($m.Groups['name'].Value -eq 'stop' -and $m.Groups['status'].Value -match '^(?i)ok$') {
      $point.StopAt = $m.Groups['ts'].Value
    }
    # Whatever status it has: a dbcopy line that only says "started" still
    # records a time, and that time is after the stop -- which is all the
    # freshness question needs. A line that is not there at all leaves this
    # null, and null is a refusal rather than a pass.
    if ($m.Groups['name'].Value -eq 'dbcopy') {
      $point.CopyAt = $m.Groups['ts'].Value
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

  -Recover, when it is given, replaces the plain build fallback with the
  caller's whole failure path -- since unit PR2 that is "stop whatever is
  serving, put the database copy back, then restore the build and start it",
  which has to happen in that order and cannot be assembled from here. It is
  handed the three things this function knows and the caller does not: how far
  the build's own output says the migration got ('none'/'maybe'), the child's
  output file, and the build that was put aside. It returns @{ PaperUp;
  Sentence }. Without it this falls back exactly as it always has, which is
  what the fake-runner tests drive.

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
    [int]$TimeoutSeconds = -1,
    [scriptblock]$Recover = $null
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

  $outcome = "The paper is still down."
  $paperUp = $false
  if ($Recover) {
    $recovered = & $Recover $migrations $child.OutFile $previous
    $paperUp = [bool]$recovered.PaperUp
    if ($paperUp -and $recovered.Sentence) { $outcome = "$($recovered.Sentence)" }
  } else {
    $paperUp = Invoke-PromoteFallback -Log $Log -App $App -StartTheApp $StartTheApp -Previous $previous -MigrationsRan $migrations -BuildOutput $child.OutFile
    if ($paperUp) {
      $outcome = Get-PromoteFallbackSentence -App $App -MigrationsRan $migrations -BuildOutput $child.OutFile
      if (-not $outcome) { $outcome = "The paper is back on the OLD version; the promote did not complete." }
    }
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

# --- the database copy, and the swap that puts it back ----------------------
#
# A failed promote can leave the live database half-migrated: `npm run build`
# runs `db:migrate` before the new app starts, so a build that dies inside the
# migration, or a new app that cannot read the schema the migration left, is a
# state the previous build cannot serve from. Putting the previous build back
# is then only half a rollback.
#
# So the promotion copies the database before it builds, and puts the copy back
# when the rollout fails. ALL of the database work -- the name checks, the
# connection wait, `CREATE DATABASE ... TEMPLATE`, the renames -- lives in
# ops\lib-promote-db.mjs, where it is covered by a test against a real
# Postgres. This section is the other half: it runs that library as a child
# (so it gets the same time limit, the same detached output files and the same
# kill-by-PID as every other long step), reads its one-line JSON answer, and
# writes what happened into the log.

<#
  Where the database library is. Under this install's ops\ rather than beside
  this file, because everything here already works from the app directory it
  was handed ($App) -- Get-PromoteRecoveryCommand above does the same -- and
  because the promotion is always run from the install it is promoting.

  A test replaces this to drive the ordering below with a fake library; the
  function exists for that, so that not one line of the ordering has to be
  copied into a test to be covered.
#>
function Get-PromoteDbLibraryPath {
  param([Parameter(Mandatory = $true)][string]$App)
  return (Join-Path (Join-Path $App 'ops') 'lib-promote-db.mjs')
}

<#
  Everything the database library needs, as environment variables.

  NOT on the command line, deliberately: the admin connection string holds a
  password, and every command a step runs is written into the promotion's log.

  The admin connection is PROMOTE_ADMIN_DATABASE_URL from the install's .env
  when it is set, and the app's own DATABASE_URL otherwise. The first is for an
  install whose app role is deliberately not allowed to create databases --
  see the role check in the library's preflight.
#>
function New-PromoteDbEnvironment {
  param(
    [string]$AdminUrl = "",
    [string]$DatabaseUrl = "",
    [string]$Database = "",
    [string]$Copy = "",
    [string]$Failed = "",
    [string]$Stamp = ""
  )
  $admin = $AdminUrl
  if (-not $admin) { $admin = $DatabaseUrl }
  <#
    THE LIVE-PROMOTE FLAG, and this is the only place in the tree that sets it.

    ops\lib-promote-db.mjs refuses to touch a PostgreSQL on port 5433 -- the
    live paper's, on the machine that runs it -- unless this is "1". The live
    database's connection string is in the install's .env, which is exactly
    what a test or a hand-typed command on that machine inherits, so the port
    itself has to be the thing that is guarded, and the flag is the way past it.

    The flag is set by ANY caller of this function that is not running under
    -WhatIf, and it is not a secret or a signature: what it means is "the
    caller has decided this is a real promotion". In the tree that is
    ops\promote.ps1 -- the real promotion and the real `-RollbackDatabase` --
    and the harnesses in scripts\promote-step-runner.test.mjs. What it
    protects against is the thing that actually happens: a test, a hand-typed
    command or a dry run inheriting .env, finding the live paper by accident,
    and having no flag to say it meant to.

    NOT under -WhatIf, EXCEPT for the three READ-ONLY commands: see
    Get-PromoteDbCommandEnvironment below. A dry run renames nothing, so the
    flag set here stays empty under -WhatIf, and the copy, the swap and the
    hand rollback therefore still refuse a 5433 URL in a dry run. The
    read-only commands (names, preflight, state) are let through by that
    function so that a -WhatIf run on the production machine can still do its
    read-only database checks -- the production auditor's call, 2026-10-01.

    $WhatIfPreference is read here rather than passed in because it is the
    script's own, set by [CmdletBinding(SupportsShouldProcess = $true)] on
    ops\promote.ps1, and a function called from it sees it through the scope
    chain. A caller that has no such preference (a test) gets the real flag,
    which changes nothing for a test: no test points at 5433.
  #>
  $live = "1"
  if ($WhatIfPreference) { $live = "" }
  return @{
    PROMOTE_DB_ADMIN_URL       = $admin
    PROMOTE_DB_DATABASE_URL    = $DatabaseUrl
    PROMOTE_DB_DATABASE        = $Database
    PROMOTE_DB_COPY            = $Copy
    PROMOTE_DB_FAILED          = $Failed
    PROMOTE_DB_STAMP           = $Stamp
    PROMOTE_DB_WAIT_SECONDS    = [string](Get-PromoteDbWaitSeconds)
    PROMOTE_DB_TIMEOUT_SECONDS = [string](Get-PromoteChildTimeoutSeconds -Step 'dbcopy')
    PROMOTE_DB_LIVE_PROMOTE    = $live
  }
}

<#
  The environment ONE database command runs with.

  The live-promote flag is the only thing that lets ops\lib-promote-db.mjs
  touch a PostgreSQL on port 5433. Under -WhatIf it is empty, which would make
  a dry run on a 5433 install stop at the preflight. The three commands that
  only READ -- names, preflight, state -- are therefore allowed to carry the
  flag under -WhatIf; copy, wait-for-zero, swap-back and rollback never are, so
  a dry run still cannot copy, rename or swap anything on 5433 (the library
  refuses them, and the test pins it). Outside -WhatIf the environment is
  returned untouched.
#>
function Get-PromoteDbCommandEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][hashtable]$Environment
  )
  $result = @{}
  foreach ($name in @($Environment.Keys)) { $result[$name] = $Environment[$name] }
  $readOnly = @('names', 'preflight', 'state') -contains $Command
  if ($WhatIfPreference -and $readOnly) { $result['PROMOTE_DB_LIVE_PROMOTE'] = '1' }
  return $result
}

<#
  The library's answer: one JSON object on one line of its own stdout.

  Read back out of the file the child's output was redirected to, not out of a
  pipeline -- that is the whole point of the detached runner above, and it is
  also why this reads the LAST line that parses: the wrapper .cmd appends its
  own PROMOTE_EXIT line after the JSON.

  Returns $null when there is no answer at all, which the caller must treat as
  a failure rather than as an empty success.
#>
function Read-PromoteDbReport {
  param([string]$Path)
  if (-not $Path -or -not (Test-Path $Path)) { return $null }
  $parsed = $null
  foreach ($line in @(Get-Content -Path $Path -Tail 40 -ErrorAction SilentlyContinue)) {
    $text = "$line".Trim()
    if (-not $text.StartsWith('{')) { continue }
    try { $parsed = $text | ConvertFrom-Json } catch { }
  }
  return $parsed
}

<#
  Run one database command as a detached child and read its answer.

  The environment is put back exactly as it was afterwards, so the app that
  this promotion starts later does not inherit a promotion's connection
  strings (the started app is handed the install's own .env, and a stale
  admin URL in its environment would be a surprise nobody would look for).

  Returns @{ Ok; Command; Data; Failure; ExitCode; OutFile; Seconds;
  TimedOut }, where Failure is a plain sentence for the operator.
#>
function Invoke-PromoteDbCommand {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][hashtable]$Environment,
    [string]$Step = "",
    [int]$TimeoutSeconds = -1
  )
  if (-not $Step) { $Step = $Command }
  if ($TimeoutSeconds -lt 0) { $TimeoutSeconds = Get-PromoteChildTimeoutSeconds -Step $Step }
  $Environment = Get-PromoteDbCommandEnvironment -Command $Command -Environment $Environment

  $saved = @{}
  foreach ($name in @($Environment.Keys)) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, [string]$Environment[$name], 'Process')
  }
  $child = $null
  try {
    # Bare `node`, the way the npm steps use bare `npm`: it is what is on the
    # machine's PATH, it is what the rest of ops\ uses, and it is what a test
    # replaces to drive all of the ordering below with a fake library.
    $library = Get-PromoteDbLibraryPath -App $App
    $commandLine = "node `"$library`" $Command"
    $child = Invoke-PromoteChild -Log $Log -Step $Step -Command $commandLine -TimeoutSeconds $TimeoutSeconds
  } finally {
    foreach ($name in @($saved.Keys)) {
      [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
  }

  $report = Read-PromoteDbReport -Path $child.OutFile
  $ok = ($null -ne $report) -and ($report.ok -eq $true)
  $failure = ""
  if (-not $ok) {
    if ($child.TimedOut) {
      $failure = "$Command ran past its $TimeoutSeconds-second limit and was stopped"
    } elseif ($null -eq $report) {
      $failure = "$Command did not produce an answer (exit $($child.ExitCode)); its output is in $($child.OutFile)"
    } elseif ($report.refusal) {
      $failure = "$($report.refusal)"
    } elseif ($report.error) {
      $failure = "$Command failed: $($report.error)"
    } else {
      $failure = "$Command did not succeed (exit $($child.ExitCode)); its output is in $($child.OutFile)"
    }
  }
  return [pscustomobject]@{
    Ok       = $ok
    Command  = $Command
    Data     = $report
    Failure  = $failure
    ExitCode = $child.ExitCode
    OutFile  = $child.OutFile
    Seconds  = $child.Seconds
    TimedOut = $child.TimedOut
  }
}

<#
  The three names, and nothing else. No connection to the server is made.

  Used by a resumed run that is carrying on from a step BEFORE the copy -- it
  has no names in hand, and it must not invent them here, because the copy
  command validates the name it is given against the same rule. One rule, one
  place: ops\lib-promote-db.mjs.
#>
function Invoke-PromoteDatabaseNames {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$Stamp
  )
  $values = New-PromoteDbEnvironment -DatabaseUrl $DatabaseUrl -Stamp $Stamp
  return Invoke-PromoteDbCommand -Log $Log -App $App -Command 'names' -Step 'dbstate' -Environment $values
}

<#
  Everything about the database that can be settled before the paper is
  stopped: the names, whether the copy's name is free, whether the role may
  create a database, and whether there is room on the disk for one.

  Read-only, and it changes nothing. Run inside the promotion's own `preflight`
  step, which is before `stop`, for the reason that step exists at all.
#>
function Invoke-PromoteDatabasePreflight {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$Stamp,
    [string]$AdminUrl = ""
  )
  $values = New-PromoteDbEnvironment -AdminUrl $AdminUrl -DatabaseUrl $DatabaseUrl -Stamp $Stamp
  return Invoke-PromoteDbCommand -Log $Log -App $App -Command 'preflight' -Step 'preflight' -Environment $values
}

<#
  Take the copy. `Create database <copy> template <live>`.

  Only reachable from the `dbcopy` step, which is after the app has been
  stopped: PostgreSQL refuses to copy a database anybody is connected to, and
  the app is the connection. The library checks that for itself as well, so a
  session that arrives in the gap between the stop and this call is refused
  rather than half-copied.
#>
function Invoke-PromoteDatabaseCopy {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Copy,
    [Parameter(Mandatory = $true)][string]$Failed,
    [Parameter(Mandatory = $true)][string]$Stamp,
    [string]$DatabaseUrl = "",
    [string]$AdminUrl = ""
  )
  $values = New-PromoteDbEnvironment -AdminUrl $AdminUrl -DatabaseUrl $DatabaseUrl -Database $Database -Copy $Copy -Failed $Failed -Stamp $Stamp
  return Invoke-PromoteDbCommand -Log $Log -App $App -Command 'copy' -Step 'dbcopy' -Environment $values
}

<#
  What exists on the server right now, by name and size. Read-only.

  A resumed run asks this before it carries on: it must never take a second
  copy, and it must never put a copy back that is not there.
#>
function Invoke-PromoteDatabaseState {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [string]$Database = "",
    [string]$Copy = "",
    [string]$Failed = "",
    [string]$Stamp = "",
    [string]$DatabaseUrl = "",
    [string]$AdminUrl = ""
  )
  $values = New-PromoteDbEnvironment -AdminUrl $AdminUrl -DatabaseUrl $DatabaseUrl -Database $Database -Copy $Copy -Failed $Failed -Stamp $Stamp
  return Invoke-PromoteDbCommand -Log $Log -App $App -Command 'state' -Step 'dbstate' -Environment $values
}

<#
  The swap: rename the live database aside, then rename the copy into its
  place. The library refuses unless nobody is connected to the live database,
  so the wait below is what normally makes it succeed.

  `-Mode 'manual'` is the operator's own rollback (`-RollbackDatabase`) rather
  than the promotion putting things back by itself; it only changes the words
  in the refusals.
#>
function Invoke-PromoteDatabaseSwapBack {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Copy,
    [Parameter(Mandatory = $true)][string]$Failed,
    [string]$Stamp = "",
    [string]$DatabaseUrl = "",
    [string]$AdminUrl = "",
    [ValidateSet('recovery', 'manual')][string]$Mode = 'recovery'
  )
  $values = New-PromoteDbEnvironment -AdminUrl $AdminUrl -DatabaseUrl $DatabaseUrl -Database $Database -Copy $Copy -Failed $Failed -Stamp $Stamp

  Write-PromoteLog $Log "waiting up to $(Get-PromoteDbWaitSeconds)s for every connection to $Database to close"
  $waited = Invoke-PromoteDbCommand -Log $Log -App $App -Command 'wait-for-zero' -Step 'dbswap' -Environment $values
  if (-not $waited.Ok) {
    # Refused, and NOTHING was renamed. This is the one case where the
    # database keeps whatever the failed rollout did to it, so it has to be
    # said in full rather than folded into a shorter sentence.
    Write-PromoteLog $Log "the database was NOT swapped back: $($waited.Failure)"
    return [pscustomobject]@{ Ok = $false; Swapped = $false; Data = $null; Failure = $waited.Failure }
  }
  Write-PromoteLog $Log "nobody is connected to $Database (waited $([math]::Round([double]$waited.Data.waitedSeconds,1))s)"

  $command = if ($Mode -eq 'manual') { 'rollback' } else { 'swap-back' }
  $swapped = Invoke-PromoteDbCommand -Log $Log -App $App -Command $command -Step 'dbswap' -Environment $values
  if (-not $swapped.Ok) {
    # The library records which renames it got through even when it reports a
    # failure, and those lines belong in the log: a rename that really
    # happened is the difference between "the database was not touched" and
    # "the paper's data is under a different name now".
    foreach ($step in @($swapped.Data.steps)) { Write-PromoteLog $Log "database: $step" }
    Write-PromoteLog $Log "the database was NOT swapped back: $($swapped.Failure)"
    return [pscustomobject]@{ Ok = $false; Swapped = $false; Data = $swapped.Data; Failure = $swapped.Failure }
  }
  foreach ($step in @($swapped.Data.steps)) { Write-PromoteLog $Log "database: $step" }
  if ($swapped.Data.resumedFromHalfState) {
    Write-PromoteLog $Log "this swap had already been started once and stopped half way; it has been finished, so $Database is the copy again"
  }
  # A size that could not be read afterwards is not a swap that failed. The
  # database the paper serves is already the copy; the number is only what the
  # log says about it.
  $size = "size unknown"
  if ($swapped.Data.sizeKnown) { $size = Format-PromoteDbSize $swapped.Data.sizeBytes }
  elseif ($swapped.Data.sizeNote) { Write-PromoteLog $Log "database: $($swapped.Data.sizeNote)" }
  Write-PromoteLog $Log "the database the paper serves is $Database again; what the failed rollout did to it is kept as $Failed ($size)"
  return [pscustomobject]@{ Ok = $true; Swapped = $true; Data = $swapped.Data; Failure = "" }
}

<#
  A size a person reads, out of the bytes the library reported.
#>
function Format-PromoteDbSize {
  param($Bytes)
  $value = 0.0
  try { $value = [double]$Bytes } catch { $value = 0 }
  if ($value -ge 1073741824) { return "$([math]::Round($value / 1073741824, 1)) GB" }
  if ($value -ge 1048576) { return "$([math]::Round($value / 1048576, 1)) MB" }
  if ($value -ge 1024) { return "$([math]::Round($value / 1024, 1)) KB" }
  return "$([int]$value) bytes"
}

<#
  The stamp inside a copy's name: `<database>_prerollout_<yyyyMMddHHmmss>`.
  Returns $null when the name is not a copy's.
#>
function Get-PromoteCopyStamp {
  param([string]$Copy)
  $m = [regex]::Match("$Copy", '_prerollout_(\d{14})$')
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value
}

<#
  Was this copy taken AFTER the paper was stopped?

  A copy is a picture of the database. One taken before the app went down is a
  picture of a database that was still being written to, so putting it back
  would silently throw away whatever the app did between the copy and the stop.
  The promotion never makes one in that order -- `dbcopy` is after `stop` --
  which is exactly why a resumed run checks rather than assumes: the names come
  out of a log file, and a log file can be a run that was renamed, copied or
  edited by hand between the two runs.

  BOTH TIMES COME FROM THE LOG'S OWN STEP LINES, and that is the fix the
  auditor's B3 was about. The obvious-looking version of this compared the
  stamp inside the copy's NAME with the stop time -- but that stamp is the
  second the RUN started, and the stop is however long later the backup took.
  Measured on a promotion that takes its backup in 41 seconds, the copy's name
  stamp is 41 seconds older than the stop, so the check said "not taken after
  the paper was stopped" for every real run and `-Resume` could never get past
  `dbcopy`. Only a run whose backup finished inside the same second as its
  start ever passed, which is not a case that happens.

  The `step=dbcopy` line's time is when the copy was actually made, on the same
  clock as the `step=stop ok` line's. Those two are comparable, and their order
  is what "taken after the stop" means.

  Returns $true only when the copy can be shown to be at or after the stop.
  Nothing to compare against is NOT a pass.
#>
function Test-PromoteCopyFreshness {
  param(
    [string]$CopyAt = "",
    [string]$StopAt = ""
  )
  if (-not $CopyAt -or -not $StopAt) { return $false }
  try {
    $taken = [datetime]::ParseExact($CopyAt, 'yyyy-MM-dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
    $stopped = [datetime]::ParseExact($StopAt, 'yyyy-MM-dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
  } catch {
    return $false
  }
  return ($taken -ge $stopped)
}

<#
  The exact command that puts a copy back by hand, for printing to the
  operator. Copy-and-paste ready, one line, like Get-PromoteRecoveryCommand.
#>
function Get-PromoteRollbackCommand {
  param(
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][string]$Copy
  )
  $script = Join-Path (Join-Path $App "ops") "promote.ps1"
  return "powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`" -RollbackDatabase $Copy"
}

<#
  The plain words for an operator whose rollout failed and whose database has
  been put back. Two facts have to survive into that sentence: which database
  the paper is serving now, and where the failed rollout's schema went.
#>
function Get-PromoteDbSwapSentence {
  param(
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Failed
  )
  return "The paper is serving $Database again -- the copy taken before this rollout. No data was lost: the paper was stopped from before the copy was taken until now, so nothing was written in between. What the failed rollout did to the database is kept as $Failed and nothing has been deleted."
}

<#
  The whole of the failure path once a copy exists: stop whatever is serving
  the new build, put the copy back, restore the build that was running before,
  start it, and check it answers.

  This is the unit's reason for existing. Without it, a build that died inside
  the migration leaves the old build serving a database that has moved on --
  and a page reading a column a migration changed answers wrongly rather than
  failing, which is the worst way for a newspaper to be wrong.

  It runs on EVERY failure after the copy: the dependency install, the
  fast-forward, the build/migration, and a new build that never answers. One
  rule, because at 2 AM a rule with exceptions is a rule that gets applied
  wrongly. It NEVER runs after the health checks pass -- by then the new app
  has been serving and taking writes, and putting a picture of the database
  back would throw those away. That case prints the command to do it by hand
  instead, and says what it costs.

  The two scriptblocks are the caller's stop and start, so the ordering that
  matters lives here, where scripts\promote-step-runner.test.mjs can drive it
  with fakes.

  Returns @{ PaperUp; Swapped; SwappedOk; Database; Copy; Failed; Failure }
  where Failure is a plain-words sentence for the operator.
#>
function Invoke-PromoteFailedRollout {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][scriptblock]$StopTheApp,
    [Parameter(Mandatory = $true)][scriptblock]$StartTheApp,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Why,
    [string]$Copy = "",
    [string]$Failed = "",
    [string]$DatabaseUrl = "",
    [string]$AdminUrl = "",
    [string]$Previous = "",
    [ValidateSet('none', 'maybe', 'yes')][string]$MigrationsRan = 'none',
    [string]$BuildOutput = "",
    [string]$Stamp = "",
    # $false for a failure that happened before anything touched .output -- the
    # fast-forward, or the dependency install. There the build ON DISK is still
    # the one that was serving, and restoring .output-previous (which is a build
    # from an EARLIER promotion) would replace a working build with an older one.
    [bool]$RestoreBuild = $true
  )
  $swapped = $false
  $swapFailure = ""

  Write-PromoteLog $Log "the rollout failed ($Why); stopping anything left serving the new build"
  $stopResult = & $StopTheApp
  if ($stopResult -and $stopResult.Foreign) {
    Write-PromoteLog $Log "port is held by $($stopResult.Foreign), which is not this app -- not touching it"
  } elseif ($stopResult -and @($stopResult.Stopped).Count -gt 0) {
    Write-PromoteLog $Log "stopped $((@($stopResult.Stopped)) -join ', ')"
  } else {
    Write-PromoteLog $Log "nothing was listening, so there was nothing to stop"
  }

  if ($Copy) {
    Write-PromoteLog $Log "putting the database back: $Database will become $Failed and $Copy will become $Database"
    $result = Invoke-PromoteDatabaseSwapBack -Log $Log -App $App -Database $Database -Copy $Copy -Failed $Failed -Stamp $Stamp -DatabaseUrl $DatabaseUrl -AdminUrl $AdminUrl -Mode 'recovery'
    $swapped = $result.Swapped
    $swapFailure = $result.Failure
  } else {
    Write-PromoteLog $Log "there is no copy of $Database from this run, so the database is left exactly as it is"
    $swapFailure = "There is no pre-rollout copy of $Database from this run, so the database could not be put back."
  }

  <#
    'none' when the database was put back, and that is not a detail.

    MigrationsRan exists to say "the old build you are about to serve is
    sitting on a database that has moved on". Once the copy is back, the
    database has NOT moved on -- it is the picture from before this rollout --
    so telling the operator that migrations may have run would send them
    looking for a problem that is not there. The warning is only true on the
    path where the swap could not happen, which is the one it is kept for.
  #>
  $migrationsForFallback = $MigrationsRan
  if ($swapped) { $migrationsForFallback = 'none' }

  if ($RestoreBuild) {
    $paperUp = Invoke-PromoteFallback -Log $Log -App $App -StartTheApp $StartTheApp -Previous $Previous -MigrationsRan $migrationsForFallback -BuildOutput $BuildOutput
  } else {
    Write-PromoteLog $Log "the build on disk is the one that was serving before this run, so it is started as it is"
    $paperUp = [bool](& $StartTheApp)
    if ($paperUp) { Write-PromoteLog $Log "the paper is back on the version it was running. The promote did NOT complete." }
  }

  $sentence = ""
  if ($swapped) {
    $sentence = Get-PromoteDbSwapSentence -Database $Database -Failed $Failed
    <#
      The failure happened BEFORE the build ran -- the fast-forward, or the
      dependency install -- so `npm run db:migrate` never ran and the two
      databases hold the same data.

      Said out loud because the rest of the sentence would otherwise read as
      though something had gone wrong with the paper's data: an operator
      looking at a `_failed_` database after a promote that failed at `git
      merge` needs to know it is an exact duplicate of the one being served,
      not a half-migrated one to go and inspect.
    #>
    if (-not $RestoreBuild) {
      $sentence = "$sentence The build had not started, so nothing had been migrated: that database holds exactly the same data as the one the paper is serving."
    }
    if (-not $paperUp) { $sentence = "$sentence The app did not answer afterwards; read logs\townreporter.log." }
  } elseif (-not $paperUp) {
    $sentence = "The paper is still down and the database was not put back. $swapFailure"
  } else {
    $sentence = "$swapFailure $((Get-PromoteFallbackSentence -App $App -MigrationsRan $MigrationsRan -BuildOutput $BuildOutput))".Trim()
    if (-not $sentence) { $sentence = "The paper is back on the OLD version and the database could not be put back." }
  }
  Write-PromoteLog $Log $sentence

  return [pscustomobject]@{
    PaperUp   = $paperUp
    Swapped   = $swapped
    Database  = $Database
    Copy      = $Copy
    Failed    = $Failed
    Failure   = $sentence
    SwapError = $swapFailure
  }
}

<#
  The whole of `ops\promote.ps1 -RollbackDatabase <copy>`: the promotion's
  failure path, run afterwards, by an operator, on purpose.

  It is the same swap as the automatic recovery and it is deliberately a
  separate function, because the two differ in the one way that matters: this
  one is reached when the new app HAS been serving and taking writes, so it
  destroys those writes rather than rescuing them.

  THE APP COMES FIRST. Before it reads anything, before it plans anything, this
  asks whether the paper is answering on its port, and refuses if it is:

    "The paper is answering on port N. Stop it first, or run the promote's own
     recovery; nothing was changed."

  The reason is not tidiness. A promotion that failed its own health checks
  leaves the paper UP and serving -- that is the case this command is printed
  for -- and an operator reaching for it while the new app is still running
  gets a database swapped out from under a live process. The app holds
  connections to the database being renamed, so the swap would refuse anyway;
  but "refused because something is connected" is a worse sentence at 2 AM
  than "the paper is answering on port 3000", and by then the operator has
  already been told nothing about what they were about to do.

  -StopApp is the deliberate exception: the operator has said so, the app is
  stopped by PID exactly as the rest of this script stops it, and then it
  continues.

  WHAT IT PRINTS BEFORE IT CHANGES ANYTHING, in the log and wherever the
  caller's -Announce points:

    <copy> (597.7 MB) becomes <database>; the current <database> (610.2 MB)
    is kept as <database>_failed_<stamp>

  Names AND sizes, both, before a single rename: which database the paper is
  about to serve is the whole of what this command decides, and the sizes are
  what tell an operator whether they have picked the right copy.

  -DryRun prints the same sentence and stops there. It is -WhatIf, and it
  matters more here than anywhere else in the script: this is the only path in
  it where the thing being undone cannot be re-done.

  Returns @{ Refused; DryRun; Swapped; PaperUp; Database; Copy; Failed; Plan;
  Failure }, where Refused means nothing was touched at all.
#>
function Invoke-PromoteDatabaseRollback {
  param(
    [Parameter(Mandatory = $true)]$Log,
    [Parameter(Mandatory = $true)][string]$App,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][scriptblock]$TestThePort,
    [Parameter(Mandatory = $true)][scriptblock]$StopTheApp,
    [Parameter(Mandatory = $true)][scriptblock]$StartTheApp,
    [Parameter(Mandatory = $true)][string]$Copy,
    [Parameter(Mandatory = $true)][string]$Database,
    [string]$DatabaseUrl = "",
    [string]$AdminUrl = "",
    [string]$Stamp = "",
    [switch]$StopApp,
    [switch]$DryRun,
    [scriptblock]$Announce = $null
  )
  <#
    THE FAILED NAME COMES FROM THE COPY'S OWN STAMP, not from the clock.

    A promotion names its copy and the database it sets aside after the same
    second -- `<db>_prerollout_<stamp>` and `<db>_failed_<stamp>` -- so the
    stamp inside the copy's name IS the name of the database that rollout
    moved aside. Deriving it here rather than inventing a fresh one buys two
    things:

      - the two names pair up in the server's database list, which is how an
        operator sees at a glance which copy belongs to which failure;
      - a swap that stopped between its two renames can be FINISHED. In that
        state the live name is free, the copy is waiting and its data is under
        `<db>_failed_<the copy's stamp>` -- the only name this function could
        look under. A fresh stamp would name a database that does not exist,
        and the command the promotion tells the operator to run would refuse.

    $Stamp is the fallback for a name that carries no stamp at all, which the
    swap itself refuses anyway.
  #>
  $copyStamp = Get-PromoteCopyStamp -Copy $Copy
  if (-not $copyStamp) { $copyStamp = $Stamp }
  if (-not $copyStamp) { $copyStamp = Get-Date -Format 'yyyyMMddHHmmss' }
  $failed = "$Database`_failed_$copyStamp"

  # --- the port, first, before anything is read or planned ------------------
  $paperUp = [bool](& $TestThePort)
  if ($paperUp -and -not $StopApp) {
    $sentence = "The paper is answering on port $Port. Stop it first, or run the promote's own recovery; nothing was changed."
    Write-PromoteLog $Log $sentence
    return [pscustomobject]@{
      Refused  = $true
      DryRun   = $false
      Swapped  = $false
      PaperUp  = $true
      Database = $Database
      Copy     = $Copy
      Failed   = $failed
      Plan     = ""
      Failure  = $sentence
    }
  }
  if ($paperUp) {
    Write-PromoteLog $Log "the paper is answering on port $Port, and -StopApp was passed, so it will be stopped by PID before anything is renamed"
  } else {
    Write-PromoteLog $Log "nothing is answering on port $Port, so there is no app to stop"
  }

  # --- what the swap would do, with the sizes -------------------------------
  $liveSize = "size unknown"
  $copySize = "size unknown"
  $failedSize = "size unknown"
  $state = Invoke-PromoteDatabaseState -Log $Log -App $App -Database $Database -Copy $Copy -Failed $failed -Stamp $copyStamp -DatabaseUrl $DatabaseUrl -AdminUrl $AdminUrl
  $liveExists = $false
  $failedExists = $false
  if ($state.Ok) {
    $live = $state.Data.databases.$Database
    if ($live -and $live.exists) { $liveExists = $true; $liveSize = Format-PromoteDbSize $live.sizeBytes }
    $copyEntry = $state.Data.databases.$Copy
    if ($copyEntry -and $copyEntry.exists) { $copySize = Format-PromoteDbSize $copyEntry.sizeBytes }
    $failedEntry = $state.Data.databases.$failed
    if ($failedEntry -and $failedEntry.exists) { $failedExists = $true; $failedSize = Format-PromoteDbSize $failedEntry.sizeBytes }
  } else {
    # Not fatal on its own: the swap below asks the same server the same
    # question and will refuse with its own sentence if it cannot be reached.
    Write-PromoteLog $Log "could not read the sizes before the rollback: $($state.Failure)"
  }
  <#
    Two plans, because two different things can be about to happen.

    An EARLIER SWAP THAT STOPPED HALF WAY -- no live name, the failed name
    present, the copy waiting -- is finished rather than started: the database
    that was serving is already under the failed name, and the only rename
    left is the copy's. Printing the ordinary plan there would describe a
    rename that is not going to happen, and would name the live database as
    something it is not (it does not exist).
  #>
  $plan = ""
  if (-not $liveExists -and $failedExists) {
    $plan = "$Copy ($copySize) finishes a swap that stopped half way: $failed ($failedSize) already holds what was serving, and $Copy becomes $Database."
  } else {
    $plan = "$Copy ($copySize) becomes $Database; the current $Database ($liveSize) is kept as $failed."
  }
  Write-PromoteLog $Log $plan
  if ($Announce) { & $Announce $plan }

  if ($DryRun) {
    Write-PromoteLog $Log "database rollback: -WhatIf, so nothing was stopped, renamed or started."
    return [pscustomobject]@{
      Refused  = $false
      DryRun   = $true
      Swapped  = $false
      PaperUp  = $paperUp
      Database = $Database
      Copy     = $Copy
      Failed   = $failed
      Plan     = $plan
      Failure  = ""
    }
  }

  # --- stop the app, only when the operator said so --------------------------
  if ($StopApp) {
    $stopResult = & $StopTheApp
    if ($stopResult -and $stopResult.Foreign) {
      $sentence = "Port $Port is held by $($stopResult.Foreign), which is not this app. Not touching it, and not rolling anything back. Nothing was changed."
      Write-PromoteLog $Log $sentence
      return [pscustomobject]@{
        Refused = $true; DryRun = $false; Swapped = $false; PaperUp = $true
        Database = $Database; Copy = $Copy; Failed = $failed; Plan = $plan; Failure = $sentence
      }
    }
    $stoppedCount = 0
    if ($stopResult) { $stoppedCount = @($stopResult.Stopped).Count }
    if ($stoppedCount -gt 0) { Write-PromoteLog $Log "stopped $((@($stopResult.Stopped)) -join ', ')" }
    else { Write-PromoteLog $Log "nothing was listening on port $Port" }
  }

  # --- the swap -------------------------------------------------------------
  $result = Invoke-PromoteDatabaseSwapBack -Log $Log -App $App -Database $Database -Copy $Copy -Failed $failed -Stamp $copyStamp -DatabaseUrl $DatabaseUrl -AdminUrl $AdminUrl -Mode 'manual'
  if (-not $result.Swapped) {
    Write-PromoteLog $Log "the database was NOT rolled back: $($result.Failure)"
    <#
      Nothing was renamed, and the app may have been stopped a moment ago, so
      put the paper back the way it was found: whatever is in .output is what
      was serving before this command ran.
    #>
    $backUp = [bool](& $StartTheApp)
    if ($backUp) { Write-PromoteLog $Log "the paper is back up on the version it was running; the database rollback did NOT happen." }
    return [pscustomobject]@{
      Refused  = $false
      DryRun   = $false
      Swapped  = $false
      PaperUp  = $backUp
      Database = $Database
      Copy     = $Copy
      Failed   = $failed
      Plan     = $plan
      Failure  = $result.Failure
    }
  }
  Write-PromoteLog $Log "database: $Database -> $failed (kept, not deleted)"
  Write-PromoteLog $Log "database: $Copy -> $Database, so the paper will be serving the copy"

  <#
    The BUILD half. The build that was serving before the promotion is still at
    .output-previous (Save-PromotePreviousBuild puts it there and only a
    fallback consumes it), and a database rolled back to before a release wants
    the build from before that release. When there is none, the current build
    stays -- the operator is told either way rather than left to guess.
  #>
  $previous = Resolve-PromotePreviousBuild -App $App
  if ($previous -and (Restore-PromotePreviousBuild -App $App -Previous $previous)) {
    Write-PromoteLog $Log "the build from before the promotion has been put back at .output"
  } else {
    Write-PromoteLog $Log "there is no previous build on disk to put back, so the current build stays"
  }
  $upAgain = [bool](& $StartTheApp)
  if (-not $upAgain) {
    Write-PromoteLog $Log "the app did not answer on port $Port after the database rollback"
  }
  return [pscustomobject]@{
    Refused  = $false
    DryRun   = $false
    Swapped  = $true
    PaperUp  = $upAgain
    Database = $Database
    Copy     = $Copy
    Failed   = $failed
    Plan     = $plan
    Failure  = ""
  }
}
