param([ValidateSet('app', 'tunnel')][string]$Target)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-ownership.ps1')
Assert-TownReporterLegacyOwnership
$taskName = if ($Target -eq 'app') { 'TownReporter Restart' } else { 'TownReporter Tunnel Restart' }
$scriptName = if ($Target -eq 'app') { 'restart-app.ps1' } else { 'restart-tunnel.ps1' }
Assert-TownReporterTaskOwnership $taskName $scriptName
Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
Write-Output 'Restart handed to the Windows task bound to this exact installation. Reopen the desk in about 30 seconds.'
