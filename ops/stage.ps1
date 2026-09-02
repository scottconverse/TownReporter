<#
  Stage a build of the development checkout against a copy of REAL production
  data, so the operator can walk the changed screens before anything is
  promoted to the live paper.

  This is the one-command version of the operator's pre-promote check: restore
  the newest production backup into townreporter_dev, build here (so
  migrations meet real data in this checkout first, not on the live paper),
  and start the built server on a local port for a manual walkthrough.

  It never touches port 3000 or the townreporter database. Those belong to
  the live paper and this script is not allowed near them. It only ever
  drops, recreates and restores townreporter_dev.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  The restored backup carries only the real owner's account, whose password
  nobody but the operator knows -- so by default this also upserts a second,
  disposable sign-in (staging@townreporter.test) into townreporter_dev right
  after the restore, via scripts\stage-editor.mjs, so the coordinator can open
  the staged desk too. Pass -StageEditor:$false to skip that. Those
  credentials live ONLY in townreporter_dev and vanish the next time this
  script restores a fresh backup over it -- see docs\staging.md.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Backup <path>
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Port 3100 -NoBuild
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -StageEditor:$false
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Status
    powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Stop
#>
[CmdletBinding()]
param(
  [string]$Backup,
  [int]$Port = 3100,
  [switch]$NoBuild,
  [switch]$AllowDirty,
  [switch]$Stop,
  [switch]$Status,
  [bool]$StageEditor = $true
)

$ErrorActionPreference = "Stop"

$ops = $PSScriptRoot
$app = Split-Path -Parent $ops

# lib-port.ps1 sets $port (case-insensitively the same variable as this
# script's -Port param) as a side effect of dot-sourcing it, so stash the
# requested staging port first and restore it right after -- otherwise
# sourcing it here would silently replace "stage on 3100" with "stage on
# whatever the live app's .env says", which is a different port entirely.
$requestedPort = $Port
. (Join-Path $ops "lib-port.ps1")
$Port = $requestedPort

$backupDir = Join-Path (Split-Path -Parent $app) "townreporter-backups"
$pidFile = Join-Path $ops ".stage.pid"
$stateFile = Join-Path $ops ".stage.json"
$dbName = "townreporter_dev"
$pgPort = 5433
$pgUser = "postgres"

function Say($msg) { Write-Host "  $msg" }
function Die($msg) { Write-Host ""; Write-Host "  STOP. $msg" -ForegroundColor Yellow; Write-Host ""; exit 1 }

function Get-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $scoopPath = Join-Path $env:USERPROFILE "scoop\apps\postgresql\current\bin\$name.exe"
  if (Test-Path $scoopPath) { return $scoopPath }
  Die "$name not found on PATH and not at $scoopPath"
}

function Invoke-External([scriptblock]$Script) {
  <#
    Any external tool's stderr line becomes a terminating NativeCommandError
    under $ErrorActionPreference = "Stop", even when the call itself pipes
    "2>&1 | Out-String" -- PS 5.1 converts the stderr line to an error record
    before that merge runs. Relax to Continue only around the native call and
    judge success from $LASTEXITCODE, same as every other check in this
    script already does.
  #>
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $Script 2>&1 | Out-String
    return @{ Output = $out; ExitCode = $LASTEXITCODE }
  } finally {
    $ErrorActionPreference = $prevEap
  }
}

function Test-PortFree([int]$p) {
  # Test-TownReporterPort (lib-port.ps1): staging always binds 127.0.0.1, so
  # an IPv6-only listener on the same port number from an unrelated program
  # is not a collision and must not block -- or falsely report as still
  # occupied after -Stop -- a staging run.
  return -not (Test-TownReporterPort $p)
}

function Get-StagedPort {
  if (Test-Path $stateFile) {
    try {
      $s = Get-Content $stateFile -Raw | ConvertFrom-Json
      if ($s.port) { return [int]$s.port }
    } catch {
      # fall through to the -Port default
    }
  }
  return $Port
}

if ($Port -eq 3000) {
  Die "Refusing -Port 3000. That port belongs to the live paper."
}

# --- -Stop -------------------------------------------------------------
if ($Stop) {
  if (-not (Test-Path $pidFile)) { Die "No ops\.stage.pid found. Nothing appears to be staged." }
  $procId = (Get-Content $pidFile -Raw).Trim()
  if ($procId -notmatch '^\d+$') { Die "ops\.stage.pid does not contain a plain process id ($procId)." }
  $stagedPort = Get-StagedPort
  Say "stopping staged server, PID $procId (tree kill by PID, nothing else touched)"
  $killResult = Invoke-External { taskkill.exe /PID $procId /T /F }
  Write-Host $killResult.Output
  Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  Remove-Item $stateFile -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  if (Test-PortFree $stagedPort) {
    Say "port $stagedPort is free"
  } else {
    Say "WARNING: port $stagedPort still shows a listener after the kill"
  }
  exit 0
}

# --- -Status -------------------------------------------------------------
if ($Status) {
  if (-not (Test-Path $stateFile)) {
    Say "staging is not up (no ops\.stage.json)"
    exit 0
  }
  $s = Get-Content $stateFile -Raw | ConvertFrom-Json
  $procAlive = $false
  if (Test-Path $pidFile) {
    $procId = (Get-Content $pidFile -Raw).Trim()
    if ($procId -match '^\d+$' -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { $procAlive = $true }
  }
  $listening = -not (Test-PortFree ([int]$s.port))
  Say "staging up: $($procAlive -and $listening)"
  Say "port: $($s.port) (process alive: $procAlive, listening: $listening)"
  Say "version: $($s.version)"
  Say "backup: $($s.backup)"
  Say "started: $($s.started)"
  Say "url: http://127.0.0.1:$($s.port)/desk"
  exit 0
}

# --- full run --------------------------------------------------------------
Set-Location $app
Write-Host ""
Write-Host "  Staging $app (port $Port)"
Write-Host "  ------------------------------------------------------------"

# --- 1. nothing uncommitted -------------------------------------------------
$dirty = (& git status --porcelain) | Where-Object { $_ -notmatch '^\?\?' }
if ($dirty -and -not $AllowDirty) {
  Say "uncommitted tracked changes here:"
  $dirty | ForEach-Object { Say "    $_" }
  Die "Commit or stash them first, or pass -AllowDirty."
}

# --- 2. pick a backup --------------------------------------------------------
if ($Backup) {
  if (-not (Test-Path $Backup)) { Die "Backup file not found: $Backup" }
  $backupFile = Get-Item $Backup
} else {
  if (-not (Test-Path $backupDir)) { Die "Backup directory not found: $backupDir" }
  $backupFile = Get-ChildItem -Path $backupDir -Filter "*.sql" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $backupFile) { Die "No .sql backups found in $backupDir" }
}
$bytes = $backupFile.Length
Say "backup: $($backupFile.Name) ($([math]::Round($bytes/1MB,1)) MB)"
if ($bytes -lt 1MB) { Die "The backup is only $bytes bytes, under 1 MB. Refusing to restore it." }

# --- 3. restore into townreporter_dev, never townreporter -------------------
if ($dbName -ne "townreporter_dev" -or $dbName -eq "townreporter") {
  Die "Internal error: target database resolved to '$dbName', not townreporter_dev."
}
$envDbLine = (Get-Content (Join-Path $app ".env") | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1)
if ($envDbLine) {
  $envDbName = ($envDbLine -split '/')[-1].Trim()
  if ($envDbName -ne $dbName) {
    Die "This checkout's .env DATABASE_URL points at database '$envDbName', not '$dbName'. Refusing to touch it."
  }
}
Say "target database confirmed: $dbName"

$psql = Get-PgTool "psql"

Say "terminating connections to $dbName"
$r = Invoke-External { & $psql -h 127.0.0.1 -p $pgPort -U $pgUser -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$dbName' and pid <> pg_backend_pid();" }
Write-Host $r.Output
if ($r.ExitCode -ne 0) { Die "psql failed terminating connections to $dbName (exit $($r.ExitCode))." }

Say "dropping and recreating $dbName"
$r = Invoke-External { & $psql -h 127.0.0.1 -p $pgPort -U $pgUser -d postgres -c "drop database if exists $dbName;" }
Write-Host $r.Output
if ($r.ExitCode -ne 0) { Die "psql failed dropping $dbName (exit $($r.ExitCode))." }
$r = Invoke-External { & $psql -h 127.0.0.1 -p $pgPort -U $pgUser -d postgres -c "create database $dbName;" }
Write-Host $r.Output
if ($r.ExitCode -ne 0) { Die "psql failed creating $dbName (exit $($r.ExitCode))." }

Say "restoring $($backupFile.Name) into $dbName"
$r = Invoke-External { & $psql -h 127.0.0.1 -p $pgPort -U $pgUser -d $dbName -f $backupFile.FullName }
Write-Host $r.Output
if ($r.ExitCode -ne 0) { Die "psql failed restoring $($backupFile.Name) into $dbName (exit $($r.ExitCode)). $dbName may be partially restored." }

$r = Invoke-External { & $psql -h 127.0.0.1 -p $pgPort -U $pgUser -d $dbName -tAc "select count(*) from articles where published_at is not null" }
if ($r.ExitCode -ne 0) { Die "psql failed reading the story count from $dbName (exit $($r.ExitCode))." }
$storyCount = $r.Output.Trim()
Say "stories with a publish date in $dbName : $storyCount"

# --- 3b. stage a sign-in nobody has to guess ---------------------------------
$stagingCredentialsPrinted = $false
if ($StageEditor) {
  Say "upserting the staging editor account (scripts\stage-editor.mjs)"
  $prevDbUrl = $env:DATABASE_URL
  $env:DATABASE_URL = "postgres://postgres@127.0.0.1:$pgPort/$dbName"
  $r = Invoke-External { node scripts/stage-editor.mjs }
  $env:DATABASE_URL = $prevDbUrl
  Write-Host $r.Output
  if ($r.ExitCode -ne 0) { Die "scripts\stage-editor.mjs failed (exit $($r.ExitCode)). $dbName now holds the restored backup with no staging sign-in." }
  $stagingCredentialsPrinted = $true
} else {
  Say "skipping the staging editor account (-StageEditor:`$false)"
}

# --- 4. build, unless -NoBuild -----------------------------------------------
$outputServer = Join-Path $app ".output\server\index.mjs"
if (-not $NoBuild) {
  Say "building (npm run build; this also runs db:migrate against $dbName)"
  $r = Invoke-External { npm run build }
  $buildOut = $r.Output
  Write-Host $buildOut
  if ($r.ExitCode -ne 0) { Die "npm run build failed (exit $($r.ExitCode)). townreporter_dev now holds the restored backup; the old build (if any) is untouched." }
  if ($buildOut -notmatch [regex]::Escape($dbName)) {
    Die "The build's own DATABASE_URL line did not name $dbName. Refusing to trust this build."
  }
  $applied = [regex]::Matches($buildOut, '\[migrate\] applied [^\r\n]+')
  if ($applied.Count -gt 0) {
    Say "migrations applied against $dbName :"
    foreach ($m in $applied) { Say "    $($m.Value)" }
  } else {
    Say "migrations: nothing new (up to date)"
  }
} else {
  Say "skipping build (-NoBuild)"
  if (-not (Test-Path $outputServer)) { Die "No existing build at .output\server\index.mjs, and -NoBuild was passed." }
}

# --- 5. start the built server -----------------------------------------------
if (-not (Test-PortFree $Port)) {
  Die "Port $Port already has a listener. Run ops\stage.ps1 -Stop first, or pick a different -Port."
}

$version = (Get-Content (Join-Path $app "package.json") -Raw | ConvertFrom-Json).version

$env:DATABASE_URL = "postgres://postgres@127.0.0.1:$pgPort/$dbName"
$env:PORT = "$Port"
$env:HOST = "127.0.0.1"
$env:TOWNREPORTER_TUNNEL = "0"
$env:BETTER_AUTH_URL = "http://127.0.0.1:$Port"
$env:PUBLIC_SITE_URL = "http://127.0.0.1:$Port"
$env:BETTER_AUTH_TRUSTED_ORIGINS = "http://127.0.0.1:$Port"

$outLog = Join-Path $ops "stage.out.log"
$errLog = Join-Path $ops "stage.err.log"
$nodeExe = (Get-Command node -ErrorAction Stop).Source

Say "starting the built server on http://127.0.0.1:$Port"
$proc = Start-Process -FilePath $nodeExe `
  -ArgumentList @("scripts/with-app-env.mjs", "node", ".output/server/index.mjs") `
  -WorkingDirectory $app `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru

Set-Content -Path $pidFile -Value "$($proc.Id)" -Encoding ASCII

$up = $false
for ($i = 0; $i -lt 120; $i++) {
  if (-not (Test-PortFree $Port)) { $up = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $up) { Die "The server did not start listening on $Port within 120s. Check $outLog and $errLog. PID $($proc.Id) may still be running -- ops\stage.ps1 -Stop will clean it up." }
Say "listening on $Port (PID $($proc.Id))"

# --- 6. verify ---------------------------------------------------------------
Write-Host ""
Say "checking"
$fail = @()
$html = ""

try {
  $resp = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 30
  if ($resp.StatusCode -eq 200) { Say "[ OK ] / answers 200" } else { $fail += "/ answered $($resp.StatusCode)" }
  $html = $resp.Content
} catch {
  $fail += "/ did not answer: $($_.Exception.Message)"
}

if ($html) {
  $m = [regex]::Match($html, '/assets/[A-Za-z0-9_.-]+\.js')
  if (-not $m.Success) {
    $fail += "the served page names no script asset at all"
  } else {
    try {
      $assetResp = Invoke-WebRequest "http://127.0.0.1:$Port$($m.Value)" -UseBasicParsing -TimeoutSec 30
      if ($assetResp.StatusCode -eq 200) { Say "[ OK ] entry asset serves ($($m.Value))" }
      else { $fail += "entry asset $($m.Value) answered $($assetResp.StatusCode)" }
    } catch { $fail += "entry asset check failed: $($_.Exception.Message)" }
  }
}

$versionAssetDir = Join-Path $app ".output\public\assets"
$versionFile = $null
if (Test-Path $versionAssetDir) {
  $versionFile = Get-ChildItem -Path $versionAssetDir -Filter "version-*.js" -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $versionFile) {
  $fail += "no version-*.js asset found under .output\public\assets"
} else {
  try {
    $vResp = Invoke-WebRequest "http://127.0.0.1:$Port/assets/$($versionFile.Name)" -UseBasicParsing -TimeoutSec 30
    if ($vResp.StatusCode -eq 200 -and $vResp.Content -match [regex]::Escape($version)) {
      Say "[ OK ] served version asset reads $version ($($versionFile.Name))"
    } else {
      $fail += "version asset $($versionFile.Name) answered $($vResp.StatusCode) and did not confirm version $version"
    }
  } catch { $fail += "version asset check failed: $($_.Exception.Message)" }
}

Write-Host ""
if ($fail.Count -gt 0) {
  $fail | ForEach-Object { Write-Host "  [FAIL] $_" -ForegroundColor Yellow }
  Die "Staging came up but did not verify clean. PID $($proc.Id) is still running on $Port -- inspect $outLog / $errLog, or run ops\stage.ps1 -Stop."
}

$state = [ordered]@{
  backup  = $backupFile.Name
  version = $version
  started = (Get-Date -Format o)
  port    = $Port
}
$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding ASCII

Write-Host "  STAGING UP: http://127.0.0.1:$Port/desk -- walk the changed screens, then run ops\stage.ps1 -Stop" -ForegroundColor Green
Write-Host "  stories with a publish date: $storyCount"
Write-Host "  version: $version   backup: $($backupFile.Name)"
if ($stagingCredentialsPrinted) {
  Write-Host "  staging sign-in:  staging@townreporter.test / staging-walk-2026"
  Write-Host "  (exists only in $dbName -- gone on the next restore; see docs\staging.md)"
}
Write-Host ""
