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

  What it does when the app port is down right after a boot, asked and answered
  because the 2026-09-25 boot exposed it (the answer used to be: "restarts the
  start script, detached, and gives it 45 seconds"):

  * Postgres is checked FIRST, and the app is not touched at all when 5433 is
    down. No retry count for Postgres: pg_ctl is started once and the port is
    watched for three minutes.
  * Then the port, then a real HTTP 200 -- a socket is not a paper.
  * Then the logon task's own result, from Get-ScheduledTaskInfo. If that task
    ran less than three minutes ago and failed, this run is inside the BOOT
    GRACE: it logs the failure and leaves the start alone, because the logon
    task may still be in Postgres recovery and three migrate attempts.
  * 267009 (SCHED_S_TASK_RUNNING) is not a failure -- it is the task still
    being in progress, which is exactly what the reboot test of 2026-09-25 did
    not account for: it read the start task's result mid-run, called it failed,
    and the run reported a fault that had not happened. It is treated as
    running, and the log says the start is still waiting for the database.
  * Outside the grace, with the task's last result non-zero, it runs the TASK
    itself -- Assert-TownReporterTaskOwnership, then Start-ScheduledTask --
    never a second copy of the start script, and never a second copy of the app.
    That is one repair path or the other, chosen by the task's own result.
  * Otherwise (no task record, a task that has never run, or a good task result
    with the app still down) it starts the start script detached, as before.
  * Then it waits for a real 200: 45 seconds on the script path, five minutes on
    the task path, because the task does its own DB wait and migrate retries.
  * No max tries. The watchdog runs every five minutes and each run is
    independent; a repair that needs to happen three times to stick will happen
    three times. What it will NOT do is fire again during the grace window.

  This is only why it acts. The reason the paper did not come back on
  2026-09-25 is the start path itself, and that is fixed in
  ops\lib-migrate.ps1.

  It also keeps two optional services alive, and keeps them separate from the
  paper. Redlib (the Reddit reader) and Ollama (the first Automatic rung's
  model server) are each started if down and never started, stopped or
  restarted because of, or as a reason to touch, the app: both sections run
  inside their own try/catch, both are skipped in test mode, and neither is
  added to `repaired` -- their starts are detached and a run cannot yet say
  they worked. Both are described in ops\lib-redlib.ps1 and ops\lib-ollama.ps1.

  The staged copy (the test copy on 3100) is the third thing it keeps alive,
  and the newest. ops\stage.ps1 restores a backup into townreporter_dev,
  builds, and starts the built server on 3100 for a walkthrough; the database
  and the build survive a reboot and the server does not, so before this the
  only way back after a reboot was to run the whole restore again. It is
  start-only -- ops\start-stage.ps1 -- and it starts nothing unless the paper
  is healthy, the staged port is free, and thirty minutes have passed since
  the last attempt. Same shape as the other two optional services: its own
  try/catch, never added to `repaired`, and nothing staged says nothing at
  all. The decision lives in ops\lib-stage.ps1; the section below says why.

  It is also the clock for the nightly backup and the alert check, and for one
  reason: the owner is shrinking programs, not adding them. This file already
  runs every five minutes, so "is a backup due" and "has anything been wrong
  for ten minutes" are two more questions it asks rather than two more
  scheduled tasks on the machine.

  * Nightly backup (ops\lib-backup.ps1). After 2 AM, with the newest backup
    older than 20 hours, and only when no editor job is running, it takes one
    and copies it to the other drive. The rule lives in the library, the same
    function promote.ps1 and ops\backup.ps1 call, so there is one backup path
    and not three. A night whose dump FAILED is not retried every five
    minutes: thirty minutes of quiet follows a failure, which is the one case
    where a retry loop would write real gigabytes over and over.
  * Alerts (ops\lib-alert.ps1). The paper, the public site, the daily scan and
    the three backup conditions, evaluated against the same facts this run
    already gathered, plus logs\alerts.json for the Control page's Attention
    card, a toast, and -- only if the owner sets ALERT_NTFY_TOPIC in .env -- a
    phone push. Off by default; with no topic set nothing here opens a socket.

  Both sections are skipped in test mode ($env:WATCHDOG_TEST_MODE = '1', which
  the CI recovery job sets): a runner has no real Postgres to dump and no
  business writing alerts from a disposable instance.

  ASCII only, on purpose. The first version used em-dashes in its log messages;
  Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so those lines
  came out as mojibake and truncated mid-message. A log nobody can read is the
  same as no log.

  Every decision is logged with the value it was based on. The first version
  wrote "app DOWN" and nothing else, which was indistinguishable from a broken
  probe -- and that is exactly what it turned out to be.

  TEST-003: seams, each an env var that defaults to the exact value the
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
    WATCHDOG_STAGE_APP   - checkout whose staged copy this run may start
                            (default: this checkout, same as always). Honored
                            ONLY when WATCHDOG_TEST_MODE=1, so a stray value
                            on the live machine cannot point this at another
                            directory; lib-ownership.ps1 validates it and
                            refuses the run rather than starting anything from
                            a path it has not checked.
#>

. (Join-Path $PSScriptRoot "lib-port.ps1")
. (Join-Path $PSScriptRoot "lib-ownership.ps1")
Assert-TownReporterLegacyOwnership -Watchdog
$ErrorActionPreference = "Stop"
if ($env:WATCHDOG_APP_PORT) { $port = $env:WATCHDOG_APP_PORT }
$pgPort = if ($env:WATCHDOG_PG_PORT) { $env:WATCHDOG_PG_PORT } else { "5433" }
if ($OwnedPgPort) { $pgPort = [string]$OwnedPgPort }
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
  if ($env:WATCHDOG_TEST_MODE -eq '1') { throw 'Disposable PostgreSQL probe is down. Test mode never starts a real cluster.' }
  Write-Log "postgres: no listener on $pgPort, starting"
  $bin  = $OwnedPgBin
  $data = $OwnedPgData
  $pgLog = Join-Path $OwnedPgData 'townreporter-postgres.log'
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
      if ($env:WATCHDOG_TEST_MODE -ne '1' -and !($p.CommandLine -replace '/', '\').Contains((Join-Path $app '.output\server\index.mjs'))) { throw 'Port owner is not this exact checkout; refusing repair.' }
      Write-Log "app: stopping stale PID $owner on port $port"
      Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    }
    <#
      Before repairing, ask whether the logon task is still working -- and if
      it is the thing that FAILED, run that task rather than a second copy of
      its script.

      This is the 2026-09-25 boot. The logon task ran at 20:01, died inside
      migrate (see ops\lib-migrate.ps1 for why), and left the site on 502. This
      watchdog noticed on its next run and did the only thing it knew: started
      start-townreporter.ps1 again, detached, and watched it 45 seconds later.
      That script died at exactly the same line, so the repair failed the same
      way every five minutes for as long as nobody looked, and the log read
      "FAILED to come up healthy" with no hint that the start path itself was
      the fault. Two things were missing: a reason to wait, and a repair that
      reports the task's own result.

      The wait: a cold boot spends a minute or more in Postgres crash recovery
      and three migrate attempts. Repairing a start that is already in progress
      is how a good boot gets trampled, so for three minutes after the task last
      ran this run leaves its start alone and says so.

      The repair: the registered task, not a detached copy of its script. The
      task is the ownership-checked entry point the logon and the operator both
      use, Assert-TownReporterTaskOwnership proves it points at THIS checkout,
      and running it makes its own LastTaskResult the receipt for this repair.
      Never both -- one path or the other.

      Test mode never reaches here: the seam points the app port at a
      disposable instance, and the real task starts the real paper.
    #>
    $startTaskName = 'TownReporter'
    $startInfo = Get-ScheduledTaskInfo -TaskName $startTaskName -ErrorAction SilentlyContinue
    # Never run at all is not a failure: LastTaskResult for a task that has not
    # run yet is 0x41303 (267009), which would otherwise read as a fault and put
    # a machine whose paper was started by hand into the grace branch forever.
    $startHasRun = [bool]($startInfo -and $startInfo.LastRunTime -and $startInfo.LastRunTime.Year -gt 1900)
    # 267009 is SCHED_S_TASK_RUNNING, not a fault: the task is STILL RUNNING.
    # The reboot test of 2026-09-25 caught the watchdog asking about a start
    # that was in the middle of Postgres recovery, reading 267009, calling it
    # failed and logging a repair it had not needed. Both 267009 cases -- a task
    # that has never run, and a task running right now -- mean "the start is
    # somewhere else"; neither is this run's to repair. Kept as a separate
    # variable rather than folded into the check below so the log can say which
    # of the two it saw.
    $startRunning = [bool]($startHasRun -and $startInfo.LastTaskResult -eq 267009)
    $startFailed = [bool]($startHasRun -and $startInfo.LastTaskResult -ne 0 -and -not $startRunning)
    $startAge = -1
    if ($startHasRun) { $startAge = [int]((Get-Date) - $startInfo.LastRunTime).TotalSeconds }
    $runTheTask = ($startFailed -and $startAge -ge 180 -and $env:WATCHDOG_TEST_MODE -ne '1')

    # Five minutes, not forty-five seconds, on the task path: that task has its
    # own DB wait (up to three minutes) and three migrate attempts to get
    # through, and calling it failed while it is still working is how the
    # watchdog would log a FAILED that never happened. The scheduled task skips
    # a run while one is active, so waiting here delays the next run rather than
    # stacking one on top of it.
    $verifySeconds = if ($runTheTask) { 300 } else { 45 }

    # Did this run actually try to start anything? The two repair paths below
    # do; the two wait-only paths (267009 still running, and the boot grace)
    # deliberately do not. It decides the failure line further down, which on
    # 2026-09-25 said "FAILED to come up healthy ... within 45s of starting it"
    # about a run that had started nothing at all.
    $startAttempted = $false

    if ($runTheTask) {
      Write-Log "app: the $startTaskName task last exited $($startInfo.LastTaskResult) $startAge second(s) ago; running the task itself"
      $startAttempted = $true
      try {
        Assert-TownReporterTaskOwnership $startTaskName 'start-townreporter.ps1'
        Start-ScheduledTask -TaskName $startTaskName
      } catch {
        Write-Log "app: running the $startTaskName task failed: $($_.Exception.Message)"
      }
    } elseif ($startRunning) {
      # 267009. The task is in progress right now -- a cold boot spends a minute
      # or more in Postgres recovery and three migrate attempts. Nothing to
      # repair and nothing to report as broken; the next run will ask again.
      Write-Log "app: the $startTaskName task has been running for $startAge second(s); start still running (waiting for the database)"
    } elseif ($startFailed) {
      Write-Log "app: the $startTaskName task failed $startAge second(s) ago; inside the three-minute boot grace, leaving its start alone"
    } else {
      <#
        Launch the start script as a DETACHED process, not with `&`.

        Called inline, the server it spawns inherits this script's console
        handles, so the watchdog never returns -- it sits holding the pipe for as
        long as the app runs. The scheduled task is set to skip a new run while
        one is active, so a single hung run silently ends the watching. Found by
        killing the app and watching the repair itself hang for seven minutes.

        Detached, the watchdog only polls the port and exits.
      #>
      $startAttempted = $true
      try {
        $shell = (Get-Command pwsh -ErrorAction SilentlyContinue)
        $exe = if ($shell) { $shell.Source } else { "powershell.exe" }
        Start-Process -FilePath $exe `
          -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", `
                        "-File", $startScript `
          -WindowStyle Hidden
      } catch {
        Write-Log "app: start failed: $($_.Exception.Message)"
      }
    }

    <#
      Verify the app actually answers on 127.0.0.1, not just that a socket is
      listening: a listener with no page behind it, or one on the wrong address
      family, is not a repair. Explicit FAILED on the way out either way -- a
      silent "did not repair" reads the same as no check at all, which is
      exactly how this app's port check went blind to an IPv6-only foreign
      listener before.
    #>
    $repairedOk = $false
    for ($i = 0; $i -lt $verifySeconds; $i++) {
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
    } elseif ($startAttempted) {
      Write-Log "app: FAILED to come up healthy on 127.0.0.1:$port within ${verifySeconds}s of starting it"
      if ($runTheTask) { Write-Log "app: the $startTaskName task is what was run; its own log is townreporter.log and its result is $((Get-ScheduledTaskInfo -TaskName $startTaskName -ErrorAction SilentlyContinue).LastTaskResult)" }
    } else {
      # Nothing was started, on purpose, so there is no repair to call failed.
      # Say which of the two waits this was: the wording is the whole point of
      # the fix, because "FAILED" here was a lie on the 2026-09-25 reboot test.
      $whyWait = if ($startRunning) { 'start still running (waiting for the database)' }
        else { "the $startTaskName task failed $startAge second(s) ago and this run is inside the three-minute boot grace" }
      Write-Log "app: not answering yet, and no repair was attempted -- $whyWait"
    }
  }
}

# A repair that just answered 200 is a paper that is up. $appHealthy was
# measured BEFORE the repair, so without this line the alert section further
# down would report a paper that this very run had already brought back -- and
# would be the only part of the log that disagreed with the "repaired: app"
# line. The verify loop above is the evidence: it is a real HTTP 200.
if ($repaired -contains 'app') { $appHealthy = $true }

# --- Reddit reader (Redlib) -----------------------------------------------
<#
  Optional, and treated as optional.

  The desk reads a subreddit through Reddit's .rss when Redlib is down and says
  so in the source text (src\lib\news\reddit.server.ts), so this section starts
  Redlib and reports it -- it never restarts the paper, never stops the paper,
  and never lets a Redlib failure reach anything above it. Every path is inside
  the try/catch; the only thing that leaves this block is a log line.

  Start is non-blocking (lib-redlib.ps1 Start-RedlibIfDown spawns the skill's
  start script detached), because that script waits for Redlib to answer Reddit
  and the watchdog's real job is the paper. The next run a few minutes later
  reports whether it came up.

  Skipped in test mode: a CI runner has no Redlib and no business starting one.
#>
if ($env:WATCHDOG_TEST_MODE -ne '1') {
  try {
    . (Join-Path $PSScriptRoot "lib-redlib.ps1")
    $redlibSwitch = Get-RedlibOffSwitch -EnvFile (Join-Path $app ".env")
    $redlibState = Get-RedlibState -EnvFile (Join-Path $app ".env")
    $redlibAction = Start-RedlibIfDown -OffSwitch $redlibSwitch -EnvFile (Join-Path $app ".env")
    switch ($redlibAction) {
      'up'      { Write-Log "redlib: up (state=$redlibState)" }
      # Deliberately NOT added to $repaired: the start is detached, so this run
      # cannot yet say it worked. The next run's "redlib: up" is the receipt.
      'started' { Write-Log "redlib: not answering (state=$redlibState), starting it" }
      # The wording is lib-redlib.ps1's, because "absent" has two causes and
      # this log is where the difference was invisible on 2026-09-25: every five
      # minutes it said "not installed here" while Redlib was running, installed
      # inside an app sandbox that Task Scheduler cannot look into.
      'absent'  { Write-Log "redlib: $(Get-RedlibAbsenceNote)" }
      'off'     { Write-Log "redlib: switched off by TOWNREPORTER_REDLIB=0; leaving it alone" }
    }
  } catch {
    Write-Log "redlib: check failed: $($_.Exception.Message) -- the paper is unaffected"
  }
}

# --- Ollama, the first Automatic rung's server -----------------------------
<#
  Also optional, and also never fatal.

  "Automatic" walks its local rungs in order (src\lib\news\provider-registry.ts
  `automaticLadder`): DeepSeek v4.1 Flash on Ollama, then Qwen 3.6 35B on LM
  Studio when that model is already loaded. Ollama being down is not the paper
  being down -- the ladder moves to the next rung -- so this section starts it
  and says what it found.

  Two things it never does, both in lib-ollama.ps1: it never stops or restarts
  Ollama (a model may be mid-draft on it; a wedged Ollama is the operator's to
  restart), and it never touches LM Studio or its models. There is no
  Stop-Process in lib-ollama.ps1 at all, so no path from here reaches a kill.

  Started the way the operator's own Startup shortcut starts it: the target is
  read out of Ollama.lnk, not restated here, so this cannot drift from the
  launch this machine is known to work with.
#>
if ($env:WATCHDOG_TEST_MODE -ne '1') {
  try {
    . (Join-Path $PSScriptRoot "lib-ollama.ps1")
    $ollamaSwitch = Read-OpsEnvValue -EnvFile (Join-Path $app ".env") -Name "TOWNREPORTER_OLLAMA" -Fallback '1'
    $ollamaState = Get-OllamaState
    $ollamaAction = Start-OllamaIfDown -OffSwitch $ollamaSwitch
    switch ($ollamaAction) {
      'up'       { Write-Log "ollama: ready (state=$ollamaState)" }
      'starting' { Write-Log "ollama: a process is up but not answering yet; leaving it alone" }
      'started'  { Write-Log "ollama: not running (state=$ollamaState), started it from the Startup shortcut" }
      'remote'   { Write-Log "ollama: the DeepSeek rung points off this machine; not ours to start" }
      'absent'   { Write-Log "ollama: not running and no Startup shortcut to start it from; the paper will use the next model" }
      'off'      { Write-Log "ollama: switched off by TOWNREPORTER_OLLAMA=0; leaving it alone" }
    }
  } catch {
    Write-Log "ollama: check failed: $($_.Exception.Message) -- the paper is unaffected"
  }
}

# --- The staged copy (the test copy on 3100) ------------------------------
<#
  Bring back the copy ops\stage.ps1 staged, after a reboot.

  ops\stage.ps1 restores a production backup into townreporter_dev, builds
  this checkout and starts the built server on 3100 for a manual walkthrough.
  The database and the build survive a reboot; the running server does not.
  Before this section existed, a reboot during a walkthrough took the staged
  copy away and the only way back was the whole stage again -- drop the
  database, restore the backup, rebuild.

  Start-only, and ops\start-stage.ps1 is the whole of it: no restore, no
  build, no kill, nothing that touches the live paper. Three conditions, all
  required:

    * the paper is healthy ($appHealthy, measured above -- and set true by a
      repair this very run made). A paper that is down is the run's real
      problem; starting a second node against the same database while the
      paper is being repaired is not a repair.
    * the staged port has no listener at all. If something IS listening --
      a half-dead copy of the staged server, or another program -- nothing is
      started: the port is taken, this run will not kill for it, and
      ops\stage.ps1 -Stop is the operator's stop. lib-stage.ps1 logs which of
      the two it found.
    * at least thirty minutes since the last attempt (logs\stage-start.json,
      written below before the spawn and by ops\start-stage.ps1 after it). A
      staged copy that cannot come up -- a database that is not restored, a
      build from before the port was moved -- must not be retried every five
      minutes forever. The same back-off shape as the nightly backup's.

  Nothing staged is the ordinary state on a machine that has never staged, so
  that case says nothing at all -- the same reason the backup section is quiet
  when a backup is not due. The answer to "what is staged here?" lives in
  ops\stage.ps1 -Status, in ops\start-stage.ps1's own words, and on the
  Control page's 3100 card.

  WATCHDOG_STAGE_APP points the whole stage world (ops\.stage.json, the build,
  the log) somewhere other than this checkout, and is honored ONLY in test
  mode, so production cannot be redirected at another directory. Unset, it is
  this checkout -- which is where this machine's staged copy lives.

  Detached, like the other starts here: this run does not wait for it. Never
  added to $repaired for that reason -- this run cannot yet say it worked, and
  the next run's log line is the receipt. That is also why a failed start is
  not retried for thirty minutes: the next run is what would find out.
#>
if ($appHealthy) {
  try {
    . (Join-Path $PSScriptRoot "lib-stage.ps1")
    $stageApp = $app
    if ($env:WATCHDOG_TEST_MODE -eq '1' -and $env:WATCHDOG_STAGE_APP) { $stageApp = $env:WATCHDOG_STAGE_APP }
    $stage = Get-TownReporterStageInfo -App $stageApp -AppPort ([int]$port) -PgPort ([int]$pgPort)
    switch ($stage.Verdict) {
      'up'       { Write-Log "stage: the staged copy is up on $($stage.Port) (version $($stage.Version))" }
      'wedged'   { Write-Log "stage: $($stage.Reason)" }
      'starting' { Write-Log "stage: $($stage.Reason)" }
      'down' {
        $due = Test-TownReporterStageStartDue -App $stageApp -Minutes 30
        if (-not $due.Due) {
          Write-Log "stage: staged on $($stage.Port) and not answering, but $($due.Reason); leaving it for a later run"
        } else {
          # The attempt is recorded BEFORE the spawn, so the thirty-minute
          # floor holds even if this spawn dies on the next line, and so a
          # Control page press in between cannot start a second copy. -Watchdog
          # tells ops\start-stage.ps1 that the record it is about to read is
          # this write: without it the child reads its own caller's attempt as
          # an attempt in flight and declines -- which is exactly what happened
          # the first time this section ran against the harness.
          Save-TownReporterStageStartRecord -App $stageApp -Record ([pscustomobject]@{
            LastAttemptAt = (Get-TownReporterIsoTime)
            LastOutcome   = 'starting'
            LastReason    = 'the watchdog started it'
            LastPid       = ''
          })
          Write-Log "stage: staged on $($stage.Port) (version $($stage.Version)) and not answering ($($due.Reason)); starting it -- ops\start-stage.ps1 writes its own log to logs\stage-start.log"
          $shell = (Get-Command pwsh -ErrorAction SilentlyContinue)
          $stageShell = if ($shell) { $shell.Source } else { "powershell.exe" }
          Start-Process -FilePath $stageShell `
            -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", `
                          "-File", (Join-Path $stageApp "ops\start-stage.ps1"), "-Quiet", "-Watchdog" `
            -WindowStyle Hidden
        }
      }
      default {
        # 'none' with a state file present is the only thing left here: a
        # state file that names the paper's port, or one that cannot be read.
        # Worth a line. The ordinary "nothing staged here" is not.
        if ($stage.StateExists) { Write-Log "stage: $($stage.Reason)" }
      }
    }
  } catch {
    Write-Log "stage: check failed: $($_.Exception.Message) -- the paper is unaffected"
  }
}

# --- Tunnel ---------------------------------------------------------------
# @() around the query: with one match Get-CimInstance returns a bare object,
# and in Windows PowerShell that object is truthy but has no .Count -- the
# first version tested the raw result and decided the tunnel was down on every
# single run, restarting a task that was already running.
$tunnelProcs = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue)
if ($tunnelProcs.Count -eq 0 -and $env:WATCHDOG_TEST_MODE -ne '1') {
  Write-Log "tunnel: no cloudflared process, starting task"
  try {
    Assert-TownReporterTaskOwnership 'TownReporter Tunnel' 'run-tunnel.ps1'
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
#
# Its own $siteCode/$siteError, not the repair loop's $code: that variable is
# reused inside the app section, and a probe that reads someone else's answer is
# how the site alert would fire on a repair's status code.
$site = $env:PUBLIC_SITE_URL
if (-not $site) { $site = "https://townreporter.org" }
$siteCode = 0
$siteError = ""
try {
  $siteCode = (Invoke-WebRequest $site -UseBasicParsing -TimeoutSec 30).StatusCode
  if ($siteCode -ne 200) { Write-Log "public: $site answered $siteCode" }
} catch {
  $siteError = $_.Exception.Message
  Write-Log "public: $site unreachable: $siteError"
}
$siteHealthy = ($siteCode -eq 200)

# --- Nightly backup -------------------------------------------------------
<#
  One backup a night, and this file is the clock because the owner is shrinking
  programs rather than adding them: the paper's own watchdog already runs every
  five minutes, so "is a backup due" is one more question it asks instead of one
  more scheduled task on the machine.

  The rule and the work are the library's, not this file's. Test-TownReporterBackupDue
  is the 2 AM / 20 hour window; Invoke-TownReporterBackupRun is the SAME function
  promote.ps1 and the Control page's button call, in the same order, under the
  same lock -- so the nightly run cannot prune differently from the one a person
  presses, which is the bug that would never be found until the day it mattered.

  Two ways this run declines, both in plain words in the log:

    * an editor job is running -- the one moment a few hundred MB of pg_dump
      write against the same disk the desk is writing to is worth deferring, and
      the paper is minutes from a promotion that takes its own backup anyway.
      'unknown' (no psql, or Postgres not answering) is NOT a reason to skip:
      skipping on a question that could not be asked would mean one wrong psql
      path silently stops every backup on this machine for good.
    * the last attempt FAILED less than thirty minutes ago. The due rule reads
      the newest file, and a failed dump leaves no file, so without this a
      failure would be retried every five minutes all day long -- 288 attempts
      at real gigabytes each. lastError + lastAttemptAt are the library's own
      record of exactly that, written before it returned the failure.

  A successful backup needs no such guard: it makes the newest file fresh and
  the due rule goes quiet on its own.

  Skipped entirely in test mode: a CI runner has no real Postgres to dump, and
  5433 on this machine never means a runner's database.
#>
if ($env:WATCHDOG_TEST_MODE -ne '1') {
  try {
    . (Join-Path $PSScriptRoot "lib-backup.ps1")
    $backupDir = Get-TownReporterBackupDir -App $app
    $due = Test-TownReporterBackupDue -BackupDir $backupDir
    if (-not $due.Due) {
      # Not due is the ordinary answer five minutes at a time; saying so every
      # run would bury the runs that matter.
    } else {
      $stateNow = Get-TownReporterBackupState -App $app
      $lastAttemptFailed = [bool]($stateNow.lastError -and $stateNow.lastAttemptAt)
      $minutesSinceAttempt = -1
      if ($lastAttemptFailed) {
        try {
          $attemptedAt = [datetime]::Parse(
            $stateNow.lastAttemptAt,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
          $minutesSinceAttempt = [int]((Get-Date).ToUniversalTime() - $attemptedAt.ToUniversalTime()).TotalMinutes
        } catch {
          # An unreadable timestamp is not a reason to skip: attempt it, and the
          # attempt writes a fresh one either way.
          $minutesSinceAttempt = -1
        }
      }
      if ($lastAttemptFailed -and $minutesSinceAttempt -ge 0 -and $minutesSinceAttempt -lt 30) {
        Write-Log "backup: a backup is due, but the last attempt failed $minutesSinceAttempt minute(s) ago; waiting half an hour before trying again"
      } else {
        $desk = Test-TownReporterDeskBusy -App $app
        if ($desk -eq 'busy') {
          Write-Log "backup: a backup is due, but an editor job is running; leaving it for the next run"
        } else {
          Write-Log "backup: taking the nightly backup ($($due.Reason))"
          $run = Invoke-TownReporterBackupRun -App $app -LogFile (Join-Path $logDir "backup.log")
          foreach ($line in $run.Lines) { Write-Log "backup: $line" }
          if (-not $run.Ok) { Write-Log "backup: NOT good -- $($run.Reason)" }
        }
      }
    }
  } catch {
    # A backup that cannot run must not stop the paper being watched, and any
    # part of it that did run has already written its own state and log.
    Write-Log "backup: check failed: $($_.Exception.Message) -- the paper is unaffected"
  }
}

# --- Alerts ---------------------------------------------------------------
<#
  The owner's list, evaluated here because this is the only thing on the
  machine that runs often enough to notice "down for more than ten minutes":
  the paper, the public site, the daily scan, and the three backup conditions.

  Facts already measured above, not measured again: $appHealthy (and $appCode /
  $appError) from the app section, $siteHealthy / $siteError from the public
  probe, $pgUp from the Postgres section. The scan is one read-only SELECT
  through psql, the same query ops\control\last-scan.cjs asks, because an alert
  that only works when the thing that is broken is working is not an alert.

  Active = $null means "not evaluated this run" and it is load-bearing: the
  library leaves a condition it was not told about exactly as it found it, so a
  run that cannot read the database never CLEARS a scan alert it could not
  check. That is why Postgres being down sets scan-missing to $null rather than
  false.

  The channels are lib-alert.ps1's: logs\alerts.json for the Control page's
  Attention card, a toast, and ntfy only when ALERT_NTFY_TOPIC is set in .env.
  Each fires once when it starts and once when it clears; the state file is
  what remembers which, so a condition that stays broken does not re-alert every
  five minutes.
#>
if ($env:WATCHDOG_TEST_MODE -ne '1') {
  try {
    # Both libraries, not just the alert one: the backup conditions below read
    # the folder and the state with lib-backup.ps1's own functions, and this
    # section must not depend on the backup section above having run first --
    # that section is skipped in test mode and can throw on a bad folder.
    . (Join-Path $PSScriptRoot "lib-backup.ps1")
    . (Join-Path $PSScriptRoot "lib-alert.ps1")
    $envFile = Join-Path $app ".env"

    $conditions = @(
      @{ Id = 'paper-down'; Active = (-not $appHealthy); Detail = $(if ($appHealthy) { "the paper answered 200 on 127.0.0.1:$port" } else { "nothing answered 200 on 127.0.0.1:$port (status=$appCode error='$appError')" }) }
      @{ Id = 'site-down'; Active = (-not $siteHealthy); Detail = $(if ($siteHealthy) { "$site answered 200" } else { "$site did not answer 200 (status=$siteCode error='$siteError')" }) }
    )

    if ($pgUp) {
      $scan = Get-TownReporterScanState -App $app -PgPort ([int]$pgPort)
      $verdict = Test-TownReporterScanAlert -State $scan -Now (Get-Date)
      $conditions += @{ Id = 'scan-missing'; Active = $verdict.Active; Detail = $verdict.Detail }
    } else {
      $conditions += @{ Id = 'scan-missing'; Active = $null; Detail = 'Postgres is down, so the daily scan could not be read' }
    }

    # The three backup conditions, built by the library so this run, the manual
    # run and the Control page's button cannot disagree about whether the
    # backups are fine. Built from the folder, the state file and the drive
    # itself -- not from the backup section above, which is skipped in test mode
    # and can throw; a backup folder that cannot be listed must not take the
    # paper's own alerts down with it.
    #
    # Appended without @() on purpose: that function hands back an array, and
    # @() around it would append ONE item that IS the array of conditions. See
    # the note on it in lib-backup.ps1.
    $conditions += Get-TownReporterBackupAlertConditions -App $app -EnvFile $envFile -MinFreeGb 100 -Now (Get-Date)

    $alerts = Invoke-TownReporterAlertCheck -App $app -EnvFile $envFile -Conditions $conditions -Now (Get-Date)
    foreach ($e in $alerts.Events) {
      if ($e.Event -eq 'started') { Write-Log "alert: $($e.Alert.Message) -- $($e.Alert.Detail)" }
      else { Write-Log "alert cleared: $($e.Alert.Message)" }
    }
  } catch {
    Write-Log "alerts: check failed: $($_.Exception.Message) -- the paper is unaffected"
  }
}

if ($repaired.Count -gt 0) { Write-Log "repaired: $($repaired -join ', ')" }
