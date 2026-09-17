<#
  Wakes the desk's background work: rechecks watched sources and finishes any
  queued jobs. Registered to run every 5 minutes.

  Reads CRON_SECRET straight from .env so the secret lives in exactly one place.
  Without the header the route returns 403; with CRON_SECRET unset it returns
  503 and does nothing, which is the deliberate fail-closed default.
#>
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $app ".env"
if (-not (Test-Path $envFile)) { exit 0 }

$secret = (Get-Content $envFile |
  Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } |
  Select-Object -First 1) -replace '^\s*CRON_SECRET\s*=\s*', ''
if (-not $secret) { exit 0 }

$port = (Get-Content $envFile |
  Where-Object { $_ -match '^\s*PORT\s*=' } |
  Select-Object -First 1) -replace '^\s*PORT\s*=\s*', ''
if (-not $port) { $port = "3000" }

try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/cron/monitors" `
    -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 600
  Write-Output ("[cron] " + ($r | ConvertTo-Json -Compress))
} catch {
  # The app being down is normal (reboot, redeploy). Do not fail the task.
  Write-Output "[cron] skipped: $($_.Exception.Message)"
}
