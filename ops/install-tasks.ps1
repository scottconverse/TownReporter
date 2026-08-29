<#
  Register every scheduled task TownReporter needs. Idempotent.

  SELF-HOSTING.md described six tasks and left the reader to create them by
  hand in Task Scheduler, which is not a reproducible setup: an audit called
  the operations layer advertised but not reproducible (TW-004). This is the
  script that makes the document true.

  Safe to run repeatedly. Each task is unregistered and re-registered, so
  running it after a path change or a script rename fixes the definition
  instead of leaving a stale one behind.

  Two decisions are baked in, both learned the hard way:

  * The two five-minute tasks run through run-hidden.vbs rather than
    powershell.exe. -WindowStyle Hidden does not stop the flash: Task
    Scheduler creates the console host and shows it before the script's own
    window style applies, so a window appeared and stole keyboard focus twelve
    times an hour. wscript.exe has no console of its own.

  * Restart and Tunnel Restart are tasks with no trigger rather than child
    processes of the app. A process cannot restart itself, and a tunnel restart
    cannot deliver its own result over the tunnel it has just killed.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, so
  anything else comes out as mojibake and can truncate a line.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
    powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"

$ops  = $PSScriptRoot
$app  = Split-Path -Parent $ops
$ps   = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$wscr = "$env:WINDIR\System32\wscript.exe"
$vbs  = Join-Path $ops "run-hidden.vbs"

function Require-File($path) {
  if (-not (Test-Path $path)) { throw "Missing required file: $path" }
}

Require-File (Join-Path $ops "start-townreporter.ps1")
Require-File (Join-Path $ops "run-tunnel.ps1")
Require-File (Join-Path $ops "restart-app.ps1")
Require-File (Join-Path $ops "restart-tunnel.ps1")
Require-File (Join-Path $ops "watchdog.ps1")
Require-File (Join-Path $ops "cron-tick.ps1")
Require-File $vbs

function PsAction($script) {
  New-ScheduledTaskAction -Execute $ps `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $ops $script))
}

# Hidden launcher: no console is ever drawn, and it waits so the task result
# is the script's real exit code and two runs cannot overlap.
function HiddenAction($script) {
  New-ScheduledTaskAction -Execute $wscr `
    -Argument ('"{0}" "{1}"' -f $vbs, (Join-Path $ops $script))
}

$atLogon    = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$everyFive  = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
                -RepetitionInterval (New-TimeSpan -Minutes 5) `
                -RepetitionDuration ([TimeSpan]::MaxValue)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$tasks = @(
  @{ Name = "TownReporter";                Action = (PsAction     "start-townreporter.ps1"); Trigger = $atLogon;   Why = "starts Postgres, migrates, serves the paper" },
  @{ Name = "TownReporter Tunnel";         Action = (PsAction     "run-tunnel.ps1");         Trigger = $atLogon;   Why = "connects the Cloudflare Tunnel" },
  @{ Name = "TownReporter Monitors";       Action = (HiddenAction "cron-tick.ps1");          Trigger = $everyFive; Why = "rechecks watched sources, drains desk jobs" },
  @{ Name = "TownReporter Watchdog";       Action = (HiddenAction "watchdog.ps1");           Trigger = $everyFive; Why = "restarts whatever has stopped" },
  @{ Name = "TownReporter Restart";        Action = (PsAction     "restart-app.ps1");        Trigger = $null;      Why = "on demand, from the Server page" },
  @{ Name = "TownReporter Tunnel Restart"; Action = (PsAction     "restart-tunnel.ps1");     Trigger = $null;      Why = "on demand, from the Server page" }
)

Write-Host ""
Write-Host "  TownReporter scheduled tasks"
Write-Host "  ----------------------------"
Write-Host "  app: $app"
Write-Host ""

# A second checkout is the obvious footgun: this machine has a production
# install and a development one, and running this from the wrong folder
# silently repoints the live paper's tasks at the dev copy. Say so and stop.
$conflict = @()
foreach ($t in $tasks) {
  $ex = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
  if (-not $ex) { continue }
  $existingArgs = ($ex.Actions | ForEach-Object { $_.Arguments }) -join " "
  if ($existingArgs -and $existingArgs -notlike "*$ops*") {
    $conflict += "  $($t.Name)`n    now: $existingArgs"
  }
}
if ($conflict.Count -gt 0 -and -not $PSBoundParameters.ContainsKey('WhatIf')) {
  Write-Host ""
  Write-Host "  STOP. These tasks already point at a DIFFERENT install:" -ForegroundColor Yellow
  $conflict | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "  This script would repoint them at:"
  Write-Host "    $ops"
  Write-Host ""
  Write-Host "  If that is what you want, unregister them first or run with -Force."
  Write-Host "  If you are in a development checkout, you are in the wrong folder."
  Write-Host ""
  throw "Refusing to repoint scheduled tasks from another install."
}

foreach ($t in $tasks) {
  $name = $t.Name
  if (-not $PSCmdlet.ShouldProcess($name, "register scheduled task")) { continue }

  $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }

  $args = @{
    TaskName    = $name
    Action      = $t.Action
    Settings    = $settings
    Description = "TownReporter: $($t.Why)"
  }
  if ($t.Trigger) { $args.Trigger = $t.Trigger }

  Register-ScheduledTask @args | Out-Null
  $verb = if ($existing) { "updated" } else { "created" }
  Write-Host ("  {0,-9} {1,-30} {2}" -f $verb, $name, $t.Why)
}

Write-Host ""
Write-Host "  Done. Check them with:  ops\status.ps1"
Write-Host "  The two five-minute tasks run hidden; you should never see a window."
Write-Host ""
