<#
  Is the paper up? Answered in plain words, for a human, in a console.

  The Server page at /desk/ops says all of this better, but it lives inside the
  paper, so it cannot answer when the paper is the thing that is down. This can.

  Read-only. It starts nothing and stops nothing.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI, so
  anything fancier comes out as mojibake in a console window.
#>
$ErrorActionPreference = "SilentlyContinue"
$app = Split-Path -Parent $PSScriptRoot

function Read-EnvValue($name, $fallback) {
  $file = Join-Path $app ".env"
  if (-not (Test-Path $file)) { return $fallback }
  $line = Get-Content $file | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { return $fallback }
  return ($line -replace "^\s*$name\s*=\s*", "").Trim()
}

function Show($label, $ok, $detail) {
  $mark = if ($ok) { "  OK  " } else { " DOWN " }
  Write-Host ("  [" + $mark + "] " + $label.PadRight(20) + $detail)
}

$port = Read-EnvValue "PORT" "3000"
$site = Read-EnvValue "PUBLIC_SITE_URL" "https://townreporter.org"

Write-Host ""
Write-Host "  TownReporter, as seen from this machine"
Write-Host "  --------------------------------------"

# Database
$pg = @(Get-NetTCPConnection -LocalPort 5433 -State Listen)
Show "Database" ($pg.Count -gt 0) $(if ($pg.Count) { "answering on 5433" } else { "nothing on port 5433" })

# The app
$appOk = $false
$appDetail = "no answer on port $port"
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 15
  $appOk = ($r.StatusCode -eq 200)
  $appDetail = "answered $($r.StatusCode) on port $port"
} catch { }
Show "The paper" $appOk $appDetail

# The tunnel process
$cf = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
Show "Tunnel" ($cf.Count -gt 0) $(if ($cf.Count) { "$($cf.Count) process(es) running" } else { "cloudflared is not running" })

# The public address
$pubOk = $false
$pubDetail = "no answer"
try {
  $r = Invoke-WebRequest -Uri $site -UseBasicParsing -TimeoutSec 25
  $pubOk = ($r.StatusCode -eq 200)
  $pubDetail = "$site answered $($r.StatusCode)"
} catch {
  $pubDetail = "$site did not answer"
}
Show "Public site" $pubOk $pubDetail

# The watchdog
$wd = Get-ScheduledTaskInfo -TaskName "TownReporter Watchdog" -ErrorAction SilentlyContinue
if ($wd -and $wd.LastRunTime) {
  $mins = [int]((Get-Date) - $wd.LastRunTime).TotalMinutes
  Show "Watchdog" ($mins -le 15) "last ran $mins minute(s) ago"
} else {
  Show "Watchdog" $false "never run, or the task is missing"
}

Write-Host ""
if ($appOk -and $pubOk) {
  Write-Host "  Everything is up. Nothing to do."
} elseif ($appOk -and -not $pubOk) {
  Write-Host "  The paper is running but the outside world cannot reach it."
  Write-Host "  Try option 3, restart the tunnel."
} elseif (-not $appOk -and $pg.Count -gt 0) {
  Write-Host "  The database is up but the paper is not. Try option 4."
} elseif ($pg.Count -eq 0) {
  Write-Host "  The database is not running, so nothing else can be. Try option 4."
}
Write-Host ""
Write-Host "  The watchdog also fixes most of this by itself within five minutes."
Write-Host ""
