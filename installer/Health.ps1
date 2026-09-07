param([string]$DataRoot)
. "$PSScriptRoot\Common.ps1"
$config = Read-InstallConfig
if (!(Get-OwnedApp)) { throw 'This installation server is not running. Use Start TownReporter.cmd.' }
if (!(Get-OwnedPostgres)) { throw 'This installation database is not running. Use Start TownReporter.cmd.' }
$manifest = Get-Content -LiteralPath (Join-Path $AppRoot '.output\install-build.json') -Raw | ConvertFrom-Json
$identity = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.Port)/.well-known/townreporter-instance.json" -TimeoutSec 5
if ($identity.instanceId -ne $config.InstanceId -or $identity.sourceHash -ne $manifest.sourceHash) { throw 'HTTP listener is not this build and installation.' }
$response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($config.Port)/" -TimeoutSec 10
if ($response.StatusCode -ne 200) { throw 'The newspaper page is not ready.' }
if ($response.Content -notmatch [regex]::Escape($manifest.version)) { throw 'The running newspaper does not display this build version.' }
Write-Output "Ready: TownReporter $($manifest.version), this installation's HTTP server and PostgreSQL are running. AI connection must be tested on the Server page."
