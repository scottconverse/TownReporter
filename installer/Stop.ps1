param([string]$DataRoot, [switch]$AppOnly)
. "$PSScriptRoot\Common.ps1"
$lifecycle = Enter-InstallLifecycle
try {

$config = Read-InstallConfig
$process = Get-OwnedApp
if ($process) {
  # Inventory descendants first, then validate creation times again before stopping.
  $inventory = @(Get-CimInstance Win32_Process)
  function Stop-OwnedTree($parent) {
    foreach ($child in @($inventory | Where-Object ParentProcessId -eq $parent.ProcessId)) { Stop-OwnedTree $child }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ProcessId)" -ErrorAction SilentlyContinue
    if ($current -and $current.CreationDate -eq $parent.CreationDate) { Stop-Process -Id $current.ProcessId -Force -ErrorAction Stop }
  }
  Stop-OwnedTree $process
}
$state = Join-Path $DataRoot 'app-process.json'
if (Test-Path -LiteralPath $state) { Remove-Item -LiteralPath $state }
if (!$AppOnly -and (Get-OwnedPostgres)) { Invoke-PgControl @('-D', ('"'+(Join-Path $DataRoot 'pgdata')+'"'), '-m', 'fast', '-w', 'stop') }
Write-Output 'This installation stopped. Persistent data was retained.'

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
