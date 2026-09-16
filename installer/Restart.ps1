param([string]$DataRoot, [switch]$Worker)
. "$PSScriptRoot\Common.ps1"
$config = Read-InstallConfig
if (!$Worker) {
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),'-DataRoot',('"'+$DataRoot+'"'),'-Worker') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataRoot 'restart.out.log') -RedirectStandardError (Join-Path $DataRoot 'restart.err.log') | Out-Null
  Write-Output 'Restart requested for this installation. Reopen the desk in about 30 seconds; if it stays unavailable, read restart.err.log in your data folder.'
  exit 0
}
$lifecycle = Enter-InstallLifecycle
try {
Start-Sleep -Seconds 4
# Preserve this restart worker, but stop the old server's provider/browser descendants.
$process = Get-OwnedApp
if ($process) { Stop-VerifiedAppProcessTree $process @([int]$PID) }
& "$PSScriptRoot\Start.ps1" -DataRoot $DataRoot -NoBrowser

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
