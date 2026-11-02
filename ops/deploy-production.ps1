<#
  The production deploy wrapper. The elevated helper runs it; it runs
  ops\promote.ps1 -WaitForJobs for the live paper.

  How to use it: copy this file into a new folder under C:\dev\TownReporter\
  (the helper only runs scripts from trusted roots such as C:\dev\), then
  queue that copy with the helper. Receipts land next to the copy:
    production-env-before.private  the .env as it was before the run
    promote-output.txt             promote's standard output
    promote-errors.txt             promote's error output
    deploy-result.json             exit code, watchdog state, .env restored

  What it does, in order:
    1. Saves .env and checks DATABASE_URL is the local Postgres on 5433.
    2. Adds PROMOTE_ADMIN_DATABASE_URL to .env for this run only.
    3. Turns the TownReporter Watchdog task off.
    4. Runs promote.ps1 -WaitForJobs and waits for it.
    5. Always (finally): puts .env back, turns the watchdog back on, and
       writes deploy-result.json.

  THE HANG THIS FILE FIXES (finding G01-DEP-1, Nov 1 2026). Older copies ran
  promote as `& powershell.exe ... *> promote-output.txt`. That waits until
  promote's output pipe closes. Promote starts the app (start-townreporter.ps1
  -> node), and the app gets a copy of that pipe and keeps it open for as long
  as it runs. So the wrapper never got past that line. The helper killed it at
  its 1-hour timeout, the finally block never ran, and the watchdog stayed off
  with the extra .env line still in place. It happened on the Oct 31 7:21 AM,
  Nov 1 1:03 PM and Nov 1 5:19 PM deploys.

  Now promote runs through Start-Process with its output in files, and the
  wrapper waits for that one process by PID. The app may keep the files open;
  nothing waits on them. scripts\deploy-wrapper.test.mjs proves it on Windows.

  -EnvFile and -PromoteScript exist for that test only. The helper passes no
  arguments, so the defaults below are what a real deploy uses.
#>
param(
  [string]$EnvFile = 'C:\Users\scott\Desktop\Code\townreporter-web\.env',
  [string]$PromoteScript = 'C:\Users\scott\Desktop\Code\townreporter-web\ops\promote.ps1'
)
$ErrorActionPreference = 'Stop'
$receiptRoot = $PSScriptRoot
$originalEnv = [IO.File]::ReadAllBytes($EnvFile)
$envText = [IO.File]::ReadAllText($EnvFile)
$envWasTemporarilyChanged = $false
$backupEnvFile = Join-Path $receiptRoot 'production-env-before.private'
if (-not (Test-Path -LiteralPath $backupEnvFile)) {
  [IO.File]::WriteAllBytes($backupEnvFile, $originalEnv)
}
$databaseLine = ($envText -split "`r?`n" | Where-Object { $_ -match '^DATABASE_URL\s*=' } | Select-Object -First 1)
$databaseValue = ($databaseLine -replace '^DATABASE_URL\s*=\s*', '').Trim().Trim('"', "'")
$databaseUri = [Uri]$databaseValue
if ($databaseUri.Host -notin @('localhost', '127.0.0.1') -or $databaseUri.Port -ne 5433) {
  throw 'Unexpected production database endpoint; nothing changed.'
}
$adminUrl = 'postgres://postgres@' + $databaseUri.Host + ':5433/postgres'
$watchdog = Get-ScheduledTask -TaskName 'TownReporter Watchdog'
$wasEnabled = $watchdog.Settings.Enabled
$resultCode = 1
try {
  if ($envText -match '(?m)^[ \t]*PROMOTE_ADMIN_DATABASE_URL[ \t]*=[ \t]*\S') {
    throw 'An administrator URL is already configured; preserve it and review before changing.'
  }
  $temporaryEnv = ($envText -replace '(?m)^[ \t]*PROMOTE_ADMIN_DATABASE_URL[ \t]*=.*\r?\n?', '') + "`r`nPROMOTE_ADMIN_DATABASE_URL=$adminUrl`r`n"
  [IO.File]::WriteAllText($EnvFile, $temporaryEnv)
  $envWasTemporarilyChanged = $true
  if ($wasEnabled) {
    Disable-ScheduledTask -TaskName 'TownReporter Watchdog' | Out-Null
  }
  # Never `& powershell ... *> file` here: see THE HANG above.
  $promote = Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PromoteScript + '"'), '-WaitForJobs') `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $receiptRoot 'promote-output.txt') `
    -RedirectStandardError (Join-Path $receiptRoot 'promote-errors.txt')
  $null = $promote.Handle   # keep the handle, so ExitCode can be read after the exit
  Wait-Process -Id $promote.Id
  $promote.WaitForExit()
  $resultCode = $promote.ExitCode
} finally {
  if ($envWasTemporarilyChanged) {
    [IO.File]::WriteAllBytes($EnvFile, $originalEnv)
  }
  if ($wasEnabled) {
    Enable-ScheduledTask -TaskName 'TownReporter Watchdog' | Out-Null
  }
  [ordered]@{
    finishedAt = (Get-Date).ToUniversalTime().ToString('o')
    promoteExitCode = $resultCode
    watchdogWasEnabled = $wasEnabled
    watchdogEnabledAfter = (Get-ScheduledTask -TaskName 'TownReporter Watchdog').Settings.Enabled
    originalEnvironmentRestored = [Convert]::ToBase64String([IO.File]::ReadAllBytes($EnvFile)) -eq [Convert]::ToBase64String($originalEnv)
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'deploy-result.json')
}
exit $resultCode
