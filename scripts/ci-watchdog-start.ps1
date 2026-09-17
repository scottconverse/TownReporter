<#
  TEST-003: the app-start half of the watchdog's CI runtime proof.

  The real start path (ops/start-townreporter.ps1) also brings up this
  machine's Postgres from a scoop install that does not exist on a CI runner,
  so the watchdog test job points WATCHDOG_START_SCRIPT at this file instead
  of the production one. This script does only the part the watchdog test
  actually exercises: launch the already-built server, detached, listening on
  WATCHDOG_APP_PORT. No Postgres, no scheduled tasks, nothing production does
  around it -- those are proven separately by the CI jobs that already boot
  and smoke .output (see the smoke-built job in .github/workflows/ci.yml).

  Detached for the same reason as the real script: called inline, the server
  it spawns would inherit this process's console handles and the caller would
  hang for as long as the server runs.

  ASCII only, matching every other ops script (PS 5.1 reads a BOM-less UTF-8
  file as ANSI).
#>

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$port = if ($env:WATCHDOG_APP_PORT) { $env:WATCHDOG_APP_PORT } else { "3000" }

$env:PORT = $port
$env:HOST = "127.0.0.1"

$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node `
  -ArgumentList ".output/server/index.mjs" `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput (Join-Path $repoRoot "watchdog-test-restarted.out.log") `
  -RedirectStandardError  (Join-Path $repoRoot "watchdog-test-restarted.err.log") `
  -NoNewWindow
