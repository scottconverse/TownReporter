<#
  Starts TownReporter and the Postgres it depends on. Safe to run repeatedly:
  each step is a no-op when the thing is already up.

  Registered as a logon scheduled task by ops/install-tasks.ps1.

  Postgres lives on 5433, NOT the default 5432 - another Postgres that does not
  belong to this project already owns 5432 on this machine. Do not "fix" that by
  moving back; the split is what stops the desk writing to the wrong cluster.

  The order of the two waits, and why there are two, is in ops\lib-migrate.ps1.
  The short version: on 2026-09-25 this task ran at 20:01, logged its own start
  line, and then died on the first byte of stderr from migrate -- because
  `2>&1` under $ErrorActionPreference = "Stop" makes a native command's stderr
  TERMINATING in Windows PowerShell 5.1, and a Postgres that has opened its
  port but is still in crash recovery says "the database system is starting up"
  on stderr. A listening port is not a database. This script now waits for a
  query to be answered before migrating, then runs migrate through cmd.exe so
  its stderr cannot reach a PowerShell stream at all, retries it three times,
  and -- when it still cannot serve -- says so in plain words in the log and
  exits non-zero, which is the signal ops\watchdog.ps1 acts on.
#>

. (Join-Path $PSScriptRoot "lib-port.ps1")
. (Join-Path $PSScriptRoot "lib-ownership.ps1")
Assert-TownReporterLegacyOwnership
$ErrorActionPreference = "Stop"
$app  = Split-Path -Parent $PSScriptRoot
$bin  = $OwnedPgBin
$data = $OwnedPgData
$log  = Join-Path $OwnedPgData 'townreporter-postgres.log'

function Test-Port($p) {
  # Postgres binds both address families, so an unfiltered check is fine
  # here -- this is only ever used for 5433, never for the app's own port.
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port $OwnedPgPort)) {
  Start-Process -FilePath "$bin\pg_ctl.exe" `
    -ArgumentList "-D","`"$data`"","-l","`"$log`"","start" -NoNewWindow
  <#
    Wait up to three minutes, not thirty seconds.

    Measured on this machine after a reboot on 2026-08-29: the logon task ran
    at 17:40:15, gave up at 17:40:45, and Postgres finished crash recovery and
    accepted connections at 17:41:08 -- twenty-three seconds later. The task
    exited 1, the paper never started, and the site served 502 until someone
    noticed. Postgres logged an end-of-recovery checkpoint that alone took
    5.2 seconds; a cold boot with a dirty shutdown is simply slower than a
    start on a warm machine, which is where thirty seconds was chosen.

    The loop exits the moment the port answers, so a healthy machine pays
    nothing for the larger number.
  #>
  for ($i = 0; $i -lt 180 -and -not (Test-Port $OwnedPgPort); $i++) { Start-Sleep -Seconds 1 }
}
if (-not (Test-Port $OwnedPgPort)) { throw "Postgres did not come up on 5433" }

# Apply any migrations added since the last run, then serve.
Set-Location $app

<#
  Capture output to a file.

  The task runs hidden, so anything the app writes to stdout/stderr previously
  went nowhere. That was invisible right up until a scan misbehaved mid-run and
  there was nothing to read. Scan errors, failed fetches, model errors and the
  job drain all log here.

  Kept to the last ~5 MB: a busy desk is chatty and an unbounded log on the
  machine that also serves the paper is its own problem.
#>
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$appLog = Join-Path $logDir "townreporter.log"

if ((Test-Path $appLog) -and ((Get-Item $appLog).Length -gt 5MB)) {
  Move-Item $appLog (Join-Path $logDir "townreporter.prev.log") -Force
}

"=== started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Add-Content $appLog

<#
  Both waits, and the log lines that make a failed boot readable, live in
  ops\lib-migrate.ps1. They are in a file of their own so the recovery can be
  TESTED without a reboot and without a database: scripts\ops-scripts.test.mjs
  drives the real functions against a stub that refuses queries for a while and
  a migrate that fails twice, and checks that the script keeps going.

  Nothing below may be reached when either step fails: a paper served against a
  half-migrated schema is worse than a paper that is plainly not up, and the
  watchdog cannot tell the difference. Exit non-zero instead, so the task's own
  LastTaskResult says what happened.
#>
. (Join-Path $PSScriptRoot "lib-migrate.ps1")

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  "the paper was not started: node.exe is not on this machine's PATH." | Add-Content $appLog
  exit 1
}
$node = $nodeCommand.Source

$dbUrl = Get-TownReporterDatabaseUrl -App $app
if (-not (Wait-TownReporterDatabase -Bin $bin -ConnectionString $dbUrl -Log $appLog)) {
  "the paper was not started: Postgres is listening on $OwnedPgPort but would not answer a query. This is almost always crash recovery after an unclean shutdown; the next five-minute watchdog run will try again." | Add-Content $appLog
  exit 1
}
if (-not (Invoke-TownReporterMigrate -App $app -Log $appLog -Node $node)) {
  "the paper was not started: the database migrations did not apply after three attempts. Nothing about the app was touched." | Add-Content $appLog
  exit 1
}

<#
  2026-09-02 incident: an unrelated dev server held [::1]:$port (IPv6 only).
  A plain Test-Port saw a listener and never started the real app; the site
  served 502 for ~25 minutes. Test-TownReporterPort (lib-port.ps1) only
  counts a listener on an address this app can actually bind to, so an
  IPv6-only foreign listener no longer counts as "already up".
#>
if (-not (Test-TownReporterPort $port)) {
  $otherOwners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { (Get-TownReporterPortOwner $port) -notcontains $_.OwningProcess })
  if ($otherOwners.Count -gt 0) {
    $o = $otherOwners[0]
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($o.OwningProcess)" -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.Name } else { "unknown" }
    "port $port has an IPv6-only listener PID $($o.OwningProcess) ($name) from another program; it does not block the paper" | Add-Content $appLog
  }
  # Start-Process, not `| Add-Content`: a PowerShell pipeline holds an exclusive
  # write handle for as long as the app runs, so the log could not be read while
  # the thing you wanted to debug was happening. Redirected process handles allow
  # concurrent reads.
  #
  # node.exe directly rather than the `npm` shim - Start-Process cannot execute
  # a .cmd shim, and this is exactly what `npm start` runs anyway.
  "[app] starting the paper on port $port" | Add-Content $appLog
  Start-Process -FilePath $node `
    -ArgumentList "scripts/with-app-env.mjs","node",('"' + (Join-Path $app '.output\server\index.mjs') + '"') `
    -WorkingDirectory $app `
    -RedirectStandardOutput (Join-Path $logDir "app.out.log") `
    -RedirectStandardError  (Join-Path $logDir "app.err.log") `
    -NoNewWindow
}

<#
  The Reddit reader, if this machine has one.

  Started AFTER the paper, and started DETACHED: ops\redlib.ps1 forwards to the
  reddit-search skill's start script, which waits for Redlib to answer Reddit,
  and the paper must not be held behind an optional reader. The desk reads a
  subreddit through Reddit's .rss when Redlib is down and says so in the source
  text, so "down" here is a supported state, not a failure.

  Read-only when Redlib is already answering, and a no-op when it was never
  installed or the operator set TOWNREPORTER_REDLIB=0. The whole block is
  wrapped: nothing about an optional reader may fail the logon task, which is
  what actually brings the paper up.
#>
try {
  . (Join-Path $PSScriptRoot "lib-redlib.ps1")
  $redlib = Start-RedlibIfDown -OffSwitch (Get-RedlibOffSwitch -EnvFile (Join-Path $app ".env"))
  "redlib: $redlib" | Add-Content $appLog
} catch {
  "redlib: not started: $($_.Exception.Message)" | Add-Content $appLog
}

<#
  The line whose absence identified the 2026-09-25 failure.

  The log had "=== started 20:01 ===" and then nothing at all, and there was no
  way from the log alone to tell a script that died at migrate from one that ran
  to the end. This is written last, and only on the path that reaches the end.
#>
"=== start finished $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Add-Content $appLog
