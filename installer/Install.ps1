param([string]$DataRoot, [int]$Port = 4388, [int]$PgPort = 55432, [string]$DownloadCache, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This package supports Windows x64. ARM64 is not yet tested.' }
$app = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pointerFile = Join-Path $app '.townreporter-install.json'
if (!$DataRoot) {
  if (Test-Path -LiteralPath $pointerFile) { $DataRoot = (Get-Content -LiteralPath $pointerFile -Raw | ConvertFrom-Json).DataRoot }
  else { $DataRoot = Join-Path $env:LOCALAPPDATA ('TownReporter\' + [guid]::NewGuid().ToString('N')) }
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
  # Reserve this private data directory before the first download so a retry resumes it.
  @{ AppRoot=$AppRoot; DataRoot=$DataRoot; Owner=$ownerSid } | ConvertTo-Json | Set-Content -LiteralPath $reservationFile -Encoding UTF8
  @{ DataRoot=$DataRoot } | ConvertTo-Json | Set-Content -LiteralPath $pointerFile -Encoding UTF8
}
$drive = (Get-Item -LiteralPath $DataRoot).PSDrive
if ($null -ne $drive.Free -and $drive.Free -lt 8GB) { throw 'At least 8 GB of free disk space is required for the runtime, browser, build and database. Choose another DataRoot drive or free space.' }
$dependencies = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dependencies.json') -Raw | ConvertFrom-Json
$toolsRoot = Join-Path $DataRoot 'tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-VerifiedDependency($dependency, [string]$name) {
  $zipName = [IO.Path]::GetFileName(([uri]$dependency.url).AbsolutePath)
  $archive = Join-Path $toolsRoot $zipName
  if ($DownloadCache -and (Test-Path -LiteralPath (Join-Path $DownloadCache $zipName))) {
    Copy-Item -LiteralPath (Join-Path $DownloadCache $zipName) -Destination $archive -Force
  } elseif (!(Test-Path -LiteralPath $archive)) {
    Write-Host "Downloading $name $($dependency.version)..."
    $priorProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
    try { Invoke-WebRequest -UseBasicParsing -Uri $dependency.url -OutFile $archive -TimeoutSec 900 }
    finally { $ProgressPreference = $priorProgress }
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $dependency.sha256) {
    throw "Checksum mismatch for $name. Nothing from this archive was run. Remove only $archive and retry."
  }
  $target = Join-Path $toolsRoot $dependency.directory
  $marker = Join-Path $target '.townreporter-extracted.sha256'
  if (Test-Path -LiteralPath $target) {
    if (!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $dependency.sha256) { throw "Incomplete or unowned runtime directory: $target. Move that directory aside and retry; no files were overwritten." }
  } else {
    $staging = Join-Path $toolsRoot ('.extract-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    $extracted = Join-Path $staging $dependency.directory
    if (!(Test-Path -LiteralPath $extracted)) { throw "Unexpected $name archive layout. Extracted files retained at $staging." }
    # Mark the fully extracted directory before its atomic move into the runtime location.
    $dependency.sha256 | Set-Content -LiteralPath (Join-Path $extracted '.townreporter-extracted.sha256') -Encoding ASCII
    Move-Item -LiteralPath $extracted -Destination $target
  }
  return $target
}
$nodeRoot = Get-VerifiedDependency $dependencies.node 'Node.js'
$pgRoot = Get-VerifiedDependency $dependencies.postgres 'PostgreSQL'
$nodeExe = Join-Path $nodeRoot 'node.exe'
$pgBin = Join-Path $pgRoot 'bin'
& $nodeExe --version
if ($LASTEXITCODE -ne 0) { throw 'Node could not start. Check Windows x64 compatibility.' }
& (Join-Path $pgBin 'postgres.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not start. Install the Microsoft Visual C++ x64 Redistributable from https://aka.ms/vs/17/release/vc_redist.x64.exe and run Install again.' }
if (!(Test-Path -LiteralPath $ConfigFile)) {
  if (Test-Path -LiteralPath (Join-Path $DataRoot 'pgdata')) { throw 'Unconfigured database directory exists. Refusing to adopt or replace it.' }
  Assert-PortFree $Port; Assert-PortFree $PgPort
  function New-Secret {
    $bytes = New-Object byte[] 32; $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  }
  [ordered]@{ AppRoot=$AppRoot; DataRoot=$DataRoot; InstanceId=[guid]::NewGuid().ToString('N'); Port=$Port; PgPort=$PgPort; NodeExe=$nodeExe; PgBin=$pgBin; DatabasePassword=(New-Secret); AuthSecret=(New-Secret) } | ConvertTo-Json | Set-Content -LiteralPath $ConfigFile -Encoding UTF8
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
Set-AppEnvironment
$env:DATABASE_URL = ''
$env:NODE_ENV = 'development'
Set-Location -LiteralPath $AppRoot
Write-Host 'Installing locked application dependencies...'
$nativeExit = Invoke-LoggedNative (Join-Path $nodeRoot 'npm.cmd') @('ci') (Join-Path $DataRoot 'dependencies.log')
if ($nativeExit -ne 0) { throw "Dependency installation failed. Read $DataRoot\dependencies.log. Check your internet connection and free disk space." }
Write-Host 'Installing browser retrieval support...'
$nativeExit = Invoke-LoggedNative $nodeExe @((Join-Path $AppRoot 'node_modules\playwright\cli.js'), 'install', 'chromium') (Join-Path $DataRoot 'browser-install.log')
if ($nativeExit -ne 0) { throw "Chromium installation failed. Read $DataRoot\browser-install.log; rerun Install to resume." }
Write-Host 'Building TownReporter. This can take several minutes...'
$nativeExit = Invoke-LoggedNative (Join-Path $nodeRoot 'npm.cmd') @('run', 'build') (Join-Path $DataRoot 'build.log')
if ($nativeExit -ne 0) { throw "Build failed. No new app was started. Read $DataRoot\build.log." }
& $nodeExe (Join-Path $AppRoot 'scripts\install-build-manifest.mjs') write $AppRoot
if ($LASTEXITCODE -ne 0) { throw 'Build identity could not be recorded.' }
& "$PSScriptRoot\Start.ps1" -DataRoot $DataRoot -NoBrowser:$NoBrowser
Write-Host "Installed. Your persistent data and logs are in $DataRoot"
Write-Host 'Create your editor account in the browser, name your paper, then run Configure AI.cmd or sign in to a supported AI provider on the Server page.'

} finally { $lifecycle.ReleaseMutex(); $lifecycle.Dispose() }
