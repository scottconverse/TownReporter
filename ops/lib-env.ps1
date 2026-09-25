<#
  One .env value, for the ops scripts that need one.

  The app itself reads .env through a dotenv loader (scripts/with-app-env.mjs),
  but a PowerShell ops script has neither that nor, under Task Scheduler, an
  environment of its own. So the scripts that need a single setting read the
  line out of .env themselves -- and until this file, each one had its own
  four-line copy of that parser (ops/status.ps1 still did, for PORT and
  PUBLIC_SITE_URL).

  Deliberately narrow: no interpolation, no multi-line values, no defaults
  baked in. Each caller passes the fallback it wants, because the right
  fallback is the caller's business (the app's port is not the LLM's port).

  Dot-source it:
    . (Join-Path $PSScriptRoot "lib-env.ps1")
  Then use:
    Read-OpsEnvValue -EnvFile <path> -Name PORT -Fallback 3000

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.
#>

function Read-OpsEnvValue {
  param(
    [string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Fallback
  )
  if ($EnvFile -and (Test-Path -LiteralPath $EnvFile)) {
    $line = Get-Content -LiteralPath $EnvFile -ErrorAction SilentlyContinue |
      Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if ($line) {
      # Quotes are stripped the way lib-ownership.ps1 strips them, so a quoted
      # value is the same value wherever it is read.
      $value = ($line -replace "^\s*$Name\s*=\s*", "").Trim().Trim('"', "'")
      if ($value) { return $value }
    }
  }
  return $Fallback
}
