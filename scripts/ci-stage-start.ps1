<#
  ci-stage-start.ps1 -- does the staged copy come back after a reboot?

  The reboot is real and the fix is real, but neither is safe to perform on
  this machine: the staged copy on 3100 belongs to whoever is walking it, the
  paper on 3000 belongs to the newsroom, and 5433 belongs to Postgres. So this
  harness builds a disposable world in the temp directory -- a checkout with
  copies of the real ops\ scripts, a stub "build" that answers 200, a stub
  Postgres listener, a stub app -- and runs the REAL ops\watchdog.ps1 against
  it with the TEST-003 seams (WATCHDOG_TEST_MODE=1 and friends, plus
  WATCHDOG_STAGE_APP for the stage world). Nothing here reaches 3000, 3100,
  5433 or any process this harness did not itself start; every port is picked
  free from the ephemeral range, and cleanup stops only the PIDs recorded in
  this run, by PID and never by image name.

  It is the same shape as scripts\ci-hash-no-module.ps1: check by check, a
  non-zero exit if any failed, and a printed world path worth keeping when one
  does. What it proves, in order:

    1. after a reboot -- staged on disk, nothing answering, no attempt on
       record -- the watchdog starts it and it answers 200
    2. a run against a copy that is already up says so and starts nothing
    3. a run minutes after an attempt declines, in the record's own words, and
       the thirty-minute floor is why (the reboot case's whole safety rail)
    4. nothing staged says nothing at all -- no line, not a "nothing to do"
       line
    5. a state file naming the paper's port is refused by name, and nothing is
       started from it

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:spawned = @()
$script:spawnLog = @{}

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
# the three this machine's real services own.
function Get-FreePort {
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $candidate = $listener.LocalEndpoint.Port
    $listener.Stop()
    if ($candidate -ge 1024 -and $candidate -ne 3000 -and $candidate -ne 3100 -and $candidate -ne 5433) { return $candidate }
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

$world = Join-Path ([IO.Path]::GetTempPath()) ("al-stage-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$app = Join-Path $world 'app'
New-Item -ItemType Directory -Force -Path (Join-Path $app 'ops'), (Join-Path $app 'scripts'), (Join-Path $app 'logs'), (Join-Path $app '.output\server') | Out-Null

foreach ($name in @('lib-port.ps1', 'lib-ownership.ps1', 'lib-stage.ps1', 'start-stage.ps1', 'watchdog.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root "ops\$name") -Destination (Join-Path $app "ops\$name")
}
foreach ($name in @('with-app-env.mjs', 'test-environment.mjs', 'ci-watchdog-start.ps1')) {
  Copy-Item -LiteralPath (Join-Path $root "scripts\$name") -Destination (Join-Path $app "scripts\$name")
}

# The staged copy was built from version 0.6.60 and this checkout now reads
# 0.6.69: the stale-version note in ops\start-stage.ps1 has something to say.
$checkoutVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$stagedVersion = '0.6.60'
"{ `"name`": `"stage-harness`", `"version`": `"$checkoutVersion`" }" | Set-Content -LiteralPath (Join-Path $app 'package.json') -Encoding ASCII

$appPort = Get-FreePort
$pgPort = Get-FreePort
$stagePort = Get-FreePort
$envFile = Join-Path $app '.env'

@'
import http from "node:http";
const port = Number(process.env.PORT);
http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("disposable app\n"); })
  .listen(port, "127.0.0.1", () => console.log("stub app on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $world 'stub-app.mjs') -Encoding ASCII

@'
import net from "node:net";
const port = Number(process.env.PORT);
net.createServer(() => {}).listen(port, "127.0.0.1", () => console.log("stub postgres on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $world 'stub-pg.mjs') -Encoding ASCII

# Stands in for .output\server\index.mjs -- the built server ops\start-stage.ps1
# starts. It answers 200 and speaks to nothing, which is all the watchdog's
# "a socket is not a paper" rule asks for. Its PATH is its identity: it is the
# file Test-TownReporterServerProcess matches a command line against.
@'
import http from "node:http";
const port = Number(process.env.PORT);
http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("staged copy\n"); })
  .listen(port, "127.0.0.1", () => console.log("staged copy on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $app '.output\server\index.mjs') -Encoding ASCII

function Start-Stub([string]$Script, [int]$Port, [string]$LogName) {
  $previous = $env:PORT
  $env:PORT = "$Port"
  try {
    $proc = Start-Process -FilePath $node -ArgumentList $Script -WorkingDirectory $world -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $world "$LogName.out") -RedirectStandardError (Join-Path $world "$LogName.err") -PassThru
    $script:spawned += $proc.Id
    $script:spawnLog[$proc.Id] = "$LogName"
    return $proc.Id
  } finally {
    if ($previous) { $env:PORT = $previous } else { Remove-Item Env:\PORT -ErrorAction SilentlyContinue }
  }
}

$stubAppPid = Start-Stub (Join-Path $world 'stub-app.mjs') $appPort 'stub-app'
$stubPgPid = Start-Stub (Join-Path $world 'stub-pg.mjs') $pgPort 'stub-pg'

# A world with no .env: lib-port.ps1 falls back to 3000, and the watchdog's
# WATCHDOG_APP_PORT seam is what points it at the disposable app instead.
if (-not (Test-Path -LiteralPath $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }

$logPath = Join-Path $app 'logs\watchdog.log'
$statePath = Join-Path $app 'ops\.stage.json'
$pidPath = Join-Path $app 'ops\.stage.pid'
$recordPath = Join-Path $app 'logs\stage-start.json'
$stageLogPath = Join-Path $app 'logs\stage-start.log'

function Write-StageState([string]$Json) {
  [IO.File]::WriteAllText($statePath, $Json, (New-Object Text.UTF8Encoding($false)))
}
# -ProcessId, not -Pid: PowerShell variable names are case-insensitive and $PID
# is a read-only automatic, so a parameter called $Pid fails to bind.
function Write-StageRecord([string]$Iso, [string]$Outcome, [string]$Reason, [string]$ProcessId) {
  $doc = "{`"lastAttemptAt`": `"$Iso`", `"lastOutcome`": `"$Outcome`", `"lastReason`": `"$Reason`", `"lastPid`": `"$ProcessId`"}"
  [IO.File]::WriteAllText($recordPath, $doc, (New-Object Text.UTF8Encoding($false)))
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
function Invoke-Watchdog([string]$Label) {
  $script:runs++
  $out = Join-Path $world ("watchdog-run{0}.out" -f $script:runs)
  $before = Get-LogCount
  & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $app 'ops\watchdog.ps1') *> $out
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Say "  (watchdog run '$Label' exited $code; output follows)"
    if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out | ForEach-Object { Say "    $_" } }
  }
  $new = Get-NewLog $before
  Say "  -- watchdog run '$Label' (exit $code) said:"
  foreach ($line in $new) { Say "     $line" }
  return @{ Code = $code; Lines = $new }
}
# Wait for the staged copy to answer 200. The listening check comes first on
# purpose: asking HTTP for a port that has no listener costs a full -TimeoutSec
# on Windows, which turned a two-minute wait into a six-minute one the first
# time this harness ran.
function Wait-ForStaged([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-StagedListening) {
      try {
        if ((Invoke-WebRequest "http://127.0.0.1:$stagePort/" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return $false
}
function Test-StagedListening {
  @(Get-NetTCPConnection -LocalPort $stagePort -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}
# The watchdog spawns ops\start-stage.ps1 and does not wait for it, and that
# script writes its own outcome only after its own 200 -- the harness sees the
# 200 first. So give the child a moment to finish its own record before
# judging it. Returns the record's outcome, or '' if it never leaves the
# watchdog's 'starting'.
function Wait-ForOutcome([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $recordPath) {
      try {
        $outcome = [string](Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json).lastOutcome
        if ($outcome -and $outcome -ne 'starting') { return $outcome }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return ''
}

$script:runs = 0
Say "staged copy harness: $world"
Say "  disposable app $appPort, stub postgres $pgPort, staged copy $stagePort"

$env:WATCHDOG_TEST_MODE = '1'
$env:WATCHDOG_APP_PORT = "$appPort"
$env:WATCHDOG_PG_PORT = "$pgPort"
$env:WATCHDOG_START_SCRIPT = 'scripts/ci-watchdog-start.ps1'
$env:WATCHDOG_STAGE_APP = $app
$env:PUBLIC_SITE_URL = "http://127.0.0.1:$appPort/"

try {
  Start-Sleep -Seconds 2

  # --- 1. The reboot: staged on disk, nothing answering, nothing recorded ---
  Say ''
  Say '1. after a reboot'
  Write-StageState "{ `"backup`": `"harness.dump`", `"version`": `"$stagedVersion`", `"started`": `"2026-09-26T04:00:00.0000000Z`", `"port`": $stagePort }"
  Remove-Item -LiteralPath $pidPath, $recordPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stageLogPath -Force -ErrorAction SilentlyContinue
  $run = Invoke-Watchdog 'reboot'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it said the staged copy was not answering and that it was starting it' {
    $joined -match "stage: staged on $stagePort \(version $stagedVersion\) and not answering .*starting it"
  }
  Check 'the staged copy answered 200' { Wait-ForStaged 120 }
  Check 'the start script wrote its own outcome' { (Wait-ForOutcome 60) -eq 'started' }
  Check 'a pid file was written' { (Test-Path -LiteralPath $pidPath) -and ((Get-Content -LiteralPath $pidPath -Raw).Trim() -match '^\d+$') }
  Check 'the attempt record says it started' {
    (Test-Path -LiteralPath $recordPath) -and ((Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json).lastOutcome -eq 'started')
  }
  Check 'the staged copy logged its own success' {
    (Test-Path -LiteralPath $stageLogPath) -and ((Get-Content -LiteralPath $stageLogPath -Raw) -match "answering 200 on 127.0.0.1:$stagePort")
  }
  Check 'the record names the pid in the pid file' {
    (Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json).lastPid -eq (Get-Content -LiteralPath $pidPath -Raw).Trim()
  }

  # --- 2. Already up ---
  Say ''
  Say '2. a run against a copy that is already up'
  $run = Invoke-Watchdog 'already up'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it said the staged copy is up, with its version' {
    $joined -match "stage: the staged copy is up on $stagePort \(version $stagedVersion\)"
  }

  # --- 3. The thirty-minute floor ---
  Say ''
  Say '3. minutes after an attempt, with nothing answering'
  $stagePid = if (Test-Path -LiteralPath $pidPath) { (Get-Content -LiteralPath $pidPath -Raw).Trim() } else { '' }
  Check 'scenario 1 left a pid to stop' { $stagePid -match '^\d+$' }
  if ($stagePid -match '^\d+$') { Stop-Process -Id ([int]$stagePid) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  $fiveMinutesAgo = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
  Write-StageRecord $fiveMinutesAgo 'started' "answering 200 on 127.0.0.1:$stagePort" $stagePid
  $run = Invoke-Watchdog 'inside the floor'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it declined in the record own words, and said why' {
    $joined -match 'the last start attempt was 5 minute\(s\) ago; leaving it for a later run'
  }
  Check 'it started nothing' { -not (Test-StagedListening) }

  # --- 4. Nothing staged ---
  Say ''
  Say '4. a machine that has never staged anything'
  Remove-Item -LiteralPath $statePath, $recordPath -Force -ErrorAction SilentlyContinue
  $run = Invoke-Watchdog 'nothing staged'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it said nothing about the staged copy' { -not ($joined -match 'stage:') }

  # --- 5. A state file naming the paper's port ---
  Say ''
  Say '5. a state file pointing at the live paper'
  Write-StageState '{ "port": 3000 }'
  $run = Invoke-Watchdog 'unsafe state file'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it refused the port by name' { $joined -match 'stage: .*port 3000 belongs to the live paper' }
  Check 'it started nothing' { -not (Test-StagedListening) }
} finally {
  foreach ($processId in $script:spawned) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $pidPath) {
    $stagePid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    if ($stagePid -match '^\d+$') { Stop-Process -Id ([int]$stagePid) -Force -ErrorAction SilentlyContinue }
  }
  foreach ($name in @('WATCHDOG_TEST_MODE', 'WATCHDOG_APP_PORT', 'WATCHDOG_PG_PORT', 'WATCHDOG_START_SCRIPT', 'WATCHDOG_STAGE_APP', 'PUBLIC_SITE_URL')) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
}

Say ''
if ($script:failures -gt 0) {
  Say "ci-stage-start.ps1 : $($script:failures) check(s) failed"
  Say "  the world is still at $world"
  exit 1
}
Say "ci-stage-start.ps1 : every check passed"
Say "  the world is at $world (left for inspection)"
exit 0
