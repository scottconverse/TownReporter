<#
  Keeps TownReporter reachable.

  Written after the paper was found offline with no warning: Cloudflare was
  answering 530 and cloudflared was simply not running. Its scheduled task was
  logon-triggered with a restart-on-failure rule, which does nothing when the
  process exits cleanly or the task is stopped by hand. Nothing watched, nothing
  logged, and the only way anyone would have learned the paper was down was by
  visiting it.

  Runs every few minutes. Each check is independent and each repair is the same
  idempotent start path used at logon, so a run against a healthy box does
  nothing at all.

  Deliberately does NOT restart the app when Postgres is down: bringing the app
  up against a dead database produces a site that answers 200 with no stories,
  which is worse than a site that is plainly unreachable.

  ASCII only, on purpose. The first version used em-dashes in its log messages;
  Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so those lines
  came out as mojibake and truncated mid-message. A log nobody can read is the
  same as no log.

  Every decision is logged with the value it was based on. The first version
  wrote "app DOWN" and nothing else, which was indistinguishable from a broken
  probe -- and that is exactly what it turned out to be.
#>

. (Join-Path $PSScriptRoot "lib-port.ps1")
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "watchdog.log"

if ((Test-Path $log) -and ((Get-Item $log).Length -gt 2MB)) {
  Move-Item $log (Join-Path $logDir "watchdog.prev.log") -Force
}

function Write-Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content $log -Encoding UTF8
}

function Test-Port($p) {
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

# --- Promote in progress? Stand down. --------------------------------------
# The v0.5.4 promote stopped the app to rebuild; this watchdog saw "app down"
# and started it 45 seconds BEFORE the build finished writing. The paper then
# served a half-written build: old pages in memory naming script files that no
# longer existed on disk, every client action dead, while the front page still
# answered 200. A repair fired mid-surgery is not a repair.
#
# promote.ps1 writes this marker before it stops anything and deletes it when
# its own verification passes. The age cap means a promote that DIES mid-run
# cannot silence the watchdog forever: after 30 minutes the guard lapses and
# normal repairs resume.
$promoteMarker = Join-Path $app "logs\promote-in-progress"
if (Test-Path $promoteMarker) {
  $ageMin = ((Get-Date) - (Get-Item $promoteMarker).LastWriteTime).TotalMinutes
  if ($ageMin -lt 30) {
    Write-Log ("promote in progress (marker {0:N1} min old): standing down" -f $ageMin)
    exit 0
  }
  Write-Log ("promote marker is {0:N1} min old -- treating the promote as dead and resuming" -f $ageMin)
  Remove-Item $promoteMarker -Force -ErrorAction SilentlyContinue
}

$repaired = @()

# --- Postgres -------------------------------------------------------------
# 5433, not the default: another Postgres that does not belong to this project
# owns 5432 on this machine.
$pgUp = Test-Port 5433
if (-not $pgUp) {
  Write-Log "postgres: no listener on 5433, starting"
  $bin  = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
  $data = "$env:USERPROFILE\scoop\persist\postgresql\data"
  $pgLog = "$env:USERPROFILE\scoop\persist\postgresql\pg.log"
  try {
    Start-Process -FilePath "$bin\pg_ctl.exe" `
      -ArgumentList "-D", "`"$data`"", "-l", "`"$pgLog`"", "start" -NoNewWindow
    # Three minutes, for the same reason as start-townreporter.ps1: crash
    # recovery after an unclean shutdown outran a thirty second wait on this
    # machine by twenty-three seconds.
    for ($i = 0; $i -lt 180 -and -not (Test-Port 5433); $i++) { Start-Sleep -Seconds 1 }
    $pgUp = Test-Port 5433
    if ($pgUp) { $repaired += "postgres" }
  } catch {
    Write-Log "postgres: start failed: $($_.Exception.Message)"
  }
}

# --- App ------------------------------------------------------------------
# A port being open is not enough: a node process can hold 3000 while serving
# errors. Ask for a real page.
$appPort = Test-Port $port
$appCode = 0
$appError = ""
if ($appPort) {
  try {
    $appCode = (Invoke-WebRequest "http://localhost:3000/" -UseBasicParsing -TimeoutSec 20).StatusCode
  } catch {
    $appError = $_.Exception.Message
  }
}
$appHealthy = ($appCode -eq 200)

if (-not $appHealthy) {
  Write-Log "app: port=$appPort status=$appCode error='$appError'"
  if (-not $pgUp) {
    Write-Log "app: postgres is down, not starting the app against a dead database"
  } else {
    # Clear a process holding the port but not serving, or the start script
    # no-ops on its own port check. Matched by command line, never by image
    # name: other node.exe processes on this machine belong to other software.
    $stale = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*.output/server/index.mjs*" })
    foreach ($p in $stale) {
      Write-Log "app: stopping stale PID $($p.ProcessId)"
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    <#
      Launch the start script as a DETACHED process, not with `&`.

      Called inline, the server it spawns inherits this script's console
      handles, so the watchdog never returns -- it sits holding the pipe for as
      long as the app runs. The scheduled task is set to skip a new run while
      one is active, so a single hung run silently ends the watching. Found by
      killing the app and watching the repair itself hang for seven minutes.

      Detached, the watchdog only polls the port and exits.
    #>
    try {
      $shell = (Get-Command pwsh -ErrorAction SilentlyContinue)
      $exe = if ($shell) { $shell.Source } else { "powershell.exe" }
      Start-Process -FilePath $exe `
        -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", `
                      "-File", (Join-Path $PSScriptRoot "start-townreporter.ps1") `
        -WindowStyle Hidden
      for ($i = 0; $i -lt 45 -and -not (Test-Port $port); $i++) { Start-Sleep -Seconds 1 }
      if (Test-Port $port) { $repaired += "app" } else { Write-Log "app: still no listener after start" }
    } catch {
      Write-Log "app: start failed: $($_.Exception.Message)"
    }
  }
}

# --- Tunnel ---------------------------------------------------------------
# @() around the query: with one match Get-CimInstance returns a bare object,
# and in Windows PowerShell that object is truthy but has no .Count -- the
# first version tested the raw result and decided the tunnel was down on every
# single run, restarting a task that was already running.
$tunnelProcs = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue)
if ($tunnelProcs.Count -eq 0) {
  Write-Log "tunnel: no cloudflared process, starting task"
  try {
    Start-ScheduledTask -TaskName "TownReporter Tunnel"
    Start-Sleep -Seconds 8
    $now = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue)
    if ($now.Count -gt 0) { $repaired += "tunnel" } else { Write-Log "tunnel: still not running after start" }
  } catch {
    Write-Log "tunnel: start failed: $($_.Exception.Message)"
  }
}

# --- Public reachability --------------------------------------------------
# The end a reader actually uses. A healthy app behind a tunnel that is up but
# not routing still means the paper is offline.
$site = $env:PUBLIC_SITE_URL
if (-not $site) { $site = "https://townreporter.org" }
try {
  $code = (Invoke-WebRequest $site -UseBasicParsing -TimeoutSec 30).StatusCode
  if ($code -ne 200) { Write-Log "public: $site answered $code" }
} catch {
  Write-Log "public: $site unreachable: $($_.Exception.Message)"
}

if ($repaired.Count -gt 0) { Write-Log "repaired: $($repaired -join ', ')" }
