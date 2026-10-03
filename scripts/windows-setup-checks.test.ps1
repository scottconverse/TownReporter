param([string]$InstallerPath = (Join-Path $env:RUNNER_TEMP 'innosetup-6.4.3.exe'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-runtime-check.ps1')
function Assert-Rejected([scriptblock]$Check, [string]$Message) {
  try { & $Check } catch {
    if ($_ -notmatch $Message) { throw "Unexpected failure: $_" }
    Write-Host "Rejected broken payload: $_"
    return
  }
  throw "Broken payload was accepted; expected $Message"
}
$root = Join-Path $env:TEMP ('w1-gates-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
try {
  $verifier = Join-Path $PSScriptRoot 'verify-inno-setup.ps1'
  & $verifier -InstallerPath $InstallerPath
  $badInstaller = Join-Path $root 'bad-inno.exe'
  Copy-Item -LiteralPath $InstallerPath -Destination $badInstaller
  $file = [IO.File]::OpenWrite($badInstaller)
  try { $file.SetLength($file.Length - 1) } finally { $file.Dispose() }
  Assert-Rejected { & $verifier -InstallerPath $badInstaller } 'checksum mismatch'

  # Run real PE executables, then break each staged entry point in turn.
  $node = (Get-Command node.exe).Source
  foreach ($dll in @(Get-ChildItem (Join-Path $env:SystemRoot 'System32') -Filter '*.dll' | Where-Object Name -match '^(vcruntime|msvcp)[0-9].*\.dll$')) {
    Copy-Item -LiteralPath $dll.FullName -Destination $root
  }
  $mode = [SetupLoaderErrors]::SetErrorMode(0x8003)
  try {
    foreach ($name in @('postgres.exe', 'initdb.exe', 'node.exe')) {
      $exe = Join-Path $root $name
      Copy-Item -LiteralPath $node -Destination $exe
      Invoke-StagedVersion $exe $root
      Move-Item -LiteralPath $exe -Destination "$exe.saved"
      Assert-Rejected { Invoke-StagedVersion $exe $root } 'cannot find|not found'
      [IO.File]::WriteAllBytes($exe, [byte[]]@(0, 1, 2))
      Assert-Rejected { Invoke-StagedVersion $exe $root } 'valid application|not a valid|format'
      [IO.File]::Delete($exe)
      Move-Item -LiteralPath "$exe.saved" -Destination $exe
    }
    Assert-Rejected { Invoke-StagedVersion (Join-Path $env:SystemRoot 'System32\where.exe') $root } 'Runtime startup failed'
    $slowSource = Join-Path $root 'slow.cs'
    $slowExe = Join-Path $root 'slow.exe'
    [IO.File]::WriteAllText($slowSource, 'class Slow { static void Main() { System.Threading.Thread.Sleep(30000); } }')
    & (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo "/out:$slowExe" $slowSource
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile the startup timeout fixture.' }
    Assert-Rejected { Invoke-StagedVersion $slowExe $root 100 } 'Runtime startup timed out'
  } finally { [void][SetupLoaderErrors]::SetErrorMode($mode) }

  $system = Join-Path $root 'fixture-system'
  New-Item -ItemType Directory -Path $system | Out-Null
  $dll = Join-Path $system 'vcruntime140.dll'
  [IO.File]::WriteAllText($dll, 'fixture CRT')
  Invoke-WithHiddenVcRuntime $system {
    if (Test-Path -LiteralPath $dll) { throw 'Fixture CRT was not hidden.' }
  }
  Assert-Rejected { Invoke-WithHiddenVcRuntime $system { throw 'broken staged runtime' } } 'broken staged runtime'
  if ([IO.File]::ReadAllText($dll) -cne 'fixture CRT' -or @(Get-ChildItem $system -File).Count -ne 1) {
    throw 'CRT was not restored intact after success and failure.'
  }
  Assert-Rejected { Invoke-WithHiddenVcRuntime (Join-Path $root 'absent-system') {} } 'does not exist|cannot find'
  [IO.File]::Delete($dll)
  Assert-Rejected { Invoke-WithHiddenVcRuntime $system {} } 'No system VC runtime'
  Write-Host 'Installer checksum, executable startup, and CRT isolation/restoration behavioral checks PASS.'
} finally { [IO.Directory]::Delete($root, $true) }
