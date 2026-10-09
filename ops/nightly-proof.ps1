<#
  The nightly live-pipeline proof: scan -> draft, with a REAL model, run
  automatically every night against the already-running Test server.

  Two things this script does, picked by switch:

    (default)  Register (or refresh) the "TownReporter Nightly Proof"
               scheduled task, at 03:30 daily, as the current user, then
               print how to run it right now.
    -Now       Run scripts\live-pipeline-proof.mjs against Test. This is exactly what
               the scheduled task's own action runs -- there is only one
               code path, so a manual run and the 03:30 run behave
               identically.
    -Status    Print the most recent artifacts\nightly\<date>.json.

  Interactive logon, on purpose: the proof drives the operator's real
  Claude Code / Codex CLIs, and those look for the operator's login in the
  interactive session's profile, not a batch/S4U one. A task that runs
  "whether the user is logged on or not" would boot with no session and no
  logins the CLIs can find -- see docs\nightly-proof.md for what that looks
  like when it happens.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1
    powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Now
    powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Status
#>
[CmdletBinding()]
param(
  [switch]$Now,
  [switch]$Status
)

$ErrorActionPreference = "Stop"

$ops = $PSScriptRoot
$app = Split-Path -Parent $ops
$taskName = "TownReporter Nightly Proof"

function Say($msg) { Write-Host "  $msg" }
function Die($msg) { Write-Host ""; Write-Host "  STOP. $msg" -ForegroundColor Yellow; Write-Host ""; exit 1 }

function Invoke-External([scriptblock]$Script) {
  <#
    Same pattern as ops\stage.ps1's Invoke-External: any external tool's
    stderr line becomes a terminating NativeCommandError under
    $ErrorActionPreference = "Stop" even through "2>&1 | Out-String" -- PS
    5.1 converts the stderr line to an error record before that merge runs.
    Relax to Continue only around the native call and judge success from
    $LASTEXITCODE.
  #>
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $Script 2>&1 | Out-String
    return @{ Output = $out; ExitCode = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

# --- -Status -----------------------------------------------------------
if ($Status) {
  $latestFile = Join-Path $app "artifacts\nightly\LATEST.txt"
  if (-not (Test-Path $latestFile)) {
    Say "no nightly proof has run yet (no artifacts\nightly\LATEST.txt)"
    exit 0
  }
  $name = (Get-Content $latestFile -Raw).Trim()
  $jsonFile = Join-Path $app "artifacts\nightly\$name"
  if (-not (Test-Path $jsonFile)) { Die "LATEST.txt names $name but that file is missing." }
  Get-Content $jsonFile -Raw | Write-Host
  exit 0
}

# --- -Now: run the proof for real ---------------------------------------
if ($Now) {
  Set-Location $app
  Write-Host ""
  Write-Host "  TownReporter nightly live-pipeline proof"
  Write-Host "  ------------------------------------------------------------"

  # Both entry paths use the Node configuration defaults: Test on port 3400,
  # newest townreporter_test_<stamp> on 5547 via a SELECT-only discovery.
  # An explicit DATABASE_URL is passed through and guarded there; never pin
  # a dated database here. The Test owner already exists: do not stage it.
  # Email/password-file overrides are passed through, and the private file
  # is read only at run time (never embedded in the scheduled action).

  Say "running scripts\live-pipeline-proof.mjs (daily scan up to 10 min, draft queued up to 2 min then running up to 8 min)"
  $r = Invoke-External { node scripts/live-pipeline-proof.mjs }
  Write-Host $r.Output
  if ($r.ExitCode -ne 0) {
    Say "the proof finished but scan and/or draft did NOT both succeed -- see the JSON above and artifacts\nightly\"
    exit 1
  }
  Say "done -- see artifacts\nightly\ (this checkout only; not committed, see .gitignore)"
  exit 0
}

# --- default: register/refresh the scheduled task -----------------------
Write-Host ""
Write-Host "  TownReporter Nightly Proof -- scheduled task"
Write-Host "  ------------------------------------------------------------"
Write-Host "  app: $app"
Write-Host ""

$ps = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$selfScript = Join-Path $ops "nightly-proof.ps1"

# Same footgun ops\install-tasks.ps1 guards against: a second checkout on
# this machine repointing the OTHER install's nightly task without saying so.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  $existingArgs = ($existing.Actions | ForEach-Object { $_.Arguments }) -join " "
  if ($existingArgs -and $existingArgs -notlike "*$ops*") {
    Write-Host ""
    Write-Host "  STOP. '$taskName' already points at a DIFFERENT install:" -ForegroundColor Yellow
    Write-Host "    now: $existingArgs"
    Write-Host "    this script would repoint it at: $ops"
    Write-Host ""
    Die "Unregister it first if that repoint is intended, or run this from the other checkout."
  }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $ps `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Now' -f $selfScript) `
  -WorkingDirectory $app

$trigger = New-ScheduledTaskTrigger -Daily -At "03:30"

# LogonType Interactive: this task must run IN the operator's real desktop
# session, not a headless S4U/batch one, so the Claude Code / Codex CLIs can
# find the operator's login the same way they do when run by hand. A batch
# task here would report every provider signed out, every night, on a
# machine that is plainly signed in.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings `
  -Description "TownReporter: nightly scan-then-draft proof on the Test server (3400), newest townreporter_test_<stamp> on 5547, with the real model providers" | Out-Null

$verb = if ($existing) { "updated" } else { "created" }
Write-Host "  $verb  $taskName  (daily at 03:30, interactive logon as $env:USERNAME)"
Write-Host ""
Write-Host "  Run it right now instead of waiting for 03:30:"
Write-Host "    powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Now"
Write-Host ""
Write-Host "  Or start tonight's scheduled run early:"
Write-Host "    Start-ScheduledTask -TaskName `"$taskName`""
Write-Host ""
Write-Host "  Check the last result:"
Write-Host "    powershell -ExecutionPolicy Bypass -File ops\nightly-proof.ps1 -Status"
Write-Host ""
