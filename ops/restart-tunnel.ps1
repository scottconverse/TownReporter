<#
  Restarts the Cloudflare tunnel.

  The paper keeps serving on this machine throughout; only the route in from
  the internet drops, for a few seconds.
#>
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "restart.log"
function Write-Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content $log -Encoding UTF8 }

Write-Log "tunnel restart requested"

<#
  Wait before cutting the line.

  When this is started from the ops page, the page's own reply has to travel
  out through the tunnel. Killing cloudflared first meant the answer never
  arrived: the restart worked perfectly and the browser reported an error,
  which is the worst of both. A few seconds is enough for the response to
  leave.
#>
Start-Sleep -Seconds 4

# Stopping the scheduled task ends the cloudflared it started -- and ONLY
# that one. The old version swept every cloudflared.exe on the machine by
# image name, which on a box running more than one install means killing
# tunnels that are not this install's to touch. Kill-by-image-name has bitten
# this machine before; it does not come back.
try { Stop-ScheduledTask -TaskName "TownReporter Tunnel" -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName "TownReporter Tunnel"

for ($i = 0; $i -lt 30; $i++) {
  if (@(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue).Count -gt 0) { break }
  Start-Sleep -Seconds 1
}
$n = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue).Count
Write-Log "tunnel processes after restart: $n"
