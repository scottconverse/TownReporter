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

  TEST-003: three seams, each an env var that defaults to the exact value the
  live paper already used, so an unset environment produces byte-identical
  behavior to before this change. They exist so a CI runner can point the
  watchdog at a disposable app/Postgres pair instead of this machine's real
  ones -- the recovery story was covered only by static/parse tests, never by
  an actual kill-and-recover. Get these defaults wrong and the watchdog aims
  at the wrong socket on the machine that runs the live paper.
    WATCHDOG_APP_PORT    - port the app is checked/repaired on (default: the
                            .env-derived port from lib-port.ps1, same as always)
    WATCHDOG_PG_PORT     - port Postgres is checked/repaired on (default: 5433)
    WATCHDOG_START_SCRIPT - script used to (re)start the app (default:
                            start-townreporter.ps1, same as always)
#>

. (Join-Path $PSScriptRoot "lib-port.ps1")
$ErrorActionPreference = "Stop"
if ($env:WATCHDOG_APP_PORT) { $port = $env:WATCHDOG_APP_PORT }
$pgPort = if ($env:WATCHDOG_PG_PORT) { $env:WATCHDOG_PG_PORT } else { "5433" }
$startScript = if ($env:WATCHDOG_START_SCRIPT) { $env:WATCHDOG_START_SCRIPT } else { Join-Path $PSScriptRoot "start-townreporter.ps1" }
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
  # Postgres binds both address families, so an unfiltered check is fine
  # here -- kept only for the Postgres probes below, never the app's port.
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
# owns 5432 on this machine. (WATCHDOG_PG_PORT overrides this for a test run;
# see the header comment -- production never sets it, so this is 5433 there.)
$pgUp = Test-Port $pgPort
if (-not $pgUp) {
  Write-Log "postgres: no listener on $pgPort, starting"
  $bin  = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
  $data = "$env:USERPROFILE\scoop\persist\postgresql\data"
  $pgLog = "$env:USERPROFILE\scoop\persist\postgresql\pg.log"
  try {
    Start-Process -FilePath "$bin\pg_ctl.exe" `
      -ArgumentList "-D", "`"$data`"", "-l", "`"$pgLog`"", "start" -NoNewWindow
    # Three minutes, for the same reason as start-townreporter.ps1: crash
    # recovery after an unclean shutdown outran a thirty second wait on this
    # machine by twenty-three seconds.
    for ($i = 0; $i -lt 180 -and -not (Test-Port $pgPort); $i++) { Start-Sleep -Seconds 1 }
    $pgUp = Test-Port $pgPort
    if ($pgUp) { $repaired += "postgres" }
  } catch {
    Write-Log "postgres: start failed: $($_.Exception.Message)"
  }
}

# --- App ------------------------------------------------------------------
# A port being open is not enough: a node process can hold 3000 while serving
# errors. Ask for a real page.
#
# Test-TownReporterPort (lib-port.ps1), not the address-blind Test-Port: on
# 2026-09-02 an unrelated dev server held [::1]:$port (IPv6 only) while this
# app binds 127.0.0.1:$port (IPv4). The old unfiltered check saw a listener
# and concluded the paper was already up; it never got started and the site
# served 502 for ~25 minutes. localhost is avoided for the same reason -- it
# can resolve to ::1 and probe the wrong socket.
$appPort = Test-TownReporterPort $port
$appCode = 0
$appError = ""
if ($appPort) {
  try {
    $appCode = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 20).StatusCode
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
    # Clear a process holding THIS port but not serving, or the start script
    # no-ops on its own port check.
    #
    # Scoped to the port, not to every matching command line. The sweep used
    # to enumerate all node.exe whose command line contained
    # ".output/server/index.mjs" and kill every one -- which is every install
    # of this app on the machine, not just the one being repaired. On the
    # operator's box, where the live paper and a development copy run side by
    # side, an unhealthy app on one port would have taken the healthy one on
    # the other down with it, and pointing the WATCHDOG_APP_PORT seam at a
    # test instance would have killed the live paper outright.
    #
    # Both parts of the check still matter: the owner of the port, AND that
    # it is this app -- never an image-name match, because other node.exe
    # processes on this machine belong to other software.
    # Log an IPv6-only listener separately from a real (IPv4-family) holder:
    # it is a different program on a different address family and does not
    # block this app from starting, so it is neither stopped nor reported as
    # "held by PID X" the way a real collision is.
    $bindableOwners = Get-TownReporterPortOwner $port
    $otherListeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $bindableOwners -notcontains $_.OwningProcess })
    if ($bindableOwners.Count -eq 0 -and $otherListeners.Count -gt 0) {
      $o = $otherListeners[0]
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($o.OwningProcess)" -ErrorAction SilentlyContinue
      $name = if ($p) { $p.Name } else { "unknown" }
      Write-Log "app: port $port has an IPv6-only listener PID $($o.OwningProcess) ($name) from another program; it does not block the paper"
    }
    foreach ($owner in $bindableOwners) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      if ($p.Name -ne 'node.exe' -or $p.CommandLine -notlike "*.output/server/index.mjs*") {
        Write-Log "app: port $port is held by PID $owner ($($p.Name)), which is not this app -- not touching it"
        continue
      }
      Write-Log "app: stopping stale PID $owner on port $port"
      Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
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
                      "-File", $startScript `
        -WindowStyle Hidden
      <#
        Verify the app actually answers on 127.0.0.1, not just that a socket
        is listening: a listener with no page behind it, or one on the wrong
        address family, is not a repair. 45s budget, explicit FAILED on the
        way out either way -- a silent "did not repair" reads the same as no
        check at all, which is exactly how this app's port check went blind
        to an IPv6-only foreign listener before.
      #>
      $repairedOk = $false
      for ($i = 0; $i -lt 45; $i++) {
        if (Test-TownReporterPort $port) {
          try {
            $code = (Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5).StatusCode
            if ($code -eq 200) { $repairedOk = $true; break }
          } catch { }
        }
        Start-Sleep -Seconds 1
      }
      if ($repairedOk) {
        $repaired += "app"
      } else {
        Write-Log "app: FAILED to come up healthy on 127.0.0.1:$port within 45s of starting it"
      }
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
