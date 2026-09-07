$ErrorActionPreference = 'Stop'
# npm/Node can preserve a PowerShell 7 PSModulePath when launching Windows PowerShell.
# Its binary modules cannot load in 5.1; use the native Windows module directory.
if ($PSVersionTable.PSVersion.Major -lt 6) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
$AppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$DataRoot) {
  $pointer = Join-Path $AppRoot '.townreporter-install.json'
  if (!(Test-Path -LiteralPath $pointer)) { throw 'Run Install TownReporter.cmd first.' }
  $DataRoot = (Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json).DataRoot
}
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$ConfigFile = Join-Path $DataRoot 'config.json'
function Assert-PlainDirectory([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Linked paths are not supported: $current" }
    $parent = [IO.Directory]::GetParent($current)
    if (!$parent) { break }; $current = $parent.FullName
  }
}
Assert-PlainDirectory $AppRoot
Assert-PlainDirectory $DataRoot
function Enter-InstallLifecycle {
  $locks = @()
  foreach ($scope in @($AppRoot, $DataRoot) | Sort-Object -Unique) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $name = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($scope.ToLowerInvariant())))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\TownReporter-' + $name))
    try { $acquired = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (!$acquired) {
      $mutex.Dispose()
      foreach ($held in $locks) { $held.ReleaseMutex(); $held.Dispose() }
      throw 'Another install/start/stop/restart is working on this installation. Wait for it to finish and retry.'
    }
    $locks += $mutex
  }
  $token = [pscustomobject]@{ Mutexes=$locks }
  $token | Add-Member -MemberType ScriptMethod -Name ReleaseMutex -Value { foreach ($held in $this.Mutexes) { $held.ReleaseMutex() } }
  $token | Add-Member -MemberType ScriptMethod -Name Dispose -Value { foreach ($held in $this.Mutexes) { $held.Dispose() } }
  return $token
}
function Read-InstallConfig {
  if (!(Test-Path -LiteralPath $ConfigFile)) { throw 'Installation is incomplete. Run Install TownReporter.cmd again.' }
  $config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
  if ($config.AppRoot -cne $AppRoot -or $config.DataRoot -cne $DataRoot -or $config.InstanceId -notmatch '^[a-f0-9]{32}$') { throw 'Installation identity mismatch. Do not move an installed source directory.' }
  foreach ($value in @($config.Port, $config.PgPort)) { if ($value -lt 1024 -or $value -gt 65535) { throw 'Invalid configured port.' } }
  if ($config.Port -eq $config.PgPort) { throw 'App and database ports must differ.' }
  if ($config.DatabasePassword -notmatch '^[a-f0-9]{64}$' -or $config.AuthSecret -notmatch '^[a-f0-9]{64}$') { throw 'Invalid installation secrets; configuration may be damaged.' }
  return $config
}
function Assert-PortFree([int]$Port) {
  if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is occupied. Choose another port during Install. No process was stopped." }
}
function Protect-LocalPath([string]$Path) {
  # Construct only the replacement DACL. Reusing Get-Acl can make PowerShell 5.1
  # attempt to persist owner/SACL sections on retry, requiring SeSecurityPrivilege.
  $isDirectory = (Get-Item -LiteralPath $Path).PSIsContainer
  $acl = if ($isDirectory) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($isDirectory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
  foreach ($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User, 'SYSTEM')) {
    $acl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')))
  }
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    if ($isDirectory) { [IO.Directory]::SetAccessControl($Path, $acl) }
    else { [IO.File]::SetAccessControl($Path, $acl) }
  } else { Set-Acl -LiteralPath $Path -AclObject $acl }
}
function Invoke-PgControl([string[]]$Arguments) {
  $run = Start-Process -FilePath (Join-Path $config.PgBin 'pg_ctl.exe') -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataRoot 'pg-control.out.log') -RedirectStandardError (Join-Path $DataRoot 'pg-control.err.log')
  try {
    # Cache the process handle before waiting: PowerShell 5.1 otherwise loses ExitCode.
    $null = $run.Handle
    $run.WaitForExit()
    if ($null -eq $run.ExitCode -or $run.ExitCode -ne 0) { throw "Postgres control failed. Read $DataRoot\pg-control.err.log." }
  } finally { $run.Dispose() }
}
function Invoke-LoggedNative([string]$Executable, [string[]]$Arguments, [string]$LogFile) {
  # PowerShell 5.1 turns redirected native stderr warnings into ErrorRecords.
  # Preserve them in the log, but let the process exit status determine success.
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    & $Executable @Arguments *> $LogFile
    $nativeExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $priorPreference }
  if ($null -eq $nativeExit) { throw "Native command did not return an exit code. Read $LogFile." }
  return $nativeExit
}
function Wait-InstallReadiness([string]$ProbeScript, [int]$TimeoutSeconds = 120) {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $budget = $TimeoutSeconds * 1000
  while ($clock.ElapsedMilliseconds -lt $budget) {
    # Bound the whole probe process, including CIM and HTTP; nested request
    # timeouts alone did not bound startup when the page consistently returned 500.
    $probe = Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$ProbeScript+'"'),'-DataRoot',('"'+$DataRoot+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataRoot 'readiness.out.log') -RedirectStandardError (Join-Path $DataRoot 'readiness.err.log')
    try {
      $null = $probe.Handle
      $remaining = [Math]::Max(0, $budget - $clock.ElapsedMilliseconds)
      if (!$probe.WaitForExit([int]$remaining)) {
        # This exact Process object owns only the read-only probe we just created.
        if (!$probe.HasExited) { $probe.Kill() }
        return $false
      }
      if ($probe.ExitCode -eq 0) { return $true }
    } finally { $probe.Dispose() }
    $remaining = [Math]::Max(0, $budget - $clock.ElapsedMilliseconds)
    if ($remaining -gt 0) { Start-Sleep -Milliseconds ([int][Math]::Min(2000, $remaining)) }
  }
  return $false
}
function Get-OwnedPostgres {
  $pgData = Join-Path $DataRoot 'pgdata'
  Assert-PlainDirectory $pgData
  if (!(Test-Path -LiteralPath (Join-Path $pgData 'postmaster.pid'))) { return $null }
  $lines = Get-Content -LiteralPath (Join-Path $pgData 'postmaster.pid')
  if ($lines[0] -notmatch '^\d+$') { throw 'Invalid PostgreSQL PID file.' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($lines[0])" -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  if ($process.ExecutablePath -ne (Join-Path $config.PgBin 'postgres.exe') -or !($process.CommandLine -replace '/', '\').Contains($pgData) -or ($lines[1] -replace '/', '\') -ne $pgData -or $lines[3] -ne [string]$config.PgPort) { throw 'Database PID is not owned by this installation; no action taken.' }
  return $process
}
function Get-OwnedApp {
  $stateFile = Join-Path $DataRoot 'app-process.json'
  if (!(Test-Path -LiteralPath $stateFile)) { return $null }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ([string]$state.ProcessId -notmatch '^\d+$') { throw 'Invalid application PID record.' }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.ProcessId)" -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  $entry = Join-Path $AppRoot '.output\server\index.mjs'
  if ($process.CreationDate.ToUniversalTime() -ne ([datetime]$state.Created).ToUniversalTime() -or $process.ExecutablePath -ne $config.NodeExe -or !$process.CommandLine.Contains($entry)) { throw 'Application PID is not owned by this installation; no action taken.' }
  return $process
}
function Set-AppEnvironment {
  # Clear inherited database/provider/ops options. The explicit provider file is the only override.
  foreach ($item in @(Get-ChildItem Env:)) {
    if ($item.Name -match '^(DATABASE_URL|TEST_POSTGRES_ADMIN_URL|BETTER_AUTH_|PUBLIC_SITE_URL|VITE_|TOWNREPORTER_|LLM_|ANTHROPIC_|OPENAI_|XAI_|CLAUDE_CLI_PATH|CODEX_CLI_PATH|WATCHDOG_|PGPASSWORD)') { [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process') }
  }
  $env:DATABASE_URL = "postgresql://townreporter:$($config.DatabasePassword)@127.0.0.1:$($config.PgPort)/townreporter"
  $env:BETTER_AUTH_SECRET = $config.AuthSecret
  $env:BETTER_AUTH_URL = "http://127.0.0.1:$($config.Port)"
  $env:PUBLIC_SITE_URL = $env:BETTER_AUTH_URL
  $env:VITE_AUTH_ENABLED = 'true'
  $env:HOST = '127.0.0.1'; $env:NITRO_HOST = '127.0.0.1'
  $env:PORT = [string]$config.Port; $env:NITRO_PORT = $env:PORT
  $env:NODE_ENV = 'production'
  $env:TOWNREPORTER_TUNNEL = '0'; $env:TOWNREPORTER_LEGACY_OPS = '0'
  $env:TOWNREPORTER_DATA_ROOT = $DataRoot; $env:TOWNREPORTER_INSTANCE_ID = $config.InstanceId
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $DataRoot 'browsers'
  $providerFile = Join-Path $DataRoot 'providers.json'
  if (Test-Path -LiteralPath $providerFile) {
    foreach ($property in (Get-Content -LiteralPath $providerFile -Raw | ConvertFrom-Json).PSObject.Properties) {
      if ($property.Name -notmatch '^(LLM_(BASE_URL|API_KEY|MODEL)|ANTHROPIC_(API_KEY|MODEL)|OPENAI_API_KEY|XAI_API_KEY|CLAUDE_CLI_PATH|CODEX_CLI_PATH|TOWNREPORTER_(CLAUDE_CODE|CODEX|LOCAL|VOICE_FILE))$') { throw "Unsupported provider setting: $($property.Name)" }
      [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
    }
  }
  $env:PATH = (Split-Path -Parent $config.NodeExe) + ';' + $env:PATH
}
