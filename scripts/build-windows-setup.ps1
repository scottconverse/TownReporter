param(
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$IsccPath
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

# Read ordinary and delay-load PE imports without depending on Visual Studio tools.
function Get-PeImports([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5a4d) { throw "Not a PE image: $Path" }
  $pe = [BitConverter]::ToInt32($bytes, 60)
  if ($pe -lt 0 -or $pe + 24 -ge $bytes.Length -or [BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550) { throw "Invalid PE header: $Path" }
  $count = [BitConverter]::ToUInt16($bytes, $pe + 6)
  $optionalSize = [BitConverter]::ToUInt16($bytes, $pe + 20)
  $optional = $pe + 24
  $magic = [BitConverter]::ToUInt16($bytes, $optional)
  if ($magic -ne 0x20b) { throw "Expected an x64 PE image: $Path" }
  $sections = @()
  for ($i = 0; $i -lt $count; $i++) {
    $section = $optional + $optionalSize + 40 * $i
    $sections += [pscustomobject]@{
      Rva=[BitConverter]::ToUInt32($bytes, $section + 12)
      Size=[Math]::Max([BitConverter]::ToUInt32($bytes, $section + 8), [BitConverter]::ToUInt32($bytes, $section + 16))
      Offset=[BitConverter]::ToUInt32($bytes, $section + 20)
    }
  }
  function Resolve-PeRva([uint32]$Rva) {
    foreach ($section in $sections) {
      if ($Rva -ge $section.Rva -and $Rva -lt $section.Rva + $section.Size) {
        $offset = [long]$section.Offset + $Rva - $section.Rva
        if ($offset -ge $bytes.Length) { throw "Import outside image: $Path" }
        return [int]$offset
      }
    }
    throw "Unmapped import RVA in $Path"
  }
  $names = @()
  foreach ($directory in @(@{Index=1; Stride=20; NameOffset=12}, @{Index=13; Stride=32; NameOffset=4})) {
    $rva = [BitConverter]::ToUInt32($bytes, $optional + 112 + 8 * $directory.Index)
    if (!$rva) { continue }
    $offset = Resolve-PeRva $rva
    while ($true) {
      if ($offset + $directory.Stride -gt $bytes.Length) { throw "Truncated import directory: $Path" }
      $nameRva = [BitConverter]::ToUInt32($bytes, $offset + $directory.NameOffset)
      if (!$nameRva) { break }
      if ($directory.Index -eq 13 -and [BitConverter]::ToUInt32($bytes, $offset) -ne 1) { throw "Unsupported delay import addressing: $Path" }
      $nameStart = Resolve-PeRva $nameRva
      $nameEnd = $nameStart
      while ($nameEnd -lt $bytes.Length -and $bytes[$nameEnd]) { $nameEnd++ }
      if ($nameEnd -eq $bytes.Length) { throw "Unterminated import name: $Path" }
      $names += [Text.Encoding]::ASCII.GetString($bytes, $nameStart, $nameEnd - $nameStart).ToLowerInvariant()
      $offset += $directory.Stride
    }
  }
  return @($names | Sort-Object -Unique)
}

function Copy-AppLocalCrt([string[]]$Images, [string[]]$Destinations, [string]$SystemDirectory) {
  $pending = [Collections.Generic.Queue[string]]::new()
  foreach ($image in $Images) { $pending.Enqueue($image) }
  $needed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  # Ship these even when a particular runtime version does not import all three.
  foreach ($dll in @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')) { [void]$needed.Add($dll) }
  $scanned = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  while ($pending.Count) {
    $image = $pending.Dequeue()
    if (!$scanned.Add($image)) { continue }
    foreach ($dll in (Get-PeImports $image)) {
      # Win10/11 resolve UCRT API-set contracts through the OS loader; they are
      # not necessarily physical System32 files. Ship their implementation.
      if ($dll -match '^api-ms-win-crt-.+\.dll$') { [void]$needed.Add('ucrtbase.dll') }
      elseif ($dll -match '^(vcruntime[0-9].*|msvcp[0-9].*|msvcr[0-9].*|vccorlib[0-9].*|concrt[0-9].*|vcomp[0-9].*|ucrtbase)\.dll$') { [void]$needed.Add($dll) }
    }
    foreach ($dll in @($needed)) {
      $source = Join-Path $SystemDirectory $dll
      if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing required app-local CRT DLL: $source" }
      if (!$scanned.Contains($source)) { $pending.Enqueue($source) }
    }
  }
  foreach ($dll in $needed) {
    foreach ($destination in $Destinations) { Copy-Item -LiteralPath (Join-Path $SystemDirectory $dll) -Destination $destination -Force }
  }
  return @($needed | Sort-Object)
}

function Get-VerifiedArchive($Dependency, [string]$Destination) {
  Invoke-WebRequest -Uri $Dependency.url -OutFile $Destination -TimeoutSec 900
  $hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -cne $Dependency.sha256) { throw "Checksum mismatch: $Destination" }
}

function Get-PartBytes([string]$Path) {
  $size = (Get-ChildItem -LiteralPath $Path -File -Recurse -Force | Measure-Object Length -Sum).Sum
  if ($null -eq $size) { return 0L }; return [long]$size
}

if (!$IsWindows -or ![Environment]::Is64BitProcess) { throw 'Build on Windows x64 with PowerShell 7.' }
& (Join-Path $PSScriptRoot 'verify-inno-compiler.ps1') -IsccPath $IsccPath
$version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
if ($version -cnotmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Unsafe package version for the Setup filename.' }
$out = [IO.Path]::GetFullPath($OutputDirectory)
# Inno 6.4.3 cannot read source paths beyond MAX_PATH (nor \\?\ paths).
# Keep its stage independent of the potentially deep output directory.
$work = Join-Path ([IO.Path]::GetTempPath()) ('tr-setup-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'stage'
$app = Join-Path $stage 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
New-Item -ItemType Directory -Path $out -Force | Out-Null
$dependencies = Get-Content -LiteralPath (Join-Path $repo 'installer\dependencies.json') -Raw | ConvertFrom-Json
foreach ($part in @('node', 'postgres')) {
  $dependency = $dependencies.$part
  $archive = Join-Path $work "$part.zip"
  Get-VerifiedArchive $dependency $archive
  $extract = Join-Path $work $part
  Expand-Archive -LiteralPath $archive -DestinationPath $extract
  $directory = Join-Path $extract $dependency.directory
  if (!(Test-Path -LiteralPath $directory -PathType Container)) { throw "Unexpected $part archive layout." }
  if ($part -eq 'node') {
    New-Item -ItemType Directory -Path (Join-Path $stage 'node') | Out-Null
    foreach ($file in @('node.exe', 'LICENSE')) { Copy-Item -LiteralPath (Join-Path $directory $file) -Destination (Join-Path $stage 'node') }
    $buildNode = Join-Path $directory 'node.exe'
    $npm = Join-Path $directory 'npm.cmd'
    $env:PATH = "$directory;$env:PATH"
  } else {
    $pgStage = Join-Path $stage 'pgsql'
    New-Item -ItemType Directory -Path $pgStage | Out-Null
    # No pgAdmin, headers, symbols or PostgreSQL manuals. initdb needs share/;
    # extensions and their support libraries need lib/.
    foreach ($folder in @('bin', 'lib', 'share')) {
      Copy-Item -LiteralPath (Join-Path $directory $folder) -Destination $pgStage -Recurse
    }
    foreach ($license in @(Get-ChildItem -LiteralPath $directory -Recurse -File | Where-Object Name -match '^(license|licence|copyright|notice)(\..*)?$|^legalnotice\.html$')) {
      $legalPath = Join-Path (Join-Path $pgStage 'licenses') ([IO.Path]::GetRelativePath($directory, $license.FullName))
      New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($legalPath)) -Force | Out-Null
      Copy-Item -LiteralPath $license.FullName -Destination $legalPath
    }
  }
}
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:DATABASE_URL = ''
$env:NODE_ENV = 'production'
$env:VITE_AUTH_ENABLED = 'true'
Push-Location -LiteralPath $repo
try {
  & $npm ci --include=dev
  if ($LASTEXITCODE -ne 0) { throw 'CI build dependency installation failed.' }
  & $npm run build
  if ($LASTEXITCODE -ne 0) { throw 'CI application build failed.' }
} finally { Pop-Location }
Copy-Item -LiteralPath (Join-Path $repo '.output') -Destination $app -Recurse
foreach ($file in @('package.json', 'package-lock.json', 'LICENSE', 'Start TownReporter.cmd', 'Stop TownReporter.cmd', 'Configure AI.cmd')) {
  Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $app
}
foreach ($dir in @('migrations', 'ops', 'licenses')) { Copy-Item -LiteralPath (Join-Path $repo $dir) -Destination $app -Recurse }
# Required redistribution notices are legal payload, not product documentation.
Copy-Item -LiteralPath (Join-Path $repo 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $app 'THIRD_PARTY_NOTICES.txt')
foreach ($dir in @('scripts', 'installer')) { New-Item -ItemType Directory -Path (Join-Path $app $dir) | Out-Null }
foreach ($file in @('migrate.mjs', 'migration-plan.mjs', 'install-build-manifest.mjs', 'fetch-fonts.mjs')) {
  Copy-Item -LiteralPath (Join-Path $repo "scripts\$file") -Destination (Join-Path $app 'scripts')
}
foreach ($file in @('FirstRun.ps1', 'Common.ps1', 'Start.ps1', 'Stop.ps1', 'Restart.ps1', 'Health.ps1', 'Configure-AI.ps1')) {
  Copy-Item -LiteralPath (Join-Path $repo "installer\$file") -Destination (Join-Path $app 'installer')
}
# A retry launcher uses the offline path; the downloading Install.ps1 is not shipped.
"@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0installer\FirstRun.ps1`" %*`r`npause" | Set-Content -LiteralPath (Join-Path $app 'Install TownReporter.cmd') -Encoding ASCII
Push-Location -LiteralPath $app
try {
  & $npm @('ci', '--omit=dev')
  if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $stage 'chromium'
  $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = $null
  & $buildNode @((Join-Path $app 'node_modules\playwright\cli.js'), 'install', 'chromium')
  if ($LASTEXITCODE -ne 0) { throw 'CI Chromium download failed.' }
} finally { Pop-Location }
# Remove vendored documentation/test folders and npm command shims from the owned stage.
$discard = @(Get-ChildItem -LiteralPath $app -Recurse -Force | Where-Object {
  ($_.PSIsContainer -and $_.Name -in @('test', 'tests', '__tests__', 'docs', '.git', '.github', '.bin')) -or
  (!$_.PSIsContainer -and ($_.Name -eq 'nightly-proof.ps1' -or $_.Name -match '\.(test|spec)\.' -or
    ($_.Extension -eq '.md' -and $_.Name -notmatch '^(license|licence|copyright|notice)([.-]|$)')))
} | Sort-Object { $_.FullName.Length } -Descending)
foreach ($entry in $discard) {
  $target = [IO.Path]::GetFullPath($entry.FullName)
  if (!$target.StartsWith($app.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside the stage.' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}
$images = @(Get-ChildItem -LiteralPath (Join-Path $stage 'pgsql') -Recurse -File | Where-Object Extension -in @('.exe', '.dll') | ForEach-Object FullName)
$images += Join-Path $stage 'node\node.exe'
$crt = Copy-AppLocalCrt $images @((Join-Path $stage 'node'), (Join-Path $stage 'pgsql\bin')) (Join-Path $env:SystemRoot 'System32')
. (Join-Path $PSScriptRoot 'windows-runtime-check.ps1')
Test-StagedWindowsRuntime $stage
# Bind identity to the actual reduced runtime tree, not the source checkout.
& $buildNode (Join-Path $app 'scripts\install-build-manifest.mjs') write $app
if ($LASTEXITCODE -ne 0) { throw 'Staged build manifest failed.' }
& $buildNode (Join-Path $app 'scripts\install-build-manifest.mjs') verify $app
if ($LASTEXITCODE -ne 0) { throw 'Staged build verification failed.' }
$iss = Join-Path $work 'TownReporter.iss'
Copy-Item -LiteralPath (Join-Path $repo 'installer\windows-setup\TownReporter.iss') -Destination $iss
@"
#define AppVersion "$version"
#define StageDir "$stage"
#define OutputDir "$out"
"@ | Set-Content -LiteralPath (Join-Path $work 'candidate.iss') -Encoding UTF8
$compilerLog = Join-Path $work 'inno-compile.log'
& $IsccPath $iss 2>&1 | Tee-Object -FilePath $compilerLog
if ($LASTEXITCODE -ne 0) {
  $compilerExit = $LASTEXITCODE
  $details = (Get-Content -LiteralPath $compilerLog -Tail 20) -join [Environment]::NewLine
  throw "Inno Setup compilation failed (exit $compilerExit); full log: $compilerLog`n$details"
}
$exe = Join-Path $out "TownReporter-$version-Setup.exe"
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Compiler did not produce the expected single Setup.exe.' }
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash *$([IO.Path]::GetFileName($exe))" | Set-Content -LiteralPath "$exe.sha256" -Encoding ASCII
$parts = [ordered]@{}
foreach ($part in @('app', 'node', 'pgsql', 'chromium')) { $parts[$part] = Get-PartBytes (Join-Path $stage $part) }
$parts['output'] = Get-PartBytes (Join-Path $app '.output')
$parts['productionNodeModules'] = Get-PartBytes (Join-Path $app 'node_modules')
$parts['appLocalCrt'] = [long](($crt | ForEach-Object { (Get-Item -LiteralPath (Join-Path $env:SystemRoot "System32\$_")).Length } | Measure-Object -Sum).Sum) * 2
$commit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not bind Setup.exe to its source commit.' }
$executables = @(Get-ChildItem -LiteralPath $stage -Recurse -Filter '*.exe' -File | ForEach-Object { [IO.Path]::GetRelativePath($stage, $_.FullName) } | Sort-Object)
$metadata = [ordered]@{filename=[IO.Path]::GetFileName($exe); version=$version; commit=$commit; sha256=$hash; bytes=(Get-Item -LiteralPath $exe).Length; parts=$parts; crtDlls=$crt; executables=$executables; nodeSha256=$dependencies.node.sha256; postgresSha256=$dependencies.postgres.sha256}
$metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath "$exe.json" -Encoding UTF8
Write-Host "Setup.exe: $($metadata.bytes) bytes; SHA256 $hash"
foreach ($part in $parts.Keys) { Write-Host "$part : $($parts[$part]) bytes (uncompressed; output/modules/CRT are subsets of app/node/pgsql)" }
