param([Parameter(Mandatory=$true)][string]$IsccPath)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'Install pinned Inno Setup in CI before building.' }
$compilerVersion = (Get-Item -LiteralPath $IsccPath).VersionInfo.FileVersion
Write-Host "Inno compiler: $IsccPath; file version: $compilerVersion"
# The official 6.4.3 ISCC.exe has file version 0.0.0.0. A real compile
# reports the loaded engine version, including a mismatched adjacent DLL.
$probe = @"
[Setup]
AppName=Compiler version probe
AppVersion=1
DefaultDirName={tmp}\compiler-probe
Uninstallable=no
Output=no
OutputDir=$([IO.Path]::GetTempPath())
"@
$output = @($probe | & $IsccPath /O- - 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Inno compiler version probe failed (exit $LASTEXITCODE): $($output -join [Environment]::NewLine)" }
$engineVersions = @($output | ForEach-Object {
  if ([string]$_ -cmatch '^Compiler engine version: Inno Setup (.+)$') { $Matches[1] }
})
Write-Host "Inno compiler engine version: $($engineVersions -join ', ')"
if ($engineVersions.Count -ne 1 -or $engineVersions[0] -cne '6.4.3') { throw 'Expected exactly Inno Setup 6.4.3; refusing an unpinned compiler.' }
