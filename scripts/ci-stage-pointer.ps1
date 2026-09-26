<#
  ci-stage-pointer.ps1 -- does the live watchdog find the copy staged in ANOTHER
  checkout?

  Unit AL2. The gap this proves closed: ops\stage.ps1 stages from the checkout
  you ran it in -- by the owner's rule a WORKER or DEV checkout, never the live
  one -- while the live watchdog looked for ops\.stage.json in ITS own checkout,
  found nothing, and started nothing after a reboot. So the staged copy now
  writes a machine-wide pointer (%LOCALAPPDATA%\TownReporter\staged-copy.json)
  and every reader puts it through Resolve-TownReporterStageApp in
  ops\lib-stage.ps1 before starting anything from it. The pointer is a file in
  the user's profile: anyone can write any path into it, which is why that gate
  is most of what this harness checks.

  Disposable, like scripts\ci-stage-start.ps1, and for the same reason: the copy
  on 3100 belongs to whoever is walking it, the paper on 3000 belongs to the
  newsroom, and 5433 belongs to Postgres. Everything here happens under the OS
  temp directory -- two stub checkouts, a stub build that answers 200, stub
  app/postgres listeners -- with a FAKE LOCALAPPDATA, so the operator's real
  pointer is never read and never written. Every port is picked free from the
  ephemeral range; cleanup stops only the PIDs this run recorded.

  What it proves:

    A. the pointer file itself: where it lives, the atomic write (no .tmp
       left), and that removing it takes only the pointer that names the
       checkout being stopped
    B. the gate, in process, one refusal per way it can fail: a valid pointer;
       a pointer to a folder that is gone; a folder that is not a TownReporter
       checkout; a pointer whose commit no longer matches the checkout's own
       ops\.stage.json; a pointer naming the LIVE checkout; no pointer at all
       (silent); and no LOCALAPPDATA at all (not silent -- that one is worth
       saying out loud)
    C. the live watchdog, run for real against the disposable world: a valid
       pointer naming ANOTHER checkout makes it start THAT checkout's copy, and
       the pid/state/record paperwork lands there; a broken pointer starts
       nothing and says the plain reason ONCE, not every five minutes; no
       pointer says nothing at all

  The live-checkout refusal is checked in process rather than through the
  watchdog: the watchdog's paper port in test mode is the disposable stub's, so
  3000 -- the fact that makes a checkout "the live one" -- must not be involved.

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$AppRoot
)

$ErrorActionPreference = 'Stop'
$script:failures = 0
$script:spawned = @()
$script:runs = 0

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
if (-not (Test-Path -LiteralPath (Join-Path $root 'ops\lib-stage.ps1'))) {
  Say "no ops\lib-stage.ps1 under $root"
  exit 1
}
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

$world = Join-Path ([IO.Path]::GetTempPath()) ("al-pointer-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$live = Join-Path $world 'live'
$worker = Join-Path $world 'worker'
$notOurs = Join-Path $world 'notours'
$noBuild = Join-Path $world 'nobuild'
$gone = Join-Path $world 'gone'
$fakeLocal = Join-Path $world 'localappdata'

# The seam. %LOCALAPPDATA% is read at call time by every reader -- PowerShell
# here, the Control page's JavaScript too -- so pointing it at the disposable
# world is all it takes to keep this harness off the operator's real pointer.
# Saved and restored so the rest of this process (and anything it spawns that
# outlives it) sees the machine it started on.
$previousLocalAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = $fakeLocal
$pointerFile = Join-Path $fakeLocal 'TownReporter\staged-copy.json'

function New-Checkout([string]$Path, [string]$Name) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Path 'ops'), (Join-Path $Path 'scripts'), (Join-Path $Path 'logs'), (Join-Path $Path '.output\server') | Out-Null
  foreach ($file in @('lib-port.ps1', 'lib-ownership.ps1', 'lib-stage.ps1', 'start-stage.ps1', 'watchdog.ps1')) {
    Copy-Item -LiteralPath (Join-Path $root "ops\$file") -Destination (Join-Path $Path "ops\$file")
  }
  foreach ($file in @('with-app-env.mjs', 'test-environment.mjs', 'ci-watchdog-start.ps1')) {
    Copy-Item -LiteralPath (Join-Path $root "scripts\$file") -Destination (Join-Path $Path "scripts\$file")
  }
  "{ `"name`": `"$Name`", `"version`": `"$checkoutVersion`" }" | Set-Content -LiteralPath (Join-Path $Path 'package.json') -Encoding ASCII
  New-Item -ItemType File -Path (Join-Path $Path '.env') -Force | Out-Null
}

$checkoutVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$stagedVersion = '0.6.60'
$commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

New-Checkout $live 'townreporter'
# The checkout the pointer names. "worker" and not "staged" so the watchdog's
# own log line reads "stage: staged in worker on ..." rather than the stutter.
New-Checkout $worker 'townreporter'
New-Checkout $notOurs 'something-else'
# A checkout that is ours, is staged, and has no build: the last refusal.
New-Checkout $noBuild 'townreporter'
Remove-Item -LiteralPath (Join-Path $noBuild '.output\server\index.mjs') -Force -ErrorAction SilentlyContinue

# The build the pointer's checkout would be started from -- the stub that
# answers 200, exactly as scripts\ci-stage-start.ps1's does.
@'
import http from "node:http";
const port = Number(process.env.PORT);
http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("staged copy\n"); })
  .listen(port, "127.0.0.1", () => console.log("staged copy on " + port));
setTimeout(() => process.exit(0), 900000);
'@ | Set-Content -LiteralPath (Join-Path $worker '.output\server\index.mjs') -Encoding ASCII
Copy-Item -LiteralPath (Join-Path $worker '.output\server\index.mjs') -Destination (Join-Path $notOurs '.output\server\index.mjs')

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

$appPort = Get-FreePort
$pgPort = Get-FreePort
$stagePort = Get-FreePort
$otherPort = Get-FreePort
$stubAppPid = Start-Stub (Join-Path $world 'stub-app.mjs') $appPort 'stub-app'
$stubPgPid = Start-Stub (Join-Path $world 'stub-pg.mjs') $pgPort 'stub-pg'

# The staged, build-less checkout's own record, now that there are ports to name.
$noBuildState = "{ `"version`": `"$stagedVersion`", `"port`": $otherPort, `"commit`": `"$commit`" }"
[IO.File]::WriteAllText((Join-Path $noBuild 'ops\.stage.json'), $noBuildState, (New-Object Text.UTF8Encoding($false)))

# The library, loaded the way the watchdog loads it. lib-port.ps1 first (it
# sets $port as a side effect and lib-stage.ps1 refuses to load without it).
. (Join-Path $root 'ops\lib-port.ps1')
. (Join-Path $root 'ops\lib-stage.ps1')

$workerStatePath = Join-Path $worker 'ops\.stage.json'
$workerPidPath = Join-Path $worker 'ops\.stage.pid'
$workerRecordPath = Join-Path $worker 'logs\stage-start.json'
$liveMemoPath = Join-Path $live 'logs\stage-pointer.json'
$watchdogLogPath = Join-Path $live 'logs\watchdog.log'

function Write-WorkerState([int]$Port, [string]$StateCommit) {
  $doc = "{ `"backup`": `"harness.dump`", `"version`": `"$stagedVersion`", `"started`": `"2026-09-26T04:00:00.0000000Z`", `"port`": $Port, `"commit`": `"$StateCommit`" }"
  [IO.File]::WriteAllText($workerStatePath, $doc, (New-Object Text.UTF8Encoding($false)))
}
function Write-NotOursState([int]$Port) {
  $doc = "{ `"version`": `"$stagedVersion`", `"port`": $Port, `"commit`": `"$commit`" }"
  [IO.File]::WriteAllText((Join-Path $notOurs 'ops\.stage.json'), $doc, (New-Object Text.UTF8Encoding($false)))
}
function Set-Pointer([string]$App, [int]$Port, [string]$PointerCommit) {
  Save-TownReporterStagedCopyPointer -App $App -Port $Port -Commit $PointerCommit -Version $stagedVersion -Database 'townreporter_dev' -Time '2026-09-26T04:00:00.000Z' | Out-Null
}
function Get-LogCount {
  if (Test-Path -LiteralPath $watchdogLogPath) { return @(Get-Content -LiteralPath $watchdogLogPath).Count }
  return 0
}
function Get-NewLog([int]$From) {
  if (-not (Test-Path -LiteralPath $watchdogLogPath)) { return @() }
  $all = @(Get-Content -LiteralPath $watchdogLogPath)
  if ($all.Count -le $From) { return @() }
  return @($all[$From..($all.Count - 1)])
}
function Invoke-Watchdog([string]$Label) {
  $script:runs++
  $out = Join-Path $world ("watchdog-run{0}.out" -f $script:runs)
  $before = Get-LogCount
  & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $live 'ops\watchdog.ps1') *> $out
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
function Test-StagedListening {
  @(Get-NetTCPConnection -LocalPort $stagePort -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}
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
function Wait-ForOutcome([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $workerRecordPath) {
      try {
        $outcome = [string](Get-Content -LiteralPath $workerRecordPath -Raw | ConvertFrom-Json).lastOutcome
        if ($outcome -and $outcome -ne 'starting') { return $outcome }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  return ''
}

Say "staged-copy pointer harness: $world"
Say "  live checkout $live (the watchdog runs from here, nothing staged in it)"
Say "  pointer names $worker; stub app $appPort, stub postgres $pgPort, staged copy $stagePort"

$env:WATCHDOG_TEST_MODE = '1'
$env:WATCHDOG_APP_PORT = "$appPort"
$env:WATCHDOG_PG_PORT = "$pgPort"
$env:WATCHDOG_START_SCRIPT = 'scripts/ci-watchdog-start.ps1'
$env:WATCHDOG_STAGE_APP = $live
$env:PUBLIC_SITE_URL = "http://127.0.0.1:$appPort/"
# The staged copy is not on the paper's port and not the database's; the
# pointer's own checkout must pass the same safety check a state file does.

try {
  Start-Sleep -Seconds 2
  Write-WorkerState $stagePort $commit
  Write-NotOursState $otherPort

  # --- A. the pointer file itself -----------------------------------------
  Say ''
  Say 'A. the pointer file'
  $pointerPath = Get-TownReporterStagedCopyPointerPath
  Check 'it lives under this machine LOCALAPPDATA, in one fixed place' {
    $pointerPath -ieq $pointerFile
  }
  Check 'nothing has written it yet' { -not (Test-Path -LiteralPath $pointerFile) }
  Check 'writing it reports success' {
    Save-TownReporterStagedCopyPointer -App $worker -Port $stagePort -Commit $commit -Version $stagedVersion -Database 'townreporter_dev' -Time '2026-09-26T04:00:00.000Z'
  }
  Check 'it writes all six things a reader needs' {
    $doc = Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json
    $doc.app -ieq $worker -and [int]$doc.port -eq $stagePort -and $doc.commit -eq $commit -and
      $doc.version -eq $stagedVersion -and $doc.database -eq 'townreporter_dev' -and $doc.time
  }
  Check 'and leaves no half-written .tmp beside it' { -not (Test-Path -LiteralPath "$pointerFile.tmp") }
  Check 'reading it back agrees it is usable' {
    $read = Get-TownReporterStagedCopyPointer
    $read.Exists -and $read.Ok -and ($read.Value.app -ieq $worker)
  }
  # | Out-Null on every helper whose own return value is not the assertion:
  # a Check block's value is what `if (& $Test)` reads, and a block that emits
  # a Bool first and its real answer second hands that `if` a two-element
  # array -- which is true whatever the two elements say.
  Check 'removing it for a DIFFERENT checkout leaves it alone' {
    Remove-TownReporterStagedCopyPointer -App $notOurs | Out-Null
    Test-Path -LiteralPath $pointerFile
  }
  Check 'removing it for the checkout it names removes it' {
    Remove-TownReporterStagedCopyPointer -App $worker | Out-Null
    -not (Test-Path -LiteralPath $pointerFile)
  }
  Check 'and the path helper honors an explicit -PointerFile' {
    (Get-TownReporterStagedCopyPointerPath -PointerFile (Join-Path $world 'elsewhere.json')) -ieq (Join-Path $world 'elsewhere.json')
  }

  # --- B. the gate, one refusal at a time ---------------------------------
  Say ''
  Say 'B. which checkout may be started from the pointer'
  Set-Pointer $worker $stagePort $commit
  Check 'a valid pointer resolves to the OTHER checkout, with its port and commit' {
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    $r.Ok -and $r.From -eq 'pointer' -and $r.App -ieq $worker -and $r.Port -eq $stagePort -and
      $r.Commit -eq $commit -and $r.Version -eq $stagedVersion -and $r.Database -eq 'townreporter_dev' -and
      $r.Folder -eq 'worker'
  }
  Check 'a checkout with its own ops\.stage.json is used, and the pointer is not even read' {
    $ownState = Join-Path $live 'ops\.stage.json'
    [IO.File]::WriteAllText($ownState, '{ "port": 41111, "commit": "x" }', (New-Object Text.UTF8Encoding($false)))
    try {
      $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
      $r.Ok -and $r.From -eq 'checkout' -and $r.App -ieq $live
    } finally {
      Remove-Item -LiteralPath $ownState -Force -ErrorAction SilentlyContinue
    }
  }
  Check 'a pointer to a folder that is not there any more is refused, by name' {
    Set-Pointer $gone $stagePort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.From -eq 'pointer' -and $r.Reason -match 'is not there any more' -and $r.Reason -match [regex]::Escape($gone)
  }
  Check 'a pointer to a folder outside this checkout folder is refused' {
    Set-Pointer ([IO.Path]::GetTempPath()) $stagePort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match 'not under'
  }
  Check 'a pointer to a folder that is not a TownReporter checkout is refused' {
    Set-Pointer $notOurs $otherPort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match 'not a TownReporter checkout'
  }
  Check 'a pointer whose commit no longer matches the checkout own state file is refused' {
    Set-Pointer $worker $stagePort $commit
    Write-WorkerState $stagePort 'ffffffffffffffffffffffffffffffffffffffff'
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match 'out of date'
  }
  Check 'a pointer whose port disagrees with the state file is refused' {
    Write-WorkerState $stagePort $commit
    Set-Pointer $worker $otherPort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match 'out of date'
  }
  Check 'a pointer naming THIS checkout when this checkout is the live paper is refused' {
    Write-WorkerState $stagePort $commit
    Set-Pointer $live $stagePort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort 3000 -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match "the live paper's own"
  }
  Check 'a pointer to a checkout with no build is refused' {
    Set-Pointer $noBuild $otherPort $commit
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Reason -match 'has no build at'
  }
  Check 'no pointer at all is SILENT -- the ordinary never-staged machine' {
    Remove-TownReporterStagedCopyPointer | Out-Null
    $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
    (-not $r.Ok) -and $r.Silent -and $r.From -eq 'none' -and -not $r.Reason
  }
  Check 'no LOCALAPPDATA at all is NOT silent -- there is nowhere to look' {
    Remove-Item Env:\LOCALAPPDATA -ErrorAction SilentlyContinue
    try {
      $r = Resolve-TownReporterStageApp -App $live -AppPort $appPort -PgPort $pgPort
      (-not $r.Ok) -and (-not $r.Silent) -and $r.Reason -match 'no LOCALAPPDATA'
    } finally {
      $env:LOCALAPPDATA = $fakeLocal
    }
  }
  Check 'the same refusal is said once, and a different one is said again' {
    $first = Test-TownReporterStageNoticeIsNew -App $live -Reason 'the same plain reason'
    $again = Test-TownReporterStageNoticeIsNew -App $live -Reason 'the same plain reason'
    $different = Test-TownReporterStageNoticeIsNew -App $live -Reason 'a different plain reason'
    $first -and (-not $again) -and $different
  }

  # --- C. the live watchdog, run for real ---------------------------------
  Say ''
  Say 'C. the watchdog, with the pointer naming a worker checkout'
  Remove-Item -LiteralPath $liveMemoPath -Force -ErrorAction SilentlyContinue
  Write-WorkerState $stagePort $commit
  Set-Pointer $worker $stagePort $commit
  Remove-Item -LiteralPath $workerPidPath, $workerRecordPath -Force -ErrorAction SilentlyContinue
  $run = Invoke-Watchdog 'pointer, valid'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it said the copy is staged in the OTHER checkout, and that it was starting it' {
    $joined -match "stage: staged in worker on $stagePort \(version $stagedVersion\) and not answering .*starting it"
  }
  Check 'the copy in the other checkout answered 200' { Wait-ForStaged 120 }
  Check 'the start script wrote its own outcome into the WORKER checkout' { (Wait-ForOutcome 60) -eq 'started' }
  Check 'the pid file landed in the worker checkout, not in the live one' {
    (Test-Path -LiteralPath $workerPidPath) -and ((Get-Content -LiteralPath $workerPidPath -Raw).Trim() -match '^\d+$')
  }
  Check 'and nothing was staged into the live checkout' {
    -not (Test-Path -LiteralPath (Join-Path $live 'ops\.stage.json')) -and -not (Test-Path -LiteralPath (Join-Path $live 'ops\.stage.pid'))
  }

  Say ''
  Say 'C2. a pointer that cannot be trusted, twice'
  $stagePid = if (Test-Path -LiteralPath $workerPidPath) { (Get-Content -LiteralPath $workerPidPath -Raw).Trim() } else { '' }
  if ($stagePid -match '^\d+$') { Stop-Process -Id ([int]$stagePid) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
  Remove-Item -LiteralPath $liveMemoPath -Force -ErrorAction SilentlyContinue
  Set-Pointer $gone $stagePort $commit
  $run = Invoke-Watchdog 'pointer, broken'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it started nothing, and said the plain reason' {
    ($joined -match "stage: nothing was started -- the staged-copy pointer names $([regex]::Escape($gone)), which is not there any more") -and
      -not (Test-StagedListening)
  }
  $run = Invoke-Watchdog 'pointer, broken again'
  $joined = $run.Lines -join "`n"
  Check 'the second run with the same broken pointer said nothing at all' { -not ($joined -match 'stage:') }

  Say ''
  Say 'C3. no pointer at all'
  Remove-TownReporterStagedCopyPointer | Out-Null
  Remove-Item -LiteralPath $liveMemoPath -Force -ErrorAction SilentlyContinue
  $run = Invoke-Watchdog 'no pointer'
  $joined = $run.Lines -join "`n"
  Check 'the watchdog exited 0' { $run.Code -eq 0 }
  Check 'it said nothing about the staged copy' { -not ($joined -match 'stage:') }
} finally {
  foreach ($processId in $script:spawned) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $workerPidPath) {
    $stagePid = (Get-Content -LiteralPath $workerPidPath -Raw).Trim()
    if ($stagePid -match '^\d+$') { Stop-Process -Id ([int]$stagePid) -Force -ErrorAction SilentlyContinue }
  }
  foreach ($name in @('WATCHDOG_TEST_MODE', 'WATCHDOG_APP_PORT', 'WATCHDOG_PG_PORT', 'WATCHDOG_START_SCRIPT', 'WATCHDOG_STAGE_APP', 'PUBLIC_SITE_URL')) {
    Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
  }
  if ($previousLocalAppData) { $env:LOCALAPPDATA = $previousLocalAppData }
  else { Remove-Item Env:\LOCALAPPDATA -ErrorAction SilentlyContinue }
}

Say ''
if ($script:failures -gt 0) {
  Say "ci-stage-pointer.ps1 : $($script:failures) check(s) failed"
  Say "  the world is still at $world"
  exit 1
}
Say "ci-stage-pointer.ps1 : every check passed"
Say "  the world is at $world (left for inspection)"
exit 0
