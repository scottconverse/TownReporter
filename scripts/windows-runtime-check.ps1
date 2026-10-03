# Dot-sourced by the build and its behavioral tests; never modifies the local host.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class SetupLoaderErrors {
  [DllImport("kernel32.dll")] public static extern uint SetErrorMode(uint mode);
}
'@

function Invoke-StagedVersion([string]$Executable, [string]$WorkingDirectory, [int]$TimeoutMilliseconds = 30000) {
  $info = [Diagnostics.ProcessStartInfo]::new($Executable, '--version')
  $info.UseShellExecute = $false
  $info.WorkingDirectory = $WorkingDirectory
  $info.Environment['PATH'] = Join-Path $env:SystemRoot 'System32'
  [void]$info.Environment.Remove('NODE_OPTIONS')
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit($TimeoutMilliseconds)) { $process.Kill(); throw "Runtime startup timed out: $Executable" }
    $output = $stdout.GetAwaiter().GetResult().Trim()
    $errorOutput = $stderr.GetAwaiter().GetResult().Trim()
    if ($process.ExitCode -ne 0) { throw "Runtime startup failed: $Executable (exit $($process.ExitCode)): $errorOutput" }
    Write-Host "$Executable : $output"
  } finally { $process.Dispose() }
}

function Invoke-WithHiddenVcRuntime([string]$SystemDirectory, [scriptblock]$Check) {
  $system = [IO.Path]::GetFullPath($SystemDirectory).TrimEnd('\')
  $hostSystem = [IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32')).TrimEnd('\')
  if ($system -eq $hostSystem -and ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted')) {
    throw 'System CRT isolation is allowed only on a disposable GitHub-hosted runner.'
  }
  # UCRT is an OS component on supported Windows 10/11; hide redistributable VC DLLs.
  $dlls = @(Get-ChildItem -LiteralPath $system -File | Where-Object Name -match '^(vcruntime|msvcp|msvcr|vccorlib|concrt|vcomp)[0-9].*\.dll$')
  if (!$dlls.Count) { throw 'No system VC runtime DLLs found to isolate.' }
  $hidden = @()
  $suffix = '.w1-hidden-' + [guid]::NewGuid().ToString('N')
  $mode = [SetupLoaderErrors]::SetErrorMode(0x8003) # inherited: no loader error dialog
  try {
    foreach ($dll in $dlls) {
      $backup = $dll.FullName + $suffix
      Move-Item -LiteralPath $dll.FullName -Destination $backup
      $hidden += @{Original=$dll.FullName; Backup=$backup}
    }
    foreach ($dll in $dlls) {
      if (Test-Path -LiteralPath $dll.FullName) { throw "System VC runtime still available: $($dll.FullName)" }
    }
    & $Check
  } finally {
    # Attempt every restoration even if one fails; report any failure to the build.
    $restoreErrors = @()
    foreach ($dll in $hidden) {
      try { Move-Item -LiteralPath $dll.Backup -Destination $dll.Original -ErrorAction Stop }
      catch { $restoreErrors += $_ }
    }
    [void][SetupLoaderErrors]::SetErrorMode($mode)
    if ($restoreErrors.Count) { throw "System VC runtime restoration failed: $restoreErrors" }
  }
}

function Test-StagedWindowsRuntime([string]$StageDirectory) {
  if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'The isolated staged runtime gate requires a disposable GitHub-hosted runner.'
  }
  Invoke-WithHiddenVcRuntime (Join-Path $env:SystemRoot 'System32') {
    foreach ($relative in @('pgsql\bin\postgres.exe', 'pgsql\bin\initdb.exe', 'node\node.exe')) {
      Invoke-StagedVersion (Join-Path $StageDirectory $relative) $StageDirectory
    }
    # Negative control: removing the shipped CRT must make PostgreSQL fail here.
    # This proves the runner cannot supply a fallback DLL from elsewhere.
    $crt = Join-Path $StageDirectory 'pgsql\bin\vcruntime140.dll'
    $backup = "$crt.w1-negative-control"
    Move-Item -LiteralPath $crt -Destination $backup
    try {
      $rejected = $false
      try { Invoke-StagedVersion (Join-Path $StageDirectory 'pgsql\bin\postgres.exe') $StageDirectory }
      catch { $rejected = $true; Write-Host "Missing staged CRT rejected: $_" }
      if (!$rejected) { throw 'PostgreSQL started without its staged CRT: isolation is ineffective.' }
    } finally { Move-Item -LiteralPath $backup -Destination $crt }
  }
}
