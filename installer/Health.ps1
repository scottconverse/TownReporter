param([string]$DataRoot)
. "$PSScriptRoot\Common.ps1"
$config = Read-InstallConfig
$appProcess = Get-OwnedApp
$databaseProcess = Get-OwnedPostgres
if (!$appProcess) { throw 'This installation server is not running. Use Start TownReporter.cmd.' }
if (!$databaseProcess) { throw 'This installation database is not running. Use Start TownReporter.cmd.' }
Assert-OwnedListener $config.Port $appProcess.ProcessId
Assert-OwnedListener $config.PgPort $databaseProcess.ProcessId
& $config.NodeExe (Join-Path $AppRoot 'scripts\install-build-manifest.mjs') verify $AppRoot
if ($LASTEXITCODE -ne 0) { throw 'Source or output differs from the verified installation build.' }
$manifest = Get-Content -LiteralPath (Join-Path $AppRoot '.output\install-build.json') -Raw | ConvertFrom-Json
$state = Get-Content -LiteralPath (Join-Path $DataRoot 'app-process.json') -Raw | ConvertFrom-Json
if ($state.SourceHash -ne $manifest.sourceHash -or $state.Version -ne $manifest.version) { throw 'The running process was started from another build. Stop and Start this installation.' }
$response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($config.Port)/" -TimeoutSec 10
if ($response.StatusCode -ne 200) { throw 'The newspaper page is not ready.' }
if ($response.Content -notmatch [regex]::Escape($manifest.version)) { throw 'The running newspaper does not display this build version.' }
Write-Output "Ready: TownReporter $($manifest.version), this installation's HTTP server and PostgreSQL are running. AI connection must be tested on the Server page."
