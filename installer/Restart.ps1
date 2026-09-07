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
if ($process) {
  $inventory = @(Get-CimInstance Win32_Process)
  function Stop-OldAppTree($parent) {
    if ($parent.ProcessId -eq $PID) { return }
    foreach ($child in @($inventory | Where-Object ParentProcessId -eq $parent.ProcessId)) { Stop-OldAppTree $child }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ProcessId)" -ErrorAction SilentlyContinue
    if ($current -and $current.CreationDate -eq $parent.CreationDate) { Stop-Process -Id $current.ProcessId -Force -ErrorAction Stop }
  }
  Stop-OldAppTree $process
}
& "$PSScriptRoot\Start.ps1" -DataRoot $DataRoot -NoBrowser

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
