<#
  The local Redlib the desk reads Reddit threads through.

  Reddit's `.rss` gives a subreddit its posts, with truncated bodies and no
  comments. A local Redlib gives the desk the original post in full, the
  scores, and the replies -- which on a local subreddit is usually where the
  substance is. It is worth having up when the paper reads Reddit, and worth
  not depending on: src\lib\news\reddit.server.ts falls back to RSS alone and
  says so in the source text rather than pretending it read the thread.

  The installation is the reddit-search skill's, not ours. That skill builds
  Redlib from the pinned commit with native Rust/MSVC under
  %LOCALAPPDATA%\RedditSearch\Redlib and runs it loopback-only on 18080; this
  script only drives it from this repo, in the shape the other ops scripts
  use, so the operator does not have to remember where the skill lives.

  The skill's scripts need PowerShell 7 (`$IsWindows`); this repo's ops
  scripts are Windows PowerShell 5.1. So status is answered here directly,
  and everything that touches the install is forwarded to pwsh.

  Nothing here is started automatically. A Redlib left running is a process
  holding an upstream Reddit identity; start it when the desk needs it and
  stop it when it does not.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1              # status
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 start
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 check        # full usability test
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 setup        # build/install only
    powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 start -SkillRoot <path>

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet("status", "start", "stop", "check", "setup")]
  [string]$Action = "status",
  [string]$SkillRoot,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "RedditSearch\Redlib"),
  [int]$Port = 18080
)

$ErrorActionPreference = "Stop"
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
  & $pwsh @arguments
  return $LASTEXITCODE
}

function Get-Install {
  $configPath = Join-Path $InstallRoot "install.json"
  if (-not (Test-Path -LiteralPath $configPath)) { return $null }
  return (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json)
}

function Get-Running {
  param($Config)
  $pidPath = Join-Path $InstallRoot "redlib.pid"
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $pidValue = [int](Get-Content -Raw -LiteralPath $pidPath)
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  $expected = [IO.Path]::GetFullPath([string]$Config.executable)
  $actual = [IO.Path]::GetFullPath($process.MainModule.FileName)
  if ($actual -ne $expected) { return $null }
  return $pidValue
}

function Show-Status {
  $config = Get-Install
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
  $pidValue = Get-Running -Config $config
  if (-not $pidValue) {
    Write-Host "  [  DOWN  ] running            no process holding the recorded pid"
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
