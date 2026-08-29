<#
  Where the paper listens, read from .env rather than guessed.

  PORT is documented as configurable, and the ops scripts hard-coded 3000 while
  an architecture diagram said 8080 - three answers to one question, which an
  audit filed as TW-005. Change PORT in .env and the app moves; the watchdog
  and the restart scripts then looked at the wrong socket and "repaired" a
  server that was fine.

  Dot-source it:  . (Join-Path $PSScriptRoot "lib-port.ps1")
  Then use:       $port  (a string, so it drops straight into a URL)

  ASCII only: PS 5.1 reads a BOM-less UTF-8 file as ANSI.
#>
function Get-TownReporterPort {
  $app = Split-Path -Parent $PSScriptRoot
  $envFile = Join-Path $app ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile |
      Where-Object { $_ -match '^\s*PORT\s*=' } |
      Select-Object -First 1
    if ($line) {
      $value = ($line -replace '^\s*PORT\s*=\s*', '').Trim()
      if ($value -match '^\d+$') { return $value }
    }
  }
  return "3000"
}

$port = Get-TownReporterPort
