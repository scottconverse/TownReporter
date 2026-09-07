param([Parameter(Mandatory=$true)][string]$AppRoot, [string]$DataRoot, [switch]$CheckBusy)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
function Read-Function([string]$Path, [string]$Name) {
  $ast = [Management.Automation.Language.Parser]::ParseInput((Get-Content -LiteralPath $Path -Raw), [ref]$null, [ref]$null)
  return $ast.Find({param($a) $a -is [Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq $Name}, $true).Extent.Text
}
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Assert-PlainDirectory')
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Protect-LocalPath')
& {
  $fixtureRoot = Join-Path $env:TEMP ('tr-hidden-path-' + [guid]::NewGuid().ToString('N'))
  $hiddenParent = Join-Path $fixtureRoot 'hidden-parent'
  $child = Join-Path $hiddenParent 'child'
  $junction = Join-Path $fixtureRoot 'linked-parent'
  [IO.Directory]::CreateDirectory($child) | Out-Null
  try {
    [IO.File]::SetAttributes($hiddenParent, [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::Hidden)
    try { Assert-PlainDirectory $child }
    catch { throw "Plain directory below a hidden ancestor was incorrectly rejected: $($_.Exception.Message)" }
    Protect-LocalPath $hiddenParent
    New-Item -ItemType Junction -Path $junction -Target $hiddenParent | Out-Null
    $message = ''
    try { Assert-PlainDirectory (Join-Path $junction 'child') } catch { $message = $_.Exception.Message }
    if ($message -notmatch 'Linked paths are not supported') { throw 'Junction ancestor was not refused.' }
    Write-Output 'PASS hidden plain ancestors are accepted while junction ancestors remain refused.'
  } finally {
    # Remove the link itself, never recurse through its target.
    if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction) }
    [IO.File]::SetAttributes($hiddenParent, [IO.FileAttributes]::Directory)
    [IO.Directory]::Delete($child)
    [IO.Directory]::Delete($hiddenParent)
    [IO.Directory]::Delete($fixtureRoot)
  }
}
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Assert-PortFree')
& {
  # An empty listener inventory does not prove Windows permits a bind.
  function Get-NetTCPConnection { return @() }
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Server.ExclusiveAddressUse = $true
  $listener.Start()
  $fixturePort = $listener.LocalEndpoint.Port
  try {
    $message = ''
    try { Assert-PortFree $fixturePort } catch { $message = $_.Exception.Message }
    if ($message -notmatch 'cannot be bound') { throw 'Bind preflight accepted an unavailable loopback port despite an empty listener inventory.' }
  } finally { $listener.Stop() }
  Assert-PortFree $fixturePort
  # A successful preflight must release its temporary listener.
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $fixturePort)
  $listener.Start(); $listener.Stop()
  $script:reservationProbeStopped = $false
  function New-Object {
    param($TypeName, $ArgumentList)
    if ($TypeName -ne 'Net.Sockets.TcpListener') { throw 'Unexpected constructor in bind probe.' }
    $fake = [pscustomobject]@{ Server = [pscustomobject]@{ ExclusiveAddressUse = $false } }
    $fake | Add-Member ScriptMethod Start { throw [Net.Sockets.SocketException]::new(10013) }
    $fake | Add-Member ScriptMethod Stop { $script:reservationProbeStopped = $true }
    return $fake
  }
  $message = ''
  try { Assert-PortFree $fixturePort } catch { $message = $_.Exception.Message }
  if ($message -notmatch 'Windows may reserve' -or $message -notmatch 'Choose another port') { throw 'Reserved port refusal was missing actionable guidance.' }
  if (!$script:reservationProbeStopped) { throw 'Failed bind probe did not release its socket.' }
  Write-Output 'PASS bind preflight rejects occupied and Windows-denied ports, accepts free ports and releases probes.'
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
Protect-LocalPath $reviewRoot
$dummy = Join-Path $reviewRoot 'dummy-secret.txt'
Set-Content -LiteralPath $dummy -Value 'nonsecret-fixture'
Protect-LocalPath $dummy
Protect-LocalPath $dummy
$allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')
foreach ($rule in (Get-Acl -LiteralPath $dummy).Access) {
  if ($rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Unexpected identity has access to newly created credentials.' }
}
Write-Output 'PASS private credentials exclude pre-existing Everyone access.'
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Assert-OwnedListener')
$script:mockListener = [pscustomobject]@{ LocalAddress='127.0.0.1'; OwningProcess=42 }
function Get-NetTCPConnection { return $script:mockListener }
Assert-OwnedListener 4390 42
$script:mockListener.OwningProcess = 43
$rejectedListener = $false
try { Assert-OwnedListener 4390 42 } catch { $rejectedListener = $true }
if (!$rejectedListener) { throw 'An unrelated listener process was accepted as this application.' }
$script:mockListener.OwningProcess = 42
$script:mockListener.LocalAddress = '0.0.0.0'
$rejectedExposure = $false
try { Assert-OwnedListener 4390 42 } catch { $rejectedExposure = $true }
if (!$rejectedExposure) { throw 'An externally exposed listener was accepted.' }
Write-Output 'PASS listener identity requires the owned PID and IPv4 loopback address.'
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
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Invoke-PgControl')
$fakeControl = Join-Path $reviewRoot 'pg_ctl.exe'
Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\cmd.exe') -Destination $fakeControl
$config = [pscustomobject]@{ PgBin=$reviewRoot }
Invoke-PgControl @('/c', 'exit', '0')
$failed = $false
try { Invoke-PgControl @('/c', 'exit', '7') } catch { $failed = $true }
if (!$failed) { throw 'Failed native control command was incorrectly reported successful.' }
Write-Output 'PASS native process success and failure exit codes remain available after waiting.'
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Wait-InstallReadiness')
$slowProbe = Join-Path $reviewRoot 'slow-probe.ps1'
'param([string]$DataRoot); Start-Sleep -Seconds 10; exit 0' | Set-Content -LiteralPath $slowProbe -Encoding ASCII
$deadline = [Diagnostics.Stopwatch]::StartNew()
if (Wait-InstallReadiness $slowProbe 1) { throw 'An unfinished readiness probe was reported successful.' }
if ($deadline.ElapsedMilliseconds -gt 3000) { throw 'A one-second readiness budget waited for the ten-second probe.' }
Write-Output 'PASS slow readiness probe is bounded by the overall wall-clock deadline.'
Remove-Item -LiteralPath $slowProbe
Remove-Item -LiteralPath (Join-Path $reviewRoot 'readiness.out.log')
Remove-Item -LiteralPath (Join-Path $reviewRoot 'readiness.err.log')
Invoke-Expression (Read-Function (Join-Path $AppRoot 'installer\Common.ps1') 'Invoke-LoggedNative')
$nativeLog = Join-Path $reviewRoot 'native.log'
if ((Invoke-LoggedNative $fakeControl @('/c', 'echo nonfatal-warning 1>&2 & exit /b 0') $nativeLog) -ne 0) { throw 'Native stderr warning changed a successful exit status.' }
if ((Get-Content -LiteralPath $nativeLog -Raw) -notmatch 'nonfatal-warning') { throw 'Native warning was discarded instead of recorded.' }
if ((Invoke-LoggedNative $fakeControl @('/c', 'echo real-failure 1>&2 & exit /b 7') $nativeLog) -ne 7) { throw 'Nonzero native failure was swallowed.' }
Write-Output 'PASS native warnings preserved without swallowing failure exit codes.'
function Set-AppEnvironment { $env:NODE_ENV = 'production' }
$script:observedInstall = $false
$script:observedBuild = $false
function Invoke-LoggedNative([string]$Executable, [string[]]$Arguments, [string]$LogFile) {
  if ($Arguments[0] -eq 'ci') {
    if ($env:NODE_ENV -ne 'development') { throw 'Dependency installation would omit required development dependencies.' }
    $script:observedInstall = $true
  }
  if ($Arguments[0] -eq 'run' -and $Arguments[1] -eq 'build') {
    if ($env:NODE_ENV -ne 'production') { throw 'Built JSX mode differs from the production runtime.' }
    $script:observedBuild = $true
  }
  return 0
}
$installSource = Get-Content -LiteralPath (Join-Path $AppRoot 'installer\Install.ps1') -Raw
$buildStart = $installSource.LastIndexOf('Set-AppEnvironment')
$buildEnd = $installSource.IndexOf('& $nodeExe (Join-Path $AppRoot ''scripts\install-build-manifest.mjs'')', $buildStart)
if ($buildStart -lt 0 -or $buildEnd -lt $buildStart) { throw 'Could not locate the actual installer build phase for the environment contract.' }
$nodeRoot = $reviewRoot
$nodeExe = Join-Path $reviewRoot 'unused-node.exe'
Invoke-Expression $installSource.Substring($buildStart, $buildEnd - $buildStart)
if (!$script:observedInstall -or !$script:observedBuild) { throw 'Installer environment contract did not exercise both actual command calls.' }
Write-Output 'PASS dependency installation includes dev tools; build and runtime use production mode.'
Remove-Item -LiteralPath $nativeLog
Remove-Item -LiteralPath $fakeControl
Remove-Item -LiteralPath (Join-Path $reviewRoot 'pg-control.out.log')
Remove-Item -LiteralPath (Join-Path $reviewRoot 'pg-control.err.log')
Remove-Item -LiteralPath $dummy
Remove-Item -LiteralPath $archive
Remove-Item -LiteralPath $target
Remove-Item -LiteralPath $reviewRoot
