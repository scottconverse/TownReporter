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
# Reads the port from the config files, not postgres.exe -C port: a boot-start
# task has a full admin token and postgres.exe refuses it (Oct 16 boot-start).
# Last active `port = N` wins; auto.conf is read after postgresql.conf; default 5432.
# An active include falls back to postgres.exe -C port and is named if that fails.
function Get-TownReporterClusterPort {
  param([Parameter(Mandatory = $true)][string]$DataDir, [string]$PgBin)
  $port = $null
  $include = $null
  foreach ($name in @('postgresql.conf', 'postgresql.auto.conf')) {
    $file = Join-Path $DataDir $name
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    foreach ($raw in Get-Content -LiteralPath $file) {
      # A # outside single quotes starts a comment. An escaped '' inside quotes toggles twice, so it stays inside.
      $code = $raw
      $inQuote = $false
      for ($i = 0; $i -lt $raw.Length; $i++) {
        if ($raw[$i] -eq "'") { $inQuote = !$inQuote }
        elseif ($raw[$i] -eq '#' -and !$inQuote) { $code = $raw.Substring(0, $i); break }
      }
      if (!$include -and $code -match '^\s*include(_if_exists|_dir)?\b') { $include = $code.Trim() }
      if ($code -match "^\s*port(\s*=\s*|\s+)(.*?)\s*$") {
        $value = $matches[2]
        if ($value -match "^'((?:[^']|'')*)'$") { $value = $matches[1] -replace "''", "'" }
        if ($value -notmatch '^\d+$') { throw "PostgreSQL port setting in $file is not a whole number ($value); refusing operations." }
        $port = [int]$value
      }
    }
  }
  if ($include) {
    $why = "PostgreSQL config in $DataDir has an active $include line, so the port cannot be read from the files"
    if (!$PgBin) { throw "$why; refusing operations." }
    $out = & (Join-Path $PgBin 'postgres.exe') -D $DataDir -C port
    if ($LASTEXITCODE -ne 0) { throw "$why, and postgres.exe -C port failed (exit $LASTEXITCODE); refusing operations." }
    $value = ($out | Out-String).Trim()
    if ($value -notmatch '^\d+$') { throw "$why, and postgres.exe -C port printed '$value' instead of a port; refusing operations." }
    return [int]$value
  }
  if ($null -eq $port) { return 5432 }
  return $port
}

function Assert-TownReporterLegacyOwnership {
  param([switch]$Watchdog)
  $root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
  if ($env:TOWNREPORTER_DATA_ROOT -or (Test-Path -LiteralPath (Join-Path $root '.townreporter-install.json'))) {
    throw 'This is a portable install. Use its installer/Start.ps1, Stop.ps1 and Health.ps1; legacy machine operations are disabled.'
  }
  if ($Watchdog -and $env:WATCHDOG_TEST_MODE -eq '1') {
    if ($env:WATCHDOG_APP_PORT -notmatch '^\d+$' -or $env:WATCHDOG_PG_PORT -notmatch '^\d+$' -or [int]$env:WATCHDOG_APP_PORT -lt 1024 -or [int]$env:WATCHDOG_PG_PORT -lt 1024 -or $env:WATCHDOG_APP_PORT -eq '3000' -or $env:WATCHDOG_PG_PORT -eq '5433' -or $env:WATCHDOG_START_SCRIPT -ne 'scripts/ci-watchdog-start.ps1') { throw 'Invalid disposable watchdog test configuration.' }
    # WATCHDOG_STAGE_APP points the staged-copy section at another checkout so
    # a harness can watch a disposable one instead of this machine's. Unset is
    # the normal case and means this checkout. Checked here as well as honored
    # only in test mode (see ops\watchdog.ps1): a value that is not an existing
    # absolute directory stops the run rather than being passed on to
    # ops\start-stage.ps1, which would have to fail later and less clearly.
    if ($env:WATCHDOG_STAGE_APP) {
      if (![IO.Path]::IsPathRooted($env:WATCHDOG_STAGE_APP) -or !(Test-Path -LiteralPath $env:WATCHDOG_STAGE_APP -PathType Container)) {
        throw 'WATCHDOG_STAGE_APP must be an existing absolute directory.'
      }
    }
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
  # Oct 16 boot-start: read the port from the config files; postgres.exe -C refuses a full admin token.
  $configuredPort = Get-TownReporterClusterPort -DataDir $values['TOWNREPORTER_PG_DATA'] -PgBin $values['TOWNREPORTER_PG_BIN']
  if ([string]$configuredPort -ne [string]$database.Port) { throw 'Configured PostgreSQL cluster port does not match DATABASE_URL; refusing operations.' }
  $script:OwnedPgBin = $values['TOWNREPORTER_PG_BIN']
  $script:OwnedPgData = $values['TOWNREPORTER_PG_DATA']
  $script:OwnedPgPort = $database.Port
}
