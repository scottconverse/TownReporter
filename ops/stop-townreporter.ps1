<#
  Stops TownReporter and its Postgres.

  Matches processes by COMMAND LINE, never by image name: `node.exe` and
  `postgres.exe` both run on this machine for other things, and a blanket
  stop-by-name has taken down unrelated software here before.
#>
$app = Split-Path -Parent $PSScriptRoot

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*.output/server/index.mjs*" } |
  ForEach-Object {
    Write-Host "stopping app PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

$bin  = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
$data = "$env:USERPROFILE\scoop\persist\postgresql\data"
if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "stopping Postgres on 5433"
  & "$bin\pg_ctl.exe" -D $data stop -m fast
}
