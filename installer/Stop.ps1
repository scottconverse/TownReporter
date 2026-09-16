param([string]$DataRoot, [switch]$AppOnly)
. "$PSScriptRoot\Common.ps1"
$lifecycle = Enter-InstallLifecycle
try {

$config = Read-InstallConfig
$process = Get-OwnedApp
$state = Join-Path $DataRoot 'app-process.json'
$rootStopped = $false
if ($process) { $rootStopped = Stop-VerifiedAppProcessTree $process }
[void](Clear-AppProcessStateAfterStop $state $rootStopped)
if (!$AppOnly -and (Get-OwnedPostgres)) { Invoke-PgControl @('-D', ('"'+(Join-Path $DataRoot 'pgdata')+'"'), '-m', 'fast', '-w', 'stop') }
if ($rootStopped -or !(Test-Path -LiteralPath $state)) { Write-Output 'This installation stopped. Persistent data was retained.' }
else { Write-Output 'PostgreSQL shutdown was requested. The app process record was retained because app ownership could not be verified.' }

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
