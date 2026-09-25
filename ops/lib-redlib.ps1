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
    Start-RedlibIfDown | Stop-Redlib

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

. (Join-Path $PSScriptRoot "lib-env.ps1")

function Get-RedlibInstallRoot {
  param([string]$InstallRoot)
  if ($InstallRoot) { return $InstallRoot }
  if ($env:REDLIB_INSTALL_ROOT) { return $env:REDLIB_INSTALL_ROOT }
  return (Join-Path $env:LOCALAPPDATA "RedditSearch\Redlib")
}

# The skill's install.json, or $null when Redlib was never installed here.
function Get-RedlibConfig {
  param([string]$InstallRoot)
  $configPath = Join-Path (Get-RedlibInstallRoot $InstallRoot) "install.json"
  if (-not (Test-Path -LiteralPath $configPath)) { return $null }
  try { return (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json) } catch { return $null }
}

function Get-RedlibBaseUrl {
  param([string]$InstallRoot)
  $config = Get-RedlibConfig $InstallRoot
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
  param([string]$InstallRoot)
  $root = Get-RedlibInstallRoot $InstallRoot
  $config = Get-RedlibConfig $InstallRoot
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
  param([string]$InstallRoot)
  $baseUrl = Get-RedlibBaseUrl $InstallRoot
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
  param([string]$InstallRoot)
  if (-not (Get-RedlibConfig $InstallRoot)) { return 'absent' }
  if (Test-RedlibUp $InstallRoot) { return 'up' }
  return 'down'
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
  param([string]$InstallRoot, [string]$OffSwitch)
  if ($OffSwitch -eq '0') { return 'off' }
  if (-not (Get-RedlibConfig $InstallRoot)) { return 'absent' }
  if (Test-RedlibUp $InstallRoot) { return 'up' }
  $script = Join-Path $PSScriptRoot "redlib.ps1"
  $shell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
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
  param([string]$InstallRoot)
  $entry = Get-RedlibProcess $InstallRoot
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
