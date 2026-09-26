<#
  The local Redlib, as the other ops scripts need to see it.

  ops/redlib.ps1 owns the install: it builds it, tests it, and forwards the
  work to the reddit-search skill that installed it. This file owns the three
  questions the rest of ops/ asks about it -- is it installed, which process
  is it, and is it answering -- so there is one answer to "is the Reddit
  reader up" instead of one per script.

  The desk reads a subreddit through Reddit's .rss when Redlib is down and
  says so in the source text (src/lib/news/reddit.server.ts). So Redlib is
  optional: nothing here may fail the paper, and no caller may start or stop
  the paper because of it.

  Two rules, both learned on this machine:

  * The port, not the image name. Redlib is stopped only through the pid file
    the skill writes (InstallRoot\redlib.pid), and only when that pid is alive
    AND running the executable install.json names. stop-townreporter.ps1
    already carries a note about what a stop-by-image-name costs here.

  * "Answering" is the question, not "a process exists". A Redlib that holds
    its pid and does not serve /info.json is not a Reddit reader; the desk
    gets the same RSS-only result either way.

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-redlib.ps1")
  Then use:
    Get-RedlibInstallRoot | Get-RedlibConfig | Get-RedlibProcess
    Get-RedlibState | Test-RedlibUp | Get-RedlibOffSwitch
    Get-RedlibSandboxedRoots | Get-RedlibAbsenceNote
    Start-RedlibIfDown | Stop-Redlib

  Where the install is lives in Get-RedlibInstallRoot, and the reason it is
  read from .env rather than assumed is at the top of that function. Every
  function here takes an optional -EnvFile for the same reason: it is the one
  place both a packaged process (Claude's, whose writes MSIX redirects) and a
  scheduled task (whose writes it does not) read the same value.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

<#
  Where the install is, in the order the machine can actually see it.

  Priority: the caller's -InstallRoot, then REDLIB_INSTALL_ROOT in this
  process's environment, then REDLIB_INSTALL_ROOT in the install's .env, then
  the skill's own default.

  Why the .env rung exists (2026-09-25): Redlib was installed into
  %LOCALAPPDATA%\RedditSearch\Redlib from inside an MSIX-packaged app, and MSIX
  redirects writes to that path into
  %LOCALAPPDATA%\Packages\<package>\LocalCache\Local\RedditSearch\Redlib. A
  packaged process sees the merged view, which is why Claude's own shell found
  the install and started it by hand; Task Scheduler's processes are not
  packaged and see an empty directory, which is why the watchdog logged
  "redlib: not installed here" every five minutes while Redlib was running.

  The .env is the one setting both kinds of process read the same way, and the
  path it names must live OUTSIDE AppData or the same redirection applies. See
  ops\redlib-relocate.ps1, which puts it in C:\Users\scott\TownReporterTools
  by default and prints the line to add.
#>
function Get-RedlibInstallRoot {
  param([string]$InstallRoot, [string]$EnvFile)
  if ($InstallRoot) { return $InstallRoot }
  if ($env:REDLIB_INSTALL_ROOT) { return $env:REDLIB_INSTALL_ROOT }
  if (-not $EnvFile) { $EnvFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env" }
  $fromEnvFile = Read-OpsEnvValue -EnvFile $EnvFile -Name "REDLIB_INSTALL_ROOT" -Fallback ""
  if ($fromEnvFile) { return $fromEnvFile }
  return (Join-Path $env:LOCALAPPDATA "RedditSearch\Redlib")
}

<#
  Copies of the install that only a packaged process can see.

  MSIX redirects %LOCALAPPDATA% writes made from inside a packaged app into
  %LOCALAPPDATA%\Packages\<package>\LocalCache\Local\..., so an install made
  from inside one is invisible to Task Scheduler -- the path looks empty and
  Redlib reads as "not installed here" on a machine where it demonstrably is.
  These are the real directories behind that redirect, found by listing the
  filesystem rather than by reading the merged view, so ops\status.ps1 and the
  Control page can say WHY the reader is absent and what to do about it instead
  of reporting a machine that has no reader.
#>
function Get-RedlibSandboxedRoots {
  $found = @()
  if (-not $env:LOCALAPPDATA) { return $found }
  $packages = Join-Path $env:LOCALAPPDATA "Packages"
  if (-not (Test-Path -LiteralPath $packages)) { return $found }
  $roots = @(Get-ChildItem -LiteralPath $packages -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "LocalCache\Local\RedditSearch\Redlib" })
  foreach ($root in $roots) {
    if (Test-Path -LiteralPath (Join-Path $root "install.json")) { $found += $root }
  }
  return $found
}

# The skill's install.json, or $null when Redlib was never installed here.
function Get-RedlibConfig {
  param([string]$InstallRoot, [string]$EnvFile)
  $configPath = Join-Path (Get-RedlibInstallRoot -InstallRoot $InstallRoot -EnvFile $EnvFile) "install.json"
  if (-not (Test-Path -LiteralPath $configPath)) { return $null }
  try { return (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json) } catch { return $null }
}

function Get-RedlibBaseUrl {
  param([string]$InstallRoot, [string]$EnvFile)
  $config = Get-RedlibConfig -InstallRoot $InstallRoot -EnvFile $EnvFile
  if ($config -and $config.baseUrl) { return [string]$config.baseUrl }
  return "http://127.0.0.1:18080"
}

<#
  What the pid file says, checked rather than believed.

  State is one of:
    absent     - Redlib is not installed here
    none       - no pid file, or the pid in it is not running (a stale file)
    unverified - the pid is alive but its executable could not be read
    other      - the pid is alive and running something that is NOT Redlib
    live       - the pid is alive and running the installed Redlib

  'unverified' and 'other' are separate on purpose. Stop-Redlib refuses both:
  dropping the pid file for a live pid would orphan a running process and lose
  the only handle to it.
#>
function Get-RedlibProcess {
  param([string]$InstallRoot, [string]$EnvFile)
  $root = Get-RedlibInstallRoot -InstallRoot $InstallRoot -EnvFile $EnvFile
  $config = Get-RedlibConfig -InstallRoot $InstallRoot -EnvFile $EnvFile
  if (-not $config) { return [pscustomobject]@{ State = 'absent'; Pid = $null; Root = $root } }
  $pidPath = Join-Path $root "redlib.pid"
  if (-not (Test-Path -LiteralPath $pidPath)) {
    return [pscustomobject]@{ State = 'none'; Pid = $null; Root = $root }
  }
  $pidValue = 0
  $raw = Get-Content -Raw -LiteralPath $pidPath -ErrorAction SilentlyContinue
  if (-not $raw -or -not [int]::TryParse(($raw -replace '\s', ''), [ref]$pidValue)) {
    return [pscustomobject]@{ State = 'none'; Pid = $null; Root = $root }
  }
  if (-not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) {
    return [pscustomobject]@{ State = 'none'; Pid = $pidValue; Root = $root }
  }
  try {
    $expected = [IO.Path]::GetFullPath([string]$config.executable)
    $actual = [IO.Path]::GetFullPath((Get-Process -Id $pidValue).MainModule.FileName)
  } catch {
    return [pscustomobject]@{ State = 'unverified'; Pid = $pidValue; Root = $root }
  }
  if ($actual -ne $expected) { return [pscustomobject]@{ State = 'other'; Pid = $pidValue; Root = $root } }
  return [pscustomobject]@{ State = 'live'; Pid = $pidValue; Root = $root }
}

<#
  Is the Reddit reader answering?

  Answered at the endpoint, not from the pid file: the desk does not care who
  started Redlib, and a Redlib started by hand is still a Reddit reader. This
  is /info.json only. Whether it can actually reach Reddit is the skill's own
  'check' action (ops\redlib.ps1 check), which is a slower, deliberate test.
#>
function Test-RedlibUp {
  param([string]$InstallRoot, [string]$EnvFile)
  $baseUrl = Get-RedlibBaseUrl -InstallRoot $InstallRoot -EnvFile $EnvFile
  try {
    $null = Invoke-RestMethod -Uri "$baseUrl/info.json" -TimeoutSec 5
    return $true
  } catch {
    return $false
  }
}

# '0' when the operator has switched the Reddit reader off: TOWNREPORTER_REDLIB=0
# in this process's environment or in the install's .env (the same switch the
# app's own Reddit handling honours). Anything else is "on".
function Get-RedlibOffSwitch {
  param([string]$EnvFile)
  if ($env:TOWNREPORTER_REDLIB -eq '0') { return '0' }
  return (Read-OpsEnvValue -EnvFile $EnvFile -Name "TOWNREPORTER_REDLIB" -Fallback '1')
}

# One word for a human: 'up', 'down', or 'absent' (never installed here).
function Get-RedlibState {
  param([string]$InstallRoot, [string]$EnvFile)
  if (-not (Get-RedlibConfig -InstallRoot $InstallRoot -EnvFile $EnvFile)) { return 'absent' }
  if (Test-RedlibUp -InstallRoot $InstallRoot -EnvFile $EnvFile) { return 'up' }
  return 'down'
}

<#
  "Absent" has two causes and they are different problems for a person.

  A machine with no Redlib is finished with the question: the desk reads Reddit
  through RSS alone and that is supported. A machine with a WORKING Redlib that
  nobody can see is not -- that is the 2026-09-25 case, where the reader was
  installed from inside an app sandbox (MSIX redirects %LOCALAPPDATA% writes),
  so the operator's shell could start it by hand and the five-minute watchdog
  kept logging "not installed here" while it ran. Same state word, opposite
  meaning, so the words come from here rather than being written twice.
#>
function Get-RedlibAbsenceNote {
  $sandboxed = @(Get-RedlibSandboxedRoots)
  if ($sandboxed.Count -gt 0) {
    return "Redlib was installed from inside an app sandbox; run ops\redlib-relocate.ps1"
  }
  return "not installed - the paper reads Reddit through RSS alone"
}

<#
  Start Redlib if it is installed and not answering, and return immediately.

  Non-blocking on purpose: ops\redlib.ps1 forwards to the skill's start
  script, which waits for Redlib to answer Reddit, and the paper's logon start
  must not be held behind an optional reader. The child is detached and its
  own thing; nothing here waits for the result.

  Returns 'up' (already answering), 'started', 'absent' (not installed --
  the desk reads Reddit through RSS alone, which is supported), or 'off'
  (TOWNREPORTER_REDLIB=0 in the environment or in .env).
#>
function Start-RedlibIfDown {
  param([string]$InstallRoot, [string]$OffSwitch, [string]$EnvFile)
  if ($OffSwitch -eq '0') { return 'off' }
  if (-not (Get-RedlibConfig -InstallRoot $InstallRoot -EnvFile $EnvFile)) { return 'absent' }
  if (Test-RedlibUp -InstallRoot $InstallRoot -EnvFile $EnvFile) { return 'up' }
  $script = Join-Path $PSScriptRoot "redlib.ps1"
  $shell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
  # The root the CALLER asked about, handed to the detached child in its
  # environment, so ops\redlib.ps1 start does not have to re-derive it from the
  # app's .env and cannot land on a different one. It travels as a variable
  # rather than as an argument because this is a bare `start`: the child is
  # spawned hidden and nothing here reads what it says.
  $env:REDLIB_INSTALL_ROOT = (Get-RedlibInstallRoot -InstallRoot $InstallRoot -EnvFile $EnvFile)
  Start-Process -FilePath $shell `
    -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "`"$script`"", "start" `
    -WindowStyle Hidden
  return 'started'
}

<#
  Stop Redlib through its own pid file. Never by image name.

  Returns 'stopped', 'not-running' (nothing behind the recorded pid; the stale
  file is cleared), 'refused' (the pid belongs to another program, or its
  executable could not be read -- both left alone on purpose), or 'absent'.
#>
function Stop-Redlib {
  param([string]$InstallRoot, [string]$EnvFile)
  $entry = Get-RedlibProcess -InstallRoot $InstallRoot -EnvFile $EnvFile
  switch ($entry.State) {
    'absent' { return 'absent' }
    'none' {
      Remove-Item -LiteralPath (Join-Path $entry.Root "redlib.pid") -Force -ErrorAction SilentlyContinue
      return 'not-running'
    }
    'unverified' { return 'refused' }
    'other' { return 'refused' }
  }
  Stop-Process -Id $entry.Pid -ErrorAction SilentlyContinue
  Wait-Process -Id $entry.Pid -Timeout 10 -ErrorAction SilentlyContinue
  if (Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue) { return 'refused' }
  Remove-Item -LiteralPath (Join-Path $entry.Root "redlib.pid") -Force -ErrorAction SilentlyContinue
  return 'stopped'
}
