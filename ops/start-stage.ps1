<#
  Start the copy ops\stage.ps1 already staged. Nothing else.

  Why this file exists. The staged copy is a running node process, and a
  running node process does not survive a reboot. Everything else about
  staging does -- the restored townreporter_dev database, the build, the files
  ops\stage.ps1 wrote -- so a reboot during a walkthrough left the operator
  with all the expensive work still on disk and no server in front of it, and
  the only way back was to run the whole restore again: drop the database,
  restore the backup, rebuild. This starts the build that is already there
  against the database that is already restored.

  It is deliberately NOT a second stage.ps1:

    * It never restores, drops, creates or connects to a database. No psql,
      no stage-editor, no npm, no build. It does not even check whether
      townreporter_dev exists -- if it is gone, the server it starts says so
      in its own log, which is the honest outcome. The one database value in
      this file is the URL the server is started with, copied from
      ops\stage.ps1 so the two cannot disagree about what "the staged copy"
      means.
    * It never kills anything. There is no Stop-Process, no taskkill and no
      restart path in this file. If something already holds the staged port
      it declines and says so; ops\stage.ps1 -Stop stays the only stop,
      because the staged copy belongs to the operator and not to this script.
    * It never starts a second copy. If the staged copy is answering, or a
      start was recorded less than 150 seconds ago, it declines with exit 2.

  ops\watchdog.ps1 calls this when the staged copy is not answering and the
  paper is healthy, at most once every thirty minutes. The Control page's
  "Start the test copy" button calls the same file, which is why it also works
  by hand and prints what it is doing.

  The watchdog spawns it with -Watchdog, and that switch means one thing: the
  attempt record this script is about to read was written by the caller a
  moment ago, so a 'starting' verdict is not a second copy being piled on --
  it is the caller's own handwriting. The watchdog records the attempt before
  it spawns (that write is what keeps "at most once every thirty minutes" true
  even when the spawn dies on its first line) and then has to tell this script
  so, or every watchdog-driven start would decline itself. By hand the switch
  is absent and the verdict stands: two presses of the button do not start two
  servers.

  Exit codes: 0 started and answering, 1 started but not answering (or
  nothing could be started at all), 2 declined -- with the reason printed
  either way. -DryRun runs every decision and prints what it would do without
  starting anything or writing anything, which is how the test suite covers
  the branches of this file on a machine nothing may be started on.

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Quiet,
  # Set only by ops\watchdog.ps1, and only on the spawn it decided was due.
  # Meaning: "the fresh attempt record you are about to read is mine, not
  # somebody else's." See the 'starting' branch below for why that has to be
  # said out loud.
  [switch]$Watchdog
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib-ownership.ps1")
# -Watchdog: same requirement as ops\stage.ps1 outside test mode (this checkout
# must be opted in with the TOWNREPORTER_LEGACY_* .env triple), and in test
# mode the disposable seams are validated instead. This script is spawned by
# the watchdog, so it asks the same question the watchdog asked.
Assert-TownReporterLegacyOwnership -Watchdog

$ops = $PSScriptRoot
$app = Split-Path -Parent $ops

. (Join-Path $ops "lib-port.ps1")
# The paper's own port, from .env -- passed to the verifier below so a state
# file naming the live paper's port is refused before anything is started.
$appPort = [int]$port
. (Join-Path $ops "lib-stage.ps1")
$paths = Get-TownReporterStagePaths -App $app

function Say($msg) {
  if (-not $Quiet) { Write-Host "  $msg" }
  # A dry run writes nothing at all -- not even a log line.
  if (-not $DryRun) { Write-TownReporterStageLog -App $app -Message $msg }
}

# Exit 2: nothing to do, and nothing wrong. The reason is the message.
function Decline($msg) {
  Say "declined: $msg"
  exit 2
}

# Exit 1: this was supposed to work and did not.
function Fail($msg) {
  Say "FAILED: $msg"
  exit 1
}

$info = Get-TownReporterStageInfo -App $app -AppPort $appPort -PgPort 5433

# The 'starting' verdict means "port free, nothing answering, but an attempt
# was recorded in the last 150 seconds". For a person pressing the button that
# is the right answer -- twice-pressed buttons and piled-on starts. For the
# watchdog it is the watchdog's own handwriting: ops\watchdog.ps1 records the
# attempt BEFORE it spawns this script, which is what makes "at most once
# every thirty minutes" survive a spawn that dies on its first line. So the
# watchdog says so with -Watchdog, and the fresh record is not mistaken for
# someone else's. Nothing else is relaxed by that switch: 'up', 'wedged' and
# 'none' still decline, and the watchdog has already applied the thirty-minute
# floor before it spawns anything.
switch ($info.Verdict) {
  'none'     { Decline "nothing to start -- $($info.Reason)" }
  'up'       { Decline "already answering -- $($info.Reason); there is nothing to do" }
  'wedged'   { Decline $info.Reason }
  'starting' {
    if (-not $Watchdog) { Decline "$($info.Reason); not starting a second copy" }
  }
}

$stagePort = $info.Port
$outputServer = Join-Path $app ".output\server\index.mjs"
if (-not (Test-Path -LiteralPath $outputServer)) {
  Fail "there is no build at $outputServer. Nothing was started. Run ops\stage.ps1 to stage one."
}
$nodeExe = ""
try {
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
} catch {
  Fail "node is not on PATH, so the staged copy cannot be started."
}

$checkoutVersion = (Get-Content (Join-Path $app "package.json") -Raw | ConvertFrom-Json).version
$stagedVersion = if ($info.Version) { $info.Version } else { [string]$checkoutVersion }

if ($DryRun) {
  Say "[dry run] would start the staged copy on http://127.0.0.1:$stagePort (version $stagedVersion)"
  Say "[dry run] working directory: $app"
  Say "[dry run] command: $nodeExe scripts/with-app-env.mjs node `"$outputServer`""
  Say "[dry run] environment: DATABASE_URL=postgres://postgres@127.0.0.1:5433/townreporter_dev PORT=$stagePort HOST=127.0.0.1 TOWNREPORTER_TUNNEL=0"
  Say "[dry run] would write $($paths.Pid), $($paths.State) and $($paths.Record)"
  Say "[dry run] nothing was started and nothing was written"
  exit 0
}

if ($info.Version -and $info.Version -ne $checkoutVersion) {
  Say "note: this checkout now reads version $checkoutVersion but the staged copy was built as $($info.Version); starting the build that is on disk"
}

# Record the attempt BEFORE spawning. This is the write that makes "at most
# once every thirty minutes" true even if this process dies on the next line:
# ops\watchdog.ps1 reads it back on its next run either way.
Save-TownReporterStageStartRecord -App $app -Record ([pscustomobject]@{
  LastAttemptAt = (Get-TownReporterIsoTime)
  LastOutcome   = 'starting'
  LastReason    = "started by $($MyInvocation.MyCommand.Path)"
  LastPid       = ''
})

# Move the previous run's output aside rather than letting Start-Process
# truncate it: after a start that failed, the log that explains why is worth
# more than the one being written. ops\stage.ps1 writes these two files.
if (Test-Path -LiteralPath $paths.OutLog) { Move-Item -LiteralPath $paths.OutLog -Destination $paths.PrevOutLog -Force }
if (Test-Path -LiteralPath $paths.ErrLog) { Move-Item -LiteralPath $paths.ErrLog -Destination $paths.PrevErrLog -Force }

# The environment block, copied line for line from ops\stage.ps1's step 5 so
# the staged copy comes back on exactly the port, database and host it was
# staged on. scripts/ops-scripts.test.mjs asserts the two files agree.
$env:DATABASE_URL = "postgres://postgres@127.0.0.1:5433/townreporter_dev"
$env:PORT = "$stagePort"
$env:HOST = "127.0.0.1"
$env:TOWNREPORTER_TUNNEL = "0"
$env:BETTER_AUTH_URL = "http://127.0.0.1:$stagePort"
$env:PUBLIC_SITE_URL = "http://127.0.0.1:$stagePort"
$env:BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:$stagePort"

$proc = $null
try {
  # The built server goes on the command line as an absolute path in quotes,
  # exactly as ops\start-townreporter.ps1 writes it (line 139-140). Windows
  # reports a command line as it was typed, and that is how the app is
  # recognised as ours: Test-TownReporterServerProcess matches this path, so a
  # copy started from here is "a copy of the staged server" and not "another
  # program" on the Control page. ops\stage.ps1 passes the same file relative,
  # which is why lib-stage.ps1 has a second, weaker wording for copies it
  # started -- this script does not repeat that.
  $proc = Start-Process -FilePath $nodeExe `
    -ArgumentList @("scripts/with-app-env.mjs", "node", "`"$outputServer`"") `
    -WorkingDirectory $app `
    -WindowStyle Hidden `
    -RedirectStandardOutput $paths.OutLog `
    -RedirectStandardError $paths.ErrLog `
    -PassThru
} catch {
  Save-TownReporterStageStartRecord -App $app -Record ([pscustomobject]@{
    LastAttemptAt = (Get-TownReporterIsoTime)
    LastOutcome   = 'failed'
    LastReason    = "could not start: $($_.Exception.Message)"
    LastPid       = ''
  })
  Fail "could not start the staged server: $($_.Exception.Message)"
}

# The pid file and the state file are written immediately, before the wait:
# after a reboot the person reading the Control page needs the pid of the
# process that is starting, not of one that finished starting.
Set-Content -Path $paths.Pid -Value "$($proc.Id)" -Encoding ASCII

$state = [ordered]@{}
if (Test-Path -LiteralPath $paths.State) {
  try {
    $old = Get-Content -LiteralPath $paths.State -Raw | ConvertFrom-Json
    foreach ($property in $old.PSObject.Properties) { $state[$property.Name] = $property.Value }
  } catch {
    # An unreadable state file is not a reason to leave the port unrecorded:
    # everything below is written fresh and ops\stage.ps1 -Stop reads `port`.
  }
}
$state['port'] = $stagePort
$state['version'] = $stagedVersion
$state['started'] = (Get-Date -Format o)
$tmpState = "$($paths.State).tmp"
[IO.File]::WriteAllText($tmpState, ($state | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $tmpState -Destination $paths.State -Force

Say "started the staged copy on http://127.0.0.1:$stagePort (PID $($proc.Id), version $stagedVersion)"

$code = 0
for ($i = 0; $i -lt 100; $i++) {
  if (Test-TownReporterPort $stagePort) { break }
  Start-Sleep -Seconds 1
}
# Then ask for a real page -- a socket is not a paper, the same rule the
# watchdog and ops\stage.ps1's own verify step use. Twelve tries at five
# seconds keeps the whole wait inside the Control page's three-minute action
# timeout, so an operator pressing the button reads this script's own honest
# line rather than a runner that gave up on it.
for ($i = 0; $i -lt 12; $i++) {
  if (Test-TownReporterPort $stagePort) {
    try { $code = (Invoke-WebRequest "http://127.0.0.1:$stagePort/" -UseBasicParsing -TimeoutSec 5).StatusCode }
    catch { $code = -1 }
    if ($code -eq 200) { break }
  }
  Start-Sleep -Seconds 1
}

if ($code -eq 200) {
  Save-TownReporterStageStartRecord -App $app -Record ([pscustomobject]@{
    LastAttemptAt = (Get-TownReporterIsoTime)
    LastOutcome   = 'started'
    LastReason    = "answering 200 on 127.0.0.1:$stagePort"
    LastPid       = "$($proc.Id)"
  })
  Say "answering 200 on 127.0.0.1:$stagePort -- walk it at http://127.0.0.1:$stagePort/desk"
  exit 0
}

$detail = if ($code -eq 0) { "nothing was listening on $stagePort" } else { "it answered $code" }
Save-TownReporterStageStartRecord -App $app -Record ([pscustomobject]@{
  LastAttemptAt = (Get-TownReporterIsoTime)
  LastOutcome   = 'failed'
  LastReason    = "$detail two minutes after starting PID $($proc.Id)"
  LastPid       = "$($proc.Id)"
})
Fail "PID $($proc.Id) was started but $detail two minutes later. See $($paths.OutLog) and $($paths.ErrLog); ops\stage.ps1 -Stop removes the pid file."
