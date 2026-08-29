<#
  Starts the Cloudflare tunnel with no visible console.

  The scheduled task used to run `cloudflared.exe` directly, so Windows gave it
  a console window that sat open on the desktop for as long as the tunnel ran —
  a wall of connection logs with nowhere to go and nothing to do but be closed
  by accident, which takes the paper offline.

  This launches it hidden and sends the log to a file instead, so the output is
  still there when something goes wrong.
#>
$ErrorActionPreference = "Stop"
$app = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $app "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$log = Join-Path $logDir "cloudflared.log"
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) {
  Move-Item $log (Join-Path $logDir "cloudflared.prev.log") -Force
}

# Already up: do nothing. The watchdog calls this, and starting a second
# tunnel for the same name would fight the first for connections.
if (@(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue).Count -gt 0) {
  return
}

$exe = "$env:USERPROFILE\scoop\shims\cloudflared.exe"
if (-not (Test-Path $exe)) { $exe = (Get-Command cloudflared -ErrorAction Stop).Source }

Start-Process -FilePath $exe `
  -ArgumentList "--no-autoupdate", "tunnel", "run", "townreporter" `
  -WindowStyle Hidden `
  -RedirectStandardOutput $log `
  -RedirectStandardError (Join-Path $logDir "cloudflared.err.log")
