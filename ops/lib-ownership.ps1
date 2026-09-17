# Legacy machine operations are opt-in, bound to one checkout and one explicit cluster.
function Assert-TownReporterTaskOwnership([string]$Name, [string]$Script) {
  $root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  $expected = Join-Path (Join-Path $root 'ops') $Script
  $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
  $actions = @($task.Actions)
  if ($actions.Count -ne 1 -or !($actions[0].Arguments -replace '/', '\').Contains(('"' + $expected + '"'))) {
    throw "Scheduled task $Name does not point to this exact installation script; no task was changed."
  }
}
function Assert-TownReporterLegacyOwnership {
  param([switch]$Watchdog)
  $root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  if ($env:TOWNREPORTER_DATA_ROOT -or (Test-Path -LiteralPath (Join-Path $root '.townreporter-install.json'))) {
    throw 'This is a portable install. Use its installer/Start.ps1, Stop.ps1 and Health.ps1; legacy machine operations are disabled.'
  }
  if ($Watchdog -and $env:WATCHDOG_TEST_MODE -eq '1') {
    if ($env:WATCHDOG_APP_PORT -notmatch '^\d+$' -or $env:WATCHDOG_PG_PORT -notmatch '^\d+$' -or [int]$env:WATCHDOG_APP_PORT -lt 1024 -or [int]$env:WATCHDOG_PG_PORT -lt 1024 -or $env:WATCHDOG_APP_PORT -eq '3000' -or $env:WATCHDOG_PG_PORT -eq '5433' -or $env:WATCHDOG_START_SCRIPT -ne 'scripts/ci-watchdog-start.ps1') { throw 'Invalid disposable watchdog test configuration.' }
    return
  }
  $values = @{}
  $envFile = Join-Path $root '.env'
  if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
      if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $values[$matches[1]] = $matches[2].Trim('"', "'") }
    }
  }
  if ($values['TOWNREPORTER_LEGACY_OPS'] -ne '1' -or $values['TOWNREPORTER_LEGACY_ROOT'] -cne $root) {
    throw 'Legacy operations are disabled. An operator must explicitly configure TOWNREPORTER_LEGACY_OPS=1 and TOWNREPORTER_LEGACY_ROOT for this exact checkout in .env.'
  }
  if ($values['PORT'] -notmatch '^\d+$' -or [int]$values['PORT'] -lt 1024) { throw 'Legacy operations require an explicit valid PORT in .env.' }
  $database = $null
  if (![uri]::TryCreate($values['DATABASE_URL'], [UriKind]::Absolute, [ref]$database) -or $database.Scheme -notin @('postgres', 'postgresql') -or !$database.IsLoopback -or $database.Port -lt 1024) { throw 'Legacy operations require an explicit loopback DATABASE_URL and port.' }
  foreach ($key in @('TOWNREPORTER_PG_BIN', 'TOWNREPORTER_PG_DATA')) {
    if (!$values[$key] -or ![IO.Path]::IsPathRooted($values[$key]) -or !(Test-Path -LiteralPath $values[$key])) { throw "Legacy operations require an existing absolute $key in .env; no default cluster is adopted." }
    if ((Get-Item -LiteralPath $values[$key]).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Legacy database paths must not be junctions.' }
  }
  if (!(Test-Path -LiteralPath (Join-Path $values['TOWNREPORTER_PG_DATA'] 'PG_VERSION'))) { throw 'Configured legacy PostgreSQL data directory is not initialized.' }
  $configuredPort = & (Join-Path $values['TOWNREPORTER_PG_BIN'] 'postgres.exe') -D $values['TOWNREPORTER_PG_DATA'] -C port
  if ($LASTEXITCODE -ne 0 -or [string]$configuredPort -ne [string]$database.Port) { throw 'Configured PostgreSQL cluster port does not match DATABASE_URL; refusing operations.' }
  $script:OwnedPgBin = $values['TOWNREPORTER_PG_BIN']
  $script:OwnedPgData = $values['TOWNREPORTER_PG_DATA']
  $script:OwnedPgPort = $database.Port
}
