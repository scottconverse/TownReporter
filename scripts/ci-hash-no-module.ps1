<#
  File hashing must not need a module.

  Measured on this machine, 2026-09-26: a Windows PowerShell 5.1 session whose
  PSModulePath was inherited from PowerShell 7 cannot reach Get-FileHash at
  all. `Get-Command Get-FileHash` still lists it; calling it throws
  CommandNotFoundException. That is the worst shape a missing command can
  have, because the mistake is invisible until the moment the code runs --
  and the two places that hashed a file were ops\promote.ps1 (the lockfile
  check, with the live paper already stopped by step 4) and
  installer\Install.ps1's Get-VerifiedDependency (the download checksum).

  This harness runs the REAL changed code under exactly that broken
  PSModulePath, in a temp directory, and fails if either of them calls the
  cmdlet again. It launches nothing, opens no port, and touches no backup
  folder.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI.

  Usage: powershell -ExecutionPolicy Bypass -File scripts\ci-hash-no-module.ps1 -AppRoot <repo>
#>
param([Parameter(Mandatory = $true)][string]$AppRoot)

$ErrorActionPreference = 'Stop'
$script:failures = 0

function Say([string]$Message) { Write-Output $Message }

function Check([string]$Name, [scriptblock]$Test) {
  try {
    $result = & $Test
  } catch {
    $result = "threw: $($_.Exception.Message)"
  }
  if ($result -eq $true) {
    Say "PASS $Name"
  } else {
    Say "FAIL $Name -- $result"
    $script:failures++
  }
}

$AppRoot = [IO.Path]::GetFullPath($AppRoot)
$promote = Join-Path $AppRoot 'ops\promote.ps1'
$install = Join-Path $AppRoot 'installer\Install.ps1'
$libBackup = Join-Path $AppRoot 'ops\lib-backup.ps1'

# --- the broken session, built on purpose ----------------------------------
# PowerShell 7's module directory is what a Node-launched 5.1 inherits. When
# it is not installed, an empty directory is the same condition: a PSModulePath
# that lists no Windows PowerShell module directory.
$pwshModules = Join-Path $env:ProgramFiles 'PowerShell\7\Modules'
$world = Join-Path ([IO.Path]::GetTempPath()) ('tr-hash-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $world | Out-Null

try {
  $sabotage = if (Test-Path -LiteralPath $pwshModules) { $pwshModules } else { $world }
  $env:PSModulePath = $sabotage
  Say "PSModulePath for this run: $sabotage"

  # The sabotage must actually be in force. If a future PowerShell 5.1 can
  # reach the cmdlet anyway, this run proves nothing and says so instead of
  # passing quietly.
  Check 'the sabotaged session really cannot reach Get-FileHash' {
    $reachable = $true
    try { [void](Get-FileHash -LiteralPath $install -Algorithm SHA256) }
    catch [System.Management.Automation.CommandNotFoundException] { $reachable = $false }
    catch { $reachable = $false }
    if ($reachable) { 'Get-FileHash answered, so this run cannot prove anything' } else { $true }
  }

  # --- ops\promote.ps1's lockfile check -----------------------------------
  Set-Location $AppRoot
  . $libBackup

  Check 'ops\promote.ps1 hashes the lockfile without Get-FileHash' {
    $lines = Get-Content -LiteralPath $promote
    $lockLines = @($lines | Where-Object { $_ -match '^\$lock(Before|After) = if \(Test-Path' })
    if ($lockLines.Count -ne 2) { "expected 2 lockfile lines, found $($lockLines.Count)" }
    else {
      $seen = @()
      foreach ($line in $lockLines) {
        if ($line -match 'Get-FileHash') { return "still calls Get-FileHash: $line" }
        Invoke-Expression $line
        $seen += $lockLines.IndexOf($line)
      }
      $values = @($lockBefore, $lockAfter)
      if ($values[0] -ne $values[1]) { 'the two lockfile hashes of one unchanged file disagree' }
      elseif ($values[0] -notmatch '^[0-9A-F]{64}$') { "the lockfile hash is not 64 hex digits: $($values[0])" }
      else { $true }
    }
  }

  # --- installer\Install.ps1's Get-VerifiedDependency ----------------------
  # The installer cannot dot-source ops\, and scripts\windows-installer-contract.ps1
  # runs this function on its own (extracted by AST, so no Common.ps1 repair is
  # in scope). Exercise it the same way, at both answers.
  Check 'installer\Install.ps1 verifies a download checksum without Get-FileHash' {
    $ast = [Management.Automation.Language.Parser]::ParseInput((Get-Content -LiteralPath $install -Raw), [ref]$null, [ref]$null)
    $body = $ast.Find({ param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Get-VerifiedDependency' }, $true).Extent.Text
    if (-not $body) { return 'Get-VerifiedDependency is no longer defined in installer\Install.ps1' }
    # Comment lines are allowed to name the cmdlet -- the explanation of why it
    # is gone belongs next to the code. Only a real call counts.
    $code = @($body -split "`n" | Where-Object { $_.TrimStart() -notmatch '^#' }) -join "`n"
    if ($code -match 'Get-FileHash') { return 'Get-VerifiedDependency still calls Get-FileHash' }
    Invoke-Expression $body

    $tools = Join-Path $world 'tools'
    New-Item -ItemType Directory -Path $tools | Out-Null
    $archive = Join-Path $tools 'node.zip'
    Set-Content -LiteralPath $archive -Value 'checksum-valid mock archive' -Encoding ASCII
    New-Item -ItemType Directory -Path (Join-Path $tools 'node-runtime') | Out-Null
    $script:toolsRoot = $tools

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::Open($archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try { $digest = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $sha.Dispose() }

    # A wrong digest must still be refused -- removing the module must not
    # remove the check.
    $bad = [pscustomobject]@{ url = 'https://example.invalid/node.zip'; sha256 = ($digest.Substring(0, 63) + '0'); directory = 'node-runtime'; version = 'test' }
    $refusedBad = $false
    try { [void](Get-VerifiedDependency $bad 'test') }
    catch { if ($_.Exception.Message -match 'Checksum mismatch') { $refusedBad = $true } }
    if (-not $refusedBad) { return 'a mismatched download was accepted' }

    # The right digest must pass the checksum gate and reach the next check.
    $good = [pscustomobject]@{ url = 'https://example.invalid/node.zip'; sha256 = $digest; directory = 'node-runtime'; version = 'test' }
    $reachedNext = $false
    try { [void](Get-VerifiedDependency $good 'test') }
    catch { if ($_.Exception.Message -match 'Incomplete or unowned runtime directory') { $reachedNext = $true } else { return "unexpected error past the checksum gate: $($_.Exception.Message)" } }
    if (-not $reachedNext) { 'the correct digest did not pass the checksum gate' } else { $true }
  }

  # --- what the static half of the same rule would miss --------------------
  # Both scripts above are the whole fix, but a future Get-FileHash added to
  # any script the paper runs at boot has the same defect. The node suite
  # scans for that; this line only records that the scan has something to
  # scan for.
  Check 'the two scripts that had the defect are the ones this run exercised' {
    foreach ($path in @($promote, $install)) {
      if (-not (Test-Path -LiteralPath $path)) { return "missing: $path" }
    }
    $true
  }
} finally {
  Remove-Item -LiteralPath $world -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output ''
if ($script:failures -gt 0) {
  Write-Output "file hashing without a module: $($script:failures) check(s) failed"
  exit 1
}
Write-Output 'file hashing without a module: every check passed'
exit 0
