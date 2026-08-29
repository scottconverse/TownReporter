<#
  Restarts the paper from outside itself.

  The ops dashboard runs inside the server it is restarting, so it cannot do
  this directly: the moment it stops the process, it stops too, and whatever
  came next never runs. This script is launched detached and then waits, so the
  request that asked for the restart has already been answered by the time the
  old process dies.

  Matches by COMMAND LINE, never by image name: node.exe and cloudflared.exe
  both run on this machine for other software, and a blanket stop-by-name has
  taken down unrelated things here before.
#>

. (Join-Path $PSScriptRoot "lib-port.ps1")
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "restart.log"

function Write-Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content $log -Encoding UTF8 }

# Let the HTTP response that triggered this reach the browser first. Without
# the pause the operator's own page load is the thing that gets killed, and the
# dashboard looks like it crashed rather than like it worked.
Start-Sleep -Seconds 2
Write-Log "restart requested"

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*.output/server/index.mjs*" } |
  ForEach-Object {
    Write-Log "  stopping PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 2

<#
  Launch the start script DETACHED.

  Called inline with `&`, the server it spawns inherits this script's console
  handles and this script never returns -- it sits holding the pipe for as long
  as the paper runs. Harmless when nothing is waiting on it, fatal when
  something is: the same mistake made the watchdog hang for seven minutes.
#>
$shell = Get-Command pwsh -ErrorAction SilentlyContinue
$exe = if ($shell) { $shell.Source } else { "powershell.exe" }
Start-Process -FilePath $exe `
  -ArgumentList "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", `
                "-File", (Join-Path $PSScriptRoot "start-townreporter.ps1") `
  -WindowStyle Hidden

for ($i = 0; $i -lt 45; $i++) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
  Start-Sleep -Seconds 1
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Log "back up"
} else {
  Write-Log "FAILED to come back up"
}
