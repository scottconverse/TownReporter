param([string]$DataRoot, [int]$Port = 4388, [int]$PgPort = 15432, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This package supports Windows x64. ARM64 is not yet tested.' }
$app = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pointerFile = Join-Path $app '.townreporter-install.json'
if ($DataRoot -and (Test-Path -LiteralPath $pointerFile)) {
  $recordedRoot = (Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json).DataRoot
  if ([IO.Path]::GetFullPath($recordedRoot) -ine [IO.Path]::GetFullPath($DataRoot)) {
    throw 'This source folder already belongs to another data directory. Extract a separate package folder for a second installation. Nothing was changed.'
  }
}
if (!$DataRoot) {
  if (Test-Path -LiteralPath $pointerFile) { $DataRoot = (Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json).DataRoot }
  else { $DataRoot = Join-Path $env:LOCALAPPDATA ('TownReporter\' + [guid]::NewGuid().ToString('N').Substring(0, 8)) }
}
. "$PSScriptRoot\Common.ps1"
$lifecycle = Enter-InstallLifecycle
try {

if (Test-Path -LiteralPath (Join-Path $AppRoot '.env')) { throw 'This source directory contains .env. Extract a clean release into another folder; existing settings were not changed.' }
if ($Port -lt 1024 -or $Port -gt 65535 -or $PgPort -lt 1024 -or $PgPort -gt 65535 -or $Port -eq $PgPort) { throw 'Choose distinct app and database ports from 1024 through 65535.' }
$reservationFile = Join-Path $DataRoot 'installation-reservation.json'
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (Test-Path -LiteralPath $ConfigFile) {
  $config = Read-InstallConfig
  if (Get-OwnedApp) { throw 'TownReporter is running. Stop this installation before reinstalling. Nothing was changed.' }
} elseif (Test-Path -LiteralPath $reservationFile) {
  $reservation = Get-Content -LiteralPath $reservationFile -Raw | ConvertFrom-Json
  if ($reservation.AppRoot -cne $AppRoot -or $reservation.DataRoot -cne $DataRoot -or $reservation.Owner -ne $ownerSid) { throw 'This data directory is reserved by another installation or owner. Nothing was changed.' }
} elseif ((Test-Path -LiteralPath $DataRoot) -and @(Get-ChildItem -LiteralPath $DataRoot -Force | Where-Object Name -ne 'providers.json').Count) {
  throw 'Choose an empty data directory. Existing unowned files were not changed.'
}
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
Protect-LocalPath $DataRoot
foreach ($file in @($ConfigFile, (Join-Path $DataRoot 'providers.json'))) { if (Test-Path -LiteralPath $file) { Protect-LocalPath $file } }
if (!(Test-Path -LiteralPath $ConfigFile)) {
  Assert-PortFree $Port; Assert-PortFree $PgPort
  # Reserve this private data directory before initialization so a retry resumes it.
  @{ AppRoot=$AppRoot; DataRoot=$DataRoot; Owner=$ownerSid } | ConvertTo-Json | Set-Content -LiteralPath $reservationFile -Encoding UTF8
  @{ DataRoot=$DataRoot } | ConvertTo-Json | Set-Content -LiteralPath $pointerFile -Encoding UTF8
}
$payload = [IO.Path]::GetFullPath((Join-Path $AppRoot '..'))
$nodeExe = Join-Path $payload 'node\node.exe'
$pgBin = Join-Path $payload 'pgsql\bin'
$browsersPath = Join-Path $payload 'chromium'
foreach ($required in @($nodeExe, (Join-Path $pgBin 'postgres.exe'), (Join-Path $pgBin 'initdb.exe'), $browsersPath, (Join-Path $AppRoot '.output\server\index.mjs'))) {
  if (!(Test-Path -LiteralPath $required)) { throw "Incomplete offline payload: $required. Obtain a complete Setup.exe; no download or build will be attempted." }
}
& $nodeExe (Join-Path $AppRoot 'scripts\install-build-manifest.mjs') verify $AppRoot
if ($LASTEXITCODE -ne 0) { throw 'Packaged build identity is invalid. Obtain a complete Setup.exe.' }
& $nodeExe --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Node runtime could not start.' }
& (Join-Path $pgBin 'postgres.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Bundled PostgreSQL runtime could not start. The Setup.exe payload may be incomplete.' }
if (!(Test-Path -LiteralPath $ConfigFile)) {
  if (Test-Path -LiteralPath (Join-Path $DataRoot 'pgdata')) { throw 'Unconfigured database directory exists. Refusing to adopt or replace it.' }
  Assert-PortFree $Port; Assert-PortFree $PgPort
  function New-Secret {
    $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  }
  [ordered]@{ AppRoot=$AppRoot; DataRoot=$DataRoot; InstanceId=[guid]::NewGuid().ToString('N'); Port=$Port; PgPort=$PgPort; NodeExe=$nodeExe; PgBin=$pgBin; BrowsersPath=$browsersPath; DatabasePassword=(New-Secret); AuthSecret=(New-Secret) } | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding UTF8
}
$config = Read-InstallConfig
if (Get-OwnedApp) { throw 'TownReporter is running. Use Stop TownReporter.cmd before reinstalling or rebuilding. Your database will be kept.' }
@{ DataRoot=$DataRoot } | ConvertTo-Json | Set-Content -LiteralPath $pointerFile -Encoding UTF8
$pgData = Join-Path $DataRoot 'pgdata'
if (!(Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  if ((Test-Path -LiteralPath $pgData) -and @(Get-ChildItem -LiteralPath $pgData -Force).Count) { throw 'Incomplete database initialization. Data was preserved; inspect initialize.log before recovery.' }
  $passwordFile = Join-Path $DataRoot 'init-password.tmp'
  try {
    [IO.File]::WriteAllText($passwordFile, $config.DatabasePassword)
    & (Join-Path $config.PgBin 'initdb.exe') -D $pgData -U townreporter --pwfile=$passwordFile --auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C *> (Join-Path $DataRoot 'initialize.log')
    if ($LASTEXITCODE -ne 0) { throw "Database initialization failed. Read $DataRoot\initialize.log." }
  } finally { if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile } }
}
foreach ($required in @('PG_VERSION', 'postgresql.conf', 'pg_hba.conf', 'global\pg_control')) {
  if (!(Test-Path -LiteralPath (Join-Path $pgData $required))) { throw "Incomplete database initialization ($required missing). Data was preserved; inspect initialize.log before recovery." }
}
# Converge configuration even if the previous run stopped just after initdb succeeded.
@"
listen_addresses = '127.0.0.1'
port = $($config.PgPort)
max_connections = 40
shared_buffers = '128MB'
password_encryption = 'scram-sha-256'
"@ | Set-Content -LiteralPath (Join-Path $pgData 'townreporter.conf') -Encoding ASCII
$postgresConfig = Join-Path $pgData 'postgresql.conf'
if ((Get-Content -LiteralPath $postgresConfig -Raw) -notmatch "(?m)^include = 'townreporter.conf'\s*$") {
  "`ninclude = 'townreporter.conf'" | Add-Content -LiteralPath $postgresConfig -Encoding ASCII
}
if (!(Get-OwnedPostgres)) {
  Assert-PortFree $config.PgPort
  Invoke-PgControl @('-D', ('"'+$pgData+'"'), '-l', ('"'+(Join-Path $DataRoot 'postgres.log')+'"'), '-w', 'start')
}
$env:PGPASSWORD = $config.DatabasePassword
try {
  $exists = & (Join-Path $config.PgBin 'psql.exe') -h 127.0.0.1 -p $config.PgPort -U townreporter -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='townreporter'"
  if ($LASTEXITCODE -ne 0) { throw 'Could not authenticate to this installation database.' }
  if ($exists -ne '1') {
    & (Join-Path $config.PgBin 'createdb.exe') -h 127.0.0.1 -p $config.PgPort -U townreporter townreporter
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the application database.' }
  }
} finally { $env:PGPASSWORD = $null }
& "$PSScriptRoot\Start.ps1" -DataRoot $DataRoot -NoBrowser:$NoBrowser
Write-Host "Installed. Your persistent data and logs are in $DataRoot"
# Unit CJ (0.6.80): a fresh, ownerless desk generates a one-time setup code at
# boot (see src/lib/news/setup-code.server.ts) and only the account that types it can
# become the owner. Start.ps1 has already waited for readiness above, so the
# file is there by now on a truly fresh install. An install that already had
# an owner (an upgrade, or a re-run of Install.ps1 on existing data) never
# writes this file -- silently correct, nothing to print.
$setupCodePath = Join-Path $DataRoot 'logs\SETUP-CODE.txt'
if (Test-Path -LiteralPath $setupCodePath) {
  $setupCode = (Get-Content -LiteralPath $setupCodePath -Raw).Trim()
  Write-Host ''
  Write-Host '=========================================================='
  Write-Host "  FIRST-OWNER SETUP CODE (one time): $setupCode"
  Write-Host "  Also saved at: $setupCodePath"
  Write-Host '  You will be asked for this code when you create the'
  Write-Host '  first editor account in the browser. It is deleted once'
  Write-Host '  used, and this message will not be shown again.'
  Write-Host '=========================================================='
  Write-Host ''
}
$setupPathFile = Join-Path $AppRoot '.townreporter-setup-code-path.txt'
[IO.File]::WriteAllText($setupPathFile, $setupCodePath, (New-Object Text.UTF8Encoding($false)))
Write-Host 'Create your editor account in the browser, name your paper, then run Configure AI.cmd or sign in to a supported AI provider on the Server page.'

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
