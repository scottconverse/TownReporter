# Dot-sourced by the build and its behavioral tests; never modifies the local host.
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-runtime-loader.cs')

function Invoke-StagedVersion([string]$Executable, [string]$WorkingDirectory, [int]$TimeoutMilliseconds = 30000) {
  try { $output = [SetupRuntimeLoader]::Run($Executable, $WorkingDirectory, $TimeoutMilliseconds) }
  catch { Write-Host "Staged runtime gate failed: $($_.Exception.Message)"; throw }
  Write-Host "$Executable : $output"
}

function Test-StagedWindowsRuntime([string]$StageDirectory) {
  foreach ($relative in @('pgsql\bin\postgres.exe', 'pgsql\bin\initdb.exe', 'node\node.exe')) {
    Invoke-StagedVersion (Join-Path $StageDirectory $relative) $StageDirectory
  }
  # Negative control: removing the shipped CRT must make the loader gate fail.
  # A host fallback is rejected at its load event, before program startup.
  $crt = Join-Path $StageDirectory 'pgsql\bin\vcruntime140.dll'
  $backup = "$crt.w1-negative-control"
  Move-Item -LiteralPath $crt -Destination $backup
  try {
    $rejected = $false
    try { Invoke-StagedVersion (Join-Path $StageDirectory 'pgsql\bin\postgres.exe') $StageDirectory }
    catch {
      if ($_ -notmatch 'Non-staged VC runtime loaded|Runtime startup failed') { throw }
      $rejected = $true
      Write-Host "Missing staged CRT rejected: $_"
    }
    if (!$rejected) { throw 'PostgreSQL started without its staged CRT: isolation is ineffective.' }
  } finally { Move-Item -LiteralPath $backup -Destination $crt }
}
