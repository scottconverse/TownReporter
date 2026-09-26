<#
  The local Redlib the desk reads Reddit threads through.

  Reddit's `.rss` gives a subreddit its posts, with truncated bodies and no
  comments. A local Redlib gives the desk the original post in full, the
  scores, and the replies -- which on a local subreddit is usually where the
  substance is. It is worth having up when the paper reads Reddit, and worth
  not depending on: src\lib\news\reddit.server.ts falls back to RSS alone and
  says so in the source text rather than pretending it read the thread.

  The installation is the reddit-search skill's, not ours. That skill builds
  Redlib from the pinned commit with native Rust/MSVC and runs it
  loopback-only on 18080; this script only drives it from this repo, in the
  shape the other ops scripts use, so the operator does not have to remember
  where the skill lives.

  WHERE the install is is a setting now, not an assumption: REDLIB_INSTALL_ROOT
  in this process's environment, then in the install's .env, then the skill's
  own default under %LOCALAPPDATA%. The note above Get-RedlibInstallRoot in
  lib-redlib.ps1 says why -- an install made from inside an MSIX-packaged app
  lands where Task Scheduler's processes cannot see it, so the scheduled tasks
  read the root from .env instead. ops\redlib-relocate.ps1 moves an existing
  install out of AppData and prints the .env line to add.

  Every child this script starts is handed the resolved root twice: as
  -InstallRoot, which the skill's scripts take, and as REDLIB_INSTALL_ROOT in
  its environment, which is what the Redlib process they launch inherits. One
  answer, so the script, the skill and the running reader cannot disagree.

  The skill's scripts need PowerShell 7 (`$IsWindows`); this repo's ops
  scripts are Windows PowerShell 5.1. So status is answered here directly,
  and everything that touches the install is forwarded to pwsh.

  Nothing here is started automatically. Logon (start-townreporter.ps1), the
  watchdog and the Control menu drive it through ops\lib-redlib.ps1, which is
  where the "is it installed / which process is it / is it answering" answers
  live so four scripts cannot disagree about them. A Redlib left running is a
  process holding an upstream Reddit identity; the watchdog keeps it up only
  while the machine is up, and stop-townreporter.ps1 takes it down with the
  paper.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1              # status
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 start
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 restart      # stop, then start
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 check        # full usability test
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 setup        # build/install only
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 start -SkillRoot <path>
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 status -InstallRoot <path>

  -InstallRoot overrides where the install is looked for. Leave it off (the
  usual case) and the root comes from REDLIB_INSTALL_ROOT in the environment or
  in the install's .env, which is the only setting a scheduled task and a
  packaged process read the same way. See the note at the top of this file.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "start", "stop", "restart", "check", "setup")]
  [string]$Action = "status",
  [string]$SkillRoot,
  [string]$InstallRoot,
  [int]$Port = 18080
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib-redlib.ps1")

<#
  Resolve the root ONCE, here, rather than defaulting the parameter to
  %LOCALAPPDATA% at binding time.

  A parameter default is evaluated before this script's own dot-sourced library
  has a say, and the default it used to carry -- the skill's %LOCALAPPDATA%
  path -- is exactly the path a scheduled task cannot see when the install was
  made from inside a packaged app (2026-09-25). Resolving it here means the
  order in lib-redlib.ps1 applies: -InstallRoot, then REDLIB_INSTALL_ROOT in
  the environment, then in .env, then that default. Status, the child scripts
  and the log lines all then use one value.
#>
if (-not $InstallRoot) {
  $InstallRoot = Get-RedlibInstallRoot -EnvFile (Join-Path (Split-Path -Parent $PSScriptRoot) ".env")
}
$baseUrl = "http://127.0.0.1:$Port"

function Find-SkillRoot {
  param([string]$Given)
  $candidates = @()
  if ($Given) { $candidates += $Given }
  if ($env:REDDIT_REDLIB_SKILL_ROOT) { $candidates += $env:REDDIT_REDLIB_SKILL_ROOT }
  $candidates += @(
    (Join-Path $env:USERPROFILE "reddit-search-redlib\skills\reddit-search"),
    "C:\Users\scott\Desktop\Code\reddit-search-redlib\skills\reddit-search"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate "scripts\start_redlib_windows.ps1"))) {
      return $candidate
    }
  }
  throw ("The reddit-search skill was not found. Pass -SkillRoot <path to skills\reddit-search>, or set " +
    "REDDIT_REDLIB_SKILL_ROOT. Looked in: " + ($candidates -join "; "))
}

function Find-Pwsh {
  $found = Get-Command pwsh.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  foreach ($candidate in @(
      (Join-Path $env:ProgramFiles "PowerShell\7\pwsh.exe"),
      (Join-Path ${env:ProgramFiles(x86)} "PowerShell\7\pwsh.exe")
    )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw "PowerShell 7 (pwsh) is required by the skill's Redlib scripts and was not found."
}

function Invoke-SkillScript {
  param([string]$Name, [string[]]$ExtraArgs)
  $skillRoot = Find-SkillRoot -Given $SkillRoot
  $script = Join-Path $skillRoot "scripts\$Name"
  $pwsh = Find-Pwsh
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script, "-InstallRoot", $InstallRoot)
  if ($Name -eq "setup_redlib_windows.ps1") { $arguments += @("-Port", [string]$Port) }
  $arguments += $ExtraArgs
  # Twice on purpose. -InstallRoot is what the skill's own scripts read; the
  # environment variable is what the Redlib process THEY launch inherits, and it
  # is also the rung the skill's scripts fall back to when they are run without
  # the argument. Nothing here passes the path on the command line only for the
  # next process down to guess at a different one.
  $env:REDLIB_INSTALL_ROOT = $InstallRoot
  & $pwsh @arguments
  return $LASTEXITCODE
}

function Show-Status {
  $config = Get-RedlibConfig -InstallRoot $InstallRoot
  Write-Host ""
  Write-Host "  Local Redlib, as seen from this machine"
  Write-Host "  --------------------------------------"
  if (-not $config) {
    Write-Host "  [  DOWN  ] installed            no"
    Write-Host ("  [  DOWN  ] running              nothing installed under " + $InstallRoot)
    Write-Host "             to install it:      powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 setup"
    Write-Host "             the desk still reads Reddit through RSS alone, and says so in the source text."
    Write-Host ""
    return 1
  }

  Write-Host ("  [  OK  ] installed            " + $config.commit + " (" + $config.installedAt + ")")
  $entry = Get-RedlibProcess -InstallRoot $InstallRoot
  $pidValue = if ($entry.State -eq 'live') { $entry.Pid } else { $null }
  if (-not $pidValue) {
    $why = switch ($entry.State) {
      'other'      { "the recorded pid is running a different program" }
      'unverified' { "the recorded pid is alive but its executable could not be read" }
      default      { "no process holding the recorded pid" }
    }
    Write-Host ("  [  DOWN  ] running            " + $why)
    Write-Host "             to start it:       powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 start"
    Write-Host ""
    return 1
  }

  Write-Host ("  [  OK  ] running              pid " + $pidValue + " on " + $config.baseUrl)
  try {
    $info = Invoke-RestMethod -Uri "$baseUrl/info.json" -TimeoutSec 5
    $rss = if ($info.config.REDLIB_ENABLE_RSS -eq "on") { "on" } else { "OFF" }
    Write-Host ("  [  OK  ] answering            commit " + ([string]$info.git_commit).Substring(0, [Math]::Min(12, ([string]$info.git_commit).Length)) + ", rss " + $rss)
  } catch {
    Write-Host ("  [ DOWN ] answering            " + $_.Exception.Message)
    Write-Host "             the process is up but /info.json did not answer; treat the desk as RSS-only."
    Write-Host ""
    return 1
  }
  Write-Host "             stop it with:      powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop"
  Write-Host "             a healthy process is not a usable one; 'check' asks Reddit for a page."
  Write-Host ""
  return 0
}

switch ($Action) {
  "status" { exit (Show-Status) }
  "start" {
    $code = Invoke-SkillScript -Name "start_redlib_windows.ps1" -ExtraArgs @()
    if ($code -eq 0) {
      Write-Host "  Redlib is up on $baseUrl. Stop it with:"
      Write-Host "    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop"
    }
    exit $code
  }
  "stop" {
    exit (Invoke-SkillScript -Name "stop_redlib_windows.ps1" -ExtraArgs @())
  }
  "restart" {
    # The Control menu's "Restart the Reddit reader".
    #
    # Stop goes through the pid file in lib-redlib.ps1 (never by image name).
    # Start is the skill's own path, run to completion here rather than
    # detached, so this action answers with what actually happened: the menu
    # exists so an operator can be told the truth, not so a process can be
    # launched and left to explain itself. ops\start-townreporter.ps1 is the
    # opposite case -- an optional reader has no business holding up logon --
    # and uses Start-RedlibIfDown for exactly that reason.
    $stopped = Stop-Redlib -InstallRoot $InstallRoot
    Write-Host ("  stopped: " + $stopped)
    if ($stopped -eq 'absent') {
      Write-Host "  Redlib is not installed here, so there is nothing to restart."
      Write-Host "  Install it with: powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 setup"
      exit 1
    }
    if ($stopped -eq 'refused') {
      Write-Host "  Refusing to start a second Redlib: the recorded pid is not a Redlib this script can stop."
      Write-Host "  Look at it with: ops\redlib.ps1 status"
      exit 1
    }
    Start-Sleep -Seconds 1
    exit (Invoke-SkillScript -Name "start_redlib_windows.ps1" -ExtraArgs @())
  }
  "check" {
    exit (Invoke-SkillScript -Name "test_redlib_windows.ps1" -ExtraArgs @())
  }
  "setup" {
    # The pinned boring-sys2 crate (5.0.0-alpha.13) means to configure BoringSSL
    # with -DOPENSSL_NO_ASM when the host is Windows, but that define does not
    # reach cmake when a CMakeCache.txt already exists, and BoringSSL's
    # CMakeLists then leaves the .asm sources out of the project while the C code
    # still calls into them. The link fails with 54 unresolved symbols
    # (aes_hw_*, sha256_block_data_order, ChaCha20_ctr32, bn_mul_mont, rsaz_*),
    # which is what "Native Redlib build failed with exit code 101" looks like.
    # Handing the compiler the same define it was meant to get compiles
    # BoringSSL's C fallbacks instead. It affects the build only.
    if (-not $env:CL) {
      $env:CL = "-DOPENSSL_NO_ASM"
      Write-Host "  (building with CL=-DOPENSSL_NO_ASM: see the note in this script)"
    }
    exit (Invoke-SkillScript -Name "setup_redlib_windows.ps1" -ExtraArgs @())
  }
}
