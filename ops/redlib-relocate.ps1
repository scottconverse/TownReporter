<#
  Move a Redlib install somewhere Task Scheduler can see it.

  The one-time repair for 2026-09-25, when the reader was running and the
  watchdog logged "redlib: not installed here" every five minutes.

  Redlib was installed into %LOCALAPPDATA%\RedditSearch\Redlib from inside an
  MSIX-packaged app. MSIX redirects writes to that path into
  %LOCALAPPDATA%\Packages\<package>\LocalCache\Local\RedditSearch\Redlib, and
  the redirect is per-process: a packaged process (Claude's own shell, which
  built and started Redlib by hand) sees the merged view and finds it, while an
  unpackaged one (anything Task Scheduler starts) sees an empty directory. So
  the reader works and the scheduled tasks cannot find it.

  There is no setting inside the sandbox that fixes this, because the problem
  is the sandbox. The install has to LEAVE AppData. This script copies it
  somewhere real, points install.json at the new place, and prints the one .env
  line that makes the scheduled tasks read that path -- which is the only
  setting both kinds of process read the same way.

  It is a ONE-TIME helper and it is deliberately timid:

    * it copies, it does not move. The old install is left exactly as it was,
      so a mistake here costs nothing. Delete it yourself once the paper has
      read Reddit through the new one for a day.
    * it refuses to touch an install that is RUNNING. Redlib's executable is
      the file being copied, and a live one is usually locked; more to the
      point, copying the files out from under a running reader and then
      pointing the config at the copy is how you end up with two of them. Stop
      it first:  ops\redlib.ps1 stop
    * it does nothing unless -To is a path outside AppData, or you say -Force.
      Under AppData the same redirect can apply to the copy, and the operator
      would have moved a working reader to a path the scheduled tasks still
      cannot see. It warns and asks rather than guessing.
    * -DryRun prints the whole plan and changes nothing.

  Usage:
    powershell -ExecutionPolicy Bypass -File ops\redlib-relocate.ps1
    powershell -ExecutionPolicy Bypass -File ops\redlib-relocate.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File ops\redlib-relocate.ps1 -To D:\Tools\Redlib
    powershell -ExecutionPolicy Bypass -File ops\redlib-relocate.ps1 -From <path> -To <path>

  -To defaults to C:\Users\<you>\TownReporterTools\Redlib: outside AppData,
  and beside the rest of the paper's tools rather than in a temp directory that
  a cleanup job could take away.

  It does not edit .env. It prints the line, because .env is the file the paper
  and every scheduled task read and a tool that rewrites it silently is a tool
  that can take the paper down. Add the line by hand.

  ASCII only: Windows PowerShell 5.1 reads a BOM-less UTF-8 script as ANSI.
#>
[CmdletBinding()]
param(
  [string]$To = "C:\Users\scott\TownReporterTools\Redlib",
  [string]$From,
  [string]$EnvFile,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib-redlib.ps1")

$app = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) { $EnvFile = Join-Path $app ".env" }

function Write-Say {
  param([string]$Text = "")
  Write-Host $Text
}

# One form of a path everywhere below: absolute, and with no trailing separator,
# so a string comparison between two of them means what it looks like.
function Get-CleanPath {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\', '/') }
  return $full
}

# An install is install.json at the root, and nothing else counts. A directory
# that merely exists is not one -- half of this bug is directories that exist
# and hold nothing a Task Scheduler process can see.
function Test-InstallAt {
  param([string]$Root)
  if (-not $Root) { return $false }
  return [bool](Test-Path -LiteralPath (Join-Path $Root "install.json"))
}

<#
  Everywhere the install might really be, in the order that makes sense.

  -From first (the operator pointing at it), then the configured root -- which
  is the .env setting when there is one, so a second run of this script finds
  what the first run set up -- then the sandboxed copies MSIX made, then the
  skill's own default. The sandboxed list is why this can be run with no
  arguments at all on the broken machine: the install is not where it says it
  is, and listing the filesystem is how you find out where it went.
#>
function Get-RelocateCandidates {
  $candidates = @()
  if ($From) { $candidates += $From }
  $candidates += (Get-RedlibInstallRoot -EnvFile $EnvFile)
  $candidates += @(Get-RedlibSandboxedRoots)
  if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA "RedditSearch\Redlib") }
  $seen = @{}
  $ordered = @()
  foreach ($candidate in $candidates) {
    if (-not $candidate) { continue }
    $clean = Get-CleanPath $candidate
    $key = $clean.ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $ordered += $clean
  }
  return $ordered
}

<#
  Rewrite the old path to the new one in every string of a JSON object.

  At the OBJECT level, not by replacing text in the file: install.json holds
  Windows paths, so in the file they are written with doubled backslashes and a
  plain text replace of one path with another finds nothing. Walking the parsed
  object catches the path wherever it is -- executable, installRoot, a log path,
  a config path this version of the skill does not have yet -- without this
  script having to know the field names.
#>
function Convert-PathInValue {
  param($Value, [string]$Old, [string]$New, [ref]$Changed)
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) {
    if ($Value.IndexOf($Old, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $Changed.Value = $Changed.Value + 1
      return ([regex]::Replace($Value, [regex]::Escape($Old), $New, [Text.RegularExpressions.RegexOptions]::IgnoreCase))
    }
    return $Value
  }
  if ($Value -is [System.Array]) {
    $items = New-Object System.Collections.ArrayList
    foreach ($item in $Value) {
      [void]$items.Add((Convert-PathInValue -Value $item -Old $Old -New $New -Changed $Changed))
    }
    return ,$items.ToArray()
  }
  if ($Value -is [hashtable]) {
    foreach ($key in @($Value.Keys)) {
      $Value[$key] = Convert-PathInValue -Value $Value[$key] -Old $Old -New $New -Changed $Changed
    }
    return $Value
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    foreach ($property in @($Value.PSObject.Properties)) {
      if (-not $property.IsSettable) { continue }
      $property.Value = Convert-PathInValue -Value $property.Value -Old $Old -New $New -Changed $Changed
    }
    return $Value
  }
  return $Value
}

$source = ""
$candidates = Get-RelocateCandidates
if ($From -and -not (Test-InstallAt -Root (Get-CleanPath $From))) {
  Write-Say ""
  Write-Say "  There is no Redlib install at -From $From (no install.json there)."
  Write-Say "  Nothing was changed."
  Write-Say ""
  exit 1
}
foreach ($candidate in $candidates) {
  if (Test-InstallAt -Root $candidate) { $source = $candidate; break }
}
if (-not $source) {
  Write-Say ""
  Write-Say "  No Redlib install was found, so there is nothing to move."
  Write-Say "  Looked in:"
  foreach ($candidate in $candidates) { Write-Say ("    " + $candidate) }
  Write-Say "  If the reader was never installed, the paper reads Reddit through RSS alone"
  Write-Say "  and that is a supported state. To install one: ops\redlib.ps1 setup"
  Write-Say ""
  exit 1
}

$target = Get-CleanPath $To
$samePlace = ($source.ToLowerInvariant() -eq $target.ToLowerInvariant())

Write-Say ""
Write-Say "  Local Redlib, being moved somewhere a scheduled task can see it"
Write-Say "  ------------------------------------------------------------"
Write-Say ("  found at            " + $source)
Write-Say ("  and should live at  " + $target)
if ($DryRun) { Write-Say "  (dry run: nothing below this line happens)" }
Write-Say ""

if ($samePlace -and (Test-InstallAt -Root $target)) {
  Write-Say "  The install is already at that path. There is nothing to copy."
  Write-Say "  If the scheduled tasks still cannot see it, the missing piece is the .env line:"
  Write-Say ""
  Write-Say ("      REDLIB_INSTALL_ROOT=" + $target)
  Write-Say ""
  exit 0
}

<#
  Is it running?

  Checked before anything is copied, and refused rather than forced. The
  executable being copied is the one a live process is holding, and a reader
  that answered while its files were being duplicated is a reader whose
  duplicate may answer next boot on the same port. The operator stops it; this
  script does not, because stopping the Reddit reader is ops\redlib.ps1's job
  and it refuses an unidentifiable pid on purpose.
#>
$entry = Get-RedlibProcess -InstallRoot $source
$answering = Test-RedlibUp -InstallRoot $source
if (($entry.State -in @('live', 'unverified', 'other')) -or $answering) {
  Write-Say ("  Redlib is running from there right now (pid state: " + $entry.State + ").")
  Write-Say "  Refusing to copy an install out from under a live reader: the files are in use,"
  Write-Say "  and the copy could end up started beside the original on the same port."
  Write-Say "  Stop it first, then run this again:"
  Write-Say "      powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop"
  Write-Say ""
  exit 1
}

if (Test-Path -LiteralPath $target -PathType Leaf) {
  Write-Say "  $target is a file, not a directory. Nothing was changed."
  Write-Say ""
  exit 1
}
if (Test-InstallAt -Root $target) {
  if (-not $Force) {
    Write-Say "  There is already a Redlib install at $target."
    Write-Say "  Nothing was changed. Re-run with -Force to overwrite it with this one, or"
    Write-Say "  point -To somewhere else."
    Write-Say ""
    exit 1
  }
  Write-Say "  (there is already an install there; -Force says to overwrite it)"
  Write-Say ""
}

# A warning, not a refusal, when -Force was given: the operator was told, and a
# path under AppData is sometimes deliberate (a test on a temp directory, for
# one). Without -Force this is where the run stops, because moving a working
# reader to a second path inside the same sandbox fixes nothing and looks like
# it did.
$inAppData = $false
if ($env:LOCALAPPDATA -and $target.ToLowerInvariant().StartsWith($env:LOCALAPPDATA.ToLowerInvariant())) { $inAppData = $true }
if ($inAppData) {
  Write-Say "  NOTE: $target is inside AppData."
  Write-Say "  MSIX redirects AppData writes made from inside a packaged app, so a scheduled"
  Write-Say "  task may still not see it -- the redirect is what this script exists to get out"
  Write-Say "  of. A path outside AppData is the one that works for both kinds of process."
  Write-Say ""
  if (-not $Force) {
    Write-Say "  Nothing was changed. Re-run with -Force if that is really where you want it."
    Write-Say ""
    exit 1
  }
}

if ($DryRun) {
  Write-Say "  It would:"
  Write-Say ("    - copy every file from " + $source + " to " + $target)
  Write-Say "      (all of it except redlib.pid, which belongs to a process, not to an install)"
  Write-Say "    - rewrite the paths in the copied install.json to name $target"
  Write-Say "    - print the .env line to add, and change no .env by itself"
  Write-Say "  Every check above it has already been made; this is the same run without the copy."
  Write-Say ""
  exit 0
}

Write-Say "  copying..."
New-Item -ItemType Directory -Force -Path $target | Out-Null
$copied = 0
$files = @(Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -ne 'redlib.pid' })
foreach ($item in $files) {
  Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
  $copied++
}
if (-not (Test-InstallAt -Root $target)) {
  Write-Say "  The copy did not produce an install.json at $target, so this did NOT work."
  Write-Say "  Nothing that was working has been changed: the original install at $source is"
  Write-Say "  untouched and .env was not edited. The likely cause is a file that could not be"
  Write-Say "  read; copy the directory by hand and see what refuses."
  Write-Say ""
  exit 1
}

# The pid file in the target, if one was there from an older install, names a
# process that is not this install's. Belt and braces beside the exclusion
# above: a stale pid file is how the next start believes it is already up.
Remove-Item -LiteralPath (Join-Path $target "redlib.pid") -Force -ErrorAction SilentlyContinue

$configPath = Join-Path $target "install.json"
$rewritten = 0
try {
  $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  $config = Convert-PathInValue -Value $config -Old $source -New $target -Changed ([ref]$rewritten)
  $text = $config | ConvertTo-Json -Depth 10
  # UTF-8 with no BOM: readable by both Windows PowerShell and PowerShell 7, and
  # the file holds nothing but ASCII paths.
  [IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  Write-Say "  The files were copied but install.json could not be rewritten: $($_.Exception.Message)"
  Write-Say "  The copy at $target still names $source, so it is NOT usable as it stands."
  Write-Say "  The original install and .env are unchanged. Fix the copy by hand, or delete it"
  Write-Say "  and run this again."
  Write-Say ""
  exit 1
}

$stillNames = @(Get-Content -Raw -LiteralPath $configPath) | Where-Object { $_.IndexOf($source, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
Write-Say ""
Write-Say ("  copied              " + $copied + " top-level item(s)")
Write-Say ("  install.json        " + $rewritten + " path value(s) rewritten to name the new root")
if (@($stillNames).Count -gt 0) {
  Write-Say "  WARNING: install.json still mentions the old path somewhere. Read it before"
  Write-Say "  relying on it: $configPath"
}
Write-Say ("  the old copy        is still at " + $source + " and was not changed or deleted.")
Write-Say ("                      Delete it once the paper has read Reddit through the new one.")
Write-Say ""
Write-Say "  Now add this line to $app\.env (replace any REDLIB_INSTALL_ROOT line"
Write-Say "  already there; if there is none, add it anywhere):"
Write-Say ""
Write-Say ("      REDLIB_INSTALL_ROOT=" + $target)
Write-Say ""
Write-Say "  This script does not edit .env by itself -- it is the file the paper and every"
Write-Say "  scheduled task read, and a helper that rewrites it silently can take the paper"
Write-Say "  down. Then, from a plain console (which sees what Task Scheduler sees):"
Write-Say "      powershell -ExecutionPolicy Bypass -File ops\status.ps1"
Write-Say "  and start the reader where it now lives:  ops\redlib.ps1 start"
Write-Say ""
exit 0
