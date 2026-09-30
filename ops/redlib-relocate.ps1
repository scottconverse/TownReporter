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

    * it copies, it does not move. The source install is left exactly as it was.
      When -Force replaces an existing install, matching regular destination
      files are backed up and replaced after the full tree passes preflight;
      target-only files stay in place, and a failed replacement restores the
      prior files where possible. Delete the old source yourself once the paper
      has read Reddit through the new one for a day.
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

# Resolve a path through existing junctions/symlinks and 8.3 spellings before
# comparing it. For a not-yet-created destination, resolve its deepest existing
# parent and append the remaining components.
if (-not ("TownReporterPathIdentity" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TownReporterPathIdentity {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);
  public static string Resolve(string path) {
    IntPtr handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    if (handle == new IntPtr(-1)) return null;
    try {
      StringBuilder result = new StringBuilder(32768);
      uint length = GetFinalPathNameByHandle(handle, result, (uint)result.Capacity, 0);
      if (length == 0 || length >= result.Capacity) return null;
      string resolved = result.ToString();
      if (resolved.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + resolved.Substring(8);
      if (resolved.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return resolved.Substring(4);
      return resolved;
    } finally { CloseHandle(handle); }
  }
  public static bool CanOpenForDelete(string path) {
    IntPtr handle = CreateFile(path, 0x00010000, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (handle == new IntPtr(-1)) return false;
    return CloseHandle(handle);
  }
}
"@
}

function Get-PathIdentity {
  param([string]$Path)
  $clean = Get-CleanPath $Path
  $probe = $clean
  $tail = New-Object System.Collections.ArrayList
  while (-not (Test-Path -LiteralPath $probe)) {
    $parent = Split-Path -Parent $probe
    if (-not $parent -or $parent -eq $probe) { break }
    [void]$tail.Insert(0, (Split-Path -Leaf $probe))
    $probe = $parent
  }
  if (Test-Path -LiteralPath $probe) {
    $identity = [TownReporterPathIdentity]::Resolve($probe)
    if (-not $identity) { throw "Could not resolve filesystem identity for existing path: $probe" }
    $identity = Get-CleanPath $identity
    foreach ($part in $tail) { $identity = Join-Path $identity ([string]$part) }
    return (Get-CleanPath $identity)
  }
  return $clean
}

function Get-ExecutableImageState {
  param([string]$ExecutablePath)
  if (-not $ExecutablePath -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { return 'none' }
  try {
    $expected = Get-PathIdentity $ExecutablePath
    $processName = [IO.Path]::GetFileNameWithoutExtension($ExecutablePath)
    foreach ($process in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
      try {
        $imagePath = [string]$process.MainModule.FileName
        if (-not $imagePath) { return 'unverified' }
        $actual = Get-PathIdentity $imagePath
      } catch { return 'unverified' }
      if ($actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { return 'live' }
    }
    return 'none'
  } catch { return 'unverified' }
}

function Test-CanReplaceFile {
  param([string]$Path)
  return [TownReporterPathIdentity]::CanOpenForDelete($Path)
}

function Get-PathRelativeToRoot {
  param([string]$Path, [string]$Root)
  if (-not $Path -or -not $Root) { return $null }
  $identity = Get-PathIdentity $Path
  $rootIdentity = Get-PathIdentity $Root
  if ($identity.Equals($rootIdentity, [StringComparison]::OrdinalIgnoreCase)) { return "" }
  $prefix = $rootIdentity
  if (-not $prefix.EndsWith('\')) { $prefix += '\' }
  if ($identity.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    return $identity.Substring($prefix.Length)
  }
  return $null
}

function Get-OldRootSpellings {
  param([string[]]$Roots)
  $seen = @{}
  $ordered = @()
  foreach ($root in $Roots) {
    if (-not $root) { continue }
    $clean = $root.TrimEnd('\', '/')
    foreach ($spelling in @($clean, $clean.Replace('\', '/'))) {
      $key = $spelling.ToLowerInvariant()
      if (-not $seen.ContainsKey($key)) {
        $seen[$key] = $true
        $ordered += $spelling
      }
    }
  }
  return $ordered
}

function Test-StringReferencesOldRoot {
  param([string]$Value, [string[]]$OldRoots)
  if ($null -eq $Value) { return $false }
  foreach ($old in $OldRoots) {
    $pattern = '(?<![A-Za-z0-9._-])' + [regex]::Escape($old) + '(?=$|[\\/])'
    if ([regex]::IsMatch($Value, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) { return $true }
  }
  return $false
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
  param($Value, [string[]]$OldRoots, [string]$New, [ref]$Changed)
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) {
    $updated = $Value
    $replacement = $New.Replace('$', '$$')
    foreach ($old in $OldRoots) {
      $pattern = '(?<![A-Za-z0-9._-])' + [regex]::Escape($old) + '(?=$|[\\/])'
      if ([regex]::IsMatch($updated, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $updated = [regex]::Replace($updated, $pattern, $replacement, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
      }
    }
    if ($updated -cne $Value) {
      $Changed.Value = $Changed.Value + 1
    }
    return $updated
  }
  if ($Value -is [System.Array]) {
    $items = New-Object System.Collections.ArrayList
    foreach ($item in $Value) {
      [void]$items.Add((Convert-PathInValue -Value $item -OldRoots $OldRoots -New $New -Changed $Changed))
    }
    return ,$items.ToArray()
  }
  if ($Value -is [hashtable]) {
    foreach ($key in @($Value.Keys)) {
      $Value[$key] = Convert-PathInValue -Value $Value[$key] -OldRoots $OldRoots -New $New -Changed $Changed
    }
    return $Value
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    foreach ($property in @($Value.PSObject.Properties)) {
      if (-not $property.IsSettable) { continue }
      $property.Value = Convert-PathInValue -Value $property.Value -OldRoots $OldRoots -New $New -Changed $Changed
    }
    return $Value
  }
  return $Value
}

function Get-StringValues {
  param($Value)
  if ($Value -is [string]) { return ,@($Value) }
  if ($Value -is [System.Array]) {
    $values = @()
    foreach ($item in $Value) { $values += @(Get-StringValues $item) }
    return ,$values
  }
  if ($Value -is [hashtable]) {
    $values = @()
    foreach ($key in $Value.Keys) { $values += @(Get-StringValues $Value[$key]) }
    return ,$values
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $values = @()
    foreach ($property in $Value.PSObject.Properties) { $values += @(Get-StringValues $property.Value) }
    return ,$values
  }
  return ,@()
}

function Get-RelocationTree {
  param([string]$Root, [string]$Destination)
  $items = New-Object System.Collections.ArrayList
  $pending = New-Object System.Collections.Queue
  $pending.Enqueue($Root)
  while ($pending.Count -gt 0) {
    $directory = [string]$pending.Dequeue()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop)) {
      if ($directory.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -and $item.Name -eq 'redlib.pid') { continue }
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "The source tree contains a reparse point at $($item.FullName). Nothing was changed."
      }
      $relative = Get-PathRelativeToRoot -Path $item.FullName -Root $Root
      if ($null -eq $relative -or -not $relative) {
        throw "Could not map source item into the selected install: $($item.FullName). Nothing was changed."
      }
      [void]$items.Add([PSCustomObject]@{
        SourcePath = $item.FullName
        TargetPath = Join-Path $Destination $relative
        RelativePath = $relative
        IsDirectory = [bool]$item.PSIsContainer
      })
      if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) }
    }
  }
  return $items.ToArray()
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

# Refuse an install whose own required paths do not describe the directory we
# found. The printed .env line must never make a copy look usable when its
# executable or configured in-tree log still points somewhere else.
$sourceConfigPath = Join-Path $source "install.json"
try {
  $sourceConfig = Get-Content -Raw -LiteralPath $sourceConfigPath | ConvertFrom-Json
} catch {
  Write-Say "  The selected install has an unreadable install.json. Nothing was changed."
  Write-Say ""
  exit 1
}
$sourceConfigRoot = [string]$sourceConfig.installRoot
$sourceIdentity = Get-PathIdentity $source
$sourceConfigRootIdentity = if ($sourceConfigRoot) { Get-PathIdentity $sourceConfigRoot } else { "" }
$sandboxedSource = $false
foreach ($sandboxedRoot in @(Get-RedlibSandboxedRoots)) {
  if ((Get-PathIdentity $sandboxedRoot).Equals($sourceIdentity, [StringComparison]::OrdinalIgnoreCase)) {
    $sandboxedSource = $true
    break
  }
}
$logicalInstallRoot = ""
if ($env:LOCALAPPDATA) { $logicalInstallRoot = Join-Path $env:LOCALAPPDATA "RedditSearch\Redlib" }
$usesSandboxLogicalRoot = $sandboxedSource -and $logicalInstallRoot -and
  $sourceConfigRootIdentity.Equals((Get-PathIdentity $logicalInstallRoot), [StringComparison]::OrdinalIgnoreCase)
if (-not $sourceConfigRoot -or
    (-not $sourceConfigRootIdentity.Equals($sourceIdentity, [StringComparison]::OrdinalIgnoreCase) -and -not $usesSandboxLogicalRoot)) {
  Write-Say "  install.json does not identify the selected source install. Nothing was changed."
  Write-Say ""
  exit 1
}
$configPathBase = $source
if ($usesSandboxLogicalRoot) { $configPathBase = $sourceConfigRoot }
$sourceExecutable = [string]$sourceConfig.executable
$executableRelative = Get-PathRelativeToRoot -Path $sourceExecutable -Root $configPathBase
if ($null -eq $executableRelative -and $usesSandboxLogicalRoot) {
  $executableRelative = Get-PathRelativeToRoot -Path $sourceExecutable -Root $source
}
$sourceExecutableCopy = if ($null -ne $executableRelative) { Join-Path $source $executableRelative } else { "" }
if ($null -eq $executableRelative -or -not $executableRelative -or -not (Test-Path -LiteralPath $sourceExecutableCopy -PathType Leaf)) {
  Write-Say "  install.json executable does not identify a file inside the selected source install. Nothing was changed."
  Write-Say ""
  exit 1
}
$sourceLogPath = [string]$sourceConfig.logPath
$logRelative = $null
if ($sourceLogPath) {
  $logRelative = Get-PathRelativeToRoot -Path $sourceLogPath -Root $configPathBase
  if ($null -eq $logRelative -and $usesSandboxLogicalRoot) {
    $logRelative = Get-PathRelativeToRoot -Path $sourceLogPath -Root $source
  }
  $initialOldRoots = Get-OldRootSpellings @($source, $sourceConfigRoot)
  if ($null -eq $logRelative -and (Test-StringReferencesOldRoot -Value $sourceLogPath -OldRoots $initialOldRoots)) {
    Write-Say "  install.json logPath still refers to the source but resolves outside it. Nothing was changed."
    Write-Say ""
    exit 1
  }
}

$target = Get-CleanPath $To
$samePlace = (Get-PathIdentity $source).Equals((Get-PathIdentity $target), [StringComparison]::OrdinalIgnoreCase)

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

if ($null -ne (Get-PathRelativeToRoot -Path $target -Root $source) -or
    $null -ne (Get-PathRelativeToRoot -Path $source -Root $target)) {
  Write-Say "  The destination overlaps the source install as a parent or child. Nothing was changed."
  Write-Say "  Choose a separate destination directory."
  Write-Say ""
  exit 1
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
if ($env:LOCALAPPDATA -and $null -ne (Get-PathRelativeToRoot -Path $target -Root $env:LOCALAPPDATA)) { $inAppData = $true }
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

# Refuse an occupied directory that is not an install. -Force is permission to
# replace a Redlib install, not permission to overwrite arbitrary operator data.
$targetExists = Test-Path -LiteralPath $target
$targetIsInstall = Test-InstallAt -Root $target
if ($targetExists) {
  $targetItem = Get-Item -LiteralPath $target -Force -ErrorAction Stop
  if (($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Write-Say "  The destination is a reparse point. Nothing was changed. Choose its resolved directory explicitly."
    Write-Say ""
    exit 1
  }
  if (-not $targetItem.PSIsContainer) {
    Write-Say "  $target is a file, not a directory. Nothing was changed."
    Write-Say ""
    exit 1
  }
  if (-not $targetIsInstall -and @(Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop).Count -gt 0) {
    Write-Say "  $target is not an existing Redlib install and is not empty. Nothing was changed."
    Write-Say "  Choose an empty destination directory; -Force only replaces an existing install."
    Write-Say ""
    exit 1
  }
}

# Build and validate the entire tree before replacing any destination leaf.
# Copy-Item can write through a hard link, changing the source or another file
# that shares the same data, and can follow a destination junction.
$relocationItems = @()
try {
  $relocationItems = @(Get-RelocationTree -Root $source -Destination $target)
} catch {
  Write-Say "  $($_.Exception.Message)"
  Write-Say ""
  exit 1
}
$replacementFiles = New-Object System.Collections.ArrayList
foreach ($planItem in $relocationItems) {
  if (-not (Test-Path -LiteralPath $planItem.TargetPath)) { continue }
  $existing = Get-Item -LiteralPath $planItem.TargetPath -Force -ErrorAction Stop
  if (($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Write-Say "  The destination tree contains a reparse point at $($planItem.TargetPath). Nothing was changed."
    Write-Say ""
    exit 1
  }
  if ($planItem.IsDirectory -and -not $existing.PSIsContainer) {
    Write-Say "  The destination has a file where a source directory belongs: $($planItem.TargetPath). Nothing was changed."
    Write-Say ""
    exit 1
  }
  if (-not $planItem.IsDirectory) {
    if ($existing.PSIsContainer) {
      Write-Say "  The destination has a directory where a source file belongs: $($planItem.TargetPath). Nothing was changed."
      Write-Say ""
      exit 1
    }
    if (-not ($targetIsInstall -and $Force)) {
      Write-Say "  The destination file already exists outside an install that -Force may replace: $($planItem.TargetPath). Nothing was changed."
      Write-Say ""
      exit 1
    }
    [void]$replacementFiles.Add($planItem.TargetPath)
  }
}
$targetPidState = Get-RedlibProcess -InstallRoot $target
$targetImageCandidates = New-Object System.Collections.ArrayList
if ($targetIsInstall) {
  try {
    $targetConfig = Get-Content -Raw -LiteralPath (Join-Path $target "install.json") | ConvertFrom-Json
    if ($targetConfig.executable) { [void]$targetImageCandidates.Add([string]$targetConfig.executable) }
  } catch {
    # The colliding executable paths below still provide a direct process-image check.
  }
}
foreach ($planItem in $relocationItems) {
  if (-not $planItem.IsDirectory -and [IO.Path]::GetExtension([string]$planItem.TargetPath) -ieq '.exe' -and
      (Test-Path -LiteralPath $planItem.TargetPath -PathType Leaf) -and
      -not $targetImageCandidates.Contains([string]$planItem.TargetPath)) {
    [void]$targetImageCandidates.Add([string]$planItem.TargetPath)
  }
}
$targetImageState = 'none'
foreach ($candidate in $targetImageCandidates) {
  $candidateState = Get-ExecutableImageState -ExecutablePath ([string]$candidate)
  if ($candidateState -eq 'unverified') { $targetImageState = 'unverified'; break }
  if ($candidateState -eq 'live') { $targetImageState = 'live'; break }
}
$targetAnswering = if ($targetIsInstall) { Test-RedlibUp -InstallRoot $target } else { $false }
if ($targetIsInstall -and (($targetPidState.State -in @('live', 'unverified', 'other')) -or
    $targetImageState -ne 'none' -or $targetAnswering)) {
  Write-Say ("  The destination has a running reader (pid state: " + $targetPidState.State + "; image state: " + $targetImageState + ").")
  Write-Say "  Nothing was changed. Stop or identify the destination reader before replacing its files."
  Write-Say "  Stop it first, then run this again:"
  Write-Say "      powershell -ExecutionPolicy Bypass -File ops\redlib.ps1 stop"
  Write-Say ""
  exit 1
}
foreach ($replacementFile in $replacementFiles) {
  if (-not (Test-CanReplaceFile -Path ([string]$replacementFile))) {
    Write-Say "  The destination file cannot be safely replaced right now: $replacementFile. Nothing was changed."
    Write-Say "  Close anything using it and run this again."
    Write-Say ""
    exit 1
  }
}
$targetPidPath = Join-Path $target "redlib.pid"
if (Test-Path -LiteralPath $targetPidPath) {
  $targetPidItem = Get-Item -LiteralPath $targetPidPath -Force -ErrorAction Stop
  if (($targetPidItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $targetPidItem.PSIsContainer) {
    Write-Say "  The destination redlib.pid is not a regular file. Nothing was changed."
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

# Build the corrected metadata before touching the destination. It is committed
# last so install.json never advertises the new install while its files are still
# being replaced.
$configPath = Join-Path $target "install.json"
$pendingConfigPath = Join-Path $target (".install.json.pending-" + [Guid]::NewGuid().ToString('N'))
$backupRoot = Join-Path (Split-Path -Parent $target) ((Split-Path -Leaf $target) + ".relocate-backup-" + [Guid]::NewGuid().ToString('N'))
$backedUpFiles = New-Object System.Collections.ArrayList
$installedFiles = New-Object System.Collections.ArrayList
$createdDirectories = New-Object System.Collections.ArrayList
$rewritten = 0
$oldRoots = Get-OldRootSpellings @($source, $sourceConfigRoot)
$config = Convert-PathInValue -Value $sourceConfig -OldRoots $oldRoots -New $target -Changed ([ref]$rewritten)
$config.installRoot = $target
$config.executable = Join-Path $target $executableRelative
if ($null -ne $logRelative) { $config.logPath = Join-Path $target $logRelative }
$text = $config | ConvertTo-Json -Depth 10
$copied = @(Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -ne 'redlib.pid' }).Count

try {
  if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    [void]$createdDirectories.Add($target)
  }
  # Prepare the final metadata while the target is still intact.
  [IO.File]::WriteAllText($pendingConfigPath, $text, (New-Object System.Text.UTF8Encoding($false)))

  $targetPidPath = Join-Path $target "redlib.pid"
  if (Test-Path -LiteralPath $targetPidPath) {
    $pidBackup = Join-Path $backupRoot "redlib.pid"
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    Move-Item -LiteralPath $targetPidPath -Destination $pidBackup -ErrorAction Stop
    [void]$backedUpFiles.Add([PSCustomObject]@{ OriginalPath = $targetPidPath; BackupPath = $pidBackup })
  }

  foreach ($directoryItem in @($relocationItems | Where-Object { $_.IsDirectory })) {
    if (-not (Test-Path -LiteralPath $directoryItem.TargetPath -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $directoryItem.TargetPath | Out-Null
      [void]$createdDirectories.Add([string]$directoryItem.TargetPath)
    }
  }

  # Replace the executable and other data before install.json. Back up each
  # collision first so any later copy or validation failure can restore it.
  $fileItems = @($relocationItems | Where-Object { -not $_.IsDirectory } |
    Sort-Object @{ Expression = { if ([string]$_.RelativePath -ieq 'install.json') { 1 } else { 0 } }; Ascending = $true })
  foreach ($fileItem in $fileItems) {
    $destinationPath = [string]$fileItem.TargetPath
    if (Test-Path -LiteralPath $destinationPath) {
      $relativeBackup = Join-Path $backupRoot ([string]$fileItem.RelativePath)
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $relativeBackup) | Out-Null
      Move-Item -LiteralPath $destinationPath -Destination $relativeBackup -ErrorAction Stop
      [void]$backedUpFiles.Add([PSCustomObject]@{ OriginalPath = $destinationPath; BackupPath = $relativeBackup })
    }
    if ([string]$fileItem.RelativePath -ieq 'install.json') {
      [void]$installedFiles.Add($destinationPath)
      Move-Item -LiteralPath $pendingConfigPath -Destination $destinationPath -ErrorAction Stop
    } else {
      [void]$installedFiles.Add($destinationPath)
      Copy-Item -LiteralPath $fileItem.SourcePath -Destination $destinationPath -Force -ErrorAction Stop
    }
  }

  $writtenConfig = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  $writtenRootIdentity = Get-PathIdentity ([string]$writtenConfig.installRoot)
  $expectedRootIdentity = Get-PathIdentity $target
  $writtenExecutableIdentity = Get-PathIdentity ([string]$writtenConfig.executable)
  $expectedExecutableIdentity = Get-PathIdentity (Join-Path $target $executableRelative)
  if (-not $writtenRootIdentity.Equals($expectedRootIdentity, [StringComparison]::OrdinalIgnoreCase) -or
      -not $writtenExecutableIdentity.Equals($expectedExecutableIdentity, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath ([string]$writtenConfig.executable) -PathType Leaf)) {
    throw "the copied install root or executable does not resolve to the destination"
  }
  if ($null -ne $logRelative) {
    $writtenLogIdentity = Get-PathIdentity ([string]$writtenConfig.logPath)
    $expectedLogIdentity = Get-PathIdentity (Join-Path $target $logRelative)
    if (-not $writtenLogIdentity.Equals($expectedLogIdentity, [StringComparison]::OrdinalIgnoreCase)) {
      throw "the copied log path does not resolve to the destination"
    }
  }
  $stillNames = @()
  foreach ($value in (Get-StringValues $writtenConfig)) {
    if (Test-StringReferencesOldRoot -Value ([string]$value) -OldRoots $oldRoots) { $stillNames += $value }
  }
  if (@($stillNames).Count -gt 0) { throw "install.json still contains a source-root path" }
} catch {
  $failure = $_.Exception.Message
  $rollbackErrors = New-Object System.Collections.ArrayList
  foreach ($installedPath in @($installedFiles | Sort-Object { ([string]$_).Length } -Descending)) {
    try { if (Test-Path -LiteralPath ([string]$installedPath)) { Remove-Item -LiteralPath ([string]$installedPath) -Force -ErrorAction Stop } }
    catch { [void]$rollbackErrors.Add($_.Exception.Message) }
  }
  $backupsToRestore = $backedUpFiles.ToArray()
  [array]::Reverse($backupsToRestore)
  foreach ($backup in $backupsToRestore) {
    try {
      if (Test-Path -LiteralPath ([string]$backup.BackupPath)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([string]$backup.OriginalPath)) | Out-Null
        Move-Item -LiteralPath ([string]$backup.BackupPath) -Destination ([string]$backup.OriginalPath) -ErrorAction Stop
      }
    } catch { [void]$rollbackErrors.Add($_.Exception.Message) }
  }
  foreach ($createdDirectory in @($createdDirectories | Sort-Object { ([string]$_).Length } -Descending)) {
    try { if (Test-Path -LiteralPath ([string]$createdDirectory)) { Remove-Item -LiteralPath ([string]$createdDirectory) -Force -ErrorAction Stop } }
    catch { [void]$rollbackErrors.Add($_.Exception.Message) }
  }
  if (Test-Path -LiteralPath $pendingConfigPath) { Remove-Item -LiteralPath $pendingConfigPath -Force -ErrorAction SilentlyContinue }
  Write-Say "  The destination copy did not complete: $failure"
  if ($rollbackErrors.Count -eq 0) {
    if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Say "  The previous destination files were restored; the source and .env were not changed."
  } else {
    Write-Say "  Rollback could not restore every prior file. Preserve this recovery directory and inspect it: $backupRoot"
    foreach ($rollbackError in $rollbackErrors) { Write-Say ("    rollback: " + $rollbackError) }
  }
  Write-Say ""
  exit 1
}

if (Test-Path -LiteralPath $backupRoot) {
  try { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction Stop }
  catch { Write-Say "  The new install is valid; old destination files remain in $backupRoot for manual cleanup." }
}
Write-Say ""
Write-Say ("  copied              " + $copied + " top-level item(s)")
Write-Say ("  install.json        " + $rewritten + " path value(s) rewritten to name the new root")
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
