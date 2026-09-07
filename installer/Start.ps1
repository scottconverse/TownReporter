param([string]$DataRoot, [switch]$NoBrowser)
. "$PSScriptRoot\Common.ps1"
$lifecycle = Enter-InstallLifecycle
try {

$config = Read-InstallConfig
if (Test-Path -LiteralPath (Join-Path $AppRoot '.env')) { throw 'Unexpected .env in installed source; refusing ambiguous environment configuration.' }
& $config.NodeExe (Join-Path $AppRoot 'scripts\install-build-manifest.mjs') verify $AppRoot
if ($LASTEXITCODE -ne 0) { throw 'Build identity is not current. Run Install TownReporter.cmd again.' }
if (!(Get-OwnedApp)) {
  Assert-PortFree $config.Port
  if (!(Get-OwnedPostgres)) {
    Assert-PortFree $config.PgPort
    Invoke-PgControl @('-D', ('"'+(Join-Path $DataRoot 'pgdata')+'"'), '-l', ('"'+(Join-Path $DataRoot 'postgres.log')+'"'), '-w', 'start')
  }
  Set-AppEnvironment
  Set-Location -LiteralPath $AppRoot
  & $config.NodeExe (Join-Path $AppRoot 'scripts\migrate.mjs') *> (Join-Path $DataRoot 'migrate.log')
  if ($LASTEXITCODE -ne 0) { throw "Migration failed. No app was started. Read $DataRoot\migrate.log." }
  $identityDir = Join-Path $AppRoot '.output\public\.well-known'
  New-Item -ItemType Directory -Force -Path $identityDir | Out-Null
  $manifest = Get-Content -LiteralPath (Join-Path $AppRoot '.output\install-build.json') -Raw | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $identityDir 'townreporter-instance.json'), (@{ instanceId=$config.InstanceId; sourceHash=$manifest.sourceHash; version=$manifest.version } | ConvertTo-Json))
  $entry = Join-Path $AppRoot '.output\server\index.mjs'
  $process = Start-Process -FilePath $config.NodeExe -ArgumentList @(('"'+$entry+'"')) -WindowStyle Hidden -WorkingDirectory $AppRoot -RedirectStandardOutput (Join-Path $DataRoot 'app.out.log') -RedirectStandardError (Join-Path $DataRoot 'app.err.log') -PassThru
  $observed = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
  if (!$observed) { throw "Server exited before startup. Read $DataRoot\app.err.log." }
  @{ ProcessId=$process.Id; Created=$observed.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataRoot 'app-process.json')
}
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try { & "$PSScriptRoot\Health.ps1" -DataRoot $DataRoot; $ready = $true; break } catch { Start-Sleep -Seconds 2 }
  if (!(Get-OwnedApp)) { throw "Server exited. Read $DataRoot\app.err.log." }
}
if (!$ready) { throw "Server did not become ready in 120 seconds. It may still be starting; run Health.ps1 or read $DataRoot\app.err.log." }
$url = "http://127.0.0.1:$($config.Port)/desk"
Write-Host "TownReporter is ready: $url"
if (!$NoBrowser) { Start-Process $url }

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
