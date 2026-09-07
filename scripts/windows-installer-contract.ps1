param([Parameter(Mandatory=$true)][string]$AppRoot, [string]$DataRoot, [switch]$CheckBusy)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
function Read-Function([string]$Path, [string]$Name) {
  $ast = [Management.Automation.Language.Parser]::ParseInput((Get-Content -LiteralPath $Path -Raw), [ref]$null, [ref]$null)
  return $ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $Name}, $true).Extent.Text
}
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Enter-InstallLifecycle')
if ($CheckBusy) {
  try { $unexpected = Enter-InstallLifecycle }
  catch { if ($_.Exception.Message -match 'Another install/start/stop/restart') { exit 0 }; throw }
  $unexpected.ReleaseMutex(); $unexpected.Dispose()
  throw 'Concurrent lifecycle was incorrectly admitted.'
}
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Protect-LocalPath')
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Install.ps1') 'Get-VerifiedDependency')
$reviewRoot = Join-Path $env:TEMP ('tr-install-contract-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $reviewRoot | Out-Null
$acl = Get-Acl -LiteralPath $reviewRoot
$everyone = New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($everyone,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')))
Set-Acl -LiteralPath $reviewRoot -AclObject $acl
Protect-LocalPath $reviewRoot
$dummy = Join-Path $reviewRoot 'dummy-secret.txt'
Set-Content -LiteralPath $dummy -Value 'nonsecret-fixture'
$allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
foreach ($rule in (Get-Acl -LiteralPath $dummy).Access) {
  if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Unexpected identity has access to newly created credentials.' }
}
Write-Output 'PASS private credentials exclude pre-existing Everyone access.'
$toolsRoot = $reviewRoot
$archive = Join-Path $toolsRoot 'node.zip'
Set-Content -LiteralPath $archive -Value 'checksum-valid mock archive'
$target = Join-Path $toolsRoot 'node-runtime'
New-Item -ItemType Directory -Path $target | Out-Null
$dependency = [pscustomobject]@{ url='https://example.invalid/node.zip'; sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant(); directory='node-runtime'; version='test' }
function Expand-Archive { throw 'Unexpected extraction: fixture must refuse incomplete target.' }
$rejected = $false
try { [void](Get-VerifiedDependency $dependency 'test') } catch { if ($_.Exception.Message -notmatch 'Incomplete or unowned runtime directory') { throw }; $rejected = $true }
if (!$rejected) { throw 'Incomplete runtime target was accepted.' }
Write-Output 'PASS incomplete runtime refused before execution.'
$DataRoot = $reviewRoot
$held = Enter-InstallLifecycle
try {
  $nested = Enter-InstallLifecycle
  $nested.ReleaseMutex(); $nested.Dispose()
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -AppRoot $AppRoot -DataRoot $DataRoot -CheckBusy
  if ($LASTEXITCODE -ne 0) { throw 'Lifecycle concurrency guard failed.' }
} finally { $held.ReleaseMutex(); $held.Dispose() }
Write-Output 'PASS concurrent process refused; same-thread installer/start nesting accepted.'
Remove-Item -LiteralPath $dummy
Remove-Item -LiteralPath $archive
Remove-Item -LiteralPath $target
Remove-Item -LiteralPath $reviewRoot
