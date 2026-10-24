<#
  ci-watchdog-start-guard.ps1 -- a start that is still starting is not killed,
  and a start that hangs is stopped and started again.

  The bug this proves: the watchdog's port-owner sweep stops whatever built
  server holds the app port BEFORE it asks whether a start is already in
  progress, so a slow start that already holds the port was killed and started
  over every five minutes. The fix is ops\lib-start-guard.ps1, used by
  ops\watchdog.ps1 before the sweep.

  A real slow start cannot be staged on this machine: the paper on 3000 belongs
  to the newsroom, Postgres on 5433 is not a test's, and the logon task starts
  the real app. So this builds a disposable world under the OS temp directory --
  a checkout with copies of the real ops\ files, a stub "build" that answers
  200 (or 503 for its first seconds, on demand), a stub Postgres listener, and
  a FAKE start script that lives only in the world (the real
  scripts\ci-watchdog-start.ps1 is not changed and is not used) -- and runs the
  REAL ops\watchdog.ps1 against it through the TEST-003 seams. Every port is
  picked free from the ephemeral range; cleanup stops only processes this run
  can identify as its own world's, by PID and never by image name.

  What it proves, in order:

    0. the decision itself (Get-TownReporterStartState), branch by branch,
       with fake inputs
    1. a start that is still starting, inside the deadline: a second run says
       so, stops nothing, starts nothing; then the app answers 200 and the
       marker is gone
    2. a start that already HOLDS the port and answers 503: two runs inside the
       deadline, and the server is not stopped
    3. a dead app with no marker: brought back, as today
    4. a start that hangs past the deadline: stopped by PID, started again, and
       the app comes back once the hang is gone
    5. stale markers -- a dead PID and a live PID running something else -- are
       treated as no start, and the unrelated process is not stopped
    6. a listener that misses ONE probe and answers the second (D283): the miss
       is logged with the disk queue length, the app is not stopped, and the
       server is still alive afterwards
    7. a listener that misses BOTH probes inside the wait (D283): it is repaired
       as before, and the "app: port=" line carries the disk queue length

  -RealDeadline runs the three acceptance scenarios at the real deadline
  (600 s, D267 -- read from Get-TownReporterStartDeadline, never typed here)
  instead (about seven minutes). CI never runs that mode.

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [switch]$RealDeadline
)

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:spawned = @()

function Say($message) { Write-Host $message }

function Check([string]$Name, [scriptblock]$Test) {
  try {
    if (& $Test) { Say "  ok   $Name" }
    else { Say "  FAIL $Name"; $script:failures++ }
  } catch {
    Say "  FAIL $Name -- $($_.Exception.Message)"
    $script:failures++
  }
}

# A port nothing is listening on, out of the ephemeral range, and never one of
# the ones this machine's real services own.
function Get-FreePort {
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $candidate = $listener.LocalEndpoint.Port
    $listener.Stop()
    if ($candidate -ge 1024 -and $candidate -ne 3000 -and $candidate -ne 3100 -and $candidate -ne 3400 -and $candidate -ne 5433 -and $candidate -ne 5434) { return $candidate }
  }
  throw 'could not find a free port in the ephemeral range.'
}

$root = [IO.Path]::GetFullPath($AppRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'ops\watchdog.ps1'))) {
  Say "no ops\watchdog.ps1 under $root"
  exit 1
}
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { Say 'node is not on PATH'; exit 1 }
$node = $nodeCommand.Source
$shellCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if (-not $shellCommand) { $shellCommand = Get-Command powershell -ErrorAction Stop }
$shell = $shellCommand.Source

$world = Join-Path ([IO.Path]::GetTempPath()) ("al-start-guard-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$app = Join-Path $world 'app'
$watchdogPath = Join-Path $app 'ops\watchdog.ps1'
$fakeStartPath = [IO.Path]::GetFullPath((Join-Path $app 'scripts\ci-watchdog-start.ps1'))
$markerPath = Join-Path $app 'logs\watchdog-start.json'
$logPath = Join-Path $app 'logs\watchdog.log'

# %LOCALAPPDATA% is pointed inside this world for the whole run: the watchdog's
# staged-copy section reads the machine-wide pointer from it, and a run on a
# machine that has ever staged a copy would otherwise report on that copy. The
# operator's own value goes back in `finally`.
$fakeLocalAppData = Join-Path $world 'localappdata'
$previousLocalAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = $fakeLocalAppData
New-Item -ItemType Directory -Force -Path (Join-Path $app 'ops'), (Join-Path $app 'scripts'), (Join-Path $app 'logs'), (Join-Path $app '.output\server') | Out-Null

foreach ($name in @('lib-port.ps1', 'lib-ownership.ps1', 'lib-start-guard.ps1', 'lib-stage.ps1', 'start-stage.ps1', 'watchdog.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root "ops\$name") -Destination (Join-Path $app "ops\$name")
}

"{ `"name`": `"townreporter`", `"version`": `"0.0.0`" }" | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding ASCII
New-Item -ItemType File -Force -Path (Join-Path $app '.env') | Out-Null

$appPort = Get-FreePort
$pgPort = Get-FreePort

@'
import http from "node:http";
const port = Number(process.env.PORT);
const mode = process.env.STUB_MODE || "";
const started = Date.now();
http.createServer((q, r) => {
  if (mode === "slow503" && Date.now() - started < 15000) {
    r.writeHead(503, { "content-type": "text/plain" });
    r.end("not answering yet\n");
    return;
  }
  r.writeHead(200, { "content-type": "text/plain" });
  r.end("disposable app\n");
})
  .listen(port, "127.0.0.1", () => console.log("stub app on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $app '.output\server\index.mjs') -Encoding ASCII

@'
import net from "node:net";
const port = Number(process.env.PORT);
net.createServer(() => {}).listen(port, "127.0.0.1", () => console.log("stub postgres on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $world 'stub-pg.mjs') -Encoding ASCII

# The world's start script. The real scripts\ci-watchdog-start.ps1 is not
# changed and is not used: this one reads FAKE_START_DELAY_SECONDS (a slow
# start) and FAKE_START_HANG=1 (a start that never launches anything), then
# launches the stub build detached and waits for it to answer, which is what a
# start script that is still starting looks like from the watchdog's side.
@'
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$port = if ($env:WATCHDOG_APP_PORT) { $env:WATCHDOG_APP_PORT } else { "3000" }
$env:PORT = $port
$env:HOST = "127.0.0.1"
if ($env:FAKE_START_HANG -eq "1") { while ($true) { Start-Sleep -Seconds 1 } }
$delay = 0
if ($env:FAKE_START_DELAY_SECONDS -match "^\d+$") { $delay = [int]$env:FAKE_START_DELAY_SECONDS }
if ($delay -gt 0) { Start-Sleep -Seconds $delay }
$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node `
  -ArgumentList ".output/server/index.mjs" `
  -WorkingDirectory $app `
  -RedirectStandardOutput (Join-Path $app "logs\fake-start.out.log") `
  -RedirectStandardError (Join-Path $app "logs\fake-start.err.log") `
  -WindowStyle Hidden
for ($i = 0; $i -lt 300; $i++) {
  try {
    if ((Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Seconds 1
}
'@ | Set-Content -LiteralPath $fakeStartPath -Encoding ASCII

function Start-Stub([string]$Script, [int]$Port, [string]$LogName) {
  $previous = $env:PORT
  $env:PORT = "$Port"
  try {
    $proc = Start-Process -FilePath $node -ArgumentList $Script -WorkingDirectory $world -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $world "$LogName.out") -RedirectStandardError (Join-Path $world "$LogName.err") -PassThru
    $script:spawned += $proc.Id
    return $proc.Id
  } finally {
    if ($previous) { $env:PORT = $previous } else { Remove-Item Env:\PORT -ErrorAction SilentlyContinue }
  }
}

function Wait-ForStub([int]$Port, [int]$ProcessId, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $false }
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Where-Object { [int]$_.OwningProcess -eq $ProcessId })
    if ($listeners.Count -gt 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

# --- the world's state -----------------------------------------------------

function Get-LogText {
  if (Test-Path -LiteralPath $logPath) { return (Get-Content -LiteralPath $logPath -Raw) }
  return ''
}

function Get-LogCount {
  if (Test-Path -LiteralPath $logPath) { return @(Get-Content -LiteralPath $logPath).Count }
  return 0
}

function Get-NewLog([int]$From) {
  if (-not (Test-Path -LiteralPath $logPath)) { return @() }
  $all = @(Get-Content -LiteralPath $logPath)
  if ($all.Count -le $From) { return @() }
  return @($all[$From..($all.Count - 1)])
}

function Read-Marker {
  if (-not (Test-Path -LiteralPath $markerPath)) { return $null }
  try { return (Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json) } catch { return $null }
}

function Write-Marker([int]$ProcessId, [string]$Script, [datetime]$StartedAt) {
  $doc = [pscustomobject]@{
    pid       = $ProcessId
    startedAt = $StartedAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    script    = $Script
  }
  [IO.File]::WriteAllText($markerPath, ($doc | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
}

function Remove-Marker {
  Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
}

function Wait-ForMarker([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $marker = Read-Marker
    if ($marker -and "$($marker.pid)" -match '^\d+$') { return $marker }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Wait-ForMarkerGone([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-Path -LiteralPath $markerPath)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Get-MarkerAgeSeconds($Marker) {
  if (-not $Marker) { return -1 }
  $started = [datetime]::Parse([string]$Marker.startedAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  return [int]((Get-Date) - $started).TotalSeconds
}

function Get-AppListenerPid {
  $owners = @(Get-NetTCPConnection -LocalPort $appPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -gt 0) { return [int]$owners[0] }
  return 0
}

function Wait-ForAppListener([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $owner = Get-AppListenerPid
    if ($owner -gt 0) { return $owner }
    Start-Sleep -Milliseconds 250
  }
  return 0
}

function Wait-ForApp([int]$Code, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Get-AppListenerPid -gt 0) {
      try {
        if ((Invoke-WebRequest "http://127.0.0.1:$appPort/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq $Code) { return $true }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Wait-ForLog([string]$Pattern, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-LogText) -match $Pattern) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

# Stops the stub app only. Its PID comes from the listener on this harness's
# own free port, inside this world's checkout -- not from an image name.
function Stop-App {
  for ($i = 0; $i -lt 40; $i++) {
    $owner = Get-AppListenerPid
    if ($owner -le 0) { return }
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 250
  }
}

# Every process whose command line names this world's fake start script. Used to
# count starts (never to stop anything outside this world).
function Get-FakeStartProcesses {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and (($_.CommandLine -replace '/', '\').IndexOf($fakeStartPath, [StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
}

function Invoke-Watchdog([string]$Label) {
  $script:runs++
  $out = Join-Path $world ("watchdog-run{0}.out" -f $script:runs)
  $before = Get-LogCount
  # Run it from the world's checkout, the way the scheduled task runs from its
  # own. The test seam WATCHDOG_START_SCRIPT is a RELATIVE path
  # ('scripts/ci-watchdog-start.ps1'), so this is also what lets the harness
  # run against a watchdog that does not yet resolve it against $app.
  Push-Location $app
  try {
    & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $watchdogPath *> $out
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($code -ne 0) {
    Say "  (watchdog run '$Label' exited $code; output follows)"
    if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out | ForEach-Object { Say "    $_" } }
  }
  $new = Get-NewLog $before
  Say "  -- watchdog run '$Label' (exit $code) said:"
  foreach ($line in $new) { Say "     $line" }
  return @{ Code = $code; Lines = $new }
}

function Start-WatchdogBackground([string]$Label) {
  $script:runs++
  $out = Join-Path $world ("watchdog-bg{0}.out" -f $script:runs)
  $err = Join-Path $world ("watchdog-bg{0}.err" -f $script:runs)
  $proc = Start-Process -FilePath $shell `
    -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", $watchdogPath `
    -WorkingDirectory $app `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $script:spawned += $proc.Id
  Say "  -- watchdog run '$Label' started in the background (PID $($proc.Id))"
  return $proc
}

function Wait-ForWatchdogExit($Process, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { return $true }
    Start-Sleep -Milliseconds 500
    $Process.Refresh()
  }
  return $Process.HasExited
}

function Set-TestEnv([hashtable]$Values) {
  foreach ($key in $Values.Keys) {
    if ($null -eq $Values[$key]) { Remove-Item "Env:\$key" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:\$key" $Values[$key] }
  }
}

# --- 0. the decision, with fake inputs ------------------------------------
# Get-TownReporterStartState is a decision over parameters, so every branch can
# be checked without a real slow start: a dead PID, a reused PID, a different
# script, both sides of the deadline, the task's 267009, and test mode.
function Get-StartStateUnitResults {
  $opsDir = Join-Path $app 'ops'
  return (& {
    param($OpsDir, $FakeScript)
    . (Join-Path $OpsDir 'lib-port.ps1')
    . (Join-Path $OpsDir 'lib-start-guard.ps1')
    $now = [datetime]'2026-10-24T12:00:00'
    $alive = [pscustomobject]@{ Name = 'pwsh.exe'; CommandLine = 'pwsh.exe -NoProfile -File "' + $FakeScript + '"' }
    $other = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe -e setTimeout(function(){}, 600000)' }
    $fresh = [pscustomobject]@{ Pid = 4242; StartedAt = $now.AddSeconds(-10); Script = $FakeScript }
    $old = [pscustomobject]@{ Pid = 4242; StartedAt = $now.AddSeconds(-400); Script = $FakeScript }
    $old300 = [pscustomobject]@{ Pid = 4242; StartedAt = $now.AddSeconds(-300); Script = $FakeScript }
    $wrong = [pscustomobject]@{ Pid = 4242; StartedAt = $now.AddSeconds(-10); Script = 'C:\somewhere\else.ps1' }
    [pscustomobject]@{
      NoSources = Get-TownReporterStartState -Marker $null -MarkerProcess $null -ExpectedScript $FakeScript -Deadline 150 -Now $now
      DeadMarker = Get-TownReporterStartState -Marker $fresh -MarkerProcess $null -ExpectedScript $FakeScript -Deadline 150 -Now $now
      ReusedMarker = Get-TownReporterStartState -Marker $fresh -MarkerProcess $other -ExpectedScript $FakeScript -Deadline 150 -Now $now
      WrongScript = Get-TownReporterStartState -Marker $wrong -MarkerProcess $alive -ExpectedScript $FakeScript -Deadline 150 -Now $now
      InProgress = Get-TownReporterStartState -Marker $fresh -MarkerProcess $alive -ExpectedScript $FakeScript -Deadline 150 -Now $now
      HungMarker = Get-TownReporterStartState -Marker $old -MarkerProcess $alive -ExpectedScript $FakeScript -Deadline 150 -Now $now
      # No -Deadline and not test mode: falls back to the constant (D267 = 600).
      DefaultDeadlineMarker = Get-TownReporterStartState -Marker $old300 -MarkerProcess $alive -ExpectedScript $FakeScript -Now $now
      TaskInProgress = Get-TownReporterStartState -Marker $null -MarkerProcess $null -ExpectedScript $FakeScript -TaskLastTaskResult 267009 -TaskLastRunTime $now.AddSeconds(-40) -Deadline 150 -Now $now
      TaskHung = Get-TownReporterStartState -Marker $null -MarkerProcess $null -ExpectedScript $FakeScript -TaskLastTaskResult 267009 -TaskLastRunTime $now.AddSeconds(-400) -Deadline 150 -Now $now
      TaskIgnoredInTestMode = Get-TownReporterStartState -Marker $null -MarkerProcess $null -ExpectedScript $FakeScript -TaskLastTaskResult 267009 -TaskLastRunTime $now.AddSeconds(-40) -Deadline 150 -TestMode $true -Now $now
      TaskNotRunning = Get-TownReporterStartState -Marker $null -MarkerProcess $null -ExpectedScript $FakeScript -TaskLastTaskResult 0 -TaskLastRunTime $now.AddSeconds(-40) -Deadline 150 -Now $now
    }
  } $opsDir $fakeStartPath)
}

# The real deadline, read from the guard itself (lib-start-guard.ps1), so the
# acceptance titles and log-text matches follow the constant (D267) instead of
# a number typed here.
function Get-RealStartDeadline {
  $opsDir = Join-Path $app 'ops'
  return [int](& { param($OpsDir) . (Join-Path $OpsDir 'lib-start-guard.ps1'); Get-TownReporterStartDeadline } $opsDir)
}

$stubPgPid = Start-Stub (Join-Path $world 'stub-pg.mjs') $pgPort 'stub-pg'

$script:runs = 0
$startDeadlineSeconds = if ($RealDeadline) { Get-RealStartDeadline } else { 0 }
Say "start guard harness: $world"
Say "  disposable app $appPort, stub postgres $pgPort, deadline override $(if ($RealDeadline) { "UNSET -- the real $startDeadlineSeconds s" } else { 'small, test mode only' })"

$env:WATCHDOG_TEST_MODE = '1'
$env:WATCHDOG_APP_PORT = "$appPort"
$env:WATCHDOG_PG_PORT = "$pgPort"
$env:WATCHDOG_START_SCRIPT = 'scripts/ci-watchdog-start.ps1'
$env:WATCHDOG_STAGE_APP = $app
$env:PUBLIC_SITE_URL = "http://127.0.0.1:$appPort/"
$deadline = 20
if ($RealDeadline) { Remove-Item Env:\WATCHDOG_START_DEADLINE_SECONDS -ErrorAction SilentlyContinue }
else { $env:WATCHDOG_START_DEADLINE_SECONDS = "$deadline" }
# D283: two probes this far apart. Two seconds keeps cases 1-5 at their old
# timing; the reprobe cases set their own value for the run they need.
$env:WATCHDOG_REPROBE_SECONDS = '2'
Set-TestEnv @{ FAKE_START_DELAY_SECONDS = $null; FAKE_START_HANG = $null; STUB_MODE = $null }

try {
  if (-not (Wait-ForStub $pgPort $stubPgPid 30)) {
    $details = @((Get-Content -LiteralPath (Join-Path $world 'stub-pg.out') -Raw -ErrorAction SilentlyContinue),
      (Get-Content -LiteralPath (Join-Path $world 'stub-pg.err') -Raw -ErrorAction SilentlyContinue)) -join ' '
    throw "The disposable PostgreSQL listener did not start on $pgPort within 30 seconds (PID $stubPgPid). $details"
  }

  Say ''
  Say '0. the decision itself, with fake inputs'
  $unit = Get-StartStateUnitResults
  Check 'no marker and no task is no start in progress' {
    $unit.NoSources.State -eq 'none' -and $unit.NoSources.Source -eq 'none' -and $unit.NoSources.AgeSeconds -eq -1
  }
  Check 'a marker naming a dead PID is no start in progress' { $unit.DeadMarker.State -eq 'none' }
  Check 'a marker naming a reused PID (another program) is no start in progress' { $unit.ReusedMarker.State -eq 'none' }
  Check 'a marker naming a different script is no start in progress' { $unit.WrongScript.State -eq 'none' }
  Check 'a trusted marker under the deadline is in progress, by marker, with its age' {
    $unit.InProgress.State -eq 'in-progress' -and $unit.InProgress.Source -eq 'marker' -and $unit.InProgress.AgeSeconds -eq 10
  }
  Check 'a trusted marker past the deadline is hung' { $unit.HungMarker.State -eq 'hung' -and $unit.HungMarker.Source -eq 'marker' }
  Check 'with no -Deadline and not test mode a 300 s marker start is in progress (the constant is 600, not 150)' {
    $unit.DefaultDeadlineMarker.State -eq 'in-progress' -and $unit.DefaultDeadlineMarker.Source -eq 'marker' -and $unit.DefaultDeadlineMarker.AgeSeconds -eq 300
  }
  Check 'the task still running under the deadline is in progress, by task' {
    $unit.TaskInProgress.State -eq 'in-progress' -and $unit.TaskInProgress.Source -eq 'task'
  }
  Check 'the task still running past the deadline is hung' { $unit.TaskHung.State -eq 'hung' -and $unit.TaskHung.Source -eq 'task' }
  Check 'test mode ignores the real task' { $unit.TaskIgnoredInTestMode.State -eq 'none' }
  Check 'a task that is not running is no start in progress' { $unit.TaskNotRunning.State -eq 'none' }

  if ($RealDeadline) {
    # --- the three acceptance scenarios, at the real deadline (D267) ---------
    Say ''
    Say 'D1. a start delayed 90 s, runs at launch, about 60 s and about 120 s'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '90'; FAKE_START_HANG = $null; STUB_MODE = $null }
    $bg = Start-WatchdogBackground 'launch'
    $marker = Wait-ForMarker 20
    Check 'the repair wrote a marker' { $marker -ne $null }
    $startPid = if ($marker) { [int]$marker.pid } else { 0 }
    Start-Sleep -Seconds 60
    $run = Invoke-Watchdog 'about 60 s'
    Check 'at 60 s it said the start is still running and stopped nothing' {
      $run.Code -eq 0 -and ($run.Lines -join "`n") -match "a start is still running \(marker, PID $startPid, \d+ s of $startDeadlineSeconds s\)"
    }
    $starts = @(Get-FakeStartProcesses)
    Check "exactly one start is running (found $($starts.Count))" { $starts.Count -eq 1 }
    Start-Sleep -Seconds 60
    $run = Invoke-Watchdog 'about 120 s'
    Check 'at 120 s nothing had been stopped and no second start was launched' {
      $run.Code -eq 0 -and -not ((Get-LogText) -match 'stopping stale PID') -and @(Get-FakeStartProcesses).Count -le 1
    }
    Check 'the app answered 200' { Wait-ForApp 200 90 }
    Check 'the background run finished' { Wait-ForWatchdogExit $bg 120 }

    Say ''
    Say 'D2. a dead app with no marker'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = $null }
    $run = Invoke-Watchdog 'dead app'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'the app answered 200 again' { Wait-ForApp 200 60 }
    Check 'it reported the repair' { ($run.Lines -join "`n") -match 'repaired: app' }

    Say ''
    Say "D3. a start hung past $startDeadlineSeconds s"
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = '1'; STUB_MODE = $null }
    $bg = Start-WatchdogBackground 'launch a hung start'
    $marker = Wait-ForMarker 20
    $hungPid = if ($marker) { [int]$marker.pid } else { 0 }
    Check 'the repair wrote a marker for the hung start' { $hungPid -gt 0 }
    Start-Sleep -Seconds ($startDeadlineSeconds + 10)
    # Clear the hang BEFORE the run that stops it: the watchdog inherits this
    # environment, so the replacement start it launches after the stop comes
    # up. That is ONE deadline crossing, and this run checks the new start.
    Set-TestEnv @{ FAKE_START_HANG = $null }
    $run = Invoke-Watchdog 'past the deadline'
    Check 'it said the start hung, with both ages' {
      ($run.Lines -join "`n") -match "the start recorded in the marker \(PID $hungPid\) has been running \d+ s of $startDeadlineSeconds s"
    }
    Check 'it stopped the hung start' { -not [bool](Get-Process -Id $hungPid -ErrorAction SilentlyContinue) }
    # The replacement start comes up during this same run, and a start that
    # answers 200 clears its marker -- so the marker is gone, or (if the start
    # is slower) it names the new PID. What must not survive is the hung PID.
    $newMarker = Read-Marker
    Check 'the marker no longer names the hung start' {
      $null -eq $newMarker -or [int]$newMarker.pid -ne $hungPid
    }
    Check 'the background run finished' { Wait-ForWatchdogExit $bg 120 }
    Check 'the new start came up' { Wait-ForApp 200 90 }
  } else {
    # --- 1. a slow start that is still starting -----------------------------
    Say ''
    Say '1. a slow start, inside the deadline'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '10'; FAKE_START_HANG = $null; STUB_MODE = $null }
    Check 'nothing is listening before the run' { (Get-AppListenerPid) -eq 0 }
    $bg = Start-WatchdogBackground 'launch'
    $marker = Wait-ForMarker 20
    Check 'the repair wrote a marker with the start script PID and its full path' {
      $marker -and [int]$marker.pid -gt 0 -and
        (([IO.Path]::GetFullPath([string]$marker.script) -replace '/', '\') -eq $fakeStartPath)
    }
    $startPid = if ($marker) { [int]$marker.pid } else { 0 }
    Start-Sleep -Seconds 5
    $run = Invoke-Watchdog 'still starting'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'it said a start is still running, with the marker, the PID and the deadline' {
      ($run.Lines -join "`n") -match "a start is still running \(marker, PID $startPid, \d+ s of $deadline s\); not stopping anything"
    }
    Check 'it stopped nothing' { -not ((Get-LogText) -match 'stopping stale PID') }
    $starts = @(Get-FakeStartProcesses)
    Check "it started nothing -- exactly one start process (found $($starts.Count))" { $starts.Count -eq 1 }
    Check 'the start process is still alive' { $startPid -gt 0 -and [bool](Get-Process -Id $startPid -ErrorAction SilentlyContinue) }
    Check 'the app answered 200' { Wait-ForApp 200 90 }
    Check 'the background run finished' { Wait-ForWatchdogExit $bg 120 }
    Check 'the marker is gone once the app answered' { Wait-ForMarkerGone 20 }

    # --- 2. a start that already holds the port ------------------------------
    Say ''
    Say '2. a start that already holds the port and is not answering yet'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = 'slow503' }
    Check 'nothing is listening before the run' { (Get-AppListenerPid) -eq 0 }
    $bg = Start-WatchdogBackground 'launch onto a 503'
    $serverPid = Wait-ForAppListener 30
    Check 'the start put a listener on the port' { $serverPid -gt 0 }
    Check 'the marker names the start that launched it' { (Read-Marker) -ne $null }
    Start-Sleep -Seconds 4
    $run = Invoke-Watchdog 'still starting, port held'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'it saw the start still running' { ($run.Lines -join "`n") -match 'a start is still running \(marker' }
    Check 'it did not stop the server' { -not ((Get-LogText) -match 'stopping stale PID') }
    Check 'the server PID is still alive after both runs' { [bool](Get-Process -Id $serverPid -ErrorAction SilentlyContinue) }
    Check 'the background run finished' { Wait-ForWatchdogExit $bg 120 }
    Check 'the server PID is still alive after the first run finished too' { [bool](Get-Process -Id $serverPid -ErrorAction SilentlyContinue) }
    Stop-App

    # --- 3. a dead app with no marker ----------------------------------------
    Say ''
    Say '3. a dead app with no marker'
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = $null }
    $run = Invoke-Watchdog 'dead app'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'the app answered 200 again' { Wait-ForApp 200 60 }
    Check 'it reported the repair' { ($run.Lines -join "`n") -match 'repaired: app' }

    # --- 4. a start that hangs past the deadline -----------------------------
    Say ''
    Say '4. a start that hangs past the deadline'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = '1'; STUB_MODE = $null }
    Check 'nothing is listening before the run' { (Get-AppListenerPid) -eq 0 }
    $bg = Start-WatchdogBackground 'launch a hung start'
    $marker = Wait-ForMarker 20
    $hungPid = if ($marker) { [int]$marker.pid } else { 0 }
    Check 'the marker names the hung start' { $hungPid -gt 0 }
    Start-Sleep -Seconds ($deadline + 5)
    $run = Invoke-Watchdog 'past the deadline'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'it said the start hung, with both ages' {
      ($run.Lines -join "`n") -match "the start recorded in the marker \(PID $hungPid\) has been running \d+ s of $deadline s"
    }
    Check 'it stopped the hung start' { -not [bool](Get-Process -Id $hungPid -ErrorAction SilentlyContinue) }
    $newMarker = Read-Marker
    Check 'it launched a new start, with a new PID in the marker' {
      $newMarker -and [int]$newMarker.pid -gt 0 -and [int]$newMarker.pid -ne $hungPid
    }
    Check 'the background run finished' { Wait-ForWatchdogExit $bg 120 }
    Set-TestEnv @{ FAKE_START_HANG = $null }
    $run = Invoke-Watchdog 'the hang is gone'
    Check 'it stopped the second hung start and started again' {
      ($run.Lines -join "`n") -match 'has been running \d+ s of \d+ s; stopping'
    }
    Check 'the app came back' { Wait-ForApp 200 60 }

    # --- 5. stale markers ----------------------------------------------------
    Say ''
    Say '5. stale markers'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = $null }
    Write-Marker 999999 $fakeStartPath (Get-Date)
    $run = Invoke-Watchdog 'a marker naming a dead PID'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'a dead PID is treated as no start: nothing was reported running or hung' {
      ($run.Lines -join "`n") -notmatch 'a start is still running|has been running'
    }
    # The marker is either gone (the repair's 200 deleted it) or names the real
    # start -- what must NOT be true is that the stale marker survived.
    $after = Read-Marker
    Check 'the stale marker no longer names the dead PID' { $null -eq $after -or [int]$after.pid -ne 999999 }
    Check 'the app answered 200 again' { Wait-ForApp 200 60 }
    Stop-App
    Remove-Marker

    $sleeper = Start-Process -FilePath $node -ArgumentList "-e", "`"setTimeout(function () {}, 600000)`"" -WindowStyle Hidden -PassThru
    $script:spawned += $sleeper.Id
    Start-Sleep -Seconds 1
    Check 'the unrelated process is running' { [bool](Get-Process -Id $sleeper.Id -ErrorAction SilentlyContinue) }
    Write-Marker $sleeper.Id $fakeStartPath (Get-Date)
    $run = Invoke-Watchdog 'a marker naming a live PID that runs something else'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'a reused PID is treated as no start: nothing was reported running or hung' {
      ($run.Lines -join "`n") -notmatch 'a start is still running|has been running'
    }
    Check 'the unrelated process was not stopped' { [bool](Get-Process -Id $sleeper.Id -ErrorAction SilentlyContinue) }
    $after = Read-Marker
    Check 'the stale marker no longer names the unrelated process' { $null -eq $after -or [int]$after.pid -ne $sleeper.Id }
    Check 'the app answered 200 again' { Wait-ForApp 200 60 }

    # --- 6. one missed probe, not a kill (D283) ------------------------------
    # The world's built server holds the port and answers 503 for 15 s, with no
    # marker, so nothing but the probe decides. With a 20 s wait the second
    # probe lands after the stub has turned 200: it must say so and leave the
    # server alone.
    Say ''
    Say '6. a slow answer is probed twice and not killed'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = 'slow503'; WATCHDOG_REPROBE_SECONDS = '20' }
    $stubPid = Start-Stub (Join-Path $app '.output\server\index.mjs') $appPort 'stub-app-6'
    Check 'the built server holds the port' { (Wait-ForStub $appPort $stubPid 30) }
    $run = Invoke-Watchdog 'one missed probe'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'it logged one missed probe, with the disk queue length, once' {
      @(($run.Lines -join "`n") -split "`n" | Where-Object { $_ -match 'probe 1 missed' -and $_ -match 'disk queue=' }).Count -eq 1
    }
    Check 'the second probe answered 200 and it stopped nothing' {
      ($run.Lines -join "`n") -match 'probe 2 answered 200'
    }
    Check 'it did not stop the server' { -not ((Get-LogText) -match 'stopping stale PID') }
    Check 'the server PID is still alive' { [bool](Get-Process -Id $stubPid -ErrorAction SilentlyContinue) }
    Set-TestEnv @{ WATCHDOG_REPROBE_SECONDS = '2' }

    # --- 7. two missed probes still repair (D283) ----------------------------
    # Same slow server, but both probes land inside its 15 s of 503: the repair
    # must run exactly as it did before this change, and its "app: port=" line
    # must carry the disk queue length.
    Say ''
    Say '7. two misses still repair'
    Stop-App
    Remove-Marker
    Set-TestEnv @{ FAKE_START_DELAY_SECONDS = '0'; FAKE_START_HANG = $null; STUB_MODE = 'slow503'; WATCHDOG_REPROBE_SECONDS = '2' }
    $stubPid = Start-Stub (Join-Path $app '.output\server\index.mjs') $appPort 'stub-app-7'
    Check 'the built server holds the port' { (Wait-ForStub $appPort $stubPid 30) }
    $run = Invoke-Watchdog 'two missed probes'
    Check 'the watchdog exited 0' { $run.Code -eq 0 }
    Check 'it logged the first miss' { ($run.Lines -join "`n") -match 'probe 1 missed' }
    Check 'the app: port= line carries the disk queue length' {
      ($run.Lines -join "`n") -match 'app: port=.*disk queue='
    }
    Check 'it stopped the stale server and repaired' { ($run.Lines -join "`n") -match 'stopping stale PID' }
    Stop-App
    Set-TestEnv @{ STUB_MODE = $null }
  }
} finally {
  # Everything this run can name as its own world's: recorded child PIDs, the
  # world's fake start scripts, and node processes running this world's build.
  foreach ($processId in $script:spawned) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  foreach ($process in (Get-FakeStartProcesses)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $builtServer = [IO.Path]::GetFullPath((Join-Path $app '.output\server\index.mjs'))
  foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
    if ($process.CommandLine -and (($process.CommandLine -replace '/', '\').IndexOf($builtServer, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($name in @('WATCHDOG_TEST_MODE', 'WATCHDOG_APP_PORT', 'WATCHDOG_PG_PORT', 'WATCHDOG_START_SCRIPT', 'WATCHDOG_STAGE_APP', 'PUBLIC_SITE_URL', 'WATCHDOG_START_DEADLINE_SECONDS', 'WATCHDOG_REPROBE_SECONDS', 'FAKE_START_DELAY_SECONDS', 'FAKE_START_HANG', 'STUB_MODE')) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
  if ($previousLocalAppData) { $env:LOCALAPPDATA = $previousLocalAppData }
  else { Remove-Item Env:\LOCALAPPDATA -ErrorAction SilentlyContinue }
}

Say ''
if ($script:failures -gt 0) {
  Say "ci-watchdog-start-guard.ps1 : $($script:failures) check(s) failed"
  Say "  the world is still at $world"
  exit 1
}
Say "ci-watchdog-start-guard.ps1 : every check passed"
Say "  the world is at $world (left for inspection)"
exit 0
